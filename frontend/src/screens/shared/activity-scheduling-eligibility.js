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
  const isCourse = ['קורס', 'course', 'program'].includes(type);
  const isOpen = ['פתוח', 'open'].includes(status);
  return isCourse && isOpen && !BLOCKED_SCHEDULING_STATUSES.has(status) && !hasAssignedInstructor(activity);
}

const text = (value) => String(value ?? '').trim();

function schedulingMeetings(activity = {}) {
  const cancelled = new Set((activity.cancelled_meeting_dates || activity._cancelledMeetingDates || [])
    .map((value) => text(value).slice(0, 10)));
  const meetings = Array.isArray(activity.meetings) && activity.meetings.length
    ? activity.meetings
    : Array.from({ length: 35 }, (_, index) => activity[`date_${index + 1}`])
    .filter((date) => text(date))
    .map((date) => ({ date, start_time: activity.start_time, end_time: activity.end_time }));
  return meetings.filter((meeting) => !cancelled.has(text(meeting?.date).slice(0, 10)));
}

function timeMinutes(value) {
  const match = text(value).match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] || 0);
  if (!Number.isInteger(hours) || hours < 0 || hours > 23
    || !Number.isInteger(minutes) || minutes < 0 || minutes > 59
    || !Number.isInteger(seconds) || seconds < 0 || seconds > 59) return null;
  return (hours * 60) + minutes + (seconds / 60);
}

function isValidTimeRange(startValue, endValue) {
  const start = timeMinutes(startValue);
  const end = timeMinutes(endValue);
  return start != null && end != null && end > start;
}

function hasValidSchoolId(value) {
  const schoolId = Number(text(value));
  return Number.isInteger(schoolId) && schoolId > 0;
}

/** Single source of truth for data allowed into the scheduling UI and engine. */
export function activitySchedulingReadinessMissingFields(activity = {}) {
  const missing = [];
  if (!text(activity.activity_name || activity.program_name || activity.name || activity.title)) missing.push('שם קורס');
  if (!hasValidSchoolId(activity.school_id)) missing.push('בית ספר');
  if (!text(activity.school_address)) missing.push('כתובת בית ספר תקינה');
  const meetings = schedulingMeetings(activity);
  if (!meetings.length) missing.push('תאריכי המפגשים');
  if (!text(activity.start_time) || meetings.some((meeting) => !text(meeting.start_time || activity.start_time))) missing.push('שעת התחלה');
  if (!text(activity.end_time) || meetings.some((meeting) => !text(meeting.end_time || activity.end_time))) missing.push('שעת סיום');
  if (meetings.length && meetings.some((meeting) => !isValidTimeRange(meeting.start_time || activity.start_time, meeting.end_time || activity.end_time))) missing.push('טווח שעות תקין');
  if (!text(activity.instruction_language)) missing.push('שפת הדרכה');
  return [...new Set(missing)];
}

export function isSchedulingReadyActivity(activity = {}) {
  return isActivitySchedulingEligible(activity) && activitySchedulingReadinessMissingFields(activity).length === 0;
}

export function isValidSchedulingAvailabilityRule(rule = {}) {
  const available = rule.available === true || ['yes', 'true', '1'].includes(text(rule.available).toLowerCase());
  const weekdayText = text(rule.weekday);
  const weekday = Number(weekdayText);
  return available && weekdayText !== '' && Number.isInteger(weekday) && weekday >= 0 && weekday <= 6
    && isValidTimeRange(rule.start_time, rule.end_time);
}

export function instructorSchedulingReadinessMissingFields(instructor = {}, profile = null, rules = []) {
  const missing = [];
  const active = ['yes', 'true', '1'].includes(text(instructor.active).toLowerCase());
  if (!active) missing.push('מדריך פעיל');
  if (!text(instructor.address)) missing.push('כתובת');
  if (!text(profile?.gender)) missing.push('מגדר');
  if (!Array.isArray(profile?.instruction_languages) || !profile.instruction_languages.some(text)) missing.push('שפות הדרכה');
  if (!Array.isArray(rules) || !rules.some(isValidSchedulingAvailabilityRule)) missing.push('זמינות שבועית תקינה');
  return missing;
}

export function isSchedulingReadyInstructor(instructor = {}, profile = null, rules = []) {
  return instructorSchedulingReadinessMissingFields(instructor, profile, rules).length === 0;
}

// The interface and engine intentionally share the same readiness gate.
export function isCourseSchedulingInterfaceEligible(activity) {
  return isSchedulingReadyActivity(activity);
}

// A draft holds an instructor's calendar slot (spec section 21) without finalizing the
// assignment, so it must block overlapping suggestions the same way a real assignment does.
export function hasDraftInstructor(activity = {}) {
  return !!String(activity.draft_emp_id ?? '').trim();
}

export function isSchedulingDraftAssignment(activity = {}) {
  return isSchedulingActivityActive(activity) && hasDraftInstructor(activity);
}
