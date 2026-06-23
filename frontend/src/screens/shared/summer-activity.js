const SUMMER_START_DATE = '2026-07-01';
const SUMMER_END_DATE = '2026-08-31';
const SUMMER_ROW_ID_PREFIX = 'summer_';
const EXCLUDED_SUMMER_STATUSES = new Set(['בוטל', 'נמחק', 'סגור', 'cancelled', 'canceled', 'deleted', 'closed']);
export const SUMMER_DEFAULT_MONTH_YM = SUMMER_START_DATE.slice(0, 7);
export const ACTIVITY_SEASON_REGULAR = 'regular';
export const ACTIVITY_SEASON_SUMMER_2026 = 'summer_2026';
export const ACTIVITY_SEASON_SCHOOL_2027 = 'school_2027';
export const ACTIVITY_SEASON_OPTIONS = [
  { value: ACTIVITY_SEASON_REGULAR, label: 'תשפ"ו | 2026' },
  { value: ACTIVITY_SEASON_SUMMER_2026, label: 'קיץ 2026' },
  { value: ACTIVITY_SEASON_SCHOOL_2027, label: 'תשפ"ז | 2027' }
];
const SUMMER_SEASON_ALIASES = new Set([ACTIVITY_SEASON_SUMMER_2026, 'summer']);
const SCHOOL_2027_ALIASES = new Set([ACTIVITY_SEASON_SCHOOL_2027]);

function normalizedDateText(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

export function normalizeActivitySeason(value) {
  const v = String(value || '').trim();
  if (SUMMER_SEASON_ALIASES.has(v)) return ACTIVITY_SEASON_SUMMER_2026;
  if (SCHOOL_2027_ALIASES.has(v)) return ACTIVITY_SEASON_SCHOOL_2027;
  return ACTIVITY_SEASON_REGULAR;
}

export function activitySeasonLabel(value) {
  const normalized = normalizeActivitySeason(value);
  return ACTIVITY_SEASON_OPTIONS.find((option) => option.value === normalized)?.label || 'רגיל';
}

export function isSummerActivity(activity = {}) {
  const rowId = String(activity?.row_id ?? activity?.RowID ?? activity?.id ?? '').trim().toLowerCase();
  const status = String(activity?.status || '').trim();
  const normalizedStatus = status.toLowerCase();
  const season = normalizeActivitySeason(activity?.activity_season ?? activity?.activitySeason);

  const isExcludedStatus =
    EXCLUDED_SUMMER_STATUSES.has(status) ||
    EXCLUDED_SUMMER_STATUSES.has(normalizedStatus);

  const isSummer =
    season === ACTIVITY_SEASON_SUMMER_2026 ||
    rowId.startsWith(SUMMER_ROW_ID_PREFIX);

  return isSummer && !isExcludedStatus;
}
