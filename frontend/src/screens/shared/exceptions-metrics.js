function asList(rows) {
  return Array.isArray(rows) ? rows : [];
}

export function normalizedExceptionTypes(row) {
  if (Array.isArray(row?.exception_types)) {
    return row.exception_types.map((type) => String(type || '').trim()).filter(Boolean);
  }
  return [row?.exception_type].map((type) => String(type || '').trim()).filter(Boolean);
}


const EXCEPTION_DISPLAY_GROUP_TYPES = ['missing_start_date', 'end_date_passed', 'late_end_date', 'missing_instructor'];

export function exceptionDisplayGroupCount(rows) {
  let total = 0;
  const mainTypes = new Set(EXCEPTION_DISPLAY_GROUP_TYPES);
  for (const row of asList(rows)) {
    const types = normalizedExceptionTypes(row);
    if (!types.length) {
      total += 1;
      continue;
    }
    const uniqueTypes = new Set(types);
    for (const type of EXCEPTION_DISPLAY_GROUP_TYPES) {
      if (uniqueTypes.has(type)) total += 1;
    }
    if ([...uniqueTypes].some((type) => !mainTypes.has(type))) total += 1;
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

/** חריגות תפעוליות = רק סוגי חריגה מעמוד חריגות שאינם חסר מדריך / חסר תאריך התחלה */
export function computeOperationalExceptionsTotal({ rows, fallback = 0 } = {}) {
  const list = asList(rows);
  if (list.length > 0) {
    return uniqueExceptionActivityCount(list, (types) => types.includes('late_end_date'));
  }
  const n = Number(fallback);
  return Number.isFinite(n) ? n : 0;
}
