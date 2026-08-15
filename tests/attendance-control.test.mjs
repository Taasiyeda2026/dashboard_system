import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  attendanceControlHtml, resultsHtml, normalizeAttendanceName, calculateWorkHours,
  buildDashboardAttendanceRows, attendanceDateScope, loadAttendanceDashboardDataset,
  applyDashboardRouteKilometers, applyDashboardExpenses, compareAttendanceRows, applyAttendanceChoice,
  setDashboardOnlyChoice, buildCorrectedAttendanceWorkbook, DETAIL_HEADERS, MONTHLY_HEADERS, DAILY_HEADERS
} from '../frontend/src/screens/attendance-control.js';

test('attendance control asks for one attendance workbook and no dashboard workbook', () => {
  const html = attendanceControlHtml();
  assert.match(html, /העלאת קובץ נוכחות/);
  assert.equal((html.match(/type="file"/g) || []).length, 1);
  assert.doesNotMatch(html, /data-attendance-dashboard/);
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

test('dashboard meetings expand for both assigned instructors', () => {
  const rows = buildDashboardAttendanceRows([{ row_id: 'ACT-1', emp_id: '10', instructor_name: 'דנה', emp_id_2: '11', instructor_name_2: 'נועם', meetings: [{ date: '2026-08-01', meeting_no: 1 }, { date: '2026-08-08', meeting_no: 2 }] }], [{ emp_id: '10', employment_type: 'תעשיידע' }, { emp_id: '11', employment_type: 'כוח אדם' }]);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((row) => row.meetingNo), [1, 1, 2, 2]);
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

test('population, multiple same-day matching and all six compared fields are preserved', () => {
  const attendance = [{ employeeId: '10', date: '2026-08-01', startTime: '09:00', endTime: '10:00', program: 'אלפא', school: 'רמב״ם', authority: 'חיפה', activityType: 'קורס', meetingNo: '4', kilometers: 48, expenses: 35 }];
  const dashboard = [
    { employeeId: '10', date: '2026-08-01', startTime: '08:30', endTime: '10:30', program: 'אלפא אחר', school: 'רמבם', authority: 'חיפה', activityType: 'קורס', meetingNo: '5', kilometers: 42, expenses: 0 },
    { employeeId: '10', date: '2026-08-01', startTime: '15:00', endTime: '16:00', program: 'רחוק', school: 'אחר', authority: 'אחר' },
    { employeeId: '99', date: '2026-08-01', startTime: '09:00', endTime: '10:00' }
  ];
  const result = compareAttendanceRows(attendance, dashboard);
  assert.equal(result.dashboardPopulation.some((row) => row.employeeId === '99'), false);
  assert.equal(result.comparisons[0].dashboard.program, 'אלפא אחר');
  assert.deepEqual(result.comparisons[0].differences.map((item) => item.key), ['startTime', 'endTime', 'program', 'meetingNo', 'kilometers', 'expenses']);
});

test('attendance, dashboard and manual choices recalculate final work hours', () => {
  const comparison = compareAttendanceRows([{ employeeId: '10', date: '2026-08-01', startTime: '09:00', endTime: '10:00', kilometers: 4 }], [{ employeeId: '10', date: '2026-08-01', startTime: '08:30', endTime: '11:00', kilometers: 7 }]).comparisons[0];
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
