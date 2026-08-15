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

test('LONG-073 Oshri Ram regression preserves local Excel dates and intentional double meetings', () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['מספר עובד', 'שם עובד', 'תאריך', 'שעת התחלה', 'שעת סיום', 'סוג פעילות', 'שם בית ספר', 'רשות', 'שם תכנית'],
    ['1524', 'אושרי רם', new Date(2026, 4, 25), '09:50', '11:20', 'קורס', 'טשרניחובסקי', 'נתניה', 'יישומי AI'],
    ['1524', 'אושרי רם', new Date(2026, 4, 18), '09:50', '11:20', 'קורס', 'טשרניחובסקי', 'נתניה', 'יישומי AI'],
    ['1524', 'אושרי רם', new Date(2026, 4, 11), '09:50', '11:20', 'קורס', 'טשרניחובסקי', 'נתניה', 'יישומי AI']
  ], { cellDates: true });
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, 'פירוט מלא');
  assert.deepEqual(parseAttendanceWorkbook(workbook).map((row) => row.date), ['2026-05-25', '2026-05-18', '2026-05-11']);

  const rows = buildDashboardAttendanceRows([{
    row_id: 'LONG-073', emp_id: '1524', emp_id_2: '1524',
    instructor_name: 'אושרי רם', instructor_name_2: 'אושרי רם', start_time: '09:50', end_time: '11:20',
    activity_name: 'יישומי AI', school: 'טשרניחובסקי', authority: 'נתניה', activity_type: 'course', notes: '4/5 שני מפגשים.',
    date_5: '2026-05-04', date_6: '2026-05-04'
  }]);
  assert.equal(rows.length, 2, 'both intentional meetings remain, while the duplicate instructor does not double them again');
  const aggregated = aggregateDashboardAttendanceRows(rows);
  assert.equal(aggregated.length, 1);
  assert.equal(aggregated[0].meetingCount, 2);
  assert.equal(aggregated[0].workHours, 3);
  assert.deepEqual(aggregated[0].meetingNumbers, ['1', '2']);
  const result = compareAttendanceRows([{
    employeeId: '1524', date: '2026-05-04', startTime: '09:50', endTime: '11:20', workHours: 3,
    program: 'יישומי AI', school: 'טשרניחובסקי', authority: 'נתניה', activityType: 'course', meetingNo: '1, 2'
  }], rows);
  const totals = attendanceAuditSummary(result);
  assert.equal(result.comparisons[0].differences.length, 0);
  assert.deepEqual({ before: totals.dashboardRowsBeforeProcessing, after: totals.dashboardRows, hours: totals.dashboardHours }, { before: 2, after: 1, hours: 3 });
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
