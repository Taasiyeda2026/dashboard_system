import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  getActivitySchoolDisplayName,
  hasActivitySchoolOrFrame,
  getActivityInstructorName,
  getActivityPrimaryDate,
  getActivitySchoolNames,
  getActivityTimeRange,
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

test('getActivityTimeRange formats HH:MM:SS to HH:MM for display and print', () => {
  assert.equal(getActivityTimeRange({ start_time: '08:15:00', end_time: '09:00:00' }), '08:15-09:00');
  assert.equal(getActivityTimeRange({ StartTime: '08:15:00', EndTime: '09:00:00' }), '08:15-09:00');
  assert.equal(getActivityTimeRange({ start_time: '09:00', end_time: '12:30' }), '09:00-12:30');
  assert.equal(getActivityTimeRange({ start_time: '08:15:00' }), '08:15');
  assert.equal(getActivityTimeRange({}), '');
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
  assert.match(html, /סידור עבודה/);
  assert.match(html, /רשויות/);
  assert.match(html, /ציוד ומלאי/);
  assert.match(html, /טבלת סידור עבודה/);
  assert.match(html, /הדפס סידור עבודה/);
  assert.match(html, /ds-filter-panel/);
  assert.match(html, /ds-ops-mgmt-summary/);
  assert.match(html, /ds-exceptions-tabs/);
  assert.match(html, /data-ops-tab="instructors"[^>]*aria-pressed="true"/);
  assert.doesNotMatch(html, /סמל מוסד/);
});

test('workshop quantity metrics use x25 estimate and stock gap rules', () => {
  const stockMap = buildWorkshopStockMapFromLists({
    categories: [{
      category: 'activity_names',
      items: [{ label: 'פרוגי המקפצת', value: '001', _row: { category: 'activity_names', type: 'workshop', activity_type: 'workshop', active: true, activity_no: '001', activity_name: 'פרוגי המקפצת', stock_quantity: 300 } }]
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
  assert.equal(withActual.gap, 50);

  const withoutActual = buildWorkshopQuantityMetrics({
    workshopName: 'אסטרונאוט על חוטים',
    activityCount: 8,
    activities: [{ activity_name: 'אסטרונאוט על חוטים' }],
    stockMap: buildWorkshopStockMapFromLists({
      categories: [{ category: 'activity_names', items: [{ value: '002', _row: { category: 'activity_names', type: 'workshop', activity_type: 'workshop', active: true, activity_no: '002', activity_name: 'אסטרונאוט על חוטים', stock_quantity: 150 } }] }]
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
    { RowID: 'W-1', status: 'פתוח', activity_name: 'פרוגי המקפצת', start_date: '2026-07-10', activity_season: 'summer_2026', activity_type: 'workshop', participants_count: 120 },
    { RowID: 'W-2', status: 'פתוח', activity_name: 'פרוגי המקפצת', start_date: '2026-07-11', activity_season: 'summer_2026', activity_type: 'workshop', participants_count: 118 }
  ];
  const adminListsData = { categories: [{ category: 'activity_names', items: [{ value: '001', _row: { category: 'activity_names', type: 'workshop', activity_type: 'workshop', active: true, activity_no: '001', activity_name: 'פרוגי המקפצת', stock_quantity: 300 } }] }] };
  const stockMap = buildWorkshopStockMapFromLists(adminListsData);
  const html = operationsManagementScreen.render({ rows, workshopStockMap: stockMap, adminListsData }, { state });
  assert.match(html, /כמות נדרשת/);
  assert.match(html, /מלאי קיים/);
  assert.match(html, /יתרת מלאי/);
  assert.match(html, /הדפס כמויות סדנאות/);
  assert.match(html, /ds-ops-gap--ok/);
  assert.doesNotMatch(html, /data-ops-dist-edit/);
  assert.doesNotMatch(html, /ds-ops-stock-edit-btn/);
  assert.match(html, />50</);
  assert.match(html, />238</);
  assert.match(html, />62</);
  assert.match(html, />300</);
});

test('workshops inventory remainder uses existing stock minus usage', () => {
  const state = baseState();
  state.operationsManagement.tab = 'workshops';
  const adminListsData = { categories: [{ category: 'activity_names', items: [
    { value: '101', _row: { category: 'activity_names', type: 'workshop', activity_type: 'workshop', active: true, activity_no: '101', activity_name: 'סדנת חיובית', stock_quantity: 2500 } },
    { value: '102', _row: { category: 'activity_names', type: 'workshop', activity_type: 'workshop', active: true, activity_no: '102', activity_name: 'סדנת אפס', stock_quantity: 100 } },
    { value: '103', _row: { category: 'activity_names', type: 'workshop', activity_type: 'workshop', active: true, activity_no: '103', activity_name: 'סדנת חוסר', stock_quantity: 390 } }
  ] }] };
  const html = operationsManagementScreen.render({
    rows: [
      { RowID: 'P-1', status: 'פתוח', activity_name: 'סדנת חיובית', start_date: '2026-07-10', activity_season: 'summer_2026', activity_type: 'workshop', participants_count: 194 },
      { RowID: 'Z-1', status: 'פתוח', activity_name: 'סדנת אפס', start_date: '2026-07-10', activity_season: 'summer_2026', activity_type: 'workshop', participants_count: 100 },
      { RowID: 'N-1', status: 'פתוח', activity_name: 'סדנת חוסר', start_date: '2026-07-10', activity_season: 'summer_2026', activity_type: 'workshop', participants_count: 450 }
    ],
    workshopStockMap: buildWorkshopStockMapFromLists(adminListsData),
    adminListsData
  }, { state });
  const tableHtml = html.slice(html.indexOf('<table class="ds-table ds-table--compact ds-ops-mgmt-data-table ds-ops-workshops-table"'));
  assert.match(tableHtml, />2500<[^]*>194<[^]*>2306</);
  assert.match(tableHtml, />100<[^]*>100<[^]*><span class="ds-ops-gap ds-ops-gap--ok">0<\/span>/);
  assert.match(tableHtml, />390<[^]*>450<[^]*><span class="ds-ops-gap ds-ops-gap--shortage"><span dir="ltr">-60<\/span><\/span>/);
  assert.match(html, /ds-ops-workshops-table td:active \{ border:1px solid #94a3b8 !important;/);
});

test('workshops inventory usage is read-only and sums participants_count from activities', () => {
  const state = baseState();
  state.operationsManagement.tab = 'workshops';
  const adminListsData = { categories: [{ category: 'activity_names', items: [
    { value: '201', _row: { category: 'activity_names', type: 'workshop', activity_type: 'workshop', active: true, activity_no: '201', activity_name: 'סדנת סיכום', stock_quantity: 500 } }
  ] }] };
  const baseRows = [
    { RowID: 'U-1', status: 'פתוח', activity_name: 'סדנת סיכום', start_date: '2026-07-10', activity_season: 'summer_2026', activity_type: 'workshop', participants_count: 80 },
    { RowID: 'U-2', status: 'פתוח', activity_name: 'סדנת סיכום', start_date: '2026-07-11', activity_season: 'summer_2026', activity_type: 'workshop', participants_count: null },
    { RowID: 'U-3', status: 'פתוח', activity_name: 'סדנת סיכום', start_date: '2026-07-12', activity_season: 'summer_2026', activity_type: 'workshop' }
  ];
  const html = operationsManagementScreen.render({
    rows: baseRows,
    workshopStockMap: buildWorkshopStockMapFromLists(adminListsData),
    adminListsData
  }, { state });
  const tableHtml = html.slice(html.indexOf('<table class="ds-table ds-table--compact ds-ops-mgmt-data-table ds-ops-workshops-table"'));
  assert.match(tableHtml, />3</);
  assert.match(tableHtml, />75</);
  assert.match(tableHtml, />80</);
  assert.match(tableHtml, />420</);
  assert.doesNotMatch(tableHtml, /data-ops-dist-edit/);
  assert.doesNotMatch(tableHtml, /ds-ops-stock-edit-btn/);
  assert.doesNotMatch(tableHtml, /role="button"/);

  const updatedHtml = operationsManagementScreen.render({
    rows: baseRows.map((row) => row.RowID === 'U-3' ? { ...row, participants_count: 40 } : row),
    workshopStockMap: buildWorkshopStockMapFromLists(adminListsData),
    adminListsData
  }, { state });
  const updatedTableHtml = updatedHtml.slice(updatedHtml.indexOf('<table class="ds-table ds-table--compact ds-ops-mgmt-data-table ds-ops-workshops-table"'));
  assert.match(updatedTableHtml, />120</);
  assert.match(updatedTableHtml, />380</);
});


test('workshops inventory uses x25 required quantity and shows missing participant counts as zero', () => {
  const state = baseState();
  state.operationsManagement.tab = 'workshops';
  const adminListsData = { categories: [{ category: 'activity_names', items: [{ value: '002', _row: { category: 'activity_names', type: 'workshop', activity_type: 'workshop', active: true, activity_no: '002', activity_name: 'אסטרונאוט על חוטים', stock_quantity: 150 } }] }] };
  const html = operationsManagementScreen.render({
    rows: [
      { RowID: 'W-3', status: 'פתוח', activity_name: 'אסטרונאוט על חוטים', start_date: '2026-07-12', activity_season: 'summer_2026', activity_type: 'workshop' }
    ],
    workshopStockMap: buildWorkshopStockMapFromLists(adminListsData),
    adminListsData
  }, { state });
  const tableHtml = html.slice(html.indexOf('<table class="ds-table ds-table--compact ds-ops-mgmt-data-table ds-ops-workshops-table"'));
  assert.match(tableHtml, />25</);
  assert.match(tableHtml, />0</);
  assert.doesNotMatch(tableHtml, /לא עודכן/);
  assert.doesNotMatch(tableHtml, /NaN/);
  assert.doesNotMatch(tableHtml, />150<[^]*>25<[^]*>125</);
});


test('workshops inventory tab excludes courses and after-school catalog rows', () => {
  const state = baseState();
  state.operationsManagement.tab = 'workshops';
  const adminListsData = { categories: [{ category: 'activity_names', items: [
    { value: '001', label: 'סדנה אמיתית', _row: { category: 'activity_names', type: 'workshop', activity_type: 'workshop', active: true, activity_no: '001', activity_name: 'סדנה אמיתית', stock_quantity: 40 } },
    { value: '002', label: 'קורס רובוטיקה', _row: { category: 'activity_names', type: 'course', activity_type: 'course', active: true, activity_no: '002', activity_name: 'קורס רובוטיקה', stock_quantity: 40 } },
    { value: '003', label: 'אפטר סקול מדעים', _row: { category: 'activity_names', type: 'after_school', activity_type: 'after_school', active: true, activity_no: '003', activity_name: 'אפטר סקול מדעים', stock_quantity: 40 } }
  ] }] };
  const html = operationsManagementScreen.render({
    rows: [
      { RowID: 'W-1', status: 'פתוח', activity_name: 'סדנה אמיתית', activity_type: 'סדנה', activity_season: 'summer_2026', start_date: '2026-07-10' },
      { RowID: 'C-1', status: 'פתוח', activity_name: 'קורס רובוטיקה', activity_type: 'קורס', activity_season: 'summer_2026', start_date: '2026-07-10' }
    ],
    workshopStockMap: buildWorkshopStockMapFromLists(adminListsData),
    adminListsData
  }, { state });
  const tableHtml = html.slice(html.indexOf('<table class="ds-table ds-table--compact ds-ops-mgmt-data-table ds-ops-workshops-table"'));
  assert.match(tableHtml, /סדנה אמיתית/);
  assert.doesNotMatch(tableHtml, /קורס רובוטיקה/);
  assert.doesNotMatch(tableHtml, /אפטר סקול מדעים/);
});

test('authorities tab groups schools and dated activities under each authority', () => {
  const state = baseState();
  state.operationsManagement.tab = 'authorities';
  state.operationsManagement.expandedSchool = 'רשות א::בית ספר א';
  const rows = [
    { RowID: 'A-2', status: 'פתוח', authority: 'רשות א', school: 'בית ספר א', activity_name: 'פעילות מאוחרת', start_date: '2026-05-02', start_time: '10:00', end_time: '11:00', instructor_name: 'דני', grade: 'ב' },
    { RowID: 'A-1', status: 'פתוח', authority: 'רשות א', school: 'בית ספר א', activity_name: 'פעילות מוקדמת', start_date: '2026-05-01', start_time: '08:00', end_time: '09:00', instructor_name: 'דני', grade: 'א' },
    { RowID: 'B-1', status: 'פתוח', authority: 'רשות ב', school: 'בית ספר ב', activity_name: 'פעילות אחרת', start_date: '2026-05-03', instructor_name: 'מיה' }
  ];
  const html = operationsManagementScreen.render({ rows, workshopStockMap: new Map() }, { state });
  assert.match(html, /רשות א \| 1 בתי ספר \| 2 פעילויות/);
  assert.match(html, /בית ספר א \| 2 פעילויות/);
  assert.match(html, /פעילות מוקדמת/);
  assert.match(html, /01\/05\/2026/);
  assert.match(html, /02\/05\/2026/);
});

test('operations management tabs stay synced with selected tab content', () => {
  const rows = TEXT_SCHOOL_ROWS;
  const authoritiesState = baseState({ operationsManagement: { ...baseState().operationsManagement, tab: 'authorities' } });
  const workshopsState = baseState({ operationsManagement: { ...baseState().operationsManagement, tab: 'workshops' } });
  const defaultHtml = operationsManagementScreen.render({ rows, workshopStockMap: new Map() }, { state: baseState() });
  const authoritiesHtml = operationsManagementScreen.render({ rows, workshopStockMap: new Map() }, { state: authoritiesState });
  const workshopsHtml = operationsManagementScreen.render({ rows, workshopStockMap: new Map(), adminListsData: { categories: [] } }, { state: workshopsState });
  assert.match(defaultHtml, /data-ops-tab="instructors"[^>]*aria-pressed="true"/);
  assert.match(defaultHtml, /טבלת סידור עבודה/);
  assert.match(authoritiesHtml, /data-ops-tab="authorities"[^>]*aria-pressed="true"/);
  assert.match(authoritiesHtml, /ds-ops-schools-authority/);
  assert.match(workshopsHtml, /data-ops-tab="workshops"[^>]*aria-pressed="true"/);
  assert.match(workshopsHtml, /מלאי סדנאות/);
});

test('authorities tab renders schools, dates and activities in fixed grouped order', () => {
  const state = baseState();
  state.operationsManagement.tab = 'authorities';
  const rows = [
    { RowID: 'B-LATE', status: 'פתוח', authority: 'רשות ב', school: 'בית ספר ב', activity_name: 'פעילות מאוחרת', start_date: '2026-05-03', start_time: '11:00', end_time: '12:00', instructor_name: 'מיה', grade: 'ד' },
    { RowID: 'A-LATE', status: 'פתוח', authority: 'רשות א', school: 'בית ספר ב', activity_name: 'פעילות שנייה', start_date: '2026-05-02', start_time: '10:00', end_time: '11:00', instructor_name: 'דני', grade: 'ב' },
    { RowID: 'A-EARLY', status: 'פתוח', authority: 'רשות א', school: 'בית ספר א', activity_name: 'פעילות ראשונה', start_date: '2026-05-01', start_time: '08:00', end_time: '09:00', instructor_name: 'נועה', grade: 'א' }
  ];
  const html = operationsManagementScreen.render({ rows, workshopStockMap: new Map() }, { state });
  assert.ok(html.indexOf('רשות א') < html.indexOf('רשות ב'));
  assert.ok(html.indexOf('בית ספר א') < html.indexOf('בית ספר ב'));
  assert.ok(html.indexOf('01/05/2026') < html.indexOf('02/05/2026'));
  const groupedHtml = html.slice(html.indexOf('<article class="ds-ops-authority-school"'));
  assert.match(groupedHtml, /ds-ops-col--instructor">מדריך<\/th><th class="ds-ops-col--grade">כיתה<\/th><th class="ds-ops-col--activity">פעילות \/ סדנה<\/th>/);
  assert.equal((groupedHtml.match(/פעילות ראשונה/g) || []).length, 1);
});

test('workshops inventory tab uses workshop_stock as inventory source without requiring matching activities', () => {
  const state = baseState();
  state.operationsManagement.tab = 'workshops';
  state.operationsManagement.dateFrom = '2026-07-01';
  state.operationsManagement.dateTo = '2026-07-31';
  const adminListsData = { categories: [
    { category: 'workshop_stock', items: [
      { value: 'frog', label: 'פרוגי המקפצת', _row: { category: 'workshop_stock', value: 'frog', label: 'פרוגי המקפצת', active: true } },
      { value: 'bird', label: 'ציפור שיווי משקל', _row: { category: 'workshop_stock', value: 'bird', label: 'ציפור שיווי משקל', active: true } },
      { value: 'inactive', label: 'מלאי לא פעיל', _row: { category: 'workshop_stock', value: 'inactive', label: 'מלאי לא פעיל', active: false } }
    ] },
    { category: 'activity_names', items: [
      { value: '001', label: 'פרוגי המקפצת', _row: { category: 'activity_names', value: '001', label: 'פרוגי המקפצת', active: true } }
    ] }
  ] };
  const html = operationsManagementScreen.render({
    rows: [
      { RowID: 'FROG-1', status: 'פתוח', activity_name: 'פרוגי המקפצת', start_date: '2026-07-10', activity_season: 'summer_2026' }
    ],
    workshopStockMap: buildWorkshopStockMapFromLists(adminListsData),
    adminListsData
  }, { state });
  assert.match(html, /מלאי סדנאות — קיץ 2026/);
  assert.match(html, /פרוגי המקפצת/);
  assert.doesNotMatch(html, /ציפור שיווי משקל/);
  assert.doesNotMatch(html, /מלאי לא פעיל/);
});

test('workshops inventory tab includes catalog workshops outside selected date range', () => {
  const state = baseState();
  state.operationsManagement.tab = 'workshops';
  state.operationsManagement.dateFrom = '2026-07-01';
  state.operationsManagement.dateTo = '2026-07-31';
  const rows = [
    { RowID: 'MAY-1', status: 'פתוח', activity_name: 'סדנת מאי', start_date: '2026-07-10', activity_season: 'summer_2026' },
    { RowID: 'JULY-1', status: 'פתוח', activity_name: 'סדנת יולי', start_date: '2026-07-10', activity_season: 'summer_2026' }
  ];
  const adminListsData = { categories: [{ category: 'activity_names', items: [
    { value: '001', label: 'סדנת מאי', _row: { category: 'activity_names', type: 'workshop', activity_type: 'workshop', active: true, activity_no: '001', activity_name: 'סדנת מאי', stock_quantity: 50 } },
    { value: '0042', label: 'סדנת קטלוג', _row: { category: 'activity_names', type: 'workshop', activity_type: 'workshop', active: true, activity_no: '0042', activity_name: 'סדנת קטלוג', stock_quantity: 75 } },
    { value: '0043', label: 'סדנת קטלוג ללא מלאי', _row: { category: 'activity_names', type: 'workshop', activity_type: 'workshop', active: true, activity_no: '0043', activity_name: 'סדנת קטלוג ללא מלאי', stock_quantity: 0 } }
  ] }] };
  const html = operationsManagementScreen.render({ rows, workshopStockMap: buildWorkshopStockMapFromLists(adminListsData), adminListsData }, { state });
  assert.match(html, /סדנת מאי/);
  assert.doesNotMatch(html, /0042/);
  assert.doesNotMatch(html, /0043/);
  assert.doesNotMatch(html, /סדנת יולי/);
});

test('workshops inventory groups physical stock by stock_group_key', () => {
  const state = baseState();
  state.operationsManagement.tab = 'workshops';
  const adminListsData = { categories: [{ category: 'activity_names', items: [
    { value: '024', _row: { category: 'activity_names', type: 'workshop', activity_type: 'workshop', active: true, activity_no: '024', activity_name: 'קופת קסם (ד׳–ו׳)', stock_group_key: 'magic_box', stock_group_name: 'קופת קסם', stock_quantity: 390 } },
    { value: '029', _row: { category: 'activity_names', type: 'workshop', activity_type: 'workshop', active: true, activity_no: '029', activity_name: 'קופת קסם – מדע או אשליה?', stock_group_key: 'magic_box', stock_group_name: 'קופת קסם', stock_quantity: 390 } }
  ] }] };
  const html = operationsManagementScreen.render({
    rows: [
      { RowID: 'MB-1', status: 'פתוח', activity_name: 'קופת קסם (ד׳–ו׳)', start_date: '2026-07-01', activity_season: 'summer_2026', activity_type: 'workshop' },
      { RowID: 'MB-2', status: 'פתוח', activity_name: 'קופת קסם – מדע או אשליה?', start_date: '2026-07-02', activity_season: 'summer_2026', activity_type: 'workshop' }
    ],
    workshopStockMap: buildWorkshopStockMapFromLists(adminListsData),
    adminListsData
  }, { state });
  const tableHtml = html.slice(html.indexOf('<table class="ds-table ds-table--compact ds-ops-mgmt-data-table ds-ops-workshops-table"'));
  assert.equal((tableHtml.match(/data-ops-stock-group="magic_box"/g) || []).length, 1);
  assert.match(tableHtml, /024 - קופת קסם/);
  assert.match(tableHtml, /029 - קופת קסם/);
  assert.match(tableHtml, /value="390"/);
});

test('actual participant count only uses existing activity fields', () => {
  assert.equal(getActivityActualParticipantCount({ participants_count: 25 }), 25);
  assert.equal(getActivityActualParticipantCount({ activity_name: 'סדנה' }), null);
});

test('operations management schedule shows HH:MM time range without seconds', () => {
  const rows = [{
    RowID: 'TIME-1',
    status: 'פתוח',
    authority: 'רשות א',
    school: 'בית ספר',
    activity_name: 'סדנה',
    start_date: '2026-04-10',
    start_time: '08:15:00',
    end_time: '09:00:00',
    instructor_name: 'דני'
  }];
  const html = operationsManagementScreen.render({ rows, workshopStockMap: new Map() }, { state: baseState() });
  assert.match(html, />08:15-09:00</);
  assert.doesNotMatch(html, />08:15:00-09:00:00</);
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

test('authorities print layout uses 60% table with page-relative column widths', async () => {
  const src = await readFile(new URL('../frontend/src/screens/operations-management.js', import.meta.url), 'utf8');
  assert.match(src, /class="authorities-table"/);
  assert.match(src, /class="col-class"/);
  assert.match(src, /authorities-title-table-block/);
  assert.match(src, /authorities-group-title/);
  assert.match(src, /authorityHeaderTitle/);
  assert.match(src, /schoolHeaderTitle/);
  assert.match(src, /\.authorities-table \.col-time\{width:20%/);
  assert.match(src, /\.authorities-table \.col-instructor\{width:27%/);
  assert.match(src, /\.authorities-table \.col-class\{width:20%/);
  assert.match(src, /\.authorities-table \.col-activity\{width:33%/);
  assert.doesNotMatch(src, /col-grade/);
});

test('service worker cache versions are aligned', async () => {
  const frontendSw = await readFile(new URL('../frontend/sw.js', import.meta.url), 'utf8');
  const rootSw = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  const frontendMatch = frontendSw.match(/CACHE_VERSION = (\d+)/);
  const rootMatch = rootSw.match(/SW_ENTRY_VERSION = (\d+)/);
  assert.ok(frontendMatch && rootMatch);
  assert.equal(frontendMatch[1], rootMatch[1]);
});
