export const SCHEDULING_SEASON = 'school_2027';

export const BLOCKED_SCHEDULING_STATUSES = new Set([
  'סגור', 'closed', 'בוטל', 'cancelled', 'canceled', 'נמחק', 'deleted', 'inactive', 'לא פעיל'
]);

export function normalizeSchedulingStatus(value) {
  return String(value ?? '').trim().toLocaleLowerCase('he-IL');
}

export function hasAssignedInstructor(activity = {}) {
  return [activity.emp_id, activity.emp_id_2, activity.instructor_name, activity.instructor_name_2]
    .some((value) => String(value ?? '').trim());
}

export function isSchedulingActivityActive(activity = {}) {
  if (String(activity.activity_season ?? '').trim() !== SCHEDULING_SEASON) return false;
  return !BLOCKED_SCHEDULING_STATUSES.has(normalizeSchedulingStatus(activity.status ?? activity.activity_status));
}

export function isSchedulingBlockingAssignment(activity = {}) {
  return isSchedulingActivityActive(activity) && hasAssignedInstructor(activity);
}

export function isActivitySchedulingEligible(activity) {
  if (!activity || String(activity.activity_season ?? '').trim() !== SCHEDULING_SEASON) return false;
  const status = normalizeSchedulingStatus(activity.status ?? activity.activity_status);
  const type = String(activity.activity_type ?? activity.type ?? '').trim().toLocaleLowerCase('he-IL');
  return ['קורס', 'course', 'program'].includes(type)
    && ['פתוח', 'open'].includes(status)
    && !BLOCKED_SCHEDULING_STATUSES.has(status)
    && !hasAssignedInstructor(activity);
}

const text = (value) => String(value ?? '').trim();
const minutes = (value) => {
  if (!/^\d{1,2}:\d{2}(?::\d{2})?$/.test(text(value))) return Number.NaN;
  const [hours, mins] = text(value).split(':').map(Number);
  if (hours > 23 || mins > 59) return Number.NaN;
  return hours * 60 + mins;
};

function schedulingMeetings(activity = {}) {
  const cancelled = new Set([...(activity.cancelled_meeting_dates || activity._cancelledMeetingDates || [])]
    .map((value) => text(value).slice(0, 10))
    .filter(Boolean));
  const activeOnly = (meeting) => !cancelled.has(text(typeof meeting === 'string' ? meeting : meeting?.date).slice(0, 10));
  if (Array.isArray(activity.meetings) && activity.meetings.length) {
    return activity.meetings
      .filter((meeting) => text(typeof meeting === 'string' ? meeting : meeting?.date))
      .filter(activeOnly);
  }
  return Array.from({ length: 35 }, (_, index) => activity[`date_${index + 1}`])
    .filter((date) => text(date))
    .map((date) => ({ date }))
    .filter(activeOnly);
}

/** Single source of truth for activity data readiness (not matching policy). */
export function isCourseSchedulingReady(activity) {
  if (!activity || String(activity.activity_season ?? '').trim() !== SCHEDULING_SEASON) return false;
  const type = String(activity.activity_type ?? activity.type ?? '').trim().toLocaleLowerCase('he-IL');
  if (!['קורס', 'course', 'program'].includes(type)) return false;
  const status = normalizeSchedulingStatus(activity.status ?? activity.activity_status);
  if (!['פתוח', 'open'].includes(status) || BLOCKED_SCHEDULING_STATUSES.has(status)) return false;
  if (!text(activity.activity_name || activity.program_name || activity.name || activity.title)) return false;
  if (!text(activity.school) || !text(activity.school_address) || !text(activity.instruction_language)) return false;
  const start = minutes(activity.start_time);
  const end = minutes(activity.end_time);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return false;
  const meetings = schedulingMeetings(activity);
  return meetings.length > 0 && meetings.every((meeting) => {
    const meetingStart = minutes(meeting?.start_time || activity.start_time);
    const meetingEnd = minutes(meeting?.end_time || activity.end_time);
    return Number.isFinite(meetingStart) && Number.isFinite(meetingEnd) && meetingEnd > meetingStart;
  });
}

export function isCourseSchedulingInterfaceEligible(activity) {
  return isCourseSchedulingReady(activity);
}

function hasValidAvailabilityRule(rule = {}) {
  const start = minutes(rule.start_time);
  const end = minutes(rule.end_time);
  return !!rule.available && Number.isInteger(Number(rule.weekday))
    && Number(rule.weekday) >= 0 && Number(rule.weekday) <= 6
    && Number.isFinite(start) && Number.isFinite(end) && end > start;
}

/** Single source of truth for instructor data readiness (not course matching). */
export function isInstructorSchedulingReady(instructor, profile, rules = []) {
  const active = text(instructor?.active).toLowerCase();
  if (!['yes', 'true', '1'].includes(active)) return false;
  return !!text(instructor?.address)
    && !!text(profile?.gender)
    && Array.isArray(profile?.instruction_languages)
    && profile.instruction_languages.some((language) => text(language))
    && Array.isArray(rules)
    && rules.some(hasValidAvailabilityRule);
}

// A draft holds an instructor's calendar slot (spec section 21) without finalizing the
// assignment, so it must block overlapping suggestions the same way a real assignment does.
export function hasDraftInstructor(activity = {}) {
  return !!String(activity.draft_emp_id ?? '').trim();
}

export function isSchedulingDraftAssignment(activity = {}) {
  return isSchedulingActivityActive(activity) && hasDraftInstructor(activity);
}
