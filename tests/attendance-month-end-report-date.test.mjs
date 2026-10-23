import test from 'node:test';
import assert from 'node:assert/strict';
import { latestReportDate, canEditMonth } from '../attendance/src/services/month-gate.service.js';

for (const [year, month, days, firstAllowedDay] of [
  [2026, 10, 31, 27],
  [2026, 11, 30, 26],
  [2027, 2, 28, 24],
  [2028, 2, 29, 25],
  [2026, 12, 31, 27],
]) {
  test(`${year}-${month}: future dates open only in the final five calendar days`, () => {
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    for (let day = 1; day <= days; day++) {
      const now = new Date(year, month - 1, day, 12);
      const expectedDay = day < firstAllowedDay ? day : days;
      assert.equal(latestReportDate(now), `${monthKey}-${String(expectedDay).padStart(2, '0')}`, `day ${day}`);
    }
  });
}

test('month-end reporting never admits next month, including year rollover', () => {
  for (const [now, nextMonth] of [
    [new Date(2026, 9, 27, 12), '2026-11-01'],
    [new Date(2026, 11, 31, 12), '2027-01-01'],
    [new Date(2028, 1, 25, 12), '2028-03-01'],
  ]) {
    assert.ok(nextMonth > latestReportDate(now));
  }
  assert.equal(latestReportDate(new Date(2026, 10, 1, 0)), '2026-11-01');
});

test('month-end exception preserves month submission and approval locks', () => {
  const now = new Date(2026, 9, 27, 12);
  assert.equal(latestReportDate(now), '2026-10-31');
  for (const status of ['submitted', 'locked', 'approved_for_payroll']) {
    assert.equal(canEditMonth(2026, 10, { status }, now), false, status);
  }
  assert.equal(canEditMonth(2026, 10, null, now), true);
  assert.equal(canEditMonth(2026, 10, { status: 'reopened' }, now), true);
  assert.equal(canEditMonth(2026, 11, null, now), false);
});
