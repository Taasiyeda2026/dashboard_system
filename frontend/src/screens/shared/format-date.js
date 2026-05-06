/**
 * Converts an ISO date string (YYYY-MM-DD) to Hebrew display format (DD/MM/YYYY).
 * Returns the input unchanged if it isn't a valid ISO date.
 */
export function formatDateHe(iso) {
  if (!iso || typeof iso !== 'string') return iso || '—';
  const s = String(iso).trim().slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}


/**
 * Converts Supabase time values to HH:MM.
 * Accepts HH:MM, HH:MM:SS, ISO timestamps, or Date-like strings and never returns seconds.
 */
export function formatTimeShort(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const m = raw.match(/(?:^|T|\s)(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?/);
  if (!m) return raw;
  return `${String(m[1]).padStart(2, '0')}:${m[2]}`;
}

export function formatTimeRangeShort(startValue, endValue) {
  const start = formatTimeShort(startValue);
  const end = formatTimeShort(endValue);
  return start && end ? `${start}-${end}` : (start || end || '—');
}

/**
 * Reads all activity meeting date columns from the unified public.activities row.
 * Supports both Supabase date_1..date_35 and accidental legacy Date1..Date35 keys.
 */
export function getActivityDateColumns(row = {}) {
  const dates = [];
  for (let i = 1; i <= 35; i += 1) {
    const value = row?.[`date_${i}`] ?? row?.[`Date${i}`];
    const text = String(value ?? '').trim();
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(text);
    if (m) dates.push(m[1]);
  }
  return [...new Set(dates)].sort();
}

export function formatActivityDateColumnsHe(row = {}) {
  const dates = getActivityDateColumns(row);
  return dates.length ? dates.map((date) => formatDateHe(date)).join(', ') : '—';
}
