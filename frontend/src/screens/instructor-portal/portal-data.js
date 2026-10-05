import { assignedToCurrentInstructor, currentInstructorIds, isoDate } from '../instructor-utils.js';
import { buildInstructorWorkScheduleRows, sortInstructorWorkScheduleRows } from '../shared/instructor-course-schedule-2027.js';
import { activityTypeDisplayLabel, normalizeActivityTypeKey } from '../shared/activity-options.js';
import {
  INSTRUCTOR_RESOLVED_MEETINGS_END,
  INSTRUCTOR_RESOLVED_MEETINGS_START,
  activitiesFromResolvedMeetings,
  applyResolvedMeetingsToActivityRow,
  buildWorkScheduleRowsFromResolvedMeetings,
  instructorUpcomingFromResolvedMeetings,
  nextMeetingFromResolvedMeetings,
  normalizeResolvedMeeting,
  resolvedMeetingsForDate
} from './resolved-meetings.js';

export function instructorActivities(rows, state) {
  const ids = currentInstructorIds(state);
  return (Array.isArray(rows) ? rows : []).filter((row) => assignedToCurrentInstructor(row, ids));
}

export function instructorScheduleRows(rows, state) {
  const assigned = instructorActivities(rows, state);
  return sortInstructorWorkScheduleRows(buildInstructorWorkScheduleRows(assigned), { instructorSelected: true });
}

export function activityMonth(row) {
  return isoDate(row?.start_date || row?.activity_date || row?.date_1).slice(0, 7);
}

function localTodayIso(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addIsoDays(value, days) {
  const iso = isoDate(value);
  if (!iso) return '';
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function activityCanAppearUpcoming(row) {
  const status = String(row?.status || '').trim().toLowerCase();
  return !new Set(['סגור', 'נמחק', 'בוטל', 'מבוטל', 'closed', 'deleted', 'cancelled', 'canceled']).has(status);
}

export function instructorActivityMeetingDates(row) {
  if (Array.isArray(row?.resolved_meetings) && row.resolved_meetings.length) {
    return [...new Set(row.resolved_meetings.map((meeting) => isoDate(meeting.meeting_date || meeting.date)).filter(Boolean))].sort();
  }
  const dates = [];
  for (let index = 1; index <= 35; index += 1) {
    dates.push(row?.[`date_${index}`], row?.[`Date${index}`]);
  }
  if (Array.isArray(row?.meeting_dates)) dates.push(...row.meeting_dates);
  const normalized = [...new Set(dates.map((value) => isoDate(value)).filter(Boolean))].sort();
  if (normalized.length) return normalized;
  const fallback = isoDate(row?.activity_date || row?.start_date);
  return fallback ? [fallback] : [];
}

function instructorMeetingOccurrences(rows, state, fromDate, toDate = '') {
  const from = isoDate(fromDate) || localTodayIso();
  const to = isoDate(toDate);
  const occurrences = [];
  instructorActivities(rows, state)
    .filter(activityCanAppearUpcoming)
    .forEach((row) => {
      instructorActivityMeetingDates(row).forEach((date) => {
        if (date < from || (to && date > to)) return;
        occurrences.push({
          row,
          date,
          activity_name: row?.activity_name || row?.activity || '',
          school: row?.school || '',
          authority: row?.authority || '',
          start_time: row?.start_time || '',
          end_time: row?.end_time || ''
        });
      });
    });
  return occurrences.sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare) return dateCompare;
    const timeCompare = String(a.start_time || '').localeCompare(String(b.start_time || ''));
    if (timeCompare) return timeCompare;
    return String(a.activity_name || '').localeCompare(String(b.activity_name || ''), 'he');
  });
}

export function instructorUpcomingMeetings(rows, state, { today = '', days = 7 } = {}) {
  if (Array.isArray(state?.resolvedMeetings) && state.resolvedMeetings.length) {
    return instructorUpcomingFromResolvedMeetings(state.resolvedMeetings, { today, days });
  }
  const from = isoDate(today) || localTodayIso();
  return instructorMeetingOccurrences(rows, state, from, addIsoDays(from, days));
}

export function nextInstructorMeeting(rows, state, { today = '' } = {}) {
  if (Array.isArray(state?.resolvedMeetings)) {
    return nextMeetingFromResolvedMeetings(state.resolvedMeetings, { today });
  }
  const from = isoDate(today) || localTodayIso();
  return instructorMeetingOccurrences(rows, state, from)[0] || null;
}

export function monthlyInstructorSummary(rows, state, month) {
  const sourceRows = Array.isArray(state?.resolvedActivities) && state.resolvedActivities.length
    ? state.resolvedActivities
    : instructorActivities(rows, state);
  const selected = sourceRows.filter((row) => activityMonth(row) === month);
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
  const missingDates = sourceRows.filter((row) => !isoDate(row?.start_date || row?.activity_date || row?.date_1)).length;
  return { total: selected.length, types: [...types.entries()].map(([label, value]) => ({ label, value })), next, attention: missingDates };
}

function enrichmentMapFromRows(rows = []) {
  return new Map((Array.isArray(rows) ? rows : [])
    .map((row) => [String(row?.row_id || row?.RowID || '').trim(), row])
    .filter(([id]) => id));
}

export async function loadInstructorActivities(api) {
  const result = await api.myData({ includeClosedForApprovals: true });
  return { rows: result?.rows || [], teamGroups: result?.teamGroups || [] };
}

export async function loadInstructorPortalSchedule(api, { fromDate = INSTRUCTOR_RESOLVED_MEETINGS_START, toDate = INSTRUCTOR_RESOLVED_MEETINGS_END } = {}) {
  const [activityData, meetings] = await Promise.all([
    loadInstructorActivities(api),
    api.instructorResolvedMeetings({ fromDate, toDate })
  ]);
  const enrichmentById = enrichmentMapFromRows(activityData.rows);
  const normalizedMeetings = (Array.isArray(meetings) ? meetings : []).map(normalizeResolvedMeeting);
  const resolvedActivities = activitiesFromResolvedMeetings(normalizedMeetings, enrichmentById);
  return {
    rows: activityData.rows,
    teamGroups: activityData.teamGroups,
    resolvedMeetings: normalizedMeetings,
    resolvedActivities
  };
}

export function portalResolvedActivities(data, state = {}) {
  if (Array.isArray(data?.resolvedActivities)) return data.resolvedActivities;
  if (Array.isArray(state?.resolvedActivities)) return state.resolvedActivities;
  return instructorActivities(data?.rows, state);
}

export function portalWorkScheduleRows(data, state = {}) {
  const meetings = data?.resolvedMeetings || state?.resolvedMeetings;
  if (Array.isArray(meetings)) {
    return sortInstructorWorkScheduleRows(
      buildWorkScheduleRowsFromResolvedMeetings(meetings, enrichmentMapFromRows(data?.rows || [])),
      { instructorSelected: true }
    );
  }
  return instructorScheduleRows(data?.rows, state);
}

export function portalActivityForDrawer(activityId, data = {}, state = {}) {
  const id = String(activityId || '').trim();
  const meetings = (data?.resolvedMeetings || state?.resolvedMeetings || [])
    .filter((meeting) => String(meeting?.row_id || '').trim() === id);
  const base = (data?.resolvedActivities || state?.resolvedActivities || data?.rows || [])
    .find((row) => String(row?.row_id || row?.RowID || '').trim() === id)
    || meetings[0]
    || null;
  if (!base) return null;
  if (!meetings.length) return applyResolvedMeetingsToActivityRow(base, base.resolved_meetings || []);
  return applyResolvedMeetingsToActivityRow(base, meetings);
}

export function portalMeetingsForDate(data = {}, state = {}, isoDateValue = '') {
  const meetings = data?.resolvedMeetings || state?.resolvedMeetings;
  if (Array.isArray(meetings)) return resolvedMeetingsForDate(meetings, isoDateValue);
  return [];
}

export async function loadInstructorAttendanceDates(api, query) {
  try {
    return await api.instructorAttendanceDates(query);
  } catch {
    return [];
  }
}

export {
  applyResolvedMeetingsToActivityRow,
  instructorUpcomingFromResolvedMeetings,
  nextMeetingFromResolvedMeetings,
  resolvedMeetingsForDate
};
