import { supabase } from '../supabase-client.js';
import { activityMeetings } from './instructor-scheduling-load.js';
import { adjacentActivities } from './instructor-matching-engine.js';

const text = (value) => String(value ?? '').trim();
const key = (origin, destination) => `${text(origin).toLowerCase().replace(/\s+/g, ' ')}→${text(destination).toLowerCase().replace(/\s+/g, ' ')}`;

export function createRouteClient({ invoke = (body) => supabase.functions.invoke('scheduling-route', { body }), concurrency = 4 } = {}) {
  const cache = new Map(); let active = 0; const queue = []; let unavailableReason = '';
  const pump = () => { while (active < concurrency && queue.length) { const job = queue.shift(); active += 1; Promise.resolve().then(job.run).then(job.resolve, job.reject).finally(() => { active -= 1; pump(); }); } };
  const request = (origin, destination) => {
    if (!text(origin) || !text(destination)) return Promise.resolve(null);
    const cacheKey = key(origin, destination); if (cache.has(cacheKey)) return cache.get(cacheKey);
    const promise = new Promise((resolve, reject) => { queue.push({ resolve, reject, run: async () => {
      const { data, error } = await invoke({ origin, destination });
      if (error || !data?.calculated) { unavailableReason ||= data?.reason || error?.message || 'route_service_unavailable'; return null; }
      return { distance_km: Number(data.distance_km), duration_minutes: Number(data.duration_minutes) };
    } }); pump(); });
    cache.set(cacheKey, promise); return promise;
  };
  return { request, get unavailableReason() { return unavailableReason; } };
}

function assignedMeetings(activities = []) {
  const assigned = {};
  for (const activity of activities) for (const empId of [text(activity.emp_id), text(activity.emp_id_2)].filter(Boolean)) {
    for (const meeting of activityMeetings(activity)) (assigned[empId] ||= []).push({ ...meeting, school: activity.school, school_address: activity.school_address, authority: activity.authority, activity_name: activity.activity_name });
  }
  return assigned;
}

export async function calculateCandidateTravel(preliminary, activities, routeClient = createRouteClient()) {
  const assigned = assignedMeetings(activities); const travel = {};
  await Promise.all(preliminary.map(async ({ course, candidate }) => {
    const empId = text(candidate.instructor.emp_id), destination = course.school_address || course.school;
    const result = { home: await routeClient.request(candidate.instructor.address, destination), transitions: {} };
    for (const meeting of activityMeetings(course)) {
      const { previous, next } = adjacentActivities(assigned[empId] || [], meeting);
      result.transitions[meeting.date] = {
        previous: previous ? await routeClient.request(previous.school_address || previous.school, destination) : null,
        next: next ? await routeClient.request(destination, next.school_address || next.school) : null
      };
    }
    (travel[text(course.row_id || course.RowID || course.id)] ||= {})[empId] = result;
  }));
  return { travel, unavailableReason: routeClient.unavailableReason };
}
