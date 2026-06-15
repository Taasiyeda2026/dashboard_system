import { getActivityDateColumns } from './format-date.js';
import { isSummerActivity, normalizeActivitySeason, ACTIVITY_SEASON_SUMMER_2026, ACTIVITY_SEASON_SCHOOL_2027 } from './summer-activity.js';

const INVALID_INSTRUCTOR_NAMES = new Set(['-', 'לא משויך', 'ללא שיוך']);

export function parseLinkedSchoolsJson(row) {
  const raw = row?.linked_schools_json;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.startsWith('[')) {
    try { return JSON.parse(raw); } catch (_) { return []; }
  }
  return [];
}

export function getActivitySchoolNames(row) {
  const names = new Set();
  parseLinkedSchoolsJson(row).forEach((s) => {
    const n = String(s?.school_name || '').trim();
    if (n) names.add(n);
  });
  const lsn = String(row?.linked_school_names || '').trim();
  if (lsn) lsn.split(/\s*\+\s*|\s*[,،]\s*/).forEach((n) => { const t = n.trim(); if (t) names.add(t); });
  const ssn = String(row?.single_school_name || '').trim();
  if (ssn) names.add(ssn);
  const school = String(row?.school || '').trim();
  if (school) names.add(school);
  const legacy = String(row?.legacy_school || '').trim();
  if (legacy) names.add(legacy);
  return Array.from(names);
}

export function getActivitySchoolDisplayName(activity) {
  const lsn = String(activity?.linked_school_names || '').trim();
  if (lsn) return lsn;
  const ssn = String(activity?.single_school_name || '').trim();
  if (ssn) return ssn;
  const school = String(activity?.school || '').trim();
  if (school) return school;
  const legacy = String(activity?.legacy_school || '').trim();
  if (legacy) return legacy;
  return 'לא משויך';
}

export function hasActivitySchoolOrFrame(activity) {
  if (activity?.school_id) return true;
  if (activity?.single_school_id) return true;
  if (Number(activity?.linked_schools_count || 0) > 0) return true;
  if (parseLinkedSchoolsJson(activity).length > 0) return true;
  if (String(activity?.school || '').trim()) return true;
  if (String(activity?.legacy_school || '').trim()) return true;
  return false;
}

export function getActivityInstructorName(activity) {
  for (const field of ['instructor_name', 'instructor', 'guide_name', 'guide']) {
    const value = String(activity?.[field] || '').trim();
    if (value && !INVALID_INSTRUCTOR_NAMES.has(value)) return value;
  }
  return 'לא משויך';
}

export function isValidInstructorName(name) {
  const value = String(name || '').trim();
  return Boolean(value) && !INVALID_INSTRUCTOR_NAMES.has(value);
}

function normalizeIsoDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

export function getActivityPrimaryDate(activity) {
  for (const field of ['start_date', 'activity_date', 'date', 'date_1']) {
    const value = normalizeIsoDate(activity?.[field]);
    if (value) return value;
  }
  const meetingDates = Array.isArray(activity?.meeting_dates) && activity.meeting_dates.length
    ? activity.meeting_dates
    : getActivityDateColumns(activity);
  if (meetingDates.length) return normalizeIsoDate(meetingDates[0]);
  return '';
}

export function getActivityScheduleDates(activity) {
  const meetingDates = getActivityDateColumns(activity).map(normalizeIsoDate).filter(Boolean);
  if (meetingDates.length) return meetingDates;
  const primary = getActivityPrimaryDate(activity);
  return primary ? [primary] : [];
}

export function getActivityAuthorityName(activity) {
  return String(
    activity?.authority_name ||
    activity?.legacy_authority ||
    activity?.authority ||
    ''
  ).trim() || 'לא משויך';
}

export function getActivityDistrict(activity) {
  return String(activity?.authority_district || activity?.district || '').trim() || 'ללא מחוז / לא משויך';
}

export function getActivityName(activity) {
  return String(activity?.activity_name || activity?.name || activity?.title || activity?.program_name || '').trim() || 'ללא שם';
}

export function getActivityTimeRange(activity) {
  const start = String(activity?.start_time || activity?.StartTime || '').trim();
  const end = String(activity?.end_time || activity?.EndTime || '').trim();
  if (start && end) return `${start}-${end}`;
  return start || end || '';
}

export function getActivityGroupsCount(activity) {
  const raw = activity?.groups_count ?? activity?.group_count ?? activity?.num_groups ?? activity?.groups ?? '';
  const text = String(raw || '').trim();
  return text || '';
}

export function getActivityGradeLabel(activity) {
  return String(activity?.grade || activity?.class_group || activity?.group || activity?.class || '').trim();
}

export function getActivityAddress(activity) {
  return String(activity?.address || activity?.school_address || '').trim();
}

export function getActivityContactName(activity) {
  return String(activity?.contact_name || activity?.school_contact_name || '').trim();
}

export function getActivityContactPhone(activity) {
  return String(activity?.contact_phone || activity?.phone || activity?.mobile || '').trim();
}

export function getActivityOperationalNotes(activity) {
  return String(activity?.operations_private_notes || activity?.private_note || activity?.notes || '').trim();
}

export function activityMatchesPeriod(activity, periodKey) {
  const key = String(periodKey || 'all').trim();
  if (!key || key === 'all') return true;
  const season = normalizeActivitySeason(activity?.activity_season ?? activity?.activitySeason);
  if (key === ACTIVITY_SEASON_SUMMER_2026) return isSummerActivity(activity);
  if (key === ACTIVITY_SEASON_SCHOOL_2027) return season === ACTIVITY_SEASON_SCHOOL_2027;
  if (key === 'school_2026') return season !== ACTIVITY_SEASON_SUMMER_2026 && season !== ACTIVITY_SEASON_SCHOOL_2027;
  return true;
}

export function isActivityDeleted(activity) {
  return String(activity?.status || '').trim() === 'נמחק';
}

export function activityDatesInRange(activity, fromDate, toDate) {
  const from = normalizeIsoDate(fromDate);
  const to = normalizeIsoDate(toDate);
  return getActivityScheduleDates(activity).filter((date) => {
    if (from && date < from) return false;
    if (to && date > to) return false;
    return true;
  });
}

export function activityOverlapsDateRange(activity, fromDate, toDate) {
  const datesInRange = activityDatesInRange(activity, fromDate, toDate);
  if (datesInRange.length) return true;
  const start = normalizeIsoDate(activity?.start_date || activity?.date_start || '');
  const end = normalizeIsoDate(activity?.end_date || activity?.date_end || '') || start;
  const from = normalizeIsoDate(fromDate);
  const to = normalizeIsoDate(toDate);
  if (!start && !end) return !from && !to;
  const rowStart = start || end;
  const rowEnd = end || start;
  if (to && rowStart > to) return false;
  if (from && rowEnd < from) return false;
  return true;
}

export function isSummerOperationsException(activity) {
  if (!isSummerActivity(activity)) return false;
  const instructor = getActivityInstructorName(activity);
  const missingInstructor = instructor === 'לא משויך';
  const missingDate = !getActivityPrimaryDate(activity) && getActivityScheduleDates(activity).length === 0;
  return missingInstructor || missingDate;
}

export function schoolGroupKey(activity) {
  return `${getActivityAuthorityName(activity)}::${getActivitySchoolDisplayName(activity)}`;
}

export function buildActivitySearchText(activity) {
  const parts = [
    activity?.RowID,
    activity?.row_id,
    activity?.activity_no,
    getActivityName(activity),
    getActivityAuthorityName(activity),
    getActivityDistrict(activity),
    getActivityInstructorName(activity),
    activity?.instructor_name,
    activity?.instructor,
    activity?.guide_name,
    activity?.guide,
    activity?.authority,
    activity?.legacy_authority,
    activity?.authority_name,
    activity?.school,
    activity?.legacy_school,
    activity?.single_school_name,
    activity?.linked_school_names,
    activity?.single_semel_mosad,
    activity?.linked_semel_mosad_list,
    activity?.status,
    getActivityPrimaryDate(activity),
    ...getActivityScheduleDates(activity),
    ...getActivitySchoolNames(activity)
  ];
  return parts.map((v) => String(v || '').trim()).filter(Boolean).join(' ').toLowerCase();
}
