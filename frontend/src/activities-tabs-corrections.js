import { state } from './state.js';
import { activitiesScreen } from './screens/activities.js';
import {
  ACTIVITY_SEASON_REGULAR,
  ACTIVITY_SEASON_SUMMER_2026,
  ACTIVITY_SEASON_SCHOOL_2027,
  getActivityPeriodKey,
  normalizeGlobalActivityPeriod
} from './screens/shared/summer-activity.js';

// Screen contract: current-period tabs are open-only, archive is closed-only,
// and the combined tab contains both open and closed rows (never deleted/cancelled).
const INNER_TAB_ALL = 'year_all';
const INNER_TAB_REGULAR_2026 = 'regular_2026';
const INNER_TAB_SUMMER_2026 = 'summer_2026';
const INNER_TAB_ARCHIVE = 'year_archive';
const INNER_TAB_2027 = 'school_2027';

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

function tabCounts(rows, activityPeriodTab) {
  const yearKey = selectedYearKey(activityPeriodTab);
  const yearRows = (Array.isArray(rows) ? rows : [])
    .filter((row) => rowBelongsToYear(row, yearKey))
    .filter(isVisibleActivity);

  const counts = {
    [INNER_TAB_ALL]: yearRows.length,
    [INNER_TAB_ARCHIVE]: yearRows.filter(isClosed).length
  };

  if (yearKey === ACTIVITY_SEASON_SCHOOL_2027) {
    counts[INNER_TAB_2027] = yearRows.filter(isOpenRow).length;
  } else {
    counts[INNER_TAB_REGULAR_2026] = yearRows.filter((row) => isOpenRow(row) && getActivityPeriodKey(row) === ACTIVITY_SEASON_REGULAR).length;
    counts[INNER_TAB_SUMMER_2026] = yearRows.filter((row) => isOpenRow(row) && getActivityPeriodKey(row) === ACTIVITY_SEASON_SUMMER_2026).length;
  }

  return counts;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceTabCount(html, tabKey, count) {
  const pattern = new RegExp(`(data-activity-period-tab="${escapeRegExp(tabKey)}"[^>]*>[\\s\\S]*?<strong>)[^<]*(</strong>)`);
  return html.replace(pattern, `$1${count}$2`);
}

function replaceAllTabCounts(html, rows, activityPeriodTab) {
  const counts = tabCounts(rows, activityPeriodTab);
  return Object.entries(counts).reduce(
    (result, [tabKey, count]) => replaceTabCount(result, tabKey, count),
    html
  );
}

function rowsForAllActivitiesTab(rows, activityPeriodTab) {
  const yearKey = selectedYearKey(activityPeriodTab);
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => rowBelongsToYear(row, yearKey))
    .filter(isVisibleActivity)
    .map((row) => {
      if (!isClosed(row)) return row;
      // The underlying legacy screen treats "all" as an active-only view.
      // A render-only clone lets closed rows participate in the combined view;
      // the original data is still passed to bind/export/detail actions.
      return { ...row, status: 'פתוח', __activitiesActualStatus: normalizedStatus(row) };
    });
}

function ensureDefaultInnerTab(targetState, { force = false } = {}) {
  const current = cleanText(targetState?.activitiesInnerTab);
  if (!force && current) return;
  targetState.activitiesInnerTab = defaultActivitiesInnerTabForPeriod(targetState?.activityPeriodTab);
}

ensureDefaultInnerTab(state);

const originalRender = activitiesScreen.render.bind(activitiesScreen);
activitiesScreen.render = function renderWithCorrectTabScopes(data, context = {}) {
  const targetState = context?.state || state;
  ensureDefaultInnerTab(targetState);

  const originalRows = Array.isArray(data?.rows) ? data.rows : [];
  const isAllTab = cleanText(targetState.activitiesInnerTab) === INNER_TAB_ALL;
  const renderData = isAllTab
    ? { ...data, rows: rowsForAllActivitiesTab(originalRows, targetState.activityPeriodTab) }
    : data;

  const html = originalRender(renderData, context);
  return replaceAllTabCounts(html, originalRows, targetState.activityPeriodTab);
};

if (typeof document !== 'undefined') {
  document.addEventListener('click', (event) => {
    const activitiesRouteButton = event.target?.closest?.('[data-route="activities"]');
    if (!activitiesRouteButton) return;
    ensureDefaultInnerTab(state, { force: true });
    state.allActivitiesStatusFilter = 'all';
  }, true);
}
