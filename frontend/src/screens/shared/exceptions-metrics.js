import { isSummerActivity } from './summer-activity.js';

function asList(rows) {
  return Array.isArray(rows) ? rows : [];
}

export const EXCEPTION_TYPE_ORDER = [
  'end_date_passed',
  'missing_instructor',
  'missing_district',
  'missing_start_date',
  'missing_end_date',
  'end_date_after_cutoff'
];

export const APPROVED_EXCEPTION_TYPES = new Set(EXCEPTION_TYPE_ORDER);

export const COURSE_EXCEPTION_TYPES = new Set(EXCEPTION_TYPE_ORDER);

// Summer activities: only these two types are considered exceptions.
// - missing_instructor: activity has no instructor assigned
// - missing_start_date: activity has no start/activity date
// All other exception types (missing_district, missing_end_date, end_date_passed, etc.)
// are intentionally excluded for summer activities.
const SUMMER_EXCEPTION_TYPES = new Set([
  'missing_instructor',
  'missing_start_date'
]);

export const SHORT_ACTIVITY_EXCEPTION_TYPES = new Set([
  'end_date_passed',
  'missing_instructor',
  'missing_start_date'
]);

const SHORT_ACTIVITY_TYPES = new Set(['workshop', 'tour', 'after_school', 'escape_room']);

const LEGACY_EXCEPTION_TYPE_ALIASES = {
  late_end_date: 'end_date_out_of_sync',
  dangerous_end_date: 'end_date_out_of_sync',
  meeting_after_end_date: 'end_date_out_of_sync',
  meeting_after_end: 'end_date_out_of_sync',
  open_ended_not_closed: 'end_date_passed'
};

export function normalizeExceptionType(type) {
  const key = String(type || '').trim();
  return LEGACY_EXCEPTION_TYPE_ALIASES[key] || key;
}

export function isApprovedExceptionType(type) {
  return APPROVED_EXCEPTION_TYPES.has(normalizeExceptionType(type));
}

export function isExceptionTypeRelevantForActivity(activity, exceptionType) {
  const type = String(activity?.activity_type || activity?.item_type || '').trim();
  const normalizedType = normalizeExceptionType(exceptionType);

  // Summer activities: only missing_instructor and missing_start_date are exceptions.
  // All other types (missing_district, end_date_passed, end_date_after_cutoff, etc.)
  // are not applicable to summer activities.
  if (isSummerActivity(activity)) {
    return SUMMER_EXCEPTION_TYPES.has(normalizedType);
  }

  if (type === 'course') {
    return COURSE_EXCEPTION_TYPES.has(normalizedType);
  }

  if (SHORT_ACTIVITY_TYPES.has(type)) {
    return SHORT_ACTIVITY_EXCEPTION_TYPES.has(normalizedType);
  }

  return COURSE_EXCEPTION_TYPES.has(normalizedType);
}

export function normalizedExceptionTypes(row) {
  const rawTypes = Array.isArray(row?.exception_types)
    ? row.exception_types
    : [row?.exception_type];
  return [...new Set(rawTypes
    .map(normalizeExceptionType)
    .filter(isApprovedExceptionType)
    .filter((type) => isExceptionTypeRelevantForActivity(row, type)))];
}

export function exceptionDisplayGroupCount(rows) {
  let total = 0;
  for (const row of asList(rows)) {
    const types = normalizedExceptionTypes(row);
    total += types.length;
  }
  return total;
}

export function exceptionActivityKey(row) {
  const explicitId = [row?.RowID, row?.row_id, row?.source_row_id]
    .map((value) => String(value ?? '').trim())
    .find(Boolean);
  if (explicitId) return `id:${explicitId}`;
  return [row?.activity_name, row?.activity_type, row?.school, row?.authority, row?.start_date, row?.end_date]
    .map((value) => String(value ?? '').trim())
    .join('|');
}

export function uniqueExceptionActivityCount(rows, predicate) {
  const seen = new Set();
  for (const row of asList(rows)) {
    const types = normalizedExceptionTypes(row);
    if (!types.length || (predicate && !predicate(types, row))) continue;
    seen.add(exceptionActivityKey(row));
  }
  return seen.size;
}

/** Total exception occurrences across the canonical exception groups. */
export function computeOperationalExceptionsTotal({ rows, fallback = 0 } = {}) {
  const list = asList(rows);
  if (list.length > 0) return exceptionDisplayGroupCount(list);
  const n = Number(fallback);
  return Number.isFinite(n) ? n : 0;
}
