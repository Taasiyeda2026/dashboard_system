import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

if (!globalThis.localStorage) globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
if (!globalThis.sessionStorage) globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { buildWorkshopOpeningStock2027, loadOperationsTabData, operationsManagementScreen } = await import('../frontend/src/screens/operations-management.js');
const { normalizeWorkshopInventory2027Data } = await import('../frontend/src/screens/operations-2027-remaining-fix.js');

const catalogRows = [
  { workshopNo: '001', workshopName: 'סדנת מלאי', stockGroupKey: 'stock-a', stockGroupName: 'סדנת מלאי' },
  { workshopNo: '002', workshopName: 'סדנת קטלוג פעילה', stockGroupKey: 'stock-b', stockGroupName: 'סדנת קטלוג פעילה' }
];

function row(overrides = {}) {
  return {
    activity_type: 'workshop',
    status: 'פתוח',
    activity_season: 'summer_2026',
    start_date: '2026-07-01',
    activity_no: '001',
    activity_name: 'סדנת מלאי',
    participants_count: 1,
    instructor_name: 'מדריך א',
    ...overrides
  };
}

function school2027State() {
  return {
    activityPeriodTab: 'school_2027',
    operationsManagement: {
      period: 'school_2027',
      tab: 'workshops',
      dateFrom: '2026-09-01',
      dateTo: '2027-08-31',
      expandedWorkshop: ''
    }
  };
}

function baseDistributions() {
  return [
    { stock_group_key: 'stock-a', instructor_name: 'מלאי עידן', quantity_received: 4 },
    { stock_group_key: 'stock-a', instructor_name: 'מלאי הילה', quantity_received: 1 },
    { stock_group_key: 'stock-a', instructor_name: 'מיקום אפס', quantity_received: 0 },
    { stock_group_key: 'stock-a', instructor_name: 'מיקום שלילי', quantity_received: -2 },
    { stock_group_key: 'stock-a', instructor_name: 'מלאי עידן', quantity_received: 1 }
  ];
}

test('2026 closing balance 10 minus used 3 and forecast 2 becomes opening stock 5 for 2027', () => {
  const result = buildWorkshopOpeningStock2027({
    catalogRows,
    workshopStockDistributions: [{ stock_group_key: 'stock-a', instructor_name: 'מלאי עידן', quantity_received: 10 }],
    summer2026Rows: [
      row({ status: 'סגור', participants_count: 3 }),
      row({ status: 'פתוח', participants_count: 2 })
    ],
    school2027Rows: []
  });
  const item = result.find((entry) => entry.stockGroupKey === 'stock-a');
  assert.equal(item.openingStock, 5);
  assert.equal(item.stockQuantity, 5);
  assert.equal(item.usedQuantity, 0);
  assert.equal(item.requiredQuantity, 0);
  assert.equal(item.expectedBalance, 5);
});

test('positive opening locations are summed, zero and negative locations are skipped, and one row is kept per location', () => {
  const normalized = normalizeWorkshopInventory2027Data({
    workshopStockDistributions: baseDistributions(),
    workshopInventory2027Rows: []
  }, school2027State());
  const result = buildWorkshopOpeningStock2027({
    catalogRows,
    workshopStockDistributions: normalized.workshopStockDistributions,
    summer2026Rows: [],
    school2027Rows: normalized.workshopInventory2027Rows
  });
  const item = result.find((entry) => entry.stockGroupKey === 'stock-a');
  assert.equal(item.openingStock, 6);
  assert.deepEqual(item.openingLocations, [
    { location: 'מלאי עידן', quantity: 5 },
    { location: 'מלאי הילה', quantity: 1 }
  ]);
});

test('normalization keeps only school_2027 rows even when a wrong-season row falls inside the school-year dates', () => {
  const normalized = normalizeWorkshopInventory2027Data({
    workshopStockDistributions: [],
    workshopInventory2027Rows: [
      row({ activity_season: 'school_2027', start_date: '2026-10-01', status: 'סגור', participants_count: 3 }),
      row({ activity_season: 'summer_2026', start_date: '2026-10-01', status: 'סגור', participants_count: 9 })
    ]
  }, school2027State());
  assert.equal(normalized.workshopInventory2027Rows.length, 1);
  assert.equal(normalized.workshopInventory2027Rows[0].activity_season, 'school_2027');
});

test('stock_group_key and activity_no matching are exact and similar names without alias remain separate', () => {
  const result = buildWorkshopOpeningStock2027({
    catalogRows: [
      { workshopNo: '024', workshopName: 'קופת קסם', stockGroupKey: 'magic-box', stockGroupName: 'קופת קסם' },
      { workshopNo: '025', workshopName: 'קופת', stockGroupKey: 'short-box', stockGroupName: 'קופת' }
    ],
    workshopStockDistributions: [
      { stock_group_key: 'magic-box', instructor_name: 'מלאי עידן', quantity_received: 4 },
      { stock_group_key: 'short-box', instructor_name: 'מלאי הילה', quantity_received: 2 }
    ],
    summer2026Rows: [row({ activity_no: '024', activity_name: 'שם שלא אמור לנצח', participants_count: 1, status: 'סגור' })],
    school2027Rows: []
  });
  assert.equal(result.find((entry) => entry.stockGroupKey === 'magic-box').openingStock, 3);
  assert.equal(result.find((entry) => entry.stockGroupKey === 'short-box').openingStock, 2);
});

test('explicit existing alias unifies only configured names', () => {
  const result = buildWorkshopOpeningStock2027({
    catalogRows: [{ workshopNo: '', workshopName: 'פרוגי המקפצת', stockGroupKey: '', stockGroupName: 'פרוגי המקפצת' }],
    workshopStockDistributions: [{ stock_group_key: 'froggy', instructor_name: 'מלאי עידן', quantity_received: 3 }],
    summer2026Rows: [],
    school2027Rows: []
  });
  assert.equal(result.find((entry) => entry.stockGroupKey === 'froggy').openingStock, 3);
});

test('2027 usage uses school-year rows, does not use summer_2026 rows, and is not filtered by summer 2026 dates', () => {
  const normalized = normalizeWorkshopInventory2027Data({
    workshopStockDistributions: [{ stock_group_key: 'stock-a', instructor_name: 'מלאי עידן', quantity_received: 10 }],
    workshopInventory2027Rows: [
      row({ activity_season: 'school_2027', start_date: '2026-10-01', status: 'סגור', participants_count: 3 }),
      row({ activity_season: 'summer_2026', start_date: '2026-10-01', status: 'סגור', participants_count: 9 })
    ]
  }, school2027State());
  const result = buildWorkshopOpeningStock2027({
    catalogRows,
    workshopStockDistributions: normalized.workshopStockDistributions,
    summer2026Rows: [row({ status: 'סגור', participants_count: 2 })],
    school2027Rows: normalized.workshopInventory2027Rows
  });
  const item = result.find((entry) => entry.stockGroupKey === 'stock-a');
  assert.equal(item.openingStock, 8);
  assert.equal(item.usedQuantity, 3);
  assert.equal(item.requiredQuantity, 0);
  assert.equal(item.expectedBalance, 5);
});

test('groups with positive 2026 closing balance or active catalog rows appear without 2027 activities', () => {
  const normalized = normalizeWorkshopInventory2027Data({
    workshopStockDistributions: baseDistributions(),
    workshopInventory2027Rows: []
  }, school2027State());
  const result = buildWorkshopOpeningStock2027({
    catalogRows,
    workshopStockDistributions: normalized.workshopStockDistributions,
    summer2026Rows: [],
    school2027Rows: []
  });
  assert.ok(result.some((entry) => entry.stockGroupKey === 'stock-a' && entry.openingStock > 0));
  assert.ok(result.some((entry) => entry.stockGroupKey === 'stock-b' && entry.openingStock === 0));
});

test('workshop tab lazy loading loads inventory data once and detail toggles do not call the API', async () => {
  const calls = [];
  const api = {
    adminLists: async () => { calls.push('adminLists'); return { categories: [] }; },
    workshopStockDistributions: async () => { calls.push('workshopStockDistributions'); return { rows: [] }; },
    allActivities: async (params) => { calls.push(`allActivities:${params.activity_period}:${params.startDate}:${params.endDate}`); return { rows: [] }; }
  };
  const state = school2027State();
  state.operationsManagement.tab = 'instructors';
  const data = { rows: [], _loadedOperationsTabs: ['schedule'], _operationsTabLoadPromises: new Map() };
  assert.equal(calls.length, 0);

  state.operationsManagement.tab = 'workshops';
  Object.assign(data, await loadOperationsTabData(api, 'workshops', { state }));
  assert.deepEqual(calls, [
    'adminLists',
    'workshopStockDistributions',
    'allActivities:regular:2026-06-15:2026-08-30',
    'allActivities:school_2027:2026-09-01:2027-08-31'
  ]);
  data._loadedOperationsTabs.push('workshops');
  state.operationsManagement.expandedWorkshop = 'stock-a';
  operationsManagementScreen.render(data, { state });
  assert.equal(calls.length, 4);
  operationsManagementScreen.render(data, { state });
  assert.equal(calls.length, 4);
});

test('direct operations-management entry for 2027 loads lists catalog auth hotfix without visiting admin-lists', async () => {
  const featureLoadersSource = await readFile(new URL('../frontend/src/feature-loaders.js', import.meta.url), 'utf8');
  const hotfixSource = await readFile(new URL('../frontend/src/admin-lists-auth-hotfix.js', import.meta.url), 'utf8');
  const opsSource = await readFile(new URL('../frontend/src/screens/operations-management.js', import.meta.url), 'utf8');

  const operationsCase = featureLoadersSource.match(/case 'operations':\s*return loadOnce\('operations', \(\) => Promise\.all\(\[([\s\S]*?)\]\)\)/);
  assert.ok(operationsCase, 'operations feature loader case must exist');
  assert.match(operationsCase[1], /admin-lists-auth-hotfix\.js/,
    'operations feature must load admin-lists-auth-hotfix so direct ניהול תפעול entry waits for auth');
  assert.match(featureLoadersSource, /'operations-management':\s*\['operations'\]/,
    'operations-management must load via operations feature only, without requiring admin-lists first');
  assert.doesNotMatch(featureLoadersSource, /'operations-management':\s*\[[^\]]*admin/,
    'operations-management must not depend on the admin feature/screen visit');

  assert.match(hotfixSource, /waitForSupabaseAuthSession/);
  assert.match(hotfixSource, /\.from\('lists'\)/);
  assert.match(hotfixSource, /hasInventoryCatalog/);
  assert.match(hotfixSource, /activity_names/);
  assert.match(hotfixSource, /inventory_catalog_missing_after_auth_retry/);

  assert.match(opsSource, /api\.adminLists\(\)/);
  assert.match(opsSource, /api\.workshopStockDistributions/);
  assert.match(opsSource, /ACTIVITY_SEASON_SCHOOL_2027/);
  assert.doesNotMatch(opsSource, /completionApprovalUploads[\s\S]{0,200}admin-lists-auth-hotfix/,
    'summer completion-approval path must remain untouched by this inventory auth wiring');
});

test('inventory implementation does not calculate opening stock from DOM cells or add writes/RPC/migrations', async () => {
  const source = await readFile(new URL('../frontend/src/screens/operations-management.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /row\.cells\[[25]\]/);
  assert.doesNotMatch(buildWorkshopOpeningStock2027.toString(), /\.insert\s*\(|\.update\s*\(|\.upsert\s*\(|\.rpc\s*\(/);
});

test('2027 workshops table uses the same seven main columns as 2026 and keeps stock locations in detail', () => {
  const state = school2027State();
  state.operationsManagement.expandedWorkshop = 'stock-a';
  const html = operationsManagementScreen.render({
    rows: [],
    adminListsData: { categories: [{ category: 'activity_names', items: catalogRows.map((item) => ({ value: item.workshopNo, label: item.workshopName, _row: { category: 'activity_names', type: 'workshop', activity_type: 'workshop', active: true, activity_no: item.workshopNo, activity_name: item.workshopName, stock_group_key: item.stockGroupKey, stock_group_name: item.stockGroupName } })) }] },
    workshopStockDistributions: [{ stock_group_key: 'stock-a', instructor_name: 'מלאי עידן', quantity_received: 10 }],
    workshopInventorySourceRows: [
      row({ status: 'סגור', participants_count: 3 }),
      row({ status: 'פתוח', participants_count: 2 })
    ],
    workshopInventory2027Rows: [row({ activity_season: 'school_2027', start_date: '2026-10-01', status: 'פתוח', participants_count: 1 })]
  }, { state });
  const mainTable = html.slice(html.indexOf('<table class="ds-table ds-table--compact ds-ops-mgmt-data-table ds-ops-workshops-table"'), html.indexOf('</thead>'));
  const headers = [...mainTable.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((match) => match[1].replace(/<[^>]+>/g, '').replace(/[▲▼]/g, '').trim());
  assert.deepEqual(headers, ['מס׳ סדנה', 'שם הסדנה', 'כמות קיימת', 'ניצול בפועל', 'צפי נדרש', 'יתרה צפויה', 'סטטוס']);
  assert.doesNotMatch(mainTable, /מלאי פתיחה|מיקום מלאי הפתיחה/);
  assert.match(html, /סיכום מיקום מלאי/);
  assert.match(html, /מלאי עידן/);
  assert.match(html, /סדנת מלאי[\s\S]*?<td class="ds-ops-workshop-col--metric">5<\/td>[\s\S]*?<td class="ds-ops-workshop-col--metric">0<\/td>[\s\S]*?<td class="ds-ops-workshop-col--metric">1<\/td>[\s\S]*?<span class="ds-ops-gap ds-ops-gap--ok">4<\/span>/);
});
