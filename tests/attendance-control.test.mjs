import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { normalizeAttendanceName, calculateWorkHours, buildDashboardAttendanceRows, compareAttendanceRows, applyAttendanceChoice, buildCorrectedAttendanceWorkbook, DETAIL_HEADERS, MONTHLY_HEADERS, DAILY_HEADERS } from '../frontend/src/screens/attendance-control.js';

test('attendance normalization tolerates punctuation, quotes, spacing and common suffixes', () => {
  assert.equal(normalizeAttendanceName(' רמב״ם '), normalizeAttendanceName('רמבם'));
  assert.equal(normalizeAttendanceName('גולדה מאיר'), normalizeAttendanceName('גולדה'));
});

test('dashboard export expands meetings and both assigned instructors', () => {
  const rows = buildDashboardAttendanceRows([{ row_id: 'ACT-1', activity_name: 'רובוטיקה', activity_type: 'קורס', school: 'רמבם', authority: 'חיפה', emp_id: '10', instructor_name: 'דנה', emp_id_2: '11', instructor_name_2: 'נועם', start_time: '08:00', end_time: '09:30', meetings: [{ date: '2026-08-01', meeting_no: 1 }, { date: '2026-08-08', meeting_no: 2 }] }], [{ emp_id: '10', employment_type: 'תעשיידע' }, { emp_id: '11', employment_type: 'כוח אדם' }]);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((row) => row.meetingNo), [1, 1, 2, 2]);
  assert.equal(rows[1].employmentType, 'כוח אדם');
});

test('attendance population controls comparison and final choices recalculate hours', () => {
  const attendance = [{ employeeId: '10', employeeName: 'דנה', date: '2026-08-01', startTime: '09:00', endTime: '10:00', program: 'גולדה מאיר', school: 'רמב״ם', authority: 'חיפה', meetingNo: '1', kilometers: 48, expenses: 35 }];
  const dashboard = [{ employeeId: '10', employeeName: 'דנה', date: '2026-08-01', startTime: '08:30', endTime: '10:00', program: 'גולדה', school: 'רמבם', authority: 'חיפה', meetingNo: '1', kilometers: 42, expenses: 0, employmentType: 'תעשיידע' }, { employeeId: '99', employeeName: 'לא באוכלוסייה', date: '2026-08-01', startTime: '08:00', endTime: '09:00' }];
  const result = compareAttendanceRows(attendance, dashboard);
  assert.equal(result.dashboardPopulation.length, 1);
  assert.deepEqual(result.comparisons[0].differences.map((item) => item.key), ['startTime', 'kilometers', 'expenses']);
  applyAttendanceChoice(result.comparisons[0], 'startTime', 'dashboard');
  assert.equal(result.comparisons[0].final.workHours, 1.5);
  assert.equal(calculateWorkHours('23:30', '01:00'), 1.5);
});

test('corrected workbook creates the three required sheets from final detail data', () => {
  const comparisons = [{ final: { employeeId: '10', employeeName: 'דנה', date: '2026-08-01', startTime: '08:00', endTime: '10:00', activityType: 'קורס', authority: 'חיפה', kilometers: 12, expenses: 5, expenseDetails: 'חניה' } }, { final: { employeeId: '11', employeeName: 'נועם', date: '2026-08-02', startTime: '09:00', endTime: '10:00', activityType: 'תפעול', authority: 'חיפה', kilometers: 3, expenses: 0 } }];
  const workbook = buildCorrectedAttendanceWorkbook(comparisons, [{ employeeId: '10', employmentType: 'תעשיידע' }, { employeeId: '11', employmentType: 'כוח אדם' }]);
  assert.deepEqual(workbook.SheetNames, ['פירוט מלא', 'סיכום חודשי', 'תצוגה יומית']);
  assert.deepEqual(XLSX.utils.sheet_to_json(workbook.Sheets['פירוט מלא'], { header: 1 })[0], DETAIL_HEADERS);
  assert.deepEqual(XLSX.utils.sheet_to_json(workbook.Sheets['סיכום חודשי'], { header: 1 })[0], MONTHLY_HEADERS);
  assert.deepEqual(XLSX.utils.sheet_to_json(workbook.Sheets['תצוגה יומית'], { header: 1 })[0], DAILY_HEADERS);
  assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets['סיכום חודשי'], { header: 1 })[1][8], 2);
  assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets['תצוגה יומית'], { header: 1 })[1][7], 1);
});
