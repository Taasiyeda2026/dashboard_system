import { supabase } from '../supabase-client.js';
import { activityMeetings } from './instructor-scheduling-load.js';
import { adjacentActivities } from './instructor-matching-engine.js';
import { isSchedulingBlockingAssignment } from './shared/activity-scheduling-eligibility.js';

const text = (value) => String(value ?? '').trim();
const normalizePlace = (value) => text(value).toLowerCase().replace(/\s+/g, ' ');
const activityId = (activity) => text(activity?.row_id || activity?.RowID || activity?.id);
const instructorId = (candidate) => text(candidate?.instructor?.emp_id);
const activityPlace = (activity = {}) => text(activity.school_address || activity.school);
const minutes = (value) => {
  const [hours, mins] = text(value).split(':').map(Number);
  return hours * 60 + mins;
};

export function routeMatrixKey(origin, destination) {
  return `${normalizePlace(origin)}→${normalizePlace(destination)}`;
}

export function createRouteClient({ invoke = (body) => supabase.functions.invoke('scheduling-route', { body }), concurrency = 4 } = {}) {
  const cache = new Map();
  let active = 0;
  const queue = [];
  let unavailableReason = '';

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
    const promise = new Promise((resolve, reject) => {
      queue.push({
        resolve,
        reject,
        run: async () => {
          const { data, error } = await invoke({ origin, destination });
          if (error || !data?.calculated) {
            unavailableReason ||= data?.reason || error?.message || 'route_service_unavailable';
            return null;
          }
          return {
            distance_km: Number(data.distance_km),
            duration_minutes: Number(data.duration_minutes)
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
    get unavailableReason() { return unavailableReason; }
  };
}

function assignedMeetings(activities = []) {
  const assigned = {};
  for (const activity of activities.filter(isSchedulingBlockingAssignment)) {
    const empIds = [text(activity.emp_id), text(activity.emp_id_2)].filter(Boolean);
    for (const empId of empIds) {
      for (const meeting of activityMeetings(activity)) {
        (assigned[empId] ||= []).push({
          ...meeting,
          activity_id: activityId(activity),
          school: activity.school,
          school_address: activity.school_address,
          authority: activity.authority,
          activity_name: activity.activity_name
        });
      }
    }
  }
  return assigned;
}

function sharedMeetingTransitions(firstCourse, secondCourse) {
  const transitions = [];
  const secondByDate = new Map(activityMeetings(secondCourse).map((meeting) => [text(meeting.date), meeting]));
  for (const first of activityMeetings(firstCourse)) {
    const second = secondByDate.get(text(first.date));
    if (!second) continue;
    if (minutes(first.end_time || firstCourse.end_time) <= minutes(second.start_time || secondCourse.start_time)) {
      transitions.push({ origin: activityPlace(firstCourse), destination: activityPlace(secondCourse) });
    } else if (minutes(second.end_time || secondCourse.end_time) <= minutes(first.start_time || firstCourse.start_time)) {
      transitions.push({ origin: activityPlace(secondCourse), destination: activityPlace(firstCourse) });
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
    const result = {
      home: await route(candidate.instructor.address, destination),
      transitions: {}
    };
    for (const meeting of activityMeetings(course)) {
      const { previous, next } = adjacentActivities(assigned[empId] || [], meeting);
      result.transitions[meeting.date] = {
        previous: previous ? await route(previous.school_address || previous.school, destination) : null,
        next: next ? await route(destination, next.school_address || next.school) : null
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

  return { travel, routeMatrix, unavailableReason: routeClient.unavailableReason };
}
