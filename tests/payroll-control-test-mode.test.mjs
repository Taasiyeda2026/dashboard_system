import test from 'node:test';
import assert from 'node:assert/strict';
import { compareAttendanceRows } from '../frontend/src/screens/attendance-control.js';
import {
  PAYROLL_TEST_MONTH,
  buildPayrollControlTestDataset
} from '../frontend/src/payroll-control-test-mode.js';

test('payroll test dataset is isolated to synthetic 2027 records', () => {
  const { attendanceRows, dashboardRows } = buildPayrollControlTestDataset();
  assert.equal(PAYROLL_TEST_MONTH, '2027-01');
  assert.equal(attendanceRows.length, 12);
  assert.equal(dashboardRows.length, 11);
  assert.ok([...attendanceRows, ...dashboardRows].every((row) => row.date.startsWith('2027-01-')));
  assert.ok([...attendanceRows, ...dashboardRows].every((row) => String(row.employeeId).startsWith('99')));
  const labels = new Set([...attendanceRows, ...dashboardRows].map((row) => String(row.program || '').slice(0, 3)));
  for (let index = 1; index <= 12; index += 1) {
    assert.ok(labels.has(`T${String(index).padStart(2, '0')}`), `missing T${String(index).padStart(2, '0')}`);
  }
});

test('payroll test dataset exercises matching, missing rows, attendance-only work and km audit states', () => {
  const { attendanceRows, dashboardRows } = buildPayrollControlTestDataset();
  const result = compareAttendanceRows(attendanceRows, dashboardRows);

  assert.equal(result.notCompared.length, 1);
  assert.equal(result.dashboardOnly.length, 1);
  assert.equal(result.comparisons.filter((row) => row.unmatched).length, 1);

  const kmMismatch = result.dailyKilometers.find((day) => day.date === '2027-01-07');
  assert.deepEqual(kmMismatch && { reported: kmMismatch.reported, calculated: kmMismatch.calculated, matches: kmMismatch.matches }, {
    reported: 30,
    calculated: 20,
    matches: false
  });

  const kmUnavailable = result.dailyKilometers.find((day) => day.date === '2027-01-08');
  assert.equal(kmUnavailable?.reported, 10);
  assert.equal(kmUnavailable?.calculated, null);

  const multiStopDay = result.dailyKilometers.find((day) => day.date === '2027-01-13');
  assert.deepEqual(multiStopDay && { reported: multiStopDay.reported, calculated: multiStopDay.calculated, matches: multiStopDay.matches }, {
    reported: 40,
    calculated: 40,
    matches: true
  });
});
