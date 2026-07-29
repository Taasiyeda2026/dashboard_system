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
  return !BLOCKED_SCHEDULING_STATUSES.has(status);
}

