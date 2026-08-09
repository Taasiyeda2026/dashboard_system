import { supabase } from '../supabase-client.js';
import { activityMeetings } from './instructor-scheduling-load.js';
import { adjacentActivities } from './instructor-matching-engine.js';
import {
  isSchedulingBlockingAssignment,
  isSchedulingDraftAssignment
} from './shared/activity-scheduling-eligibility.js';

const text = (value) => String(value ?? '').trim();
const normalizePlace = (value) => text(value).toLowerCase().replace(/\s+/g, ' ');
const activityId = (activity) => text(activity?.row_id || activity?.RowID || activity?.id);
const instructorId = (candidate) => text(candidate?.instructor?.emp_id);
// Canonical resolved address only — never fall back to the school display name.
export const activityPlace = (activity = {}) => text(activity.school_address);
const minutes = (value) => {
  const [hours, mins] = text(value).split(':').map(Number);
  return hours * 60 + mins;
};

function persistedCalendarSource(activity = {}) {
  if (isSchedulingDraftAssignment(activity) && Array.isArray(activity.draft_proposed_meetings)) {
    return { ...activity, meetings: activity.draft_proposed_meetings };
  }
  return activity;
}

export function routeMatrixKey(origin, destination) {
  return `${normalizePlace(origin)}→${normalizePlace(destination)}`;
}

// Shared for the lifetime of the scheduling workspace so overlapping or repeat
// calculations never invoke the route service twice for an already resolved leg.
const resolvedRoutePromises = new Map();

async function readValidPersistedRoute(origin, destination) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('scheduling_travel_cache')
    .select('origin_key,destination_key,origin_address,destination_address,distance_km,duration_minutes,expires_at')
    .eq('origin_key', normalizePlace(origin))
    .eq('destination_key', normalizePlace(destination))
    .gt('expires_at', now)
    .maybeSingle();
  if (error || !data) return null;
  if (text(data.origin_address) && text(data.origin_address) !== text(origin)) return null;
  if (text(data.destination_address) && text(data.destination_address) !== text(destination)) return null;
  const distance = Number(data.distance_km);
  const duration = Number(data.duration_minutes);
  if (!Number.isFinite(distance) || distance < 0 || !Number.isFinite(duration) || duration < 0) return null;
  return { distance_km: distance, duration_minutes: duration, cached: true };
}

export function createRouteClient(options = {}) {
  const invoke = options.invoke || ((body) => supabase.functions.invoke('scheduling-route', { body }));
  const concurrency = options.concurrency ?? 4;
  // Custom invokers (tests/adapters) retain their own cache contract. The live
  // client checks the table first so a valid persisted route avoids Edge entirely.
  const lookup = options.lookup === undefined
    ? (options.invoke ? null : readValidPersistedRoute)
    : options.lookup;
  const cache = new Map();
  let active = 0;
  const queue = [];
  let unavailableReason = '';
  let googleCalls = 0;
  let cacheHits = 0;
  const requests = [];

  const pump = () => {
    while (active < concurrency && queue.length) {
      const job = queue.shift();
      active += 1;
      Promise.resolve()
        .then(job.run)
        .then(job.resolve, job.reject)
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  };

  const request = (origin, destination) => {
    if (!text(origin) || !text(destination)) return Promise.resolve(null);
    const cacheKey = routeMatrixKey(origin, destination);
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    if (resolvedRoutePromises.has(cacheKey)) {
      const shared = resolvedRoutePromises.get(cacheKey);
      cache.set(cacheKey, shared);
      return shared;
    }
    const promise = new Promise((resolve, reject) => {
      queue.push({
        resolve,
        reject,
        run: async () => {
          if (lookup) {
            const persisted = await lookup(origin, destination);
            if (persisted) {
              cacheHits += 1;
              return persisted;
            }
          }
          requests.push({ origin: text(origin), destination: text(destination) });
          const { data, error } = await invoke({ origin, destination });
          if (error || !data?.calculated) {
            unavailableReason ||= data?.reason || error?.message || 'route_service_unavailable';
            return null;
          }
          if (data.cached) cacheHits += 1;
          else googleCalls += 1;
          return {
            distance_km: Number(data.distance_km),
            duration_minutes: Number(data.duration_minutes),
            cached: !!data.cached
          };
        }
      });
      pump();
    });
    cache.set(cacheKey, promise);
    resolvedRoutePromises.set(cacheKey, promise);
    promise.then((route) => {
      if (!route) resolvedRoutePromises.delete(cacheKey);
    }, () => resolvedRoutePromises.delete(cacheKey));
    return promise;
  };

  return {
    request,
    get unavailableReason() { return unavailableReason; },
    get googleCalls() { return googleCalls; },
    get cacheHits() { return cacheHits; },
    get requests() { return requests.slice(); }
  };
}

function assignedMeetings(activities = []) {
  const assigned = {};
  const pushFor = (empId, activity, source) => {
    if (!empId) return;
    for (const meeting of activityMeetings(source)) {
      (assigned[empId] ||= []).push({
        ...meeting,
        activity_id: activityId(activity),
        school: activity.school,
        school_address: activity.school_address,
        authority: activity.authority,
        activity_name: activity.activity_name
      });
    }
  };
  for (const activity of activities || []) {
    if (isSchedulingBlockingAssignment(activity)) {
      pushFor(text(activity.emp_id), activity, activity);
      pushFor(text(activity.emp_id_2), activity, activity);
    }
    // Saved drafts participate in route/transition calculations like approved assignments.
    if (isSchedulingDraftAssignment(activity)) {
      pushFor(text(activity.draft_emp_id), activity, persistedCalendarSource(activity));
    }
  }
  return assigned;
}

function sharedMeetingTransitions(firstCourse, secondCourse) {
  const transitions = [];
  const origin = activityPlace(firstCourse);
  const destination = activityPlace(secondCourse);
  if (!origin || !destination) return transitions;
  const secondByDate = new Map(activityMeetings(secondCourse).map((meeting) => [text(meeting.date), meeting]));
  for (const first of activityMeetings(firstCourse)) {
    const second = secondByDate.get(text(first.date));
    if (!second) continue;
    if (minutes(first.end_time || firstCourse.end_time) <= minutes(second.start_time || secondCourse.start_time)) {
      transitions.push({ origin, destination });
    } else if (minutes(second.end_time || secondCourse.end_time) <= minutes(first.start_time || firstCourse.start_time)) {
      transitions.push({ origin: destination, destination: origin });
    }
  }
  return transitions;
}

export async function calculateCandidateTravel(preliminary, activities, routeClient = createRouteClient()) {
  const assigned = assignedMeetings(activities);
  const travel = {};
  const routeMatrix = {};
  const requested = new Map();

  const route = async (origin, destination) => {
    if (!text(origin) || !text(destination)) return null;
    if (normalizePlace(origin) === normalizePlace(destination)) {
      const zero = { distance_km: 0, duration_minutes: 0 };
      routeMatrix[routeMatrixKey(origin, destination)] = zero;
      return zero;
    }
    const key = routeMatrixKey(origin, destination);
    if (!requested.has(key)) requested.set(key, routeClient.request(origin, destination));
    const leg = await requested.get(key);
    routeMatrix[key] = leg;
    return leg;
  };

  const uniquePairs = [...new Map((preliminary || []).map((item) => [`${activityId(item.course)}|${instructorId(item.candidate)}`, item])).values()];

  await Promise.all(uniquePairs.map(async ({ course, candidate }) => {
    const empId = instructorId(candidate);
    const destination = activityPlace(course);
    const homeOrigin = text(candidate.instructor.address);
    const result = {
      home: homeOrigin && destination ? await route(homeOrigin, destination) : null,
      transitions: {}
    };
    for (const meeting of activityMeetings(course)) {
      const { previous, next } = adjacentActivities(assigned[empId] || [], meeting);
      const previousPlace = previous ? activityPlace(previous) : '';
      const nextPlace = next ? activityPlace(next) : '';
      result.transitions[meeting.date] = {
        previous: previousPlace && destination ? await route(previousPlace, destination) : null,
        next: destination && nextPlace ? await route(destination, nextPlace) : null
      };
    }
    (travel[activityId(course)] ||= {})[empId] = result;
  }));

  const byInstructor = new Map();
  for (const item of uniquePairs) {
    const empId = instructorId(item.candidate);
    if (!byInstructor.has(empId)) byInstructor.set(empId, []);
    byInstructor.get(empId).push(item.course);
  }

  const draftRouteJobs = [];
  for (const courses of byInstructor.values()) {
    const uniqueCourses = [...new Map(courses.map((course) => [activityId(course), course])).values()];
    for (let firstIndex = 0; firstIndex < uniqueCourses.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < uniqueCourses.length; secondIndex += 1) {
        for (const transition of sharedMeetingTransitions(uniqueCourses[firstIndex], uniqueCourses[secondIndex])) {
          draftRouteJobs.push(route(transition.origin, transition.destination));
        }
      }
    }
  }
  await Promise.all(draftRouteJobs);

  return {
    travel,
    routeMatrix,
    unavailableReason: text(routeClient.unavailableReason) === 'google_key_not_configured'
      ? 'route_service_unavailable'
      : routeClient.unavailableReason,
    googleCalls: routeClient.googleCalls,
    cacheHits: routeClient.cacheHits,
    requests: routeClient.requests
  };
}
