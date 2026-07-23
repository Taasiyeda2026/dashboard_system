const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeIsoDate(value) {
  const clean = String(value || '').slice(0, 10);
  return ISO_DATE_RE.test(clean) ? clean : '';
}

function dateValue(isoDate) {
  const clean = normalizeIsoDate(isoDate);
  if (!clean) return Number.NaN;
  return new Date(`${clean}T12:00:00`).getTime();
}

function timeMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || '').trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

export function addCalendarDays(isoDate, days) {
  const clean = normalizeIsoDate(isoDate);
  if (!clean) return '';
  const date = new Date(`${clean}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  date.setDate(date.getDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

export function isSummerActivitySeason(value) {
  return String(value || '').trim().toLowerCase().startsWith('summer_');
}

export function normalizeSchoolCalendarRow(row = {}) {
  const startDate = normalizeIsoDate(row.start_date);
  const endDate = normalizeIsoDate(row.end_date) || startDate;
  return {
    ...row,
    external_key: String(row.external_key || '').trim(),
    title: String(row.title || '').trim(),
    start_date: startDate,
    end_date: endDate,
    resume_date: normalizeIsoDate(row.resume_date),
    day_status: String(row.day_status || '').trim(),
    school_day_end_time: String(row.school_day_end_time || '').trim(),
    blocks_scheduling: row.blocks_scheduling === true,
    enforce_end_time: row.enforce_end_time === true,
    show_on_main_calendar: row.show_on_main_calendar !== false,
    is_active: row.is_active !== false
  };
}

export function schoolCalendarEventsForDate(rows = [], isoDate, { visibleOnly = true } = {}) {
  const target = dateValue(isoDate);
  if (!Number.isFinite(target)) return [];
  return (Array.isArray(rows) ? rows : [])
    .map(normalizeSchoolCalendarRow)
    .filter((row) => {
      if (!row.is_active || !row.start_date) return false;
      if (visibleOnly && !row.show_on_main_calendar) return false;
      const start = dateValue(row.start_date);
      const end = dateValue(row.end_date || row.start_date);
      return Number.isFinite(start) && Number.isFinite(end) && target >= start && target <= end;
    })
    .sort((a, b) => {
      if (a.blocks_scheduling !== b.blocks_scheduling) return a.blocks_scheduling ? -1 : 1;
      if (a.enforce_end_time !== b.enforce_end_time) return a.enforce_end_time ? -1 : 1;
      return a.title.localeCompare(b.title, 'he');
    });
}

export function blockingSchoolCalendarEvent(rows = [], isoDate) {
  return schoolCalendarEventsForDate(rows, isoDate).find((row) => row.blocks_scheduling) || null;
}

export function shortenedSchoolDayConflict(rows = [], isoDate, activityEndTime) {
  const endMinutes = timeMinutes(activityEndTime);
  if (endMinutes == null) return null;
  return schoolCalendarEventsForDate(rows, isoDate).find((row) => {
    if (!row.enforce_end_time || !row.school_day_end_time) return false;
    const limitMinutes = timeMinutes(row.school_day_end_time);
    return limitMinutes != null && endMinutes > limitMinutes;
  }) || null;
}

export function nextAllowedWeeklyDate(rows = [], isoDate, { maxSkips = 20 } = {}) {
  let candidate = normalizeIsoDate(isoDate);
  if (!candidate) return '';
  let skips = 0;
  while (blockingSchoolCalendarEvent(rows, candidate) && skips < maxSkips) {
    candidate = addCalendarDays(candidate, 7);
    skips += 1;
  }
  return candidate;
}

export function buildWeeklyDatesSkippingSchoolCalendar(rows = [], startDate, count) {
  const total = Math.max(0, Math.floor(Number(count) || 0));
  if (!total) return [];
  const dates = [];
  let candidate = normalizeIsoDate(startDate);
  for (let index = 0; index < total; index += 1) {
    if (!candidate) break;
    candidate = nextAllowedWeeklyDate(rows, candidate);
    dates.push(candidate);
    candidate = addCalendarDays(candidate, 7);
  }
  return dates;
}

export function compactSchoolCalendarLabel(events = [], { maxTitles = 2 } = {}) {
  const rows = Array.isArray(events) ? events : [];
  const labels = [];
  rows.forEach((row) => {
    const normalized = normalizeSchoolCalendarRow(row);
    if (!normalized.title) return;
    const suffix = normalized.enforce_end_time && normalized.school_day_end_time
      ? ` עד ${normalized.school_day_end_time.slice(0, 5)}`
      : '';
    const label = `${normalized.title}${suffix}`;
    if (!labels.includes(label)) labels.push(label);
  });
  if (!labels.length) return '';
  const visible = labels.slice(0, Math.max(1, maxTitles));
  const extra = labels.length - visible.length;
  return extra > 0 ? `${visible.join(' · ')} +${extra}` : visible.join(' · ');
}
