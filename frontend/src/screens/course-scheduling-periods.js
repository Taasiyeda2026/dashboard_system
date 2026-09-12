export const COURSE_SCHEDULING_PERIODS = Object.freeze({
  first: Object.freeze({ key: 'first', label: "מחצית א'", start: '2026-09-01', end: '2027-01-29' }),
  second: Object.freeze({ key: 'second', label: "מחצית ב'", start: '2027-01-31', end: '2027-06-30' })
});

export const DEFAULT_COURSE_SCHEDULING_PERIOD_KEY = 'first';

const text = (value) => String(value ?? '').trim();

export function resolveCourseSchedulingPeriod(key = DEFAULT_COURSE_SCHEDULING_PERIOD_KEY) {
  return COURSE_SCHEDULING_PERIODS[text(key)] || COURSE_SCHEDULING_PERIODS[DEFAULT_COURSE_SCHEDULING_PERIOD_KEY];
}

export function isDateInCourseSchedulingPeriod(date, periodKey = DEFAULT_COURSE_SCHEDULING_PERIOD_KEY) {
  const value = text(date).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const period = resolveCourseSchedulingPeriod(periodKey);
  return value >= period.start && value <= period.end;
}

export function filterMeetingsByCourseSchedulingPeriod(meetings = [], periodKey = DEFAULT_COURSE_SCHEDULING_PERIOD_KEY) {
  return (meetings || []).filter((meeting) => isDateInCourseSchedulingPeriod(meeting?.date || meeting, periodKey));
}

/** Keep activity-to-semester assignment identical to the scheduling board: meeting dates decide. */
export function activityBelongsToCourseSchedulingPeriod(activity = {}, periodKey = DEFAULT_COURSE_SCHEDULING_PERIOD_KEY) {
  const meetings = Array.isArray(activity?.meeting_dates)
    ? activity.meeting_dates
    : Array.from({ length: 35 }, (_, index) => activity?.[`date_${index + 1}`]);
  return filterMeetingsByCourseSchedulingPeriod(meetings, periodKey).length > 0;
}

export function periodOptions() {
  return Object.values(COURSE_SCHEDULING_PERIODS);
}
