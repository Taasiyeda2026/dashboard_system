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

function schoolRouteContext(activity = {}) {
  return {
    schoolName: text(activity?.school),
    authorityName: text(activity?.authority)
  };
}

function normalizedRouteContext(context = {}) {
  return {
    originSchoolName: text(context.originSchoolName),
    originAuthorityName: text(context.originAuthorityName),
    destinationSchoolName: text(context.destinationSchoolName),
    destinationAuthorityName: text(context.destinationAuthorityName)
  };
}

function routeRequestKey(origin, destination, context = {}) {
  const normalized = normalizedRouteContext(context);
  return [
    routeMatrixKey(origin, destination),
    normalized.originSchoolName,
    normalized.originAuthorityName,
    normalized.destinationSchoolName,
    normalized.destinationAuthorityName
  ].join('|');
}

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

export function createRouteClient({ invoke = (body) => supabase.functions.invoke('scheduling-route', { body }), concurrency = 4 } = {}) {
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

  const request = (origin, destination, context = {}) => {
    if (!text(origin) || !text(destination)) return Promise.resolve(null);
    const normalizedContext = normalizedRouteContext(context);
    const cacheKey = routeRequestKey(origin, destination, normalizedContext);
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const payload = {
      origin: text(origin),
      destination: text(destination),
      origin_school_name: normalizedContext.originSchoolName,
      origin_authority_name: normalizedContext.originAuthorityName,
      destination_school_name: normalizedContext.destinationSchoolName,
      destination_authority_name: normalizedContext.destinationAuthorityName
    };
    const promise = new Promise((resolve, reject) => {
      queue.push({
        resolve,
        reject,
        run: async () => {
          requests.push({ ...payload });
          const { data, error } = await invoke(payload);
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
        school_id: activity.school_id,
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
  const firstContext = schoolRouteContext(firstCourse);
  const secondContext = schoolRouteContext(secondCourse);
  const secondByDate = new Map(activityMeetings(secondCourse).map((meeting) => [text(meeting.date), meeting]));
  for (const first of activityMeetings(firstCourse)) {
    const second = secondByDate.get(text(first.date));
    if (!second) continue;
    if (minutes(first.end_time || firstCourse.end_time) <= minutes(second.start_time || secondCourse.start_time)) {
      transitions.push({
        origin,
        destination,
        context: {
          originSchoolName: firstContext.schoolName,
          originAuthorityName: firstContext.authorityName,
          destinationSchoolName: secondContext.schoolName,
          destinationAuthorityName: secondContext.authorityName
        }
      });
    } else if (minutes(second.end_time || secondCourse.end_time) <= minutes(first.start_time || firstCourse.start_time)) {
      transitions.push({
        origin: destination,
        destination: origin,
        context: {
          originSchoolName: secondContext.schoolName,
          originAuthorityName: secondContext.authorityName,
          destinationSchoolName: firstContext.schoolName,
          destinationAuthorityName: firstContext.authorityName
        }
      });
    }
  }
  return transitions;
}

export async function calculateCandidateTravel(preliminary, activities, routeClient = createRouteClient()) {
  const assigned = assignedMeetings(activities);
  const travel = {};
  const routeMatrix = {};
  const requested = new Map();

  const route = async (origin, destination, context = {}) => {
    if (!text(origin) || !text(destination)) return null;
    const matrixKey = routeMatrixKey(origin, destination);
    if (normalizePlace(origin) === normalizePlace(destination)) {
      const zero = { distance_km: 0, duration_minutes: 0 };
      routeMatrix[matrixKey] = zero;
      return zero;
    }
    const requestKey = routeRequestKey(origin, destination, context);
    if (!requested.has(requestKey)) requested.set(requestKey, routeClient.request(origin, destination, context));
    const leg = await requested.get(requestKey);
    routeMatrix[matrixKey] = leg;
    return leg;
  };

  const uniquePairs = [...new Map((preliminary || []).map((item) => [`${activityId(item.course)}|${instructorId(item.candidate)}`, item])).values()];

  await Promise.all(uniquePairs.map(async ({ course, candidate }) => {
    const empId = instructorId(candidate);
    const destination = activityPlace(course);
    const homeOrigin = text(candidate.instructor.address);
    const courseContext = schoolRouteContext(course);
    const result = {
      home: homeOrigin && destination ? await route(homeOrigin, destination, {
        destinationSchoolName: courseContext.schoolName,
        destinationAuthorityName: courseContext.authorityName
      }) : null,
      homeReturn: destination && homeOrigin ? await route(destination, homeOrigin, {
        originSchoolName: courseContext.schoolName,
        originAuthorityName: courseContext.authorityName
      }) : null,
      transitions: {}
    };
    for (const meeting of activityMeetings(course)) {
      const { previous, next } = adjacentActivities(assigned[empId] || [], meeting);
      const previousPlace = previous ? activityPlace(previous) : '';
      const nextPlace = next ? activityPlace(next) : '';
      const previousContext = schoolRouteContext(previous || {});
      const nextContext = schoolRouteContext(next || {});
      result.transitions[meeting.date] = {
        previous: previousPlace && destination ? await route(previousPlace, destination, {
          originSchoolName: previousContext.schoolName,
          originAuthorityName: previousContext.authorityName,
          destinationSchoolName: courseContext.schoolName,
          destinationAuthorityName: courseContext.authorityName
        }) : null,
        next: destination && nextPlace ? await route(destination, nextPlace, {
          originSchoolName: courseContext.schoolName,
          originAuthorityName: courseContext.authorityName,
          destinationSchoolName: nextContext.schoolName,
          destinationAuthorityName: nextContext.authorityName
        }) : null,
        baseline: previousPlace && nextPlace
          ? await route(previousPlace, nextPlace, {
            originSchoolName: previousContext.schoolName,
            originAuthorityName: previousContext.authorityName,
            destinationSchoolName: nextContext.schoolName,
            destinationAuthorityName: nextContext.authorityName
          })
          : previousPlace && homeOrigin
            ? await route(previousPlace, homeOrigin, {
              originSchoolName: previousContext.schoolName,
              originAuthorityName: previousContext.authorityName
            })
            : homeOrigin && nextPlace
              ? await route(homeOrigin, nextPlace, {
                destinationSchoolName: nextContext.schoolName,
                destinationAuthorityName: nextContext.authorityName
              })
              : null
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
          draftRouteJobs.push(route(transition.origin, transition.destination, transition.context));
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
