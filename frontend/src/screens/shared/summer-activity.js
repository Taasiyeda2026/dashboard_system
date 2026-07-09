const SUMMER_START_DATE = '2026-07-01';
const SUMMER_END_DATE = '2026-08-31';
export const SCHOOL_2026_START_DATE = '2025-09-01';
export const SCHOOL_2026_END_DATE = '2026-08-31';
export const SCHOOL_2027_START_DATE = '2026-09-01';
export const SCHOOL_2027_END_DATE = '2027-08-31';
const SUMMER_ROW_ID_PREFIX = 'summer_';
const EXCLUDED_SUMMER_STATUSES = new Set(['בוטל', 'נמחק', 'סגור', 'cancelled', 'canceled', 'deleted', 'closed']);
const INSTRUCTOR_SUMMER_VISIBLE_STATUSES = new Set(['פתוח', 'סגור']);
export const SUMMER_DEFAULT_MONTH_YM = SUMMER_START_DATE.slice(0, 7);
export const ACTIVITY_SEASON_REGULAR = 'regular';
export const ACTIVITY_SEASON_SUMMER_2026 = 'summer_2026';
export const ACTIVITY_SEASON_SCHOOL_2027 = 'school_2027';
export const ACTIVITY_SEASON_OPTIONS = [
  { value: ACTIVITY_SEASON_SUMMER_2026, label: 'קיץ 2026', shortLabel: 'קיץ' },
  { value: ACTIVITY_SEASON_REGULAR, label: 'תשפ״ו / 2026', shortLabel: '2026' },
  { value: ACTIVITY_SEASON_SCHOOL_2027, label: 'תשפ״ז / 2027', shortLabel: '2027' }
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


export function hasExplicitActivitySeason(activity = {}) {
  return String(activity?.activity_season ?? activity?.activitySeason ?? '').trim() !== '';
}

export function getActivitySeasonDate(activity = {}) {
  return normalizedDateText(activity?.start_date ?? activity?.date_start ?? activity?.activity_date ?? activity?.date ?? activity?.date_1 ?? activity?.Date1);
}

export function getActivityPeriodKey(activity = {}) {
  const explicitSeason = hasExplicitActivitySeason(activity);
  const season = normalizeActivitySeason(activity?.activity_season ?? activity?.activitySeason);
  if (season === ACTIVITY_SEASON_SCHOOL_2027) return ACTIVITY_SEASON_SCHOOL_2027;
  if (season === ACTIVITY_SEASON_SUMMER_2026) return ACTIVITY_SEASON_SUMMER_2026;
  if (explicitSeason && season === ACTIVITY_SEASON_REGULAR) return ACTIVITY_SEASON_REGULAR;

  const start = getActivitySeasonDate(activity);
  if (start >= SCHOOL_2027_START_DATE && start <= SCHOOL_2027_END_DATE) return ACTIVITY_SEASON_SCHOOL_2027;
  if (start >= SCHOOL_2026_START_DATE && start <= SCHOOL_2026_END_DATE) return ACTIVITY_SEASON_REGULAR;
  return '';
}

export const GLOBAL_ACTIVITY_PERIODS = [ACTIVITY_SEASON_SUMMER_2026, ACTIVITY_SEASON_REGULAR, ACTIVITY_SEASON_SCHOOL_2027];

export function normalizeGlobalActivityPeriod(value) {
  const key = String(value || '').trim();
  if (key === 'school_2026' || key === 'archive' || key === ACTIVITY_SEASON_REGULAR) return ACTIVITY_SEASON_REGULAR;
  if (key === ACTIVITY_SEASON_SCHOOL_2027) return ACTIVITY_SEASON_SCHOOL_2027;
  return ACTIVITY_SEASON_SUMMER_2026;
}

export function globalActivityPeriodLabel(value) {
  const key = normalizeGlobalActivityPeriod(value);
  if (key === ACTIVITY_SEASON_SCHOOL_2027) return '2027';
  if (key === ACTIVITY_SEASON_REGULAR) return '2026';
  return 'קיץ';
}

export function globalActivityPeriodFullLabel(value) {
  const key = normalizeGlobalActivityPeriod(value);
  return ACTIVITY_SEASON_OPTIONS.find((option) => option.value === key)?.label || 'קיץ 2026';
}

export function globalActivityPeriodOptions() {
  return ACTIVITY_SEASON_OPTIONS.map(({ value, label, shortLabel }) => ({ value, label, shortLabel }));
}

export function activityMatchesPeriodKey(activity = {}, periodKey = '') {
  const key = String(periodKey || 'all').trim();
  if (!key || key === 'all') return true;
  const period = getActivityPeriodKey(activity);
  if (key === 'school_2026') return period === ACTIVITY_SEASON_REGULAR;
  return period === key;
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

export function isInstructorSummerVisibleActivity(activity = {}) {
  const season = normalizeActivitySeason(activity?.activity_season ?? activity?.activitySeason);
  const status = String(activity?.status || '').trim();
  return season === ACTIVITY_SEASON_SUMMER_2026 && INSTRUCTOR_SUMMER_VISIBLE_STATUSES.has(status);
}
