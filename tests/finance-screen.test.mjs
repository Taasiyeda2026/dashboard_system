import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import * as XLSX from 'xlsx';
import {
  canAccessFinance,
  createFinanceVisitState,
  financeScreen,
  FINANCE_ATTENDANCE_COLUMNS,
  FINANCE_ATTENDANCE_EMPLOYMENT_SHEETS,
  FINANCE_ATTENDANCE_GENERAL_SHEET,
  FINANCE_COLLECTION_ACTIVITY_PERIOD,
  FINANCE_MAOF_DAILY_COLUMNS,
  FINANCE_MAOF_SHEET,
  attachCollectionTracking,
  buildFinanceAttendanceExcelRows,
  buildFinanceAttendanceWorkbook,
  buildMaofDailyExcelRows,
  filterFinanceCollectionActivities,
  financeActivityEndDate,
  financeActivityEndMonthKey,
  financeCollectionSearchHaystack,
  financeEmploymentSheetName,
  financeHourCategory,
  financePayerKey,
  formatFinanceReportedHourRanges,
  groupFinanceCollectionByEndMonth,
  groupFinanceCollectionPayers,
  FINANCE_NO_END_DATE_MONTH_KEY,
  FINANCE_NO_END_DATE_MONTH_LABEL,
  isFinalPayrollApproval,
  isGefenFunding,
  mapLegacyPaymentCollected,
  mergeFinanceReportedTimeRanges,
  normalizeFinanceEmploymentType,
  summarizeFinanceCollectionTotals,
  summarizeFinanceAttendance,
  unmappedFinanceActivityTypes
} from '../frontend/src/screens/finance.js';

const migration = readFileSync(new URL('../supabase/migrations/20260819120000_finance_collection_tracking.sql', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
const financeSource = readFileSync(new URL('../frontend/src/screens/finance.js', import.meta.url), 'utf8');

const financeUser = { display_role: 'finance', role: 'finance', finance_access: true };
const blockedUser = { display_role: 'authorized_user', role: 'authorized_user', finance_access: false };

function snapshotRow(overrides = {}) {
  return {
    employeeId: '1001',
    employeeName: 'עובד א',
    employmentType: 'תעשיידע',
    date: '2026-08-03',
    workHours: 2,
    activityType: 'קורס',
    kilometers: 10,
    notes: '',
    ...overrides
  };
}

function approval(overrides = {}) {
  const employeeId = overrides.employee_id || overrides.employeeId || '1001';
  const rows = overrides.rows || [snapshotRow({ employeeId })];
  return {
    id: overrides.id || `a-${employeeId}`,
    employee_id: employeeId,
    employee_name: overrides.employee_name || 'עובד א',
    month_key: '2026-08',
    status: overrides.status || 'approved_for_payroll',
    pdf_path: overrides.pdf_path ?? '',
    pdf_file_name: overrides.pdf_file_name ?? '',
    approved_snapshot: overrides.approved_snapshot || { employeeId, employeeName: overrides.employee_name || 'עובד א', rows },
    ...overrides
  };
}

function activity(overrides = {}) {
  return {
    row_id: 'ACT-1',
    activity_name: 'קורס רובוטיקה',
    activity_type: 'course',
    authority: 'עיריית רחובות',
    authority_id: 'auth-1',
    school: 'בית ספר הרצל',
    school_id: 'school-1',
    funding: 'גפ״ן',
    price: 1000,
    status: 'פתוח',
    activity_season: 'school_2027',
    ...overrides
  };
}

function mockApi({ activities = [], tracking = [], approvals = [], employees = [] } = {}) {
  const counts = {
    allActivities: 0,
    listPayrollControlApprovals: 0,
    attendanceControlTeams: 0,
    attendanceControlRecords: 0,
    listFinanceCollectionTracking: 0,
    upsertFinanceCollectionTracking: 0
  };
  const store = [...tracking];
  const lastArgs = { allActivities: null };
  return {
    counts,
    store,
    lastArgs,
    allActivities: async (params = {}) => {
      counts.allActivities += 1;
      lastArgs.allActivities = params;
      return { rows: activities };
    },
    listPayrollControlApprovals: async () => {
      counts.listPayrollControlApprovals += 1;
      return approvals;
    },
    attendanceControlTeams: async () => {
      counts.attendanceControlTeams += 1;
      return employees;
    },
    attendanceControlRecords: async () => {
      counts.attendanceControlRecords += 1;
      return [];
    },
    listFinanceCollectionTracking: async () => {
      counts.listFinanceCollectionTracking += 1;
      return store;
    },
    upsertFinanceCollectionTracking: async (payload) => {
      counts.upsertFinanceCollectionTracking += 1;
      const next = {
        activity_row_id: payload.activity_row_id,
        collection_status: payload.collection_status,
        expected_collection_date: payload.expected_collection_date,
        finance_note: payload.finance_note
      };
      const idx = store.findIndex((row) => row.activity_row_id === payload.activity_row_id);
      if (idx >= 0) store[idx] = next;
      else store.push(next);
      return next;
    }
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

function mount(data, { api, user = financeUser, activityPeriodTab = 'school_2027' } = {}) {
  const state = { user, activityPeriodTab };
  const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', { url: 'https://example.test/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  const host = dom.window.document.getElementById('host');
  const paint = () => {
    host.innerHTML = financeScreen.render(data, { state });
  };
  paint();
  financeScreen.bind({ root: host, data, state, api, rerender: paint });
  return { host, state, paint, window: dom.window };
}

test('finance screen blocks users without finance_access', () => {
  const html = financeScreen.render(createFinanceVisitState(), { state: { user: blockedUser } });
  assert.match(html, /אין הרשאה לצפייה בעמוד כספים/);
  assert.doesNotMatch(html, /דיווח נוכחות/);
  assert.doesNotMatch(html, /מעקב גבייה/);
});

test('finance hub shows exactly two cards and no KPI or activity tables', () => {
  const html = financeScreen.render(createFinanceVisitState(), { state: { user: financeUser } });
  assert.match(html, /דיווח נוכחות/);
  assert.match(html, /ריכוז נתוני נוכחות ושכר לאחר אישור סופי/);
  assert.match(html, /מעקב גבייה/);
  assert.match(html, /מעקב גבייה מרוכז לפי הגורם המשלם/);
  assert.equal([...html.matchAll(/data-finance-open="(attendance|collection)"/g)].length, 2);
  assert.doesNotMatch(html, /חריגות כספיות|סה״כ פעילויות|אישורי בקרת נוכחות|data-finance-filter/);
});

test('entering finance does not load activities, attendance, or payroll approvals', async () => {
  const api = mockApi();
  const data = await financeScreen.load({ api, state: { user: financeUser } });
  financeScreen.render(data, { state: { user: financeUser } });
  assert.equal(api.counts.allActivities, 0);
  assert.equal(api.counts.listPayrollControlApprovals, 0);
  assert.equal(api.counts.attendanceControlRecords, 0);
  assert.equal(api.counts.listFinanceCollectionTracking, 0);
  assert.doesNotMatch(financeScreen.load.toString(), /allActivities|listPayrollControlApprovals|attendanceControlRecords/);
});

test('collection card loads allActivities once and returning to it does not reload', async () => {
  const api = mockApi({ activities: [activity()] });
  const data = createFinanceVisitState();
  const { host } = mount(data, { api });
  host.querySelector('[data-finance-open="collection"]').click();
  await flush();
  assert.equal(api.counts.allActivities, 1);
  assert.equal(api.counts.listPayrollControlApprovals, 0);
  host.querySelector('[data-finance-open="hub"]').click();
  await flush();
  host.querySelector('[data-finance-open="attendance"]').click();
  await flush();
  host.querySelector('[data-finance-open="hub"]').click();
  await flush();
  host.querySelector('[data-finance-open="collection"]').click();
  await flush();
  assert.equal(api.counts.allActivities, 1);
});

test('collection tracking always requests and shows school_2027 activities even if the global period is regular', async () => {
  const api = mockApi({
    activities: [
      activity({ row_id: 'Y27', activity_name: 'קורס תשפז', activity_season: 'school_2027' }),
      activity({ row_id: 'Y26', activity_name: 'קורס תשפו', activity_season: 'regular', school: 'בית ספר 2026' })
    ]
  });
  const data = createFinanceVisitState();
  const { host } = mount(data, { api, activityPeriodTab: 'regular' });
  host.querySelector('[data-finance-open="collection"]').click();
  await flush();
  assert.equal(api.lastArgs.allActivities.activity_period, FINANCE_COLLECTION_ACTIVITY_PERIOD);
  assert.equal(api.lastArgs.allActivities.activity_period, 'school_2027');
  assert.match(host.innerHTML, /קורס תשפז/);
  assert.doesNotMatch(host.innerHTML, /קורס תשפו|בית ספר 2026/);
});

test('attendance is not loaded until the attendance card is clicked', async () => {
  const api = mockApi({ approvals: [approval()] });
  const data = createFinanceVisitState();
  const { host } = mount(data, { api });
  assert.equal(api.counts.listPayrollControlApprovals, 0);
  host.querySelector('[data-finance-open="collection"]').click();
  await flush();
  assert.equal(api.counts.listPayrollControlApprovals, 0);
  host.querySelector('[data-finance-open="hub"]').click();
  host.querySelector('[data-finance-open="attendance"]').click();
  await flush();
  assert.equal(api.counts.listPayrollControlApprovals, 1);
  host.querySelector('[data-finance-open="hub"]').click();
  host.querySelector('[data-finance-open="attendance"]').click();
  await flush();
  assert.equal(api.counts.listPayrollControlApprovals, 1);
});

test('only final admin payroll approvals enter the attendance table', () => {
  const rows = summarizeFinanceAttendance([
    approval({ employee_id: '1', employee_name: 'מאושר', status: 'approved_for_payroll' }),
    approval({ employee_id: '2', employee_name: 'מנהל בלבד', status: 'manager_approved', rows: [snapshotRow({ employeeId: '2', employeeName: 'מנהל בלבד' })] })
  ]).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].employeeName, 'מאושר');
  assert.equal(isFinalPayrollApproval({ status: 'manager_approved' }), false);
});

test('one employee appears once with hours, unique work days, km, and file icon only when a file exists', () => {
  const summarized = summarizeFinanceAttendance([
    approval({
      employee_id: '1001',
      pdf_path: 'https://files.example/report.pdf',
      pdf_file_name: 'report.pdf',
      rows: [
        snapshotRow({ date: '2026-08-01', activityType: 'קורס', workHours: 2, kilometers: 5, notes: 'בוקר' }),
        snapshotRow({ date: '2026-08-01', activityType: 'סדנה', workHours: 3, kilometers: 7 }),
        snapshotRow({ date: '2026-08-02', activityType: 'סיור', workHours: 4, kilometers: 1, notes: 'צהריים' }),
        snapshotRow({ date: '2026-08-03', activityType: 'הכשרה', workHours: 1, kilometers: 0 }),
        snapshotRow({ date: '2026-08-04', activityType: 'תפעול', workHours: 2, kilometers: 0 }),
        snapshotRow({ date: '2026-08-05', activityType: 'ביטול זמן', workHours: 0.5, kilometers: 2 })
      ]
    }),
    approval({
      id: 'no-file',
      employee_id: '1002',
      employee_name: 'עובד ב',
      pdf_path: '',
      rows: [snapshotRow({ employeeId: '1002', employeeName: 'עובד ב', activityType: 'קורס', workHours: 1, kilometers: 0 })]
    })
  ]);
  assert.equal(summarized.rows.length, 2);
  const first = summarized.rows.find((row) => row.employeeId === '1001');
  assert.equal(first.workDays, 5);
  assert.equal(first.hours.course, 2);
  assert.equal(first.hours.workshop, 3);
  assert.equal(first.hours.tour, 4);
  assert.equal(first.hours.training, 1);
  assert.equal(first.hours.operations, 2);
  assert.equal(first.hours.time_cancel, 0.5);
  assert.equal(first.kilometers, 15);
  assert.equal(first.hasFile, true);
  assert.match(first.notes, /בוקר/);
  const second = summarized.rows.find((row) => row.employeeId === '1002');
  assert.equal(second.hasFile, false);
  const html = attendanceHtml(summarized.rows);
  assert.match(html, /data-finance-file="1001"/);
  assert.doesNotMatch(html, /https:\/\/files\.example\/report\.pdf/);
  assert.doesNotMatch(html, /data-finance-file="1002"/);
});

function attendanceHtml(rows) {
  const data = createFinanceVisitState();
  data.view = 'attendance';
  data.attendanceByMonth = {
    [data.attendanceMonth]: {
      approvals: rows.map((row) => approval({
        employee_id: row.employeeId,
        employee_name: row.employeeName,
        pdf_path: row.hasFile ? 'https://x/a.pdf' : '',
        rows: [snapshotRow({ employeeId: row.employeeId, employeeName: row.employeeName })]
      }))
    }
  };
  return financeScreen.render(data, { state: { user: financeUser } });
}

test('unmapped approved activity types are identified and not arbitrarily bucketed', () => {
  assert.equal(financeHourCategory('חדר בריחה'), '');
  assert.equal(financeHourCategory('after_school'), '');
  assert.equal(financeHourCategory('סדנאות קיץ'), '');
  const types = unmappedFinanceActivityTypes([
    approval({
      rows: [
        snapshotRow({ activityType: 'חדר בריחה', workHours: 8 }),
        snapshotRow({ activityType: 'קורס', workHours: 2 })
      ]
    })
  ]);
  assert.deepEqual(types, ['חדר בריחה']);
  const summary = summarizeFinanceAttendance([
    approval({
      rows: [
        snapshotRow({ activityType: 'חדר בריחה', workHours: 8 }),
        snapshotRow({ activityType: 'קורס', workHours: 2 })
      ]
    })
  ]).rows[0];
  assert.equal(summary.hours.course, 2);
  assert.equal(summary.hours.workshop, 0);
});

test('Excel export uses the same summarized columns, one row per employee, and a file hyperlink', () => {
  const entries = summarizeFinanceAttendance([
    approval({
      pdf_path: 'https://files.example/doc.pdf',
      rows: [
        snapshotRow({ date: '2026-08-01', activityType: 'קורס', workHours: 2, kilometers: 4 }),
        snapshotRow({ date: '2026-08-01', activityType: 'קורס', workHours: 1, kilometers: 1 })
      ]
    })
  ]).rows;
  const excelRows = buildFinanceAttendanceExcelRows(entries);
  assert.deepEqual(Object.keys(excelRows[0]), FINANCE_ATTENDANCE_COLUMNS);
  assert.equal(excelRows.length, 1);
  assert.equal(excelRows[0]['ימי עבודה'], 1);
  assert.equal(excelRows[0]['קורס'], 3);
  assert.equal(excelRows[0]['סה״כ ק״מ'], 5);
  const workbook = buildFinanceAttendanceWorkbook(entries);
  const sheet = workbook.Sheets[FINANCE_ATTENDANCE_GENERAL_SHEET];
  const hyperlink = Object.values(sheet).find((cell) => cell?.l?.Target === 'https://files.example/doc.pdf');
  assert.ok(hyperlink);
});

function sheetAoa(workbook, name) {
  return XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true });
}

function sheetEmployeeNames(workbook, name) {
  return sheetAoa(workbook, name).slice(1).map((row) => row[1]);
}

test('Excel workbook keeps the general sheet and adds employment-type sheets with the same columns', () => {
  const entries = summarizeFinanceAttendance([
    approval({
      employee_id: '1',
      employee_name: 'עובדת תעשיידע',
      rows: [snapshotRow({ employeeId: '1', employeeName: 'עובדת תעשיידע', employmentType: 'תעשיידע', activityType: 'קורס', workHours: 2 })]
    }),
    approval({
      employee_id: '2',
      employee_name: 'עובד מעוף',
      pdf_path: 'https://files.example/maof.pdf',
      rows: [snapshotRow({ employeeId: '2', employeeName: 'עובד מעוף', employmentType: 'מעוף', activityType: 'סדנה', workHours: 3 })]
    }),
    approval({
      employee_id: '3',
      employee_name: 'עובד כוח אדם',
      rows: [snapshotRow({ employeeId: '3', employeeName: 'עובד כוח אדם', employmentType: 'Manpower', activityType: 'סיור', workHours: 4 })]
    }),
    approval({
      employee_id: '4',
      employee_name: 'לא מסווג',
      rows: [snapshotRow({ employeeId: '4', employeeName: 'לא מסווג', employmentType: 'אחר', activityType: 'תפעול', workHours: 1 })]
    })
  ]).rows;
  const workbook = buildFinanceAttendanceWorkbook(entries, { approvals: [
    approval({
      employee_id: '1',
      employee_name: 'עובדת תעשיידע',
      rows: [snapshotRow({ employeeId: '1', employeeName: 'עובדת תעשיידע', employmentType: 'תעשיידע', activityType: 'קורס', workHours: 2 })]
    }),
    approval({
      employee_id: '2',
      employee_name: 'עובד מעוף',
      pdf_path: 'https://files.example/maof.pdf',
      rows: [snapshotRow({
        employeeId: '2',
        employeeName: 'עובד מעוף',
        employmentType: 'מעוף',
        activityType: 'סדנה',
        workHours: 3,
        startTime: '10:00',
        endTime: '13:00',
        authority: 'רחובות'
      })]
    }),
    approval({
      employee_id: '3',
      employee_name: 'עובד כוח אדם',
      rows: [snapshotRow({ employeeId: '3', employeeName: 'עובד כוח אדם', employmentType: 'Manpower', activityType: 'סיור', workHours: 4 })]
    }),
    approval({
      employee_id: '4',
      employee_name: 'לא מסווג',
      rows: [snapshotRow({ employeeId: '4', employeeName: 'לא מסווג', employmentType: 'אחר', activityType: 'תפעול', workHours: 1 })]
    })
  ] });
  assert.deepEqual(workbook.SheetNames, [FINANCE_ATTENDANCE_GENERAL_SHEET, ...FINANCE_ATTENDANCE_EMPLOYMENT_SHEETS]);

  const general = sheetAoa(workbook, FINANCE_ATTENDANCE_GENERAL_SHEET);
  assert.deepEqual(general[0], FINANCE_ATTENDANCE_COLUMNS);
  assert.equal(general.length, 5);
  assert.deepEqual(sheetEmployeeNames(workbook, FINANCE_ATTENDANCE_GENERAL_SHEET).sort(), [
    'לא מסווג',
    'עובד כוח אדם',
    'עובד מעוף',
    'עובדת תעשיידע'
  ]);

  assert.deepEqual(sheetEmployeeNames(workbook, 'תעשיידע'), ['עובדת תעשיידע']);
  assert.deepEqual(sheetAoa(workbook, FINANCE_MAOF_SHEET)[0], FINANCE_MAOF_DAILY_COLUMNS);
  assert.deepEqual(sheetAoa(workbook, FINANCE_MAOF_SHEET).slice(1).map((row) => row[1]), ['עובד מעוף']);
  assert.deepEqual(sheetEmployeeNames(workbook, 'MANPOWER'), ['עובד כוח אדם']);
  const independent = sheetAoa(workbook, 'עצמאי');
  assert.deepEqual(independent, [FINANCE_ATTENDANCE_COLUMNS]);

  for (const name of workbook.SheetNames.filter((sheet) => sheet !== FINANCE_MAOF_SHEET)) {
    assert.deepEqual(sheetAoa(workbook, name)[0], FINANCE_ATTENDANCE_COLUMNS);
  }

  const generalLink = Object.values(workbook.Sheets[FINANCE_ATTENDANCE_GENERAL_SHEET]).find((cell) => cell?.l?.Target === 'https://files.example/maof.pdf');
  assert.ok(generalLink);
});

test('Excel employment sheets normalize employmentType spaces and letter case', () => {
  assert.equal(normalizeFinanceEmploymentType('  Man Power '), 'manpower');
  assert.equal(financeEmploymentSheetName('MANPOWER'), 'MANPOWER');
  assert.equal(financeEmploymentSheetName('Manpower'), 'MANPOWER');
  assert.equal(financeEmploymentSheetName(' manpower '), 'MANPOWER');
  assert.equal(financeEmploymentSheetName(' עצמאי '), 'עצמאי');
  assert.equal(financeEmploymentSheetName('אחר'), '');

  const entries = summarizeFinanceAttendance([
    approval({
      employee_id: '11',
      employee_name: 'א',
      rows: [snapshotRow({ employeeId: '11', employeeName: 'א', employmentType: 'MANPOWER' })]
    }),
    approval({
      employee_id: '12',
      employee_name: 'ב',
      rows: [snapshotRow({ employeeId: '12', employeeName: 'ב', employmentType: 'Manpower' })]
    }),
    approval({
      employee_id: '13',
      employee_name: 'ג',
      rows: [snapshotRow({ employeeId: '13', employeeName: 'ג', employmentType: '  man power  ' })]
    })
  ]).rows;
  const workbook = buildFinanceAttendanceWorkbook(entries);
  assert.deepEqual(sheetEmployeeNames(workbook, FINANCE_ATTENDANCE_GENERAL_SHEET).sort(), ['א', 'ב', 'ג']);
  assert.deepEqual(sheetEmployeeNames(workbook, 'MANPOWER').sort(), ['א', 'ב', 'ג']);
  assert.deepEqual(sheetAoa(workbook, 'תעשיידע'), [FINANCE_ATTENDANCE_COLUMNS]);
  assert.deepEqual(sheetAoa(workbook, FINANCE_MAOF_SHEET), [FINANCE_MAOF_DAILY_COLUMNS]);
  assert.deepEqual(sheetAoa(workbook, 'עצמאי'), [FINANCE_ATTENDANCE_COLUMNS]);
});

function maofRow(overrides = {}) {
  return snapshotRow({
    employeeId: '1234',
    employeeName: 'ישראל ישראלי',
    employmentType: 'מעוף',
    date: '2026-10-05',
    authority: 'רחובות',
    activityType: 'קורס',
    startTime: '10:00',
    endTime: '13:00',
    workHours: 3,
    kilometers: 0,
    ...overrides
  });
}

function maofApproval(rows, overrides = {}) {
  return approval({
    employee_id: '1234',
    employee_name: 'ישראל ישראלי',
    rows,
    ...overrides
  });
}

test('Maof Excel merges the same instructor date authority and activity type', () => {
  const rows = buildMaofDailyExcelRows([
    maofApproval([
      maofRow({ startTime: '10:00', endTime: '12:00', workHours: 2, kilometers: 10 }),
      maofRow({ startTime: '12:00', endTime: '15:00', workHours: 3, kilometers: 32 })
    ])
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]['שם מדריך'], 'ישראל ישראלי');
  assert.equal(rows[0]['מספר עובד'], '1234');
  assert.equal(rows[0]['רשות'], 'רחובות');
  assert.equal(rows[0]['סוג פעילות'], 'קורס');
  assert.equal(rows[0]['שעות פעילות'], '10:00–15:00');
  assert.equal(rows[0]['סה״כ שעות'], 5);
  assert.equal(rows[0]['סה״כ ק״מ ליום'], 42);
});

test('Maof Excel splits different activity types and authorities', () => {
  const rows = buildMaofDailyExcelRows([
    maofApproval([
      maofRow({ activityType: 'קורס', startTime: '10:00', endTime: '13:00', workHours: 3, kilometers: 20 }),
      maofRow({ activityType: 'הכשרה', startTime: '14:00', endTime: '16:00', workHours: 2, kilometers: 22 }),
      maofRow({ date: '2026-10-06', authority: 'רחובות', activityType: 'קורס', startTime: '09:00', endTime: '12:00', kilometers: 10 }),
      maofRow({ date: '2026-10-06', authority: 'ראשון לציון', activityType: 'קורס', startTime: '13:00', endTime: '15:00', kilometers: 26 })
    ])
  ]);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((row) => [row['תאריך'], row['רשות'], row['סוג פעילות'], row['שעות פעילות'], row['סה״כ שעות']]), [
    ['05.10.2026', 'רחובות', 'קורס', '10:00–13:00', 3],
    ['05.10.2026', 'רחובות', 'הכשרה', '14:00–16:00', 2],
    ['06.10.2026', 'רחובות', 'קורס', '09:00–12:00', 3],
    ['06.10.2026', 'ראשון לציון', 'קורס', '13:00–15:00', 2]
  ]);
});

test('Maof Excel merges consecutive hour ranges and keeps gapped ranges', () => {
  assert.deepEqual(mergeFinanceReportedTimeRanges([
    { start: '10:00', end: '12:00' },
    { start: '12:00', end: '15:00' }
  ]).map((range) => `${range.start}–${range.end}`), ['10:00–15:00']);
  assert.equal(formatFinanceReportedHourRanges([
    { start: '10:00', end: '12:00' },
    { start: '13:00', end: '15:00' }
  ]), '10:00–12:00, 13:00–15:00');

  const consecutive = buildMaofDailyExcelRows([
    maofApproval([
      maofRow({ startTime: '10:00', endTime: '12:00' }),
      maofRow({ startTime: '12:00', endTime: '15:00', kilometers: 0 })
    ])
  ]);
  assert.equal(consecutive[0]['שעות פעילות'], '10:00–15:00');
  assert.equal(consecutive[0]['סה״כ שעות'], 5);

  const gapped = buildMaofDailyExcelRows([
    maofApproval([
      maofRow({ date: '2026-10-06', authority: 'ראשון לציון', startTime: '09:00', endTime: '12:00', kilometers: 20 }),
      maofRow({ date: '2026-10-06', authority: 'ראשון לציון', startTime: '13:00', endTime: '15:00', kilometers: 16 })
    ])
  ]);
  assert.equal(gapped[0]['שעות פעילות'], '09:00–12:00, 13:00–15:00');
  assert.equal(gapped[0]['סה״כ שעות'], 5);
});

test('Maof Excel shows daily kilometers once per instructor date', () => {
  const rows = buildMaofDailyExcelRows([
    maofApproval([
      maofRow({ activityType: 'קורס', startTime: '10:00', endTime: '13:00', kilometers: 20 }),
      maofRow({ activityType: 'הכשרה', startTime: '14:00', endTime: '16:00', kilometers: 22 }),
      maofRow({ date: '2026-10-06', authority: 'ראשון לציון', startTime: '09:00', endTime: '12:00', kilometers: 10 }),
      maofRow({ date: '2026-10-06', authority: 'ראשון לציון', startTime: '13:00', endTime: '15:00', kilometers: 26 })
    ])
  ]);
  assert.deepEqual(rows.map((row) => [row['תאריך'], row['סוג פעילות'], row['סה״כ ק״מ ליום']]), [
    ['05.10.2026', 'קורס', 42],
    ['05.10.2026', 'הכשרה', ''],
    ['06.10.2026', 'קורס', 36]
  ]);
});

test('Maof Excel uses only final admin snapshots and keeps a header-only sheet', () => {
  const rows = buildMaofDailyExcelRows([
    maofApproval([maofRow()], { status: 'manager_approved' }),
    approval({
      employee_id: '9',
      employee_name: 'תעשיידעית',
      rows: [snapshotRow({ employeeId: '9', employeeName: 'תעשיידעית', employmentType: 'תעשיידע', activityType: 'קורס' })]
    })
  ]);
  assert.deepEqual(rows, []);
  const workbook = buildFinanceAttendanceWorkbook([], { approvals: [] });
  assert.deepEqual(sheetAoa(workbook, FINANCE_MAOF_SHEET), [FINANCE_MAOF_DAILY_COLUMNS]);
});

test('collection grouping uses school for GEFEN, specific authority for רשות, and funding source otherwise', () => {
  const rows = attachCollectionTracking([
    activity({ row_id: 'G1', school: 'בית ספר הרצל', school_id: 's1', funding: 'גפן', activity_name: 'קורס' }),
    activity({ row_id: 'G2', school: 'בי"ס הרצל', school_id: 's1', funding: "גפ'ן", activity_name: 'סדנה', price: 500 }),
    activity({ row_id: 'A1', funding: 'רשות', authority: 'עיריית רחובות', authority_id: 'r1', school: 'אחר', price: 200 }),
    activity({ row_id: 'A2', funding: 'רשות', authority: 'עיריית רחובות ', authority_id: 'r1', school: 'שני', price: 300 }),
    activity({ row_id: 'F1', funding: 'משרד החינוך', funding_id: 'fund-1', price: 80 }),
    activity({ row_id: 'F2', funding: 'משרד החינוך ', funding_id: 'fund-1', price: 20 }),
    activity({ row_id: 'U1', funding: '', activity_name: 'ללא מימון', price: 10 })
  ], []);
  const all = groupFinanceCollectionPayers(rows, { tab: 'all' });
  const gefen = all.find((group) => group.kind === 'school');
  const authority = all.find((group) => group.kind === 'authority');
  const other = all.find((group) => group.kind === 'funding');
  const unfunded = all.find((group) => group.kind === 'unfunded');
  assert.equal(gefen.activityCount, 2);
  assert.equal(gefen.label, 'בית ספר הרצל');
  assert.equal(authority.label, 'עיריית רחובות');
  assert.equal(authority.activityCount, 2);
  assert.equal(other.activityCount, 2);
  assert.equal(unfunded.label, 'ללא גורם מימון');
  assert.equal(isGefenFunding('גפ״ן'), true);
  assert.equal(financePayerKey(activity({ funding: 'רשות', authority: 'עיריית רחובות' })).label, 'עיריית רחובות');
});

test('ids prevent duplicate payer cards when names differ', () => {
  const payers = groupFinanceCollectionPayers([
    activity({ row_id: '1', school: 'הרצל', school_id: '77', funding: 'גפ״ן' }),
    activity({ row_id: '2', school: 'ביה״ס הרצל', school_id: '77', funding: 'גפן' })
  ], { tab: 'all' });
  assert.equal(payers.length, 1);
});

test('finance payer key uses stable ids so spelling variants do not split groups', () => {
  const bySchoolId = financePayerKey(activity({ school_id: 77, school: 'הרצל', funding: 'גפן' }));
  const bySchoolIdVariant = financePayerKey(activity({ school_id: '77', school: 'ביה״ס הרצל', funding: 'גפ״ן' }));
  assert.equal(bySchoolId.key, 'school:id:77');
  assert.equal(bySchoolId.key, bySchoolIdVariant.key);

  const byAuthorityId = financePayerKey(activity({ authority_id: 'r1', authority: 'עיריית רחובות', funding: 'רשות' }));
  const byAuthorityVariant = financePayerKey(activity({ authority_id: 'r1', authority: 'עיריית רחובות ', funding: 'רשות' }));
  assert.equal(byAuthorityId.key, 'authority:id:r1');
  assert.equal(byAuthorityId.key, byAuthorityVariant.key);

  const byFundingId = financePayerKey(activity({ funding_id: 'f1', funding: 'משרד החינוך' }));
  const byFundingVariant = financePayerKey(activity({ funding_id: 'f1', funding: 'משרד  החינוך' }));
  assert.equal(byFundingId.key, 'funding:id:f1');
  assert.equal(byFundingId.key, byFundingVariant.key);

  const payers = groupFinanceCollectionPayers([
    activity({ row_id: '1', school_id: '77', school: 'הרצל', funding: 'גפן', end_date: '2027-04-01' }),
    activity({ row_id: '2', school_id: '77', school: 'ביה״ס הרצל', funding: 'גפ״ן', end_date: '2027-04-02' })
  ], { tab: 'all' });
  assert.equal(payers.length, 1);
  assert.equal(payers[0].activityCount, 2);
});

test('collection search debounces list filtering without recreating the input', async () => {
  const api = mockApi({
    activities: [
      activity({ row_id: 'S1', activity_name: 'קורס רחובות', end_date: '2027-04-10', authority: 'עיריית רחובות' }),
      activity({ row_id: 'S2', activity_name: 'סדנה אחרת', end_date: '2027-04-11', authority: 'ראשון לציון' })
    ]
  });
  const data = createFinanceVisitState();
  const { host, window } = mount(data, { api });
  host.querySelector('[data-finance-open="collection"]').click();
  await flush();
  await flush();
  const input = host.querySelector('[data-finance-collection-search]');
  assert.ok(input);
  input.focus();
  input.value = 'רחובות';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(host.querySelector('[data-finance-collection-search]'), input);
  assert.equal(window.document.activeElement, input);
  await new Promise((resolve) => setTimeout(resolve, 280));
  assert.equal(host.querySelector('[data-finance-collection-search]'), input);
  assert.match(host.querySelector('[data-finance-collection-body]')?.innerHTML || '', /קורס רחובות/);
  assert.doesNotMatch(host.querySelector('[data-finance-collection-body]')?.innerHTML || '', /סדנה אחרת/);
});

test('activity without tracking defaults to open and closed collection is hidden from the open tab', () => {
  const merged = attachCollectionTracking(
    [
      activity({ row_id: 'OPEN-1', status: 'סגורה' }),
      activity({ row_id: 'CLOSED-1', activity_name: 'נגבה' })
    ],
    [{ activity_row_id: 'CLOSED-1', collection_status: 'closed' }]
  );
  assert.equal(merged[0].collection_status, 'open');
  assert.equal(merged[1].collection_status, 'closed');
  const openTab = groupFinanceCollectionPayers(merged, { tab: 'open' });
  const allTab = groupFinanceCollectionPayers(merged, { tab: 'all' });
  assert.equal(openTab.length, 1);
  assert.equal(openTab[0].activities[0].row_id, 'OPEN-1');
  assert.equal(allTab.reduce((sum, group) => sum + group.activityCount, 0), 2);
  assert.ok(openTab[0].activities[0].status === 'סגורה');
});

test('collection end-month grouping uses end date or latest meeting and keeps each activity once', () => {
  const rows = attachCollectionTracking([
    activity({ row_id: 'A1', end_date: '2027-06-15', price: 100 }),
    activity({ row_id: 'A2', end_date: '', date_1: '2027-03-01', date_2: '2027-05-20', price: 200 }),
    activity({ row_id: 'A3', end_date: '', price: 50 })
  ], []);
  assert.equal(financeActivityEndDate(rows[0]), '2027-06-15');
  assert.equal(financeActivityEndDate(rows[1]), '2027-05-20');
  assert.equal(financeActivityEndMonthKey(rows[2]), FINANCE_NO_END_DATE_MONTH_KEY);

  const months = groupFinanceCollectionByEndMonth(rows, { tab: 'all' });
  assert.deepEqual(months.map((month) => month.monthKey), ['2027-06', '2027-05', FINANCE_NO_END_DATE_MONTH_KEY]);
  const allIds = months.flatMap((month) => month.payers.flatMap((payer) => payer.activities.map((row) => row.row_id)));
  assert.deepEqual(allIds.sort(), ['A1', 'A2', 'A3']);

  const moved = attachCollectionTracking([
    activity({ row_id: 'A1', end_date: '2027-08-01', price: 100 })
  ], []);
  assert.equal(financeActivityEndMonthKey(moved[0]), '2027-08');
});

test('collection tabs and search filter together by end month and payer grouping', () => {
  const rows = attachCollectionTracking([
    activity({ row_id: 'O1', end_date: '2027-04-10', authority: 'עיריית רחובות', price: 100 }),
    activity({ row_id: 'C1', end_date: '2027-04-20', authority: 'עיריית רחובות', price: 200 }),
    activity({ row_id: 'O2', end_date: '2027-05-01', authority: 'ראשון לציון', price: 300 })
  ], [{ activity_row_id: 'C1', collection_status: 'closed' }]);

  const openMonths = groupFinanceCollectionByEndMonth(rows, { tab: 'open' });
  assert.deepEqual(openMonths.map((month) => month.monthKey), ['2027-05', '2027-04']);
  assert.deepEqual(openMonths.flatMap((month) => month.payers.flatMap((payer) => payer.activities.map((row) => row.row_id))).sort(), ['O1', 'O2']);

  const closedMonths = groupFinanceCollectionByEndMonth(rows, { tab: 'closed' });
  assert.deepEqual(closedMonths.map((month) => month.monthKey), ['2027-04']);
  assert.deepEqual(closedMonths[0].payers[0].activities.map((row) => row.row_id), ['C1']);

  const searched = groupFinanceCollectionByEndMonth(rows, { tab: 'closed', search: 'רחובות' });
  assert.equal(searched.length, 1);
  assert.equal(searched[0].payers[0].activities[0].row_id, 'C1');
  assert.deepEqual(filterFinanceCollectionActivities(rows, { tab: 'open', search: 'ראשון' }).map((row) => row.row_id), ['O2']);
  assert.match(financeCollectionSearchHaystack(rows[0]), /רחובות/);
});

test('collection summary cards total open and closed without double counting', () => {
  const rows = attachCollectionTracking([
    activity({ row_id: '1', price: 100 }),
    activity({ row_id: '2', price: 250 }),
    activity({ row_id: '3', price: 150 })
  ], [{ activity_row_id: '2', collection_status: 'closed' }]);
  const totals = summarizeFinanceCollectionTotals(rows);
  assert.equal(totals.totalAmount, 500);
  assert.equal(totals.openAmount, 250);
  assert.equal(totals.closedAmount, 250);
  assert.equal(totals.totalAmount, totals.openAmount + totals.closedAmount);
});

test('collection UI keeps a compact centered shell with summary cards search and three tabs', () => {
  const html = financeScreen.render({
    ...createFinanceVisitState(),
    view: 'collection',
    collectionActivities: [
      activity({ row_id: 'UI-1', end_date: '2027-07-01', authority: 'עיריית רחובות' })
    ],
    collectionTracking: [],
    collectionTab: 'open',
    collectionSearch: ''
  }, { state: { user: financeUser } });
  assert.match(html, /ds-fin-collect-shell/);
  assert.match(html, /ds-fin-collect-shell[\s\S]*ds-fin-backbar/);
  assert.match(html, /סכום כל הפעילויות/);
  assert.match(html, /סה״כ לגבייה/);
  assert.match(html, /סה״כ גבייה שבוצעה/);
  assert.match(html, /data-finance-collection-search/);
  assert.match(html, /data-finance-collection-tab="closed"/);
  assert.match(html, /ds-fin-collect-month/);
  assert.doesNotMatch(html, /פעילויות לפי משלם/);
  assert.equal([...html.matchAll(/מעקב גבייה/g)].length, 1);
});

test('collection keeps payer grouping inside each end month section', () => {
  const rows = attachCollectionTracking([
    activity({ row_id: 'G1', end_date: '2027-04-10', school: 'הרצל', school_id: '77', funding: 'גפן' }),
    activity({ row_id: 'G2', end_date: '2027-04-12', school: 'הרצל', school_id: '77', funding: 'גפן' }),
    activity({ row_id: 'A1', end_date: '2027-04-15', funding: 'רשות', authority: 'רחובות', authority_id: 'r1' })
  ], []);
  const [month] = groupFinanceCollectionByEndMonth(rows, { tab: 'all' });
  assert.equal(month.monthKey, '2027-04');
  assert.equal(month.payers.length, 2);
  assert.equal(month.payers.find((payer) => payer.kind === 'school').activityCount, 2);
});

test('orphan tracking rows are not shown as activities', () => {
  const merged = attachCollectionTracking(
    [activity({ row_id: 'LIVE' })],
    [{ activity_row_id: 'GONE', collection_status: 'open', finance_note: 'יתום' }]
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].row_id, 'LIVE');
  const html = financeScreen.render({
    ...createFinanceVisitState(),
    view: 'collection',
    collectionActivities: [activity({ row_id: 'LIVE' })],
    collectionTracking: [{ activity_row_id: 'GONE', collection_status: 'open' }],
    collectionTab: 'all'
  }, { state: { user: financeUser } });
  assert.doesNotMatch(html, /יתום|GONE/);
  assert.match(html, /קורס רובוטיקה/);
});

test('collection status, date, and note are saved and visible after reload from tracking', async () => {
  const api = mockApi({ activities: [activity({ row_id: 'SAVE-1' })] });
  const data = createFinanceVisitState();
  const { host } = mount(data, { api });
  host.querySelector('[data-finance-open="collection"]').click();
  await flush();
  host.querySelector('[data-finance-collection-tab="all"]').click();
  await flush();
  const status = host.querySelector('[data-fin-collect-field="collection_status"]');
  status.value = 'closed';
  status.dispatchEvent(new host.ownerDocument.defaultView.Event('change', { bubbles: true }));
  await flush();
  assert.equal(api.counts.upsertFinanceCollectionTracking, 1);
  assert.match(host.innerHTML, /נשמר/);
  const reloaded = attachCollectionTracking([activity({ row_id: 'SAVE-1' })], api.store);
  assert.equal(reloaded[0].collection_status, 'closed');
});

test('backend collection RPCs and RLS require finance access, including admin', () => {
  assert.match(migration, /create table if not exists public\.finance_collection_tracking/);
  assert.match(migration, /activity_row_id text not null/);
  assert.match(migration, /collection_status text not null default 'open'/);
  assert.match(migration, /expected_collection_date date/);
  assert.match(migration, /finance_note text not null default ''/);
  const tableBlock = String(migration.match(/create table if not exists public\.finance_collection_tracking \(([\s\S]*?)\);/)?.[1] || '');
  assert.match(tableBlock, /activity_row_id/);
  assert.doesNotMatch(tableBlock, /activity_name|school_name|authority_name|\bprice\b|\bfunding\b|activity_type/);
  assert.match(migration, /app_current_role\(\)[\s\S]*'admin'[\s\S]*'finance'/);
  assert.match(migration, /app_has_permission\('finance_access'\)/);
  assert.match(migration, /raise exception 'finance_permission_denied'/);
  assert.match(migration, /using \(\(select public\.app_can_access_finance\(\)\)\)/);
  assert.match(apiSource, /rpc\('list_finance_collection_tracking'\)/);
  assert.match(apiSource, /rpc\('upsert_finance_collection_tracking'/);
  assert.doesNotMatch(financeSource, /payment_collected/);
  assert.equal(mapLegacyPaymentCollected('yes'), 'closed');
  assert.equal(mapLegacyPaymentCollected('נגבה'), 'closed');
  assert.equal(mapLegacyPaymentCollected(''), 'open');
});

test('team is filled from the existing employee mapping when the snapshot has no team', () => {
  const [row] = summarizeFinanceAttendance([
    approval({ rows: [snapshotRow({ team: '' })] })
  ], { employees: [{ employeeId: '1001', team: 'צוות צפון' }] }).rows;
  assert.equal(row.team, 'צוות צפון');
  assert.equal(row.employmentType, 'תעשיידע');
});

test('date and note collection fields save, and a failed save does not keep the uncommitted UI value', async () => {
  const api = mockApi({ activities: [activity({ row_id: 'SAVE-2' })] });
  api.upsertFinanceCollectionTracking = async (payload) => {
    api.counts.upsertFinanceCollectionTracking += 1;
    if (payload.finance_note === 'רע') throw new Error('שמירה נכשלה');
    const next = {
      activity_row_id: payload.activity_row_id,
      collection_status: payload.collection_status,
      expected_collection_date: payload.expected_collection_date,
      finance_note: payload.finance_note
    };
    api.store.splice(0, api.store.length, next);
    return next;
  };
  const data = createFinanceVisitState();
  const { host } = mount(data, { api });
  host.querySelector('[data-finance-open="collection"]').click();
  await flush();
  const date = host.querySelector('[data-fin-collect-field="expected_collection_date"]');
  date.value = '2026-09-15';
  date.dispatchEvent(new host.ownerDocument.defaultView.Event('change', { bubbles: true }));
  await flush();
  const note = host.querySelector('[data-fin-collect-field="finance_note"]');
  note.value = 'לתזכורת';
  note.dispatchEvent(new host.ownerDocument.defaultView.Event('change', { bubbles: true }));
  await flush();
  const reloaded = attachCollectionTracking([activity({ row_id: 'SAVE-2' })], api.store);
  assert.equal(reloaded[0].expected_collection_date, '2026-09-15');
  assert.equal(reloaded[0].finance_note, 'לתזכורת');
  const failing = host.querySelector('[data-fin-collect-field="finance_note"]');
  failing.value = 'רע';
  failing.dispatchEvent(new host.ownerDocument.defaultView.Event('change', { bubbles: true }));
  await flush();
  assert.match(host.innerHTML, /שמירה נכשלה/);
  const afterFail = attachCollectionTracking([activity({ row_id: 'SAVE-2' })], api.store);
  assert.equal(afterFail[0].finance_note, 'לתזכורת');
  assert.match(host.querySelector('[data-fin-collect-field="finance_note"]').value, /לתזכורת/);
});

test('admin users retain finance access', () => {
  assert.equal(canAccessFinance({ role: 'admin', finance_access: false }), true);
  assert.equal(canAccessFinance(blockedUser), false);
});
