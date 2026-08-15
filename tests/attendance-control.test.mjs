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
  assert.equal(aggregated[0].workHours, 3);
  assert.deepEqual(aggregated[0].meetingNumbers, ['5', '6']);
  const result = compareAttendanceRows([{
    employeeId: '1524', employeeName: 'אושרי רם', date: '2026-05-04', startTime: '08:00', endTime: '12:00', workHours: 4,
    program: 'יישומי AI', school: 'אלתרמן', authority: 'נתניה', activityType: 'קורס', meetingNo: '5'
  }], rows);
  const totals = attendanceAuditSummary(result);
  assert.equal(result.comparisons[0].unmatched, false);
  assert.deepEqual(result.comparisons[0].differences.map((difference) => difference.key), ['endTime', 'workHours', 'school', 'meetingNo']);
  assert.deepEqual({ before: totals.dashboardRowsBeforeProcessing, after: totals.dashboardRows, hours: totals.dashboardHours }, { before: 2, after: 1, hours: 3 });
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
  assert.match(resultsHtml(result), /דיווחים שאינם נבדקים מול פעילות/);
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
  assert.deepEqual(result.comparisons[0].differences.map((item) => item.key), ['startTime', 'endTime', 'workHours', 'program', 'meetingNo', 'kilometers', 'expenses']);
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
  assert.match(html, /<span>2 חריגות<\/span>/);
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

test('attendance, dashboard and manual choices recalculate final work hours', () => {
  const comparison = compareAttendanceRows([{ employeeId: '10', date: '2026-08-01', startTime: '09:00', endTime: '10:00', program: 'קורס', school: 'אלונים', kilometers: 4 }], [{ employeeId: '10', date: '2026-08-01', startTime: '08:30', endTime: '11:00', program: 'קורס', school: 'אלונים', kilometers: 7 }]).comparisons[0];
  applyAttendanceChoice(comparison, 'startTime', 'dashboard');
  applyAttendanceChoice(comparison, 'endTime', 'custom', '10:30');
  applyAttendanceChoice(comparison, 'kilometers', 'attendance');
  assert.equal(comparison.final.workHours, 2);
  assert.equal(comparison.final.kilometers, 4);
  assert.equal(calculateWorkHours('23:30', '01:00'), 1.5);
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
