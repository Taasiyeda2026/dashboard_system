import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  attendanceControlHtml, resultsHtml, normalizeAttendanceName, calculateWorkHours,
  buildDashboardAttendanceRows, attendanceDateScope, loadAttendanceDashboardDataset,
  attendanceMonthLabel, filterAttendanceRowsByMonth, attendanceExportFilename,
  applyDashboardRouteKilometers, applyDashboardExpenses, compareAttendanceRows, applyAttendanceChoice,
  setDashboardOnlyChoice, buildCorrectedAttendanceWorkbook, parseAttendanceWorkbook, attendanceAuditSummary, aggregateDashboardAttendanceRows,
  DETAIL_HEADERS, MONTHLY_HEADERS, DAILY_HEADERS
} from '../frontend/src/screens/attendance-control.js';

test('attendance control asks for one attendance workbook and no dashboard workbook', () => {
  const html = attendanceControlHtml();
  assert.match(html, /העלאת קובץ נוכחות/);
  assert.equal((html.match(/type="file"/g) || []).length, 1);
  assert.doesNotMatch(html, /data-attendance-dashboard/);
  assert.match(html, /data-attendance-month/);
  assert.match(html, /data-attendance-run disabled/);
});

test('attendance control cannot run without an explicitly selected month', () => {
  assert.throws(() => filterAttendanceRowsByMonth([], ''), /יש לבחור חודש לבדיקה/);
});

test('selecting July excludes August attendance rows', () => {
  const rows = filterAttendanceRowsByMonth([{ employeeId: '10', date: '2026-07-31' }, { employeeId: '10', date: '2026-08-01' }], '2026-07');
  assert.deepEqual(rows.map((row) => row.date), ['2026-07-31']);
});

test('July title, summary and export name use the explicitly selected month', () => {
  assert.equal(attendanceMonthLabel('2026-07'), 'יולי 2026');
  assert.equal(attendanceExportFilename('2026-07'), 'דוח_נוכחות_מתוקן_יולי_2026.xlsx');
  assert.match(resultsHtml({ comparisons: [], dashboardOnly: [] }, '2026-07'), /חודש הבדיקה: <b>יולי 2026<\/b>/);
  assert.match(attendanceControlHtml(), /data-attendance-title>בקרת נוכחות/);
});

test('a workbook without July attendance produces the clear selected-month message', () => {
  const rows = filterAttendanceRowsByMonth([{ employeeId: '10', date: '2026-08-01' }], '2026-07');
  assert.equal(rows.length, 0);
  assert.equal(`לא נמצאו דיווחי נוכחות עבור ${attendanceMonthLabel('2026-07')}`, 'לא נמצאו דיווחי נוכחות עבור יולי 2026');
});

test('attendance normalization tolerates punctuation, quotes, spacing and common suffixes', () => {
  assert.equal(normalizeAttendanceName(' רמב״ם '), normalizeAttendanceName('רמבם'));
  assert.equal(normalizeAttendanceName('גולדה מאיר'), normalizeAttendanceName('גולדה'));
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
  // notCompared rows are now woven into each employee's chronological timeline.
  // Each such row carries the inline label "לא נבדק מול פעילות", not a separate section header.
  const html = resultsHtml(result);
  assert.match(html, /נשמר ברצף יום העבודה/, 'attendance-only rows must appear inline in the daily timeline');
  // The old separate section (<section class="attendance-control__not-compared">) must no longer exist.
  assert.doesNotMatch(html, /attendance-control__not-compared/, 'no separate notCompared section must be rendered');
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

test('employee 1522 course attendance bundles two after-school activities without type mismatch', () => {
  const attendance = [{ employeeId: '1522', date: '2026-05-18', startTime: '13:00', endTime: '16:00', workHours: 3, school: 'אלתרמן', program: 'אפטרסקול', activityType: 'קורס' }];
  const dashboard = ['AFTER-1', 'AFTER-2'].map((activityId, index) => ({ employeeId: '1522', date: '2026-05-18', activityId, startTime: index ? '14:30' : '13:00', endTime: index ? '16:00' : '14:30', workHours: 1.5, school: 'אלתרמן', program: 'אפטרסקול', activityType: 'after_school' }));
  const result = compareAttendanceRows(attendance, dashboard);
  assert.equal(result.comparisons[0].dashboard.componentRows.length, 2);
  assert.equal(result.comparisons[0].differences.some((difference) => difference.key === 'activityType'), false);
  assert.equal(result.dashboardOnly.length, 0);
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
  assert.match(resultsHtml(mismatch), /פער 60 דקות/);

  const timeOnly = compareAttendanceRows([{ employeeId: '1524', date: base.date, startTime: base.startTime, endTime: base.endTime }], [{ employeeId: '1524', date: base.date, startTime: base.startTime, endTime: base.endTime }]);
  assert.equal(timeOnly.comparisons[0].unmatched, true, 'identical hours alone are insufficient');

  const badCandidate = compareAttendanceRows([base], [{ ...base, startTime: '14:00', endTime: '16:00', school: 'אחר', authority: 'אחר', program: 'אחר', activityType: 'סיור' }]);
  assert.equal(badCandidate.comparisons[0].unmatched, true);
  assert.equal(badCandidate.dashboardOnly.length, 1);
  const totals = attendanceAuditSummary(badCandidate);
  assert.equal(totals.unmatchedAttendance, 1);
  assert.equal(totals.unmatchedDashboard, 1);
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
  assert.match(html, /מופיע בדשבורד ולא נמצא בנוכחות/);
  assert.match(html, /להוסיף לנתונים הסופיים/);
  let workbook = buildCorrectedAttendanceWorkbook([...result.comparisons, ...result.dashboardOnly], result.dashboardPopulation);
  assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets['פירוט מלא'], { header: 1 }).length, 2);
  setDashboardOnlyChoice(result.dashboardOnly[0], true);
  workbook = buildCorrectedAttendanceWorkbook([...result.comparisons, ...result.dashboardOnly], result.dashboardPopulation);
  const detail = XLSX.utils.sheet_to_json(workbook.Sheets['פירוט מלא'], { header: 1 });
  assert.equal(detail.length, 3);
  assert.equal(detail[2][9], 'שני');
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

  assert.equal((html.match(/✓ תקין/g) || []).length, 6);
  assert.equal((html.match(/⚠ אי־התאמה בנתונים \/ דורש טיפול/g) || []).length, 1);
  assert.equal((html.match(/⚠ לא נמצאה פעילות תואמת/g) || []).length, 1);
  assert.match(html, /חריגות <b>2<\/b>/);
  assert.equal((html.match(/<span>לבדיקה<\/span>/g) || []).length, 2);
  assert.equal((html.match(/data-attendance-choice/g) || []).length, 2);
  assert.match(html, /אף מועמד לא עבר את סף ההתאמה/);
});

test('a fully matching row has a normal status and no decision control', () => {
  const row = { employeeId: '10', employeeName: 'דנה', date: '2026-08-01', startTime: '08:00', endTime: '09:00', program: 'קורס' };
  const html = resultsHtml(compareAttendanceRows([row], [{ ...row }]));
  assert.match(html, /attendance-control__day--ok/);
  assert.match(html, /✓ תקין/);
  assert.doesNotMatch(html, /data-attendance-choice/);
  assert.match(html, /חריגות <b>0<\/b>/);
});

test('attendance, dashboard and manual choices preserve independent payroll hours', () => {
  const comparison = compareAttendanceRows([{ employeeId: '10', date: '2026-08-01', startTime: '09:00', endTime: '10:00', program: 'קורס', school: 'אלונים', kilometers: 4 }], [{ employeeId: '10', date: '2026-08-01', startTime: '08:30', endTime: '11:00', program: 'קורס', school: 'אלונים', kilometers: 7 }]).comparisons[0];
  applyAttendanceChoice(comparison, 'startTime', 'dashboard');
  applyAttendanceChoice(comparison, 'endTime', 'custom', '10:30');
  applyAttendanceChoice(comparison, 'kilometers', 'attendance');
  assert.equal(comparison.final.workHours, 1, 'time decisions must preserve the original payroll duration');
  assert.equal(comparison.final.kilometers, 4);
  assert.equal(calculateWorkHours('23:30', '01:00'), 1.5);
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
  for (const [type, minutes, expected] of [['course', 45, 1], ['workshop', 45, 1], ['tour', 90, 2]]) {
    const endTime = minutes === 45 ? '08:45' : '09:30';
    const [row] = buildDashboardAttendanceRows([{ row_id: `PAY-${type}`, emp_id: '10', activity_type: type, start_time: '08:00', end_time: endTime, date_1: '2026-05-12' }]);
    assert.equal(row.workHours, expected, `${type} ${minutes} minutes`);
    assert.equal(row.payrollHoursRequireReview, false);
  }
});

test('nonstandard dashboard duration is not converted into invented payroll hours', () => {
  const [row] = buildDashboardAttendanceRows([{ row_id: 'PAY-85', emp_id: '10', activity_type: 'workshop', start_time: '08:00', end_time: '09:25', date_1: '2026-05-12' }]);
  assert.equal(row.workHours, null);
  assert.equal(row.payrollHoursRequireReview, true);
  const attendance = [{ ...row, workHours: 2, activityType: 'סדנה', school: 'אלונים' }];
  const result = compareAttendanceRows(attendance, [{ ...row, school: 'אלונים' }]);
  assert.equal(result.comparisons[0].differences.some((difference) => difference.key === 'workHours'), false);
  assert.match(resultsHtml(result), /שעות השכר נשארו לבדיקת מנהל/);
});

test('work-hours gap is formatted as time and never labelled ק״מ', () => {
  const attendance = [{ employeeId: '10', date: '2026-05-12', startTime: '08:00', endTime: '10:00', activityType: 'קורס', authority: 'חיפה', program: 'תכנית א', workHours: 2.5 }];
  const dashboard  = [{ employeeId: '10', date: '2026-05-12', startTime: '08:00', endTime: '10:00', activityType: 'קורס', authority: 'חיפה', program: 'תכנית א', workHours: 2.0 }];
  const result = compareAttendanceRows(attendance, dashboard);
  const html = resultsHtml(result, '2026-05');
  assert.ok(!html.includes('ק״מ') || html.indexOf('פער ק"מ') > -1, 'workHours diff must not use ק״מ as its unit');
  assert.ok(html.includes('דקות') || html.includes('שעות'), 'workHours diff must show time units');
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
  assert.equal((html.match(/<details class="attendance-control__employee">/g) || []).length, 1);
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
  assert.deepEqual(result.dailyKilometers[0], { employeeId: '10', date: '2026-05-12', reported: 24, calculated: 24, matches: true });
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
    assert.match(resultsHtml(result), /ק״מ לבדיקה/);
  }
});
