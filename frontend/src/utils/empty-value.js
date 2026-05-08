/**
 * Returns true for values that should be treated as empty across the app.
 * Covers actual null/undefined, blank strings, whitespace-only strings, and
 * textual null markers that can arrive from spreadsheets or Supabase.
 */
export function isEmptyValue(value) {
  if (value === null || value === undefined) return true;
  const normalized = String(value).replace(/\u00A0/g, ' ').trim();
  if (!normalized) return true;
  const compact = normalized.replace(/\s+/g, ' ').toLowerCase();
  return compact === 'null' || compact === 'undefined';
}

export function nonEmptyString(value) {
  return isEmptyValue(value) ? '' : String(value).trim();
}
