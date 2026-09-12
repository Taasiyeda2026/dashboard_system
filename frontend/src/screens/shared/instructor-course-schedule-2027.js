// Single source of truth for the school_2027 "סידור עבודה" (work schedule):
// every activity assigned to a real instructor with at least one valid activity
// date is represented once, regardless of activity type or optional metadata.
import {
  getActivityInstructorNames,
  isValidInstructorName,
  getActivityScheduleDates,
  getActivityName,
  getActivityAuthorityName,
  getActivitySchoolDisplayName,
  getActivityGradeLabel,
  getActivityTimeRange
} from './operations-activity-helpers.js';
import { getActivityPeriodKey, ACTIVITY_SEASON_SCHOOL_2027 } from './summer-activity.js';
import { formatDateHeWithWeekday } from './format-date.js';
import { activityTypeDisplayLabel } from './activity-options.js';

const PLACEHOLDER_INSTRUCTOR_NAMES = new Set(['ללא מדריך', 'טרם שובץ']);

function isRealInstructorName(name) {
  return isValidInstructorName(name) && !PLACEHOLDER_INSTRUCTOR_NAMES.has(String(name || '').trim());
}

export function getWorkScheduleInstructorNames(activity) {
  return getActivityInstructorNames(activity).filter(isRealInstructorName);
}

/** Sorted valid activity dates from date_1..date_35, with the shared primary-date fallback. */
export function getWorkScheduleDates(activity) {
  return getActivityScheduleDates(activity).slice().sort();
}

export function getWorkScheduleFixedWeekday(dates = []) {
  if (!Array.isArray(dates) || !dates.length) return '';
  const weekdays = new Set(dates.map((date) => formatDateHeWithWeekday(date).split(' · ')[0]));
  return weekdays.size === 1 ? [...weekdays][0] : '';
}

/** The only inclusion rule for the school_2027 work schedule. */
export function isActivityAssignedForWorkSchedule(activity) {
  if (!activity || typeof activity !== 'object') return false;
  try {
    return getActivityPeriodKey(activity) === ACTIVITY_SEASON_SCHOOL_2027
      && getWorkScheduleInstructorNames(activity).length > 0
      && getActivityScheduleDates(activity).length > 0;
  } catch {
    return false;
  }
}

function normalizeSuffixMatchText(value) {
  return String(value || '')
    .trim()
    .replace(/[״"]/g, '')
    .replace(/[׳']/g, '')
    .replace(/[‐-―]/g, '-')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function cleanActivitySchoolName(schoolName, authorityName) {
  const text = String(schoolName || '').trim();
  const suffix = String(authorityName || '').trim();
  if (!text || !suffix) return text;
  if (!normalizeSuffixMatchText(text).endsWith(normalizeSuffixMatchText(suffix))) return text;
  const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const cleaned = text.replace(new RegExp(`\\s*[-–,]?\\s*${escaped}\\s*$`), '').trim();
  return cleaned.length >= 2 ? cleaned : text;
}

function buildActivityRowKey(activity = {}) {
  return [activity.id, activity.activity_id, activity.uuid, activity.RowID, activity.row_id, getActivityName(activity), getActivityAuthorityName(activity)]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .join('|');
}

export function buildWorkScheduleRow(activity) {
  const dates = getWorkScheduleDates(activity);
  const activityName = getActivityName(activity);
  const authorityName = getActivityAuthorityName(activity);
  const schoolName = getActivitySchoolDisplayName(activity);
  const authority = authorityName === 'לא משויך' ? '' : authorityName;
  const rawActivityType = String(activity?.activity_type ?? activity?.type ?? '').trim();
  return {
    activity,
    key: buildActivityRowKey(activity),
    name: activityName === 'ללא שם' ? '' : activityName,
    activityType: activityTypeDisplayLabel(rawActivityType) || rawActivityType,
    authority,
    school: schoolName === 'לא משויך' ? '' : cleanActivitySchoolName(schoolName, authority),
    instructorNames: getWorkScheduleInstructorNames(activity),
    grade: getActivityGradeLabel(activity) || '',
    contactName: String(activity?.resolved_contact_name ?? activity?.resolved_school_2027_contact?.name ?? activity?.contact_name ?? '').trim(),
    contactPhone: String(activity?.resolved_contact_phone ?? activity?.resolved_school_2027_contact?.phone ?? activity?.contact_phone ?? activity?.phone ?? '').trim(),
    dates,
    weekday: getWorkScheduleFixedWeekday(dates),
    timeRange: getActivityTimeRange(activity),
    startDate: dates[0] || '',
    endDate: dates[dates.length - 1] || '',
    sessionsCount: dates.length
  };
}

/** The filtered and mapped activity list shared by the table and print views. */
export function buildInstructorWorkScheduleRows(activities = []) {
  return (Array.isArray(activities) ? activities : [])
    .filter(isActivityAssignedForWorkSchedule)
    .map(buildWorkScheduleRow);
}

export function sortInstructorWorkScheduleRows(rows = [], { instructorSelected = false } = {}) {
  return rows.slice().sort((a, b) => {
    if (!instructorSelected) {
      const instructorCmp = String(a.instructorNames?.[0] || '').localeCompare(String(b.instructorNames?.[0] || ''), 'he');
      if (instructorCmp !== 0) return instructorCmp;
    }
    const startCmp = String(a.startDate || '9999-99-99').localeCompare(String(b.startDate || '9999-99-99'));
    if (startCmp !== 0) return startCmp;
    return String(a.name || '').localeCompare(String(b.name || ''), 'he');
  });
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

/** "06.09.26-20.12.26" — compact DD.MM.YY activity-date range. */
export function formatWorkScheduleRangeShort(fromIso, toIso) {
  const format = (iso) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return match ? `${pad2(match[3])}.${pad2(match[2])}.${match[1].slice(2)}` : '';
  };
  const from = format(fromIso);
  const to = format(toIso);
  if (!from && !to) return '';
  return `${from}-${to}`;
}
