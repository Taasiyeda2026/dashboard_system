import { state } from './state.js';
import { activitiesScreen } from './screens/activities.js';
import {
  ACTIVITY_SEASON_REGULAR,
  ACTIVITY_SEASON_SUMMER_2026,
  ACTIVITY_SEASON_SCHOOL_2027,
  SCHOOL_2026_START_DATE,
  SCHOOL_2026_END_DATE,
  SCHOOL_2027_START_DATE,
  SCHOOL_2027_END_DATE,
  getActivityPeriodKey,
  globalActivityPeriodLabel,
  normalizeGlobalActivityPeriod
} from './screens/shared/summer-activity.js';

// Screen contract: current-period tabs are open-only, archive is closed-only,
// and the combined tab contains both open and closed rows (never deleted/cancelled).
const INNER_TAB_ALL = 'year_all';
const INNER_TAB_REGULAR_2026 = 'regular_2026';
const INNER_TAB_SUMMER_2026 = 'summer_2026';
const INNER_TAB_ARCHIVE = 'year_archive';
const INNER_TAB_2027 = 'school_2027';

const MONTH_NAVIGATION_TABS = new Set([
  INNER_TAB_REGULAR_2026,
  INNER_TAB_SUMMER_2026,
  INNER_TAB_ARCHIVE,
  INNER_TAB_2027
]);

const SUMMER_MONTH_RANGE = { start: '2026-06', end: '2026-08' };
const SCHOOL_2027_MONTH_RANGE = { start: '2026-09', end: '2027-06' };
const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'
];

const CLOSED_STATUSES = new Set(['סגור', 'closed']);
const DELETED_STATUSES = new Set(['נמחק', 'deleted']);
const CANCELLED_STATUSES = new Set(['בוטל', 'cancelled', 'canceled']);

function cleanText(value) {
  return String(value ?? '').trim();
}

function normalizedStatus(row = {}) {
  const status = cleanText(row.status);
  const lower = status.toLowerCase();
  if (lower === 'active' || lower === 'open' || status === 'פעיל') return 'פתוח';
  if (lower === 'closed') return 'סגור';
  return status;
}

function statusIn(row, statuses) {
  const status = normalizedStatus(row);
  return statuses.has(status) || statuses.has(status.toLowerCase());
}

function isClosed(row) {
  return statusIn(row, CLOSED_STATUSES);
}

function isDeleted(row) {
  return statusIn(row, DELETED_STATUSES);
}

function isCancelled(row) {
  return statusIn(row, CANCELLED_STATUSES);
}

function isVisibleActivity(row) {
  return !isDeleted(row) && !isCancelled(row);
}

function selectedYearKey(activityPeriodTab) {
  return normalizeGlobalActivityPeriod(activityPeriodTab);
}

function rowBelongsToYear(row, yearKey) {
  const period = getActivityPeriodKey(row);
  if (yearKey === ACTIVITY_SEASON_SCHOOL_2027) return period === ACTIVITY_SEASON_SCHOOL_2027;
  return period === ACTIVITY_SEASON_REGULAR || period === ACTIVITY_SEASON_SUMMER_2026;
}

function isOpenRow(row) {
  return isVisibleActivity(row) && !isClosed(row);
}

export function defaultActivitiesInnerTabForPeriod(activityPeriodTab) {
  return selectedYearKey(activityPeriodTab) === ACTIVITY_SEASON_SCHOOL_2027
    ? INNER_TAB_2027
    : INNER_TAB_SUMMER_2026;
}

function rowsForSelectedInnerTab(rows, targetState = {}) {
  const yearKey = selectedYearKey(targetState.activityPeriodTab);
  const innerTab = cleanText(targetState.activitiesInnerTab);
  const yearRows = (Array.isArray(rows) ? rows : [])
    .filter((row) => rowBelongsToYear(row, yearKey))
    .filter(isVisibleActivity);

  if (innerTab === INNER_TAB_ALL) return yearRows;
  if (innerTab === INNER_TAB_ARCHIVE) return yearRows.filter(isClosed);
  if (yearKey === ACTIVITY_SEASON_SCHOOL_2027) return yearRows.filter(isOpenRow);
  if (innerTab === INNER_TAB_SUMMER_2026) {
    return yearRows.filter((row) => isOpenRow(row) && getActivityPeriodKey(row) === ACTIVITY_SEASON_SUMMER_2026);
  }
  return yearRows.filter((row) => isOpenRow(row) && getActivityPeriodKey(row) === ACTIVITY_SEASON_REGULAR);
}

function tabCounts(rows, targetState = {}) {
  const yearKey = selectedYearKey(targetState.activityPeriodTab);
  const yearRows = (Array.isArray(rows) ? rows : [])
    .filter((row) => rowBelongsToYear(row, yearKey))
    .filter(isVisibleActivity);

  const counts = {
    [INNER_TAB_ALL]: yearRows.length,
    [INNER_TAB_ARCHIVE]: yearRows.filter(isClosed).length
  };

  if (yearKey === ACTIVITY_SEASON_SCHOOL_2027) {
    const monthlyState = { ...targetState, activitiesInnerTab: INNER_TAB_2027 };
    const month = monthWithinRange(targetState.activitiesMonthYm, SCHOOL_2027_MONTH_RANGE)
      ? targetState.activitiesMonthYm
      : preferredMonthForTab(rows, monthlyState);
    counts[INNER_TAB_2027] = yearRows
      .filter(isOpenRow)
      .filter((row) => rowOccursInMonth(row, month))
      .length;
  } else {
    counts[INNER_TAB_REGULAR_2026] = yearRows.filter((row) => isOpenRow(row) && getActivityPeriodKey(row) === ACTIVITY_SEASON_REGULAR).length;
    counts[INNER_TAB_SUMMER_2026] = yearRows.filter((row) => isOpenRow(row) && getActivityPeriodKey(row) === ACTIVITY_SEASON_SUMMER_2026).length;
  }

  return counts;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function replaceTabCount(html, tabKey, count) {
  const pattern = new RegExp(`(data-activity-period-tab="${escapeRegExp(tabKey)}"[^>]*>[\\s\\S]*?<strong>)[^<]*(</strong>)`);
  return html.replace(pattern, `$1${count}$2`);
}

function replaceAllTabCounts(html, rows, targetState) {
  const counts = tabCounts(rows, targetState);
  return Object.entries(counts).reduce(
    (result, [tabKey, count]) => replaceTabCount(result, tabKey, count),
    html
  );
}

function ensureDefaultInnerTab(targetState, { force = false } = {}) {
  const current = cleanText(targetState?.activitiesInnerTab);
  if (!force && current) return;
  targetState.activitiesInnerTab = defaultActivitiesInnerTabForPeriod(targetState?.activityPeriodTab);
}

function normalizeDate(value) {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(cleanText(value));
  return match ? match[1] : '';
}

function activityDatePoints(row = {}) {
  const dates = [];
  const add = (value) => {
    const date = normalizeDate(value);
    if (date && !dates.includes(date)) dates.push(date);
  };

  add(row.start_date ?? row.date_start);
  add(row.end_date ?? row.date_end);

  const meetingDates = Array.isArray(row.meeting_dates) ? row.meeting_dates : [];
  const dateCols = Array.isArray(row.date_cols) ? row.date_cols : [];
  [...meetingDates, ...dateCols].forEach(add);

  for (let index = 1; index <= 35; index += 1) {
    add(row[`date_${index}`]);
    add(row[`Date${index}`]);
  }

  return dates;
}

function rowOccursInMonth(row, month) {
  if (!/^\d{4}-\d{2}$/.test(cleanText(month))) return true;
  return activityDatePoints(row).some((date) => date.startsWith(month));
}

function isMonthNavigationTab(targetState = {}) {
  return MONTH_NAVIGATION_TABS.has(cleanText(targetState.activitiesInnerTab));
}

function monthRangeForState(targetState = {}) {
  const innerTab = cleanText(targetState.activitiesInnerTab);
  if (innerTab === INNER_TAB_SUMMER_2026) return SUMMER_MONTH_RANGE;
  if (innerTab === INNER_TAB_2027) return SCHOOL_2027_MONTH_RANGE;

  const yearKey = selectedYearKey(targetState.activityPeriodTab);
  if (yearKey === ACTIVITY_SEASON_SCHOOL_2027) {
    return {
      start: SCHOOL_2027_START_DATE.slice(0, 7),
      end: SCHOOL_2027_END_DATE.slice(0, 7)
    };
  }

  return {
    start: SCHOOL_2026_START_DATE.slice(0, 7),
    end: SCHOOL_2026_END_DATE.slice(0, 7)
  };
}

function currentMonthYm(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(ym, delta) {
  const match = /^(\d{4})-(\d{2})$/.exec(cleanText(ym));
  if (!match) return '';
  const date = new Date(Number(match[1]), Number(match[2]) - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthWithinRange(month, range) {
  return /^\d{4}-\d{2}$/.test(cleanText(month)) && month >= range.start && month <= range.end;
}

export function preferredMonthForTab(_rows, targetState, now = new Date()) {
  const range = monthRangeForState(targetState);
  const current = currentMonthYm(now);
  if (current < range.start) return range.start;
  if (current > range.end) return range.end;
  return current;
}

function ensureMonthForTab(targetState, rows, { force = false } = {}) {
  if (!isMonthNavigationTab(targetState)) return;
  const range = monthRangeForState(targetState);
  if (!force && monthWithinRange(targetState.activitiesMonthYm, range)) return;
  targetState.activitiesMonthYm = preferredMonthForTab(rows, targetState);
}

export function nextActivitiesMonth(targetState, delta) {
  const range = monthRangeForState(targetState);
  const current = monthWithinRange(targetState.activitiesMonthYm, range)
    ? targetState.activitiesMonthYm
    : range.start;
  const candidate = shiftMonth(current, delta);
  if (!candidate || candidate < range.start || candidate > range.end) return current;
  return candidate;
}

function hebrewMonthYear(month) {
  const match = /^(\d{4})-(\d{2})$/.exec(cleanText(month));
  if (!match) return '';
  const name = HEBREW_MONTHS[Number(match[2]) - 1] || match[2];
  return `${name} ${match[1]}`;
}

function innerTabLabel(targetState) {
  const year = globalActivityPeriodLabel(targetState.activityPeriodTab);
  const tab = cleanText(targetState.activitiesInnerTab);
  if (tab === INNER_TAB_SUMMER_2026) return 'קיץ 2026';
  if (tab === INNER_TAB_REGULAR_2026) return 'שנת 2026';
  const displayYear = year === '2027' ? 'תשפ״ז' : year;
  if (tab === INNER_TAB_ARCHIVE) return `ארכיון ${displayYear}`;
  if (tab === INNER_TAB_2027) return 'פעילויות תשפ״ז';
  return `כל פעילויות ${displayYear}`;
}

function renderedVisibleCount(html, fallback) {
  const titleMatch = /ds-activities-page-title[^>]*>[\s\S]*?·\s*(\d+)\s+פעילויות/.exec(html);
  return titleMatch ? Number(titleMatch[1]) : fallback;
}

function monthNavigationHtml(targetState, visibleCount, totalCount) {
  const range = monthRangeForState(targetState);
  const currentMonth = targetState.activitiesMonthYm;
  const loading = !!targetState.activitiesNavLoading;
  const disablePrev = loading || currentMonth <= range.start;
  const disableNext = loading || currentMonth >= range.end;
  const isSchool2027Monthly = cleanText(targetState.activitiesInnerTab) === INNER_TAB_2027;
  const countText = `${visibleCount} פעילויות${!isSchool2027Monthly && visibleCount !== totalCount ? ` מתוך ${totalCount}` : ''}`;
  const loadingChip = loading ? ' <span class="ds-inline-loading-dot is-inline-loading" aria-hidden="true"></span>' : '';

  return `<nav class="ds-activities-title-row${loading ? ' is-nav-loading' : ''}" aria-label="ניווט חודשי לפעילויות" dir="rtl">
    <button type="button" class="ds-btn ds-btn--sm ds-btn--nav-arrow" data-activities-month-prev aria-label="חודש קודם" title="חודש קודם" ${disablePrev ? 'disabled' : ''}>▶</button>
    <h2 class="ds-activities-page-title">${escapeHtml(innerTabLabel(targetState))} · ${escapeHtml(hebrewMonthYear(currentMonth))} · ${escapeHtml(countText)}${loadingChip}</h2>
    <button type="button" class="ds-btn ds-btn--sm ds-btn--nav-arrow" data-activities-month-next aria-label="חודש הבא" title="חודש הבא" ${disableNext ? 'disabled' : ''}>◀</button>
  </nav>`;
}

function replaceTitleNavigation(html, replacement) {
  return html.replace(
    /<nav class="ds-activities-title-row[^>]*>[\s\S]*?<\/nav>/,
    replacement
  );
}

ensureDefaultInnerTab(state);

const originalRender = activitiesScreen.render.bind(activitiesScreen);
activitiesScreen.render = function renderWithCorrectTabScopes(data, context = {}) {
  const targetState = context?.state || state;
  ensureDefaultInnerTab(targetState);

  const originalRows = Array.isArray(data?.rows) ? data.rows : [];
  ensureMonthForTab(targetState, originalRows);

  // The screen itself now returns open and closed rows for the combined tab, so the
  // rendered rows stay identical to the rows the click handler searches.
  let renderRows = originalRows;

  if (isMonthNavigationTab(targetState)) {
    renderRows = renderRows.filter((row) => rowOccursInMonth(row, targetState.activitiesMonthYm));
  }

  const renderData = { ...data, rows: renderRows };
  let html = originalRender(renderData, context);
  html = replaceAllTabCounts(html, originalRows, targetState);

  if (isMonthNavigationTab(targetState)) {
    const tabRows = rowsForSelectedInnerTab(originalRows, targetState);
    const monthRows = tabRows.filter((row) => rowOccursInMonth(row, targetState.activitiesMonthYm));
    const visibleCount = renderedVisibleCount(html, monthRows.length);
    html = replaceTitleNavigation(html, monthNavigationHtml(targetState, visibleCount, tabRows.length));
    html = html.replace('אין פעילויות להצגה בתקופה זו', 'אין פעילויות להצגה בחודש הנבחר');
  }

  return html;
};

const originalBind = activitiesScreen.bind.bind(activitiesScreen);
activitiesScreen.bind = function bindWithWorkingMonthNavigation(args = {}) {
  originalBind(args);

  const root = args.root;
  const targetState = args.state || state;
  const rows = Array.isArray(args.data?.rows) ? args.data.rows : [];
  if (!root || !isMonthNavigationTab(targetState)) return;

  const rerenderLocal = () => {
    if (typeof args.rerenderActivitiesView === 'function') args.rerenderActivitiesView();
    else if (typeof args.rerender === 'function') args.rerender();
  };

  const moveMonth = (delta) => {
    if (targetState.activitiesNavLoading) return;
    ensureMonthForTab(targetState, rows);
    const nextMonth = nextActivitiesMonth(targetState, delta);
    if (nextMonth === targetState.activitiesMonthYm) return;

    targetState.activitiesSummerShowAll = false;
    targetState.activitiesNavLoading = true;
    targetState.activitiesMonthYm = nextMonth;
    rerenderLocal();

    setTimeout(() => {
      targetState.activitiesNavLoading = false;
      rerenderLocal();
    }, 220);
  };

  root.querySelector('[data-activities-month-prev]')?.addEventListener('click', () => moveMonth(-1));
  root.querySelector('[data-activities-month-next]')?.addEventListener('click', () => moveMonth(1));
};

if (typeof document !== 'undefined') {
  document.addEventListener('click', (event) => {
    const activitiesRouteButton = event.target?.closest?.('[data-route="activities"]');
    if (!activitiesRouteButton) return;
    ensureDefaultInnerTab(state, { force: true });
    state.activitiesMonthYm = '';
    state.allActivitiesStatusFilter = 'all';
  }, true);
}
