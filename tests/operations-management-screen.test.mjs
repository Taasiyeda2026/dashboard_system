import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  getActivitySchoolDisplayName,
  hasActivitySchoolOrFrame,
  getActivityInstructorName,
  getActivityInstructorNames,
  getActivityPrimaryDate,
  getActivitySchoolNames,
  getActivityTimeRange,
  getActivityAuthorityName,
  KIRYAT_MOSHE_REHOVOT_AUTHORITY,
  isSummerOperationsException,
  buildWorkshopStockMapFromLists,
  collectWorkshopStockEditorItems,
  buildWorkshopQuantityMetrics,
  getActivityActualParticipantCount,
  getActivityRequiredInventoryQuantity,
  sumRequiredInventoryQuantitiesFromActivities,
  WORKSHOP_ESTIMATE_PER_ACTIVITY
} from '../frontend/src/screens/shared/operations-activity-helpers.js';
import { operationsManagementScreen } from '../frontend/src/screens/operations-management.js';
import {
  buildCompletionApprovals,
  completionApprovalDocumentHtml,
  completionApprovalInstructorOptions,
  completionApprovalPrintCss,
  formatApprovalTime,
  sortApprovalActivitiesByTime
} from '../frontend/src/screens/shared/activity-completion-approval-print.js';
import {
  findMatchingCompletionApprovalUpload
} from '../frontend/src/screens/shared/completion-approval-status.js';

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

test('getActivityInstructorNames includes secondary instructor fields', () => {
  assert.deepEqual(getActivityInstructorNames({
    instructor_name: 'אבי',
    guide: 'אבי',
    instructor_name_2: 'אפרת אוחיון',
    guide_2: 'לא משויך'
  }), ['אבי', 'אפרת אוחיון']);
});

test('operations management instructor filter and schedule include secondary instructors', () => {
  const state = baseState();
  state.operationsManagement.period = 'summer_2026';
  state.operationsManagement.dateFrom = '2026-07-01';
  state.operationsManagement.dateTo = '2026-08-31';
  state.listFilters['operations-management'].instructor = 'אפרת אוחיון';
  const rows = [{
    RowID: 'TAMIR-1',
    status: 'פתוח',
    activity_season: 'summer_2026',
    authority: 'תמיר',
    school: 'מסגרת תמיר',
    activity_name: 'תמיר - חדר בריחה קווסט',
    start_date: '2026-07-15',
    instructor_name: 'מדריך ראשון',
    instructor_name_2: 'אפרת אוחיון'
  }];
  const html = operationsManagementScreen.render({ rows, workshopStockMap: new Map() }, { state });
  assert.match(html, /תמיר - חדר בריחה קווסט/);
  assert.match(html, /אפרת אוחיון/);
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

test('operations management treats Shavit as Kiryat Moshe Rehovot authority', () => {
  const rows = [
    { RowID: 'REH-1', status: 'פתוח', authority: 'רחובות', school: 'בית ספר אחר', activity_name: 'פעילות רחובות', start_date: '2026-03-01', instructor_name: 'דני' },
    { RowID: 'SHAVIT-1', status: 'פתוח', authority: 'רחובות', school: 'שביט', activity_name: 'פעילות שביט', start_date: '2026-03-02', instructor_name: 'דני' }
  ];

  assert.equal(getActivityAuthorityName(rows[1]), KIRYAT_MOSHE_REHOVOT_AUTHORITY);

  const rehovotState = baseState({
    operationsManagement: { ...baseState().operationsManagement, tab: 'authorities' },
    listFilters: { 'operations-management': { q: '', appliedQ: '', status: 'פתוח', visibleCount: 200, authority: 'רחובות' } }
  });
  const rehovotHtml = operationsManagementScreen.render({ rows, workshopStockMap: new Map() }, { state: rehovotState });
  assert.match(rehovotHtml, /פעילות רחובות/);
  assert.doesNotMatch(rehovotHtml, /פעילות שביט/);
  assert.doesNotMatch(rehovotHtml, /שביט \|/);

  const kiryatMosheState = baseState({
    operationsManagement: { ...baseState().operationsManagement, tab: 'authorities' },
    listFilters: { 'operations-management': { q: '', appliedQ: '', status: 'פתוח', visibleCount: 200, authority: KIRYAT_MOSHE_REHOVOT_AUTHORITY } }
  });
  const kiryatMosheHtml = operationsManagementScreen.render({ rows, workshopStockMap: new Map() }, { state: kiryatMosheState });
  assert.match(kiryatMosheHtml, /פעילות שביט/);
  assert.match(kiryatMosheHtml, /קריית משה \(רחובות\) \| 1 בתי ספר \| 1 פעילויות/);
  assert.doesNotMatch(kiryatMosheHtml, /פעילות רחובות/);
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

test('work schedule shows only student count column without quantity fallback', async () => {
  const rows = [
    {
      RowID: 'SCHED-1',
      status: 'פתוח',
      authority: 'רשות א',
      school: 'בית ספר א',
      activity_name: 'פעילות עם משתתפים',
      start_date: '2026-07-10',
      start_time: '08:00',
      end_time: '09:00',
      instructor_name: 'דני',
      grade: 'א',
      participants_count: 18
    },
    {
      RowID: 'SCHED-2',
      status: 'פתוח',
      authority: 'רשות א',
      school: 'בית ספר א',
      activity_name: 'פעילות ללא משתתפים',
      start_date: '2026-07-11',
      start_time: '10:00',
      end_time: '11:00',
      instructor_name: 'דני',
      grade: 'ב'
    }
  ];
  const html = operationsManagementScreen.render({ rows, workshopStockMap: new Map() }, { state: baseState() });
  const scheduleHtml = html.match(/<div class="ds-ops-schedule-wrap">[\s\S]*?<p class="ds-ops-mgmt-print-footer/)?.[0] || '';

  assert.match(scheduleHtml, />מס׳ תלמידים/);
  assert.doesNotMatch(scheduleHtml, />כמות</);
  assert.doesNotMatch(scheduleHtml, /ds-ops-col--quantity/);
  assert.match(scheduleHtml, /<td class="ds-ops-col--student-count">18<\/td>/);
  assert.match(scheduleHtml, /<td class="ds-ops-col--student-count">—<\/td>/);
  assert.doesNotMatch(scheduleHtml, /<td class="ds-ops-col--student-count">25<\/td>/);
  assert.match(html, /18 סה״כ תלמידים/);
  assert.doesNotMatch(html, /סה״כ כמויות/);

  const source = await readFile(new URL('../frontend/src/screens/operations-management.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /<th>כמות<\/th>/);
  assert.doesNotMatch(source, /sortableTh\(state, TAB_INSTRUCTORS, 'quantity', 'כמות'/);
  assert.match(source, /<th>שעות<\/th><th>פעילות<\/th><th>מס׳ תלמידים<\/th><th>כיתה<\/th>\$\{instructorHeader\}/);
  assert.doesNotMatch(source, /<td class="ds-ops-col--quantity">/);
});

test('completion approval tab hides general operations filters and uses only approval filters', () => {
  const state = baseState();
  state.operationsManagement.tab = 'completion_approval';
  state.operationsManagement.dateFrom = '2026-01-01';
  state.operationsManagement.dateTo = '2026-01-31';
  state.operationsManagement.completionApproval = {
    instructor: 'הילה רוזן',
    dateMode: 'range',
    date: '',
    dateFrom: '2026-07-10',
    dateTo: '2026-07-11',
    preview: true
  };
  state.listFilters['operations-management'] = {
    q: '',
    appliedQ: '',
    status: 'פתוח',
    authority: 'רשות שלא קיימת',
    school: '',
    instructor: '',
    activity: '',
    visibleCount: 200
  };
  const rows = [
    { RowID: 'CA-1', status: 'פתוח', authority: 'רשות אחרת', school: 'בית ספר א', activity_type: 'סדנה', activity_name: 'פעילות א', start_date: '2026-07-10', start_time: '08:30:00', end_time: '09:30:00', activity_season: 'summer_2026', instructor_name: 'הילה רוזן' },
    { RowID: 'CA-2', status: 'פתוח', authority: 'רשות אחרת', school: 'בית ספר ב', activity_type: 'חדר בריחה', activity_name: 'פעילות ב', start_date: '2026-07-11', start_time: '10:00:00', end_time: '11:00:00', activity_season: 'summer_2026', instructor_name: 'הילה רוזן' },
    { RowID: 'CA-3', status: 'פתוח', authority: 'רשות אחרת', school: 'בית ספר ג', activity_type: 'סדנה', activity_name: 'פעילות ג', start_date: '2026-07-10', activity_season: 'summer_2026', instructor_name: 'מדריך אחר' }
  ];
  const html = operationsManagementScreen.render({ rows, workshopStockMap: new Map() }, { state });

  assert.doesNotMatch(html, /סינון וחיפוש/);
  assert.doesNotMatch(html, /data-ops-clear-filters/);
  assert.doesNotMatch(html, /data-ops-filter="authority"/);
  assert.doesNotMatch(html, /data-ops-search/);
  assert.doesNotMatch(html, /מציג \d+ פעילויות מתוך/);
  assert.match(html, /בקרת אישורי ביצוע לקיץ 2026/);
  assert.match(html, /data-ops-completion-subtab="approvals"/);
  assert.match(html, /data-ops-completion-subtab="contacts"/);
  assert.doesNotMatch(html, /בחירת מדריך/);
  assert.doesNotMatch(html, /בחירת תאריכים/);
  assert.match(html, /בית ספר א/);
  assert.match(html, /בית ספר ב/);
  assert.doesNotMatch(html, /בית ספר ג/);
  assert.match(html, /צפייה באישור/);
  assert.match(html, /אין קובץ חתום/);
  assert.doesNotMatch(html, /מס׳ פעילויות/);
  assert.doesNotMatch(html, /אחראי קשר מול בית הספר/);
  assert.equal((html.match(/data-ops-approval-print-all/g) || []).length, 1);
  assert.match(html, /עד היום:/);
  assert.match(html, /לכל תקופת הקיץ:/);
  assert.doesNotMatch(html, /סה״כ אישורים נדרשים/);
});

test('completion approval tab defaults to summer 2026 season and date range', () => {
  const state = baseState();
  state.operationsManagement.tab = 'completion_approval';
  state.operationsManagement.completionApproval = {
    instructor: 'הילה רוזן',
    dateMode: 'all',
    date: '',
    dateFrom: '',
    dateTo: '',
    preview: true
  };
  const rows = [
    { RowID: 'SUMMER-START', status: 'פתוח', authority: 'רשות א', school: 'בית ספר קיץ', activity_type: 'סדנה', activity_name: 'קיץ פתיחה', start_date: '2026-07-01', activity_season: 'summer_2026', instructor_name: 'הילה רוזן' },
    { RowID: 'SUMMER-END', status: 'פתוח', authority: 'רשות א', school: 'בית ספר קיץ', activity_type: 'חדרי בריחה', activity_name: 'קיץ סיום', start_date: '2026-08-31', activity_season: 'summer_2026', instructor_name: 'הילה רוזן' },
    { RowID: 'OLD-2025', status: 'פתוח', authority: 'רשות א', school: 'בית ספר ישן', activity_type: 'סדנה', activity_name: 'פעילות 2025', start_date: '2025-11-03', activity_season: 'summer_2026', instructor_name: 'הילה רוזן' },
    { RowID: 'OUTSIDE-FUTURE', status: 'פתוח', authority: 'רשות א', school: 'בית ספר עתידי', activity_type: 'סדנה', activity_name: 'פעילות סתיו', start_date: '2026-09-01', activity_season: 'summer_2026', instructor_name: 'הילה רוזן' },
    { RowID: 'REGULAR-JULY', status: 'פתוח', authority: 'רשות א', school: 'בית ספר רגיל', activity_type: 'סדנה', activity_name: 'פעילות רגילה', start_date: '2026-07-15', activity_season: 'regular', instructor_name: 'הילה רוזן' }
  ];

  const html = operationsManagementScreen.render({ rows, workshopStockMap: new Map() }, { state });

  assert.match(html, /בית ספר קיץ/);
  assert.match(html, /01\/07\/2026/);
  assert.match(html, /31\/08\/2026/);
  assert.doesNotMatch(html, /03\/11\/2025/);
  assert.doesNotMatch(html, /בית ספר ישן/);
  assert.doesNotMatch(html, /בית ספר עתידי/);
  assert.doesNotMatch(html, /בית ספר רגיל/);
  assert.match(html, /לכל תקופת הקיץ:/);
  assert.doesNotMatch(html, /סה״כ אישורים נדרשים/);
});


test('completion approval tab includes only summer workshops and escape rooms and supports selected date filter', () => {
  const state = baseState();
  state.operationsManagement.tab = 'completion_approval';
  state.operationsManagement.completionApproval = { instructor: 'הילה רוזן', selectedDate: '2026-07-10' };
  const rows = [
    { RowID: 'BEFORE', status: 'פתוח', authority: 'רשות א', school: 'לפני', activity_type: 'סדנה', activity_name: 'סדנה', start_date: '2026-06-19', activity_season: 'summer_2026', instructor_name: 'הילה רוזן' },
    { RowID: 'START', status: 'פתוח', authority: 'רשות א', school: 'תחילת קיץ', activity_type: 'סדנאות', activity_name: 'סדנה', start_date: '2026-06-20', activity_season: 'summer_2026', instructor_name: 'הילה רוזן' },
    { RowID: 'SELECTED', status: 'פתוח', authority: 'רשות א', school: 'נבחר', activity_type: 'חדר בריחה', activity_name: 'חדר בריחה', start_date: '2026-07-10', activity_season: 'summer_2026', instructor_name: 'הילה רוזן' },
    { RowID: 'END', status: 'פתוח', authority: 'רשות א', school: 'סוף קיץ', activity_type: 'escape_room', activity_name: 'חדר בריחה', start_date: '2026-08-31', activity_season: 'summer_2026', instructor_name: 'הילה רוזן' },
    { RowID: 'AFTER', status: 'פתוח', authority: 'רשות א', school: 'אחרי', activity_type: 'סדנה', activity_name: 'סדנה', start_date: '2026-09-01', activity_season: 'summer_2026', instructor_name: 'הילה רוזן' },
    { RowID: 'COURSE', status: 'פתוח', authority: 'רשות א', school: 'קורס', activity_type: 'course', activity_name: 'קורס', start_date: '2026-07-10', activity_season: 'summer_2026', instructor_name: 'הילה רוזן' },
    { RowID: 'GEFEN', status: 'פתוח', authority: 'רשות א', school: 'גפן', activity_type: 'גפ״ן', activity_name: 'גפ״ן', start_date: '2026-07-10', activity_season: 'summer_2026', instructor_name: 'הילה רוזן' }
  ];
  const html = operationsManagementScreen.render({ rows, workshopStockMap: new Map() }, { state });
  assert.match(html, /מסונן לתאריך: 10\/07\/2026/);
  assert.match(html, /נבחר/);
  assert.doesNotMatch(html, /תחילת קיץ/);
  assert.doesNotMatch(html, /סוף קיץ/);
  assert.doesNotMatch(html, /לפני/);
  assert.doesNotMatch(html, /אחרי/);
  assert.doesNotMatch(html, /קורס/);
  assert.doesNotMatch(html, /גפן/);
  assert.match(html, /min="2026-06-20"/);
  assert.match(html, /max="2026-08-31"/);
  assert.match(html, /הצג את כל תקופת הקיץ/);
});


test('completion approval includes closed summer activities and excludes deleted activities consistently', () => {
  const state = baseState();
  state.operationsManagement.tab = 'completion_approval';
  state.operationsManagement.completionApproval = { instructor: 'הילה רוזן', selectedDate: '2026-07-10', summaryOpen: true };
  const rows = [
    { RowID: 'OPEN', status: 'פתוח', authority: 'רשות א', school: 'פתוח', activity_type: 'סדנה', activity_name: 'סדנה פתוחה', start_date: '2026-07-10', activity_season: 'summer_2026', instructor_name: 'הילה רוזן', emp_id: '1500' },
    { RowID: 'CLOSED', status: 'סגור', authority: 'רשות א', school: 'סגור', activity_type: 'חדר בריחה', activity_name: 'חדר סגור', start_date: '2026-07-10', activity_season: 'summer_2026', instructor_name: 'הילה רוזן', emp_id: '1500' },
    { RowID: 'DELETED', status: 'נמחק', authority: 'רשות א', school: 'נמחק', activity_type: 'סדנה', activity_name: 'סדנה נמחקה', start_date: '2026-07-10', activity_season: 'summer_2026', instructor_name: 'הילה רוזן' }
  ];

  assert.deepEqual(completionApprovalInstructorOptions(rows), ['הילה רוזן']);
  const approvals = buildCompletionApprovals(rows, { instructor: 'הילה רוזן', dateMode: 'range', dateFrom: '2026-06-20', dateTo: '2026-08-31' });
  assert.equal(approvals.length, 2);
  assert.deepEqual(approvals.map((approval) => approval.school).sort((a, b) => a.localeCompare(b, 'he')), ['סגור', 'פתוח']);
  assert.deepEqual(approvals.map((approval) => approval.instructorEmpId), ['1500', '1500']);
  assert.deepEqual(approvals.flatMap((approval) => approval.activities.map((activity) => activity.rowId)).sort(), ['CLOSED', 'OPEN']);

  const html = operationsManagementScreen.render({ rows, workshopStockMap: new Map() }, { state });
  assert.match(html, /פתוח/);
  assert.match(html, /סגור/);
  assert.doesNotMatch(html, /נמחק/);
  assert.match(html, /בתאריך זה: הועלו 0 מתוך 2 אישורים נדרשים/);
  assert.match(html, /לכל תקופת הקיץ:<\/strong> הועלו 0 מתוך 2 אישורים נדרשים/);
});

test('completion approval workspace uses table-driven max-content width instead of fixed width', async () => {
  const source = await readFile(new URL('../frontend/src/screens/operations-management.js', import.meta.url), 'utf8');
  assert.match(source, /\.ds-ops-mgmt-screen \.ds-ops-completion-workspace \{ width:max-content; max-width:100%; margin-inline:auto;/);
  assert.match(source, /\.ds-ops-mgmt-screen \.ds-ops-completion-approvals-card \.ds-table-wrap \{ width:max-content; max-width:100%;/);
  assert.doesNotMatch(source, /ds-ops-completion-workspace \{ width:min\(100%, 1000px\); max-width:1000px;/);
});

test('completion approval tab defaults to approvals subtab without legacy instructor prompt', () => {
  const state = baseState();
  state.operationsManagement.tab = 'completion_approval';
  state.operationsManagement.completionApproval = {
    instructor: '',
    dateMode: 'all',
    date: '',
    dateFrom: '',
    dateTo: '',
    preview: false
  };
  const html = operationsManagementScreen.render({ rows: TEXT_SCHOOL_ROWS, workshopStockMap: new Map() }, { state });
  assert.match(html, /בקרת אישורי ביצוע לקיץ 2026/);
  assert.match(html, /data-ops-completion-subtab="approvals"/);
  assert.match(html, /לא נמצאו אישורי ביצוע בטווח הנוכחי/);
  assert.doesNotMatch(html, /בחרו מדריך כדי להציג אישורי ביצוע/);
  assert.doesNotMatch(html, /סינון וחיפוש/);
});

test('workshop quantity metrics use participants_count for required inventory and stock gap rules', () => {
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
  assert.equal(withActual.estimatedQuantity, 238);
  assert.equal(withActual.actualQuantity, 238);
  assert.equal(withActual.stockQuantity, 300);
  assert.equal(withActual.gap, 62);

  const withoutActual = buildWorkshopQuantityMetrics({
    workshopName: 'אסטרונאוט על חוטים',
    activityCount: 8,
    activities: [{ activity_name: 'אסטרונאוט על חוטים' }],
    stockMap: buildWorkshopStockMapFromLists({
      categories: [{ category: 'activity_names', items: [{ value: '002', _row: { category: 'activity_names', type: 'workshop', activity_type: 'workshop', active: true, activity_no: '002', activity_name: 'אסטרונאוט על חוטים', stock_quantity: 150 } }] }]
    })
  });
  assert.equal(withoutActual.estimatedQuantity, 0);
  assert.equal(withoutActual.actualQuantity, null);
  assert.equal(withoutActual.gap, 150);

  const noStock = buildWorkshopQuantityMetrics({
    workshopName: 'צמידי שמש',
    activityCount: 12,
    activities: [],
    stockMap: new Map()
  });
  assert.equal(noStock.estimatedQuantity, 0);
  assert.equal(noStock.stockQuantity, null);
  assert.equal(noStock.gap, null);
});

test('completion approvals are scoped to real assigned instructors and matching uploads use instructor emp id', () => {
  const rows = [
    { RowID: 'A1', status: 'פתוח', authority: 'רשות א', school: 'בית ספר', activity_type: 'סדנה', activity_name: 'סדנה', start_date: '2026-07-10', activity_season: 'summer_2026', instructor_name: 'מדריך ראשון', emp_id: '111', instructor_name_2: 'מדריך שני', emp_id_2: '222' },
    { RowID: 'A2', status: 'פתוח', authority: 'רשות א', school: 'בית ספר', activity_type: 'סדנה', activity_name: 'סדנה נוספת', start_date: '2026-07-10', activity_season: 'summer_2026', instructor_name: 'מדריך ראשון', emp_id: '111', instructor_name_2: 'מדריך נוסף', emp_id_2: '' },
    { RowID: 'A3', status: 'פתוח', authority: 'רשות א', school: 'בית ספר', activity_type: 'סדנה', activity_name: 'סדנה בלי מדריך', start_date: '2026-07-10', activity_season: 'summer_2026', instructor_name: '', emp_id: '' }
  ];

  assert.deepEqual(completionApprovalInstructorOptions(rows), ['מדריך ראשון', 'מדריך שני']);

  const firstApprovals = buildCompletionApprovals(rows, { instructor: 'מדריך ראשון', dateMode: 'range', dateFrom: '2026-06-20', dateTo: '2026-08-31' });
  assert.equal(firstApprovals.length, 1);
  assert.equal(firstApprovals[0].instructorEmpId, '111');
  assert.deepEqual(firstApprovals[0].instructorNames, ['מדריך ראשון']);
  assert.deepEqual(firstApprovals[0].activities.map((activity) => activity.rowId).sort(), ['A1', 'A2']);

  const secondApprovals = buildCompletionApprovals(rows, { instructor: 'מדריך שני', dateMode: 'range', dateFrom: '2026-06-20', dateTo: '2026-08-31' });
  assert.equal(secondApprovals.length, 1);
  assert.equal(secondApprovals[0].instructorEmpId, '222');
  assert.deepEqual(secondApprovals[0].activities.map((activity) => activity.rowId), ['A1']);

  const uploads = [
    { id: 'u1', activity_row_id: 'A1,A2', instructor_emp_id: '111', file_path: 'activity-completion-approvals/111/file.pdf', status: 'uploaded', storage_exists: true },
    { id: 'u2', activity_row_id: 'A1', instructor_emp_id: '222', file_path: 'activity-completion-approvals/222/file.pdf', status: 'uploaded', storage_exists: true }
  ];
  assert.equal(findMatchingCompletionApprovalUpload(uploads, { rowIds: firstApprovals[0].activities.map((activity) => activity.rowId), instructorEmpId: firstApprovals[0].instructorEmpId })?.id, 'u1');
  assert.equal(findMatchingCompletionApprovalUpload(uploads, { rowIds: secondApprovals[0].activities.map((activity) => activity.rowId), instructorEmpId: secondApprovals[0].instructorEmpId })?.id, 'u2');
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

test('workshops inventory falls back to real workshop_stock_distributions keys when catalog lists are empty', () => {
  const state = baseState();
  state.operationsManagement.tab = 'workshops';
  state.operationsManagement.expandedWorkshop = 'kofet_kesem';
  const rows = [
    { RowID: 'FB-1', status: 'פתוח', activity_no: '024', activity_name: 'קופת קסם', start_date: '2026-07-10', activity_season: 'summer_2026', activity_type: 'workshop', participants_count: 36, instructor_name: 'נועה' }
  ];
  const adminListsData = { categories: [{ category: 'workshop_stock', items: [] }] };
  const html = operationsManagementScreen.render({
    rows,
    workshopStockMap: buildWorkshopStockMapFromLists(adminListsData),
    adminListsData,
    workshopStockDistributions: [
      { stock_group_key: 'kofet_kesem', instructor_name: 'מלאי עידן', quantity_received: 12, distribution_date: '2026-07-01' },
      { activity_no: '024', instructor_name: 'נועה', quantity_received: 99, distribution_date: '2026-07-02' }
    ]
  }, { state });
  assert.match(html, /data-ops-stock-group="kofet_kesem"/);
  assert.match(html, /קופת קסם|kofet_kesem/);
  assert.match(html, />12</);
  assert.match(html, /פירוט לפי מדריכים/);
  assert.doesNotMatch(html, /data-ops-stock-group="activity_24"/);
  assert.doesNotMatch(html, />99</);
  assert.doesNotMatch(html, /לא נמצאו סדנאות בטווח הנבחר/);
});

test('workshops inventory preserves special stock_group_key mappings for kofet kesem guitar and watch', () => {
  const state = baseState();
  state.operationsManagement.tab = 'workshops';
  const adminListsData = { categories: [{ category: 'activity_names', items: [
    { value: '024', _row: { category: 'activity_names', type: 'workshop', activity_type: 'workshop', active: true, activity_no: '024', activity_name: 'קופת קסם', stock_group_key: 'kofet_kesem', stock_group_name: 'קופת קסם' } },
    { value: '031', _row: { category: 'activity_names', type: 'workshop', activity_type: 'workshop', active: true, activity_no: '031', activity_name: 'גיטרה', stock_group_key: 'guitar_special', stock_group_name: 'גיטרה' } },
    { value: '032', _row: { category: 'activity_names', type: 'workshop', activity_type: 'workshop', active: true, activity_no: '032', activity_name: 'שעון', stock_group_key: 'watch_special', stock_group_name: 'שעון' } }
  ] }] };
  const html = operationsManagementScreen.render({
    rows: [
      { RowID: 'KOFET-1', status: 'פתוח', activity_no: '024', activity_name: 'קופת קסם', start_date: '2026-07-10', activity_season: 'summer_2026', activity_type: 'workshop' },
      { RowID: 'GUITAR-1', status: 'פתוח', activity_no: '031', activity_name: 'גיטרה', start_date: '2026-07-10', activity_season: 'summer_2026', activity_type: 'workshop' },
      { RowID: 'WATCH-1', status: 'פתוח', activity_no: '032', activity_name: 'שעון', start_date: '2026-07-10', activity_season: 'summer_2026', activity_type: 'workshop' }
    ],
    workshopStockMap: buildWorkshopStockMapFromLists(adminListsData),
    adminListsData,
    workshopStockDistributions: [
      { stock_group_key: 'kofet_kesem', instructor_name: 'מלאי עידן', quantity_received: 10, distribution_date: '2026-07-01' },
      { stock_group_key: 'guitar_special', instructor_name: 'מלאי הילה', quantity_received: 20, distribution_date: '2026-07-01' },
      { stock_group_key: 'watch_special', instructor_name: 'דני', quantity_received: 30, distribution_date: '2026-07-01' }
    ]
  }, { state });
  assert.match(html, /data-ops-stock-group="kofet_kesem"/);
  assert.match(html, /data-ops-stock-group="guitar_special"/);
  assert.match(html, /data-ops-stock-group="watch_special"/);
  assert.doesNotMatch(html, /data-ops-stock-group="activity_24"/);
  assert.doesNotMatch(html, /data-ops-stock-group="activity_31"/);
  assert.doesNotMatch(html, /data-ops-stock-group="activity_32"/);
  assert.match(html, />10</);
  assert.match(html, />20</);
  assert.match(html, />30</);
  assert.doesNotMatch(html, /data-ops-open-stock-edit/);
});

test('workshop stock edit drawer uses special stock_group_key values for admin inventory edits', () => {
  const state = baseState({ user: { role: 'admin' }, operationsManagement: { ...baseState().operationsManagement, tab: 'workshops' } });
  const adminListsData = { categories: [{ category: 'activity_names', items: [
    { value: '024', _row: { list_id: 'k-list', category: 'activity_names', type: 'workshop', activity_type: 'workshop', active: true, activity_no: '024', activity_name: 'קופת קסם', stock_group_key: 'kofet_kesem', stock_group_name: 'קופת קסם', stock_quantity: 10 } },
    { value: '031', _row: { list_id: 'g-list', category: 'activity_names', type: 'workshop', activity_type: 'workshop', active: true, activity_no: '031', activity_name: 'גיטרה', stock_group_key: 'guitar_special', stock_group_name: 'גיטרה', stock_quantity: 20 } },
    { value: '032', _row: { list_id: 'w-list', category: 'activity_names', type: 'workshop', activity_type: 'workshop', active: true, activity_no: '032', activity_name: 'שעון', stock_group_key: 'watch_special', stock_group_name: 'שעון', stock_quantity: 30 } },
    { value: '033', _row: { list_id: 'bad-list', category: 'activity_names', type: 'workshop', activity_type: 'workshop', active: true, activity_no: '033', activity_name: 'ללא מפתח', stock_quantity: 40 } }
  ] }] };
  const html = operationsManagementScreen.render({ rows: [], workshopStockMap: buildWorkshopStockMapFromLists(adminListsData), adminListsData }, { state });
  assert.match(html, /data-ops-open-stock-edit/);
  const items = collectWorkshopStockEditorItems(adminListsData);
  assert.deepEqual(items.map((item) => item.stock_group_key).sort(), ['guitar_special', 'kofet_kesem', 'watch_special']);
  assert.equal(items.some((item) => item.activity_no === '033'), false);
});

test('workshops inventory shows plain text status and flags negative warehouse balance', () => {
  const state = baseState();
  state.operationsManagement.tab = 'workshops';
  const adminListsData = { categories: [{ category: 'activity_names', items: [
    { value: '030', _row: { category: 'activity_names', type: 'workshop', activity_type: 'workshop', active: true, activity_no: '030', activity_name: 'חללית בראשית', stock_group_key: 'beresheet', stock_quantity: 0 } }
  ] }] };
  const html = operationsManagementScreen.render({
    rows: [],
    workshopStockMap: buildWorkshopStockMapFromLists(adminListsData),
    adminListsData,
    workshopStockDistributions: [
      { stock_group_key: 'beresheet', instructor_name: 'דני', quantity_received: 120, distribution_date: '2026-07-10' }
    ]
  }, { state });
  const tableHtml = html.slice(html.indexOf('<table class="ds-table ds-table--compact ds-ops-mgmt-data-table ds-ops-workshops-table"'));

  assert.doesNotMatch(html, /החישוב מבוסס על טווח התאריכים שנבחר/);
  assert.doesNotMatch(html, /טווח חישוב:/);
  assert.match(tableHtml, /חללית בראשית/);
  assert.match(tableHtml, />0<[^]*>120<[^]*><span class="ds-ops-gap ds-ops-gap--shortage"><span dir="ltr">-120<\/span><\/span>/);
  assert.match(tableHtml, /ds-ops-workshop-status-text ds-ops-workshop-status-text--inventory-fix">נדרש תיקון מלאי<\/span>/);
  assert.doesNotMatch(tableHtml, /ds-status[^>]*>נדרש תיקון מלאי/);
  assert.doesNotMatch(tableHtml, />תקין<\/span>/);
});

test('workshops inventory status priority keeps required order and balanced widths', () => {
  const state = baseState();
  state.operationsManagement.tab = 'workshops';
  const adminListsData = { categories: [{ category: 'activity_names', items: [
    { value: '040', _row: { category: 'activity_names', type: 'workshop', activity_type: 'workshop', active: true, activity_no: '040', activity_name: 'סדנת הזמנה', stock_group_key: 'order_needed', stock_quantity: 10 } },
    { value: '041', _row: { category: 'activity_names', type: 'workshop', activity_type: 'workshop', active: true, activity_no: '041', activity_name: 'סדנת העברה', stock_group_key: 'transfer_needed', stock_quantity: 100 } }
  ] }] };
  const html = operationsManagementScreen.render({
    rows: [
      { RowID: 'ORD-1', status: 'פתוח', activity_name: 'סדנת הזמנה', start_date: '2026-07-10', activity_season: 'summer_2026', activity_type: 'workshop', participants_count: 25, instructor_name: 'דני' },
      { RowID: 'TR-1', status: 'פתוח', activity_name: 'סדנת העברה', start_date: '2026-07-10', activity_season: 'summer_2026', activity_type: 'workshop', participants_count: 25, instructor_name: 'נועה' }
    ],
    workshopStockMap: buildWorkshopStockMapFromLists(adminListsData),
    adminListsData,
    workshopStockDistributions: [
      { stock_group_key: 'transfer_needed', instructor_name: 'מחסן', quantity_received: 50, distribution_date: '2026-07-10' }
    ]
  }, { state });

  assert.match(html, /ds-ops-workshop-col--name"><col class="ds-ops-workshop-col--metric"><col class="ds-ops-workshop-col--metric"><col class="ds-ops-workshop-col--metric"><col class="ds-ops-workshop-col--metric"><col class="ds-ops-workshop-col--metric"><col class="ds-ops-workshop-col--status"/);
  assert.match(html, /ds-ops-workshops-table th:nth-child\(8\),\n    \.ds-ops-mgmt-screen \.ds-ops-workshops-table td:nth-child\(8\) \{ text-align:right; \}/);
  assert.match(html, /ds-ops-workshop-status-text--danger">נדרש להזמין<\/span>/);
  assert.match(html, /ds-ops-workshop-status-text--info">להעביר מהמחסן<\/span>/);
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
  assert.match(tableHtml, />80</);
  assert.match(tableHtml, /חסר מספר משתתפים ב-2 פעילויות/);
  assert.doesNotMatch(tableHtml, />75</);
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


test('workshops inventory treats missing participant counts as zero and warns', () => {
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
  assert.match(tableHtml, />0</);
  assert.match(tableHtml, /חסר מספר משתתפים ב-1 פעילויות/);
  assert.doesNotMatch(tableHtml, />25</);
  assert.doesNotMatch(tableHtml, /ברירת מחדל/);
  assert.doesNotMatch(tableHtml, /NaN/);
  assert.match(tableHtml, />150<[^]*>0<[^]*>150</);
});




test('workshops inventory expected balance subtracts closed usage from physical stock', () => {
  const state = baseState();
  state.operationsManagement.tab = 'workshops';
  const adminListsData = { categories: [{ category: 'activity_names', items: [
    { value: '777', _row: { category: 'activity_names', type: 'workshop', activity_type: 'workshop', active: true, activity_no: '777', activity_name: 'סדנת חישוב מלאי', stock_group_key: 'calc_stock' } }
  ] }] };
  const html = operationsManagementScreen.render({
    rows: [
      { RowID: 'CALC-CLOSED', status: 'סגור', activity_name: 'סדנת חישוב מלאי', start_date: '2026-07-10', activity_season: 'summer_2026', activity_type: 'workshop', participants_count: 64, instructor_name: 'דני' },
      { RowID: 'CALC-OPEN', status: 'פתוח', activity_name: 'סדנת חישוב מלאי', start_date: '2026-07-11', activity_season: 'summer_2026', activity_type: 'workshop', participants_count: 49, instructor_name: 'דני' }
    ],
    workshopStockMap: buildWorkshopStockMapFromLists(adminListsData),
    adminListsData,
    workshopStockDistributions: [
      { stock_group_key: 'calc_stock', instructor_name: 'מלאי עידן', quantity_received: 110, distribution_date: '2026-07-01' }
    ]
  }, { state });
  const tableHtml = html.slice(html.indexOf('<table class="ds-table ds-table--compact ds-ops-mgmt-data-table ds-ops-workshops-table"'));

  assert.match(tableHtml, /כמות קיימת/);
  assert.match(tableHtml, /ניצול בפועל/);
  assert.match(tableHtml, /צפי נדרש/);
  assert.match(tableHtml, /יתרה צפויה/);
  assert.match(tableHtml, /סדנת חישוב מלאי[^]*>110<[^]*>64<[^]*>49<[^]*><span class="ds-ops-gap ds-ops-gap--shortage"><span dir="ltr">-3<\/span><\/span>/);
  assert.match(tableHtml, /ds-ops-workshop-status-text--danger">חסר מלאי<\/span>/);
});

test('workshops instructor detail balance subtracts closed usage from received stock', () => {
  const state = baseState();
  state.operationsManagement.tab = 'workshops';
  state.operationsManagement.expandedWorkshop = 'instructor_calc';
  const adminListsData = { categories: [{ category: 'activity_names', items: [
    { value: '778', _row: { category: 'activity_names', type: 'workshop', activity_type: 'workshop', active: true, activity_no: '778', activity_name: 'סדנת מדריך', stock_group_key: 'instructor_calc' } }
  ] }] };
  const html = operationsManagementScreen.render({
    rows: [
      { RowID: 'INST-CLOSED', status: 'סגור', activity_name: 'סדנת מדריך', start_date: '2026-07-10', activity_season: 'summer_2026', activity_type: 'workshop', participants_count: 25, instructor_name: 'דני' },
      { RowID: 'INST-OPEN', status: 'פתוח', activity_name: 'סדנת מדריך', start_date: '2026-07-11', activity_season: 'summer_2026', activity_type: 'workshop', participants_count: 49, instructor_name: 'דני' }
    ],
    workshopStockMap: buildWorkshopStockMapFromLists(adminListsData),
    adminListsData,
    workshopStockDistributions: [
      { stock_group_key: 'instructor_calc', instructor_name: 'דני', quantity_received: 60, distribution_date: '2026-07-01' }
    ]
  }, { state });

  assert.match(html, /<th class="ds-ops-dist-col--instructor">מדריך<\/th><th class="ds-ops-dist-col--number">כמות קיימת<\/th><th class="ds-ops-dist-col--number">ניצול בפועל<\/th><th class="ds-ops-dist-col--number">צפי נדרש<\/th><th class="ds-ops-dist-col--number">יתרה צפויה<\/th>/);
  assert.match(html, /דני<\/td>\s*<td class="ds-ops-dist-col--number">60<\/td>\s*<td class="ds-ops-dist-col--number">25<\/td>\s*<td class="ds-ops-dist-col--number">49<\/td>\s*<td class="ds-ops-dist-col--number"><span class="ds-ops-gap ds-ops-gap--shortage"><span dir="ltr">-14<\/span><\/span><\/td>/);
  assert.match(html, /\.ds-ops-mgmt-screen \.ds-ops-dist-table--locations \{ width:320px !important; max-width:100% !important; margin:0 auto !important; \}/);
});

test('required inventory helper sums only positive participants_count and never falls back to estimate', () => {
  assert.equal(getActivityRequiredInventoryQuantity({ participants_count: 30 }), 30);
  assert.equal(sumRequiredInventoryQuantitiesFromActivities([{ participants_count: 20 }, { participants_count: 35 }]), 55);
  assert.equal(getActivityRequiredInventoryQuantity({ activity_name: 'סדנה ללא משתתפים' }), 0);
  assert.equal(getActivityRequiredInventoryQuantity({ participants_count: 0 }), 0);
  assert.equal(getActivityRequiredInventoryQuantity({ participants_count: '' }), 0);
  assert.equal(WORKSHOP_ESTIMATE_PER_ACTIVITY, 25);
});

test('workshops required inventory matches participants_count from DB examples and deduplicates instructors', () => {
  const state = baseState();
  state.operationsManagement.tab = 'workshops';
  const adminListsData = { categories: [{ category: 'activity_names', items: [
    { value: '011', _row: { category: 'activity_names', type: 'workshop', activity_type: 'workshop', active: true, activity_no: '011', activity_name: 'גשר לאונרדו', stock_quantity: 1000 } },
    { value: '012', _row: { category: 'activity_names', type: 'workshop', activity_type: 'workshop', active: true, activity_no: '012', activity_name: 'מכונית מגנטית', stock_quantity: 1000 } },
    { value: '024', _row: { category: 'activity_names', type: 'workshop', activity_type: 'workshop', active: true, activity_no: '024', activity_name: 'קופת קסם', stock_quantity: 1000 } },
    { value: '050', _row: { category: 'activity_names', type: 'workshop', activity_type: 'workshop', active: true, activity_no: '050', activity_name: 'חדר בריחה קווסט', stock_quantity: 1000 } }
  ] }] };
  const html = operationsManagementScreen.render({
    rows: [
      { RowID: 'LEO-1', status: 'פתוח', activity_name: 'גשר לאונרדו', start_date: '2026-07-10', activity_season: 'summer_2026', activity_type: 'workshop', participants_count: 117, instructor_name: 'דני', instructor_name_2: 'דני' },
      { RowID: 'MAG-1', status: 'פתוח', activity_name: 'מכונית מגנטית', start_date: '2026-07-10', activity_season: 'summer_2026', activity_type: 'workshop', participants_count: 384, instructor_name: 'נועה' },
      { RowID: 'BOX-1', status: 'פתוח', activity_name: 'קופת קסם', start_date: '2026-07-10', activity_season: 'summer_2026', activity_type: 'workshop', participants_count: 401, instructor_name: 'הילה' },
      { RowID: 'QUEST-1', status: 'פתוח', activity_name: 'חדר בריחה קווסט', start_date: '2026-07-10', activity_season: 'summer_2026', activity_type: 'workshop', participants_count: 600, instructor_name: 'תמיר' }
    ],
    workshopStockMap: buildWorkshopStockMapFromLists(adminListsData),
    adminListsData
  }, { state });
  const tableHtml = html.slice(html.indexOf('<table class="ds-table ds-table--compact ds-ops-mgmt-data-table ds-ops-workshops-table"'));
  assert.match(tableHtml, /גשר לאונרדו[^]*>117</);
  assert.match(tableHtml, /מכונית מגנטית[^]*>384</);
  assert.match(tableHtml, /קופת קסם[^]*>401</);
  assert.match(tableHtml, /חדר בריחה קווסט[^]*>600</);
  assert.equal((html.match(/LEO-1/g) || []).length, 0);
  assert.equal(getActivityInstructorNames({ instructor_name: 'דני', instructor_name_2: 'דני' }).length, 1);
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
  assert.match(tableHtml, /024, 029/);
  assert.doesNotMatch(tableHtml, /024 - קופת קסם/);
  assert.doesNotMatch(tableHtml, /029 - קופת קסם/);
  assert.match(tableHtml, />390</);
});

test('workshops inventory uses all prepared open and closed rows with canonical numeric stock group keys', () => {
  const state = baseState();
  state.operationsManagement.tab = 'workshops';
  state.activityList = { status: 'פתוח' };
  const adminListsData = { categories: [{ category: 'activity_names', items: [
    { value: '008', _row: { category: 'activity_names', type: 'workshop', activity_type: 'workshop', active: true, activity_no: '008', activity_name: 'סדנת קנונית', stock_group_key: '008', stock_quantity: 200 } }
  ] }] };
  const html = operationsManagementScreen.render({
    rows: [
      { RowID: 'CAN-OPEN', status: 'פתוח', activity_no: '8', activity_name: 'סדנת קנונית', start_date: '2026-07-01', activity_season: 'summer_2026', activity_type: 'workshop', participants_count: 30, instructor_name: 'דני' },
      { RowID: 'CAN-CLOSED', status: 'סגור', activity_no: 'activity_008', activity_name: 'סדנת קנונית', start_date: '2026-07-02', activity_season: 'summer_2026', activity_type: 'workshop', participants_count: 40, instructor_name: 'נועה' },
      { RowID: 'CAN-CANCEL', status: 'מבוטל', activity_no: '8', activity_name: 'סדנת קנונית', start_date: '2026-07-03', activity_season: 'summer_2026', activity_type: 'workshop', participants_count: 90, instructor_name: 'הילה' },
      { RowID: 'CAN-TAMIR', status: 'פתוח', activity_no: '8', activity_name: 'סדנת קנונית תמיר', start_date: '2026-07-04', activity_season: 'summer_2026', activity_type: 'workshop', participants_count: 80, instructor_name: 'תמיר' }
    ],
    workshopStockMap: buildWorkshopStockMapFromLists(adminListsData),
    adminListsData,
    workshopStockDistributions: [
      { stock_group_key: 'activity_8', instructor_name: 'דני', quantity_received: 30, distribution_date: '2026-07-01' },
      { stock_group_key: '8', instructor_name: 'נועה', quantity_received: 40, distribution_date: '2026-07-02' }
    ]
  }, { state });
  const tableHtml = html.slice(html.indexOf('<table class="ds-table ds-table--compact ds-ops-mgmt-data-table ds-ops-workshops-table"'));
  assert.match(tableHtml, /data-ops-stock-group="activity_8"/);
  assert.match(tableHtml, /סדנת קנונית[^]*>200<[^]*>70<[^]*>130<[^]*>70<[^]*><span class="ds-ops-gap ds-ops-gap--ok">0<\/span>/);
  assert.doesNotMatch(tableHtml, />240</);
  assert.doesNotMatch(tableHtml, /CAN-CANCEL|CAN-TAMIR/);
});

test('workshops instructor detail requires participants_count for every assigned instructor', () => {
  const state = baseState();
  state.operationsManagement.tab = 'workshops';
  state.operationsManagement.expandedWorkshop = 'activity_9';
  const adminListsData = { categories: [{ category: 'activity_names', items: [
    { value: '009', _row: { category: 'activity_names', type: 'workshop', activity_type: 'workshop', active: true, activity_no: '009', activity_name: 'סדנת מדריכים', stock_quantity: 100 } }
  ] }] };
  const html = operationsManagementScreen.render({
    rows: [
      { RowID: 'MULTI-1', status: 'פתוח', activity_no: '009', activity_name: 'סדנת מדריכים', start_date: '2026-07-01', activity_season: 'summer_2026', activity_type: 'workshop', participants_count: 25, instructor_name: 'דני', instructor_name_2: 'נועה' }
    ],
    workshopStockMap: buildWorkshopStockMapFromLists(adminListsData),
    adminListsData
  }, { state });
  const detailHtml = html.slice(html.indexOf('פירוט סדנה'));
  assert.match(detailHtml, /דני[^]*>0<[^]*>25<[^]*><span class="ds-ops-gap ds-ops-gap--shortage"><span dir="ltr">-25<\/span><\/span>/);
  assert.match(detailHtml, /נועה[^]*>0<[^]*>25<[^]*><span class="ds-ops-gap ds-ops-gap--shortage"><span dir="ltr">-25<\/span><\/span>/);
});


test('workshops inventory separates stock locations from instructor delivery totals and details', () => {
  const state = baseState();
  state.operationsManagement.tab = 'workshops';
  state.operationsManagement.expandedWorkshop = 'activity_9';
  const adminListsData = { categories: [{ category: 'activity_names', items: [
    { value: '009', _row: { category: 'activity_names', type: 'workshop', activity_type: 'workshop', active: true, activity_no: '009', activity_name: 'סדנת מלאי', stock_quantity: 100 } }
  ] }] };
  const html = operationsManagementScreen.render({
    rows: [
      { RowID: 'STOCK-1', status: 'פתוח', activity_no: '009', activity_name: 'סדנת מלאי', start_date: '2026-07-01', activity_season: 'summer_2026', activity_type: 'workshop', participants_count: 25, instructor_name: 'דני' }
    ],
    workshopStockMap: buildWorkshopStockMapFromLists(adminListsData),
    adminListsData,
    workshopStockDistributions: [
      { stock_group_key: 'activity_9', instructor_name: 'מלאי עידן', quantity_received: 40, distribution_date: '2026-07-01' },
      { stock_group_key: 'activity_9', instructor_name: 'מלאי הילה', quantity_received: 15, distribution_date: '2026-07-01' },
      { stock_group_key: 'activity_9', instructor_name: 'דני', quantity_received: 20, distribution_date: '2026-07-01' }
    ]
  }, { state });
  const mainRowHtml = html.slice(html.indexOf('data-ops-stock-group="activity_9"'), html.indexOf('</tr>', html.indexOf('data-ops-stock-group="activity_9"')));
  const detailHtml = html.slice(html.indexOf('פירוט סדנה'));

  assert.match(mainRowHtml, />100</);
  assert.match(mainRowHtml, />25</);
  assert.match(mainRowHtml, />20</);
  assert.match(detailHtml, /מלאי במיקומים[^]*מלאי עידן[^]*>40<[^]*מלאי הילה[^]*>15<[^]*סה״כ במיקומים[^]*>55</);
  assert.match(detailHtml, /חלוקה למדריכים[^]*דני[^]*>20<[^]*>25</);
  assert.doesNotMatch(detailHtml.slice(detailHtml.indexOf('חלוקה למדריכים')), /מלאי עידן|מלאי הילה/);
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

test('completion approval print document uses compact printable structure', () => {
  const html = completionApprovalDocumentHtml({
    instructorName: 'הילה רוזן',
    empId: '1234',
    date: '2026-07-10',
    authority: 'רשות לדוגמה',
    school: 'בית ספר רמבם',
    address: 'רחוב 1',
    contact: { name: 'דנה כהן', role: 'רכזת', phone: '050-0000000', email: 'dana@example.test' },
    activities: [{
      name: 'פעילות מאוחרת',
      grade: 'ד',
      start: '',
      end: '',
      participants_count: 25
    }, {
      name: 'פעילות שנייה',
      grade: 'ד',
      start: '09:00:00',
      end: '09:45:00'
    }, {
      name: 'פעילות ראשונה',
      type: 'workshop',
      grade: 'ד',
      group: 'קבוצה א',
      start: '08:30:00',
      end: '09:00:00',
      notes: 'הערה',
      participants_count: 25
    }]
  });

  assert.match(html, /אישור ביצוע פעילות/);
  const headerHtml = html.match(/<header class="completion-approval-header">[\s\S]*?<\/header>/)?.[0] || '';
  const footerHtml = html.match(/<footer class="completion-approval-footer">[\s\S]*?<\/footer>/)?.[0] || '';
  assert.match(headerHtml, /<img class="completion-approval-logo"[^>]+alt="לוגו תעשיידע"/);
  assert.doesNotMatch(headerHtml, /עמותת תעשיידע – תעשייה למען חינוך מתקדם/);
  assert.match(footerHtml, /עמותת תעשיידע – תעשייה למען חינוך מתקדם/);
  assert.match(html, /בית ספר רמבם/);
  assert.match(html, /רשות: רשות לדוגמה/);
  assert.match(html, /הילה רוזן/);
  assert.match(html, /<th>שם הפעילות<\/th>/);
  assert.doesNotMatch(html, /שם סדנה \/ פעילות/);
  assert.match(html, /<th class="completion-approval-table__center">כיתה<\/th>/);
  assert.match(html, /<th class="completion-approval-table__center">שעת התחלה<\/th>/);
  assert.match(html, /<th class="completion-approval-table__center">שעת סיום<\/th>/);
  assert.match(html, /<th>מספר משתתפים<\/th>/);
  assert.match(html, /<td class="completion-approval-table__manual"><\/td>/);
  assert.match(html, />08:30<\/td>/);
  assert.match(html, />09:45<\/td>/);
  assert.doesNotMatch(html, /09:45:00/);
  assert.ok(html.indexOf('פעילות ראשונה') < html.indexOf('פעילות שנייה'));
  assert.ok(html.indexOf('פעילות שנייה') < html.indexOf('פעילות מאוחרת'));
  assert.match(html, /שם מלא/);
  assert.match(html, /תפקיד/);
  assert.match(html, /חתימה/);
  assert.match(html, /חותמת בית הספר/);
  assert.doesNotMatch(html, /דנה כהן|רכזת/);
  assert.doesNotMatch(html, /מספר עובד/);
  assert.doesNotMatch(html, /1234/);
  assert.doesNotMatch(html, /כתובת בית ספר/);
  assert.doesNotMatch(html, /רחוב 1/);
  assert.doesNotMatch(html, /סוג פעילות/);
  assert.doesNotMatch(html, /כיתה \/ שכבה/);
  assert.doesNotMatch(html, /קבוצה/);
  assert.doesNotMatch(html, /הערות/);
  assert.doesNotMatch(html, /טלפון|דוא״ל|050-0000000|dana@example\.test/);
  assert.doesNotMatch(html, /חתימת מדריך/);
  assert.doesNotMatch(html, />25</);
});

test('completion approval time formatter and table width are print scoped', () => {
  assert.equal(formatApprovalTime('08:30:00'), '08:30');
  assert.equal(formatApprovalTime('13:00'), '13:00');
  assert.equal(formatApprovalTime(''), '');
  assert.equal(formatApprovalTime(null), '');
  assert.match(completionApprovalPrintCss, /\.approval-print-table\{width:60%;margin-inline:auto\}/);
  assert.match(completionApprovalPrintCss, /\.completion-approval-col-activity\{width:45%\}/);
  assert.match(completionApprovalPrintCss, /\.completion-approval-col-grade\{width:10%\}/);
  assert.match(completionApprovalPrintCss, /\.completion-approval-col-start\{width:13%\}/);
  assert.match(completionApprovalPrintCss, /\.completion-approval-col-end\{width:13%\}/);
  assert.match(completionApprovalPrintCss, /\.completion-approval-col-participants\{width:19%\}/);
  assert.match(completionApprovalPrintCss, /\.completion-approval-table th\{[^}]*white-space:nowrap/);
  assert.match(completionApprovalPrintCss, /\.completion-approval-table__center\{text-align:center!important\}/);
  assert.match(completionApprovalPrintCss, /\.completion-approval-logo\{[^}]*inset-inline-end:0;top:0;height:42px;max-height:20mm;width:auto;object-fit:contain/);
  assert.match(completionApprovalPrintCss, /\.approval-sign-line\{display:inline-block;width:220px;border-bottom:1px solid #111827/);
  assert.match(completionApprovalPrintCss, /\.completion-approval-signature p\{margin:16px 0\}/);
  assert.match(completionApprovalPrintCss, /\.completion-approval-footer\{[^}]*font-size:10px;[^}]*color:#64748b/);
});

test('completion approval activities sort by start time, end time and name', () => {
  const sorted = sortApprovalActivitiesByTime([
    { name: 'ללא שעה', start: '', end: '' },
    { name: 'ב פעילות', start: '09:00:00', end: '09:45:00' },
    { name: 'א פעילות', start: '09:00:00', end: '09:45:00' },
    { name: 'מוקדמת', start: '08:15:00', end: '09:00:00' },
    { name: 'קצרה', start: '09:00:00', end: '09:30:00' },
    { name: 'מתוך טווח', time: '10:15:00-11:00:00' }
  ]);
  assert.deepEqual(sorted.map((activity) => activity.name), [
    'מוקדמת',
    'קצרה',
    'א פעילות',
    'ב פעילות',
    'מתוך טווח',
    'ללא שעה'
  ]);
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

test('collectWorkshopStockEditorItems exposes only real stock_group_key inventory items', () => {
  const adminListsData = {
    categories: [
      { category: 'workshop_stock', items: [
        { value: 'frog', label: 'פרוגי המקפצת', _row: { list_id: 'ws-1', category: 'workshop_stock', value: 'frog', label: 'פרוגי המקפצת', active: true, stock_group_key: 'frog_stock', stock_group_name: 'פרוגי המקפצת', stock_quantity: 120 } }
      ] },
      { category: 'activity_names', items: [
        { value: '001', label: 'פרוגי המקפצת', _row: { category: 'activity_names', type: 'workshop', activity_type: 'workshop', active: true, activity_no: '001', activity_name: 'פרוגי המקפצת', stock_group_key: 'frog_stock', stock_quantity: 120 } },
        { value: '002', label: 'סדנת חדשה', _row: { category: 'activity_names', type: 'workshop', activity_type: 'workshop', active: true, activity_no: '002', activity_name: 'סדנת חדשה', stock_group_key: 'new_stock', stock_group_name: 'מלאי סדנת חדשה', stock_quantity: 40 } },
        { value: '003', label: 'ללא מיפוי', _row: { category: 'activity_names', type: 'workshop', activity_type: 'workshop', active: true, activity_no: '003', activity_name: 'ללא מיפוי', stock_quantity: 10 } }
      ] }
    ]
  };
  const items = collectWorkshopStockEditorItems(adminListsData);
  assert.equal(items.length, 2);
  assert.equal(items.find((item) => item.label === 'פרוגי המקפצת')?.source, 'workshop_stock');
  assert.equal(items.find((item) => item.label === 'פרוגי המקפצת')?.stock_group_key, 'frog_stock');
  assert.equal(items.find((item) => item.label === 'מלאי סדנת חדשה')?.source, 'activity_names');
  assert.equal(items.find((item) => item.label === 'מלאי סדנת חדשה')?.stock_group_key, 'new_stock');
  assert.equal(items.some((item) => item.label === 'ללא מיפוי'), false);
});

test('workshops tab shows stock edit button only for admin', () => {
  const adminListsData = { categories: [{ category: 'workshop_stock', items: [
    { value: 'frog', label: 'פרוגי המקפצת', _row: { category: 'workshop_stock', value: 'frog', label: 'פרוגי המקפצת', active: true, stock_group_key: 'frog_stock', stock_quantity: 120 } }
  ] }] };
  const payload = {
    rows: [{ RowID: 'FROG-1', status: 'פתוח', activity_name: 'פרוגי המקפצת', start_date: '2026-07-10', activity_season: 'summer_2026' }],
    workshopStockMap: buildWorkshopStockMapFromLists(adminListsData),
    adminListsData
  };
  const adminState = baseState({ user: { role: 'admin' }, operationsManagement: { ...baseState().operationsManagement, tab: 'workshops', dateFrom: '2026-07-01', dateTo: '2026-07-31' } });
  const managerState = baseState({ user: { role: 'operation_manager' }, operationsManagement: { ...baseState().operationsManagement, tab: 'workshops', dateFrom: '2026-07-01', dateTo: '2026-07-31' } });
  const adminHtml = operationsManagementScreen.render(payload, { state: adminState });
  const managerHtml = operationsManagementScreen.render(payload, { state: managerState });
  assert.match(adminHtml, /data-ops-open-stock-edit/);
  assert.match(adminHtml, /עריכת מלאי/);
  assert.doesNotMatch(managerHtml, /data-ops-open-stock-edit/);
});

test('service worker keeps CACHE_VERSION only in frontend implementation', async () => {
  const frontendSw = await readFile(new URL('../frontend/sw.js', import.meta.url), 'utf8');
  const rootSw = await readFile(new URL('../sw.js', import.meta.url), 'utf8');

  assert.match(frontendSw, /const CACHE_VERSION = \d+;/);
  assert.doesNotMatch(rootSw, /SW_ENTRY_VERSION/, 'root sw.js is a shim and must not define a legacy entry version');
  assert.doesNotMatch(rootSw, /\bCACHE_VERSION\b\s*=/, 'root sw.js must not define a separate cache version');
  assert.match(rootSw, /frontend\/sw\.js/, 'root sw.js should only load the frontend service worker implementation');
});
