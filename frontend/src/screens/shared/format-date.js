/**
 * Converts an ISO date string (YYYY-MM-DD) to Hebrew display format (DD/MM/YYYY).
 * Returns the input unchanged if it isn't a valid ISO date.
 */
export function formatDateHe(iso) {
  if (!iso || typeof iso !== 'string') return iso || '—';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}
