import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  summarizeFinanceAttendance,
  buildFinanceAttendanceWorkbook,
  buildMaofDailyExcelRows,
  auditFinanceAttendanceReconciliation,
  FINANCE_ATTENDANCE_GENERAL_SHEET,
  FINANCE_ATTENDANCE_EXPORT_MAOF,
  FINANCE_HOUR_CATEGORIES
} from '../frontend/src/screens/finance-attendance-summary.js';
import {
  buildPayrollApprovalsWorkbook
} from '../frontend/src/screens/payroll-control-finish.js';
import { formatDurationHours } from '../frontend/src/screens/attendance-control.js';

const exampleRows = [
  { date: '2026-09-01', activityType: 'תפעול', workHours: 0.50, expenses: 0 },
  { date: '2026-09-06', activityType: 'תפעול', workHours: 2.50, publicTransport: true, publicTransportCost: 89, expenses: 0 },
  { date: '2026-09-06', activityType: 'ביטול זמן', workHours: 0.53, expenses: 0 },
  { date: '2026-09-24', activityType: 'זום', workHours: 1.83, expenses: 0 }
];

function approved(employeeId = '1509', rows = exampleRows, employmentType = 'תעשיידע') {
  return {
    employee_id: employeeId,
    employee_name: 'מדריכה לבדיקה',
    status: 'approved_for_payroll',
    month_key: '2026-09',
    approved_snapshot: {
      employeeId,
      employeeName: 'מדריכה לבדיקה',
      employmentType,
      rows: rows.map((row) => ({
        ...row,
        employeeId,
        employeeName: 'מדריכה לבדיקה',
        employmentType,
        kilometers: 0
      }))
    }
  };
}
const aoa = (wb, sheet) => XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: true });

test('all approved Zoom hours and transit fares reconcile to the source snapshots', () => {
  const approvals = [approved()];
  const result = summarizeFinanceAttendance(approvals);
  const entry = result.rows[0];
  assert.equal(entry.hours.operations, 3);
  assert.equal(entry.hours.time_cancel, 0.53);
  assert.equal(entry.hours.zoom, 1.83);
  assert.equal(entry.totalHours, 5.36);
  assert.equal(entry.expenses, 0);
  assert.equal(entry.publicTransportCost, 89);
  assert.equal(entry.totalReimbursements, 89);
  assert.deepEqual(auditFinanceAttendanceReconciliation(result.rows, approvals), []);

  const workbook = buildFinanceAttendanceWorkbook(result.rows, { approvals });
  const data = aoa(workbook, FINANCE_ATTENDANCE_GENERAL_SHEET);
  const idx = (heading) => data[0].indexOf(heading);
  assert.ok(idx('עלות תחבורה ציבורית (₪)') >= 0);
  assert.equal(data[1][idx('עלות תחבורה ציבורית (₪)')], 89);
  assert.equal(data[1][idx('הוצאות')], 0);
  assert.equal(data[1][idx('סה״כ החזרים ללא ק״מ (₪)')], 89);
  assert.ok(Math.abs(data[1][idx('סה״כ שעות')] - 5.36 / 24) < 0.000001);
  assert.ok(Math.abs(data[1][idx('זום')] - 1.83 / 24) < 0.000001);
  assert.equal(FINANCE_HOUR_CATEGORIES.some((x) => x.key === 'zoom'), true);
});

test('unknown attendance types appear under review and never lose approved work hours', () => {
  const approvals = [approved('1001', [
    { date: '2026-09-10', activityType: 'חדר בריחה', workHours: 8, expenses: 0 },
    { date: '2026-09-11', activityType: 'קורס', workHours: 2, expenses: 0 }
  ])];
  const result = summarizeFinanceAttendance(approvals);
  assert.equal(result.rows[0].hours.uncategorized, 8);
  assert.equal(result.rows[0].hours.course, 2);
  assert.equal(result.rows[0].totalHours, 10);
  assert.deepEqual(result.unmappedActivityTypes, ['חדר בריחה']);
  assert.deepEqual(auditFinanceAttendanceReconciliation(result.rows, approvals), []);
});

test('payroll workbook refuses missing approved hours or missing transit reimbursements', () => {
  const approvals = [approved()];
  const original = summarizeFinanceAttendance(approvals).rows[0];
  assert.throws(
    () => buildFinanceAttendanceWorkbook([{ ...original, totalHours: 3.53 }], { approvals }),
    /ייצוא שכר נחסם/
  );
  assert.throws(
    () => buildFinanceAttendanceWorkbook([{ ...original, publicTransportCost: 0 }], { approvals }),
    /ייצוא שכר נחסם/
  );
  assert.throws(
    () => buildFinanceAttendanceWorkbook([{ ...original, hours: { ...original.hours, zoom: 0 } }], { approvals }),
    /ייצוא שכר נחסם/
  );
});

test('approved attendance monthly and daily sheets retain Zoom hours and public transport', () => {
  const workbook = buildPayrollApprovalsWorkbook([approved()]);
  const monthly = aoa(workbook, 'סיכום חודשי');
  const daily = aoa(workbook, 'תצוגה יומית');
  const col = (heading) => monthly[0].indexOf(heading);
  assert.equal(monthly[1][col('שעות זום')], formatDurationHours(1.83));
  assert.equal(monthly[1][col('סה"כ שעות')], formatDurationHours(5.36));
  assert.equal(monthly[1][col('עלות תחבורה ציבורית (₪)')], 89);
  assert.equal(monthly[1][col('סה"כ החזרים ללא ק"מ (₪)')], 89);
  const fareCol = daily[0].indexOf('עלות תחבורה ציבורית (₪)');
  assert.equal(daily.slice(1).reduce((sum, row) => sum + Number(row[fareCol] || 0), 0), 89);
});

test('Maof daily report includes transit fare exactly once when a day has multiple activity rows', () => {
  const approvals = [approved('1002', [
    { date: '2026-09-10', activityType: 'סדנה', workHours: 4, startTime: '09:00', endTime: '13:00', publicTransport: true, publicTransportCost: 12, expenses: 5 },
    { date: '2026-09-10', activityType: 'תפעול', workHours: 2, startTime: '14:00', endTime: '16:00', publicTransport: true, publicTransportCost: 18, expenses: 0 }
  ], 'מעוף')];
  const rows = buildMaofDailyExcelRows(approvals);
  assert.equal(rows.length, 2);
  assert.equal(rows.reduce((sum, row) => sum + Number(row['עלות תחבורה ציבורית (₪)'] || 0), 0), 30);
  assert.equal(rows.reduce((sum, row) => sum + Number(row['הוצאות (₪)'] || 0), 0), 5);
  assert.equal(rows.reduce((sum, row) => sum + Number(row['סה״כ החזרים ללא ק״מ (₪)'] || 0), 0), 35);
  assert.deepEqual(auditFinanceAttendanceReconciliation([], approvals, FINANCE_ATTENDANCE_EXPORT_MAOF), []);
});
