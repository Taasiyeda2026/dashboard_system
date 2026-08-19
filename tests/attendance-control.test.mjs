import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  attendanceControlHtml, resultsHtml, normalizeAttendanceName, calculateWorkHours,
  buildDashboardAttendanceRows, attendanceDateScope, loadAttendanceDashboardDataset,
  attendanceMonthLabel, filterAttendanceRowsByMonth, attendanceExportFilename,
  attendanceMonthDateRange,
  applyDashboardRouteKilometers, applyDashboardExpenses, compareAttendanceRows, applyAttendanceChoice,
  buildCorrectedAttendanceWorkbook, parseAttendanceWorkbook, attendanceAuditSummary, aggregateDashboardAttendanceRows,
  normalizeAttendanceApiRows, attendanceTeams, DETAIL_HEADERS, MONTHLY_HEADERS, DAILY_HEADERS, rowWorkHours,
  parseMeetingNumberList, attendanceEntryIsResolved, approveAttendanceEntryAsReported, applyAttendanceManualCorrection,
  resolvePayrollMonthWorkflow,
  kmDayNeedsDecision, resolveKilometersDay
} from '../frontend/src/screens/attendance-control.js';
import {
  buildPayrollIdentityContext,
  resolveSchoolIdForAuthority
} from '../frontend/src/screens/payroll-control-identity.js';
import {
  approvePayrollControlEmployee,
  buildAttendanceUpdatePayload,
  buildPayrollApprovalPrintHtml,
  buildPayrollApprovedSnapshot,
  canExportPayrollApprovals,
  canReadPayrollApprovals,
  collectChangedAttendanceUpdates,
  collectKmCorrectionUpdates,
  downloadPayrollApprovalsExcel,
  payrollApprovalPdfFileName,
  payrollEmployeeHasUnresolvedEntries,
  payrollHebrewMonthName
} from '../frontend/src/screens/payroll-control-finish.js';
import { readFile } from 'node:fs/promises';

test('payroll control opening screen uses direct monthly sources and no workbook upload', () => {
  const html = attendanceControlHtml();
  assert.match(html, /חודש בקרה/);
  assert.match(html, /צוות/);
  assert.match(html, /אישור בקרת נוכחות/);
  assert.equal((html.match(/type="file"/g) || []).length, 0);
  assert.doesNotMatch(html, /data-attendance-dashboard/);
  assert.match(html, /data-attendance-month/);
  assert.doesNotMatch(html, /data-dashboard-month/);
  assert.match(html, /data-attendance-run disabled/);
});

test('attendance API records are normalized into the existing comparison shape', () => {
  assert.deepEqual(normalizeAttendanceApiRows([{
    ID: 7, employeeId: '1501', employeeName: 'מדריכה', attendanceDate: '2026-07-03',
    startTime: '08:00', endTime: '09:00', workHours: 1, activityType: 'סדנה', Team: { Value: 'צוות א' }
  }])[0], {
    employeeId: '1501', employeeName: 'מדריכה', employmentType: '', team: 'צוות א', date: '2026-07-03',
    startTime: '08:00', endTime: '09:00', workHours: 1, activityType: 'סדנה', school: '', authority: '',
    program: '', meetingNo: '', kilometers: null, expenses: null, expenseDetails: '', notes: '', activityId: '',
    _source: {
      ID: 7, employeeId: '1501', employeeName: 'מדריכה', attendanceDate: '2026-07-03',
      startTime: '08:00', endTime: '09:00', workHours: 1, activityType: 'סדנה', Team: { Value: 'צוות א' }
    }
  });
});

test('team choices use manager names supplied by the attendance employee source', () => {
  const teams = attendanceTeams([
    { employeeId: '10', EmployeeName: 'מנהלת א', role: 'manager', Team: { Value: 'צוות א' } },
    { employeeId: '11', EmployeeName: 'מנהלת ב', role: 'manager', Team: 'צוות ב' }
  ]);
  assert.deepEqual(teams, [{ id: 'צוות א', managerName: 'מנהלת א' }, { id: 'צוות ב', managerName: 'מנהלת ב' }]);
});

test('attendance control cannot run without an explicitly selected month', () => {
  assert.throws(() => filterAttendanceRowsByMonth([], ''), /יש לבחור חודש לבדיקה/);
});

test('selecting July excludes August attendance rows', () => {
  const rows = filterAttendanceRowsByMonth([{ employeeId: '10', date: '2026-07-31' }, { employeeId: '10', date: '2026-08-01' }], '2026-07');
  assert.deepEqual(rows.map((row) => row.date), ['2026-07-31']);
});

test('July title and export name use the explicitly selected month', () => {
  assert.equal(attendanceMonthLabel('2026-07'), 'יולי 2026');
  assert.deepEqual(attendanceMonthDateRange('2026-02'), { fromDate: '2026-02-01', toDate: '2026-02-28' });
  assert.deepEqual(attendanceMonthDateRange('2024-02'), { fromDate: '2024-02-01', toDate: '2024-02-29' });
  assert.deepEqual(attendanceMonthDateRange(''), { fromDate: '', toDate: '' });
  assert.equal(attendanceExportFilename('2026-07'), 'דוח_נוכחות_מתוקן_יולי_2026.xlsx');
  assert.match(attendanceControlHtml(), /data-attendance-title>בקרת נוכחות/);
});

test('a workbook without July attendance produces the clear selected-month message', () => {
  const rows = filterAttendanceRowsByMonth([{ employeeId: '10', date: '2026-08-01' }], '2026-07');
  assert.equal(rows.length, 0);
  assert.equal(`לא נמצאו דיווחי נוכחות עבור ${attendanceMonthLabel('2026-07')}`, 'לא נמצאו דיווחי נוכחות עבור יולי 2026');
});

test('attendance normalization tolerates punctuation, quotes, spacing and common suffixes', () => {
  assert.equal(normalizeAttendanceName(' רמב״ם '), normalizeAttendanceName('רמבם'));
  // "מאיר" is no longer stripped globally; "גולדה מאיר" must remain distinct from "גולדה"
  assert.notEqual(normalizeAttendanceName('גולדה מאיר'), normalizeAttendanceName('גולדה'));
});

test('dashboard dataset scope comes only from actual attendance detail dates and employees', async () => {
  const attendance = [{ employeeId: '10', date: '2026-07-02' }, { employeeId: '10', date: '2026-07-09' }];
  assert.deepEqual({ ...attendanceDateScope(attendance), dates: [...attendanceDateScope(attendance).dates] }, { employeeIds: ['10'], dates: ['2026-07-02', '2026-07-09'], fromDate: '2026-07-02', toDate: '2026-07-09' });
  let requested;
  const rows = await loadAttendanceDashboardDataset(attendance, { attendanceControlDashboardSources: async (scope) => {
    requested = scope;
    return { activities: [{ row_id: 'A', emp_id: '10', instructor_name: 'דנה', school_id: 1, activity_name: 'קורס', start_time: '08:00', end_time: '09:00', meetings: [{ date: '2026-07-02', meeting_no: 1 }, { date: '2026-08-02', meeting_no: 2 }] }], contacts: [{ emp_id: '10', full_name: 'דנה', employment_type: 'תעשיידע' }], travelCache: [], expenses: [] };
  } });
  assert.equal(requested.fromDate, '2026-07-02');
  assert.equal(rows.filter((row) => !row.__profile).length, 1);
  assert.equal(rows.find((row) => row.__profile).employmentType, 'תעשיידע');
});

test('dashboard dataset request is limited to all of July and July attendance employees', async () => {
  const attendance = [{ employeeId: '10', date: '2026-07-12' }];
  let requested;
  const rows = await loadAttendanceDashboardDataset(attendance, { attendanceControlDashboardSources: async (scope) => {
    requested = scope;
    return { activities: [{ row_id: 'A', emp_id: '10', meetings: [{ date: '2026-07-01' }, { date: '2026-08-01' }] }, { row_id: 'B', emp_id: '99', meetings: [{ date: '2026-07-02' }] }], contacts: [], travelCache: [], expenses: [] };
  } }, '2026-07');
  assert.deepEqual(requested.employeeIds, ['10']);
  assert.equal(requested.fromDate, '2026-07-01');
  assert.equal(requested.toDate, '2026-07-31');
  assert.deepEqual(rows.map((row) => row.date), ['2026-07-01']);
});

test('dashboard meetings expand for both assigned instructors', () => {
  const rows = buildDashboardAttendanceRows([{ row_id: 'ACT-1', emp_id: '10', instructor_name: 'דנה', emp_id_2: '11', instructor_name_2: 'נועם', meetings: [{ date: '2026-08-01', meeting_no: 1 }, { date: '2026-08-08', meeting_no: 2 }] }], [{ emp_id: '10', employment_type: 'תעשיידע' }, { emp_id: '11', employment_type: 'כוח אדם' }]);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((row) => row.meetingNo), [1, 1, 2, 2]);
});

test('May payroll receives and matches a regular activity even while the global period is school 2027', async () => {
  const attendance = [{
    employeeId: '1522', employeeName: 'אביב בלנדר', date: '2026-05-03',
    startTime: '08:00', endTime: '10:00', activityType: 'קורס',
    program: 'ביומימיקרי', school: 'תל-חי', authority: 'קריית שמונה'
  }];
  let requestedScope;
  const dashboardRows = await loadAttendanceDashboardDataset(attendance, {
    attendanceControlDashboardSources: async (scope) => {
      requestedScope = scope;
      return {
        activities: [{
          row_id: 'LONG-105', emp_id: '1522', instructor_name: 'אביב בלנדר',
          school: 'תל-חי', authority: 'קריית שמונה', activity_name: 'ביומימיקרי',
          activity_type: 'course', activity_season: 'regular', date_2: '2026-05-03',
          start_time: '08:00', end_time: '09:40'
        }],
        contacts: [], travelCache: [], expenses: []
      };
    }
  }, '2026-05');

  assert.deepEqual(requestedScope, {
    employeeIds: ['1522'], dates: new Set(['2026-05-03']),
    fromDate: '2026-05-01', toDate: '2026-05-31'
  });
  assert.equal(dashboardRows.length, 1);
  assert.equal(dashboardRows[0].activityId, 'LONG-105');
  assert.equal(dashboardRows[0].date, '2026-05-03');
  const result = compareAttendanceRows(attendance, dashboardRows);
  assert.equal(result.comparisons[0].unmatched, false);
});

test('LONG-073 real Oshri Ram case preserves double meetings and exposes the real differences', () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['מספר עובד', 'שם עובד', 'תאריך', 'שעת התחלה', 'שעת סיום', 'סוג פעילות', 'שם בית ספר', 'רשות', 'שם תכנית'],
    ['1524', 'אושרי רם', new Date(2026, 4, 25), '09:50', '11:20', 'קורס', 'טשרניחובסקי', 'נתניה', 'יישומי AI'],
    ['1524', 'אושרי רם', new Date(2026, 4, 18), '09:50', '11:20', 'קורס', 'טשרניחובסקי', 'נתניה', 'יישומי AI'],
    ['1524', 'אושרי רם', new Date(2026, 4, 11), '09:50', '11:20', 'קורס', 'טשרניחובסקי', 'נתניה', 'יישומי AI']
  ], { cellDates: true });
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, 'פירוט מלא');
  assert.deepEqual(parseAttendanceWorkbook(workbook).map((row) => row.date), ['2026-05-25', '2026-05-18', '2026-05-11']);

  const rows = buildDashboardAttendanceRows([{
    row_id: 'LONG-073', emp_id: '1524', emp_id_2: '',
    instructor_name: 'אושרי רם', start_time: '08:00', end_time: '09:30',
    activity_name: 'יישומי AI', school: 'טשרניחובסקי', authority: 'נתניה', activity_type: 'course', notes: '4/5 שני מפגשים.',
    date_5: '2026-05-04', date_6: '2026-05-04'
  }]);
  assert.equal(rows.length, 2, 'both intentional meetings remain');
  const aggregated = aggregateDashboardAttendanceRows(rows);
  assert.equal(aggregated.length, 1);
  assert.equal(aggregated[0].meetingCount, 2);
  // 2 meetings × 1.5h clock = 3h raw; after 45-min teaching-unit compensation (×4/3) = 4h payroll.
  assert.equal(aggregated[0].workHours, 4);
  assert.deepEqual(aggregated[0].meetingNumbers, ['5', '6']);
  const result = compareAttendanceRows([{
    employeeId: '1524', employeeName: 'אושרי רם', date: '2026-05-04', startTime: '08:00', endTime: '12:00', workHours: 4,
    program: 'יישומי AI', school: 'אלתרמן', authority: 'נתניה', activityType: 'קורס', meetingNo: '5'
  }], rows);
  const totals = attendanceAuditSummary(result);
  assert.equal(result.comparisons[0].unmatched, false);
  // workHours is no longer a diff because attendance(4h) == compensated-dashboard(4h).
  assert.deepEqual(result.comparisons[0].differences.map((difference) => difference.key), ['school', 'meetingNo']);
  assert.deepEqual({ before: totals.dashboardRowsBeforeProcessing, after: totals.dashboardRows, hours: totals.dashboardHours }, { before: 2, after: 1, hours: 4 });
});

test('duplicate emp_id and emp_id_2 is removed without removing meetings', () => {
  const rows = buildDashboardAttendanceRows([{ row_id: 'DUP-INSTRUCTOR', emp_id: '1524', emp_id_2: '1524', date_1: '2026-05-04', start_time: '08:00', end_time: '09:30' }]);
  assert.equal(rows.length, 1);
});

test('Hebrew and canonical activity types compare as the same activity type', () => {
  for (const [attendanceType, dashboardType] of [['קורס', 'course'], ['סיור', 'tour'], ['סדנה', 'workshop']]) {
    const base = { employeeId: '10', date: '2026-05-04', startTime: '08:00', endTime: '09:00', school: 'אלתרמן', activityType: attendanceType };
    const comparison = compareAttendanceRows([base], [{ ...base, activityType: dashboardType }]).comparisons[0];
    assert.equal(comparison.unmatched, false);
    assert.equal(comparison.differences.some((difference) => difference.key === 'activityType'), false);
  }
});

test('May non-activity reports stay in export but not in activity exceptions or hours gap', () => {
  const makeRows = (count, activityType, totalHours, offset) => Array.from({ length: count }, (_, index) => ({
    employeeId: '1524', employeeName: 'אושרי רם', date: `2026-05-${String((index % 28) + 1).padStart(2, '0')}`,
    startTime: '08:00', endTime: '08:00', workHours: index === 0 ? totalHours : 0,
    activityType, program: `${activityType}-${offset + index}`
  }));
  const attendance = [
    ...makeRows(172, 'קורס', 391.6, 0),
    ...makeRows(65, 'ביטול זמן', 96.4, 200),
    ...makeRows(23, 'הכשרה', 22.9, 300),
    ...makeRows(1, 'תפעול', 2, 400)
  ];
  const result = compareAttendanceRows(attendance, []); const totals = attendanceAuditSummary(result);
  assert.deepEqual({ rows: totals.attendanceRows, comparable: totals.comparableAttendanceRows, savedOnly: totals.notComparedRows }, { rows: 261, comparable: 172, savedOnly: 89 });
  assert.deepEqual({ comparable: totals.attendanceHours, savedOnly: totals.notComparedHours, total: totals.totalReportedHours, gap: totals.hours }, { comparable: 391.6, savedOnly: 121.3, total: 512.9, gap: 391.6 });
  assert.equal(totals.unmatchedAttendance, 172);
  const workbook = buildCorrectedAttendanceWorkbook([...result.comparisons, ...result.notCompared], result.dashboardPopulation);
  const detail = XLSX.utils.sheet_to_json(workbook.Sheets['פירוט מלא'], { header: 1 });
  assert.equal(detail.length - 1, 261);
  assert.equal(Math.round(detail.slice(1).reduce((sum, row) => sum + Number(row[5] || 0), 0) * 10) / 10, 512.9);
  const html = resultsHtml(result);
  assert.equal((html.match(/class="attendance-control__employee"/g) || []).length, 1, 'one instructor accordion is rendered');
  assert.equal((html.match(/class="attendance-control__day"/g) || []).length, 28, 'one day row groups all reports from the same date');
  assert.match(html, /class="attendance-control__reports"/, 'attendance-only reports stay in the chronological day sequence');
  assert.equal((html.match(/attendance-control__manual-table/g) || []).length, 261, 'every manual and unmatched report renders compact data');
  assert.match(html, /attendance-control__manual-table[\s\S]*<th>שעות שכר<\/th>/, 'manual reports use the compact reported-data table');
  assert.match(html, /\| הכשרה<\/strong>/, 'manual activity types are displayed without approval wording');
  assert.doesNotMatch(html, /נוכחות בלבד|נדרש טיפול לפני תשלום|נדרש אישור ידני/, 'the view does not add technical payment or attendance-only copy');
  assert.doesNotMatch(html, /<span>ימים <b>/, 'the top summary does not include a days metric');
});


test('payroll view groups reports by work day and compares daily kilometers', () => {
  const base = { employeeId: '77', employeeName: 'ברקת קטעי', date: '2027-01-03', activityType: 'קורס', school: 'בית ספר X', authority: 'רחובות' };
  const result = compareAttendanceRows([
    { ...base, startTime: '09:00', endTime: '10:00', workHours: 1, kilometers: 30, program: 'תוכנית א' },
    { ...base, startTime: '10:00', endTime: '11:00', workHours: 1, kilometers: 0, activityType: 'הכשרה', program: 'הכשרה' }
  ], [{ ...base, startTime: '09:00', endTime: '10:00', workHours: 1, kilometers: 24, program: 'תוכנית א' }]);
  const html = resultsHtml(result);
  assert.equal((html.match(/class="attendance-control__employee"/g) || []).length, 1);
  assert.equal((html.match(/class="attendance-control__day"/g) || []).length, 1, 'same-date reports share one day row');
  assert.match(html, /ק״מ מדווח: 30[\s\S]*ק״מ מחושב: 24/, 'daily kilometers are compared at day level');
  assert.match(html, /09:00–10:00[\s\S]*10:00–11:00/, 'reports are ordered by start time');
  assert.doesNotMatch(html, /נוכחות בלבד|נדרש אישור ידני/);
});

test('unmatched attendance explicitly marks the missing dashboard source without false valid fields', () => {
  const attendance = { employeeId: 'missing', employeeName: 'מדריכה', date: '2026-05-03', startTime: '10:00', endTime: '12:00', workHours: 2, kilometers: 58, activityType: 'קורס', program: 'ביומימיקרי', school: 'אילנות', authority: 'אשקלון', meetingNo: 7 };
  const result = compareAttendanceRows([attendance], []);
  const html = resultsHtml(result);
  assert.match(html, /attendance-control__missing-match">לא נמצאה פעילות תואמת בדשבורד<\/p>/);
  assert.match(html, /ק״מ מדווח: 58[\s\S]*לא ניתן לחשב/);
  assert.doesNotMatch(html, /לא נמצאה התאמה<\/td><td class="attendance-control__row-status ">תקין/);
  assert.match(html, /10:00–12:00 \| קורס/);
  assert.match(html, /ביומימיקרי \| אילנות \| אשקלון \| מפגש 7/);
});



test('payroll view treats zero reported kilometers at day level', () => {
  const attendance = { employeeId: 'zero-km', employeeName: 'מדריך אפס ק״מ', date: '2027-01-04', startTime: '08:00', endTime: '09:00', workHours: 1, kilometers: 0, activityType: 'קורס' };
  const dashboard = { ...attendance, kilometers: 24 };
  const html = resultsHtml({ comparisons: [{ id: 'zero-km', attendance, dashboard, final: { ...attendance }, differences: [], unmatched: false }], notCompared: [], dashboardOnly: [], dashboardPopulation: [dashboard], dailyKilometers: [{ employeeId: 'zero-km', date: '2027-01-04', reported: 0, calculated: 24, matches: false, hasReportedKm: true }] });
  assert.match(html, /ק״מ מדווח: 0[\s\S]*ק״מ מחושב: 24/);
  assert.match(html, /⚠ לבדיקה/);

  const matchingHtml = resultsHtml({ comparisons: [{ id: 'zero-km-match', attendance, dashboard: { ...dashboard, kilometers: 0 }, final: { ...attendance }, differences: [], unmatched: false }], notCompared: [], dashboardOnly: [], dashboardPopulation: [], dailyKilometers: [{ employeeId: 'zero-km', date: '2027-01-04', reported: 0, calculated: 0, matches: true }] });
  assert.match(matchingHtml, /attendance-control__day--ok/);
});

test('payroll view marks unavailable daily kilometers for review', () => {
  const attendance = { employeeId: '78', employeeName: 'מדריך ק״מ', date: '2027-01-04', startTime: '09:00', endTime: '10:00', workHours: 1, kilometers: 30, activityType: 'קורס' };
  const dashboard = { ...attendance, kilometers: null };
  const html = resultsHtml({ comparisons: [{ id: 'km-missing', attendance, dashboard, final: { ...attendance }, differences: [], unmatched: false }], notCompared: [], dashboardOnly: [], dashboardPopulation: [dashboard], dailyKilometers: [{ employeeId: '78', date: '2027-01-04', reported: 30, calculated: null, matches: false }] });
  assert.match(html, /ק״מ מדווח: 30[\s\S]*לא ניתן לחשב/);
});

test('manual report days and expense days remain under review without technical labels', () => {
  for (const activityType of ['הכשרה', 'ביטול זמן', 'תפעול']) {
    const attendance = { employeeId: activityType, employeeName: `מדריך ${activityType}`, date: '2027-01-05', startTime: '10:00', endTime: '11:00', workHours: 1, kilometers: 0, expenses: 20, expenseDetails: 'חניה', notes: 'הערה', activityType };
    const html = resultsHtml({ comparisons: [], notCompared: [{ id: activityType, attendance, final: { ...attendance } }], dashboardOnly: [], dashboardPopulation: [], dailyKilometers: [] });
    assert.match(html, /attendance-control__row-status attendance-control__row-status--issue">⚠ לבדיקה/, `${activityType} day must require review`);
    assert.match(html, /תקינים <b>0<\/b>[\s\S]*לבדיקה <b>1<\/b>/);
    assert.match(html, /attendance-control__manual-table[\s\S]*<th>שעות שכר<\/th>/, 'manual reports use the compact reported-data table');
    assert.doesNotMatch(html, /דשבורד \/ בקרה|נוכחות בלבד|נדרש אישור ידני|נדרש טיפול לפני תשלום/);
  }
  const attendance = { employeeId: 'expense', employeeName: 'מדריך הוצאה', date: '2027-01-06', startTime: '09:00', endTime: '10:00', workHours: 1, expenses: 50, activityType: 'קורס' };
  const dashboard = { ...attendance, expenses: 50 };
  const html = resultsHtml({ comparisons: [{ id: 'expense', attendance, dashboard, final: { ...attendance }, differences: [], unmatched: false }], notCompared: [], dashboardOnly: [], dashboardPopulation: [dashboard], dailyKilometers: [] });
  assert.match(html, /הוצאות<\/th><td>50<\/td>[\s\S]*לבדיקה/);
  assert.match(html, /תקינים <b>0<\/b>[\s\S]*לבדיקה <b>1<\/b>/);
});

test('employee 1501 May 4 bundles LONG-080 through LONG-082 into one attendance row', () => {
  const attendance = [{ employeeId: '1501', date: '2026-05-04', startTime: '08:00', endTime: '13:35', workHours: 5.6, school: 'מול גלעד', program: 'מנהיגות ירוקה', activityType: 'קורס' }];
  const dashboard = [
    ['LONG-080', '08:00', '09:30'], ['LONG-081', '09:45', '11:15'], ['LONG-082', '11:35', '13:05']
  ].map(([activityId, startTime, endTime], index) => ({ employeeId: '1501', date: '2026-05-04', activityId, startTime, endTime, workHours: 1.5, school: 'מול גלעד', program: 'מנהיגות ירוקה', activityType: 'course', meetingNo: index + 1 }));
  const result = compareAttendanceRows(attendance, dashboard);
  assert.deepEqual(result.comparisons[0].dashboard.activityIds, ['LONG-080', 'LONG-081', 'LONG-082']);
  assert.equal(result.comparisons[0].dashboard.startTime, '08:00');
  assert.equal(result.comparisons[0].dashboard.endTime, '13:05');
  assert.equal(result.comparisons[0].dashboard.workHours, 4.5);
  assert.equal(result.dashboardOnly.length, 0);
});

test('employee 1504 May 10 bundles four Merhavei Eshkol biomimicry activities', () => {
  const attendance = [{ employeeId: '1504', date: '2026-05-10', startTime: '08:00', endTime: '13:00', workHours: 5, school: 'מרחבי אשכול', program: 'ביומימיקרי', activityType: 'קורס' }];
  const dashboard = ['LONG-008', 'LONG-009', 'LONG-010', 'LONG-011'].map((activityId, index) => ({ employeeId: '1504', date: '2026-05-10', activityId, startTime: `${String(8 + index).padStart(2, '0')}:00`, endTime: `${String(9 + index).padStart(2, '0')}:00`, workHours: 1, school: 'מרחבי אשכול', program: 'ביומימיקרי', activityType: 'course', meetingNo: index + 1 }));
  const result = compareAttendanceRows(attendance, dashboard);
  assert.deepEqual(result.comparisons[0].dashboard.activityIds, ['LONG-008', 'LONG-009', 'LONG-010', 'LONG-011']);
  assert.equal(result.dashboardOnly.length, 0);
});

test('employee 1506 partitions same-day Golda activities between separate attendance rows', () => {
  const attendance = [
    { employeeId: '1506', date: '2026-05-12', startTime: '08:00', endTime: '10:00', workHours: 2, school: 'גולדה', program: 'מנהיגות ירוקה', activityType: 'קורס' },
    { employeeId: '1506', date: '2026-05-12', startTime: '10:15', endTime: '12:15', workHours: 2, school: 'גולדה', program: 'ביומימיקרי', activityType: 'קורס' }
  ];
  const dashboard = [
    { activityId: 'GOLDA-1', startTime: '08:00', endTime: '09:00', program: 'מנהיגות ירוקה' },
    { activityId: 'GOLDA-2', startTime: '09:00', endTime: '10:00', program: 'מנהיגות ירוקה' },
    { activityId: 'GOLDA-3', startTime: '10:15', endTime: '11:15', program: 'ביומימיקרי' },
    { activityId: 'GOLDA-4', startTime: '11:15', endTime: '12:15', program: 'ביומימיקרי' }
  ].map((row) => ({ ...row, employeeId: '1506', date: '2026-05-12', workHours: 1, school: 'גולדה', activityType: 'course' }));
  const result = compareAttendanceRows(attendance, dashboard);
  assert.deepEqual(result.comparisons.map((row) => row.dashboard.activityIds), [['GOLDA-1', 'GOLDA-2'], ['GOLDA-3', 'GOLDA-4']]);
  assert.equal(result.dashboardOnly.length, 0);
});

test('employee 1522 course attendance does not treat after-school as course', () => {
  const attendance = [{ employeeId: '1522', date: '2026-05-18', startTime: '13:00', endTime: '16:00', workHours: 3, school: 'אלתרמן', program: 'אפטרסקול', activityType: 'קורס' }];
  const dashboard = ['AFTER-1', 'AFTER-2'].map((activityId, index) => ({ employeeId: '1522', date: '2026-05-18', activityId, startTime: index ? '14:30' : '13:00', endTime: index ? '16:00' : '14:30', workHours: 1.5, school: 'אלתרמן', program: 'אפטרסקול', activityType: 'after_school' }));
  const result = compareAttendanceRows(attendance, dashboard);
  assert.equal(result.comparisons[0].unmatched, true);
  assert.equal(result.dashboardOnly.length, 2);
});

test('employee 1500 May 24 does not over-bundle LONG-109 by course type or authority', () => {
  const attendance = [
    { employeeId: '1500', date: '2026-05-24', startTime: '10:00', endTime: '12:00', workHours: 2, school: 'סמילנסקי', authority: 'רחובות', program: 'ביומימיקרי', activityType: 'קורס' },
    { employeeId: '1500', date: '2026-05-24', startTime: '13:00', endTime: '15:00', workHours: 2, school: 'בן־צבי', authority: 'פתח תקווה', program: 'פרימיום', activityType: 'קורס' }
  ];
  const dashboard = [
    { activityId: 'LONG-110', startTime: '10:00', endTime: '11:40', school: 'סמילנסקי', authority: 'רחובות', program: 'ביומימיקרי' },
    { activityId: 'LONG-091', startTime: '12:55', endTime: '14:30', school: 'בן צבי', authority: 'פתח תקווה', program: 'יזמות פרימיום' },
    { activityId: 'LONG-109', startTime: '14:00', endTime: '15:30', school: 'דה שליט', authority: 'רחובות', program: 'פורצות דרך' }
  ].map((row) => ({ ...row, employeeId: '1500', date: '2026-05-24', workHours: calculateWorkHours(row.startTime, row.endTime), activityType: 'course' }));
  const result = compareAttendanceRows(attendance, dashboard);
  assert.deepEqual(result.comparisons.map((row) => row.dashboard.activityIds), [['LONG-110'], ['LONG-091']]);
  assert.deepEqual(result.dashboardOnly.map((row) => row.dashboard.activityId), ['LONG-109']);
});

test('foreign chronological component stays dashboard-only between matching bundle activities', () => {
  const attendance = [{ employeeId: '1501', date: '2026-05-04', startTime: '08:00', endTime: '13:35', workHours: 4.5, school: 'מול גלעד', program: 'מנהיגות ירוקה', activityType: 'קורס' }];
  const dashboard = [
    { activityId: 'RELATED-1', startTime: '08:00', endTime: '09:30', school: 'מול גלעד', program: 'מנהיגות ירוקה' },
    { activityId: 'FOREIGN', startTime: '09:35', endTime: '10:00', school: 'אחר', program: 'פעילות זרה' },
    { activityId: 'RELATED-2', startTime: '10:05', endTime: '11:35', school: 'מול גלעד', program: 'מנהיגות ירוקה' },
    { activityId: 'RELATED-3', startTime: '11:40', endTime: '13:10', school: 'מול גלעד', program: 'מנהיגות ירוקה' }
  ].map((row) => ({ ...row, employeeId: '1501', date: '2026-05-04', workHours: calculateWorkHours(row.startTime, row.endTime), authority: 'רחובות', activityType: 'course' }));
  const result = compareAttendanceRows(attendance, dashboard);
  assert.deepEqual(result.comparisons[0].dashboard.activityIds, ['RELATED-1', 'RELATED-2', 'RELATED-3']);
  assert.deepEqual(result.dashboardOnly.map((row) => row.dashboard.activityId), ['FOREIGN']);
});

test('Oshri Ram matching requires context, exposes real fields, and leaves exact rows normal', () => {
  const base = { employeeId: '1524', employeeName: 'אושרי רם', date: '2026-05-25', startTime: '09:50', endTime: '11:20', school: 'טשרניחובסקי', authority: 'נתניה', program: 'יישומי AI', activityType: 'קורס' };
  const exact = compareAttendanceRows([base], [{ ...base }]);
  assert.equal(exact.comparisons[0].unmatched, false);
  assert.equal(exact.comparisons[0].differences.length, 0);
  assert.match(resultsHtml(exact), /✓ תקין/);
  assert.doesNotMatch(resultsHtml(exact), /data-attendance-choice/);

  const mismatch = compareAttendanceRows([base], [{ ...base, startTime: '10:50', endTime: '12:20', school: 'שרת' }]);
  assert.deepEqual(mismatch.comparisons[0].differences.map((item) => item.key), ['startTime', 'endTime', 'school']);
  assert.match(resultsHtml(mismatch), /בית ספר/);
  assert.match(resultsHtml(mismatch), /⚠ לבדיקה/);

  const timeOnly = compareAttendanceRows([{ employeeId: '1524', date: base.date, startTime: base.startTime, endTime: base.endTime }], [{ employeeId: '1524', date: base.date, startTime: base.startTime, endTime: base.endTime }]);
  assert.equal(timeOnly.comparisons[0].unmatched, true, 'identical hours alone are insufficient');

  const badCandidate = compareAttendanceRows([base], [{ ...base, startTime: '14:00', endTime: '16:00', school: 'אחר', authority: 'אחר', program: 'אחר', activityType: 'סיור' }]);
  assert.equal(badCandidate.comparisons[0].unmatched, true);
  assert.equal(badCandidate.dashboardOnly.length, 1);
  const totals = attendanceAuditSummary(badCandidate);
  assert.equal(totals.unmatchedAttendance, 1);
  assert.equal(totals.unmatchedDashboard, 0);
});

test('kilometers reuse cached scheduling route segments across a work day', () => {
  const rows = [{ employeeId: '10', date: '2026-08-01', startTime: '08:00', schoolId: 1 }, { employeeId: '10', date: '2026-08-01', startTime: '11:00', schoolId: 2 }];
  applyDashboardRouteKilometers(rows, [
    { origin_instructor_emp_id: 10, destination_school_id: 1, distance_km: 12 },
    { origin_instructor_emp_id: 10, destination_school_id: 2, distance_km: 20 },
    { origin_school_id: 1, destination_school_id: 2, distance_km: 7 }
  ]);
  assert.deepEqual(rows.map((row) => row.kilometers), [12, 27]);
  assert.equal(rows.reduce((sum, row) => sum + row.kilometers, 0), 39);
});

test('dashboard expenses aggregate the existing personal-report source without inventing zero', () => {
  const rows = [{ employeeId: '10', date: '2026-08-01', expenses: null }, { employeeId: '10', date: '2026-08-01', expenses: null }, { employeeId: '10', date: '2026-08-02', expenses: null }];
  applyDashboardExpenses(rows, [{ emp_id: '10', expense_date: '2026-08-01', amount: 25, description: 'חניה' }, { emp_id: '10', expense_date: '2026-08-01', amount: 10, description: 'כביש אגרה' }]);
  assert.equal(rows[0].expenses, 35);
  assert.equal(rows[0].expenseDetails, 'חניה; כביש אגרה');
  assert.equal(rows[1].expenses, null);
  assert.equal(rows[1].expenseDetails, undefined);
  assert.equal(rows[2].expenses, null);
});

test('unmatched dashboard meetings are limited to attendance employees and can be added once', () => {
  const attendance = [{ employeeId: '10', employeeName: 'דנה', date: '2026-08-01', startTime: '08:00', endTime: '09:00', program: 'ראשון' }];
  const dashboard = [
    { employeeId: '10', employeeName: 'דנה', employmentType: 'תעשיידע', date: '2026-08-01', startTime: '08:00', endTime: '09:00', program: 'ראשון' },
    { employeeId: '10', employeeName: 'דנה', employmentType: 'תעשיידע', date: '2026-08-01', startTime: '11:00', endTime: '12:00', program: 'שני' },
    { employeeId: '99', employeeName: 'מחוץ לאוכלוסייה', date: '2026-08-01', startTime: '13:00', endTime: '14:00', program: 'שלישי' }
  ];
  const result = compareAttendanceRows(attendance, dashboard);
  assert.equal(result.dashboardOnly.length, 1);
  assert.equal(result.dashboardOnly[0].dashboard.program, 'שני');
  const html = resultsHtml(result);
  assert.doesNotMatch(html, /מופיע בדשבורד ולא נמצא בנוכחות|להוסיף לנתונים הסופיים|דשבורד בלבד/);
  assert.doesNotMatch(html, /שני/);
  const workbook = buildCorrectedAttendanceWorkbook([...result.comparisons, ...result.dashboardOnly], result.dashboardPopulation);
  const detail = XLSX.utils.sheet_to_json(workbook.Sheets['פירוט מלא'], { header: 1 });
  assert.equal(detail.length, 2);
  assert.equal(detail[1][9], 'ראשון');
});

test('population, multiple same-day matching and all compared fields are preserved', () => {
  const attendance = [{ employeeId: '10', date: '2026-08-01', startTime: '09:00', endTime: '10:00', program: 'אלפא', school: 'רמב״ם', authority: 'חיפה', activityType: 'קורס', meetingNo: '4', kilometers: 48, expenses: 35 }];
  const dashboard = [
    { employeeId: '10', date: '2026-08-01', startTime: '08:30', endTime: '10:30', program: 'אלפא אחר', school: 'רמבם', authority: 'חיפה', activityType: 'קורס', meetingNo: '5', kilometers: 42, expenses: 0 },
    { employeeId: '10', date: '2026-08-01', startTime: '15:00', endTime: '16:00', program: 'רחוק', school: 'אחר', authority: 'אחר' },
    { employeeId: '99', date: '2026-08-01', startTime: '09:00', endTime: '10:00' }
  ];
  const result = compareAttendanceRows(attendance, dashboard);
  assert.equal(result.dashboardPopulation.some((row) => row.employeeId === '99'), false);
  assert.equal(result.comparisons[0].dashboard.program, 'אלפא אחר');
  assert.deepEqual(result.comparisons[0].differences.map((item) => item.key), ['startTime', 'endTime', 'workHours', 'program', 'meetingNo', 'expenses']);
});

test('results classify matching rows as normal and count only actual row exceptions', () => {
  const attendance = Array.from({ length: 8 }, (_, index) => ({ employeeId: '10', employeeName: 'דנה', date: `2026-08-${String(index + 1).padStart(2, '0')}`, startTime: '08:00', endTime: '09:00', program: `פעילות ${index + 1}` }));
  const dashboard = attendance.map((row) => ({ ...row }));
  dashboard[6] = { ...dashboard[6], endTime: '10:00' };
  dashboard.pop();
  const html = resultsHtml(compareAttendanceRows(attendance, dashboard));

  assert.equal((html.match(/✓ תקין/g) || []).length, 12);
  assert.equal((html.match(/⚠ לבדיקה/g) || []).length, 4);
  assert.equal((html.match(/⚠ לא נמצאה פעילות תואמת/g) || []).length, 1);
  assert.match(html, /לבדיקה <b>1<\/b>/);
  assert.equal((html.match(/data-attendance-choice/g) || []).length, 2);
  assert.doesNotMatch(html, /אף מועמד לא עבר את סף ההתאמה/);
  assert.match(html, /<summary>פרטים<\/summary>/);
});

test('a fully matching row has a normal status and no decision control', () => {
  const row = { employeeId: '10', employeeName: 'דנה', date: '2026-08-01', startTime: '08:00', endTime: '09:00', program: 'קורס' };
  const html = resultsHtml(compareAttendanceRows([row], [{ ...row }]), '2026-08', {
    workflowByEmployee: { '10': { workflow_status: 'submitted', attendance_submission_status: 'submitted' } }
  });
  assert.match(html, /attendance-control__day--ok/);
  assert.match(html, /✓ תקין/);
  assert.doesNotMatch(html, /data-attendance-choice/);
  assert.match(html, /תקינים <b>1<\/b>/);
});

test('attendance, dashboard and manual choices preserve independent payroll hours', () => {
  const comparison = compareAttendanceRows([{ employeeId: '10', date: '2026-08-01', startTime: '09:00', endTime: '10:00', program: 'קורס', school: 'אלונים', kilometers: 4 }], [{ employeeId: '10', date: '2026-08-01', startTime: '08:30', endTime: '11:00', program: 'קורס', school: 'אלונים', kilometers: 7 }]).comparisons[0];
  applyAttendanceChoice(comparison, 'startTime', 'dashboard');
  applyAttendanceChoice(comparison, 'endTime', 'custom', '10:30');
  applyAttendanceChoice(comparison, 'kilometers', 'attendance');
  assert.equal(comparison.final.workHours, 1, 'time decisions must preserve the original payroll duration');
  assert.equal(comparison.final.kilometers, 4);
  assert.equal(calculateWorkHours('23:30', '01:00'), 0);
});

test('standard school durations match longer paid attendance end times', () => {
  for (const [dashboardEnd, attendanceEnd, paidHours] of [['08:45', '09:00', 1], ['09:30', '10:00', 2]]) {
    const base = { employeeId: '10', date: '2026-05-12', startTime: '08:00', activityType: 'סדנה', school: 'אלונים' };
    const result = compareAttendanceRows(
      [{ ...base, endTime: attendanceEnd, workHours: paidHours }],
      [{ ...base, endTime: dashboardEnd, workHours: paidHours, payrollHoursRequireReview: false }]
    );
    assert.equal(result.comparisons[0].unmatched, false);
    assert.equal(result.comparisons[0].differences.some((difference) => difference.key === 'endTime'), false);
    assert.equal(result.comparisons[0].differences.some((difference) => difference.key === 'workHours'), false);
  }
});

test('choosing dashboard school times preserves the attendance payroll hours', () => {
  const comparison = compareAttendanceRows(
    [{ employeeId: '10', date: '2026-05-12', startTime: '08:00', endTime: '09:10', workHours: 1, activityType: 'סדנה', school: 'אלונים' }],
    [{ employeeId: '10', date: '2026-05-12', startTime: '08:00', endTime: '08:45', workHours: 1, activityType: 'סדנה', school: 'אלונים' }]
  ).comparisons[0];
  applyAttendanceChoice(comparison, 'endTime', 'dashboard');
  assert.equal(comparison.final.endTime, '08:45');
  assert.equal(comparison.final.workHours, 1);
});

test('excelDate serial 46143 parses to May 1 2026 without timezone shift', () => {
  // Excel serial 46143 = 2026-05-01. With raw mode (no cellDates) date cells arrive as
  // plain integers. The parser must return '2026-05-01' in any runtime timezone so that
  // first-of-month rows are never silently dropped.
  // Build a workbook whose date column holds raw numeric serials (type 'n').
  const ws = XLSX.utils.aoa_to_sheet([['מספר עובד', 'תאריך'], ['10', 46143], ['10', 46143]]);
  ws['B2'].t = 'n'; ws['B3'].t = 'n';
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const rows = parseAttendanceWorkbook(wb);
  assert.equal(rows.length, 2, 'both 01/05 rows must be parsed');
  assert.equal(rows[0].date, '2026-05-01', 'serial 46143 must map to 2026-05-01');
  assert.equal(rows[1].date, '2026-05-01', 'second 01/05 row must also map to 2026-05-01');
  const filtered = filterAttendanceRowsByMonth(rows, '2026-05');
  assert.equal(filtered.length, 2, 'both 01/05 rows must survive the May filter');
});

test('soft match requires both authority and activity type – type-only does not match', () => {
  // Same employee, date, activity type, significant time overlap — but different authority.
  // Must stay unmatched (attendance without activity) rather than creating a spurious soft match.
  const attendance = [{ employeeId: '10', date: '2026-05-12', startTime: '08:00', endTime: '10:00', activityType: 'קורס', authority: 'חיפה', program: 'תכנית א' }];
  const dashboard  = [{ employeeId: '10', date: '2026-05-12', startTime: '08:00', endTime: '10:00', activityType: 'קורס', authority: 'נצרת', program: 'תכנית ב' }];
  const result = compareAttendanceRows(attendance, dashboard);
  assert.equal(result.comparisons[0].unmatched, true, 'different authority → no soft match');
  assert.equal(result.dashboardOnly.length, 1, 'dashboard row must remain dashboard-only');
});

test('soft match requires both authority and activity type – authority-only does not match', () => {
  // Same employee, date, authority, significant time overlap — but different activity type.
  // Must stay unmatched rather than being bundled by authority alone.
  const attendance = [{ employeeId: '10', date: '2026-05-12', startTime: '08:00', endTime: '10:00', activityType: 'קורס', authority: 'חיפה', program: 'תכנית א' }];
  const dashboard  = [{ employeeId: '10', date: '2026-05-12', startTime: '08:00', endTime: '10:00', activityType: 'סדנה', authority: 'חיפה', program: 'תכנית ב' }];
  const result = compareAttendanceRows(attendance, dashboard);
  assert.equal(result.comparisons[0].unmatched, true, 'different activity type → no soft match');
  assert.equal(result.dashboardOnly.length, 1, 'dashboard row must remain dashboard-only');
});

test('course activity 08:00-08:45 gets 1.0 payroll hours not 0.75 (teaching-unit rule)', () => {
  const rows = buildDashboardAttendanceRows([{
    row_id: 'PAY-001', emp_id: '10', instructor_name: 'דנה',
    activity_type: 'course', activity_name: 'תכנית א', school: 'יסודי', authority: 'חיפה',
    start_time: '08:00', end_time: '08:45', date_1: '2026-05-12'
  }]);
  assert.equal(rows.length, 1, 'one meeting must be produced');
  assert.equal(rows[0].workHours, 1.0, '45-min course session must be compensated to 1.0 pay hours');
  assert.equal(rows[0].startTime, '08:00', 'startTime must not be changed');
  assert.equal(rows[0].endTime, '08:45', 'endTime must not be changed');
});

test('45 and 90 minute dashboard activities use payroll hours for every comparable type', () => {
  for (const [minutes, expected] of [[45, 1], [90, 2]]) {
    const endTime = minutes === 45 ? '08:45' : '09:30';
    const [row] = buildDashboardAttendanceRows([{ row_id: `PAY-course-${minutes}`, emp_id: '10', activity_type: 'course', start_time: '08:00', end_time: endTime, date_1: '2026-05-12' }]);
    assert.equal(row.workHours, expected, `course ${minutes} minutes`);
    assert.equal(row.payrollHoursRequireReview, false);
  }
});

test('nonstandard dashboard duration is not converted into invented payroll hours', () => {
  const [row] = buildDashboardAttendanceRows([{ row_id: 'PAY-85', emp_id: '10', activity_type: 'course', start_time: '08:00', end_time: '09:25', date_1: '2026-05-12' }]);
  assert.equal(row.workHours, null);
  assert.equal(row.payrollHoursRequireReview, true);
  const attendance = [{ ...row, workHours: 2, activityType: 'קורס', school: 'אלונים' }];
  const result = compareAttendanceRows(attendance, [{ ...row, school: 'אלונים' }]);
  assert.equal(result.comparisons[0].differences.some((difference) => difference.key === 'workHours'), false);
    assert.match(resultsHtml(result), /שעות שכר לבדיקה/);
});

test('work-hours gap is formatted as time and never labelled ק״מ', () => {
  const attendance = [{ employeeId: '10', date: '2026-05-12', startTime: '08:00', endTime: '10:00', activityType: 'קורס', authority: 'חיפה', program: 'תכנית א', workHours: 2.5 }];
  const dashboard  = [{ employeeId: '10', date: '2026-05-12', startTime: '08:00', endTime: '10:00', activityType: 'קורס', authority: 'חיפה', program: 'תכנית א', workHours: 2.0 }];
  const result = compareAttendanceRows(attendance, dashboard);
  const html = resultsHtml(result, '2026-05');
  assert.ok(!html.includes('פער') || html.includes('דקות') || html.includes('שעות'), 'workHours diff must show time units');
});

test('notCompared rows appear in per-employee timeline sorted by date then startTime', () => {
  const attendance = [
    { employeeId: '10', employeeName: 'דנה', date: '2026-05-12', startTime: '08:00', endTime: '09:00', activityType: 'קורס', authority: 'חיפה', program: 'תכנית א' },
    { employeeId: '10', employeeName: 'דנה', date: '2026-05-12', startTime: '09:30', endTime: '10:00', activityType: 'ביטולזמן', authority: 'חיפה', program: '' },
    { employeeId: '10', employeeName: 'דנה', date: '2026-05-12', startTime: '11:00', endTime: '13:00', activityType: 'קורס', authority: 'חיפה', program: 'תכנית ב' },
  ];
  const dashboard = [
    { employeeId: '10', employeeName: 'דנה', date: '2026-05-12', startTime: '08:00', endTime: '09:00', activityType: 'קורס', authority: 'חיפה', program: 'תכנית א' },
    { employeeId: '10', employeeName: 'דנה', date: '2026-05-12', startTime: '11:00', endTime: '13:00', activityType: 'קורס', authority: 'חיפה', program: 'תכנית ב' },
  ];
  const result = compareAttendanceRows(attendance, dashboard);
  const html = resultsHtml(result, '2026-05');
  const posA  = html.indexOf('תכנית א');
  const posNC = html.indexOf('09:30');
  const posB  = html.indexOf('תכנית ב');
  assert.ok(posA  > -1, 'תכנית א must appear in the HTML');
  assert.ok(posNC > -1, '09:30 (ביטול זמן) must appear in the HTML');
  assert.ok(posB  > -1, 'תכנית ב must appear in the HTML');
  assert.ok(posA  < posNC, 'תכנית א (08:00) must appear before the ביטול זמן card (09:30)');
  assert.ok(posNC < posB,  'ביטול זמן card (09:30) must appear before תכנית ב (11:00)');
  assert.ok(html.includes('נשמר ברצף יום העבודה'), 'attendance-only row must remain in the daily sequence');
  assert.ok(!html.includes('attendance-control__not-compared'), 'no separate notCompared section must exist');
});

test('attendance within grace window (start ≤15 min early, end ≤10 min late) is not flagged', () => {
  // Dashboard 08:00–08:45; attendance 07:45–08:50 → 15 min early start, 5 min late end → no diff.
  const attendance = [{ employeeId: '10', date: '2026-05-12', startTime: '07:45', endTime: '08:50', activityType: 'קורס', authority: 'חיפה', program: 'תכנית א' }];
  const dashboard  = [{ employeeId: '10', date: '2026-05-12', startTime: '08:00', endTime: '08:45', activityType: 'קורס', authority: 'חיפה', program: 'תכנית א' }];
  const result = compareAttendanceRows(attendance, dashboard);
  const diffKeys = result.comparisons[0].differences.map((d) => d.key);
  assert.ok(!diffKeys.includes('startTime'), 'startTime 15 min early must not be flagged');
  assert.ok(!diffKeys.includes('endTime'),   'endTime 5 min late must not be flagged');
});

test('attendance at exactly the grace boundaries is not flagged', () => {
  // Exactly 15 min early start and exactly 10 min late end → still within window → no diff.
  const attendance = [{ employeeId: '10', date: '2026-05-12', startTime: '07:45', endTime: '08:55', activityType: 'קורס', authority: 'חיפה', program: 'תכנית א' }];
  const dashboard  = [{ employeeId: '10', date: '2026-05-12', startTime: '08:00', endTime: '08:45', activityType: 'קורס', authority: 'חיפה', program: 'תכנית א' }];
  const result = compareAttendanceRows(attendance, dashboard);
  const diffKeys = result.comparisons[0].differences.map((d) => d.key);
  assert.ok(!diffKeys.includes('startTime'), 'exactly 15 min early start must not be flagged');
  assert.ok(!diffKeys.includes('endTime'),   'exactly 10 min late end must not be flagged');
});

test('attendance one minute beyond each grace boundary is flagged', () => {
  // 16 min early start → startTime diff; 11 min late end → endTime diff.
  const attendance = [{ employeeId: '10', date: '2026-05-12', startTime: '07:44', endTime: '08:56', activityType: 'קורס', authority: 'חיפה', program: 'תכנית א' }];
  const dashboard  = [{ employeeId: '10', date: '2026-05-12', startTime: '08:00', endTime: '08:45', activityType: 'קורס', authority: 'חיפה', program: 'תכנית א' }];
  const result = compareAttendanceRows(attendance, dashboard);
  const diffKeys = result.comparisons[0].differences.map((d) => d.key);
  assert.ok(diffKeys.includes('startTime'), '16 min early start must be flagged');
  assert.ok(diffKeys.includes('endTime'),   '11 min late end must be flagged');
});

test('attendance expenses=0 vs missing dashboard expenses does not create a diff', () => {
  // Dashboard rows have expenses: null by default — there is no real expense data on the
  // dashboard side. An attendance row reporting 0 expenses must not be flagged as a diff.
  const base = { employeeId: '10', date: '2026-05-12', startTime: '08:00', endTime: '09:00', activityType: 'קורס', authority: 'חיפה', program: 'תכנית א' };
  // attendance expenses=0, dashboard expenses=null → no diff
  const r1 = compareAttendanceRows([{ ...base, expenses: 0 }], [{ ...base, expenses: null }]);
  assert.ok(!r1.comparisons[0].differences.some((d) => d.key === 'expenses'), 'expenses 0 vs null must not be a diff');
  // attendance expenses=0, dashboard expenses=undefined (key absent) → no diff
  const r2 = compareAttendanceRows([{ ...base, expenses: 0 }], [{ ...base }]);
  assert.ok(!r2.comparisons[0].differences.some((d) => d.key === 'expenses'), 'expenses 0 vs absent must not be a diff');
  // attendance expenses=0, dashboard expenses='' → no diff
  const r3 = compareAttendanceRows([{ ...base, expenses: 0 }], [{ ...base, expenses: '' }]);
  assert.ok(!r3.comparisons[0].differences.some((d) => d.key === 'expenses'), 'expenses 0 vs empty-string must not be a diff');
  // attendance expenses positive → still a diff (rule must not suppress real values)
  const r4 = compareAttendanceRows([{ ...base, expenses: 50 }], [{ ...base, expenses: null }]);
  assert.ok(r4.comparisons[0].differences.some((d) => d.key === 'expenses'), 'expenses 50 vs null must remain a diff');
});

test('special attendance rows remain and exact three-sheet export uses dashboard employment type', () => {
  const comparisons = [
    { final: { employeeId: '10', employeeName: 'דנה', date: '2026-08-01', startTime: '08:00', endTime: '10:00', activityType: 'ביטול זמן', kilometers: 12, expenses: 5, expenseDetails: 'חניה' } },
    { final: { employeeId: '10', employeeName: 'דנה', date: '2026-08-02', startTime: '09:00', endTime: '10:00', activityType: 'הכשרה' } },
    { final: { employeeId: '11', employeeName: 'נועם', date: '2026-08-02', startTime: '09:00', endTime: '10:00', activityType: 'תפעול', authority: 'חיפה' } }
  ];
  const workbook = buildCorrectedAttendanceWorkbook(comparisons, [{ employeeId: '10', employmentType: 'תעשיידע' }, { employeeId: '11', employmentType: 'כוח אדם' }]);
  assert.deepEqual(workbook.SheetNames, ['פירוט מלא', 'סיכום חודשי', 'תצוגה יומית']);
  assert.deepEqual(XLSX.utils.sheet_to_json(workbook.Sheets['פירוט מלא'], { header: 1 })[0], DETAIL_HEADERS);
  assert.deepEqual(XLSX.utils.sheet_to_json(workbook.Sheets['סיכום חודשי'], { header: 1 })[0], MONTHLY_HEADERS);
  assert.deepEqual(XLSX.utils.sheet_to_json(workbook.Sheets['תצוגה יומית'], { header: 1 })[0], DAILY_HEADERS);
  const monthly = XLSX.utils.sheet_to_json(workbook.Sheets['סיכום חודשי'], { header: 1 })[1];
  assert.equal(monthly[2], 2); assert.equal(monthly[3], 1);
  assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets['תצוגה יומית'], { header: 1 })[1][3], 'תפעול');
});


test('one dashboard aggregate can explain separate attendance reports', () => {
  const attendance = [
    { employeeId: '10', date: '2026-05-12', startTime: '08:00', endTime: '09:00', workHours: 1, activityType: 'קורס', school: 'אלונים' },
    { employeeId: '10', date: '2026-05-12', startTime: '09:00', endTime: '10:00', workHours: 1, activityType: 'קורס', school: 'אלונים' }
  ];
  const dashboard = [{ employeeId: '10', date: '2026-05-12', startTime: '08:00', endTime: '10:00', workHours: 2, meetingCount: 2, activityType: 'course', school: 'אלונים', activityId: 'A' }];
  const result = compareAttendanceRows(attendance, dashboard);
  assert.deepEqual(result.comparisons.map((row) => row.unmatched), [false, false]);
  assert.equal(result.dashboardOnly.length, 0);
});

test('mixed activity day preserves distinct chronological blocks and cancellation context', () => {
  const attendance = [
    { employeeId: '10', employeeName: 'דנה', date: '2026-05-12', startTime: '08:00', endTime: '09:00', workHours: 1, activityType: 'קורס', school: 'א', program: 'קורס א' },
    { employeeId: '10', employeeName: 'דנה', date: '2026-05-12', startTime: '09:05', endTime: '09:20', workHours: .25, activityType: 'ביטול זמן' },
    { employeeId: '10', employeeName: 'דנה', date: '2026-05-12', startTime: '09:30', endTime: '10:30', workHours: 1, activityType: 'סדנה', school: 'ב', program: 'סדנה ב' },
    { employeeId: '10', employeeName: 'דנה', date: '2026-05-12', startTime: '11:00', endTime: '12:00', workHours: 1, activityType: 'הכשרה' }
  ];
  const dashboard = attendance.filter((row) => ['קורס', 'סדנה'].includes(row.activityType)).map((row) => ({ ...row }));
  const result = compareAttendanceRows(attendance, dashboard);
  assert.equal(result.comparisons.length, 2);
  assert.equal(result.notCompared.length, 2);
  const html = resultsHtml(result);
  assert.ok(html.indexOf('קורס א') < html.indexOf('09:05'));
  assert.ok(html.indexOf('09:05') < html.indexOf('סדנה ב'));
  assert.ok(html.indexOf('סדנה ב') < html.indexOf('11:00'));
  assert.equal((html.match(/<details class="attendance-control__employee[^"]*"/g) || []).length, 1);
});

test('daily route ignores Zoom and repeated locations and compares only the day total', () => {
  const rows = [
    { employeeId: '10', date: '2026-05-12', startTime: '08:00', schoolId: 1, school: 'א' },
    { employeeId: '10', date: '2026-05-12', startTime: '09:00', schoolId: 1, school: 'א' },
    { employeeId: '10', date: '2026-05-12', startTime: '10:00', schoolId: 2, school: 'Zoom' }
  ];
  applyDashboardRouteKilometers(rows, [{ origin_instructor_emp_id: 10, destination_school_id: 1, distance_km: 12 }]);
  assert.deepEqual(rows.map((row) => row.kilometers), [12, 12, 0]);
  const attendance = [{ employeeId: '10', date: '2026-05-12', activityType: 'קורס', school: 'א', kilometers: 24 }];
  const result = compareAttendanceRows(attendance, rows);
  assert.deepEqual(result.dailyKilometers[0], { employeeId: '10', date: '2026-05-12', reported: 24, calculated: 24, matches: true, hasReportedKm: true, managerResolved: 'auto_ok' });
  assert.equal(result.comparisons[0].differences.some((difference) => difference.key === 'kilometers'), false);
});

test('daily route stays unknown when a physical destination or route segment is missing', () => {
  for (const rows of [
    [{ employeeId: '10', date: '2026-05-12', startTime: '08:00', schoolId: 1, school: 'א' }, { employeeId: '10', date: '2026-05-12', startTime: '10:00', school: 'יעד לא מזוהה' }],
    [{ employeeId: '10', date: '2026-05-12', startTime: '08:00', schoolId: 1, school: 'א' }, { employeeId: '10', date: '2026-05-12', startTime: '10:00', schoolId: 2, school: 'ב' }]
  ]) {
    applyDashboardRouteKilometers(rows, [{ origin_instructor_emp_id: 10, destination_school_id: 1, distance_km: 12 }]);
    assert.ok(rows.every((row) => row.kilometers == null));
    const result = compareAttendanceRows([{ employeeId: '10', date: '2026-05-12', activityType: 'קורס', school: 'א', kilometers: 24 }], rows);
    assert.equal(result.dailyKilometers[0].calculated, null);
    assert.match(resultsHtml(result), /לא ניתן לחשב ק״מ/);
  }
});

test('employeeId match ignores instructor name spelling differences', () => {
  const attendance = [{ employeeId: '1503', employeeName: 'הנאא', date: '2026-05-04', startTime: '11:45', endTime: '14:00', workHours: 2.25, school: 'כפר הנוער רamat הדסה', program: 'מנהיגות', activityType: 'קורס', meetingNo: '8' }];
  const dashboard = [
    { employeeId: '1503', employeeName: 'הנאא׳', date: '2026-05-04', startTime: '11:45', endTime: '14:00', workHours: 2, school: 'כפר הנוער רamat הדסה', program: 'מנהיגות', activityType: 'course', activityId: 'LONG-081', meetingNo: '8' },
    { employeeId: '1503', employeeName: 'הנאא׳', date: '2026-05-04', startTime: '14:15', endTime: '16:00', workHours: 2, school: 'כפר הנוער רamat הדסה', program: 'מנהיגות', activityType: 'course', activityId: 'LONG-082', meetingNo: '9' }
  ];
  const result = compareAttendanceRows(attendance, dashboard);
  assert.equal(result.comparisons[0].unmatched, false);
  assert.equal(String(result.comparisons[0].dashboard.meetingNo), '8');
  assert.equal(result.comparisons[0].dashboard.activityId, 'LONG-081');
});

test('Aviv Blander 2026-05-03 matches the correct dashboard activity', () => {
  const attendance = [{ employeeId: '1522', employeeName: 'אביב בלנדר', date: '2026-05-03', startTime: '08:00', endTime: '10:00', workHours: 2, activityType: 'קורס', program: 'ביומימיקרי', school: 'תל-חי', authority: 'קריית שמונה', meetingNo: '2', kilometers: 10 }];
  const dashboard = [
    { employeeId: '1522', date: '2026-05-03', activityId: 'LONG-105', startTime: '08:00', endTime: '09:40', workHours: 2, activityType: 'course', program: 'ביומימיקרי', school: 'תל-חי', authority: 'קריית שמונה', meetingNo: '2' },
    { employeeId: '1522', date: '2026-05-03', activityId: 'LONG-OTHER', startTime: '12:00', endTime: '14:00', workHours: 2, activityType: 'course', program: 'אחר', school: 'אחר', authority: 'קריית שמונה', meetingNo: '1' }
  ];
  const result = compareAttendanceRows(attendance, dashboard);
  assert.equal(result.comparisons[0].unmatched, false);
  assert.equal(result.comparisons[0].dashboard.activityId, 'LONG-105');
  assert.equal(result.dashboardOnly.length, 1);
  assert.equal(result.dashboardOnly[0].dashboard.activityId, 'LONG-OTHER');
});

test('Asil 2026-05-05 keeps workshop attendance separate from course dashboard type', () => {
  const attendance = [{ employeeId: '1502', date: '2026-05-05', startTime: '08:00', endTime: '10:00', workHours: 2, activityType: 'סדנה', program: 'מנהיגות ירוקה', school: 'נווה שלום', authority: 'מטה יהודה', meetingNo: '8', kilometers: 40 }];
  const dashboard = [{ employeeId: '1502', date: '2026-05-05', startTime: '08:30', endTime: '10:00', workHours: 2, activityType: 'course', program: 'מנהיגות ירוקה', school: 'נווה שלום', authority: 'מטה יהודה', meetingNo: '8' }];
  const result = compareAttendanceRows(attendance, dashboard);
  assert.equal(result.comparisons[0].unmatched, true);
  assert.equal(result.dashboardOnly.length, 1);
});

test('unknown payroll hours stay null and are not exported as zero', () => {
  const row = { employeeId: '10', date: '2026-05-12', startTime: '08:00', endTime: '09:25', payrollHoursRequireReview: true, workHours: null, activityType: 'workshop', school: 'א' };
  assert.equal(rowWorkHours(row), null);
  const workbook = buildCorrectedAttendanceWorkbook([{ final: { ...row, activityType: 'סדנה' } }], []);
  const detail = XLSX.utils.sheet_to_json(workbook.Sheets['פירוט מלא'], { header: 1 })[1];
  assert.equal(detail[5], '');
});

test('manager startTime choice does not overwrite payroll workHours', () => {
  const comparison = compareAttendanceRows(
    [{ employeeId: '10', date: '2026-08-01', startTime: '09:00', endTime: '10:00', workHours: 2, program: 'קורס', school: 'א' }],
    [{ employeeId: '10', date: '2026-08-01', startTime: '08:30', endTime: '11:00', workHours: 1, program: 'קורס', school: 'א' }]
  ).comparisons[0];
  applyAttendanceChoice(comparison, 'startTime', 'dashboard');
  assert.equal(comparison.final.workHours, 2);
});

test('export preserves source attendance fields while applying corrections', () => {
  const comparison = {
    attendance: { _source: { employeeId: '10', employeeName: 'דנה', attendanceDate: '2026-08-01', startTime: '08:00', endTime: '09:00', workHours: 1, activityType: 'קורס', attachmentsNames: 'scan.pdf', status: 'approved' } },
    final: { employeeId: '10', employeeName: 'דנה', date: '2026-08-01', startTime: '08:15', endTime: '09:00', workHours: 1, activityType: 'קורס' }
  };
  const workbook = buildCorrectedAttendanceWorkbook([comparison], []);
  assert.equal(workbook.SheetNames.includes('פירוט מלא'), true);
  const detail = XLSX.utils.sheet_to_json(workbook.Sheets['פירוט מלא'], { header: 1 });
  assert.equal(detail[1][3], '08:15');
  assert.equal(comparison.attendance._source.attachmentsNames, 'scan.pdf');
  assert.equal(comparison.attendance._source.status, 'approved');
});

test('course 90-minute school block 10:30-12:00 matches attendance 10:00-12:00', () => {
  const attendance = [{ employeeId: '10', date: '2026-05-10', startTime: '10:00', endTime: '12:00', workHours: 2, activityType: 'קורס', school: 'א', program: 'קורס א' }];
  const dashboard = [{ employeeId: '10', date: '2026-05-10', startTime: '10:30', endTime: '12:00', workHours: 2, activityType: 'course', school: 'א', program: 'קורס א' }];
  const result = compareAttendanceRows(attendance, dashboard);
  assert.equal(result.comparisons[0].unmatched, false);
  assert.equal(result.comparisons[0].differences.some((difference) => ['startTime', 'endTime', 'workHours'].includes(difference.key)), false);
});

test('matched dashboard meeting number is a single relevant meeting', () => {
  const attendance = [{ employeeId: '10', date: '2026-05-10', startTime: '10:00', endTime: '12:00', workHours: 2, activityType: 'קורס', school: 'א', program: 'קורס א', meetingNo: '8' }];
  const dashboard = [
    { meetingNo: '13', startTime: '08:00', endTime: '09:30', activityId: 'A' },
    { meetingNo: '13', startTime: '09:30', endTime: '11:00', activityId: 'B' },
    { meetingNo: '15', startTime: '11:00', endTime: '12:30', activityId: 'C' },
    { meetingNo: '8', startTime: '10:30', endTime: '12:00', activityId: 'D' },
    { meetingNo: '16', startTime: '12:30', endTime: '14:00', activityId: 'E' },
    { meetingNo: '17', startTime: '14:00', endTime: '15:30', activityId: 'F' }
  ].map((row) => ({ ...row, employeeId: '10', date: '2026-05-10', workHours: 2, activityType: 'course', school: 'א', program: 'קורס א' }));
  const result = compareAttendanceRows(attendance, dashboard);
  assert.equal(String(result.comparisons[0].dashboard.meetingNo), '8');
  assert.doesNotMatch(String(result.comparisons[0].dashboard.meetingNo), /,/);
});

test('daily kilometers allow a 5 km tolerance', () => {
  const dashboard = [{ employeeId: '10', date: '2026-05-10', startTime: '08:00', endTime: '09:00', activityType: 'course', school: 'א', program: 'א', kilometers: 40 }];
  const within = compareAttendanceRows([{ employeeId: '10', date: '2026-05-10', startTime: '08:00', endTime: '09:00', activityType: 'קורס', school: 'א', program: 'א', kilometers: 45 }], dashboard);
  assert.equal(within.dailyKilometers[0].matches, true);
  assert.match(resultsHtml(within), /ק״מ מדווח: 45[\s\S]*ק״מ מחושב: 40[\s\S]*תקין/);
  const outside = compareAttendanceRows([{ employeeId: '10', date: '2026-05-10', startTime: '08:00', endTime: '09:00', activityType: 'קורס', school: 'א', program: 'א', kilometers: 46 }], dashboard);
  assert.equal(outside.dailyKilometers[0].matches, false);
  assert.match(resultsHtml(outside), /ק״מ מדווח: 46[\s\S]*ק״מ מחושב: 40[\s\S]*לבדיקה/);
});

test('unavailable daily kilometers stay visible and are not shown as zero', () => {
  const result = compareAttendanceRows(
    [{ employeeId: '10', date: '2026-05-10', startTime: '08:00', endTime: '09:00', activityType: 'קורס', school: 'א', program: 'א', kilometers: 50 }],
    [{ employeeId: '10', date: '2026-05-10', startTime: '08:00', endTime: '09:00', activityType: 'course', school: 'א', program: 'א', kilometers: null }]
  );
  assert.equal(result.dailyKilometers[0].calculated, null);
  const html = resultsHtml(result);
  assert.match(html, /ק״מ מדווח: 50[\s\S]*ק״מ מחושב: לא ניתן לחשב[\s\S]*לא ניתן לחשב ק״מ/);
  assert.doesNotMatch(html, /ק״מ מחושב: 0/);
});

const changedComparison = {
  attendance: {
    employeeId: '10', employeeName: 'דנה', date: '2026-05-10', startTime: '08:00', endTime: '09:00',
    workHours: 1, activityType: 'קורס', school: 'א', program: 'א', meetingNo: '1', kilometers: 10, expenses: 0,
    expenseDetails: 'חניה', notes: 'הערה קיימת',
    _source: {
      ID: 77,
      employeeId: '10',
      employeeName: 'דנה',
      attendanceDate: '2026-05-10',
      startTime: '08:00',
      endTime: '09:00',
      workHours: 1,
      activityType: 'קורס',
      schoolName: 'א',
      municipality: 'רשות',
      programName: 'א',
      sessionNumber: '1',
      kilometers: 10,
      totalExpenses: 0,
      expensesDetails: 'חניה',
      notes: 'הערה קיימת',
      team: { Value: 'צוות א' },
      employmentType: 'תעשיידע',
      attachmentsNames: 'scan.pdf',
      status: 'submitted',
      approvedBy: 'מנהל קודם',
      approvedDate: '2026-05-01'
    }
  },
  final: {
    employeeId: '10', employeeName: 'דנה', date: '2026-05-10', startTime: '08:15', endTime: '09:00',
    workHours: 1, activityType: 'קורס', school: 'א', program: 'א', meetingNo: '1', kilometers: 10, expenses: 0,
    expenseDetails: 'חניה', notes: 'הערה קיימת'
  }
};

const unchangedComparison = {
  attendance: {
    employeeId: '10', employeeName: 'דנה', date: '2026-05-11', startTime: '10:00', endTime: '11:00',
    workHours: 1, activityType: 'קורס', _source: { ID: 78, startTime: '10:00', endTime: '11:00', workHours: 1, notes: 'ללא שינוי' }
  },
  final: {
    employeeId: '10', employeeName: 'דנה', date: '2026-05-11', startTime: '10:00', endTime: '11:00',
    workHours: 1, activityType: 'קורס'
  }
};

test('changed attendance row is sent to updaterecord by recordId', () => {
  const updates = collectChangedAttendanceUpdates([changedComparison, unchangedComparison]);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].recordId, '77');
  const payload = updates[0].fields;
  assert.equal(payload.startTime, '08:15');
  assert.equal(payload.endTime, '09:00');
  assert.equal(payload.workHours, 1);
  assert.equal(payload.employeeName, 'דנה');
  assert.equal(payload.employeeId, '10');
  assert.equal(payload.attendanceDate, '2026-05-10');
  assert.equal(payload.schoolName, 'א');
  assert.equal(payload.municipality, 'רשות');
  assert.equal(payload.programName, 'א');
  assert.equal(payload.sessionNumber, '1');
  assert.equal(payload.kilometers, 10);
  assert.equal(payload.totalExpenses, 0);
  assert.equal(payload.expensesDetails, 'חניה');
  assert.equal(payload.notes, 'הערה קיימת');
  assert.deepEqual(payload.team, { Value: 'צוות א' });
  assert.equal(payload.employmentType, 'תעשיידע');
  assert.equal(payload.attachmentsNames, 'scan.pdf');
  assert.equal(payload.status, 'submitted');
  assert.equal(payload.approvedBy, 'מנהל קודם');
  assert.equal(payload.approvedDate, '2026-05-01');
  assert.equal(payload.endTime, '09:00');
  assert.notEqual(payload.endTime, null);
  assert.notEqual(payload.attachmentsNames, undefined);
  assert.equal(Object.hasOwn(payload, 'ID'), false);
  assert.ok(Object.values(payload).every((value) => value !== undefined));
});

test('failed updaterecord stops payroll approval save', async () => {
  const saved = [];
  const api = {
    attendanceControlUpdateRecord: async () => { throw new Error('attendance_api_500'); },
    attendanceManagerApprovalArtifacts: async (payload) => { saved.push(payload); return payload; },
    managerFinalizeAttendanceMonthReview: async (payload) => { saved.push(payload); return payload; }
  };
  await assert.rejects(
    () => approvePayrollControlEmployee({
      api, user: { full_name: 'מנהל' }, result: { month: '2026-05', comparisons: [changedComparison] },
      employeeId: '10', employeeName: 'דנה', confirmed: true,
      monthWorkflow: { workflowStatus: 'submitted', attendanceSubmissionStatus: 'submitted' }
    }),
    /האישור לא נשמר/
  );
  assert.equal(saved.length, 0);
});

test('successful write-back saves manager approval after PDF SharePoint and email artifacts', async () => {
  const sent = [];
  let artifactsPayload = null;
  let saved = null;
  const api = {
    attendanceControlUpdateRecord: async (recordId, fields) => { sent.push({ recordId, fields }); return { success: true }; },
    attendanceManagerApprovalArtifacts: async (payload) => {
      artifactsPayload = payload;
      return {
        sharepointWebUrl: 'https://think365orgil.sharepoint.com/file',
        sharepointItemId: 'item-1',
        fileName: payrollApprovalPdfFileName('דנה', '2026-05'),
        managerPdfVersion: 1,
        mailedAt: '2026-05-20T10:00:00.000Z'
      };
    },
    managerFinalizeAttendanceMonthReview: async (payload) => {
      saved = payload;
      return {
        ...payload,
        manager_approved_by_name: 'מנהל בדיקה',
        manager_approved_at: '2026-05-20T10:00:00.000Z',
        manager_pdf_sharepoint_url: payload.manager_pdf_sharepoint_url
      };
    }
  };
  const row = await approvePayrollControlEmployee({
    api, user: { full_name: 'מנהל בדיקה' }, result: { month: '2026-05', comparisons: [changedComparison] },
    employeeId: '10', employeeName: 'דנה', confirmed: true,
    monthWorkflow: {
      workflowStatus: 'submitted',
      attendanceSubmissionStatus: 'submitted',
      submittedByName: 'דנה',
      submittedAt: '2026-05-03T08:00:00.000Z'
    }
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].recordId, '77');
  assert.equal(sent[0].fields.startTime, '08:15');
  assert.equal(sent[0].fields.endTime, '09:00');
  assert.equal(sent[0].fields.attachmentsNames, 'scan.pdf');
  assert.equal(sent[0].fields.notes, 'הערה קיימת');
  assert.equal(sent[0].fields.totalExpenses, 0);
  assert.equal(artifactsPayload.month_key, '2026-05');
  assert.equal(artifactsPayload.approved_snapshot.rows[0].startTime, '08:15');
  assert.equal(artifactsPayload.approved_snapshot.rows[0].recordId, '77');
  assert.equal(saved.manager_pdf_sharepoint_url, 'https://think365orgil.sharepoint.com/file');
  assert.equal(saved.manager_pdf_file_name, 'דוח נוכחות - דנה - מאי 2026 - מאושר.pdf');
  assert.equal(row.status, 'manager_approved');
  assert.equal(row.mailed_at, '2026-05-20T10:00:00.000Z');
});

test('manager approval is blocked before employee month submission', async () => {
  const api = {
    attendanceControlUpdateRecord: async () => ({ success: true }),
    attendanceManagerApprovalArtifacts: async (payload) => payload,
    managerFinalizeAttendanceMonthReview: async (payload) => payload
  };
  await assert.rejects(
    () => approvePayrollControlEmployee({
      api,
      user: { full_name: 'מנהל בדיקה', role: 'operation_manager' },
      result: { month: '2026-05', comparisons: [changedComparison] },
      employeeId: '10',
      employeeName: 'דנה',
      confirmed: true,
      monthWorkflow: { workflowStatus: 'not_submitted', attendanceSubmissionStatus: 'open' }
    }),
    /לא ניתן לאשר מנהל לפני שהעובד השלים ואישר את החודש/
  );
});

test('manager approval without a submitted workflow is blocked even for admin', async () => {
  let saved = null;
  const api = {
    attendanceControlUpdateRecord: async () => ({ success: true }),
    attendanceManagerApprovalArtifacts: async (payload) => payload,
    managerFinalizeAttendanceMonthReview: async (payload) => { saved = payload; return payload; }
  };
  await assert.rejects(
    () => approvePayrollControlEmployee({
      api,
      user: { full_name: 'מנהל בדיקה', role: 'admin' },
      result: { month: '2026-05', comparisons: [changedComparison] },
      employeeId: '10',
      employeeName: 'דנה',
      confirmed: true,
      monthWorkflow: { workflowStatus: 'not_submitted', attendanceSubmissionStatus: 'open' }
    }),
    /לא ניתן לאשר מנהל לפני שהעובד השלים ואישר את החודש/
  );
  assert.equal(saved, null);
});

test('SharePoint or email artifact failure blocks manager approval save', async () => {
  let finalized = null;
  const api = {
    attendanceControlUpdateRecord: async () => ({ success: true }),
    attendanceManagerApprovalArtifacts: async () => {
      throw new Error('שמירת ה-PDF ב-SharePoint או שליחת המייל נכשלה. אישור המנהל לא נשמר.');
    },
    managerFinalizeAttendanceMonthReview: async (payload) => { finalized = payload; return payload; }
  };
  await assert.rejects(
    () => approvePayrollControlEmployee({
      api,
      user: { full_name: 'מנהל בדיקה' },
      result: { month: '2026-05', comparisons: [changedComparison] },
      employeeId: '10',
      employeeName: 'דנה',
      confirmed: true,
      monthWorkflow: { workflowStatus: 'submitted', attendanceSubmissionStatus: 'submitted' }
    }),
    /אישור המנהל לא נשמר/
  );
  assert.equal(finalized, null);
});

test('admin and finance can read payroll approvals', () => {
  assert.equal(canReadPayrollApprovals({ role: 'admin' }), true);
  assert.equal(canReadPayrollApprovals({ role: 'finance' }), true);
  assert.equal(canReadPayrollApprovals({ role: 'instructor' }), false);
});

test('users without payroll export permission cannot export excel', () => {
  assert.equal(canExportPayrollApprovals({ role: 'admin' }), true);
  assert.equal(canExportPayrollApprovals({ role: 'finance' }), true);
  assert.equal(canExportPayrollApprovals({ role: 'instructor' }), false);
  assert.equal(canExportPayrollApprovals({ role: 'instructor_manager' }), false);
  assert.throws(
    () => downloadPayrollApprovalsExcel([{ status: 'approved_for_payroll', approved_snapshot: { rows: [] } }], { role: 'instructor' }),
    /אין הרשאה לייצוא Excel לשכר/
  );
});

test('approval document is linked to the saved approval snapshot', () => {
  const approval = {
    id: 'appr-1',
    employee_id: '10',
    employee_name: 'דנה כהן',
    month_key: '2026-05',
    approved_by_name: 'מנהל בדיקה',
    approved_at: '2026-05-20T10:00:00.000Z',
    pdf_path: null,
    pdf_file_name: payrollApprovalPdfFileName('דנה כהן', '2026-05'),
    approved_snapshot: buildPayrollApprovedSnapshot({
      employeeId: '10', employeeName: 'דנה כהן', monthKey: '2026-05', entries: [changedComparison]
    })
  };
  const html = buildPayrollApprovalPrintHtml(approval);
  assert.equal(approval.pdf_file_name, 'דוח נוכחות - דנה כהן - מאי 2026 - מאושר.pdf');
  assert.equal(payrollApprovalPdfFileName('דנה כהן', '2026-05'), 'דוח נוכחות - דנה כהן - מאי 2026 - מאושר.pdf');
  assert.equal(payrollApprovalPdfFileName('דנה כהן', '2026-09', 2), 'דוח נוכחות - דנה כהן - ספטמבר 2026 - מאושר - 2.pdf');
  assert.equal(payrollHebrewMonthName('2026-09'), 'ספטמבר');
  assert.match(html, /דנה כהן/);
  assert.match(html, /מספר עובד: 10/);
  assert.match(html, /דוח נוכחות חודשי מאושר/);
  assert.match(html, /אישור מנהל: מנהל בדיקה/);
  assert.match(html, /08:15/);
});

test('payroll results include manager approval action after employee submit', () => {
  const html = resultsHtml({
    comparisons: [{ attendance: { employeeId: '10', employeeName: 'דנה', date: '2026-05-10', startTime: '08:00', endTime: '09:00', activityType: 'קורס' }, unmatched: false, differences: [], managerResolved: 'auto_ok' }],
    notCompared: [],
    dailyKilometers: []
  }, '2026-05', {
    workflowByEmployee: { '10': { workflow_status: 'submitted', attendance_submission_status: 'submitted' } }
  });
  assert.match(html, /אישור מנהל/);
  assert.match(html, /data-payroll-finish="10"/);
  assert.doesNotMatch(html, /סיום בדיקה ואישור להעברה לשכר/);
});

test('workflow mapping follows employee submit -> manager approved -> final approved', () => {
  assert.deepEqual(resolvePayrollMonthWorkflow({ attendance_submission_status: 'open' }), {
    status: 'not_submitted',
    label: 'פתוח לדיווח',
    submissionStatus: 'open'
  });
  assert.equal(resolvePayrollMonthWorkflow({ attendance_submission_status: 'submitted' }).status, 'submitted');
  assert.equal(resolvePayrollMonthWorkflow({ attendance_submission_status: 'submitted' }).label, 'אושר על ידי העובד / בבקרת מנהל');
  assert.equal(resolvePayrollMonthWorkflow({ attendance_submission_status: 'locked', manager_approved_at: '2026-05-20T10:00:00.000Z' }).status, 'manager_approved');
  assert.equal(resolvePayrollMonthWorkflow({ payroll_approved_at: '2026-05-20T10:00:00.000Z' }).status, 'approved');
});

test('finish approval controls are hidden before month submission and have no override', () => {
  const payload = {
    comparisons: [{ attendance: { employeeId: '10', employeeName: 'דנה', date: '2026-05-10', startTime: '08:00', endTime: '09:00', activityType: 'קורס' }, unmatched: false, differences: [], managerResolved: 'auto_ok' }],
    notCompared: [],
    dailyKilometers: []
  };
  const blocked = resultsHtml(payload, '2026-05', {
    workflowByEmployee: { '10': { workflow_status: 'not_submitted', attendance_submission_status: 'open' } }
  });
  assert.match(blocked, /סטטוס חודש: <strong>פתוח לדיווח<\/strong>/);
  assert.doesNotMatch(blocked, /data-payroll-finish="10"/);
  assert.match(blocked, /העובד טרם ביצע סיום דיווח ואישור לחודש זה/);
  assert.doesNotMatch(blocked, /data-payroll-finish-override="10"/);

  const withOverride = resultsHtml(payload, '2026-05', {
    workflowByEmployee: { '10': { workflow_status: 'not_submitted', attendance_submission_status: 'open' } },
    allowSubmissionOverride: true
  });
  assert.doesNotMatch(withOverride, /data-payroll-finish-override="10"/);
  assert.doesNotMatch(withOverride, /data-payroll-finish="10"/);
});

test('four attendance hours can match consecutive dashboard meetings 9 and 10', () => {
  const attendance = [{ employeeId: '10', date: '2026-05-10', startTime: '08:00', endTime: '12:00', workHours: 4, activityType: 'קורס', school: 'א', program: 'קורס א', meetingNo: '9,10', activityId: 'ACT1' }];
  const dashboard = [
    { employeeId: '10', date: '2026-05-10', startTime: '08:00', endTime: '10:00', workHours: 2, activityType: 'course', school: 'א', program: 'קורס א', meetingNo: '9', activityId: 'ACT1' },
    { employeeId: '10', date: '2026-05-10', startTime: '10:00', endTime: '12:00', workHours: 2, activityType: 'course', school: 'א', program: 'קורס א', meetingNo: '10', activityId: 'ACT1' }
  ];
  const result = compareAttendanceRows(attendance, dashboard);
  assert.equal(result.comparisons.length, 1);
  assert.equal(result.comparisons[0].unmatched, false);
  assert.equal(result.comparisons[0].differences.length, 0);
  assert.equal(result.comparisons[0].managerResolved, 'auto_ok');
});

test('consecutive meeting match does not bundle different activities', () => {
  const attendance = [{ employeeId: '10', date: '2026-05-10', startTime: '08:00', endTime: '12:00', workHours: 4, activityType: 'קורס', school: 'א', program: 'קורס א', meetingNo: '9,10' }];
  const dashboard = [
    { employeeId: '10', date: '2026-05-10', startTime: '08:00', endTime: '10:00', workHours: 2, activityType: 'course', school: 'א', program: 'קורס א', meetingNo: '9', activityId: 'A' },
    { employeeId: '10', date: '2026-05-10', startTime: '10:00', endTime: '12:00', workHours: 2, activityType: 'course', school: 'ב', program: 'קורס ב', meetingNo: '10', activityId: 'B' }
  ];
  const result = compareAttendanceRows(attendance, dashboard);
  assert.notEqual(result.comparisons[0]?.managerResolved, 'auto_ok');
});

test('attendance-only row can be approved as reported', () => {
  const entry = {
    id: 'attendance-only-1', source: 'attendance_not_compared',
    attendance: { employeeId: '10', employeeName: 'דנה', date: '2026-05-10', startTime: '08:00', endTime: '09:00', workHours: 1, activityType: 'ביטול זמן', _source: { ID: 88 } },
    final: { employeeId: '10', date: '2026-05-10', startTime: '08:00', endTime: '09:00', workHours: 1, activityType: 'ביטול זמן' },
    differences: []
  };
  assert.equal(attendanceEntryIsResolved(entry), false);
  approveAttendanceEntryAsReported(entry);
  assert.equal(attendanceEntryIsResolved(entry), true);
  assert.equal(collectChangedAttendanceUpdates([entry]).length, 0);
});

test('unmatched dashboard row can be approved as reported', () => {
  const entry = {
    id: 'row-1', attendance: { employeeId: '10', date: '2026-05-10', startTime: '08:00', endTime: '09:00', workHours: 1, activityType: 'קורס', _source: { ID: 89 } },
    final: { employeeId: '10', date: '2026-05-10', startTime: '08:00', endTime: '09:00', workHours: 1, activityType: 'קורס' },
    differences: [], unmatched: true
  };
  approveAttendanceEntryAsReported(entry);
  assert.equal(attendanceEntryIsResolved(entry), true);
  assert.equal(collectChangedAttendanceUpdates([entry]).length, 0);
});

test('dashboard work hours column does not use review label as a value', () => {
  const html = resultsHtml({
    comparisons: [{
      id: 'review-hours', managerResolved: null,
      attendance: { employeeId: '10', employeeName: 'דנה', date: '2026-05-10', startTime: '08:00', endTime: '12:15', workHours: 4.42, activityType: 'סדנה' },
      dashboard: { startTime: '08:00', endTime: '12:00', workHours: null, payrollHoursRequireReview: true, activityType: 'workshop' },
      final: { employeeId: '10', date: '2026-05-10', startTime: '08:00', endTime: '12:15', workHours: 4.42, activityType: 'סדנה' },
      differences: [], unmatched: false
    }],
    notCompared: [],
    dailyKilometers: []
  });
  assert.match(html, /לא ניתן לחשב/);
  assert.doesNotMatch(html, /<td[^>]*>לבדיקה<\/td>/);
});

test('finish approval is blocked while employee entries remain unresolved', () => {
  const result = {
    month: '2026-05',
    comparisons: [],
    notCompared: [{
      id: 'attendance-only-1', source: 'attendance_not_compared',
      attendance: { employeeId: '10', employeeName: 'דנה', date: '2026-05-10', startTime: '08:00', endTime: '09:00', workHours: 1, activityType: 'ביטול זמן' },
      final: { employeeId: '10', date: '2026-05-10', startTime: '08:00', endTime: '09:00', workHours: 1, activityType: 'ביטול זמן' },
      differences: []
    }]
  };
  assert.equal(payrollEmployeeHasUnresolvedEntries(result, '10'), true);
  approveAttendanceEntryAsReported(result.notCompared[0]);
  assert.equal(payrollEmployeeHasUnresolvedEntries(result, '10'), false);
});

test('canonical school match accepts name variants when school_id matches', () => {
  const context = buildPayrollIdentityContext({
    schoolLookup: {
      list: [
        { id: '2425', school_name: 'הרטוב', authority_id: '100', authority: 'רשות א' },
        { id: '1235', school_name: 'יצחק שמיר', authority_id: '101', authority: 'רשות ב' }
      ],
      byId: new Map([
        ['2425', { id: '2425', school_name: 'הרטוב', authority_id: '100', authority: 'רשות א' }],
        ['1235', { id: '1235', school_name: 'יצחק שמיר', authority_id: '101', authority: 'רשות ב' }]
      ])
    }
  });
  const base = { employeeId: '10', date: '2026-05-12', startTime: '08:00', endTime: '09:00', activityType: 'קורס' };
  const hartuv = compareAttendanceRows(
    [{ ...base, school: 'הרטוב היסודי', program: 'קורס' }],
    [{ ...base, school: 'הרטוב', schoolId: 2425, program: 'קורס' }],
    { identityContext: context }
  );
  assert.equal(hartuv.comparisons[0].differences.some((item) => item.key === 'school'), false);

  const shamir = compareAttendanceRows(
    [{ ...base, school: 'שמיר', program: 'קורס' }],
    [{ ...base, school: 'יצחק שמיר', schoolId: 1235, program: 'קורס' }],
    { identityContext: context }
  );
  assert.equal(shamir.comparisons[0].differences.some((item) => item.key === 'school'), false);
});

test('school alias lookup stays scoped by authority and does not merge same-name schools globally', () => {
  const context = buildPayrollIdentityContext({
    schoolLookup: {
      list: [
        { id: '3900', school_name: 'רמב"ם', authority_id: '10', authority: 'נהריה' },
        { id: '5001', school_name: 'רמב"ם', authority_id: '20', authority: 'חיפה' }
      ],
      byId: new Map([
        ['3900', { id: '3900', school_name: 'רמב"ם', authority_id: '10', authority: 'נהריה' }],
        ['5001', { id: '5001', school_name: 'רמב"ם', authority_id: '20', authority: 'חיפה' }]
      ])
    }
  });
  assert.equal(resolveSchoolIdForAuthority('רמב"ם', '10', context), '3900');
  assert.equal(resolveSchoolIdForAuthority('רמב"ם', '20', context), '5001');
  assert.notEqual(resolveSchoolIdForAuthority('רמב"ם', '10', context), resolveSchoolIdForAuthority('רמב"ם', '20', context));
});

test('program variants match when activity_no is shared', () => {
  const context = buildPayrollIdentityContext({
    activities: [{ activity_no: '53828', activity_name: 'ביומימיקרי לחטיבה' }],
    dashboardRows: [{ activityNo: '53828', program: 'ביומימיקרי לחטיבה' }]
  });
  const base = { employeeId: '10', date: '2026-05-12', startTime: '08:00', endTime: '09:00', school: 'א', activityType: 'קורס' };
  const result = compareAttendanceRows(
    [{ ...base, program: 'ביומימיקרי לחטיבות' }],
    [{ ...base, program: 'ביומימיקרי לחטיבה', activityNo: '53828' }],
    { identityContext: context }
  );
  assert.equal(result.comparisons[0].differences.some((item) => item.key === 'program'), false);
});

test('STEM category attendance accepts specific workshop when match is unambiguous', () => {
  const base = {
    employeeId: '10', date: '2026-05-12', startTime: '08:00', endTime: '09:00',
    school: 'בית ספר א', authority: 'רשות א', activityType: 'סדנה', meetingNo: '3'
  };
  const result = compareAttendanceRows(
    [{ ...base, program: 'סדנאות STEM' }],
    [{ ...base, program: 'אסטרונאוט על חוטים', activityId: 'WS-1', meetingNo: '3' }]
  );
  assert.equal(result.comparisons[0].unmatched, false);
  assert.equal(result.comparisons[0].differences.some((item) => item.key === 'program'), false);
});

test('conflicting school_id values remain a real mismatch', () => {
  const context = buildPayrollIdentityContext({
    schoolLookup: {
      list: [
        { id: '2425', school_name: 'הרטוב', authority_id: '100', authority: 'רשות א' },
        { id: '9999', school_name: 'הרטוב אחר', authority_id: '200', authority: 'רשות ב' }
      ],
      byId: new Map([
        ['2425', { id: '2425', school_name: 'הרטוב', authority_id: '100', authority: 'רשות א' }],
        ['9999', { id: '9999', school_name: 'הרטוב אחר', authority_id: '200', authority: 'רשות ב' }]
      ])
    }
  });
  const base = { employeeId: '10', date: '2026-05-12', startTime: '08:00', endTime: '09:00', program: 'קורס', activityType: 'קורס' };
  const result = compareAttendanceRows(
    [{ ...base, school: 'הרטוב היסודי' }],
    [{ ...base, school: 'הרטוב אחר', schoolId: 9999 }],
    { identityContext: context }
  );
  assert.equal(result.comparisons[0].differences.some((item) => item.key === 'school'), true);
});

// ── תקלה 1: SharePoint record ID אינו Dashboard activityId ────────────────
test('SharePoint record ID that coincidentally equals a dashboard activityId does not create a match', () => {
  const base = { employeeId: '20', date: '2026-05-15', startTime: '08:00', endTime: '09:00', activityType: 'קורס', workHours: 1 };
  const dashRow = { ...base, school: 'בית ספר א', activityId: '555' };
  // normalizeAttendanceApiRows stores ID as attendanceRecordId only — activityId is empty
  const attendanceRows = normalizeAttendanceApiRows([{
    employeeId: '20', employeeName: 'test', attendanceDate: '2026-05-15',
    startTime: '08:00', endTime: '09:00', workHours: 1,
    activityType: 'קורס', schoolName: 'בית ספר א', ID: 555 // same number as dashboard activityId
  }]);
  assert.equal(attendanceRows[0].activityId, '', 'activityId must be empty for API rows');
  const result = compareAttendanceRows(attendanceRows, [dashRow]);
  // Must match by school/time, not by activityId score 100
  const match = result.comparisons[0];
  // The match must not be identified as an activityId match — even if score is high from other fields
  assert.notEqual(match.identity, 'activityId', 'should not be matched via activityId — SharePoint ID is not a dashboard activity ID');
});

// ── תקלה 2: "מאיר" גלובלי ────────────────────────────────────────────────
test('"כוכב מאיר" is not normalized to "כוכב" — only prefix stripped cleanly', () => {
  const name = 'כוכב מאיר';
  const normalized = normalizeAttendanceName(name);
  assert.ok(normalized.includes('מאיר'), `"מאיר" must remain in normalized form, got: "${normalized}"`);
});

test('normalizeAttendanceName does not strip מאיר from unrelated names', () => {
  assert.ok(normalizeAttendanceName('גולדה מאיר').includes('מאיר'));
  assert.ok(normalizeAttendanceName('יאיר מאיר').includes('מאיר'));
});

// ── תקלה 3: school.city אינו alias של בית ספר ────────────────────────────
test('city name does not resolve as a school alias', () => {
  const context = buildPayrollIdentityContext({
    schoolLookup: {
      list: [{ id: '301', school_name: 'בית ספר אורים', city: 'תל אביב', authority_id: '50' }],
      byId: new Map([['301', { id: '301', school_name: 'בית ספר אורים', city: 'תל אביב', authority_id: '50' }]])
    }
  });
  // "תל אביב" is a city — must not resolve as school id '301'
  const resolved = resolveSchoolIdForAuthority('תל אביב', '50', context);
  assert.ok(!resolved || resolved !== '301', `city "תל אביב" must not resolve as school id "301", got: ${resolved}`);
});

// ── תקלה 4: שם בית ספר אינו alias של רשות ────────────────────────────────
test('school name is not added to the authority lookup', () => {
  const schoolName = 'בית ספר ממלכתי';
  const authorityName = 'רשות גדולה';
  const context = buildPayrollIdentityContext({
    schoolLookup: {
      list: [{ id: '400', school_name: schoolName, authority_id: '60' }],
      byId: new Map([['400', { id: '400', school_name: schoolName, authority_id: '60' }]])
    },
    authorityLookup: {
      list: [{ id: '60', authority_name: authorityName }],
      byId: new Map([['60', { id: '60', authority_name: authorityName }]])
    }
  });
  // Resolving school name as authority must NOT return authority '60'
  const base = { employeeId: '10', date: '2026-05-20', startTime: '09:00', endTime: '10:00', activityType: 'קורס', workHours: 1, school: schoolName, program: 'תוכנית' };
  const result = compareAttendanceRows(
    [{ ...base, authority: schoolName }],  // attendance claims schoolName as its authority
    [{ ...base, authority: authorityName }],
    { identityContext: context }
  );
  // School name should not match as an authority alias → should appear as a difference
  const diffs = result.comparisons[0].differences;
  assert.ok(diffs.some((d) => d.key === 'authority'), `school name must not resolve as authority alias; differences: ${JSON.stringify(diffs.map((d) => d.key))}`);
});

// ── תקלה 5: manager resolution gate — רשומה עם כמה differences ────────────
test('entry with 3 differences and only one decision remains unresolved', () => {
  const base = { employeeId: '10', date: '2026-05-21', startTime: '08:00', endTime: '09:00', activityType: 'קורס', workHours: 1, school: 'א', program: 'ב' };
  const result = compareAttendanceRows(
    [{ ...base, startTime: '07:45', endTime: '08:55', school: 'שגוי' }],
    [{ ...base }]
  );
  const entry = result.comparisons[0];
  assert.ok(entry.differences.length >= 2, 'test requires at least 2 differences');
  // Apply choice to only the first difference
  applyAttendanceChoice(entry, entry.differences[0].key, 'dashboard');
  assert.ok(!attendanceEntryIsResolved(entry), 'must remain unresolved while other differences are undecided');
  assert.notEqual(entry.managerResolved, 'corrected');
});

test('entry with multiple differences resolves only when all differences are decided', () => {
  const base = { employeeId: '10', date: '2026-05-22', startTime: '08:00', endTime: '09:00', activityType: 'קורס', workHours: 1, school: 'א', program: 'ב' };
  const result = compareAttendanceRows(
    [{ ...base, startTime: '07:45', endTime: '08:55', school: 'שגוי' }],
    [{ ...base }]
  );
  const entry = result.comparisons[0];
  for (const diff of entry.differences) applyAttendanceChoice(entry, diff.key, 'dashboard');
  assert.equal(entry.managerResolved, 'corrected');
  assert.ok(attendanceEntryIsResolved(entry));
});

// ── תקלה 6: ק"מ יומי — approval gate ────────────────────────────────────
test('daily km issue without decision blocks approval', async () => {
  const api = {
    attendanceControlUpdateRecord: async () => ({ success: true }),
    attendanceManagerApprovalArtifacts: async (p) => p,
    managerFinalizeAttendanceMonthReview: async (p) => p
  };
  const result = {
    month: '2026-05',
    comparisons: [{ ...changedComparison }],
    dailyKilometers: [{ employeeId: '10', date: '2026-05-10', reported: 30, calculated: 20, matches: false, hasReportedKm: true, managerResolved: null }]
  };
  await assert.rejects(
    () => approvePayrollControlEmployee({
      api, user: { full_name: 'מנהל' }, result, employeeId: '10', employeeName: 'דנה', confirmed: true,
      monthWorkflow: { workflowStatus: 'submitted', attendanceSubmissionStatus: 'submitted' }
    }),
    /רשומות נוכחות שלא קיבלו/
  );
});

test('daily km within tolerance is auto_ok and does not block approval', async () => {
  let saved = null;
  const api = {
    attendanceControlUpdateRecord: async () => ({ success: true }),
    attendanceManagerApprovalArtifacts: async () => ({
      sharepointWebUrl: 'https://think365orgil.sharepoint.com/file',
      sharepointItemId: 'item-1',
      fileName: 'report.pdf',
      managerPdfVersion: 1
    }),
    managerFinalizeAttendanceMonthReview: async (p) => { saved = p; return { ...p }; }
  };
  const result = {
    month: '2026-05',
    comparisons: [{ ...changedComparison }],
    dailyKilometers: [{ employeeId: '10', date: '2026-05-10', reported: 22, calculated: 20, matches: true, hasReportedKm: true, managerResolved: 'auto_ok' }]
  };
  await approvePayrollControlEmployee({
    api, user: { full_name: 'מנהל' }, result, employeeId: '10', employeeName: 'דנה', confirmed: true,
    monthWorkflow: { workflowStatus: 'submitted', attendanceSubmissionStatus: 'submitted' }
  });
  assert.ok(saved, 'approval snapshot should be saved when km is auto_ok');
});

test('km approved_as_reported marks day resolved without write-back', () => {
  const result = {
    month: '2026-05',
    comparisons: [],
    dailyKilometers: [{ employeeId: '10', date: '2026-05-10', reported: 30, calculated: 20, matches: false, hasReportedKm: true, managerResolved: null }]
  };
  assert.ok(result.dailyKilometers[0].managerResolved == null, 'starts unresolved');
  resolveKilometersDay(result, '10', '2026-05-10', 'approved_as_reported');
  assert.equal(result.dailyKilometers[0].managerResolved, 'approved_as_reported');
  assert.ok(!kmDayNeedsDecision(result.dailyKilometers[0]), 'must be resolved after manager approval');
  // No km correction updates (approved_as_reported = no write-back)
  const kmUpdates = collectKmCorrectionUpdates(result, '10');
  assert.equal(kmUpdates.length, 0, 'approved_as_reported must not generate write-back');
});

test('buildAttendanceUpdatePayload throws when Logic App field is absent from both source and fallback', () => {
  // Source has only a handful of fields; the fallback (attendance) also lacks most LOGIC_APP_FIELDS.
  // A write-back update must never send a partial payload to the Logic App.
  const entry = {
    attendance: {
      _source: { startTime: '09:00', endTime: '11:00', workHours: 2 },
      employeeId: '1', date: '2026-05-01', startTime: '09:00', endTime: '11:00', workHours: 2
    },
    final: {
      employeeId: '1', date: '2026-05-01', startTime: '09:00', endTime: '11:00', workHours: 3
    }
  };
  assert.throws(
    () => buildAttendanceUpdatePayload(entry),
    /חסר נתון מקור/,
    'must throw when Logic App fields are missing from both source and fallback'
  );
});

test('SharePoint payroll PDF uses the mapped personal folder, payroll subfolder, and reporting month', async () => {
  const source = await readFile(new URL('../supabase/functions/payroll-attendance-pdf-dispatch/index.ts', import.meta.url), 'utf8');
  assert.match(source, /instructor_employee_folders/);
  assert.match(source, /PAYROLL_SUBFOLDER = "04 דוחות שכר"/);
  assert.match(source, /hebrewMonthName\(monthKey\)/);
  assert.match(source, /schoolYearFromMonthKey/);
  assert.match(source, /conflictBehavior=fail/);
  assert.match(source, /"@microsoft\.graph\.conflictBehavior": "fail"/);
  assert.doesNotMatch(source, /דוחות נוכחות/);
  assert.doesNotMatch(source, /conflictBehavior": "replace"/);
});

test('admin payroll attendance tab is wired for final approval and unlock without deleting PDF history', async () => {
  const workspace = await readFile(new URL('../frontend/src/manager-board-workspace-runtime.js', import.meta.url), 'utf8');
  const board = await readFile(new URL('../frontend/src/manager-board-runtime.js', import.meta.url), 'utf8');
  const migration = await readFile(new URL('../supabase/migrations/20260819003500_attendance_month_manager_admin_flow.sql', import.meta.url), 'utf8');
  assert.match(board, /data-manager-workspace-tab="payroll-attendance"[^>]*>בקרת נוכחות אדמין</);
  assert.match(workspace, /activeTab === 'payroll-attendance'/);
  assert.match(workspace, /renderPayrollAttendanceAdmin/);
  assert.match(workspace, /adminFinalizeAttendanceMonthPayroll/);
  assert.match(workspace, /adminReopenAttendanceMonthForCorrection/);
  assert.match(workspace, /canUsePayrollAttendanceAdminTab\(\) \{\n  return role\(\) === 'admin';/);
  assert.match(migration, /manager_pdf_version is intentionally preserved/);
  assert.match(migration, /create or replace function public\.admin_finalize_attendance_month_payroll/);
  assert.doesNotMatch(migration, /delete from.*sharepoint/i);
});

test('employee month submit action stores the employee name and uses the final submit label', async () => {
  const home = await readFile(new URL('../attendance/src/screens/home-screen.js', import.meta.url), 'utf8');
  const service = await readFile(new URL('../attendance/src/services/attendance.service.js', import.meta.url), 'utf8');
  const gate = await readFile(new URL('../attendance/src/services/month-gate.service.js', import.meta.url), 'utf8');
  assert.match(home, /סיום דיווח ואישור/);
  assert.match(home, /submitMonth\(instructor\.empId, getMonthKey\(year, month\), instructor\?\.name \|\| ''\)/);
  assert.match(service, /submitted_by_name: String\(submittedByName \|\| ''\)\.trim\(\)/);
  assert.match(gate, /status === 'submitted'\) return false/);
  assert.match(gate, /העובד אישר את החודש/);
});
