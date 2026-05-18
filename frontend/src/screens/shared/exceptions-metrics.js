function asList(rows) {
  return Array.isArray(rows) ? rows : [];
}

export function normalizedExceptionTypes(row) {
  if (Array.isArray(row?.exception_types)) {
    return row.exception_types.map((type) => String(type || '').trim()).filter(Boolean);
  }
  return [row?.exception_type].map((type) => String(type || '').trim()).filter(Boolean);
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

export function computeOperationalExceptionsTotal({ rows, fallback = 0 } = {}) {
  const list = asList(rows);
  if (list.length > 0) {
    return uniqueExceptionActivityCount(list, (types) => types.includes('missing_instructor') || types.includes('missing_start_date'));
  }
  const n = Number(fallback);
  return Number.isFinite(n) ? n : 0;
}
