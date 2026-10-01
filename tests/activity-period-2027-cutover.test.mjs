import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

function memoryStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    clear() { values.clear(); }
  };
}

globalThis.localStorage = memoryStorage();
globalThis.sessionStorage = memoryStorage();

const {
  ACTIVE_ACTIVITY_SEASON,
  GLOBAL_ACTIVITY_PERIOD_STORAGE_KEY,
  defaultMonthForGlobalActivityPeriod,
  normalizeGlobalActivityPeriod
} = await import('../frontend/src/screens/shared/summer-activity.js');
const { state, setGlobalActivityPeriod } = await import('../frontend/src/state.js');
const {
  ACTIVITY_PERIOD_2027_CUTOVER_KEY,
  clearActivityPeriodScreenCache,
  resolveInitialActivityPeriod
} = await import('../frontend/src/activity-period-cutover.js');

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  state.user = null;
  state.screenDataCache = {};
  state.operationsManagement = undefined;
  state.activityPeriodTab = ACTIVE_ACTIVITY_SEASON;
  state.dashboardMonthYm = '';
});

test('initial activity period defaults to school_2027 and clamps the current calendar month', () => {
  assert.equal(ACTIVE_ACTIVITY_SEASON, 'school_2027');
  assert.equal(normalizeGlobalActivityPeriod(''), 'school_2027');
  assert.equal(resolveInitialActivityPeriod(localStorage).period, 'school_2027');
  assert.equal(defaultMonthForGlobalActivityPeriod('school_2027', new Date(2026, 9, 1)), '2026-10');
  assert.equal(defaultMonthForGlobalActivityPeriod('school_2027', new Date(2026, 10, 15)), '2026-11');
  assert.equal(defaultMonthForGlobalActivityPeriod('school_2027', new Date(2027, 0, 10)), '2027-01');
  assert.equal(defaultMonthForGlobalActivityPeriod('school_2027', new Date(2026, 7, 1)), '2026-09');
  assert.equal(defaultMonthForGlobalActivityPeriod('school_2027', new Date(2027, 9, 1)), '2027-08');
});

test('a stored legacy 2026 selection migrates once to 2027', () => {
  localStorage.setItem(GLOBAL_ACTIVITY_PERIOD_STORAGE_KEY, 'regular');

  const result = resolveInitialActivityPeriod(localStorage);

  assert.deepEqual(result, { period: 'school_2027', didCutover: true });
  assert.equal(localStorage.getItem(GLOBAL_ACTIVITY_PERIOD_STORAGE_KEY), 'school_2027');
  assert.equal(localStorage.getItem(ACTIVITY_PERIOD_2027_CUTOVER_KEY), '1');
});

test('manual 2026 selection stays active during the session but never survives a reload', () => {
  resolveInitialActivityPeriod(localStorage);

  setGlobalActivityPeriod('regular');
  assert.equal(state.activityPeriodTab, 'regular');
  assert.equal(localStorage.getItem(GLOBAL_ACTIVITY_PERIOD_STORAGE_KEY), 'regular');

  const reloaded = resolveInitialActivityPeriod(localStorage);

  assert.deepEqual(reloaded, { period: 'school_2027', didCutover: true });
  assert.equal(localStorage.getItem(GLOBAL_ACTIVITY_PERIOD_STORAGE_KEY), 'school_2027');
});

test('2027 selection uses the current month and applies the operations range', () => {
  state.operationsManagement = {};
  state.activityPeriodTab = 'regular';
  setGlobalActivityPeriod('school_2027', { persist: false, now: new Date(2026, 9, 1) });

  assert.equal(state.dashboardMonthYm, '2026-10');
  assert.equal(state.operationsManagement.dateFrom, '2026-09-01');
  assert.equal(state.operationsManagement.dateTo, '2027-08-31');
});

test('manual dashboard navigation survives same-period rerenders', () => {
  state.activityPeriodTab = 'regular';
  setGlobalActivityPeriod('school_2027', { persist: false, now: new Date(2026, 9, 1) });
  state.dashboardMonthYm = '2026-11';

  setGlobalActivityPeriod('school_2027', { persist: false, now: new Date(2026, 9, 1) });

  assert.equal(state.dashboardMonthYm, '2026-11');
});

test('a stale stored dashboard month does not override a fresh dashboard entry', () => {
  localStorage.setItem('dashboard_month_ym', '2026-09');
  state.activityPeriodTab = 'school_2027';
  state.dashboardMonthYm = '';

  setGlobalActivityPeriod('school_2027', { persist: false, now: new Date(2026, 9, 1) });

  assert.equal(state.dashboardMonthYm, '2026-10');
  assert.equal(localStorage.getItem('dashboard_month_ym'), '2026-09');
});

test('switching activity periods clamps the month to the selected period', () => {
  state.activityPeriodTab = 'school_2027';
  state.dashboardMonthYm = '2027-01';

  setGlobalActivityPeriod('regular', { persist: false, now: new Date(2026, 9, 1) });
  assert.equal(state.dashboardMonthYm, '2026-08');

  setGlobalActivityPeriod('school_2027', { persist: false, now: new Date(2026, 9, 1) });
  assert.equal(state.dashboardMonthYm, '2026-10');
});

test('period switch clears activity screens only and preserves proposals, instructors and contacts', () => {
  state.screenDataCache = {
    'dashboard:2026-09:period:regular': { data: 'dashboard' },
    'activities:periods': { data: 'activities' },
    'week:0:period:regular': { data: 'week' },
    'month:2026-09:period:regular': { data: 'month' },
    'end-dates': { data: 'end-dates' },
    'exceptions:period:regular': { data: 'exceptions' },
    'operations-management:period:regular': { data: 'operations' },
    'proposals-agreements': { data: 'proposals' },
    'instructors': { data: 'instructors' },
    'contacts': { data: 'contacts' },
    'client-files': { data: 'client-files' }
  };

  clearActivityPeriodScreenCache(state.screenDataCache);

  assert.deepEqual(Object.keys(state.screenDataCache).sort(), [
    'client-files',
    'contacts',
    'instructors',
    'proposals-agreements'
  ]);
});
