/**
 * Instructor resolved meetings — central client adapters over
 * av2_get_current_instructor_resolved_meetings (per-meeting SoT).
 */

import { isoDate } from '../instructor-utils.js';
import { SCHOOL_2027_END_DATE, SCHOOL_2027_START_DATE } from '../shared/summer-activity.js';

export const INSTRUCTOR_RESOLVED_MEETINGS_START = SCHOOL_2027_START_DATE;
export const INSTRUCTOR_RESOLVED_MEETINGS_END = SCHOOL_2027_END_DATE;

function text(value) {
  return String(value ?? '').trim();
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

export function normalizeResolvedMeeting(row = {}) {
  const meetingDate = isoDate(row.meeting_date || row.date);
  const rowId = text(row.row_id || row.RowID);
  return {
    ...row,
    row_id: rowId,
    RowID: rowId,
    meeting_date: meetingDate,
    date: meetingDate,
    meeting_no: Number(row.meeting_no) || null,
    activity_name: text(row.activity_name || row.program_name),
    school: text(row.school || row.single_school_name),
    authority: text(row.authority || row.authority_name),
    start_time: text(row.start_time).slice(0, 5),
    end_time: text(row.end_time).slice(0, 5),
    is_single_meeting_substitution: row.is_single_meeting_substitution === true
      || text(row.assignment_kind) === 'single_meeting_substitution',
    is_secondary_instructor: row.is_secondary_instructor === true,
    primary_resolved_emp_id: text(row.primary_resolved_emp_id),
    course_primary_emp_id: text(row.course_primary_emp_id)
  };
}

export function meetingsForActivity(meetings = [], activityId = '') {
  const id = text(activityId);
  return (Array.isArray(meetings) ? meetings : [])
    .map(normalizeResolvedMeeting)
    .filter((meeting) => text(meeting.row_id) === id)
    .sort((a, b) => text(a.meeting_date).localeCompare(text(b.meeting_date))
      || text(a.start_time).localeCompare(text(b.start_time)));
}

/** Collapse resolved meetings into one activity card per row_id. */
export function activitiesFromResolvedMeetings(meetings = [], enrichmentById = new Map()) {
  const byId = new Map();
  for (const raw of Array.isArray(meetings) ? meetings : []) {
    const meeting = normalizeResolvedMeeting(raw);
    if (!meeting.row_id || !meeting.meeting_date) continue;
    let entry = byId.get(meeting.row_id);
    if (!entry) {
      const enriched = enrichmentById.get(meeting.row_id) || {};
      entry = {
        ...enriched,
        ...meeting,
        row_id: meeting.row_id,
        RowID: meeting.row_id,
        resolved_meetings: [],
        instructor_meeting_scope: 'resolved'
      };
      byId.set(meeting.row_id, entry);
    }
    entry.resolved_meetings.push(meeting);
    if (meeting.is_single_meeting_substitution) entry.has_single_meeting_substitution = true;
  }

  return [...byId.values()].map((activity) => applyResolvedMeetingsToActivityRow(activity, activity.resolved_meetings));
}

/**
 * Restrict an activity row so drawer / schedule UIs only expose meetings that
 * belong to the signed-in instructor (critical for one-off substitutes).
 */
export function applyResolvedMeetingsToActivityRow(activity = {}, meetings = []) {
  const owned = meetingsForActivity(meetings.length ? meetings : (activity.resolved_meetings || []), activity.row_id || activity.RowID);
  const next = { ...activity };
  for (let index = 1; index <= 35; index += 1) {
    next[`date_${index}`] = '';
    next[`Date${index}`] = '';
  }
  owned.forEach((meeting, index) => {
    if (index >= 35) return;
    next[`date_${index + 1}`] = meeting.meeting_date;
    next[`Date${index + 1}`] = meeting.meeting_date;
  });
  next.meeting_schedule = owned.map((meeting) => ({
    date: meeting.meeting_date,
    meeting_no: meeting.meeting_no,
    start_time: meeting.start_time,
    end_time: meeting.end_time,
    performed: 'no',
    note: '',
    is_single_meeting_substitution: meeting.is_single_meeting_substitution
  }));
  next.resolved_meetings = owned;
  next.instructor_meeting_scope = 'resolved';
  next.start_date = owned[0]?.meeting_date || next.start_date || '';
  next.end_date = owned[owned.length - 1]?.meeting_date || next.end_date || '';
  next.activity_date = next.start_date;
  next.has_single_meeting_substitution = owned.some((meeting) => meeting.is_single_meeting_substitution);
  next.substitution_only = owned.length > 0
    && owned.every((meeting) => meeting.is_single_meeting_substitution)
    && !owned.some((meeting) => meeting.is_secondary_instructor);
  if (owned[0]?.start_time) next.start_time = owned[0].start_time;
  if (owned[0]?.end_time) next.end_time = owned[0].end_time;
  return next;
}

export function instructorUpcomingFromResolvedMeetings(meetings = [], { today = '', days = 7 } = {}) {
  const from = isoDate(today) || localTodayIso();
  const to = addIsoDays(from, days);
  return (Array.isArray(meetings) ? meetings : [])
    .map(normalizeResolvedMeeting)
    .filter((meeting) => meeting.meeting_date && meeting.meeting_date >= from && meeting.meeting_date <= to)
    .sort((a, b) => a.meeting_date.localeCompare(b.meeting_date)
      || text(a.start_time).localeCompare(text(b.start_time))
      || text(a.activity_name).localeCompare(text(b.activity_name), 'he'))
    .map((meeting) => ({
      row: meeting,
      date: meeting.meeting_date,
      activity_name: meeting.activity_name,
      school: meeting.school,
      authority: meeting.authority,
      start_time: meeting.start_time,
      end_time: meeting.end_time,
      is_single_meeting_substitution: meeting.is_single_meeting_substitution
    }));
}

export function nextMeetingFromResolvedMeetings(meetings = [], { today = '' } = {}) {
  const from = isoDate(today) || localTodayIso();
  return (Array.isArray(meetings) ? meetings : [])
    .map(normalizeResolvedMeeting)
    .filter((meeting) => meeting.meeting_date && meeting.meeting_date >= from)
    .sort((a, b) => a.meeting_date.localeCompare(b.meeting_date)
      || text(a.start_time).localeCompare(text(b.start_time)))
    .map((meeting) => ({
      row: meeting,
      date: meeting.meeting_date,
      activity_name: meeting.activity_name,
      school: meeting.school,
      authority: meeting.authority,
      start_time: meeting.start_time,
      end_time: meeting.end_time,
      is_single_meeting_substitution: meeting.is_single_meeting_substitution
    }))[0] || null;
}

export function resolvedMeetingsForDate(meetings = [], isoDateValue = '') {
  const target = isoDate(isoDateValue);
  return (Array.isArray(meetings) ? meetings : [])
    .map(normalizeResolvedMeeting)
    .filter((meeting) => meeting.meeting_date === target);
}

export function buildWorkScheduleRowsFromResolvedMeetings(meetings = [], enrichmentById = new Map()) {
  return activitiesFromResolvedMeetings(meetings, enrichmentById)
    .filter((activity) => Array.isArray(activity.resolved_meetings) && activity.resolved_meetings.length > 0)
    .map((activity) => {
      const dates = activity.resolved_meetings.map((meeting) => meeting.meeting_date).filter(Boolean).sort();
      return {
        activity,
        key: text(activity.row_id),
        name: text(activity.activity_name),
        activityType: text(activity.activity_type),
        manager: text(activity.activity_manager),
        authority: text(activity.authority),
        school: text(activity.school),
        instructorNames: [],
        grade: text(activity.grade || activity.class_group),
        contactName: text(activity.resolved_contact_name || activity.contact_name),
        contactPhone: text(activity.resolved_contact_phone || activity.contact_phone),
        dates,
        weekday: '',
        timeRange: activity.start_time && activity.end_time
          ? `${activity.start_time}–${activity.end_time}`
          : '',
        startDate: dates[0] || '',
        endDate: dates[dates.length - 1] || '',
        sessionsCount: dates.length,
        has_single_meeting_substitution: !!activity.has_single_meeting_substitution,
        substitution_only: !!activity.substitution_only
      };
    });
}
