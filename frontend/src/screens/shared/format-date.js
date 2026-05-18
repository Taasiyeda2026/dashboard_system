const HEBREW_WEEKDAY_LABELS = ['יום א׳', 'יום ב׳', 'יום ג׳', 'יום ד׳', 'יום ה׳', 'יום ו׳', 'יום ש׳'];

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

/** תצוגה אחידה: יום א׳ · 17/05/2026 */
export function formatDateHeWithWeekday(iso) {
  const s = String(iso || '').trim().slice(0, 10);
  const datePart = formatDateHe(s);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return datePart || '—';
  const date = new Date(`${s}T12:00:00`);
  if (Number.isNaN(date.getTime())) return datePart || '—';
  const weekday = HEBREW_WEEKDAY_LABELS[date.getDay()] || '';
  return weekday ? `${weekday} · ${datePart}` : datePart;
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
 * Reads activity meeting date columns from the unified public.activities row.
 * Supports both Supabase date_1..date_35 and accidental legacy Date1..Date35 keys.
 *
 * Important: a date is not a meeting identity. Two consecutive meetings can
 * legitimately have the same date, so this helper preserves one entry per
 * populated meeting column instead of de-duplicating by date. Column order is
 * preserved so callers can keep meeting-number semantics (date_2 stays meeting 2).
 */
export function getActivityDateColumns(row = {}) {
  const dates = [];
  for (let i = 1; i <= 35; i += 1) {
    const value = row?.[`date_${i}`] ?? row?.[`Date${i}`];
    const text = String(value ?? '').trim();
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(text);
    if (m) dates.push(m[1]);
  }
  return dates;
}

export function formatActivityDateColumnsHe(row = {}) {
  const dates = getActivityDateColumns(row);
  return dates.length ? dates.map((date) => formatDateHe(date)).join(', ') : '—';
}
