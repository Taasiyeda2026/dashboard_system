import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  getActivitySchoolDisplayName,
  hasActivitySchoolOrFrame,
  getActivityInstructorName,
  getActivityPrimaryDate,
  getActivitySchoolNames,
  isSummerOperationsException,
  buildWorkshopStockMapFromLists,
  buildWorkshopQuantityMetrics,
  getActivityActualParticipantCount,
  WORKSHOP_ESTIMATE_PER_ACTIVITY
} from '../frontend/src/screens/shared/operations-activity-helpers.js';
import { operationsManagementScreen } from '../frontend/src/screens/operations-management.js';

function baseState(overrides = {}) {
  return {
    operationsManagement: {
      tab: 'instructors',
      period: 'all',
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
      instructor: '__all__',
      expandedWorkshop: '',
      expandedSchool: ''
    },
    listFilters: {
      'operations-management': { q: '', appliedQ: '', status: 'פתוח', visibleCount: 200 }
    },
    ...overrides
  };
}

const TEXT_SCHOOL_ROWS = [
  { RowID: 'LONG-210', status: 'פתוח', authority: 'בנימינה', school: 'מתנ"ס בנימינה גבעת עדה', activity_name: 'סדנה א', start_date: '2026-04-10', instructor_name: 'דני' },
  { RowID: 'LONG-211', status: 'פתוח', authority: 'בנימינה', school: 'מתנ"ס בנימינה גבעת עדה', activity_name: 'סדנה ב', start_date: '2026-04-11', instructor_name: 'דני' },
  { RowID: 'LONG-027', status: 'פתוח', authority: 'דלית אל-כרמל', school: 'אלאשראק', activity_name: 'סדנה ג', start_date: '2026-04-12', instructor_name: 'מיה' },
  { RowID: 'LONG-032', status: 'פתוח', authority: 'גוש עציון', school: 'יד בנימין', activity_name: 'סדנה ד', start_date: '2026-04-13', instructor_name: 'רון' },
  { RowID: 'LONG-212', status: 'פתוח', authority: 'רשות א', school: 'מתנ"ס', activity_name: 'סדנה ה', start_date: '2026-04-14', instructor_name: 'נועה' },
  { RowID: 'LONG-213', status: 'פתוח', authority: 'רשות ב', school: 'מתנ"ס', activity_name: 'סדנה ו', start_date: '2026-04-15', instructor_name: 'נועה' }
];

test('getActivitySchoolDisplayName supports linked, single and text schools', () => {
  assert.equal(getActivitySchoolDisplayName({ linked_school_names: 'בן צבי + ויצמן' }), 'בן צבי + ויצמן');
  assert.equal(getActivitySchoolDisplayName({ school: 'מתנ"ס' }), 'מתנ"ס');
  assert.equal(getActivitySchoolDisplayName({ school: 'מתנ"ס בנימינה גבעת עדה' }), 'מתנ"ס בנימינה גבעת עדה');
  assert.equal(getActivitySchoolDisplayName({ school: 'אלאשראק' }), 'אלאשראק');
  assert.equal(getActivitySchoolDisplayName({ school: 'יד בנימין' }), 'יד בנימין');
  assert.equal(getActivitySchoolDisplayName({}), 'לא משויך');
});

test('hasActivitySchoolOrFrame detects text and linked schools without school_id', () => {
  assert.equal(hasActivitySchoolOrFrame({ school: 'מתנ"ס' }), true);
  assert.equal(hasActivitySchoolOrFrame({ linked_schools_count: 2, linked_school_names: 'בן צבי + ויצמן' }), true);
  assert.equal(hasActivitySchoolOrFrame({}), false);
});

test('getActivityInstructorName priority and invalid names', () => {
  assert.equal(getActivityInstructorName({ instructor_name: 'אבי', guide: 'גיא' }), 'אבי');
  assert.equal(getActivityInstructorName({ guide_name: 'גיא' }), 'גיא');
  assert.equal(getActivityInstructorName({ instructor_name: 'לא משויך' }), 'לא משויך');
  assert.equal(getActivityInstructorName({}), 'לא משויך');
});

test('getActivityPrimaryDate uses start_date and meeting dates', () => {
  assert.equal(getActivityPrimaryDate({ start_date: '2026-05-01' }), '2026-05-01');
  assert.equal(getActivityPrimaryDate({ date_1: '2026-05-02' }), '2026-05-02');
  assert.equal(getActivityPrimaryDate({ meeting_dates: ['2026-05-03'] }), '2026-05-03');
  assert.equal(getActivityPrimaryDate({}), '');
});

test('multi-school activity names are searchable and displayed', () => {
  const row = {
    RowID: 'MULTI-1',
    status: 'פתוח',
    linked_schools_count: 2,
    linked_school_names: 'בן צבי + ויצמן',
    legacy_school: 'ויצמן+בן צבי',
    activity_name: 'סדנה משותפת',
    start_date: '2026-04-20',
    instructor_name: 'שירה'
  };
  assert.equal(getActivitySchoolDisplayName(row), 'בן צבי + ויצמן');
  assert.equal(hasActivitySchoolOrFrame(row), true);
  assert.ok(getActivitySchoolNames(row).some((name) => name.includes('ויצמן')));
  assert.ok(getActivitySchoolNames(row).some((name) => name.includes('בן צבי')));
});

test('summer exceptions only include missing instructor or missing date', () => {
  assert.equal(isSummerOperationsException({ activity_season: 'summer_2026', status: 'פתוח', instructor_name: '', start_date: '' }), true);
  assert.equal(isSummerOperationsException({ activity_season: 'summer_2026', status: 'פתוח', instructor_name: 'דני', start_date: '2026-07-05' }), false);
  assert.equal(isSummerOperationsException({ activity_season: 'regular', status: 'פתוח', instructor_name: '', start_date: '' }), false);
});

test('operations management render includes menu page structure and tabs', () => {
  const html = operationsManagementScreen.render({ rows: TEXT_SCHOOL_ROWS, workshopStockMap: new Map() }, { state: baseState() });
  assert.match(html, /ניהול תפעול/);
  assert.match(html, /סידור מדריכים/);
  assert.match(html, /תכנון קיץ/);
  assert.match(html, /כמויות סדנאות/);
  assert.match(html, /לפי בתי ספר/);
  assert.match(html, /הדפס סידור מדריך/);
  assert.match(html, /ds-filter-panel/);
  assert.match(html, /ds-ops-mgmt-summary/);
  assert.match(html, /ds-exceptions-tabs/);
  assert.doesNotMatch(html, /סמל מוסד/);
});

test('workshop quantity metrics use x25 estimate and stock gap rules', () => {
  const stockMap = buildWorkshopStockMapFromLists({
    categories: [{
      category: 'workshop_stock',
      items: [{ label: 'פרוגי המקפצת', value: 'פרוגי המקפצת', _row: { stock_quantity: 300 } }]
    }]
  });
  const withActual = buildWorkshopQuantityMetrics({
    workshopName: 'פרוגי המקפצת',
    activityCount: 10,
    activities: [{ participants_count: 120 }, { participants_count: 118 }],
    stockMap
  });
  assert.equal(withActual.estimatedQuantity, 250);
  assert.equal(withActual.actualQuantity, 238);
  assert.equal(withActual.stockQuantity, 300);
  assert.equal(withActual.gap, 62);

  const withoutActual = buildWorkshopQuantityMetrics({
    workshopName: 'אסטרונאוט על חוטים',
    activityCount: 8,
    activities: [{ activity_name: 'אסטרונאוט על חוטים' }],
    stockMap: buildWorkshopStockMapFromLists({
      categories: [{ category: 'inventory', items: [{ value: 'אסטרונאוט על חוטים', _row: { inventory: 150 } }] }]
    })
  });
  assert.equal(withoutActual.estimatedQuantity, 200);
  assert.equal(withoutActual.actualQuantity, null);
  assert.equal(withoutActual.gap, -50);

  const noStock = buildWorkshopQuantityMetrics({
    workshopName: 'צמידי שמש',
    activityCount: 12,
    activities: [],
    stockMap: new Map()
  });
  assert.equal(noStock.estimatedQuantity, 300);
  assert.equal(noStock.stockQuantity, null);
  assert.equal(noStock.gap, null);
});

test('workshops tab shows inventory columns and print action', () => {
  const state = baseState();
  state.operationsManagement.tab = 'workshops';
  const rows = [
    { RowID: 'W-1', status: 'פתוח', activity_name: 'פרוגי המקפצת', start_date: '2026-04-10', participants_count: 120 },
    { RowID: 'W-2', status: 'פתוח', activity_name: 'פרוגי המקפצת', start_date: '2026-04-11', participants_count: 118 }
  ];
  const stockMap = buildWorkshopStockMapFromLists({
    categories: [{ category: 'workshop_stock', items: [{ value: 'פרוגי המקפצת', _row: { stock_quantity: 300 } }] }]
  });
  const html = operationsManagementScreen.render({ rows, workshopStockMap: stockMap }, { state });
  assert.match(html, /כמות משוערת לפי 25/);
  assert.match(html, /כמות במלאי/);
  assert.match(html, /פער מול מלאי/);
  assert.match(html, /הדפס כמויות סדנאות/);
  assert.match(html, /ds-ops-gap--ok/);
  assert.match(html, />62</);
  assert.match(html, />300</);
  assert.match(html, />238</);
});

test('actual participant count only uses existing activity fields', () => {
  assert.equal(getActivityActualParticipantCount({ participants_count: 25 }), 25);
  assert.equal(getActivityActualParticipantCount({ activity_name: 'סדנה' }), null);
});

test('operations management render shows text-school activities without school_id', () => {
  const html = operationsManagementScreen.render({ rows: TEXT_SCHOOL_ROWS, workshopStockMap: new Map() }, { state: baseState() });
  assert.match(html, /מתנ(&quot;|")ס בנימינה גבעת עדה/);
  assert.match(html, /אלאשראק/);
  assert.match(html, /יד בנימין/);
  assert.match(html, /מתנ(&quot;|")ס/);
});

test('route registration exists for operations-management', async () => {
  const mainSrc = await readFile(new URL('../frontend/src/main.js', import.meta.url), 'utf8');
  const apiSrc = await readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
  const navSrc = await readFile(new URL('../frontend/src/screens/shared/act-nav-grid.js', import.meta.url), 'utf8');
  assert.match(mainSrc, /'operations-management':/);
  assert.match(apiSrc, /'operations-management'/);
  assert.match(navSrc, /operations-management/);
});

test('service worker cache versions are aligned', async () => {
  const frontendSw = await readFile(new URL('../frontend/sw.js', import.meta.url), 'utf8');
  const rootSw = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  const frontendMatch = frontendSw.match(/CACHE_VERSION = (\d+)/);
  const rootMatch = rootSw.match(/SW_ENTRY_VERSION = (\d+)/);
  assert.ok(frontendMatch && rootMatch);
  assert.equal(frontendMatch[1], rootMatch[1]);
});
