import { israelTodayIso } from './course-scheduling-meetings.js';

const asDate = value => String(value ?? '').trim().slice(0, 10);
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value);

/** Minimum lead time for new, undated course recommendations: fourteen calendar
 * days in Asia/Jerusalem. Official dates/approved assignments are not shifted. */
export const UNDATED_COURSE_LEAD_DAYS = 14;

export function earliestUndatedCourseStart(today = '') {
  const reference = asDate(today);
  const israelDate = validDate(reference) ? reference : israelTodayIso();
  const date = new Date(`${israelDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + UNDATED_COURSE_LEAD_DAYS);
  return date.toISOString().slice(0, 10);
}

/** Source data only: neither a draft proposal nor a planning row is an
 * officially fixed school date. */
export function activityHasOfficialCourseDate(activity = {}) {
  if (validDate(asDate(activity?.start_date))) return true;
  for (let n = 1; n <= 35; n += 1) {
    if (validDate(asDate(activity?.[`date_${n}`]))) return true;
  }
  return false;
}

export function undatedProposalNeedsNewStart(row = {}, activity = {}, today = '') {
  if (!['proposal', 'fixed-proposal'].includes(String(row?.kind ?? ''))) return false;
  if (activityHasOfficialCourseDate(activity)) return false;
  if (activity?.emp_id != null || activity?.emp_id_2 != null || activity?.instructor_assignment_locked === true) return false;
  if (row?.planningLocked === true || row?.lockedOption != null) return false;
  const start = asDate(row?.startDate || row?.meetings?.[0]?.date);
  return validDate(start) && start < earliestUndatedCourseStart(today);
}
