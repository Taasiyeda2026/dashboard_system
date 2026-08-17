import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

if (!globalThis.localStorage) globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
if (!globalThis.sessionStorage) globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const {
  buildWorkshopOpeningStock2027,
  loadOperationsTabData,
  operationsManagementScreen,
  isWorkshopStockLocationName,
  WORKSHOP_STOCK_LOCATION_NAMES
} = await import('../frontend/src/screens/operations-management.js');
const { normalizeWorkshopInventory2027Data } = await import('../frontend/src/screens/operations-2027-remaining-fix.js');

const STOCK_LOCATIONS = new Set(['מלאי עידן', 'מלאי הילה', 'מלאי גיל']);
const HOLDERS = [
  'מלאי עידן', 'מלאי הילה', 'מלאי גיל',
  'אייל יוחאי', 'אילנה טיטייבסקי', 'איתמר יוחאי', 'אלדר מיכאל טייב',
  'אלכס זפקה', 'אפרת אוחיון', 'הנאא אבו אמזה', 'כרמית סמנדרוב'
];

const OFFICIAL_2027_ROWS = [
  ['activity_1', '001', 'אסטרונאוט על חוטים', 20, 50, 50, 0, 25, 0, 0, 30, 30, 15, 80],
  ['activity_2', '002', 'מעבורת חלל', 0, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ['activity_6', '006', 'קלידוסקופ', 0, 60, 80, 0, 0, 0, 0, 0, 0, 0, 0],
  ['activity_8', '008', 'נשכן מפרקים', 0, 0, 0, 10, 23, 33, 0, 0, 0, 48, 0],
  ['activity_9', '009', 'פרוגי המקפצת', 0, 0, 0, 0, 4, 17, 0, 0, 0, 60, 0],
  ['activity_10', '010', 'מכונית מגנטית', 0, 125, 0, 0, 8, 0, 0, 60, 0, 0, 0],
  ['activity_11', '011', 'ציפור שיווי משקל', 0, 113, 14, 0, 0, 0, 0, 16, 0, 60, 0],
  ['activity_13', '013', 'חללית בראשית', 15, 0, 0, 0, 0, 0, 14, 0, 0, 0, 0],
  ['activity_16', '016', 'כדור מולקולה', 0, 49, 28, 6, 0, 0, 20, 0, 0, 11, 0],
  ['activity_20', '020', 'גשר לאונרדו', 0, 6, 30, 0, 0, 0, 0, 0, 0, 25, 0],
  ['kofet_kesem', '029, 024', 'קופת קסם (ד׳-ו׳)', 0, 24, 0, 4, 12, 0, 15, 51, 0, 25, 0],
  ['activity_26', '026', 'יוסי התוכי', 200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ['gitara', '038, 030', 'הגיטרה הראשונה שלי', 0, 159, 19, 17, 0, 0, 0, 19, 0, 0, 0],
  ['shaon_robot', '032, 031', 'שעון רובוט - הזמן שלנו', 0, 31, 22, 0, 10, 11, 28, 17, 0, 0, 0],
  ['activity_34', '034', 'מערכת השמש', 30, 0, 0, 0, 0, 0, 0, 32, 0, 30, 0],
  ['activity_35', '035', 'טיל ואסטרונאוט אוויר', 200, 40, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ['activity_40', '040', 'מסלול מכונית מגנטית', 0, 20, 0, 23, 0, 13, 0, 0, 0, 0, 0],
  ['activity_15', '015', 'טלסקופ קפלר', 0, 0, 25, 0, 0, 0, 0, 29, 0, 0, 0],
  ['activity_23', '023', 'ספינר', 0, 0, 80, 0, 0, 0, 0, 0, 0, 0, 0],
  ['activity_21', '021', 'קטפולטה', 0, 0, 80, 0, 0, 0, 0, 0, 0, 0, 0],
  ['activity_12', '012', 'גלגל הקסם', 0, 0, 10, 0, 0, 0, 0, 0, 0, 0, 0]
];

function officialOpeningBalances() {
  const rows = [];
  for (const [key, nums, name, ...qtys] of OFFICIAL_2027_ROWS) {
    HOLDERS.forEach((holder, index) => {
      const quantity = qtys[index];
      if (!quantity || quantity <= 0) return;
      rows.push({
        inventory_year: 2027,
        activity_season: 'school_2027',
        stock_group_key: key,
        workshop_numbers: nums,
        workshop_name: name,
        holder_name: holder,
        holder_type: STOCK_LOCATIONS.has(holder) ? 'stock_location' : 'instructor',
        opening_quantity: quantity
      });
    });
  }
  return rows;
}

function catalogFromOfficial() {
  return OFFICIAL_2027_ROWS.flatMap(([key, nums, name]) => (
    String(nums).split(',').map((part) => {
      const workshopNo = String(part || '').trim();
      return {
        workshopNo,
        workshopName: name,
        stockGroupKey: key,
        stockGroupName: name
      };
    })
  ));
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

function row(overrides = {}) {
  return {
    activity_type: 'workshop',
    status: 'פתוח',
    activity_season: 'school_2027',
    start_date: '2026-10-01',
    activity_no: '001',
    activity_name: 'אסטרונאוט על חוטים',
    participants_count: 1,
    instructor_name: 'אלכס זפקה',
    ...overrides
  };
}

test('2027 opening stock comes only from workshop_inventory_opening_balances and ignores 2026 inputs', () => {
  const result = buildWorkshopOpeningStock2027({
    catalogRows: catalogFromOfficial(),
    workshopInventoryOpeningBalances: [
      {
        inventory_year: 2027,
        stock_group_key: 'activity_1',
        workshop_numbers: '001',
        workshop_name: 'אסטרונאוט על חוטים',
        holder_name: 'מלאי עידן',
        holder_type: 'stock_location',
        opening_quantity: 20
      }
    ],
    summer2026Rows: [
      row({ activity_season: 'summer_2026', start_date: '2026-07-01', status: 'סגור', participants_count: 999, activity_no: '001' })
    ],
    workshopStockDistributions: [
      { stock_group_key: 'activity_1', instructor_name: 'מלאי עידן', quantity_received: 999 }
    ],
    school2027Rows: []
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].openingStock, 20);
  assert.equal(result[0].expectedBalance, 20);
});

test('changing 2026 distributions or summer activities does not change 2027 opening stock', () => {
  const opening = officialOpeningBalances().filter((item) => item.stock_group_key === 'activity_2');
  const base = buildWorkshopOpeningStock2027({
    catalogRows: catalogFromOfficial(),
    workshopInventoryOpeningBalances: opening,
    school2027Rows: []
  });
  const mutated = buildWorkshopOpeningStock2027({
    catalogRows: catalogFromOfficial(),
    workshopInventoryOpeningBalances: opening,
    summer2026Rows: [row({ activity_season: 'summer_2026', start_date: '2026-07-01', status: 'סגור', participants_count: 50, activity_no: '002' })],
    workshopStockDistributions: [{ stock_group_key: 'activity_2', instructor_name: 'מלאי הילה', quantity_received: 1 }],
    school2027Rows: []
  });
  assert.equal(base[0].openingStock, 30);
  assert.equal(mutated[0].openingStock, 30);
});

test('official 2027 opening balances have 21 positive groups totaling 2541 and gil stock 438', () => {
  const result = buildWorkshopOpeningStock2027({
    catalogRows: catalogFromOfficial(),
    workshopInventoryOpeningBalances: officialOpeningBalances(),
    school2027Rows: []
  });
  assert.equal(result.length, 21);
  assert.equal(result.reduce((sum, item) => sum + item.openingStock, 0), 2541);
  assert.equal(result.reduce((sum, item) => sum + Number(item.gilStock || 0), 0), 438);

  const expectedByGroup = {
    activity_1: 300,
    activity_2: 30,
    activity_6: 140,
    activity_8: 114,
    activity_9: 81,
    activity_10: 193,
    activity_11: 203,
    activity_13: 29,
    activity_16: 114,
    activity_20: 61,
    kofet_kesem: 131,
    activity_26: 200,
    gitara: 214,
    shaon_robot: 119,
    activity_34: 92,
    activity_35: 240,
    activity_40: 56,
    activity_15: 54,
    activity_23: 80,
    activity_21: 80,
    activity_12: 10
  };
  for (const [key, total] of Object.entries(expectedByGroup)) {
    assert.equal(result.find((item) => item.stockGroupKey === key)?.openingStock, total, key);
  }
});

test('מלאי גיל is a stock location and not treated as an instructor', () => {
  assert.equal(isWorkshopStockLocationName('מלאי גיל'), true);
  assert.ok(WORKSHOP_STOCK_LOCATION_NAMES.has('מלאי גיל'));
  const result = buildWorkshopOpeningStock2027({
    catalogRows: catalogFromOfficial(),
    workshopInventoryOpeningBalances: officialOpeningBalances().filter((item) => item.stock_group_key === 'activity_23'),
    school2027Rows: [row({ activity_no: '023', activity_name: 'ספינר', instructor_name: 'מדריך א', participants_count: 5, status: 'פתוח' })]
  });
  const item = result.find((entry) => entry.stockGroupKey === 'activity_23');
  assert.equal(item.gilStock, 80);
  assert.match(item.stockLocationRows.map((rowItem) => rowItem.location).join('|'), /מלאי גיל/);
  assert.ok(item.instructorRows.some((holder) => holder.instructor === 'מלאי גיל'));
  assert.ok(item.instructorRows.some((holder) => holder.instructor === 'מדריך א'));
  assert.equal(item.instructorRows.find((holder) => holder.instructor === 'מלאי גיל')?.required, 0);
});

test('shared stock groups render as one row each', () => {
  const result = buildWorkshopOpeningStock2027({
    catalogRows: catalogFromOfficial(),
    workshopInventoryOpeningBalances: officialOpeningBalances(),
    school2027Rows: []
  });
  assert.equal(result.filter((item) => item.stockGroupKey === 'kofet_kesem').length, 1);
  assert.equal(result.filter((item) => item.stockGroupKey === 'gitara').length, 1);
  assert.equal(result.filter((item) => item.stockGroupKey === 'shaon_robot').length, 1);
  assert.match(result.find((item) => item.stockGroupKey === 'kofet_kesem').workshopNoDisplay, /024/);
  assert.match(result.find((item) => item.stockGroupKey === 'kofet_kesem').workshopNoDisplay, /029/);
  assert.match(result.find((item) => item.stockGroupKey === 'gitara').workshopNoDisplay, /030/);
  assert.match(result.find((item) => item.stockGroupKey === 'gitara').workshopNoDisplay, /038/);
  assert.match(result.find((item) => item.stockGroupKey === 'shaon_robot').workshopNoDisplay, /031/);
  assert.match(result.find((item) => item.stockGroupKey === 'shaon_robot').workshopNoDisplay, /032/);
});

test('zero opening groups are hidden, but positive opening groups remain after balance reaches zero/negative', () => {
  const opening = [
    {
      inventory_year: 2027,
      stock_group_key: 'activity_99',
      workshop_numbers: '099',
      workshop_name: 'סדנה אפס',
      holder_name: 'מלאי עידן',
      holder_type: 'stock_location',
      opening_quantity: 0
    },
    {
      inventory_year: 2027,
      stock_group_key: 'activity_1',
      workshop_numbers: '001',
      workshop_name: 'אסטרונאוט על חוטים',
      holder_name: 'מלאי עידן',
      holder_type: 'stock_location',
      opening_quantity: 5
    }
  ];
  const result = buildWorkshopOpeningStock2027({
    catalogRows: [
      { workshopNo: '099', workshopName: 'סדנה אפס', stockGroupKey: 'activity_99', stockGroupName: 'סדנה אפס' },
      { workshopNo: '001', workshopName: 'אסטרונאוט על חוטים', stockGroupKey: 'activity_1', stockGroupName: 'אסטרונאוט על חוטים' }
    ],
    workshopInventoryOpeningBalances: opening,
    school2027Rows: [
      row({ activity_no: '001', status: 'סגור', participants_count: 8, instructor_name: 'אלכס זפקה' })
    ]
  });
  assert.equal(result.some((item) => item.stockGroupKey === 'activity_99'), false);
  const kept = result.find((item) => item.stockGroupKey === 'activity_1');
  assert.ok(kept);
  assert.equal(kept.openingStock, 5);
  assert.equal(kept.expectedBalance, -3);
});

test('2027 usage uses only school_2027 activities', () => {
  const normalized = normalizeWorkshopInventory2027Data({
    workshopInventoryOpeningBalances: [
      {
        inventory_year: 2027,
        stock_group_key: 'activity_1',
        workshop_numbers: '001',
        workshop_name: 'אסטרונאוט על חוטים',
        holder_name: 'מלאי עידן',
        holder_type: 'stock_location',
        opening_quantity: 10
      }
    ],
    workshopInventory2027Rows: [
      row({ activity_season: 'school_2027', status: 'סגור', participants_count: 3 }),
      row({ activity_season: 'summer_2026', start_date: '2026-10-01', status: 'סגור', participants_count: 9 })
    ]
  }, school2027State());
  const result = buildWorkshopOpeningStock2027({
    catalogRows: catalogFromOfficial(),
    workshopInventoryOpeningBalances: normalized.workshopInventoryOpeningBalances,
    school2027Rows: normalized.workshopInventory2027Rows
  });
  const item = result.find((entry) => entry.stockGroupKey === 'activity_1');
  assert.equal(item.openingStock, 10);
  assert.equal(item.usedQuantity, 3);
  assert.equal(item.expectedBalance, 7);
});

test('workshops tab for 2027 loads catalog, opening balances and school_2027 activities only', async () => {
  const calls = [];
  const api = {
    adminLists: async () => { calls.push('adminLists'); return { categories: [] }; },
    workshopStockDistributions: async () => { calls.push('workshopStockDistributions'); return { rows: [] }; },
    workshopInventoryOpeningBalances: async (params) => {
      calls.push(`workshopInventoryOpeningBalances:${params.inventoryYear}`);
      return { rows: officialOpeningBalances() };
    },
    allActivities: async (params) => {
      calls.push(`allActivities:${params.activity_period}:${params.startDate}:${params.endDate}`);
      return { rows: [] };
    }
  };
  const state = school2027State();
  const data = await loadOperationsTabData(api, 'workshops', { state });
  assert.deepEqual(calls, [
    'adminLists',
    'workshopInventoryOpeningBalances:2027',
    'allActivities:school_2027:2026-09-01:2027-08-31'
  ]);
  assert.equal(data.workshopInventoryOpeningBalances.length, officialOpeningBalances().length);
  assert.deepEqual(data.workshopStockDistributions, []);
  assert.deepEqual(data.workshopInventorySourceRows, []);
});

test('direct operations-management entry for 2027 uses independent opening balances API', async () => {
  const featureLoadersSource = await readFile(new URL('../frontend/src/feature-loaders.js', import.meta.url), 'utf8');
  const opsSource = await readFile(new URL('../frontend/src/screens/operations-management.js', import.meta.url), 'utf8');
  const apiSource = await readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
  const migrationSource = await readFile(new URL('../supabase/migrations/20260807140000_workshop_inventory_opening_balances_2027.sql', import.meta.url), 'utf8');

  assert.match(featureLoadersSource, /'operations-management':\s*\['operations'\]/);
  assert.match(apiSource, /workshopInventoryOpeningBalances:\s*async/);
  assert.match(apiSource, /workshop_inventory_opening_balances/);
  assert.match(opsSource, /api\.workshopInventoryOpeningBalances/);
  assert.doesNotMatch(opsSource, /positiveOpeningLocationsFromClosingRow/);
  assert.doesNotMatch(opsSource, /needs2027 && api\.allActivities[\s\S]*ACTIVITY_SEASON_REGULAR/);
  assert.match(migrationSource, /create table if not exists public\.workshop_inventory_opening_balances/);
  assert.match(migrationSource, /inventory_year = 2027|inventory_year,\s*activity_season/i);
  assert.match(migrationSource, /מלאי גיל/);
});

test('2027 workshops table labels and detail include gil stock location', () => {
  const state = school2027State();
  state.operationsManagement.expandedWorkshop = 'activity_15';
  const html = operationsManagementScreen.render({
    rows: [],
    adminListsData: {
      categories: [{
        category: 'activity_names',
        items: catalogFromOfficial().map((item) => ({
          value: item.workshopNo,
          label: item.workshopName,
          _row: {
            category: 'activity_names',
            type: 'workshop',
            activity_type: 'workshop',
            active: true,
            activity_no: item.workshopNo,
            activity_name: item.workshopName,
            stock_group_key: item.stockGroupKey,
            stock_group_name: item.stockGroupName
          }
        }))
      }]
    },
    workshopInventoryOpeningBalances: officialOpeningBalances(),
    workshopInventory2027Rows: []
  }, { state });

  const mainTable = html.slice(html.indexOf('<table class="ds-table ds-table--compact ds-ops-mgmt-data-table ds-ops-workshops-table"'), html.indexOf('</thead>'));
  const headers = [...mainTable.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((match) => match[1].replace(/<[^>]+>/g, '').replace(/[▲▼]/g, '').trim());
  assert.deepEqual(headers, ['מס׳ סדנה', 'שם הסדנה', 'מלאי פתיחה 2027', 'ניצול בפועל 2027', 'צפי נדרש 2027', 'יתרה צפויה 2027', 'סטטוס']);
  assert.match(html, /טלסקופ קפלר[\s\S]*?<td class="ds-ops-workshop-col--metric">54<\/td>/);
  assert.match(html, /ספינר[\s\S]*?<td class="ds-ops-workshop-col--metric">80<\/td>/);
  assert.match(html, /קטפולטה[\s\S]*?<td class="ds-ops-workshop-col--metric">80<\/td>/);
  assert.match(html, /גלגל הקסם[\s\S]*?<td class="ds-ops-workshop-col--metric">10<\/td>/);
  assert.match(html, /מלאי גיל/);
  assert.match(html, /מחזיק \/ מיקום/);
  assert.match(html, /מלאי פתיחה/);
});

test('2026 workshops path still uses distributions and summer metrics', async () => {
  const opsSource = await readFile(new URL('../frontend/src/screens/operations-management.js', import.meta.url), 'utf8');
  assert.match(opsSource, /api\.workshopStockDistributions/);
  assert.match(opsSource, /function workshopMetricsRows/);
  assert.match(opsSource, /WORKSHOPS_SUMMER_FROM/);
  const calls = [];
  await loadOperationsTabData({
    adminLists: async () => { calls.push('adminLists'); return { categories: [] }; },
    workshopStockDistributions: async () => { calls.push('workshopStockDistributions'); return { rows: [] }; },
    workshopInventoryOpeningBalances: async () => { calls.push('workshopInventoryOpeningBalances'); return { rows: [] }; },
    allActivities: async () => { calls.push('allActivities'); return { rows: [] }; }
  }, 'workshops', { state: { activityPeriodTab: 'regular', operationsManagement: { period: 'regular', tab: 'workshops' } } });
  assert.deepEqual(calls, ['adminLists', 'workshopStockDistributions']);
});
