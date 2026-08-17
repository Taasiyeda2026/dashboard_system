// Single source of truth for the school_2027 "סידור עבודה" (work schedule) tab:
// which courses are ready to hand to an instructor, and the per-course fields
// both the on-screen compact table and the print module render from. Both
// consumers must call buildReadyCourseScheduleRows on the same activities
// array so a course can never appear in one output and not the other.
import {
  getActivityInstructorNames,
  isValidInstructorName,
  getActivityScheduleDates,
  getActivityName,
  getActivityAuthorityName,
  getActivitySchoolDisplayName,
  hasActivitySchoolOrFrame,
  getActivityGradeLabel,
  getActivityTimeRange,
  isActivityDeleted
} from './operations-activity-helpers.js';
import { getActivityPeriodKey, ACTIVITY_SEASON_SCHOOL_2027 } from './summer-activity.js';
import { formatTimeShort, formatDateHeWithWeekday } from './format-date.js';

const COURSE_ACTIVITY_TYPES = new Set(['course', 'program', 'קורס', 'תוכנית']);
const CANCELLED_STATUS_VALUES = new Set(['בוטל', 'cancelled', 'canceled']);
// Beyond the generic invalid-instructor placeholders shared with every other
// screen (isValidInstructorName), a course whose instructor field literally
// holds one of these scheduling placeholders is not actually assigned yet.
const PLACEHOLDER_INSTRUCTOR_NAMES = new Set(['ללא מדריך', 'טרם שובץ']);

function isCourseTypeActivity(activity) {
  return COURSE_ACTIVITY_TYPES.has(String(activity?.activity_type ?? activity?.type ?? '').trim().toLowerCase());
}

function isCourseCancelledOrDeleted(activity) {
  if (isActivityDeleted(activity)) return true;
  return CANCELLED_STATUS_VALUES.has(String(activity?.status || '').trim().toLowerCase());
}

function isReadyInstructorName(name) {
  return isValidInstructorName(name) && !PLACEHOLDER_INSTRUCTOR_NAMES.has(String(name || '').trim());
}

export function getCourseReadyInstructorNames(activity) {
  return getActivityInstructorNames(activity).filter(isReadyInstructorName);
}

function normalizeReadyDate(value) {
  const raw = String(value ?? '').trim();
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  return match ? match[1] : '';
}

/** Declared session count, from the fields the add/edit activity form itself persists. Not derived from counting date columns — an undeclared count must not silently match whatever dates happen to be filled in. */
function getDeclaredSessionsCount(activity) {
  const validCount = (value) => {
    const count = Number(value);
    return Number.isInteger(count) && count >= 1 && count <= 35 ? count : null;
  };
  return validCount(activity?.sessions) ?? validCount(activity?.meetings_total);
}

/** Sorted ISO meeting dates read via the shared date_1..date_35 reader (already drops non-ISO values, so "invalid dates" never reach this list). */
export function getCourseMeetingDates(activity) {
  return getActivityScheduleDates(activity).slice().sort();
}

export function getCourseFixedWeekday(dates = []) {
  if (!Array.isArray(dates) || !dates.length) return '';
  const weekdays = new Set(dates.map((date) => formatDateHeWithWeekday(date).split(' · ')[0]));
  return weekdays.size === 1 ? [...weekdays][0] : '';
}

// getActivityName/getActivityAuthorityName fall back to sentinel display text
// ("ללא שם" / "לא משויך") instead of empty strings, so presence is checked by
// comparing against those exact fallbacks rather than truthiness.
function hasRequiredIdentityFields(activity) {
  return getActivityName(activity) !== 'ללא שם'
    && getActivityAuthorityName(activity) !== 'לא משויך'
    && hasActivitySchoolOrFrame(activity);
}

export function isCourseReadyForWorkSchedule(activity) {
  if (!activity || typeof activity !== 'object') return false;
  try {
    if (getActivityPeriodKey(activity) !== ACTIVITY_SEASON_SCHOOL_2027) return false;
    if (!isCourseTypeActivity(activity)) return false;
    if (isCourseCancelledOrDeleted(activity)) return false;
    if (!getCourseReadyInstructorNames(activity).length) return false;
    if (!hasRequiredIdentityFields(activity)) return false;

    const dates = getActivityScheduleDates(activity);
    if (!dates.length) return false;
    if (new Set(dates).size !== dates.length) return false; // no duplicate meeting dates

    const declaredSessions = getDeclaredSessionsCount(activity);
    if (declaredSessions === null || dates.length !== declaredSessions) return false;

    const sortedDates = dates.slice().sort();
    const startDate = normalizeReadyDate(activity?.start_date ?? activity?.date_start);
    const endDate = normalizeReadyDate(activity?.end_date ?? activity?.date_end);
    if (!startDate || startDate !== sortedDates[0]) return false;
    if (!endDate || endDate !== sortedDates[sortedDates.length - 1]) return false;

    const startTime = formatTimeShort(activity?.start_time ?? activity?.StartTime);
    const endTime = formatTimeShort(activity?.end_time ?? activity?.EndTime);
    if (!startTime || !endTime || !(endTime > startTime)) return false;

    return true;
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

// Mirrors operations-management.js's getActivitySchoolDisplayNameClean so a
// course's school name reads identically in the old per-meeting views and
// this course-level table/print (e.g. "עידן בנימינה" -> "עידן" under "בנימינה").
function cleanCourseSchoolName(schoolName, authorityName) {
  const text = String(schoolName || '').trim();
  const suffix = String(authorityName || '').trim();
  if (!text || !suffix) return text;
  if (!normalizeSuffixMatchText(text).endsWith(normalizeSuffixMatchText(suffix))) return text;
  const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const cleaned = text.replace(new RegExp(`\\s*[-–,]?\\s*${escaped}\\s*$`), '').trim();
  return cleaned.length >= 2 ? cleaned : text;
}

function buildCourseRowKey(activity = {}) {
  return [activity.id, activity.activity_id, activity.uuid, activity.RowID, activity.row_id, getActivityName(activity), getActivityAuthorityName(activity)]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .join('|');
}

export function buildCourseScheduleRow(activity) {
  const dates = getCourseMeetingDates(activity);
  const authority = getActivityAuthorityName(activity);
  return {
    activity,
    key: buildCourseRowKey(activity),
    name: getActivityName(activity),
    authority,
    school: cleanCourseSchoolName(getActivitySchoolDisplayName(activity), authority),
    instructorNames: getCourseReadyInstructorNames(activity),
    grade: getActivityGradeLabel(activity) || '',
    contactName: String(activity?.resolved_contact_name ?? activity?.resolved_school_2027_contact?.name ?? activity?.contact_name ?? '').trim(),
    contactPhone: String(activity?.resolved_contact_phone ?? activity?.resolved_school_2027_contact?.phone ?? activity?.contact_phone ?? activity?.phone ?? '').trim(),
    dates,
    weekday: getCourseFixedWeekday(dates),
    timeRange: getActivityTimeRange(activity),
    startDate: dates[0] || '',
    endDate: dates[dates.length - 1] || '',
    sessionsCount: dates.length
  };
}

/** The one filtered+mapped list every consumer (table, print) must render from. */
export function buildReadyCourseScheduleRows(activities = []) {
  return (Array.isArray(activities) ? activities : [])
    .filter(isCourseReadyForWorkSchedule)
    .map(buildCourseScheduleRow);
}

export function sortReadyCourseScheduleRows(rows = [], { instructorSelected = false } = {}) {
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

/** "06.09.26-20.12.26" — compact DD.MM.YY range for the on-screen table's period column. */
export function formatCourseScheduleRangeShort(fromIso, toIso) {
  const format = (iso) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return match ? `${pad2(match[3])}.${pad2(match[2])}.${match[1].slice(2)}` : '';
  };
  const from = format(fromIso);
  const to = format(toIso);
  if (!from && !to) return '';
  return `${from}-${to}`;
}
