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

// Entry criteria for the scheduling interface itself (spec section 4): a course only
// needs a start date and a start time to appear. Missing everything else (address,
// language, availability...) surfaces as a warning inside the interface instead of
// hiding the course. This is intentionally broader than isActivitySchedulingEligible
// above, which still gates the narrower "open and not yet assigned" matching flow.
export function isCourseSchedulingInterfaceEligible(activity) {
  if (!activity || String(activity.activity_season ?? '').trim() !== SCHEDULING_SEASON) return false;
  const type = String(activity.activity_type ?? activity.type ?? '').trim().toLocaleLowerCase('he-IL');
  if (!['קורס', 'course', 'program'].includes(type)) return false;
  const status = normalizeSchedulingStatus(activity.status ?? activity.activity_status);
  if (BLOCKED_SCHEDULING_STATUSES.has(status)) return false;
  return !!String(activity.start_date ?? '').trim() && !!String(activity.start_time ?? '').trim();
}

// A draft holds an instructor's calendar slot (spec section 21) without finalizing the
// assignment, so it must block overlapping suggestions the same way a real assignment does.
export function hasDraftInstructor(activity = {}) {
  return !!String(activity.draft_emp_id ?? '').trim();
}

export function isSchedulingDraftAssignment(activity = {}) {
  return isSchedulingActivityActive(activity) && hasDraftInstructor(activity);
}
