export const SCHEDULING_SEASON = 'school_2027';

const BLOCKED_SCHEDULING_STATUSES = new Set([
  'סגור', 'closed', 'בוטל', 'cancelled', 'canceled', 'נמחק', 'deleted'
]);

export function normalizeSchedulingStatus(value) {
  return String(value ?? '').trim().toLocaleLowerCase('he-IL');
}

export function isActivitySchedulingEligible(activity) {
  if (!activity || String(activity.activity_season ?? '').trim() !== SCHEDULING_SEASON) return false;
  const status = normalizeSchedulingStatus(activity.status ?? activity.activity_status);
  const type = String(activity.activity_type ?? activity.type ?? '').trim().toLocaleLowerCase('he-IL');
  const isCourse = ['קורס', 'course', 'program'].includes(type);
  const isOpen = ['פתוח', 'open'].includes(status);
  const assigned = [activity.emp_id, activity.instructor_name].some((value) => String(value ?? '').trim());
  return isCourse && isOpen && !BLOCKED_SCHEDULING_STATUSES.has(status) && !assigned;
}
