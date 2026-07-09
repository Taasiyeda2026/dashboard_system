import { escapeHtml } from './shared/html.js';
import { exportActivitiesToExcel } from './shared/excel-export.js';
import { formatDateHe, formatActivityDateColumnsHe } from './shared/format-date.js';
import {
  visibleActivityCategoryLabel
} from './shared/ui-hebrew.js';
import { bindActivityEditForm as bindActivityEditFormShared } from './shared/bind-activity-edit-form.js';
import {
  dsCard,
  dsScreenStack,
  dsTableWrap,
  dsEmptyState
} from './shared/layout.js';

import { activityWorkDrawerHtml, patchDrawerDatesSection } from './shared/activity-detail-html.js';
import {
  ensureActivityListFilters,
  prepareRowsForSearch,
  applyLocalFilters,
  filtersToolbarHtml,
  bindLocalFilters,
  splitVisibleRows
} from './shared/activity-list-filters.js';
import {
  activityManagerDisplayName,
  getActivityCatalog,
  getActivityTypesByFamily,
  getRosterUsers,
  getValidInstructorUsers,
  activityTypeDisplayLabel,
  activityTypeMatches,
  normalizeActivityTypeKey,
  normalizeOneDayActivityType,
  getManagerUsers,
  getFilterOptionOverrides,
  cleanUnique,
  humanDisplayText,
  INSTRUCTOR_IDENTITY_ERROR_MESSAGE,
  NO_ACTIVITY_MANAGER_LABEL,
  resolveInstructorSelectionByEmpId,
  validateInstructorIdentityPayload,
  resolveGradeOptions
} from './shared/activity-options.js';
import { readActivitiesGapFromQuery, syncActivitiesGapQuery, isActivitiesGapQueryValue } from './shared/route-query.js';
import { rowMatchesActivityGapFilter } from './shared/activity-gap-filter.js';
import { renderActivitiesViewSwitcher, bindActivitiesViewSwitcher } from './shared/view-switcher.js';
import { ACTIVITY_SEASON_OPTIONS, ACTIVITY_SEASON_REGULAR, ACTIVITY_SEASON_SUMMER_2026, ACTIVITY_SEASON_SCHOOL_2027, getActivityPeriodKey, normalizeActivitySeason, normalizeGlobalActivityPeriod, globalActivityPeriodLabel } from './shared/summer-activity.js';
import { showToast } from './shared/toast.js';
import { canEditDirect, canAddActivityDirect, canRequestEdit, canRequestCreateActivity, canReviewRequests } from '../permissions.js';
const taasiyedaLogoSrc = new URL('../../assets/logo1.png', import.meta.url).href;

const inflightActivityDetailRequests = new Map();
const ADD_ACTIVITY_TYPE_ORDER = ['course', 'workshop', 'escape_room', 'tour', 'after_school'];

const ALL_ACTIVITIES_TAB_KEY = 'all_activities';
const ACTIVITIES_INNER_TAB_ALL = 'year_all';
const ACTIVITIES_INNER_TAB_REGULAR_2026 = 'regular_2026';
const ACTIVITIES_INNER_TAB_SUMMER_2026 = 'summer_2026';
const ACTIVITIES_INNER_TAB_ARCHIVE = 'year_archive';
const ACTIVITIES_INNER_TAB_2027 = 'school_2027';
const ALL_ACTIVITIES_STATUS_FILTERS = [
  { key: 'all', label: 'הכל' },
  { key: 'open', label: 'פתוח' },
  { key: 'closed', label: 'סגור' },
  { key: 'undated', label: 'ללא תאריך' }
];
const ACTIVITY_PERIOD_TABS = [
  { key: ACTIVITY_SEASON_REGULAR, label: '2026', start: '2025-09-01', end: '2026-08-31' },
  { key: ACTIVITY_SEASON_SCHOOL_2027, label: '2027', start: '2026-09-01', end: '2027-08-31' }
];
const SUMMER_2026_DEFAULT_FROM = '2026-06-28';

function todayYmdForActivityDefaults() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const byType = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function defaultActivityPeriodTab() {
  return ACTIVITY_SEASON_REGULAR;
}
const INACTIVE_ACTIVITY_STATUSES = new Set(['סגור', 'נמחק', 'בוטל', 'closed', 'deleted', 'inactive', 'cancelled', 'canceled']);
const ACTIVITY_LAYOUT_SEASON = 'summer_2026';
const ACTIVITIES_ACCESS_ROLES = new Set([
  'operation_manager',
  'domain_manager',
  'activities_manager',
  'instructor_manager',
  'business_development_manager'
]);
const ACTIVITY_LAYOUT_ALLOWED_ROLES = new Set(['admin', ...ACTIVITIES_ACCESS_ROLES]);

function canDirectManageActivities(state) {
  return canEditDirect(state?.user);
}

function canAddActivities(state) {
  return canAddActivityDirect(state?.user);
}

function canRequestActivityChanges(state) {
  return canRequestEdit(state?.user);
}

function canRequestActivityCreate(state) {
  return canRequestCreateActivity(state?.user);
}

function canReviewActivityRequests(state) {
  return canReviewRequests(state?.user);
}

function canOpenCreateActivity(state) {
  return canAddActivities(state) || canRequestActivityCreate(state);
}

function normalizeActivityPeriodTab(value) {
  return normalizeGlobalActivityPeriod(value || defaultActivityPeriodTab());
}

function isAllActivitiesMode() {
  return false;
}

function normalizeAllActivitiesStatusFilter(value) {
  const key = String(value || '').trim();
  return ALL_ACTIVITIES_STATUS_FILTERS.some((filter) => filter.key === key) ? key : 'all';
}

function normalizedActivityStartDate(row = {}) {
  const value = String(row?.start_date ?? row?.date_start ?? '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function isInactiveActivityStatus(row = {}) {
  return INACTIVE_ACTIVITY_STATUSES.has(String(row?.status || '').trim().toLowerCase()) || INACTIVE_ACTIVITY_STATUSES.has(String(row?.status || '').trim());
}

function normalizedActivityStatus(row = {}) {
  const status = String(row?.status || '').trim();
  if (status === 'פעיל' || status.toLowerCase() === 'active' || status.toLowerCase() === 'open') return 'פתוח';
  if (status.toLowerCase() === 'closed') return 'סגור';
  return status;
}

function isDeletedActivity(row = {}) {
  const status = normalizedActivityStatus(row);
  return status === 'נמחק' || status.toLowerCase() === 'deleted';
}

function isClosedActivity(row = {}) {
  const status = normalizedActivityStatus(row);
  return status === 'סגור' || status.toLowerCase() === 'closed';
}

function isActiveActivity(row = {}) {
  return !isInactiveActivityStatus(row);
}

function activityPeriodKey(row = {}) {
  if (isDeletedActivity(row)) return 'deleted';
  if (!isActiveActivity(row) && !isClosedActivity(row)) return 'inactive';
  const period = getActivityPeriodKey(row);
  if (period === ACTIVITY_SEASON_SUMMER_2026 || period === ACTIVITY_SEASON_REGULAR) return ACTIVITY_SEASON_REGULAR;
  if (period === ACTIVITY_SEASON_SCHOOL_2027) return ACTIVITY_SEASON_SCHOOL_2027;
  return 'unknown';
}


function activityMatchesSelectedStartMonth(row = {}, ym = '') {
  const month = String(ym || '').trim().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return true;
  return normalizedActivityStartDate(row).slice(0, 7) === month;
}

function activityPeriodLabelForKey(key) {
  return ACTIVITY_PERIOD_TABS.find((tab) => tab.key === key)?.label || '';
}

function activityYearKey(row = {}) {
  const period = getActivityPeriodKey(row);
  if (period === ACTIVITY_SEASON_SUMMER_2026 || period === ACTIVITY_SEASON_REGULAR) return ACTIVITY_SEASON_REGULAR;
  if (period === ACTIVITY_SEASON_SCHOOL_2027) return ACTIVITY_SEASON_SCHOOL_2027;
  return '';
}

function activityPeriodRows(rows, periodKey) {
  const activeKey = normalizeActivityPeriodTab(periodKey);
  return (Array.isArray(rows) ? rows : []).filter((row) => activityYearKey(row) === activeKey);
}

function activeActivitiesYearRows(rows, yearKey) {
  return activityPeriodRows(rows, yearKey).filter((row) => !isDeletedActivity(row) && !isClosedActivity(row) && isActiveActivity(row));
}

function archivedActivitiesYearRows(rows, yearKey) {
  return activityPeriodRows(rows, yearKey).filter((row) => isClosedActivity(row));
}

function regular2026Rows(rows) {
  return activeActivitiesYearRows(rows, ACTIVITY_SEASON_REGULAR).filter((row) => getActivityPeriodKey(row) === ACTIVITY_SEASON_REGULAR);
}

function summer2026Rows(rows) {
  return activeActivitiesYearRows(rows, ACTIVITY_SEASON_REGULAR).filter((row) => getActivityPeriodKey(row) === ACTIVITY_SEASON_SUMMER_2026);
}

function activityInnerTabsForYear(yearKey) {
  if (yearKey === ACTIVITY_SEASON_SCHOOL_2027) {
    return [
      { key: ACTIVITIES_INNER_TAB_ALL, label: 'כל פעילויות 2027' },
      { key: ACTIVITIES_INNER_TAB_2027, label: 'פעילויות 2027' },
      { key: ACTIVITIES_INNER_TAB_ARCHIVE, label: 'ארכיון 2027' }
    ];
  }
  return [
    { key: ACTIVITIES_INNER_TAB_ALL, label: 'כל פעילויות 2026' },
    { key: ACTIVITIES_INNER_TAB_REGULAR_2026, label: 'שנת 2026' },
    { key: ACTIVITIES_INNER_TAB_SUMMER_2026, label: 'קיץ 2026' },
    { key: ACTIVITIES_INNER_TAB_ARCHIVE, label: 'ארכיון 2026' }
  ];
}

function normalizeActivitiesInnerTab(value, yearKey) {
  const key = String(value || '').trim();
  const tabs = activityInnerTabsForYear(yearKey);
  return tabs.some((tab) => tab.key === key) ? key : ACTIVITIES_INNER_TAB_ALL;
}

function activityRowsForInnerTab(rows, state = {}) {
  const yearKey = normalizeActivityPeriodTab(state.activityPeriodTab);
  const tabKey = normalizeActivitiesInnerTab(state.activitiesInnerTab, yearKey);
  if (tabKey === ACTIVITIES_INNER_TAB_ARCHIVE) return archivedActivitiesYearRows(rows, yearKey);
  if (yearKey === ACTIVITY_SEASON_SCHOOL_2027) return activeActivitiesYearRows(rows, yearKey);
  if (tabKey === ACTIVITIES_INNER_TAB_SUMMER_2026) return summer2026Rows(rows);
  if (tabKey === ACTIVITIES_INNER_TAB_REGULAR_2026) return regular2026Rows(rows);
  return activeActivitiesYearRows(rows, yearKey);
}

function allActivitiesRows(rows, state = {}) {
  const filter = normalizeAllActivitiesStatusFilter(state.allActivitiesStatusFilter);
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (isDeletedActivity(row)) return false;
    if (filter === 'open') return !isClosedActivity(row);
    if (filter === 'closed') return isClosedActivity(row);
    if (filter === 'undated') return !normalizedActivityStartDate(row);
    return true;
  });
}

function shouldApplyActivitiesMonthFilter(state = {}) {
  return activityPeriodUsesMonthNavigation(state);
}

function activityRowsForPeriodAndMonth(rows, state = {}) {
  const periodRows = activityRowsForInnerTab(rows, state);
  if (!shouldApplyActivitiesMonthFilter(state)) return periodRows;
  return periodRows.filter((row) => activityOccursInSelectedMonth(row, state.activitiesMonthYm));
}

function firstActivityMonthYm(rows) {
  const months = new Set();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    [
      normalizedActivityStartDate(row),
      String(row?.end_date ?? row?.date_end ?? '').trim().slice(0, 10),
      ...activityMeetingDates(row)
    ].forEach((date) => {
      const value = String(date || '').trim().slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) months.add(value.slice(0, 7));
    });
  });
  return [...months].sort()[0] || '';
}

function availableActivityMonthsForPeriod(rows, periodKey) {
  const pRows = activityPeriodRows(rows, periodKey);
  const months = new Set();
  pRows.forEach((row) => {
    [
      normalizedActivityStartDate(row),
      String(row?.end_date ?? row?.date_end ?? '').trim().slice(0, 10),
      ...activityMeetingDates(row)
    ].forEach((date) => {
      const val = String(date || '').trim().slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(val)) months.add(val.slice(0, 7));
    });
  });
  return [...months].sort().filter((ym) => pRows.some((row) => activityOccursInSelectedMonth(row, ym)));
}

function pickBestMonthForPeriod(rows, periodKey) {
  const available = availableActivityMonthsForPeriod(rows, periodKey);
  if (available.length === 0) {
    return periodKey === 'summer_2026' ? SUMMER_DEFAULT_MONTH_YM : '';
  }

  const current = currentYm();
  if (available.includes(current)) return current;

  const pastOrCurrent = available.filter((ym) => ym <= current);
  if (pastOrCurrent.length > 0) return pastOrCurrent[pastOrCurrent.length - 1];

  return available[0];
}

function ensureActivityPeriodMonth(state, rows, { force = false } = {}) {
  if (!activityPeriodUsesMonthNavigation(state)) return;

  // Summer "show all" mode: user explicitly chose to see all summer — don't override unless forced (tab change)
  if (!force && state.activitiesSummerShowAll && state.activityPeriodTab === 'summer_2026') return;

  const available = availableActivityMonthsForPeriod(rows, state.activityPeriodTab);

  if (available.length === 0) {
    state.activitiesMonthYm = state.activityPeriodTab === 'summer_2026' ? SUMMER_DEFAULT_MONTH_YM : '';
    return;
  }

  if (force || !state.activitiesMonthYm || !available.includes(state.activitiesMonthYm)) {
    state.activitiesMonthYm = pickBestMonthForPeriod(rows, state.activityPeriodTab);
  }
}

function allActivitiesStatusFilterHtml(state = {}) {
  if (!isAllActivitiesMode(state)) return '';
  const selected = normalizeAllActivitiesStatusFilter(state.allActivitiesStatusFilter);
  return `<select class="ds-input ds-input--sm ds-filter-select-inline ds-filter-select-inline--all-status" data-all-activities-status-filter aria-label="סינון סטטוס בכל הפעילויות" title="סטטוס" dir="rtl">
      ${ALL_ACTIVITIES_STATUS_FILTERS.map((filter) => `<option value="${escapeHtml(filter.key)}"${filter.key === selected ? ' selected' : ''}>${escapeHtml(filter.key === 'all' ? 'סטטוס: הכל' : filter.label)}</option>`).join('')}
    </select>`;
}

function activityPeriodUsesMonthNavigation(state = {}) {
  return false;
}

function activityPeriodTabsHtml(rows, activeYearKey, state = {}) {
  const yearKey = normalizeActivityPeriodTab(activeYearKey);
  const activeTab = normalizeActivitiesInnerTab(state.activitiesInnerTab, yearKey);
  const countFor = (tabKey) => activityRowsForInnerTab(rows, { ...state, activityPeriodTab: yearKey, activitiesInnerTab: tabKey }).length;
  return `<div class="ds-activities-period-tabs" role="tablist" aria-label="חלוקה פנימית לפעילויות ${escapeHtml(globalActivityPeriodLabel(yearKey))}" dir="rtl">
    ${activityInnerTabsForYear(yearKey).map((tab) => `<button type="button" class="ds-chip ds-chip--tab ds-activities-period-tab${tab.key === activeTab ? ' is-active' : ''}" role="tab" aria-selected="${tab.key === activeTab ? 'true' : 'false'}" data-activity-period-tab="${escapeHtml(tab.key)}">
      <span>${escapeHtml(tab.label)}</span><strong>${escapeHtml(String(countFor(tab.key)))}</strong>
    </button>`).join('')}
  </div>`;
}



function isAdminUser(state) {
  return state?.user?.role === 'admin';
}

function permissionFlagYes(value) {
  if (value === true || value === 1) return true;
  return ['yes', 'true', '1'].includes(String(value || '').trim().toLowerCase());
}

function currentUserRoutes(state) {
  if (Array.isArray(state?.user?.routes)) return state.user.routes;
  if (Array.isArray(state?.effectiveRoutes)) return state.effectiveRoutes;
  return Array.isArray(state?.routes) ? state.routes : [];
}

export function getActivitiesAccessDebug(state = {}) {
  const currentUser = state?.user || {};
  const role = String(currentUser.role || '').trim();
  const displayRole = String(currentUser.display_role || '').trim();
  const permissions = currentUser.permissions && typeof currentUser.permissions === 'object' ? currentUser.permissions : {};
  const routes = currentUserRoutes(state);
  const hasActivitiesAccess =
    role === 'admin' ||
    ACTIVITIES_ACCESS_ROLES.has(role) ||
    permissionFlagYes(currentUser.view_activities ?? permissions.view_activities) ||
    routes.includes('activities');
  const deniedReasons = [];
  if (!hasActivitiesAccess) {
    deniedReasons.push('role is not admin or an allowed activities role');
    deniedReasons.push('permissions.view_activities is not yes');
    deniedReasons.push('user.routes/state routes do not include activities');
  }
  return {
    currentUser,
    username: currentUser.username,
    role,
    displayRole,
    permissions,
    routes,
    hasActivitiesAccess,
    reasonDenied: deniedReasons.join('; ')
  };
}

function logActivitiesAccess(state) {
  const debug = getActivitiesAccessDebug(state);
  console.info('[activities-access]', {
    username: debug.username,
    role: debug.role,
    permissions: debug.permissions,
    routes: debug.routes,
    hasActivitiesAccess: debug.hasActivitiesAccess,
    reasonDenied: debug.reasonDenied
  });
  return debug;
}

function normalizeAdminSummaryText(value) {
  return humanDisplayText(value);
}

function normalizeAdminSummarySearchText(value) {
  return normalizeAdminSummaryText(value).toLowerCase().replace(/[\s_\-]+/g, '');
}

function normalizeAdminActivityType(value) {
  const raw = normalizeAdminSummaryText(value);
  const compact = normalizeAdminSummarySearchText(raw);
  if (['course', 'courses', 'קורס', 'קורסים'].includes(compact)) return { key: 'course', label: 'קורסים' };
  if (['workshop', 'workshops', 'סדנה', 'סדנאות'].includes(compact)) return { key: 'workshop', label: 'סדנאות' };
  if (['tour', 'tours', 'סיור', 'סיורים', 'טיול', 'טיולים'].includes(compact)) return { key: 'tour', label: 'סיורים' };
  if (['afterschool', 'after_school', 'חוגאפטרסקול', 'אפטרסקול'].map(normalizeAdminSummarySearchText).includes(compact)) {
    return { key: 'after_school', label: 'אפטרסקול' };
  }
  return { key: 'other', label: raw || 'אחר' };
}

const ADMIN_SUMMARY_TYPES = [
  { key: 'course', label: 'קורסים' },
  { key: 'workshop', label: 'סדנאות' },
  { key: 'tour', label: 'סיורים' },
  { key: 'after_school', label: 'אפטרסקול' }
];
const ADMIN_SUMMARY_TYPE_LABEL_BY_KEY = Object.fromEntries(ADMIN_SUMMARY_TYPES.map((item) => [item.key, item.label]));
const ADMIN_SUMMARY_DEDUPE_ID_FIELDS = ['RowID', 'row_id', 'source_row_id'];
const ADMIN_SUMMARY_DEDUPE_FALLBACK_FIELDS = ['activity_name', 'activity_type', 'school', 'authority', 'start_date', 'end_date'];

function adminSummaryDedupeKey(row = {}) {
  for (const field of ADMIN_SUMMARY_DEDUPE_ID_FIELDS) {
    const value = normalizeAdminSummaryText(row?.[field]);
    if (value) return `id:${field}:${value}`;
  }
  return `fallback:${ADMIN_SUMMARY_DEDUPE_FALLBACK_FIELDS.map((field) => normalizeAdminSummarySearchText(row?.[field])).join('|')}`;
}

function uniqueAdminSummaryRows(rows) {
  const seen = new Set();
  const unique = [];
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const key = adminSummaryDedupeKey(row);
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(row);
  });
  return unique;
}

function createAdminSummaryBucket(label) {
  return {
    label,
    counts: { course: 0, workshop: 0, tour: 0, after_school: 0, other: 0, total: 0 },
    byName: new Map()
  };
}

function displayActivityName(row = {}) {
  return normalizeAdminSummaryText(row.activity_name || row.title || row.name || row.program_name) || 'ללא שם פעילות';
}

function addRowToAdminSummaryBucket(bucket, row = {}) {
  const type = normalizeAdminActivityType(row.activity_type || row.activity_family || row.type);
  const name = displayActivityName(row);
  bucket.counts.total += 1;
  bucket.counts[type.key] = (bucket.counts[type.key] || 0) + 1;
  const detailKey = `${name}|${type.key}`;
  const existing = bucket.byName.get(detailKey) || { name, typeKey: type.key, typeLabel: type.label, count: 0 };
  existing.count += 1;
  bucket.byName.set(detailKey, existing);
}

function buildAdminActivitiesSummary(rows, settings = {}) {
  void settings;
  const total = createAdminSummaryBucket('');
  uniqueAdminSummaryRows(rows).forEach((row) => {
    addRowToAdminSummaryBucket(total, row);
  });
  return { total };
}

function adminSummaryCountsHtml(bucket) {
  const other = Number(bucket?.counts?.other || 0);
  return `<div class="ds-admin-summary__kpis">
    ${ADMIN_SUMMARY_TYPES.map(({ key, label }) => `<div class="ds-admin-summary__kpi"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(bucket?.counts?.[key] || 0))}</strong></div>`).join('')}
    ${other > 0 ? `<div class="ds-admin-summary__kpi"><span>אחר</span><strong>${escapeHtml(String(other))}</strong></div>` : ''}
    <div class="ds-admin-summary__kpi ds-admin-summary__kpi--total"><span>סה״כ כל הפעילויות</span><strong>${escapeHtml(String(bucket?.counts?.total || 0))}</strong></div>
  </div>`;
}

function adminSummaryDetailsHtml(bucket) {
  const rows = Array.from(bucket?.byName?.values?.() || [])
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'he'));
  if (!rows.length) return '<p class="ds-admin-summary__empty">אין פעילויות להצגה.</p>';
  return `<ul class="ds-admin-summary__details">
    ${rows.map((item) => {
      const typeLabel = ADMIN_SUMMARY_TYPE_LABEL_BY_KEY[item.typeKey] || item.typeLabel || 'אחר';
      return `<li><span>${escapeHtml(item.name)}</span><strong>${escapeHtml(String(item.count))} ${escapeHtml(typeLabel)}</strong></li>`;
    }).join('')}
  </ul>`;
}

function adminSummarySectionHtml(bucket) {
  return `<section class="ds-admin-summary__section ds-admin-summary__section--total" dir="rtl">
    ${adminSummaryCountsHtml(bucket)}
    <h3>פירוט לפי שם פעילות</h3>
    ${adminSummaryDetailsHtml(bucket)}
  </section>`;
}

function adminSummaryLoadingHtml() {
  return '<div class="ds-admin-summary" dir="rtl"><p class="ds-admin-summary__loading">טוען סיכום…</p></div>';
}

function adminSummaryErrorHtml() {
  return '<div class="ds-admin-summary" dir="rtl"><p class="ds-admin-summary__error">לא ניתן לטעון את סיכום האדמין כרגע</p></div>';
}

export function renderAdminActivitiesSummary(rows, settings = {}) {
  const summary = buildAdminActivitiesSummary(rows, settings);
  return `<div class="ds-admin-summary" dir="rtl">
    <header class="ds-admin-summary__intro">
      <h2>סיכום אדמין – כלל הפעילויות</h2>
      <p>הסיכום מבוסס על כלל הפעילויות שהוחזרו מהמערכת, ללא סינון חודש או סטטוס.</p>
    </header>
    ${adminSummarySectionHtml(summary.total)}
  </div>`;
}

const ACTIVITIES_SCOPE = 'activities';

/** מפרסר את linked_schools_json בבטחה — מחזיר מערך. */
function parseLinkedSchoolsJson(row) {
  const raw = row?.linked_schools_json;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.startsWith('[')) {
    try { return JSON.parse(raw); } catch (_) { return []; }
  }
  return [];
}

/**
 * מחזיר את כל שמות בתי הספר לפעילות (כולל מרובי שיוך).
 * משמש גם לפילטר (getValues) וגם לחיפוש.
 */
function getActivitySchoolNames(row) {
  const names = new Set();
  parseLinkedSchoolsJson(row).forEach((s) => {
    const n = humanDisplayText(s?.school_name);
    if (n) names.add(n);
  });
  const lsn = humanDisplayText(row?.linked_school_names);
  if (lsn) lsn.split(/\s*\+\s*|\s*[,،]\s*/).forEach((n) => { const t = humanDisplayText(n); if (t) names.add(t); });
  const ssn = humanDisplayText(row?.single_school_name);
  if (ssn) names.add(ssn);
  const ls = humanDisplayText(row?.legacy_school || row?.school);
  if (ls) names.add(ls);
  return Array.from(names);
}

/**
 * שם בית ספר / מסגרת לתצוגה.
 * עדיפות: linked_school_names > single_school_name > school/legacy_school > 'לא משויך'
 * אין לסנן לפי school_id — פעילות עם school טקסטואלי בלבד תוצג כרגיל.
 */
function getActivitySchoolDisplayName(row) {
  const lsn = humanDisplayText(row?.linked_school_names);
  if (lsn) return lsn;
  const ssn = humanDisplayText(row?.single_school_name);
  if (ssn) return ssn;
  const ls = humanDisplayText(row?.school || row?.legacy_school);
  return ls || 'לא משויך';
}

const ACTIVITY_FILTER_FIELDS = [
  { key: 'activity_manager', label: 'מנהל פעילות', getValues: (row) => [activityManagerDisplayName(row?.activity_manager)] },
  { key: 'instructor', label: 'מדריך', getValues: (row) => [humanDisplayText(row?.instructor_name), humanDisplayText(row?.instructor_name_2)] },
  { key: 'activity_name', label: 'תוכנית', getValues: (row) => [humanDisplayText(row?.activity_name)] },
  { key: 'authority', label: 'רשות', getValues: (row) => [humanDisplayText(row?.authority)] },
  { key: 'funding', label: 'מימון' },
  { key: 'school', label: 'בית ספר', getValues: getActivitySchoolNames },
  { key: 'activity_type', label: 'סוג הפעילות', getOptionLabel: (value) => visibleActivityCategoryLabel(value) }
];
const ACTIVITY_SEARCH_FIELDS = [
  'id', 'RowID', 'row_id', 'source_row_id',
  'activity_no', 'activity_number', 'activity_name', 'name', 'title', 'program_name', 'activity_type', 'activity_family',
  'activity_manager', 'manager_name',
  'instructor_name', 'instructor_name_2', 'Instructor', 'Instructor2',
  'emp_id', 'emp_id_2', 'EmployeeID', 'EmployeeID2',
  'authority', 'school', 'single_school_name', 'linked_school_names', 'legacy_school', 'grade', 'class_group', 'group', 'class',
  'funding', 'status', 'single_semel_mosad', 'linked_semel_mosad_list',
  'start_date', 'end_date', 'date_1', 'meeting_dates', 'date_cols',
  'notes', 'description',
  (row) => getActivitySchoolNames(row).join(' '),
  (row) => Array.from({ length: 30 }, (_, i) => row?.[`date_${i + 1}`]).filter(Boolean).join(' '),
  (row) => Array.isArray(row?.meeting_dates) ? row.meeting_dates.join(' ') : '',
  (row) => Array.isArray(row?.date_cols) ? row.date_cols.join(' ') : ''
];

/** שם תצוגה למדריך/ים — כולל כינויים מה־API ומ־normalizeData (Employee וכו'). */
function activityInstructorMeta(row, opts = {}) {
  const hideEmpIds = !!opts.hideEmpIds;
  const instructorByEmpId = opts.instructorByEmpId || {};
  const n1 = humanDisplayText(row?.instructor_name ?? row?.Instructor ?? row?.Employee);
  const n2 = humanDisplayText(row?.instructor_name_2 ?? row?.Instructor2 ?? row?.Employee2);
  const e1 = String(row?.emp_id ?? row?.EmployeeID ?? row?.employee_id ?? '').trim();
  const e2 = String(row?.emp_id_2 ?? row?.EmployeeID2 ?? row?.employee_id_2 ?? '').trim();
  const names = [
    n1 || instructorByEmpId[e1] || '',
    n2 || instructorByEmpId[e2] || ''
  ].filter(Boolean);
  const empIds = [e1, e2].filter(Boolean);
  if (names.length) {
    return { text: names.join(' · '), hasInstructor: true, hasName: true, hasEmpId: empIds.length > 0 };
  }
  if (empIds.length) {
    return {
      text: '',
      hasInstructor: true,
      hasName: false,
      hasEmpId: true
    };
  }
  return { text: '', hasInstructor: false, hasName: false, hasEmpId: false };
}

const FAMILY_LABEL_SHORT = 'חד-יומיות';
const FAMILY_LABEL_LONG  = 'תוכניות';
const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, '0');
  const m = i % 2 === 0 ? '00' : '30';
  return `${h}:${m}`;
});
const GENERIC_ONE_DAY_ACTIVITY_NAMES = new Set(['סדנה', 'סדנאות', 'סיור', 'סיורים', 'חדר בריחה', 'חדרי בריחה']);
function isOneDayActivityTypeValue(value) {
  return Boolean(normalizeOneDayActivityType(value));
}

function optionsHtml(values, selected = '', placeholder = '—', labelFn = null) {
  const safeSelected = String(selected || '');
  const uniq = [];
  const seen = new Set();
  (Array.isArray(values) ? values : []).forEach((v) => {
    const s = String(v || '').trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    uniq.push(s);
  });
  if (safeSelected && !seen.has(safeSelected)) uniq.unshift(safeSelected);
  return [`<option value="">${escapeHtml(placeholder)}</option>`]
    .concat(
      uniq.map((v) => `<option value="${escapeHtml(v)}"${v === safeSelected ? ' selected' : ''}>${escapeHtml(typeof labelFn === 'function' ? (labelFn(v) || v) : v)}</option>`)
    )
    .join('');
}

function activitySeasonOptions(settings = {}) {
  const fromSettings = Array.isArray(settings?.dropdown_options?.activity_season)
    ? settings.dropdown_options.activity_season
    : [];
  const normalized = fromSettings
    .map((item) => {
      if (typeof item === 'string') {
        const value = normalizeActivitySeason(item);
        const fallback = ACTIVITY_SEASON_OPTIONS.find((option) => option.value === value);
        return fallback || { value, label: value };
      }
      const value = normalizeActivitySeason(item?.value);
      const fallback = ACTIVITY_SEASON_OPTIONS.find((option) => option.value === value);
      return { value, label: String(item?.label || fallback?.label || value).trim() };
    })
    .filter((item) => item.value);
  const list = normalized.length ? normalized : ACTIVITY_SEASON_OPTIONS;
  const seen = new Set();
  return list.filter((item) => {
    if (seen.has(item.value)) return false;
    seen.add(item.value);
    return true;
  });
}

function activitySeasonSelectHtml(settings = {}, selected = 'regular') {
  const safeSelected = normalizeActivitySeason(selected);
  return activitySeasonOptions(settings)
    .map((option) => `<option value="${escapeHtml(option.value)}"${option.value === safeSelected ? ' selected' : ''}>${escapeHtml(option.label)}</option>`)
    .join('');
}

function decodeJsonAttr(raw, fallback = []) {
  try {
    const decoded = decodeURIComponent(String(raw || ''));
    const parsed = JSON.parse(decoded || '[]');
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function mergeOptions(settings, keys) {
  const map = settings?.dropdown_options || {};
  const out = [];
  const seen = new Set();
  keys.forEach((k) => {
    const arr = Array.isArray(map[k]) ? map[k] : [];
    arr.forEach((v) => {
      const s = humanDisplayText(v);
      if (!s || seen.has(s)) return;
      seen.add(s);
      out.push(s);
    });
  });
  return out;
}

function datalistHtml(id, values) {
  if (!values.length) return '';
  return `<datalist id="${escapeHtml(id)}">${values.map((v) => `<option value="${escapeHtml(v)}">`).join('')}</datalist>`;
}


function instructorOptionsHtml(rosterUsers, selected = '', placeholder = '—') {
  const safeSelected = String(selected || '').trim();
  const valid = (Array.isArray(rosterUsers) ? rosterUsers : [])
    .map((u) => ({ name: humanDisplayText(u?.name), emp_id: String(u?.emp_id || '').trim() }))
    .filter((u) => u.name && u.emp_id);
  const seen = new Set();
  const unique = valid.filter((u) => {
    if (seen.has(u.emp_id)) return false;
    seen.add(u.emp_id);
    return true;
  });
  return [`<option value="">${escapeHtml(placeholder)}</option>`]
    .concat(unique.map((u) => `<option value="${escapeHtml(u.emp_id)}"${u.emp_id === safeSelected ? ' selected' : ''}>${escapeHtml(u.name)}</option>`))
    .join('');
}

function addActivityModalHtml(settings, activityPeriodTab = '') {
  const allActivityNames = getActivityCatalog(settings);
  const allTypes = ADD_ACTIVITY_TYPE_ORDER.slice();
  const rosterUsers = getValidInstructorUsers(settings);
  const managerRoleNames = getManagerUsers(settings);
  const fundingOptions = mergeOptions(settings, ['funding', 'fundings']);
  const gradeOptions = resolveGradeOptions(settings);
  const schoolRecords = Array.isArray(settings?.dropdown_options?.school_records) ? settings.dropdown_options.school_records : [];
  const schoolOptions = mergeOptions(settings, ['school', 'schools']);
  const authorityOptions = mergeOptions(settings, ['authority', 'authorities']);
  const managerOptions = managerRoleNames.length
    ? managerRoleNames
    : mergeOptions(settings, ['activity_manager', 'activity_managers']);
  const initialType = '';
  const initialActivityNames = [];
  const sessionsList = Array.from({ length: 35 }, (_, i) => String(i + 1));
  const initialSeason = activityPeriodTab === 'school_2027'
    ? ACTIVITY_SEASON_SCHOOL_2027
    : activityPeriodTab === 'summer_2026'
      ? ACTIVITY_SEASON_SUMMER_2026
      : ACTIVITY_SEASON_REGULAR;
  const statusOptions = initialSeason === ACTIVITY_SEASON_SCHOOL_2027
    ? ['בתהליך', 'מוכן לשיבוץ', 'סגור']
    : ['פתוח', 'מאושר - ממתין לשיבוץ', 'סגור'];
  const initialStatus = initialSeason === ACTIVITY_SEASON_SCHOOL_2027 ? 'בתהליך' : 'פתוח';

  const authorityField = `
    <div class="ds-activity-add-field ds-activity-add-field--entity" data-entity-field="authority">
      <div class="ds-activity-add-label-row">
        <span>רשות</span>
        <button type="button" class="ds-btn ds-btn--xs ds-btn--ghost" data-entity-toggle="authority">+ רשות חדשה</button>
      </div>
      <input class="ds-input" name="authority" type="text" list="add-authority-list" autocomplete="off" data-entity-select="authority">
      ${datalistHtml('add-authority-list', authorityOptions)}
      <input class="ds-input" name="authority_custom" type="text" placeholder="הזנת רשות חדשה" style="display:none" data-entity-custom="authority">
    </div>`;

  const schoolField = `
    <div class="ds-activity-add-field ds-activity-add-field--entity" data-entity-field="school">
      <div class="ds-activity-add-label-row">
        <span>בית ספר</span>
        <button type="button" class="ds-btn ds-btn--xs ds-btn--ghost" data-entity-toggle="school">+ בית ספר חדש</button>
      </div>
      <input class="ds-input" name="school" type="text" list="add-school-list" autocomplete="off" data-entity-select="school">
      ${datalistHtml('add-school-list', schoolOptions)}
      <input class="ds-input" name="school_custom" type="text" placeholder="הזנת בית ספר חדש" style="display:none" data-entity-custom="school">
    </div>`;

  return `
    <form class="ds-activity-add-form" dir="rtl" data-add-activity-form
      data-add-activity-names="${escapeHtml(encodeURIComponent(JSON.stringify(allActivityNames)))}"
      data-add-roster-users="${escapeHtml(encodeURIComponent(JSON.stringify(rosterUsers)))}"
      data-add-school-records="${escapeHtml(encodeURIComponent(JSON.stringify(schoolRecords)))}">
      <input type="hidden" name="source" value="catalog">
      <div class="ds-activity-add-grid">
        <p class="ds-activity-add-section">פרטי פעילות</p>
        <label class="ds-activity-add-field ds-activity-add-field--compact"><span>סוג פעילות</span>
          <select class="ds-input" name="activity_type" data-add-activity-type
            data-all-types="${escapeHtml(JSON.stringify(allTypes))}">
            ${optionsHtml(allTypes.map((type) => normalizeActivityTypeKey(type) || type), '', 'בחרו סוג פעילות', activityTypeDisplayLabel)}
          </select>
        </label>
        <label class="ds-activity-add-field ds-activity-add-field--wide"><span>שם פעילות</span>
          <select class="ds-input" name="activity_name" data-add-activity-name disabled>
            ${optionsHtml(initialActivityNames.map((o) => o.label), '', 'בחרו קודם סוג פעילות')}
          </select>
        </label>
        <input type="hidden" name="activity_no" value="" data-add-activity-no>
        <label class="ds-activity-add-field ds-activity-add-field--compact" data-field-sessions><span>מספר מפגשים</span><select class="ds-input" name="sessions" data-add-sessions>${optionsHtml(sessionsList, '1')}</select></label>
        ${initialSeason === ACTIVITY_SEASON_SCHOOL_2027
          ? `<input type="hidden" name="activity_season" value="${escapeHtml(ACTIVITY_SEASON_SCHOOL_2027)}">`
          : `<label class="ds-activity-add-field ds-activity-add-field--compact"><span>עונת פעילות</span><select class="ds-input" name="activity_season">${activitySeasonSelectHtml(settings, initialSeason)}</select></label>`
        }
        <label class="ds-activity-add-field ds-activity-add-field--compact"><span>סטטוס</span><select class="ds-input" name="status">${optionsHtml(statusOptions, initialStatus)}</select></label>
        <label class="ds-activity-add-field ds-activity-add-field--compact"><span>מימון</span><select class="ds-input" name="funding">${optionsHtml(fundingOptions)}</select></label>
        <label class="ds-activity-add-field ds-activity-add-field--compact"><span>מחיר</span><input class="ds-input" name="price" type="number" min="0" step="1"></label>
        <label class="ds-activity-add-field"><span>קבוצה / כיתה</span><input class="ds-input" name="class_group" type="text"></label>
        <label class="ds-activity-add-field"><span>כיתה / שכבה</span><select class="ds-input" name="grade">${optionsHtml(gradeOptions, '', '— בחרו כיתה —')}</select></label>
        ${authorityField}
        ${schoolField}

        <label class="ds-activity-add-field" data-participants-count-section hidden><span>מספר משתתפים מעודכן</span><input class="ds-input" name="participants_count" type="number" min="1" step="1" inputmode="numeric" data-participants-count-input></label>

        <p class="ds-activity-add-section">תאריכים ושעות</p>
        <label class="ds-activity-add-field ds-activity-add-field--compact"><span>שעת התחלה</span><select class="ds-input" name="start_time">${optionsHtml(TIME_OPTIONS)}</select></label>
        <label class="ds-activity-add-field ds-activity-add-field--compact"><span>שעת סיום</span><select class="ds-input" name="end_time">${optionsHtml(TIME_OPTIONS)}</select></label>
        <label class="ds-activity-add-field ds-activity-add-field--compact" data-field-start-date><span>תאריך התחלה</span><input class="ds-input" name="start_date" type="date"></label>
        <label class="ds-activity-add-field ds-activity-add-field--compact" data-field-end-date><span>תאריך סיום</span><input class="ds-input" name="end_date" type="date"></label>
        <label class="ds-activity-add-field ds-activity-add-field--compact" data-field-one-day-date style="display:none"><span>תאריך הפעילות</span><input class="ds-input" name="one_day_date" type="date"></label>
        <div class="ds-activity-add-field ds-activity-add-field--span2" data-add-date-rows-wrap>
          <span>תאריכי מפגשים</span>
          <div class="ds-activity-add-date-rows" data-add-date-rows></div>
        </div>

        <p class="ds-activity-add-section">צוות וניהול</p>
        <label class="ds-activity-add-field"><span>מנהל פעילות</span><select class="ds-input" name="activity_manager">${optionsHtml(managerOptions, '', NO_ACTIVITY_MANAGER_LABEL)}</select></label>
        <label class="ds-activity-add-field"><span>מדריך/ה ראשי/ת</span><select class="ds-input" name="emp_id" data-add-instructor>${instructorOptionsHtml(rosterUsers)}</select></label>
        <label class="ds-activity-add-field" data-field-instructor2><span>מדריך/ה נוסף/ת (אופציונלי)</span><select class="ds-input" name="emp_id_2" data-add-instructor-2>${instructorOptionsHtml(rosterUsers)}</select></label>

        <p class="ds-activity-add-section">הערות</p>
        <label class="ds-activity-add-field ds-activity-add-field--span2"><span>הערות</span><textarea class="ds-input" name="notes" rows="2"></textarea></label>
      </div>
      <button type="submit" hidden aria-hidden="true"></button>
      <p class="ds-muted" role="status" data-add-activity-status></p>
    </form>
  `;
}

function resolveOneDayTypes(settings) {
  const legacy = getActivityTypesByFamily(settings, 'short');
  return Array.isArray(legacy) ? legacy : [];
}

function normalizeQuickFilterText(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s_\-]+/g, '');
}

function isShortFamily(row, oneDayTypes) {
  const type = String(row?.activity_type || '').trim();
  const family = normalizeQuickFilterText(row?.activity_family);
  const source = normalizeQuickFilterText(row?.source);
  if (family === 'oneday' || source === 'short') return true;
  if (family === 'program' || source === 'long') return false;
  return oneDayTypes.includes(type);
}

function matchesQuickDistrictOrManager(row = {}, quickValue = '') {
  const wanted = String(quickValue || '').trim();
  if (!wanted) return true;
  return [row.district, row.manager_district, row.activity_manager_district, row.activity_manager]
    .some((value) => String(value || '').trim() === wanted);
}

function isEndingInMonth(row = {}, ym = '') {
  const month = String(ym || '').slice(0, 7);
  return /^\d{4}-\d{2}$/.test(month) && String(row?.end_date || row?.date_end || '').slice(0, 7) === month;
}

function selectedMonthRange(ym = '') {
  const month = String(ym || '').trim().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  return {
    month,
    start: `${month}-01`,
    end: `${month}-${String(lastDay).padStart(2, '0')}`
  };
}

function normalizedActivityDateValue(value) {
  const date = String(value || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

function activityMeetingDates(row = {}) {
  const dates = [];
  const addDate = (value) => {
    const date = normalizedActivityDateValue(value);
    if (date && !dates.includes(date)) dates.push(date);
  };
  const meetingDates = Array.isArray(row?.meeting_dates) ? row.meeting_dates : [];
  const dateCols = Array.isArray(row?.date_cols) ? row.date_cols : [];
  [...meetingDates, ...dateCols].forEach(addDate);
  for (let i = 1; i <= 35; i++) {
    addDate(row?.[`date_${i}`]);
    addDate(row?.[`Date${i}`]);
  }
  return dates;
}

function activityOccursInSelectedMonth(row = {}, ym = '') {
  const range = selectedMonthRange(ym);
  if (!range) return true;
  const start = normalizedActivityDateValue(row?.start_date ?? row?.date_start);
  const end = normalizedActivityDateValue(row?.end_date ?? row?.date_end);
  const dates = [start, end, ...activityMeetingDates(row)].filter(Boolean);
  if (dates.length > 0) return dates.some((date) => date >= range.start && date <= range.end);
  return false;
}

function applySelectedActivitiesMonth(rows, state) {
  return (Array.isArray(rows) ? rows : []).filter((row) => activityOccursInSelectedMonth(row, state?.activitiesMonthYm));
}

function currentYm() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function shiftYm(ym, delta) {
  const base = /^(\d{4})-(\d{2})$/.exec(String(ym || '').trim());
  const d = base ? new Date(Number(base[1]), Number(base[2]) - 1, 1) : new Date();
  d.setMonth(d.getMonth() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || '').trim());
  if (!m) return '';
  return `${m[1]}-${m[2]}`;
}

const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
function heMonthLabel(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || '').trim());
  if (!m) return monthLabel(ym);
  return HE_MONTHS[Number(m[2]) - 1] || monthLabel(ym);
}

function applyClientFilters(rows, state, settings) {
  let out = Array.isArray(rows) ? rows.slice() : [];
  const oneDayTypes = resolveOneDayTypes(settings);
  if (state.activityQuickFamily === 'short') {
    out = out.filter((row) => isShortFamily(row, oneDayTypes));
  } else if (state.activityQuickFamily === 'long') {
    out = out.filter((row) => !isShortFamily(row, oneDayTypes));
  }
  if (state.activityQuickManager) {
    out = out.filter((row) => matchesQuickDistrictOrManager(row, state.activityQuickManager));
  }
  if (state.activityEndingCurrentMonth && !isAllActivitiesMode(state)) {
    out = out.filter((row) => isEndingInMonth(row, state.activitiesMonthYm));
  }
  return out;
}


function compareActivityDefaultOrder(a, b) {
  const collator = compareActivityDefaultOrder._collator || (compareActivityDefaultOrder._collator = new Intl.Collator('he', { sensitivity: 'base', numeric: true }));
  const text = (row, key) => String(row?.[key] || '').trim();
  const byAuthority = collator.compare(text(a, 'authority'), text(b, 'authority'));
  if (byAuthority) return byAuthority;
  const bySchool = collator.compare(text(a, 'school'), text(b, 'school'));
  if (bySchool) return bySchool;
  const instructorA = String(a?.instructor_name || a?.Instructor || a?.instructor_name_2 || a?.Instructor2 || '').trim();
  const instructorB = String(b?.instructor_name || b?.Instructor || b?.instructor_name_2 || b?.Instructor2 || '').trim();
  const byInstructor = collator.compare(instructorA, instructorB);
  if (byInstructor) return byInstructor;
  const byName = collator.compare(displayActivityName(a), displayActivityName(b));
  if (byName) return byName;
  return String(a?.start_date || '').localeCompare(String(b?.start_date || ''));
}

function applyActivitiesGapFilter(rows, gapFilter) {
  const gap = String(gapFilter || '').trim();
  if (!isActivitiesGapQueryValue(gap)) return rows;
  return rows.filter((row) => rowMatchesActivityGapFilter(row, gap));
}

function applyActivitiesLocalFilters(rows, state, settings) {
  const filters = ensureActivityListFilters(state, ACTIVITIES_SCOPE);
  const familyRows = applyClientFilters(rows, state, settings);
  const gapRows = applyActivitiesGapFilter(familyRows, state.activitiesGapFilter);
  prepareRowsForSearch(gapRows, ACTIVITY_SEARCH_FIELDS);
  return applyLocalFilters(gapRows, filters, { filterFields: ACTIVITY_FILTER_FIELDS }).sort(compareActivityDefaultOrder);
}

function buildActivitiesDiagnostics(allRows, state, finalRows) {
  const loaded = Array.isArray(allRows) ? allRows : [];
  const afterStatus = loaded.filter((row) => !isDeletedActivity(row));
  const afterPeriod = isAllActivitiesMode(state) ? allActivitiesRows(loaded, state) : activityPeriodRows(loaded, state.activityPeriodTab);
  const afterMonth = activityRowsForPeriodAndMonth(loaded, state);
  return {
    loaded: loaded.length,
    afterStatus: afterStatus.length,
    afterPeriod: afterPeriod.length,
    afterMonth: afterMonth.length,
    afterFilters: Array.isArray(finalRows) ? finalRows.length : 0
  };
}

function activitiesDiagnosticsHtml(diag) {
  return `<div class="ds-activities-diagnostics" dir="rtl" data-activities-diagnostics>
    <strong>אבחון טעינת פעילויות:</strong>
    <span>נטענו מ-Supabase: ${escapeHtml(String(diag.loaded))}</span>
    <span>אחרי סינון סטטוס: ${escapeHtml(String(diag.afterStatus))}</span>
    <span>אחרי סינון תקופה: ${escapeHtml(String(diag.afterPeriod))}</span>
    <span>אחרי סינון חודש: ${escapeHtml(String(diag.afterMonth))}</span>
    <span>אחרי חיפוש/פילטרים: ${escapeHtml(String(diag.afterFilters))}</span>
  </div>`;
}

function activityDrawerContent(row, canSeePrivateNotes, canEdit, canDirectEdit, canRequestEdit, canDeleteActivity, hideEmpIds, hideRowId, hideActivityNo, settings, { datesLoading = false } = {}) {
  const privateNote = canSeePrivateNotes ? row.private_note || '—' : null;
  return activityWorkDrawerHtml(row, {
    privateNote,
    canEdit,
    canDirectEdit,
    canRequestEdit,
    canDeleteActivity,
    hideEmpIds: !!hideEmpIds,
    hideRowId,
    hideActivityNo,
    settings,
    showFinance: false,
    showFinanceFields: false,
    datesLoading
  });
}

function editRequestStatusLabel(status) {
  if (status === 'pending') return 'בקשת עריכה ממתינה';
  if (status === 'approved') return 'בקשת העריכה אושרה';
  if (status === 'rejected') return 'בקשת העריכה נדחתה';
  if (status === 'conflict') return 'בקשת העריכה בקונפליקט';
  return '';
}

function buildFallbackOptionsFromRows(rows) {
  const uniqueField = (field) => {
    const seen = new Set();
    const out = [];
    rows.forEach((row) => {
      const v = String(row?.[field] || '').trim();
      if (v && !seen.has(v)) { seen.add(v); out.push(v); }
    });
    return out.sort((a, b) => a.localeCompare(b, 'he'));
  };
  const instructorNames = (() => {
    const seen = new Set();
    const out = [];
    rows.forEach((row) => {
      [row?.instructor_name, row?.instructor_name_2].forEach((v) => {
        const s = String(v || '').trim();
        if (s && !seen.has(s)) { seen.add(s); out.push(s); }
      });
    });
    return out.sort((a, b) => a.localeCompare(b, 'he'));
  })();
  const activityNameOptions = (() => {
    const seen = new Set();
    const out = [];
    rows.forEach((row) => {
      const label = String(row?.activity_name || '').trim();
      const type  = String(row?.activity_type  || '').trim();
      const sig   = `${label}|${normalizeActivityTypeKey(type) || type}`;
      if (!label || seen.has(sig)) return;
      seen.add(sig);
      out.push({
        label,
        activity_no:   String(row?.activity_no || '').trim(),
        activity_type: type,
        parent_value:  type
      });
    });
    return out.sort((a, b) => a.label.localeCompare(b.label, 'he'));
  })();
  const allActivityTypes = uniqueField('activity_type');
  const oneDayTypesFromRows = cleanUnique(rows
    .filter((row) => String(row?.activity_family || '').trim() === 'one_day' || String(row?.source || '').trim() === 'short')
    .map((row) => String(row?.activity_type || '').trim())
    .filter(Boolean));
  const programTypesFromRows = cleanUnique(rows
    .filter((row) => String(row?.activity_family || '').trim() !== 'one_day' && String(row?.source || '').trim() !== 'short')
    .map((row) => String(row?.activity_type || '').trim())
    .filter(Boolean));
  return {
    _activityTypesFromRows: allActivityTypes,
    _oneDayActivityTypesFromRows: oneDayTypesFromRows,
    _programActivityTypesFromRows: programTypesFromRows,
    funding: uniqueField('funding'),
    fundings: uniqueField('funding'),
    grade: uniqueField('grade'),
    grades: uniqueField('grade'),
    school: uniqueField('school'),
    schools: uniqueField('school'),
    authority: uniqueField('authority'),
    authorities: uniqueField('authority'),
    activity_manager: uniqueField('activity_manager'),
    activity_managers: uniqueField('activity_manager'),
    instructor_name: instructorNames,
    instructor_names: instructorNames,
    activity_names: activityNameOptions
  };
}

function mergeSettingsWithFallback(base, fallbackOpts) {
  const baseOpts = (base && base.dropdown_options && typeof base.dropdown_options === 'object')
    ? base.dropdown_options : {};
  const merged = { ...baseOpts };
  const {
    _activityTypesFromRows,
    _oneDayActivityTypesFromRows,
    _programActivityTypesFromRows,
    ...dropdownFallback
  } = fallbackOpts;
  Object.keys(dropdownFallback).forEach((k) => {
    const existing = Array.isArray(baseOpts[k]) ? baseOpts[k] : [];
    if (!existing.length && Array.isArray(dropdownFallback[k]) && dropdownFallback[k].length) {
      merged[k] = dropdownFallback[k];
    }
  });
  const result = { ...base, dropdown_options: merged };
  if (Array.isArray(_activityTypesFromRows) && _activityTypesFromRows.length) {
    const hasShort = Array.isArray(base?.one_day_activity_types) && base.one_day_activity_types.length;
    const hasLong  = Array.isArray(base?.program_activity_types)  && base.program_activity_types.length;
    if (!hasShort) {
      result.one_day_activity_types = Array.isArray(_oneDayActivityTypesFromRows) && _oneDayActivityTypesFromRows.length
        ? _oneDayActivityTypesFromRows
        : [];
    }
    if (!hasLong) {
      result.program_activity_types = Array.isArray(_programActivityTypesFromRows) && _programActivityTypesFromRows.length
        ? _programActivityTypesFromRows
        : _activityTypesFromRows;
    }
  }
  return result;
}

function activityDetailCacheKey(summaryRow) {
  return `activityDetail:${summaryRow.source_sheet || ''}:${summaryRow.RowID || ''}`;
}

function getCachedActivityDetail(summaryRow, s) {
  const entry = s?.screenDataCache?.[activityDetailCacheKey(summaryRow)];
  return entry ? entry.data : null;
}

function putCachedActivityDetail(summaryRow, row, s) {
  if (s?.screenDataCache) {
    s.screenDataCache[activityDetailCacheKey(summaryRow)] = { data: row, t: Date.now() };
  }
}

function activityDatesCacheKey(summaryRow) {
  return `activityDates:${summaryRow.source_sheet || ''}:${summaryRow.RowID || ''}`;
}

function getCachedActivityDates(summaryRow, s) {
  const entry = s?.screenDataCache?.[activityDatesCacheKey(summaryRow)];
  return entry ? entry.data : null;
}

function putCachedActivityDates(summaryRow, data, s) {
  if (s?.screenDataCache) {
    s.screenDataCache[activityDatesCacheKey(summaryRow)] = { data, t: Date.now() };
  }
}

/**
 * Returns the nearest upcoming meeting date (today or future) from a row's date columns.
 * Returns '' if all dates have passed or none exist.
 */
function nextMeetingDate(row) {
  const today = new Date().toISOString().slice(0, 10);
  const dates = [];
  // Collect from meeting_dates / date_cols array (already normalised)
  const cols = Array.isArray(row?.meeting_dates) ? row.meeting_dates
    : Array.isArray(row?.date_cols) ? row.date_cols : [];
  for (const d of cols) {
    const s = String(d || '').trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) dates.push(s);
  }
  // Also scan date_1..date_35 / Date1..Date35 directly
  for (let i = 1; i <= 35; i++) {
    const v = row?.[`date_${i}`] || row?.[`Date${i}`] || '';
    const s = String(v).trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s) && !dates.includes(s)) dates.push(s);
  }
  if (!dates.length) return '';
  const future = dates.filter((d) => d >= today).sort();
  return future.length ? future[0] : '';
}

function canUseActivityLayout(state) {
  const role = String(state?.user?.role || '').trim();
  return ACTIVITY_LAYOUT_ALLOWED_ROLES.has(role);
}

function cleanText(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeTime(value) {
  const raw = cleanText(value);
  const match = raw.match(/(\d{1,2})[:.](\d{2})/);
  if (!match) return raw;
  return `${String(match[1]).padStart(2, '0')}:${match[2]}`;
}

function activityLayoutDate(row = {}) {
  const direct = cleanText(row.activity_date || row.date || row.start_date || row.date_start).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct;
  const cols = Array.isArray(row.meeting_dates) ? row.meeting_dates : Array.isArray(row.date_cols) ? row.date_cols : [];
  const first = cols.map((d) => cleanText(d).slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()[0];
  return first || '';
}

function activityLayoutStartTime(row = {}) {
  return normalizeTime(row.start_time || row.time_start || row.activity_start_time || row.hour_start || row.from_time);
}

function activityLayoutEndTime(row = {}) {
  return normalizeTime(row.end_time || row.time_end || row.activity_end_time || row.hour_end || row.to_time);
}

function activityLayoutInstructors(row = {}) {
  return [row.instructor_name, row.instructor_name_2, row.Instructor, row.Instructor2]
    .map(cleanText)
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .join(', ');
}

function activityLayoutClassGroup(row = {}) {
  const grade = cleanText(row.grade || row.Grade || row.school_grade || row.class_grade || row.layer || row.class_layer);
  const classGroup = cleanText(row.class_group || row.classGroup || row.group || row.group_name || row.class_name || row.class);
  const formatGrade = (value) => {
    if (!value) return '';
    if (/^כיתה(?:\s|$)/.test(value)) return value;
    return `כיתה ${value}`;
  };
  const formatGroup = (value) => {
    if (!value) return '';
    if (/^(?:קבוצה|כיתה)(?:\s|$)/.test(value)) return value;
    return `קבוצה ${value}`;
  };
  return [formatGrade(grade), formatGroup(classGroup)].filter(Boolean).join(' / ');
}

function isActivityLayoutRowComplete(row = {}) {
  return Boolean(
    cleanText(row.school) &&
    cleanText(row.authority) &&
    cleanText(row.activity_season || row.season || row.activity_period || ACTIVITY_LAYOUT_SEASON) &&
    activityLayoutDate(row) &&
    activityLayoutStartTime(row) &&
    activityLayoutEndTime(row) &&
    (cleanText(row.grade || row.Grade || '') || cleanText(row.class_group || row.group || '')) &&
    cleanText(row.activity_name) &&
    activityLayoutInstructors(row)
  );
}

function formatActivityLayoutDate(date) {
  const raw = cleanText(date).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const [y, m, d] = raw.split('-');
  return `${d}.${m}.${y}`;
}

function formatActivityLayoutDateRange(dates = []) {
  const safe = dates.filter(Boolean).sort();
  if (!safe.length) return '—';
  const first = formatActivityLayoutDate(safe[0]);
  const last = formatActivityLayoutDate(safe[safe.length - 1]);
  return first === last ? first : `${first}–${last}`;
}

function activityLayoutStatusKey({ season = ACTIVITY_LAYOUT_SEASON, authority = '', school = '' } = {}) {
  return [season, authority, school].map(cleanText).join('||');
}

function localActivityLayoutStatuses() {
  try {
    const parsed = JSON.parse(localStorage.getItem('ds_activity_layout_statuses') || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalActivityLayoutStatus(row) {
  try {
    const rows = localActivityLayoutStatuses();
    const key = activityLayoutStatusKey(row);
    const next = rows.filter((item) => activityLayoutStatusKey(item) !== key);
    next.push(row);
    localStorage.setItem('ds_activity_layout_statuses', JSON.stringify(next));
  } catch {
    /* local persistence is best-effort fallback only */
  }
}

function normalizeActivityLayoutSent(value) {
  if (value === true || value === 1) return true;
  const raw = cleanText(value).toLowerCase();
  return raw === 'true' || raw === 'yes' || raw === '1' || raw === 'sent' || raw === 'נשלח';
}

function normalizeActivityLayoutStatusRow(row = {}) {
  return {
    ...row,
    season: cleanText(row.season || ACTIVITY_LAYOUT_SEASON) || ACTIVITY_LAYOUT_SEASON,
    authority: cleanText(row.authority),
    school: cleanText(row.school),
    sent: normalizeActivityLayoutSent(row.sent),
    sent_at: row.sent_at || '',
    sent_by: cleanText(row.sent_by)
  };
}

function activityLayoutStatusesMap(rows = []) {
  const map = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const normalized = normalizeActivityLayoutStatusRow(row);
    const key = activityLayoutStatusKey(normalized);
    if (key) map.set(key, normalized);
  });
  return map;
}

function readyActivityLayoutSchools(rows = [], statuses = []) {
  const groups = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const authority = cleanText(row.authority);
    const school = cleanText(row.school);
    if (!authority || !school) return;
    const key = activityLayoutStatusKey({ authority, school });
    if (!groups.has(key)) groups.set(key, { season: ACTIVITY_LAYOUT_SEASON, authority, school, rows: [], dates: [] });
    const group = groups.get(key);
    group.rows.push(row);
    const date = activityLayoutDate(row);
    if (date) group.dates.push(date);
  });
  const statusMap = activityLayoutStatusesMap(statuses);
  return [...groups.values()]
    .filter((group) => group.rows.length)
    .map((group) => ({
      ...group,
      count: group.rows.length,
      dateRange: formatActivityLayoutDateRange(group.dates),
      status: statusMap.get(activityLayoutStatusKey(group)) || null
    }))
    .sort((a, b) => cleanText(a.authority).localeCompare(cleanText(b.authority), 'he') || cleanText(a.school).localeCompare(cleanText(b.school), 'he'));
}

function activityLayoutActivityTypeLabel(row = {}) {
  const raw = String(row.activity_type || row.activity_family || row.type || '').trim();
  if (['escape_room', 'חדר בריחה', 'חדרי בריחה'].includes(raw)) return 'חדר בריחה';
  if (['workshop', 'workshops', 'סדנה', 'סדנאות'].includes(raw)) return 'סדנה';
  if (['tour', 'סיור', 'סיורים'].includes(raw)) return 'סיור';
  if (['after_school', 'חוג', 'חוגים'].includes(raw)) return 'חוג';
  return '';
}

function activityLayoutRowsForDocument(group) {
  return (Array.isArray(group?.rows) ? group.rows : [])
    .map((row) => ({
      date: activityLayoutDate(row),
      startTime: activityLayoutStartTime(row),
      endTime: activityLayoutEndTime(row),
      classGroup: activityLayoutClassGroup(row),
      activityName: cleanText(row.activity_name),
      activityTypeLabel: activityLayoutActivityTypeLabel(row),
      instructors: activityLayoutInstructors(row)
    }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.startTime).localeCompare(String(b.startTime)));
}

function cleanDocumentTitlePart(value) {
  return cleanText(value)
    .replace(/["“”]/g, '')
    .replace(/[\\/:*?<>|]/g, '')
    .replace(/\s{2,}/g, ' ');
}

function activityLayoutDocumentTitle(group) {
  return cleanDocumentTitlePart(`פריסת פעילות - ${group?.school || ''} - ${group?.authority || ''}`);
}

function stripKitaPrefix(value) {
  // Remove leading "כיתה " for display only; replace "לכיתה " with "ל־"
  return String(value || '')
    .replace(/לכיתה\s+/g, 'ל־')
    .replace(/^כיתה\s+/g, '');
}

function activityLayoutDocumentHtml(group) {
  const rows = activityLayoutRowsForDocument(group);
  const title = activityLayoutDocumentTitle(group);
  const tableRows = rows.map((row) => {
    const activityCell = row.activityTypeLabel
      ? `${escapeHtml(row.activityName)}<span class="act-type-tag">${escapeHtml(row.activityTypeLabel)}</span>`
      : escapeHtml(row.activityName);
    return `<tr>
    <td class="col-date">${escapeHtml(formatActivityLayoutDate(row.date))}</td>
    <td class="col-center">${escapeHtml(row.startTime)}</td>
    <td class="col-center">${escapeHtml(row.endTime)}</td>
    <td class="col-center">${escapeHtml(stripKitaPrefix(row.classGroup))}</td>
    <td class="col-activity">${activityCell}</td>
    <td class="col-instructor">${escapeHtml(row.instructors)}</td>
  </tr>`;
  }).join('');
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    @page { size: A4; margin: 15mm; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #eef2f7; color: #0f172a; font-family: Arial, "Noto Sans Hebrew", sans-serif; line-height: 1.65; }
    .screen-actions { display: flex; justify-content: center; gap: 10px; padding: 12px; }
    .print-btn { border: 0; border-radius: 999px; background: #2563eb; color: #fff; padding: 10px 18px; font-weight: 700; cursor: pointer; }
    .doc { width: 210mm; min-height: 297mm; margin: 0 auto 24px; background: #fff; padding: 14mm 18mm 18mm; box-shadow: 0 16px 40px rgba(15,23,42,.16); }
    .doc-logo { display: block; width: 130px; max-height: 60px; object-fit: contain; margin: 0 auto 10px 0; }
    h1 { margin: 0 0 10px; text-align: center; font-size: 22px; }
    .meta { margin: 0 0 12px; font-size: 15px; }
    .meta div { margin: 2px 0; }
    p { margin: 0 0 10px; font-size: 14px; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 6px;
      margin-bottom: 12px;
      font-size: 12.5px;
      line-height: 1.25;
      table-layout: fixed;
    }

    col.col-date { width: 25mm; }
    col.col-start { width: 25mm; }
    col.col-end { width: 25mm; }
    col.col-grade { width: 23mm; }
    col.col-activity { width: 52mm; }
    col.col-instructor { width: 30mm; }

    th,
    td {
      border: 1px solid #cbd5e1;
      padding: 4px 6px;
      text-align: right;
      vertical-align: middle;
      word-break: normal;
      overflow-wrap: anywhere;
    }

    th {
      background: #f1f5f9;
      font-weight: 700;
      text-align: center;
      white-space: nowrap;
      line-height: 1.15;
    }

    th.col-date,
    td.col-date,
    th.col-center,
    td.col-center {
      text-align: center;
      white-space: nowrap;
    }

    th.col-activity,
    td.col-activity,
    th.col-instructor,
    td.col-instructor {
      text-align: right;
    }

    td.col-activity,
    td.col-instructor {
      overflow-wrap: anywhere;
      white-space: normal;
    }

    .act-type-tag {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-inline-start: 5px;
      padding: 0 6px;
      border: 1px solid #cbd5e1;
      border-radius: 999px;
      background: #f8fafc;
      color: #475569;
      font-size: 10.5px;
      line-height: 1.45;
      font-weight: 600;
      white-space: nowrap;
      vertical-align: middle;
    }
    tr { page-break-inside: avoid; }
    .signature { margin-top: 20px; text-align: left; direction: rtl; }
    @media print { body { background: #fff; } .screen-actions { display: none !important; } .doc { width: auto; min-height: auto; margin: 0; padding: 0; box-shadow: none; } }
  </style></head><body><div class="screen-actions"><button class="print-btn" type="button" onclick="window.print()">הדפסה / שמירה כ־PDF</button></div><main class="doc">
    <img class="doc-logo" src="${escapeHtml(taasiyedaLogoSrc)}" alt="תעשיידע">
    <h1>פריסת פעילות</h1>
    <section class="meta" aria-label="פרטי לקוח">
      <div><strong>לכבוד:</strong></div>
      <div>בית ספר ${escapeHtml(group?.school || '')} | ${escapeHtml(group?.authority || '')}</div>
    </section>
    <p>שלום רב,</p>
    <p>בהמשך לתיאום, מצורפת פריסת הפעילויות המתוכננת במסגרת קיץ תשפ"ו | 2026.</p>
    <table><colgroup><col class="col-date"><col class="col-start"><col class="col-end"><col class="col-grade"><col class="col-activity"><col class="col-instructor"></colgroup><thead><tr><th class="col-date">תאריך</th><th class="col-center">שעת התחלה</th><th class="col-center">שעת סיום</th><th class="col-center">כיתה</th><th class="col-activity">פעילות / סדנה</th><th class="col-instructor">מדריך</th></tr></thead><tbody>${tableRows || '<tr><td colspan="6">לא נמצאו שיבוצים להצגה.</td></tr>'}</tbody></table>
    <p>נבקש לעדכן את צוות תעשיידע מראש במקרה של שינוי בלוחות הזמנים, בהרכב הקבוצות, במיקום הפעילות או בכל צורך תפעולי אחר, כדי שנוכל להיערך בהתאם.</p>
    <div class="signature">בברכה,<br>תעשיידע</div>
  </main></body></html>`;
}

function openActivityLayoutDocument(group) {
  const html = activityLayoutDocumentHtml(group);
  const title = activityLayoutDocumentTitle(group);
  const win = window.open('', '_blank');
  if (!win) {
    showToast('הדפדפן חסם פתיחת חלון חדש. יש לאפשר חלונות קופצים ולנסות שוב.', 'error');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  try { win.document.title = title; } catch { /* ignore */ }
}

function formatActivityLayoutSentAt(isoString) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  } catch { return isoString; }
}

function activityLayoutListHtml(groups = []) {
  const rows = (Array.isArray(groups) ? groups : []).map((group) => {
    const isSent = !!group.status?.sent;
    const key = encodeURIComponent(activityLayoutStatusKey(group));
    const sentAt = isSent ? formatActivityLayoutSentAt(group.status?.sent_at) : '';
    const sentBy = isSent ? cleanText(group.status?.sent_by) : '';
    const sentMeta = isSent && (sentAt || sentBy)
      ? `<span class="ds-activity-layout-sent-meta">${[sentAt, sentBy ? `על ידי: ${sentBy}` : ''].filter(Boolean).join(' · ')}</span>`
      : '';
    const sentStatusHtml = isSent
      ? `<span class="ds-chip ds-chip--status ds-chip--success">נשלח</span>${sentMeta}`
      : `<span class="ds-chip ds-chip--status ds-chip--neutral">לא נשלח</span>`;
    const sentBtnHtml = isSent
      ? `<button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-activity-layout-sent="${key}">עדכן אישור שליחה</button>`
      : `<button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-activity-layout-sent="${key}">סמן כנשלח</button>`;
    return `<tr>
      <td class="col-al-school"><button type="button" class="ds-link-btn" data-activity-layout-open="${key}">${escapeHtml(group.school)}</button></td>
      <td class="col-al-authority">${escapeHtml(group.authority)}</td>
      <td class="col-al-count">${escapeHtml(String(group.count || 0))}</td>
      <td class="col-al-status ds-activity-layout-status-cell">${sentStatusHtml}</td>
      <td class="col-al-actions col-al-actions-cell">
        <div class="ds-al-actions-stack">
          <button type="button" class="ds-btn ds-btn--sm" data-activity-layout-open="${key}">הפק מסמך</button>
          ${sentBtnHtml}
        </div>
      </td>
    </tr>`;
  }).join('');
  if (!rows) return '<div class="ds-empty" dir="rtl"><p class="ds-empty__msg">אין בתי ספר מוכנים להפקת פריסת פעילות בשלב זה.</p></div>';
  return dsTableWrap(`<table class="ds-table ds-table--activity-layout" dir="rtl"><colgroup><col class="col-al-school"><col class="col-al-authority"><col class="col-al-count"><col class="col-al-status"><col class="col-al-actions"></colgroup><thead><tr><th class="col-al-school">בית ספר</th><th class="col-al-authority">רשות</th><th class="col-al-count">פעילויות</th><th class="col-al-status">סטטוס</th><th class="col-al-actions">פעולות</th></tr></thead><tbody>${rows}</tbody></table>`);
}

export const activitiesScreen = {
  async load({ api, state }) {
    state.activityPeriodTab = normalizeActivityPeriodTab(state.activityPeriodTab);
    state.activitiesInnerTab = normalizeActivitiesInnerTab(state.activitiesInnerTab, state.activityPeriodTab);
    const result = await api.activities({
      activity_type: 'all',
      include_inactive: true
    });
    const loadedRows = Array.isArray(result?.rows) ? result.rows : [];
    ensureActivityPeriodMonth(state, loadedRows);
    return result;
  },

  render(data, { state }) {
    const accessDebug = logActivitiesAccess(state);
    if (!accessDebug.hasActivitiesAccess) {
      return dsScreenStack(dsEmptyState('אין הרשאה לצפייה בעמוד פעילויות.'));
    }

    const allRows       = Array.isArray(data?.rows) ? data.rows : [];
    state.activityPeriodTab = normalizeActivityPeriodTab(state.activityPeriodTab);
    state.activitiesInnerTab = normalizeActivitiesInnerTab(state.activitiesInnerTab, state.activityPeriodTab);
    ensureActivityPeriodMonth(state, allRows);
    state.allActivitiesStatusFilter = normalizeAllActivitiesStatusFilter(state.allActivitiesStatusFilter);
    const isAllMode = isAllActivitiesMode(state);
    const periodRows    = activityRowsForInnerTab(allRows, state);
    if (!isAllMode) ensureActivityPeriodMonth(state, allRows);
    const monthRows     = activityRowsForPeriodAndMonth(allRows, state);
    const filteredRows  = applyActivitiesLocalFilters(monthRows, state, state?.clientSettings);

    const listFilters   = ensureActivityListFilters(state, ACTIVITIES_SCOPE);
    const { visible: safeRows, hasMore, total, nextCount } = splitVisibleRows(filteredRows, listFilters);
    const canSeePrivateNotes = canReviewActivityRequests(state);
    const hideEmpIds    = !!state?.clientSettings?.hide_emp_id_on_screens;
    const hideRowId     = !!state?.clientSettings?.hide_row_id_in_ui;
    const hideActivityNo = !!state?.clientSettings?.hide_activity_no_on_screens;
    const role = String(state?.user?.role || '').trim();
    const canDeleteActivity = canDirectManageActivities(state);
    const canAddActivity = canOpenCreateActivity(state);
    const isCreateRequestOnly = canAddActivity && !canAddActivities(state);
    const isAdmin = isAdminUser(state);
    const canUseLayout = canUseActivityLayout(state) && state.activityPeriodTab === ACTIVITY_SEASON_REGULAR && state.activitiesInnerTab === ACTIVITIES_INNER_TAB_SUMMER_2026;

    const rosterUsers = getRosterUsers(state?.clientSettings || {});
    const instructorByEmpId = rosterUsers.reduce((acc, user) => {
      const empId = String(user?.emp_id || '').trim();
      const fullName = String(user?.name || '').trim();
      if (empId && fullName && !acc[empId]) acc[empId] = fullName;
      return acc;
    }, {});
    const isSummerTab = state.activityPeriodTab === ACTIVITY_SEASON_REGULAR && state.activitiesInnerTab === ACTIVITIES_INNER_TAB_SUMMER_2026;
    const is2027Tab = state.activityPeriodTab === ACTIVITY_SEASON_SCHOOL_2027;
    const tableRows = safeRows
      .map((row) => {
        const instructorMeta = activityInstructorMeta(row, { hideEmpIds, instructorByEmpId });
        const instructorDisplay = instructorMeta.hasInstructor
          ? `<span class="ds-activities-instructor-name${instructorMeta.hasName ? '' : ' is-derived'}">${escapeHtml(instructorMeta.text)}</span>`
          : '<span class="ds-chip ds-chip--status ds-chip--warn ds-chip--instructor-empty">ללא מדריך</span>';
        const activityTypeLabel = escapeHtml(visibleActivityCategoryLabel(row.activity_type));
        const rawActivityName = displayActivityName(row);
        const activityName = escapeHtml(rawActivityName);
        const editStatus = editRequestStatusLabel(String(row.edit_request_status || ''));
        const editStatusBadge = editStatus
          ? `<span class="ds-chip ds-chip--status ds-chip--warn" title="${escapeHtml(editStatus)}">${escapeHtml(editStatus)}</span>`
          : '';
        const managerLabel = activityManagerDisplayName(row.activity_manager);
        const rowSearch = [
          hideRowId ? '' : row.RowID,
          visibleActivityCategoryLabel(row.activity_type),
          rawActivityName,
          row.start_date,
          row.end_date,
          row.school,
          row.authority,
          row.grade,
          row.instructor_name,
          row.instructor_name_2,
          row.activity_manager,
          managerLabel,
          hideEmpIds ? '' : row.emp_id,
          hideEmpIds ? '' : row.emp_id_2,
          formatActivityDateColumnsHe(row)
        ]
          .filter(Boolean)
          .join(' ');

        if (is2027Tab) {
          const startHe2027 = formatDateHe(row.start_date) || '—';
          const endRaw2027 = String(row?.end_date || row?.date_end || '').trim() || String(row?.start_date || '').trim();
          const endHe2027 = endRaw2027 ? formatDateHe(endRaw2027) || '—' : '—';
          const contactName2027 = escapeHtml(String(row.contact_name || '—'));
          const contactPhone2027 = escapeHtml(String(row.contact_phone || row.phone || '—'));
          return `
      <tr class="ds-data-row ds-activities-row" data-list-item data-search="${escapeHtml(rowSearch)}" data-filter="" data-row-id="${escapeHtml(row.RowID)}">
        <td class="ds-activities-col ds-activities-col--program"><div class="ds-activities-program-cell"><strong class="ds-activities-program-name" title="${activityName}">${activityName}</strong><span class="ds-activities-program-type" title="${activityTypeLabel}">${activityTypeLabel}</span>${editStatusBadge}</div></td>
        <td class="ds-activities-col ds-activities-col--authority"><span class="ds-activities-cell-ellipsis" title="${escapeHtml(row.authority || '—')}">${escapeHtml(row.authority || '—')}</span></td>
        <td class="ds-activities-col ds-activities-col--school"><span class="ds-activities-cell-ellipsis" title="${escapeHtml(getActivitySchoolDisplayName(row) || '—')}">${escapeHtml(getActivitySchoolDisplayName(row) || '—')}</span></td>
        <td class="ds-activities-col ds-activities-col--instructor"><span class="ds-activities-cell-ellipsis" title="${escapeHtml(managerLabel || '—')}">${escapeHtml(managerLabel || '—')}</span></td>
        <td class="ds-activities-col ds-activities-col--date"><time class="ds-activities-date">${escapeHtml(startHe2027)}</time></td>
        <td class="ds-activities-col ds-activities-col--date"><time class="ds-activities-date">${escapeHtml(endHe2027)}</time></td>
        <td class="ds-activities-col ds-activities-col--meetings">${(() => { const nd = nextMeetingDate(row); const ndHe = nd ? (formatDateHe(nd) || nd) : ''; return ndHe ? `<time class="ds-activities-date" title="${escapeHtml(nd)}">${escapeHtml(ndHe)}</time>` : '<span class="ds-activities-date ds-activities-date--none">—</span>'; })()}</td>
        <td class="ds-activities-col ds-activities-col--contact-name"><span class="ds-activities-cell-ellipsis" title="${contactName2027}">${contactName2027}</span></td>
        <td class="ds-activities-col ds-activities-col--contact-phone"><span class="ds-activities-cell-ellipsis" title="${contactPhone2027}">${contactPhone2027}</span></td>
      </tr>
    `;
        }

        if (isSummerTab) {
          const activityDateRaw = String(row.date_1 || row.start_date || '').trim();
          const activityDateHe = activityDateRaw ? (formatDateHe(activityDateRaw) || activityDateRaw) : 'דורש שיבוץ תאריך';
          const gradeDisplay = escapeHtml(String(row.grade || '—'));
          const startTime = activityLayoutStartTime(row);
          const endTime = activityLayoutEndTime(row);
          const hoursDisplay = (startTime && endTime) ? `${escapeHtml(startTime)}–${escapeHtml(endTime)}` : (startTime || endTime ? escapeHtml(startTime || endTime) : '—');
          return `
      <tr class="ds-data-row ds-activities-row" data-list-item data-search="${escapeHtml(rowSearch)}" data-filter="" data-row-id="${escapeHtml(row.RowID)}">
        <td class="ds-activities-col ds-activities-col--program"><div class="ds-activities-program-cell"><strong class="ds-activities-program-name" title="${activityName}">${activityName}</strong><span class="ds-activities-program-type" title="${activityTypeLabel}">${activityTypeLabel}</span>${editStatusBadge}</div></td>
        <td class="ds-activities-col ds-activities-col--authority"><span class="ds-activities-cell-ellipsis" title="${escapeHtml(row.authority || '—')}">${escapeHtml(row.authority || '—')}</span></td>
        <td class="ds-activities-col ds-activities-col--school"><span class="ds-activities-cell-ellipsis" title="${escapeHtml(getActivitySchoolDisplayName(row) || '—')}">${escapeHtml(getActivitySchoolDisplayName(row) || '—')}</span></td>
        <td class="ds-activities-col ds-activities-col--grade" style="text-align:center">${gradeDisplay}</td>
        <td class="ds-activities-col ds-activities-col--instructor"><div class="ds-activities-instructor-wrap">${instructorDisplay}<span class="ds-activities-manager-line" title="${escapeHtml(managerLabel || '—')}">מנהל: ${escapeHtml(managerLabel || '—')}</span></div></td>
        <td class="ds-activities-col ds-activities-col--date" style="text-align:center"><time class="ds-activities-date">${escapeHtml(activityDateHe)}</time></td>
        <td class="ds-activities-col ds-activities-col--hours" style="text-align:center"><span class="ds-activities-hours">${hoursDisplay}</span></td>
        <td class="ds-activities-col ds-activities-col--notes"><span class="ds-activities-cell-ellipsis" title="${escapeHtml(String(row.notes || '—'))}">${escapeHtml(String(row.notes || '—'))}</span></td>
      </tr>
    `;
        }

        const startHe = formatDateHe(row.start_date) || '—';
        const endRaw = String(row?.end_date || row?.date_end || '').trim() || String(row?.start_date || '').trim();
        const endHe = endRaw ? formatDateHe(endRaw) || '—' : '—';
        return `
      <tr class="ds-data-row ds-activities-row" data-list-item data-search="${escapeHtml(rowSearch)}" data-filter="" data-row-id="${escapeHtml(row.RowID)}">
        <td class="ds-activities-col ds-activities-col--program"><div class="ds-activities-program-cell"><strong class="ds-activities-program-name" title="${activityName}">${activityName}</strong><span class="ds-activities-program-type" title="${activityTypeLabel}">${activityTypeLabel}</span>${editStatusBadge}</div></td>
        <td class="ds-activities-col ds-activities-col--authority"><span class="ds-activities-cell-ellipsis" title="${escapeHtml(row.authority || '—')}">${escapeHtml(row.authority || '—')}</span></td>
        <td class="ds-activities-col ds-activities-col--school"><span class="ds-activities-cell-ellipsis" title="${escapeHtml(getActivitySchoolDisplayName(row) || '—')}">${escapeHtml(getActivitySchoolDisplayName(row) || '—')}</span></td>
        <td class="ds-activities-col ds-activities-col--instructor"><div class="ds-activities-instructor-wrap">${instructorDisplay}<span class="ds-activities-manager-line" title="${escapeHtml(managerLabel || '—')}">מנהל: ${escapeHtml(managerLabel || '—')}</span></div></td>
        <td class="ds-activities-col ds-activities-col--date"><time class="ds-activities-date">${escapeHtml(startHe)}</time></td>
        <td class="ds-activities-col ds-activities-col--date"><time class="ds-activities-date">${escapeHtml(endHe)}</time></td>
        <td class="ds-activities-col ds-activities-col--meetings">${(() => { const nd = nextMeetingDate(row); const ndHe = nd ? (formatDateHe(nd) || nd) : ''; return ndHe ? `<time class="ds-activities-date" title="${escapeHtml(nd)}">${escapeHtml(ndHe)}</time>` : '<span class="ds-activities-date ds-activities-date--none">—</span>'; })()}</td>
        <td class="ds-activities-col ds-activities-col--notes"><span class="ds-activities-cell-ellipsis" title="${escapeHtml(String(row.notes || '—'))}">${escapeHtml(String(row.notes || '—'))}</span></td>
      </tr>
    `;
      })
      .join('');


    const fundingOptions = mergeOptions(state?.clientSettings || {}, ['funding', 'fundings']);
    const centralOptions = getFilterOptionOverrides(state?.clientSettings || {});
    const bareFilters = filtersToolbarHtml(ACTIVITIES_SCOPE, filteredRows, state, {
      filterFields: ACTIVITY_FILTER_FIELDS,
      search: false,
      clear: false,
      bare: true,
      dependent: true
    });
    const loadMoreHtml = hasMore
      ? `<div style="display:flex;justify-content:center;padding:12px 0"><button type="button" class="ds-btn ds-btn--sm" data-list-show-more="${ACTIVITIES_SCOPE}" data-next-count="${nextCount}">הצג עוד</button></div>`
      : '';

    const tableColsHtml = isSummerTab
      ? `<colgroup>
                  <col class="ds-activities-col--program">
                  <col class="ds-activities-col--authority">
                  <col class="ds-activities-col--school">
                  <col class="ds-activities-col--grade">
                  <col class="ds-activities-col--instructor">
                  <col class="ds-activities-col--date">
                  <col class="ds-activities-col--hours">
                  <col class="ds-activities-col--notes">
                </colgroup>
                <thead><tr><th>תוכנית / סוג</th><th>רשות</th><th>בית ספר</th><th style="text-align:center">כיתה</th><th class="ds-activities-col--instructor">מדריך</th><th style="text-align:center">תאריך פעילות</th><th style="text-align:center">שעות</th><th>הערות</th></tr></thead>`
      : is2027Tab
        ? `<colgroup>
                  <col class="ds-activities-col--program">
                  <col class="ds-activities-col--authority">
                  <col class="ds-activities-col--school">
                  <col class="ds-activities-col--instructor">
                  <col class="ds-activities-col--date">
                  <col class="ds-activities-col--date">
                  <col class="ds-activities-col--meetings">
                  <col class="ds-activities-col--contact-name">
                  <col class="ds-activities-col--contact-phone">
                </colgroup>
                <thead><tr><th>תוכנית / סוג</th><th>רשות</th><th>בית ספר</th><th>מנהל פעילות</th><th>תאריך התחלה</th><th>תאריך סיום</th><th>המפגש הבא</th><th>איש קשר</th><th>נייד</th></tr></thead>`
        : `<colgroup>
                  <col class="ds-activities-col--program">
                  <col class="ds-activities-col--authority">
                  <col class="ds-activities-col--school">
                  <col class="ds-activities-col--instructor">
                  <col class="ds-activities-col--date">
                  <col class="ds-activities-col--date">
                  <col class="ds-activities-col--meetings">
                  <col class="ds-activities-col--notes">
                </colgroup>
                <thead><tr><th>תוכנית / סוג</th><th>רשות</th><th>בית ספר</th><th class="ds-activities-col--instructor">מדריך</th><th>תאריך התחלה</th><th>תאריך סיום</th><th>המפגש הבא</th><th>הערות</th></tr></thead>`;
    const tableSection =
      safeRows.length === 0
        ? dsEmptyState(isAllMode
            ? (monthRows.length === 0 ? 'אין פעילויות להצגה' : 'לא נמצאו פעילויות התואמות לסינון הנוכחי')
            : periodRows.length === 0
              ? 'אין פעילויות להצגה בתקופה זו'
              : (monthRows.length === 0)
                ? 'אין פעילויות להצגה בחודש הנבחר'
                : 'לא נמצאו פעילויות התואמות לסינון הנוכחי')
        : dsTableWrap(`<table class="ds-table ds-table--interactive ds-table--activities-list${is2027Tab ? ' ds-table--activities-2027' : ''}" dir="rtl">
                ${tableColsHtml}
                <tbody>${tableRows}</tbody>
              </table>`) + loadMoreHtml;

    const isNavLoading = !!state.activitiesNavLoading;
    const navLoadingChip = isNavLoading ? '<span class="ds-inline-loading-dot is-inline-loading" aria-hidden="true"></span>' : '';
    const viewSwitcher = renderActivitiesViewSwitcher(state, 'activities');
    const allActivitiesStatusFilter = allActivitiesStatusFilterHtml(state);
    const mainToolbar = `<div class="ds-activities-main-toolbar" dir="rtl" data-local-filters="${ACTIVITIES_SCOPE}">
      <input type="search" class="ds-input ds-input--sm ds-activities-search-sm" data-filter-search="${ACTIVITIES_SCOPE}" value="${escapeHtml(listFilters.q || '')}" placeholder="חיפוש" aria-label="חיפוש פעילויות" title="חיפוש לפי מזהה, פעילות, מדריך, רשות, בית ספר, סטטוס, תאריך או סמל מוסד" />
      ${allActivitiesStatusFilter}
      ${bareFilters}
      <div class="ds-activities-main-toolbar__actions">
        <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost ds-activities-toolbar-btn" data-filter-clear="${ACTIVITIES_SCOPE}" aria-label="ניקוי כל הסינונים" title="ניקוי כל הסינונים">ניקוי כל הסינונים</button>
        ${canUseLayout ? `<button type="button" class="ds-btn ds-btn--sm ds-btn--ghost ds-activities-toolbar-btn ds-activities-toolbar-btn--layout" data-activity-layout-list title="פריסת פעילות לבתי ספר עם שיבוץ מלא">פריסת פעילות</button>` : ''}
        ${isAdmin ? `<button type="button" class="ds-btn ds-btn--sm ds-btn--ghost ds-activities-toolbar-btn" data-activities-export-all title="ייצוא הפעילויות בלשונית הפעילה לאקסל">ייצוא לאקסל</button>` : ''}
        ${canAddActivity ? `<button type="button" class="ds-btn ds-btn--sm ds-btn--ghost ${isCreateRequestOnly ? 'ds-activities-toolbar-btn' : 'ds-btn--icon-only'}" data-activities-add-btn aria-label="${isCreateRequestOnly ? 'בקשה להוספת פעילות' : 'הוספת פעילות'}" title="${isCreateRequestOnly ? 'בקשה להוספת פעילות' : 'הוספת פעילות'}">${isCreateRequestOnly ? 'בקשה להוספת פעילות' : '+'}</button>` : ''}
      </div>
    </div>`;

    const usesMonthNavigation = activityPeriodUsesMonthNavigation(state);
    const summerShowAll = isSummerTab && !!state.activitiesSummerShowAll;
    const availableMonths = usesMonthNavigation ? availableActivityMonthsForPeriod(allRows, state.activityPeriodTab) : [];
    const selectedMonthIndex = availableMonths.indexOf(state.activitiesMonthYm);
    const disablePrevMonth = isNavLoading || selectedMonthIndex <= 0;
    const disableNextMonth = isNavLoading || selectedMonthIndex < 0 || selectedMonthIndex >= availableMonths.length - 1;
    const periodLabel = globalActivityPeriodLabel(state.activityPeriodTab);
    const periodTotal = usesMonthNavigation ? activityRowsForInnerTab(allRows, state).length : total;
    const monthTitleCount = `${total} פעילויות${periodTotal !== total ? ` מתוך ${periodTotal}` : ''}`;
    const diagnostics = buildActivitiesDiagnostics(allRows, state, filteredRows);
    const isDebugMode = typeof window !== 'undefined' && new URLSearchParams(window?.location?.search || '').get('debug') === 'activities';
    const showDiag = isAdmin && isDebugMode;
    const prevMonthTitle = disablePrevMonth ? 'אין חודש קודם עם פעילויות בתקופה זו' : 'חודש קודם';
    const nextMonthTitle = disableNextMonth ? 'אין חודש הבא עם פעילויות בתקופה זו' : 'חודש הבא';
    const monthNavLabel = heMonthLabel(state.activitiesMonthYm);
    const allSummerBtn = '';
    const titleNavRow = isAllMode
      ? `<nav class="ds-activities-title-row" aria-label="חיפוש בכל הפעילויות" dir="rtl">
      <h2 class="ds-activities-page-title">חיפוש בכל הפעילויות · ${total} פעילויות</h2>
    </nav>`
      : usesMonthNavigation
        ? summerShowAll
          ? `<nav class="ds-activities-title-row" aria-label="קיץ 2026 כל הפעילויות" dir="rtl">
      <h2 class="ds-activities-page-title">קיץ 2026 · ${escapeHtml(monthTitleCount)} ${navLoadingChip}</h2>
      ${allSummerBtn}
    </nav>`
          : `<nav class="ds-activities-title-row${isNavLoading ? ' is-nav-loading' : ''}" aria-label="ניווט חודשי לפעילויות" dir="rtl">
      <button type="button" class="ds-btn ds-btn--sm ds-btn--nav-arrow" data-activities-month-prev aria-label="${escapeHtml(prevMonthTitle)}" title="${escapeHtml(prevMonthTitle)}" ${disablePrevMonth ? 'disabled' : ''}>▶</button>
      <h2 class="ds-activities-page-title">ניהול פעילויות - ${escapeHtml(periodLabel)} · ${escapeHtml(monthTitleCount)} ${navLoadingChip}</h2>
      <button type="button" class="ds-btn ds-btn--sm ds-btn--nav-arrow" data-activities-month-next aria-label="${escapeHtml(nextMonthTitle)}" title="${escapeHtml(nextMonthTitle)}" ${disableNextMonth ? 'disabled' : ''}>◀</button>
      ${allSummerBtn}
    </nav>`
        : `<nav class="ds-activities-title-row" aria-label="${escapeHtml(periodLabel)}" dir="rtl">
      <h2 class="ds-activities-page-title">ניהול פעילויות - ${escapeHtml(periodLabel)} · ${total} פעילויות</h2>
    </nav>`;
    const periodTabs = activityPeriodTabsHtml(allRows, state.activityPeriodTab, state);

    const html = dsScreenStack(`<section class="ds-activities-screen">
      ${viewSwitcher}
      ${titleNavRow}
      ${periodTabs}
      ${showDiag ? activitiesDiagnosticsHtml(diagnostics) : ''}
      ${mainToolbar}
      ${dsCard({ body: tableSection, padded: false })}
    </section>`);
    return html;
  },

  bind({ root, data, state, rerender, rerenderActivitiesView, ui, api, clearScreenDataCache }) {

    (function showOverdueWarningIfNeeded() {
      if (!root) return;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const allRows = Array.isArray(data?.rows) ? data.rows : [];
      const overdue = allRows.filter((row) => {
        const status = String(row?.status || '').trim();
        if (status !== 'פתוח') return false;
        const endRaw = String(row?.end_date || '').trim();
        if (!endRaw) return false;
        const endDate = new Date(endRaw);
        return !isNaN(endDate.getTime()) && endDate < today;
      });
      if (!overdue.length) return;
      const existing = root.querySelector('[data-overdue-warning]');
      if (existing) return;

      const userRoutes = Array.isArray(state?.effectiveRoutes) ? state.effectiveRoutes
        : (Array.isArray(state?.routes) ? state.routes : []);
      const canViewExceptions = userRoutes.includes('exceptions');

      const exceptionsBtn = canViewExceptions
        ? `<button type="button" class="ds-btn ds-btn--primary ds-btn--sm" data-overdue-exceptions>מעבר לעמוד החריגות</button>`
        : '';

      const el = document.createElement('div');
      el.setAttribute('data-overdue-warning', '');
      el.setAttribute('role', 'alertdialog');
      el.setAttribute('aria-modal', 'true');
      el.setAttribute('dir', 'rtl');
      el.className = 'ds-overdue-overlay';
      el.innerHTML = `
        <div class="ds-overdue-dialog">
          <div class="ds-overdue-icon" aria-hidden="true">⚠️</div>
          <h3 class="ds-overdue-title">יש תוכניות שהסתיימו ועדיין לא נסגרו</h3>
          <p class="ds-overdue-body">מומלץ לעבור לעמוד החריגות, לבדוק את הרשומות הרלוונטיות ולעדכן סטטוס לפי הצורך.</p>
          <div class="ds-overdue-actions">
            ${exceptionsBtn}
            <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-overdue-dismiss>אישור והמשך עבודה בדשבורד</button>
          </div>
        </div>`;
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-overdue-exceptions]')) {
          el.remove();
          state.listFilters = state.listFilters || {};
          state.listFilters.exceptions = {
            ...(state.listFilters.exceptions || {}),
            q: '',
            district: '',
            activity_manager: '',
            exception_type: 'end_date_passed',
            visibleCount: 200
          };
          document.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: 'exceptions' } }));
          return;
        }
        if (e.target.closest('[data-overdue-dismiss]') || e.target === el) {
          el.remove();
          return;
        }
      });
      document.addEventListener('keydown', function onKey(e) {
        if (e.key === 'Escape') { el.remove(); document.removeEventListener('keydown', onKey); }
      }, { once: true });
      root.appendChild(el);
    })();

    const activitiesRows = Array.isArray(data?.rows) ? data.rows : [];
    state.activityPeriodTab = normalizeActivityPeriodTab(state.activityPeriodTab);
    state.allActivitiesStatusFilter = normalizeAllActivitiesStatusFilter(state.allActivitiesStatusFilter);
    const periodRows = activityRowsForPeriodAndMonth(activitiesRows, state);
    let activityLayoutGroups = [];

    async function loadActivityLayoutStatuses() {
      if (!canUseActivityLayout(state)) return localActivityLayoutStatuses();
      if (typeof api?.activityLayoutStatuses !== 'function') return localActivityLayoutStatuses();
      try {
        const res = await api.activityLayoutStatuses({ season: ACTIVITY_LAYOUT_SEASON });
        return Array.isArray(res?.rows) ? res.rows : localActivityLayoutStatuses();
      } catch (err) {
        console.warn('[activity-layout] status read failed; using local fallback', err);
        return localActivityLayoutStatuses();
      }
    }

    function groupByActivityLayoutKey(key) {
      const decoded = cleanText(decodeURIComponent(String(key || '')));
      return activityLayoutGroups.find((group) => activityLayoutStatusKey(group) === decoded) || null;
    }

    async function renderActivityLayoutDrawerContent() {
      const statuses = await loadActivityLayoutStatuses();
      activityLayoutGroups = readyActivityLayoutSchools(activityPeriodRows(activitiesRows, ACTIVITY_LAYOUT_SEASON), statuses);
      const content = document.querySelector('.ds-drawer__content');
      if (content) content.innerHTML = activityLayoutListHtml(activityLayoutGroups);
    }

    async function doMarkActivityLayoutSent(group, button) {
      if (!group || !canUseActivityLayout(state)) return;
      if (button) button.disabled = true;
      const sentAt = new Date().toISOString();
      const sentBy = cleanText(state?.user?.full_name || state?.user?.user_id || state?.user?.emp_id || '');
      const row = {
        season: ACTIVITY_LAYOUT_SEASON,
        authority: group.authority,
        school: group.school,
        sent: true,
        sent_at: sentAt,
        sent_by: sentBy
      };
      try {
        if (typeof api?.saveActivityLayoutStatus === 'function') {
          await api.saveActivityLayoutStatus(row);
        }
        writeLocalActivityLayoutStatus(row);
        await renderActivityLayoutDrawerContent();
        showToast('סטטוס פריסת הפעילות סומן כנשלח.', 'success');
      } catch (err) {
        console.error('[activity-layout] save sent status failed', err);
        showToast('שמירת סטטוס השליחה נכשלה.', 'error');
      } finally {
        if (button) button.disabled = false;
      }
    }

    async function markActivityLayoutSent(group, button) {
      if (!group || !canUseActivityLayout(state)) return;
      const alreadySent = !!group.status?.sent;
      if (alreadySent) {
        const confirmed = await new Promise((resolve) => {
          const overlay = document.createElement('div');
          overlay.className = 'ds-confirm-overlay';
          overlay.setAttribute('dir', 'rtl');
          overlay.innerHTML = `
            <div class="ds-confirm-dialog">
              <p class="ds-confirm-msg">המסמך כבר סומן כנשלח. האם לעדכן את אישור השליחה מחדש?</p>
              <div class="ds-confirm-actions">
                <button type="button" class="ds-btn ds-btn--sm" data-confirm="no">ביטול</button>
                <button type="button" class="ds-btn ds-btn--sm ds-btn--primary" data-confirm="yes">כן, עדכן אישור שליחה</button>
              </div>
            </div>`;
          overlay.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-confirm]');
            if (!btn) return;
            overlay.remove();
            resolve(btn.dataset.confirm === 'yes');
          });
          document.body.appendChild(overlay);
        });
        if (!confirmed) return;
      }
      await doMarkActivityLayoutSent(group, button);
    }
    const filteredRows      = applyActivitiesLocalFilters(periodRows, state, state?.clientSettings);
    const canSeePrivateNotes = canReviewActivityRequests(state);
    const canEditActivity   = canDirectManageActivities(state) || canRequestActivityChanges(state);
    const hideEmpIds        = !!state?.clientSettings?.hide_emp_id_on_screens;
    const hideRowId         = !!state?.clientSettings?.hide_row_id_in_ui;
    const hideActivityNo    = !!state?.clientSettings?.hide_activity_no_on_screens;
    const role = String(state?.user?.role || '').trim();
    const canDeleteActivity = canDirectManageActivities(state);
    const canAddActivity = canOpenCreateActivity(state);
    const isCreateRequestOnly = canAddActivity && !canAddActivities(state);
    const isAdmin = isAdminUser(state);

    const rerenderLocal = () => {
      if (typeof rerenderActivitiesView === 'function') rerenderActivitiesView();
      else rerender();
    };

    bindActivitiesViewSwitcher(root, state, rerender);

    const runMonthShift = (delta) => {
      if (!activityPeriodUsesMonthNavigation(state)) return;
      if (state.activitiesNavLoading) return;
      state.activitiesSummerShowAll = false;
      const available = availableActivityMonthsForPeriod(activitiesRows, state.activityPeriodTab);
      if (available.length === 0) return;
      if (!available.includes(state.activitiesMonthYm)) state.activitiesMonthYm = pickBestMonthForPeriod(activitiesRows, state.activityPeriodTab);
      const currentMonth = state.activitiesMonthYm;
      const currentIndex = available.indexOf(currentMonth);
      const nextMonth = available[currentIndex + (delta > 0 ? 1 : -1)] || currentMonth;
      if (nextMonth === currentMonth) return;
      const startedAt = Date.now();
      state.activitiesNavLoading = true;
      state.activitiesMonthYm = nextMonth;
      rerenderLocal();
      const minMs = 420;
      setTimeout(() => {
        state.activitiesNavLoading = false;
        rerenderLocal();
      }, Math.max(0, minMs - (Date.now() - startedAt)));
    };

    root.querySelector('[data-activities-month-prev]')?.addEventListener('click', () => runMonthShift(-1));
    root.querySelector('[data-activities-month-next]')?.addEventListener('click', () => runMonthShift(1));
    root.querySelector('[data-activities-all-summer]')?.addEventListener('click', () => {
      state.activitiesSummerShowAll = true;
      state.activitiesMonthYm = '';
      rerenderLocal();
    });

    const upsertLocalRow = (rowId, patch) => {
      const hit = activitiesRows.find((row) => String(row?.RowID || '') === String(rowId || ''));
      if (!hit) return false;
      Object.assign(hit, patch || {});
      return true;
    };
    const patchLocalRowFromSave = ({ sourceRowId, changes }) => {
      const normalizedStatus = String(changes?.status || '').trim();
      if (normalizedStatus === 'נמחק') {
        const rowId = String(sourceRowId || '');
        const removeByRowId = (arr) => {
          const idx = arr.findIndex((row) => String(row?.RowID || '') === rowId);
          if (idx >= 0) arr.splice(idx, 1);
        };
        removeByRowId(activitiesRows);
        removeByRowId(periodRows);
        removeByRowId(filteredRows);
        return;
      }
      if (!upsertLocalRow(sourceRowId, changes || {})) return;
      const summaryHit = filteredRows.find((row) => String(row?.RowID || '') === String(sourceRowId || ''));
      if (summaryHit) Object.assign(summaryHit, changes || {});
    };
    const scheduleQuietRefresh = async () => {
      try {
        const fresh = await api.activities({ activity_type: 'all', include_inactive: true });
        const freshRows = Array.isArray(fresh?.rows) ? fresh.rows : [];
        activitiesRows.splice(0, activitiesRows.length, ...freshRows);
        state.screenDataCache['activities:periods'] = { data: { ...fresh, rows: activitiesRows }, t: Date.now() };
      } catch {
        // keep local optimistic view on failure
      }
    };

    const bindActivityEditForm = (contentRoot) =>
      bindActivityEditFormShared(contentRoot, {
        api,
        ui,
        clearScreenDataCache,
        rerender,
        onRowSaved: ({ sourceSheet, sourceRowId, changes, row }) => {
          patchLocalRowFromSave({ sourceRowId, changes: row || changes });
          const key = `activityDetail:${sourceSheet || ''}:${sourceRowId || ''}`;
          const entry = state?.screenDataCache?.[key];
          if (entry?.data && typeof entry.data === 'object') Object.assign(entry.data, row || changes || {});
        },
        onSaveSuccess: async ({ sourceSheet, sourceRowId, contentRoot }) => {
          try {
            const rsp = await api.activityDetail(sourceRowId, sourceSheet || 'activities');
            const freshRow = rsp?.row;
            if (freshRow && contentRoot) {
              putCachedActivityDetail({ RowID: sourceRowId, source_sheet: sourceSheet || 'activities' }, freshRow, state);
              contentRoot.innerHTML = activityDrawerContent(
                freshRow, canSeePrivateNotes, canEditActivity, canDirectManageActivities(state), canRequestActivityChanges(state),
                canDeleteActivity,
                hideEmpIds, hideRowId, hideActivityNo,
                mergeSettingsWithFallback(state?.clientSettings || {}, buildFallbackOptionsFromRows(activitiesRows)),
                { datesLoading: false }
              );
              hideShellHeader(contentRoot);
              bindActivityEditForm(contentRoot);
            }
          } catch (err) {
            console.warn('[activity-refresh-after-save:failed]', { sourceRowId, error: err?.message || String(err) });
          }
          const savedPeriod = activityPeriodKey({ ...(activitiesRows.find((row) => String(row?.RowID || '') === String(sourceRowId || '')) || {}), ...(changes || {}) });
          if (savedPeriod !== state.activityPeriodTab) {
            state.activityPeriodTab = savedPeriod;
            showToast('הפעילות נשמרה בתקופה אחרת והועברה ללשונית המתאימה.', 'info', 3600);
          }
          rerenderLocal();
          void scheduleQuietRefresh();
          const rowNode = Array.from(root.querySelectorAll('.ds-data-row'))
            .find((node) => String(node?.dataset?.rowId || '') === String(sourceRowId || ''));
          rowNode?.classList.add('is-just-saved');
          setTimeout(() => rowNode?.classList.remove('is-just-saved'), 1200);
        }
      });

    async function loadDetailRow(summaryRow) {
      const key = activityDetailCacheKey(summaryRow);
      let request = inflightActivityDetailRequests.get(key);
      if (!request) {
        request = api.activityDetail(summaryRow.RowID, summaryRow.source_sheet)
          .finally(() => {
            inflightActivityDetailRequests.delete(key);
          });
        inflightActivityDetailRequests.set(key, request);
      }
      const rsp = await request;
      const row = rsp?.row || summaryRow;
      putCachedActivityDetail(summaryRow, row, state);
      return row;
    }

    function hideShellHeader(contentRoot) {
      const shellHdr = contentRoot.closest('.ds-drawer')?.querySelector(':scope > header');
      if (shellHdr) shellHdr.hidden = true;
    }

    function bindContact2027Section(contentRoot) {
      const section = contentRoot.querySelector('[data-contact-2027-section]');
      if (!section) return;

      const schoolId  = section.dataset.schoolId  || '';
      const school    = section.dataset.school    || '';
      const authority = section.dataset.authority || '';

      const select       = section.querySelector('[data-contact-2027-select]');
      const preview      = section.querySelector('[data-contact-2027-preview]');
      const addBtn       = section.querySelector('[data-contact-2027-add-btn]');
      const addForm      = section.querySelector('[data-contact-2027-add-form]');
      const saveNewBtn   = section.querySelector('[data-contact-2027-save-new]');
      const cancelNewBtn = section.querySelector('[data-contact-2027-cancel-new]');
      const idInput      = section.querySelector('[data-contact-2027-id-input]');
      const hiddenName   = section.querySelector('[data-contact-2027-hidden-name]');
      const hiddenPhone  = section.querySelector('[data-contact-2027-hidden-phone]');
      const hiddenEmail  = section.querySelector('[data-contact-2027-hidden-email]');
      const errorEl      = section.querySelector('[data-new-contact-error]');

      let loadedContacts = [];

      const updatePreview = () => {
        const val = select ? select.value : '';
        const c = loadedContacts.find((x) => String(x.id) === val);
        if (c) {
          const ph = String(c.phone || c.mobile || '').trim();
          const em = String(c.email || '').trim();
          section.querySelector('[data-contact-2027-pname]').textContent  = String(c.contact_name || '').trim();
          section.querySelector('[data-contact-2027-pphone]').textContent = ph;
          section.querySelector('[data-contact-2027-pemail]').textContent = em;
          if (preview) preview.style.display = 'block';
          if (idInput)    idInput.value    = String(c.id);
          if (hiddenName) hiddenName.value = String(c.contact_name || '').trim();
          if (hiddenPhone) hiddenPhone.value = ph;
          if (hiddenEmail) hiddenEmail.value = em;
        } else {
          if (preview) preview.style.display = 'none';
          if (idInput)    idInput.value    = '';
          if (hiddenName) hiddenName.value = '';
          if (hiddenPhone) hiddenPhone.value = '';
          if (hiddenEmail) hiddenEmail.value = '';
        }
      };

      const populateSelect = (contacts, currentId) => {
        if (!select) return;
        select.innerHTML = '';
        if (!contacts.length) {
          select.innerHTML = '<option value="">לא נמצא איש קשר לבית הספר</option>';
          return;
        }
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = '— בחר איש קשר —';
        select.appendChild(placeholder);
        contacts.forEach((c) => {
          const opt = document.createElement('option');
          opt.value = String(c.id);
          const ph = String(c.phone || c.mobile || '').trim();
          opt.textContent = [String(c.contact_name || '').trim(), String(c.contact_role || '').trim(), ph].filter(Boolean).join(' — ');
          select.appendChild(opt);
        });
        if (currentId && contacts.find((c) => String(c.id) === String(currentId))) {
          select.value = String(currentId);
        } else if (contacts.length === 1) {
          select.value = String(contacts[0].id);
        }
        updatePreview();
      };

      const loadContacts = async (overrideSchool, overrideAuthority) => {
        const s  = overrideSchool    || school;
        const au = overrideAuthority || authority;
        if (!select) return;
        select.innerHTML = '<option value="">טוען...</option>';
        if (preview) preview.style.display = 'none';
        try {
          const contacts = await api.contactsForSchool(schoolId, s, au);
          loadedContacts = contacts;
          const currentId = idInput ? idInput.value : section.dataset.currentContactId || '';
          populateSelect(contacts, currentId);
        } catch (_) {
          if (select) select.innerHTML = '<option value="">שגיאה בטעינה</option>';
        }
      };

      select?.addEventListener('change', updatePreview);

      addBtn?.addEventListener('click', () => {
        if (addForm) addForm.style.display = 'block';
        if (addBtn)  addBtn.style.display  = 'none';
        if (errorEl) errorEl.textContent   = '';
      });

      cancelNewBtn?.addEventListener('click', () => {
        if (addForm) addForm.style.display = 'none';
        if (addBtn)  addBtn.style.display  = '';
        if (errorEl) errorEl.textContent   = '';
      });

      saveNewBtn?.addEventListener('click', async () => {
        if (!addForm) return;
        const nameVal  = (addForm.querySelector('[data-new-contact-name]')?.value  || '').trim();
        const roleVal  = (addForm.querySelector('[data-new-contact-role]')?.value  || '').trim();
        const phoneVal = (addForm.querySelector('[data-new-contact-phone]')?.value || '').trim();
        const emailVal = (addForm.querySelector('[data-new-contact-email]')?.value || '').trim();

        if (errorEl) errorEl.textContent = '';
        if (!nameVal) { if (errorEl) errorEl.textContent = 'שם איש קשר הוא שדה חובה'; return; }
        if (!phoneVal && !emailVal) { if (errorEl) errorEl.textContent = 'יש להזין נייד או מייל לפחות'; return; }

        const dup = loadedContacts.find((c) =>
          (phoneVal && (String(c.phone||'') === phoneVal || String(c.mobile||'') === phoneVal)) ||
          (emailVal && String(c.email||'') === emailVal)
        );
        if (dup) {
          if (errorEl) errorEl.textContent = `קיים איש קשר עם פרטים אלו: ${dup.contact_name}. בוחר אותו.`;
          if (select) select.value = String(dup.id);
          updatePreview();
          if (addForm) addForm.style.display = 'none';
          if (addBtn)  addBtn.style.display  = '';
          return;
        }

        if (saveNewBtn) { saveNewBtn.disabled = true; saveNewBtn.textContent = 'שומר...'; }
        try {
          const newC = await api.createSchoolContact({
            school_id: schoolId || undefined,
            school,
            authority,
            contact_name: nameVal,
            contact_role: roleVal,
            phone: phoneVal,
            email: emailVal
          });
          loadedContacts.push(newC);
          const opt = document.createElement('option');
          opt.value = String(newC.id);
          const ph = String(newC.phone || newC.mobile || '').trim();
          opt.textContent = [String(newC.contact_name||'').trim(), String(newC.contact_role||'').trim(), ph].filter(Boolean).join(' — ');
          if (select) { select.appendChild(opt); select.value = String(newC.id); }
          updatePreview();
          if (addForm) addForm.style.display = 'none';
          if (addBtn)  addBtn.style.display  = '';
          addForm.querySelector('[data-new-contact-name]').value  = '';
          addForm.querySelector('[data-new-contact-role]').value  = '';
          addForm.querySelector('[data-new-contact-phone]').value = '';
          addForm.querySelector('[data-new-contact-email]').value = '';
        } catch (err) {
          if (errorEl) errorEl.textContent = err?.message || 'שמירת איש הקשר נכשלה';
        } finally {
          if (saveNewBtn) { saveNewBtn.disabled = false; saveNewBtn.textContent = 'שמור איש קשר'; }
        }
      });

      const drawerForm = contentRoot.querySelector('[data-drawer-form]');
      if (drawerForm) {
        drawerForm.addEventListener('change', (ev) => {
          if (ev.target.name === 'school') {
            const newSchool    = ev.target.value;
            const newAuthority = drawerForm.querySelector('[name="authority"]')?.value || authority;
            loadContacts(newSchool, newAuthority);
          }
        });
      }

      loadContacts();
    }

    function makeOnOpen(contentRoot) {
      hideShellHeader(contentRoot);
      bindActivityEditForm(contentRoot);
      bindContact2027Section(contentRoot);
    }

    function bindActivitiesReopenBtn(contentRoot, row) {
      const btn = contentRoot.querySelector('[data-activity-archive-reopen]');
      if (!btn) return;
      btn.addEventListener('click', () => {
        ui.openModal({
          title: 'פתיחה מחדש של פעילות',
          content: `<div class="ds-perm-edit-form" dir="rtl">
            <p class="ds-muted">הפעילות תיפתח מחדש בסטטוס פתוח, ללא שינוי בתאריכים הקיימים.</p>
            <p class="ds-muted" role="alert" data-activity-reopen-error></p>
          </div>`,
          actions: `
            <button type="button" class="ds-btn ds-btn--ghost" data-ui-close-modal>ביטול</button>
            <button type="button" class="ds-btn ds-btn--primary" data-activity-reopen-confirm>אישור פתיחה מחדש</button>
          `
        });
        const modal = document.querySelector('.ds-modal');
        const errorEl = modal?.querySelector('[data-activity-reopen-error]');
        const confirmBtn = modal?.querySelector('[data-activity-reopen-confirm]');
        const setError = (msg) => { if (errorEl) errorEl.textContent = msg || ''; };
        confirmBtn?.addEventListener('click', async () => {
          setError('');
          confirmBtn.disabled = true;
          confirmBtn.textContent = 'שומר…';
          try {
            await api.saveActivity({
              source_sheet: row.source_sheet || 'activities',
              source_row_id: row.RowID || row.row_id,
              changes: { status: 'פתוח' }
            });
            ui.closeModal?.();
            ui.closeDrawer?.();
            patchLocalRowFromSave({ sourceRowId: row.RowID || row.row_id, changes: { status: 'פתוח' } });
            rerenderLocal();
            void scheduleQuietRefresh();
          } catch (_e) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'אישור פתיחה מחדש';
            setError('שמירת הפתיחה מחדש נכשלה. נסו שוב.');
          }
        });
      });
    }

    async function openActivityDetail(summaryRow) {
      if (!summaryRow || !ui) return;
      const cachedDetail = getCachedActivityDetail(summaryRow, state);
      const cachedDates  = getCachedActivityDates(summaryRow, state);
      const canDirectEdit = canDirectManageActivities(state);
      const canRequestEdit = canRequestActivityChanges(state);
      const canReopenActivity = canDirectManageActivities(state) && state.activityPeriodTab === 'archive';
      const settings = mergeSettingsWithFallback(
        state?.clientSettings || {},
        buildFallbackOptionsFromRows(activitiesRows)
      );

      const buildDrawerContent = (row, datesLoading) => {
        const base = activityDrawerContent(
          row, canSeePrivateNotes, canEditActivity, canDirectEdit, canRequestEdit,
          canDeleteActivity, hideEmpIds, hideRowId, hideActivityNo, settings, { datesLoading }
        );
        if (!canReopenActivity) return base;
        return `<div style="padding:12px 16px 0;text-align:right">
          <button type="button" class="ds-btn ds-btn--sm ds-archive-reopen-btn" data-activity-archive-reopen="${escapeHtml(String(row.RowID || ''))}">
            🔓 פתח מחדש
          </button>
        </div>` + base;
      };

      const makeOnOpenWithReopen = (row) => (contentRoot) => {
        makeOnOpen(contentRoot);
        if (canReopenActivity) bindActivitiesReopenBtn(contentRoot, row);
      };

      if (cachedDetail) {
        ui.openDrawer({
          title: '',
          content: buildDrawerContent(cachedDetail, false),
          onOpen: makeOnOpenWithReopen(cachedDetail),
          onClose: () => {
            const shellHdr = document.querySelector('.ds-drawer > header');
            if (shellHdr) shellHdr.hidden = false;
          }
        });
        return;
      }

      const needDates = !cachedDates;
      ui.openDrawer({
        title: '',
        content: buildDrawerContent(summaryRow, needDates),
        onOpen: makeOnOpenWithReopen(summaryRow),
        onClose: () => {
          const shellHdr = document.querySelector('.ds-drawer > header');
          if (shellHdr) shellHdr.hidden = false;
        }
      });

      if (cachedDates && !needDates) {
        const sectionEl = document.querySelector('[data-dates-section]');
        if (sectionEl) patchDrawerDatesSection(sectionEl, cachedDates);
      }

      const srcRowId    = summaryRow.source_row_id || summaryRow.RowID;
      const srcSheet    = summaryRow.source_sheet || '';

      if (needDates) {
        api.activityDates(srcRowId, srcSheet)
          .then((datesData) => {
            putCachedActivityDates(summaryRow, datesData, state);
            const sectionEl = document.querySelector('[data-dates-section]');
            if (sectionEl) patchDrawerDatesSection(sectionEl, datesData);
          })
          .catch(() => {
            const sectionEl = document.querySelector('[data-dates-section]');
            if (sectionEl) sectionEl.removeAttribute('data-dates-loading');
          });
      }

      loadDetailRow(summaryRow)
        .then((row) => { putCachedActivityDetail(summaryRow, row, state); })
        .catch(() => {});
    }

    const gapFromQuery = readActivitiesGapFromQuery();
    if (gapFromQuery) state.activitiesGapFilter = gapFromQuery;
    else if (!isActivitiesGapQueryValue(state.activitiesGapFilter)) {
      state.activitiesGapFilter = '';
    }
    syncActivitiesGapQuery(state.activitiesGapFilter);

    bindLocalFilters(root, state, ACTIVITIES_SCOPE, rerenderLocal, { debounceMs: 150, onClear: () => {
      state.activityQuickFamily = '';
      state.activityQuickManager = '';
      state.activityEndingCurrentMonth = false;
      state.activitiesGapFilter = '';
      syncActivitiesGapQuery('');
      state.activityFinanceStatus = '';
    } });
    async function loadAllActivitiesForAdmin() {
      return typeof api.allActivities === 'function' ? api.allActivities() : api.activities({ activity_type: 'all' });
    }

    root.querySelector('[data-activities-export-all]')?.addEventListener('click', async (ev) => {
      if (!isAdmin) return;
      const btn = ev.currentTarget;
      btn.disabled = true;
      const originalText = btn.textContent;
      btn.textContent = 'מייצא…';
      try {
        const res = await loadAllActivitiesForAdmin();
        const sourceRows = Array.isArray(res?.rows) ? res.rows : [];
        const rows = activityRowsForInnerTab(sourceRows, state);
        const activeInnerTab = normalizeActivitiesInnerTab(state.activitiesInnerTab, state.activityPeriodTab);
        const exportLabel = activityInnerTabsForYear(state.activityPeriodTab).find((tab) => tab.key === activeInnerTab)?.label || globalActivityPeriodLabel(state.activityPeriodTab);
        exportActivitiesToExcel(rows, `פעילויות_${exportLabel}`);
      } catch (err) {
        console.error('Failed to export all activities to Excel', err);
      } finally {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    });


    root.querySelector('[data-activity-layout-list]')?.addEventListener('click', async (ev) => {
      if (!canUseActivityLayout(state) || state.activityPeriodTab !== ACTIVITY_LAYOUT_SEASON || !ui) return;
      const btn = ev.currentTarget;
      btn.disabled = true;
      ui.openDrawer({
        title: 'פריסת פעילות',
        content: '<div class="ds-loading-card" dir="rtl" role="status"><div class="ds-spinner" aria-hidden="true"></div><p>טוען בתי ספר מוכנים להפקה...</p></div>'
      });
      try {
        await renderActivityLayoutDrawerContent();
      } finally {
        btn.disabled = false;
      }
    });

    if (root._activityLayoutDocAbort) root._activityLayoutDocAbort.abort();
    root._activityLayoutDocAbort = new AbortController();
    document.addEventListener('click', async (ev) => {
      const openBtn = ev.target.closest?.('[data-activity-layout-open]');
      const sentBtn = ev.target.closest?.('[data-activity-layout-sent]');
      if (!openBtn && !sentBtn) return;
      if (!canUseActivityLayout(state)) return;
      const group = groupByActivityLayoutKey((openBtn || sentBtn).getAttribute(openBtn ? 'data-activity-layout-open' : 'data-activity-layout-sent'));
      if (!group) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (openBtn) openActivityLayoutDocument(group);
      if (sentBtn) await markActivityLayoutSent(group, sentBtn);
    }, { signal: root._activityLayoutDocAbort.signal });

    root.querySelectorAll('[data-activity-period-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.activitiesInnerTab = normalizeActivitiesInnerTab(btn.getAttribute('data-activity-period-tab'), state.activityPeriodTab);
        clearScreenDataCache?.();
        state.activitiesSummerShowAll = false;
        if (activityPeriodUsesMonthNavigation(state)) {
          ensureActivityPeriodMonth(state, activitiesRows, { force: true });
        } else {
          state.activitiesMonthYm = '';
        }
        ensureActivityListFilters(state, ACTIVITIES_SCOPE).visibleCount = 200;
        rerenderLocal();
      });
    });

    root.querySelector('[data-all-activities-status-filter]')?.addEventListener('change', (ev) => {
      state.allActivitiesStatusFilter = normalizeAllActivitiesStatusFilter(ev.currentTarget?.value);
      ensureActivityListFilters(state, ACTIVITIES_SCOPE).visibleCount = 200;
      rerenderLocal();
    });
    root.querySelector(`[data-list-show-more="${ACTIVITIES_SCOPE}"]`)?.addEventListener('click', (ev) => {
      const next = Number(ev.currentTarget?.dataset?.nextCount || 200);
      ensureActivityListFilters(state, ACTIVITIES_SCOPE).visibleCount = next;
      rerenderLocal();
    });

    if (root._addActivityAbort) root._addActivityAbort.abort();
    root._addActivityAbort = new AbortController();
    const addActivitySig = { signal: root._addActivityAbort.signal };

    function refreshActivityNameSelect(form) {
      const typeSel = form.querySelector('[data-add-activity-type]');
      const nameSel = form.querySelector('[data-add-activity-name]');
      const noInput = form.querySelector('[data-add-activity-no]');
      if (!typeSel || !nameSel || !noInput) return;
      const all = decodeJsonAttr(form.dataset.addActivityNames, []);
      const type = normalizeActivityTypeKey(typeSel.value);
      const hasTagged = all.some((o) => String(o?.parent_value || o?.activity_type || '').trim());
      let list = type ? all.filter((o) => activityTypeMatches(o?.parent_value || o?.activity_type, type)) : [];
      if (type && !list.length && !hasTagged) list = all;
      const current = String(nameSel.value || '').trim();
      const currentStillValid = list.some((o) => String(o?.label || '').trim() === current);
      const nextValue = currentStillValid ? current : '';
      nameSel.innerHTML = optionsHtml(list.map((o) => o.label), nextValue, type ? 'בחרו שם פעילות' : 'בחרו קודם סוג פעילות');
      nameSel.disabled = !type;
      nameSel.value = nextValue;
      const hit = list.find((o) => String(o?.label || '').trim() === String(nameSel.value || '').trim());
      noInput.value = String(hit?.activity_no || '');
    }

    function updateAddFormByFamily(form) {
      const sourceInput = form.querySelector('input[name="source"]');
      if (sourceInput) sourceInput.value = 'catalog';

      const sessionsSel = form.querySelector('[data-add-sessions]');
      if (sessionsSel) sessionsSel.value = String(sessionsSel.value || '1') || '1';

      const typeSel = form.querySelector('[data-add-activity-type]');
      if (typeSel) {
        let allTypes = [];
        try { allTypes = JSON.parse(typeSel.dataset.allTypes || '[]'); } catch {}
        const normalizedTypes = allTypes.map((type) => normalizeActivityTypeKey(type) || type);
        typeSel.innerHTML = optionsHtml(normalizedTypes, '', 'בחרו סוג פעילות', activityTypeDisplayLabel);
      }
      refreshActivityNameSelect(form);
      syncSessionDateRows(form);
    }

    function computeNextSessionDate(baseIso, index) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(baseIso || ''))) return '';
      const base = new Date(`${baseIso}T00:00:00`);
      base.setDate(base.getDate() + (index * 7));
      return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
    }

    function syncSessionDateRows(form) {
      const typeValue = String(form.querySelector('[name="activity_type"]')?.value || '').trim();
      const isOneDay = isOneDayActivityTypeValue(typeValue);
      const sessionsInput = form.querySelector('[data-add-sessions]');
      const sessionsField = form.querySelector('[data-field-sessions]');
      const oneDayDateField = form.querySelector('[data-field-one-day-date]');
      const startDateField = form.querySelector('[data-field-start-date]');
      const endDateField = form.querySelector('[data-field-end-date]');
      const sessionsDatesWrap = form.querySelector('[data-add-date-rows-wrap]');
      const startDateInput = form.querySelector('[name="start_date"]');
      const endDateInput = form.querySelector('[name="end_date"]');
      const oneDayDateInput = form.querySelector('[name="one_day_date"]');
      if (isOneDay) {
        const fallbackDate = String(oneDayDateInput?.value || startDateInput?.value || endDateInput?.value || '').trim();
        if (oneDayDateInput) oneDayDateInput.value = fallbackDate;
        if (startDateInput) startDateInput.value = fallbackDate;
        if (endDateInput) endDateInput.value = fallbackDate;
      }
      if (oneDayDateField) oneDayDateField.style.display = isOneDay ? '' : 'none';
      if (startDateField) startDateField.style.display = isOneDay ? 'none' : '';
      if (endDateField) endDateField.style.display = isOneDay ? 'none' : '';
      if (sessionsDatesWrap) sessionsDatesWrap.style.display = isOneDay ? 'none' : '';
      if (sessionsInput) {
        sessionsInput.value = isOneDay ? '1' : String(sessionsInput.value || '1');
        sessionsInput.disabled = isOneDay;
      }
      if (sessionsField) sessionsField.style.display = isOneDay ? 'none' : '';
      const sessions = isOneDay ? 1 : Math.max(1, Number(sessionsInput?.value || '1'));
      const container = form.querySelector('[data-add-date-rows]');
      if (!container) return;
      const startDate = String(form.querySelector('[name="start_date"]')?.value || '').trim();
      const prev = Array.from(container.querySelectorAll('input[data-add-session-date]')).map((input) => String(input.value || '').trim());
      container.innerHTML = Array.from({ length: sessions }, (_, idx) => {
        const value = idx === 0 ? (startDate || prev[idx] || '') : (prev[idx] || computeNextSessionDate(startDate, idx));
        return `<label class="ds-add-date-row"><span>מפגש ${idx + 1}</span><input class="ds-input ds-input--sm" type="date" data-add-session-date="${idx + 1}" value="${escapeHtml(value)}"></label>`;
      }).join('');
    }

    function bindAddActivityForm() {
      const modalContent = document.querySelector('.ds-modal__content');
      const form = modalContent?.querySelector('[data-add-activity-form]');
      if (!form || form.dataset.boundAddActivity === 'yes') return;
      form.dataset.boundAddActivity = 'yes';

      updateAddFormByFamily(form);
      syncSessionDateRows(form);
      form.querySelector('[data-add-activity-type]')?.addEventListener('change', () => {
        refreshActivityNameSelect(form);
        syncSessionDateRows(form);
      }, addActivitySig);

      form.querySelector('[data-add-activity-name]')?.addEventListener('change', () => {
        refreshActivityNameSelect(form);
      }, addActivitySig);
      form.querySelector('[data-add-sessions]')?.addEventListener('change', () => syncSessionDateRows(form), addActivitySig);
      form.querySelector('[name="start_date"]')?.addEventListener('change', () => syncSessionDateRows(form), addActivitySig);
      form.querySelector('[name="one_day_date"]')?.addEventListener('change', () => syncSessionDateRows(form), addActivitySig);
      form.querySelector('[data-add-date-rows]')?.addEventListener('change', (ev) => {
        const firstDate = ev.target.closest('input[data-add-session-date="1"]');
        if (!firstDate) return;
        const startDateInput = form.querySelector('[name="start_date"]');
        if (startDateInput) startDateInput.value = String(firstDate.value || '').trim();
        syncSessionDateRows(form);
      }, addActivitySig);
      bindEntityFieldToggle(form, 'authority');
      bindEntityFieldToggle(form, 'school');
    }

    function bindEntityFieldToggle(form, entityKey) {
      const toggleBtn = form.querySelector(`[data-entity-toggle="${entityKey}"]`);
      const selectInput = form.querySelector(`[data-entity-select="${entityKey}"]`);
      const customInput = form.querySelector(`[data-entity-custom="${entityKey}"]`);
      if (!toggleBtn || !selectInput || !customInput) return;
      let useCustom = false;
      const render = () => {
        selectInput.style.display = useCustom ? 'none' : '';
        customInput.style.display = useCustom ? '' : 'none';
        customInput.disabled = !useCustom;
        selectInput.disabled = useCustom;
        toggleBtn.textContent = useCustom
          ? (entityKey === 'authority' ? 'בחירה מהרשימה' : 'בחירה מהרשימה')
          : (entityKey === 'authority' ? '+ רשות חדשה' : '+ בית ספר חדש');
        if (useCustom) {
          selectInput.value = '';
          customInput.focus();
        } else {
          customInput.value = '';
          selectInput.focus();
        }
      };
      toggleBtn.addEventListener('click', () => {
        useCustom = !useCustom;
        render();
      }, addActivitySig);
      render();
    }

    function setAddActivityStatus(statusEl, message, { isError = false } = {}) {
      if (!statusEl) return;
      statusEl.textContent = message;
      statusEl.setAttribute('role', isError ? 'alert' : 'status');
      statusEl.classList.toggle('ds-error-text', isError);
    }

    function resetAddActivitySavingState(form, submitBtn) {
      if (!form) return;
      form.dataset.saving = '';
      form.dataset.submitting = 'no';
      const button = submitBtn || document.querySelector('[data-add-activity-submit]');
      if (!button) return;
      button.disabled = false;
      button.classList.remove('is-loading');
      if (button.dataset.defaultText) button.textContent = button.dataset.defaultText;
    }

    function readableActivityAddError(error) {
      const status = String(error?.status || error?.code || '').trim();
      const message = String(error?.message || error || '').trim();
      if (message === 'forbidden_add_activity' || status === '403') return 'אין הרשאת הוספת פעילות';
      if (message === 'forbidden_create_activity_request') return 'אין הרשאה לשליחת בקשת הוספת פעילות';
      return message || 'שגיאה לא ידועה';
    }

    async function submitAddActivityForm(form, submitBtn) {
      const statusEl = form.querySelector('[data-add-activity-status]');
      if (form.dataset.saving === 'yes' || form.dataset.submitting === 'yes') {
        return;
      }
      const activityMap = decodeJsonAttr(form.dataset.addActivityNames, []);
      const roster = decodeJsonAttr(form.dataset.addRosterUsers, []);
      const schoolRecords = decodeJsonAttr(form.dataset.addSchoolRecords, []);
      const fd = new (window?.FormData || FormData)(form);
      const get = (k) => String(fd.get(k) || '').trim();
      const authorityCustom = get('authority_custom');
      const schoolCustom = get('school_custom');
      const authorityValue = humanDisplayText(authorityCustom || get('authority'));
      const schoolValue = humanDisplayText(schoolCustom || get('school'));
      const selectedSchool = !schoolCustom ? schoolRecords.find((school) => {
        const label = humanDisplayText(school?.name || school?.value);
        return label && label === schoolValue;
      }) : null;
      const selectedName = get('activity_name');
      const selectedType = normalizeOneDayActivityType(get('activity_type')) || normalizeActivityTypeKey(get('activity_type'));
      let activityAddDiagnostics = {};
      if (!selectedType) {
        setAddActivityStatus(statusEl, 'יש לבחור סוג פעילות', { isError: true });
        resetAddActivitySavingState(form, submitBtn);
        return;
      }
      if (!selectedName) {
        setAddActivityStatus(statusEl, 'יש לבחור שם פעילות', { isError: true });
        resetAddActivitySavingState(form, submitBtn);
        return;
      }
      const hit = activityMap.find((x) => {
        const label = String(x?.label || '').trim();
        const parent = x?.parent_value || x?.activity_type;
        return label === selectedName && activityTypeMatches(parent, selectedType);
      });
      if (!hit) {
        setAddActivityStatus(statusEl, 'יש לבחור שם פעילות מתוך הרשימה המסוננת', { isError: true });
        resetAddActivitySavingState(form, submitBtn);
        return;
      }
      const selectedInstructorEmpId = get('emp_id');
      const selectedInstructor2EmpId = get('emp_id_2');
      const instructor1 = resolveInstructorSelectionByEmpId(selectedInstructorEmpId, roster);
      const instructor2 = resolveInstructorSelectionByEmpId(selectedInstructor2EmpId, roster);
      if (instructor1.error || instructor2.error) {
        setAddActivityStatus(statusEl, instructor1.error === 'instructor_not_in_contacts' || instructor2.error === 'instructor_not_in_contacts' ? 'לא ניתן לשמור: המדריך שנבחר לא קיים בטבלת המדריכים. יש לעדכן את רשימת המדריכים.' : INSTRUCTOR_IDENTITY_ERROR_MESSAGE, { isError: true });
        resetAddActivitySavingState(form, submitBtn);
        return;
      }
      const instructor1Name = instructor1.name;
      const instructor2Name = instructor2.name;
      console.info('[activity-add:instructor-selection]', {
        selectedInstructorEmpId,
        selectedInstructorName: instructor1Name,
        selectedInstructor2EmpId,
        selectedInstructor2Name: instructor2Name
      });
      const sessionsValue = get('sessions') || '1';
      const isOneDay = isOneDayActivityTypeValue(get('activity_type'));
      const oneDayDate = String(get('one_day_date') || get('start_date') || get('end_date') || '').trim();
      let meetingDateValues = [];
      const payload = {
        source: isOneDay ? 'short' : 'long',
        activity_family: isOneDay ? 'one_day' : 'program',
        activity_manager: humanDisplayText(get('activity_manager')),
        authority_id: String(selectedSchool?.authority_id || '').trim() || null,
        school_id: String(selectedSchool?.school_id || '').trim() || null,
        authority: authorityValue || humanDisplayText(selectedSchool?.authority),
        school: schoolValue,
        grade: get('grade'),
        class_group: get('class_group'),
        activity_type: selectedType || get('activity_type'),
        item_type: selectedType || get('activity_type'),
        activity_season: normalizeActivitySeason(get('activity_season')),
        activity_name: humanDisplayText(selectedName),
        activity_no: String(hit?.activity_no || get('activity_no') || ''),
        sessions: isOneDay ? '1' : sessionsValue,
        price: get('price'),
        funding: get('funding'),
        start_time: get('start_time'),
        end_time: get('end_time'),
        instructor_name: instructor1Name,
        emp_id: instructor1.emp_id,
        instructor_name_2: instructor2Name,
        emp_id_2: instructor2.emp_id,
        start_date: isOneDay ? oneDayDate : get('start_date'),
        end_date: isOneDay ? oneDayDate || null : get('end_date') || null,
        status: get('status') || 'פתוח',
        notes: get('notes')
      };
      if (isOneDay) {
        const selectedDate = String(oneDayDate || payload.start_date || payload.end_date || '').trim();
        if (selectedDate) {
          meetingDateValues = [selectedDate];
          payload.start_date = selectedDate;
          payload.end_date = selectedDate;
          payload.Date1 = selectedDate;
          payload.date_1 = selectedDate;
        }
      } else {
        const dateInputs = Array.from(form.querySelectorAll('input[data-add-session-date]'));
        meetingDateValues = dateInputs.map((input) => String(input.value || '').trim());
        dateInputs.forEach((input, index) => {
          payload[`Date${index + 1}`] = String(input.value || '').trim();
          payload[`date_${index + 1}`] = String(input.value || '').trim();
        });
        const firstMeetingDate = String(meetingDateValues[0] || payload.start_date || '').trim();
        if (firstMeetingDate) {
          payload.start_date = firstMeetingDate;
          payload.Date1 = firstMeetingDate;
          payload.date_1 = firstMeetingDate;
        }
      }
      if (!payload.end_date) {
        const lastDate = meetingDateValues.filter(Boolean).pop();
        payload.end_date = lastDate || payload.start_date || null;
      }
      const participantType = normalizeActivityTypeKey(selectedType || payload.activity_type);
      if (participantType === 'workshop' || participantType === 'escape_room') {
        const rawParticipants = get('participants_count');
        if (rawParticipants) {
          const n = Number(rawParticipants);
          if (!Number.isInteger(n) || n <= 0) {
            setAddActivityStatus(statusEl, 'מספר משתתפים מעודכן חייב להיות מספר שלם חיובי', { isError: true });
            resetAddActivitySavingState(form, submitBtn);
            return;
          }
          payload.participants_count = n;
        }
      }
      activityAddDiagnostics = {
        date: isOneDay ? oneDayDate : String(meetingDateValues[0] || payload.start_date || '').trim(),
        start_time: payload.start_time,
        end_time: payload.end_time,
        activity_manager: payload.activity_manager,
        main_instructor: payload.instructor_name,
        extra_instructor: payload.instructor_name_2,
        notes: payload.notes,
        selected_activity_no: payload.activity_no,
        selected_activity_name: payload.activity_name,
        selected_activity_type: payload.activity_type,
        permissions: {
          can_add_activity: state?.user?.can_add_activity,
          can_edit_direct: state?.user?.can_edit_direct,
          can_request_edit: state?.user?.can_request_edit,
          role: String(state?.user?.role || '').trim()
        }
      };

      if (isOneDay && (!String(payload.activity_name || '').trim() || GENERIC_ONE_DAY_ACTIVITY_NAMES.has(String(payload.activity_name || '').trim()))) {
        setAddActivityStatus(statusEl, 'יש לבחור שם פעילות מתוך הרשימה', { isError: true });
        resetAddActivitySavingState(form, submitBtn);
        return;
      }
      const isSchool2027Activity = normalizeActivitySeason(payload.activity_season) === ACTIVITY_SEASON_SCHOOL_2027;
      if (isOneDay && !isSchool2027Activity && !String(payload.date_1 || payload.start_date || '').trim()) {
        setAddActivityStatus(statusEl, 'יש למלא תאריך פעילות', { isError: true });
        resetAddActivitySavingState(form, submitBtn);
        return;
      }
      if (!isOneDay && !isSchool2027Activity && !meetingDateValues.some((dateValue) => String(dateValue || '').trim())) {
        setAddActivityStatus(statusEl, 'יש למלא לפחות תאריך מפגש אחד', { isError: true });
        resetAddActivitySavingState(form, submitBtn);
        return;
      }
      if (!isSchool2027Activity && !String(payload.start_time || '').trim()) {
        setAddActivityStatus(statusEl, 'יש לבחור שעת התחלה', { isError: true });
        resetAddActivitySavingState(form, submitBtn);
        return;
      }
      if (!isSchool2027Activity && !String(payload.end_time || '').trim()) {
        setAddActivityStatus(statusEl, 'יש לבחור שעת סיום', { isError: true });
        resetAddActivitySavingState(form, submitBtn);
        return;
      }

      const required = [
        ['activity_type', 'סוג פעילות'],
        ['activity_name', 'שם פעילות'],
        ['authority', 'רשות'],
        ...(isSchool2027Activity ? [] : [['school', 'בית ספר']]),
        ...(isOneDay ? [['start_date', 'תאריך פעילות'], ['end_date', 'תאריך סיום'], ['date_1', 'תאריך פעילות']] : [])
      ];
      const missing = required.filter(([key]) => !String(payload[key] || '').trim()).map(([, label]) => label);
      if (missing.length) {
        setAddActivityStatus(statusEl, `לא ניתן לשמור: חסר ${missing.join(' / ')}`, { isError: true });
        resetAddActivitySavingState(form, submitBtn);
        return;
      }
      if (!isSchool2027Activity && !String(payload.activity_no || '').trim()) {
        setAddActivityStatus(statusEl, 'לא ניתן לשמור: חסר מזהה פעילות מקור', { isError: true });
        resetAddActivitySavingState(form, submitBtn);
        return;
      }
      const instructorPayloadGuard = validateInstructorIdentityPayload(payload, roster);
      if (!instructorPayloadGuard.valid) {
        setAddActivityStatus(statusEl, 'לא ניתן לשמור: המדריך שנבחר לא קיים בטבלת המדריכים. יש לעדכן את רשימת המדריכים.', { isError: true });
        resetAddActivitySavingState(form, submitBtn);
        return;
      }
      if (!isCreateRequestOnly && !canAddActivities(state)) {
        setAddActivityStatus(statusEl, 'לא ניתן לשמור: אין הרשאת הוספה', { isError: true });
        resetAddActivitySavingState(form, submitBtn);
        return;
      }
      if (isCreateRequestOnly && !canRequestActivityCreate(state)) {
        setAddActivityStatus(statusEl, 'לא ניתן לשמור: אין הרשאה לשליחת בקשת הוספה', { isError: true });
        resetAddActivitySavingState(form, submitBtn);
        return;
      }
      const originalText = submitBtn?.textContent || (isCreateRequestOnly ? 'שליחת בקשה' : 'שמור');
      if (submitBtn && !submitBtn.dataset.defaultText) submitBtn.dataset.defaultText = originalText;
      form.dataset.saving = 'yes';
      form.dataset.submitting = 'yes';
      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.classList.add('is-loading');
          submitBtn.textContent = isCreateRequestOnly ? 'שולח בקשה...' : 'שומר...';
        }
        setAddActivityStatus(statusEl, isCreateRequestOnly ? 'שולח בקשה לאישור...' : 'שומר...');
        if (isCreateRequestOnly) {
          const rsp = await api.submitCreateActivityRequest(payload);
          clearScreenDataCache?.();
          try { document.dispatchEvent(new CustomEvent('app:edit-requests-updated')); } catch (_) { /* ignore */ }
          const requestId = String(rsp?.request_id || '').trim();
          setAddActivityStatus(statusEl, requestId ? `הבקשה נשלחה לאישור · מזהה בקשה: ${requestId}` : 'הבקשה נשלחה לאישור');
          showToast('הבקשה להוספת פעילות נשלחה לאישור', 'success', 3200);
          ui?.closeModal?.();
          return;
        }
        const saved = await api.addActivity(payload);
        const savedRow = saved?.row;
        if (savedRow) {
          const savedRowId = String(savedRow.RowID || savedRow.row_id || '').trim();
          const existingIndex = activitiesRows.findIndex((row) => String(row?.RowID || row?.row_id || '').trim() === savedRowId);
          if (existingIndex >= 0) activitiesRows.splice(existingIndex, 1, savedRow);
          else activitiesRows.unshift(savedRow);
        }
        clearScreenDataCache?.();
        const savedPeriod = activityPeriodKey(savedRow || payload);
        const savedToOtherPeriod = savedPeriod !== state.activityPeriodTab;
        setAddActivityStatus(statusEl, savedToOtherPeriod
          ? 'הפעילות נשמרה בתקופה אחרת והועברה ללשונית המתאימה.'
          : 'הפעילות נשמרה');
        showToast(savedToOtherPeriod ? 'הפעילות נשמרה בתקופה אחרת והועברה ללשונית המתאימה.' : 'הפעילות נשמרה', 'success', 3000);
        if (savedToOtherPeriod) {
          state.activityPeriodTab = savedPeriod;
        }
        ui?.closeModal?.();
        await scheduleQuietRefresh();
        rerenderLocal();
      } catch (err) {
        console.error('[activity-add] save failed', { error: err, payload, diagnostics: activityAddDiagnostics });
        setAddActivityStatus(statusEl, `לא ניתן לשמור: ${readableActivityAddError(err)}`, { isError: true });
      } finally {
        form.dataset.saving = '';
        form.dataset.submitting = 'no';
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.classList.remove('is-loading');
          submitBtn.textContent = originalText;
        }
      }
    }

    function bindAddActivitySubmit(form) {
      if (!form || form.dataset.submitBound === 'yes') return;
      form.dataset.submitBound = 'yes';
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const submitBtn = document.querySelector('[data-add-activity-submit]');
        if (submitBtn?.disabled) return;
        await submitAddActivityForm(form, submitBtn);
      }, addActivitySig);
    }

    bindAddActivitySubmit(document.querySelector('[data-add-activity-form]'));

    document.addEventListener('click', (ev) => {
      const submit = ev.target.closest('[data-add-activity-submit]');
      if (!submit) return;
      const modal = document.querySelector('.ds-modal__content');
      const form = modal?.querySelector('[data-add-activity-form]');
      if (!form) {
        console.error('[activity-add] save failed', new Error('missing_add_activity_form'));
        if (modal) {
          const errorEl = document.createElement('p');
          errorEl.className = 'ds-error-text';
          errorEl.setAttribute('role', 'alert');
          errorEl.textContent = 'לא ניתן לשמור: טופס הוספת הפעילות לא נטען. סגרו ופתחו את החלון מחדש.';
          modal.appendChild(errorEl);
        }
        return;
      }
      if (submit.disabled) return;
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }, addActivitySig);

    document.addEventListener('click', (ev) => {
      if (!ev.target.closest('[data-ui-close-modal]')) return;
      resetAddActivitySavingState(document.querySelector('[data-add-activity-form]'), document.querySelector('[data-add-activity-submit]'));
    }, addActivitySig);

    const addBtn = root.querySelector('[data-activities-add-btn]');
    if (canAddActivity && ui && addBtn) {
      addBtn.addEventListener('click', () => {
        ui.openModal({
          title: isCreateRequestOnly ? 'בקשה להוספת פעילות' : 'הוספת פעילות',
          // חשוב: חלון הוספת פעילות חייב להשתמש ב-client settings האחידים
          // (כמו admin), ללא בניית רשימות fallback מתוך rows חלקיים של המסך.
          content: addActivityModalHtml(state?.clientSettings || {}, state.activityPeriodTab),
          actions: `
            <button type="button" class="ds-btn ds-btn--primary" data-add-activity-submit>${isCreateRequestOnly ? 'שליחת בקשה לאישור' : 'שמור'}</button>
            <button type="button" class="ds-btn" data-ui-close-modal>ביטול</button>
          `
        });
        const addActivityForm = document.querySelector('.ds-modal__content [data-add-activity-form]');
        const addActivitySubmit = document.querySelector('[data-add-activity-submit]');
        resetAddActivitySavingState(addActivityForm, addActivitySubmit);
        bindAddActivityForm();
        bindAddActivitySubmit(addActivityForm);
      }, addActivitySig);
    }


    root.querySelectorAll('.ds-data-row').forEach((n) => {
      n.tabIndex = 0;
      n.setAttribute('role', 'button');
    });
    if (root._rowAbort) root._rowAbort.abort();
    root._rowAbort = new AbortController();
    const rowSig = { signal: root._rowAbort.signal };
    root.addEventListener('click', (ev) => {
      const rowNode = ev.target.closest('.ds-data-row');
      if (!rowNode) return;
      ev.stopPropagation();
      const rowId = rowNode.dataset.rowId;
      const hit = filteredRows.find((row) => row.RowID === rowId);
      if (!hit || !ui) return;
      openActivityDetail(hit).catch(() => {});
    }, rowSig);
    root.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      const rowNode = ev.target.closest('.ds-data-row');
      if (!rowNode) return;
      ev.preventDefault();
      rowNode.click();
    }, rowSig);

    ui?.bindInteractiveCards(root, (action) => {
      if (!action.startsWith('activity:')) return;
      const rowId = action.replace('activity:', '');
      const row = filteredRows.find((r) => r.RowID === rowId);
      if (!row) return;
      openActivityDetail(row).catch(() => {});
    });
  }
};
