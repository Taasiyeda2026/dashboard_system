import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const wrapperUrl = new URL('../frontend/src/screens/operations-authorities-cleanup.js', import.meta.url);
const baseUrl = new URL('../frontend/src/screens/operations-authorities-cleanup-base.js', import.meta.url);
const fixUrl = new URL('../frontend/src/screens/operations-2027-remaining-fix.js', import.meta.url);
const managementUrl = new URL('../frontend/src/screens/operations-management.js', import.meta.url);

const [wrapperSource, baseSource, fixSource, managementSource] = await Promise.all([
  readFile(wrapperUrl, 'utf8'),
  readFile(baseUrl, 'utf8'),
  readFile(fixUrl, 'utf8'),
  readFile(managementUrl, 'utf8')
]);

test('existing operations cleanup remains loaded before the focused 2027 fix', () => {
  assert.match(wrapperSource, /operations-authorities-cleanup-base\.js/);
  assert.match(wrapperSource, /operations-2027-remaining-fix\.js/);
  assert.match(baseSource, /data-ops-custom-tab/);
});

test('2027 workshop inventory data is loaded lazily by the workshops tab only', () => {
  assert.match(managementSource, /operationsTabDataKey\(tab\)/);
  assert.match(managementSource, /if \(key === TAB_WORKSHOPS\)/);
  assert.match(managementSource, /workshopInventoryOpeningBalances\(\{\s*inventoryYear:\s*2027\s*\}\)/);
  assert.match(managementSource, /activity_period: ACTIVITY_SEASON_SCHOOL_2027, startDate: SCHOOL_2027_FROM, endDate: SCHOOL_2027_TO/);
  assert.doesNotMatch(fixSource, /api\.allActivities\(\{\s*activity_period: ACTIVITY_SEASON_REGULAR/);
});

test('2027 opening stock is calculated in a data model rather than patched from DOM cells', () => {
  assert.match(managementSource, /export function buildWorkshopOpeningStock2027/);
  assert.match(managementSource, /const expectedBalance = group\.openingStock - usedQuantity - requiredQuantity/);
  assert.match(managementSource, /workshopInventoryOpeningBalances/);
  assert.doesNotMatch(managementSource, /row\.cells\[[25]\]/);
  assert.doesNotMatch(fixSource, /const carryoverHtml = originalRender/);
});

test('2027 opening stock is independent from 2026 closing balances', () => {
  assert.doesNotMatch(managementSource, /function positiveOpeningLocationsFromClosingRow/);
  assert.doesNotMatch(managementSource, /מקור: יתרת הסגירה של קיץ 2026/);
  assert.match(managementSource, /WORKSHOP_STOCK_LOCATION_NAMES/);
  assert.match(managementSource, /מלאי גיל/);
});

test('2027 removes the period field and the two unsupported tabs only', () => {
  assert.match(fixSource, /HIDDEN_2027_TABS = new Set\(\['authorities', 'completion_approval'\]\)/);
  assert.match(fixSource, /periodControl\?\.closest\?\.\('\.ds-filter-field'\)\?\.remove/);
  assert.match(fixSource, /data-ops-year="2027"/);
  assert.match(fixSource, /state\.operationsManagement\.tab = 'workshops'/);
});

test('2027 ops load resets hidden tab before originalLoad so workshops data is fetched', async () => {
  if (!globalThis.localStorage) {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => { store.set(String(key), String(value)); },
      removeItem: (key) => { store.delete(String(key)); }
    };
  }
  if (!globalThis.sessionStorage) {
    const store = new Map();
    globalThis.sessionStorage = {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => { store.set(String(key), String(value)); },
      removeItem: (key) => { store.delete(String(key)); }
    };
  }
  if (!globalThis.document) {
    globalThis.document = {
      dispatchEvent() { return true; },
      addEventListener() {},
      documentElement: { dataset: {} },
      getElementById() { return null; },
      createElement() { return { textContent: '' }; },
      head: { appendChild() {} },
      querySelector() { return null }
    };
  }

  const { ACTIVITY_SEASON_SCHOOL_2027 } = await import('../frontend/src/screens/shared/summer-activity.js');
  const { operationsManagementScreen } = await import('../frontend/src/screens/operations-management.js');
  await import('../frontend/src/screens/operations-2027-remaining-fix.js');

  const state = {
    activityPeriodTab: ACTIVITY_SEASON_SCHOOL_2027,
    user: { role: 'admin' },
    listFilters: {},
    operationsManagement: {
      period: ACTIVITY_SEASON_SCHOOL_2027,
      tab: 'completion_approval',
      context: 'operations',
      dateFrom: '2026-09-01',
      dateTo: '2027-08-31',
      instructor: '__all__'
    }
  };

  const apiCalls = [];
  const api = {
    allActivities: async (query = {}) => {
      apiCalls.push({ method: 'allActivities', query });
      return { rows: [] };
    },
    adminLists: async () => {
      apiCalls.push({ method: 'adminLists' });
      return { categories: [] };
    },
    workshopStockDistributions: async () => {
      apiCalls.push({ method: 'workshopStockDistributions' });
      return { rows: [] };
    },
    workshopInventoryOpeningBalances: async () => {
      apiCalls.push({ method: 'workshopInventoryOpeningBalances' });
      return { rows: [] };
    },
    completionApprovalUploads: async () => {
      apiCalls.push({ method: 'completionApprovalUploads' });
      return { rows: [] };
    },
    schoolContactResponsibles: async () => {
      apiCalls.push({ method: 'schoolContactResponsibles' });
      return { rows: [] };
    },
    photoApprovalUploads: async () => {
      apiCalls.push({ method: 'photoApprovalUploads' });
      return { rows: [] };
    },
    instructorSchedulePrintContacts: async () => {
      apiCalls.push({ method: 'instructorSchedulePrintContacts' });
      return { rows: [] };
    }
  };

  const data = await operationsManagementScreen.load({ api, state });
  assert.equal(state.operationsManagement.tab, 'workshops', 'tab must be workshops before/after load');
  assert.deepEqual(data._loadedOperationsTabs, ['workshops']);
  assert.ok(apiCalls.some((call) => call.method === 'workshopInventoryOpeningBalances'), 'workshops opening balances must load');
  assert.ok(apiCalls.some((call) => call.method === 'adminLists'), 'workshops catalog must load');
  assert.equal(apiCalls.filter((call) => call.method === 'workshopStockDistributions').length, 0, '2027 must not load 2026 distributions');
  assert.equal(
    apiCalls.filter((call) => call.method === 'completionApprovalUploads').length,
    0,
    'completion_approval data must not load for a workshops screen'
  );
});
