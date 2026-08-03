import { supabase } from '../supabase-client.js';
import { activityMeetings } from './instructor-scheduling-load.js';

const text = (value) => String(value ?? '').trim();
const idOf = (row) => text(row?.row_id || row?.RowID || row?.id);

// How far back completed-meeting evidence is worth reading. Courses in this rolling
// scheduler run for roughly two weeks, so 90 days is a generous safety margin without
// pulling the full, ever-growing completion-approval history on every screen load.
const LOOKBACK_DAYS = 90;

function emptyMeetingState(error = '') {
  return { approvedDates: new Map(), cancelledDates: new Map(), loaded: false, error };
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

// Priority order (spec section 10): an approved completion upload first; otherwise a
// meeting date that has already passed and was not marked cancelled; a cancellation
// marker always removes a date from the count regardless of the other two signals.
export function meetingsCompletedForCourse(course, meetingState = {}) {
  // When meeting-state load failed, do not invent a completed count from partial data.
  if (!meetingState?.loaded) return null;
  const courseId = idOf(course);
  const approved = meetingState.approvedDates?.get(courseId) || new Set();
  const cancelled = meetingState.cancelledDates?.get(courseId) || new Set();
  const today = new Date().toISOString().slice(0, 10);
  const dates = new Set(activityMeetings(course).map((meeting) => text(meeting.date)).filter(Boolean));
  let completed = 0;
  for (const date of dates) {
    if (cancelled.has(date)) continue;
    if (approved.has(date) || date < today) completed += 1;
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
