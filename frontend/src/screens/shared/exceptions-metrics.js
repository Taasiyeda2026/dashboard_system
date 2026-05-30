function asList(rows) {
  return Array.isArray(rows) ? rows : [];
}

export const EXCEPTION_TYPE_ORDER = [
  'end_date_passed',
  'next_meeting_passed',
  'end_date_out_of_sync',
  'invalid_date_range',
  'missing_instructor',
  'missing_school',
  'missing_authority',
  'missing_district',
  'missing_start_date',
  'missing_end_date',
  'missing_next_meeting'
];

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

export function normalizedExceptionTypes(row) {
  const rawTypes = Array.isArray(row?.exception_types)
    ? row.exception_types
    : [row?.exception_type];
  return [...new Set(rawTypes.map(normalizeExceptionType).filter(Boolean))];
}

export function exceptionDisplayGroupCount(rows) {
  let total = 0;
  for (const row of asList(rows)) {
    const types = normalizedExceptionTypes(row);
    total += types.length || 1;
  }
  return total;
}

function exceptionActivityKey(row) {
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
