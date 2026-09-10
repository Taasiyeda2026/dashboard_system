import { assignedToCurrentInstructor, currentInstructorIds, isoDate } from '../instructor-utils.js';
import { buildReadyCourseScheduleRows, sortReadyCourseScheduleRows } from '../shared/instructor-course-schedule-2027.js';
import { activityTypeDisplayLabel, normalizeActivityTypeKey } from '../shared/activity-options.js';

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
    const rawType = row?.activity_type || row?.type || '';
    const canonicalType = normalizeActivityTypeKey(rawType);
    const label = activityTypeDisplayLabel(canonicalType || rawType) || 'פעילות';
    types.set(label, (types.get(label) || 0) + 1);
  });
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const next = [...selected].filter((row) => isoDate(row?.start_date || row?.activity_date || row?.date_1) >= today)
    .sort((a, b) => isoDate(a?.start_date || a?.activity_date || a?.date_1).localeCompare(isoDate(b?.start_date || b?.activity_date || b?.date_1)))[0] || null;
  const missingDates = selected.filter((row) => !isoDate(row?.start_date || row?.activity_date || row?.date_1)).length;
  return { total: selected.length, types: [...types.entries()].map(([label, value]) => ({ label, value })), next, attention: missingDates };
}

export async function loadInstructorActivities(api) {
  const result = await api.myData({ includeClosedForApprovals: true });
  return { rows: result?.rows || [], teamGroups: result?.teamGroups || [] };
}
