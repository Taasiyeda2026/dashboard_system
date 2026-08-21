import { state } from './state.js';
import { normalizeOperationalDistrict } from './screens/shared/district-normalization.js';

const DASHBOARD_DRILL_STATE_KEY = '__dashboardDrilldown';
const ACTIVITY_TYPE_ACTIONS = new Map([
  ['kpi|active_courses', 'course'],
  ['kpi|active_workshops', 'workshop'],
  ['kpi|active_tours', 'tour'],
  ['kpi|active_after_school', 'after_school'],
  ['kpi|active_escape_room', 'escape_room']
]);
const SHORT_ACTIVITY_TYPES = new Set(['workshop', 'tour', 'escape_room']);
const EXCLUDED_MONTHLY_STATUSES = new Set([
  'נמחק', 'בוטל', 'deleted', 'cancelled', 'canceled'
]);
let patchPromise = null;

function clean(value) {
  return String(value ?? '').trim();
}

function validYm(value) {
  const ym = clean(value).slice(0, 7);
  return /^\d{4}-\d{2}$/.test(ym) ? ym : '';
}

function normalizedStatus(row = {}) {
  return clean(row.status).toLocaleLowerCase('he-IL');
}

export function dashboardRowOccursInMonth(row = {}, ym = '') {
  const month = validYm(ym);
  if (!month) return true;
  const candidates = [row.start_date, row.date_start, row.end_date, row.date_end];
  for (let index = 1; index <= 35; index += 1) {
    candidates.push(row[`date_${index}`], row[`Date${index}`]);
  }
  return candidates.some((value) => clean(value).slice(0, 7) === month);
}

function monthlyDashboardRow(row = {}, ym = '') {
  return !EXCLUDED_MONTHLY_STATUSES.has(normalizedStatus(row)) && dashboardRowOccursInMonth(row, ym);
}

export function dashboardDrillTargetForAction(action = '') {
  const value = clean(action);
  if (ACTIVITY_TYPE_ACTIONS.has(value) || value === 'kpi|long' || value === 'kpi|short' || value === 'kpi|missing_instructor' || value === 'kpi|missing_start_date') {
    return 'activities';
  }
  if (value === 'kpi|instructors') return 'instructors';
  if (value === 'kpi|exceptions') return 'exceptions';
  if (value === 'kpi|endings') return 'end-dates';
  if (!value.startsWith('mstat|')) return '';
  const kind = value.split('|')[2] || '';
  if (kind === 'instructors') return 'instructors';
  if (kind === 'exceptions') return 'exceptions';
  if (kind === 'activities' || kind === 'long' || kind === 'endings') return 'activities';
  return '';
}

export function dashboardDrillActivityFamilyForAction(action = '') {
  const value = clean(action);
  const activityType = ACTIVITY_TYPE_ACTIONS.get(value) || '';
  if (SHORT_ACTIVITY_TYPES.has(activityType) || value === 'kpi|short') return 'short';
  if (activityType || value === 'kpi|long' || value === 'kpi|missing_instructor' || value === 'kpi|missing_start_date') return 'long';
  return '';
}

export function canonicalDashboardExceptionDistrict(value = '') {
  const district = normalizeOperationalDistrict(value);
  if (district === 'צפון') return 'מחוז צפון';
  if (district === 'מרכז') return 'מחוז מרכז';
  if (district === 'דרום') return 'מחוז דרום';
  return '';
}

function districtFromAction(action = '') {
  const value = clean(action);
  if (!value.startsWith('mstat|')) return '';
  const encoded = value.split('|')[1] || '';
  try {
    return normalizeOperationalDistrict(decodeURIComponent(encoded)) || '';
  } catch {
    return normalizeOperationalDistrict(encoded) || '';
  }
}

function captureDashboardDrill(action) {
  const target = dashboardDrillTargetForAction(action);
  if (!target) return;
  state[DASHBOARD_DRILL_STATE_KEY] = {
    target,
    action: clean(action),
    month: validYm(state.dashboardMonthYm),
    period: clean(state.activityPeriodTab),
    district: districtFromAction(action),
    capturedAt: Date.now()
  };
}

function activeDrill(target) {
  const drill = state[DASHBOARD_DRILL_STATE_KEY];
  if (!drill || drill.target !== target) return null;
  if (!validYm(drill.month)) return null;
  return drill;
}

function clearDashboardDrill() {
  delete state[DASHBOARD_DRILL_STATE_KEY];
}

function ensureActivityFiltersForDrill(drill) {
  const action = drill?.action || '';
  const type = ACTIVITY_TYPE_ACTIONS.get(action) || '';
  if (type) {
    state.listFilters = state.listFilters || {};
    const previous = state.listFilters.activities || {};
    state.listFilters.activities = {
      ...previous,
      activity_type: type,
      visibleCount: 200
    };
  }
  const family = dashboardDrillActivityFamilyForAction(action);
  if (family) state.activityQuickFamily = family;
  state.activitiesMonthYm = drill.month;
}

function patchActivitiesScreen(activitiesScreen) {
  if (!activitiesScreen || activitiesScreen.__dashboardDrilldownPatched) return;
  activitiesScreen.__dashboardDrilldownPatched = true;
  const originalLoad = activitiesScreen.load?.bind(activitiesScreen);
  const originalRender = activitiesScreen.render?.bind(activitiesScreen);

  if (originalLoad) {
    activitiesScreen.load = async function dashboardFilteredActivitiesLoad(context) {
      const drill = activeDrill('activities');
      if (drill) ensureActivityFiltersForDrill(drill);
      return originalLoad(context);
    };
  }

  if (originalRender) {
    activitiesScreen.render = function dashboardFilteredActivitiesRender(data, context) {
      const drill = activeDrill('activities');
      if (!drill || !Array.isArray(data?.rows)) return originalRender(data, context);
      const rows = data.rows.filter((row) => monthlyDashboardRow(row, drill.month));
      return originalRender({ ...data, rows }, context);
    };
  }
}

function instructorIdentityKeys(row = {}) {
  const keys = new Set();
  const add = (prefix, value) => {
    const normalized = clean(value).toLocaleLowerCase('he-IL');
    if (normalized) keys.add(`${prefix}:${normalized}`);
  };
  add('id', row.emp_id);
  add('id', row.emp_id_2);
  add('name', row.instructor_name);
  add('name', row.instructor_name_2);
  add('id', row.user_id);
  add('name', row.full_name);
  return keys;
}

async function activityRowsForInstructorDrill(context, drill) {
  const api = context?.api;
  if (!api) return [];
  const response = typeof api.allActivities === 'function'
    ? await api.allActivities({ activity_period: drill.period })
    : await api.activities({ activity_type: 'all', include_inactive: true });
  return Array.isArray(response?.rows) ? response.rows : [];
}

function patchInstructorsScreen(instructorsScreen) {
  if (!instructorsScreen || instructorsScreen.__dashboardDrilldownPatched) return;
  instructorsScreen.__dashboardDrilldownPatched = true;
  const originalLoad = instructorsScreen.load?.bind(instructorsScreen);
  if (!originalLoad) return;

  instructorsScreen.load = async function dashboardFilteredInstructorsLoad(context) {
    const result = await originalLoad(context);
    const drill = activeDrill('instructors');
    if (!drill || !Array.isArray(result?.rows)) return result;

    const activityRows = await activityRowsForInstructorDrill(context, drill);
    const matchingRows = activityRows.filter((row) => {
      if (!monthlyDashboardRow(row, drill.month)) return false;
      if (!drill.district) return true;
      return normalizeOperationalDistrict(row?.district || row?.activity_manager) === drill.district;
    });
    const allowed = new Set();
    matchingRows.forEach((row) => instructorIdentityKeys(row).forEach((key) => allowed.add(key)));
    const rows = result.rows.filter((row) => [...instructorIdentityKeys(row)].some((key) => allowed.has(key)));
    return { ...result, rows };
  };
}

function patchExceptionsScreen(exceptionsScreen) {
  if (!exceptionsScreen || exceptionsScreen.__dashboardDrilldownPatched) return;
  exceptionsScreen.__dashboardDrilldownPatched = true;
  const originalLoad = exceptionsScreen.load?.bind(exceptionsScreen);
  if (!originalLoad) return;

  exceptionsScreen.load = async function dashboardFilteredExceptionsLoad(context) {
    const drill = activeDrill('exceptions');
    if (drill) {
      state.exceptionsMonthYm = drill.month;
      state.listFilters = state.listFilters || {};
      const previous = state.listFilters.exceptions || {};
      state.listFilters.exceptions = {
        ...previous,
        q: '',
        district: drill.district ? canonicalDashboardExceptionDistrict(drill.district) : '',
        activity_manager: '',
        exception_type: '',
        visibleCount: 200
      };
    }
    return originalLoad(context);
  };
}

function patchEndDatesScreen(endDatesScreen) {
  if (!endDatesScreen || endDatesScreen.__dashboardDrilldownPatched) return;
  endDatesScreen.__dashboardDrilldownPatched = true;
  const originalRender = endDatesScreen.render?.bind(endDatesScreen);
  if (!originalRender) return;

  endDatesScreen.render = function dashboardFilteredEndDatesRender(data, context) {
    const drill = activeDrill('end-dates');
    if (!drill || !Array.isArray(data?.rows)) return originalRender(data, context);
    const rows = data.rows.filter((row) => clean(row?.end_date || row?.date_end).slice(0, 7) === drill.month);
    return originalRender({ ...data, rows }, context);
  };
}

function ensurePatchedScreens() {
  if (patchPromise) return patchPromise;
  patchPromise = Promise.all([
    import('./screens/activities.js'),
    import('./screens/instructors.js?v=20260809-guides-list-assignment-filter-fix-v2'),
    import('./screens/exceptions.js'),
    import('./screens/end-dates.js')
  ]).then(([activitiesModule, instructorsModule, exceptionsModule, endDatesModule]) => {
    patchActivitiesScreen(activitiesModule.activitiesScreen);
    patchInstructorsScreen(instructorsModule.instructorsScreen);
    patchExceptionsScreen(exceptionsModule.exceptionsScreen);
    patchEndDatesScreen(endDatesModule.endDatesScreen);
  }).catch((error) => {
    patchPromise = null;
    console.warn('[dashboard-drilldown] failed to prepare destination filters', error);
  });
  return patchPromise;
}

if (typeof document !== 'undefined') {
  document.addEventListener('app:navigate', (event) => {
    if (clean(event?.detail?.route) === 'dashboard') void ensurePatchedScreens();
  });

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const dashboardCard = target.closest('.ds-dashboard-wrap [data-card-action]');
    if (dashboardCard) {
      captureDashboardDrill(dashboardCard.getAttribute('data-card-action') || '');
      void ensurePatchedScreens();
      return;
    }

    if (target.closest('[data-filter-clear="activities"]')) {
      clearDashboardDrill();
      return;
    }

    const routeButton = target.closest('[data-route]');
    if (routeButton && !target.closest('.ds-dashboard-wrap')) clearDashboardDrill();
  }, true);

  const root = document.getElementById('app') || document.documentElement;
  new MutationObserver(() => {
    if (document.querySelector('.ds-dashboard-wrap')) void ensurePatchedScreens();
  }).observe(root, { childList: true, subtree: true });
}
