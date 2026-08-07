import { supabase } from '../supabase-client.js';

const text = (value) => String(value ?? '').trim();
const idOf = (row) => text(row?.row_id || row?.RowID || row?.id);

// How far back completed-meeting evidence is worth reading. Courses in this rolling
// scheduler run for roughly two weeks, so 90 days is a generous safety margin without
// pulling the full, ever-growing completion-approval history on every screen load.
const LOOKBACK_DAYS = 90;
const ISRAEL_TZ = 'Asia/Jerusalem';

function emptyMeetingState(error = '') {
  return { approvedDates: new Map(), cancelledDates: new Map(), loaded: false, error };
}

/** Current calendar date (YYYY-MM-DD) in Asia/Jerusalem. */
export function israelTodayIso(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ISRAEL_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}

/** Current HH:MM in Asia/Jerusalem. */
export function israelNowTime(now = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: ISRAEL_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(now);
}

function meetingEndPassedInIsrael(meetingDate, endTime, now = new Date()) {
  const date = text(meetingDate).slice(0, 10);
  const end = text(endTime).slice(0, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(end)) return false;
  const today = israelTodayIso(now);
  if (date < today) return true;
  if (date > today) return false;
  return end <= israelNowTime(now);
}

// Reuses the two data sources the spec calls out (approved completion uploads, manual
// cancellation markers) instead of inventing a parallel "meetings done" counter.
export async function loadCourseMeetingState() {
  if (!supabase) return emptyMeetingState('no_supabase_client');
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10);
  const [approvalsResult, cancellationsResult] = await Promise.all([
    supabase.from('activity_completion_approval_uploads').select('activity_row_id,activity_date').eq('status', 'approved').gte('activity_date', cutoff),
    supabase.from('course_meeting_cancellations').select('activity_id,meeting_date')
  ]);
  const error = approvalsResult.error || cancellationsResult.error;
  if (error) return emptyMeetingState(String(error.message || error));

  const approvedDates = new Map();
  for (const row of approvalsResult.data || []) {
    const ids = text(row.activity_row_id).split(',').map((value) => value.trim()).filter(Boolean);
    for (const id of ids) {
      if (!(approvedDates.get(id) || new Set()).size) approvedDates.set(id, new Set());
      approvedDates.get(id).add(text(row.activity_date));
    }
  }
  const cancelledDates = new Map();
  for (const row of cancellationsResult.data || []) {
    const id = text(row.activity_id);
    if (!cancelledDates.has(id)) cancelledDates.set(id, new Set());
    cancelledDates.get(id).add(text(row.meeting_date));
  }
  return { approvedDates, cancelledDates, loaded: true, error: '' };
}

export function attachCancelledMeetingsToActivities(activities = [], meetingState = {}) {
  const cancelled = meetingState?.cancelledDates || new Map();
  return (activities || []).map((activity) => {
    const id = idOf(activity);
    const dates = cancelled.get(id);
    if (!dates?.size) return activity;
    return { ...activity, cancelled_meeting_dates: [...dates] };
  });
}

// Priority order: an approved completion upload first; otherwise a meeting whose
// Asia/Jerusalem date and end time have already passed and was not marked cancelled.
// A cancellation marker always removes a date from the count.
export function meetingsCompletedForCourse(course, meetingState = {}, now = new Date()) {
  // When meeting-state load failed, do not invent a completed count from partial data.
  if (!meetingState?.loaded) return null;
  const courseId = idOf(course);
  const approved = meetingState.approvedDates?.get(courseId) || new Set();
  const cancelled = meetingState.cancelledDates?.get(courseId) || new Set();
  // Count against official meeting list (including cancelled markers for exclusion),
  // not the filtered calendar list which already drops cancellations.
  const rawMeetings = Array.isArray(course?.meetings)
    ? course.meetings
    : Array.from({ length: 35 }, (_, index) => course?.[`date_${index + 1}`])
      .filter(Boolean)
      .map((date) => ({ date, start_time: course?.start_time, end_time: course?.end_time }));
  const meetings = rawMeetings
    .map((meeting) => (typeof meeting === 'string'
      ? { date: meeting, start_time: course?.start_time, end_time: course?.end_time }
      : meeting))
    .filter((meeting) => meeting?.date);
  let completed = 0;
  for (const meeting of meetings) {
    const date = text(meeting.date).slice(0, 10);
    if (cancelled.has(date)) continue;
    if (approved.has(date) || meetingEndPassedInIsrael(date, meeting.end_time || course?.end_time, now)) {
      completed += 1;
    }
  }
  return completed;
}

// The three-tier rule from spec section 11: 0 meetings -> regular change allowed,
// 1 -> significant-improvement change with an explicit warning, 2+ -> locked, only the
// separate "operational replacement" action may change the instructor.
export function courseMeetingStage(meetingsCompleted) {
  if (meetingsCompleted >= 2) return 'locked';
  if (meetingsCompleted === 1) return 'one_completed';
  return 'not_started';
}
