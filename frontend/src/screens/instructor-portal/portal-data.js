import { assignedToCurrentInstructor, currentInstructorIds, isoDate } from '../instructor-utils.js';
import { buildReadyCourseScheduleRows, sortReadyCourseScheduleRows } from '../shared/instructor-course-schedule-2027.js';

export function instructorActivities(rows, state) {
  const ids = currentInstructorIds(state);
  return (Array.isArray(rows) ? rows : []).filter((row) => assignedToCurrentInstructor(row, ids));
}

export function instructorScheduleRows(rows, state) {
  const assigned = instructorActivities(rows, state);
  return sortReadyCourseScheduleRows(buildReadyCourseScheduleRows(assigned), { instructorSelected: true });
}

export function activityMonth(row) {
  return isoDate(row?.start_date || row?.activity_date || row?.date_1).slice(0, 7);
}

export function monthlyInstructorSummary(rows, state, month) {
  const selected = instructorActivities(rows, state).filter((row) => activityMonth(row) === month);
  const types = new Map();
  selected.forEach((row) => {
    const label = String(row?.activity_type || row?.type || 'פעילות').trim() || 'פעילות';
    types.set(label, (types.get(label) || 0) + 1);
  });
  return { total: selected.length, types: [...types.entries()].map(([label, value]) => ({ label, value })) };
}

export async function loadInstructorActivities(api) {
  const result = await api.myData({ includeClosedForApprovals: true });
  return { rows: result?.rows || [], teamGroups: result?.teamGroups || [] };
}
