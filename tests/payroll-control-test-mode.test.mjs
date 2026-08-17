import test from 'node:test';
import assert from 'node:assert/strict';
import * as attendanceControl from '../frontend/src/screens/attendance-control.js';
import {
  PAYROLL_TEST_MONTH,
  buildPayrollControlTestSourceData,
  buildPayrollControlTestDataset
} from '../frontend/src/payroll-control-test-mode.js';

test('payroll test mode keeps Attendance and dashboard as separate source datasets', () => {
  const { attendanceRecords, dashboardSources } = buildPayrollControlTestSourceData();
  assert.equal(PAYROLL_TEST_MONTH, '2027-01');
  assert.equal(attendanceRecords.length, 16);
  assert.equal(dashboardSources.activities.length, 13);

  assert.ok(attendanceRecords.every((row) => String(row.attendanceDate).startsWith('2027-01-')));
  assert.ok(attendanceRecords.every((row) => String(row.employeeId).startsWith('99')));
  assert.ok(dashboardSources.activities.every((row) => String(row.emp_id).startsWith('99')));

  assert.ok(attendanceRecords.some((row) => Object.hasOwn(row, 'workHours')));
  assert.ok(attendanceRecords.some((row) => Object.hasOwn(row, 'totalExpenses')));
  assert.ok(dashboardSources.activities.every((row) => !Object.hasOwn(row, 'workHours')));
  assert.ok(dashboardSources.activities.every((row) => !Object.hasOwn(row, 'kilometers')));
  assert.ok(dashboardSources.activities.every((row) => Array.isArray(row.meetings)));
});

test('payroll test source reflects the real Attendance activity categories', () => {
  const { attendanceRecords } = buildPayrollControlTestSourceData();
  const types = new Set(attendanceRecords.map((row) => row.activityType));
  for (const type of ['קורס', 'ביטול זמן', 'הכשרה', 'סדנה', 'סדנאות קיץ', 'תפעול', 'סיור', 'חדר בריחה']) {
    assert.ok(types.has(type), `missing Attendance type ${type}`);
  }
});

test('test dataset uses the production normalization and dashboard derivation pipeline', () => {
  const { attendanceRows, dashboardRows } = buildPayrollControlTestDataset(attendanceControl);

  const reportedIndependentHours = attendanceRows.find((row) => row.program === 'T15 – שעות שכר מדווחות');
  assert.equal(reportedIndependentHours?.startTime, '08:00');
  assert.equal(reportedIndependentHours?.endTime, '14:00');
  assert.equal(reportedIndependentHours?.workHours, 5);

  const course45 = dashboardRows.find((row) => row.program === 'T01 – קורס 45 דקות');
  const course90 = dashboardRows.find((row) => row.program === 'T02 – קורס 90 דקות');
  assert.equal(course45?.workHours, 1);
  assert.equal(course90?.workHours, 2);

  const routeMismatch = dashboardRows.find((row) => row.program === 'T12 – פער ק״מ');
  const routeUnavailable = dashboardRows.find((row) => row.program === 'T13 – ק״מ לא ניתן לחישוב');
  const supportedExpense = dashboardRows.find((row) => row.program === 'T14 – הוצאה לאישור');
  assert.equal(routeMismatch?.kilometers, 20);
  assert.equal(routeUnavailable?.kilometers, null);
  assert.equal(supportedExpense?.expenses, 50);
});

test('comparison sees manual payroll rows, missing activity directions and km audit states', () => {
  const { attendanceRows, dashboardRows } = buildPayrollControlTestDataset(attendanceControl);
  const result = attendanceControl.compareAttendanceRows(attendanceRows, dashboardRows);

  const manualTypes = new Set(result.notCompared.map((row) => row.attendance.activityType));
  assert.deepEqual(manualTypes, new Set(['ביטול זמן', 'הכשרה', 'תפעול']));

  assert.ok(result.comparisons.some((row) => row.unmatched && row.attendance.program === 'T11 – נוכחות ללא דשבורד'));
  assert.ok(result.dashboardOnly.some((row) => row.dashboard.program === 'T11B – דשבורד ללא נוכחות'));

  const kmMismatch = result.dailyKilometers.find((day) => day.date === '2027-01-15');
  assert.deepEqual(kmMismatch && { reported: kmMismatch.reported, calculated: kmMismatch.calculated, matches: kmMismatch.matches }, {
    reported: 30,
    calculated: 20,
    matches: false
  });

  const kmUnavailable = result.dailyKilometers.find((day) => day.date === '2027-01-16');
  assert.equal(kmUnavailable?.reported, 10);
  assert.equal(kmUnavailable?.calculated, null);
});
