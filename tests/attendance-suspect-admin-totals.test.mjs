import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdminAttendanceTotals, adminAttendanceTotalsHtml } from '../frontend/src/admin-attendance-totals.js';

test('October 2026 Hanaa-style clock values do not inflate admin attendance totals', () => {
  const values = [[570,690],[900,1035],[450,690],[480,690]];
  const records = values.map(([before,after],i) => ({
    id: 'clock-' + i, employeeId: '1503', attendanceDate: '2026-10-13',
    activityType: 'קורס', workHours: 2, kilometers: 20,
    reportedCancellationBeforeMinutes: before, reportedCancellationAfterMinutes: after
  }));
  const totals = buildAdminAttendanceTotals(records, { monthKey: '2026-10', employeeIds: ['1503'] });
  assert.equal(totals.suspectCancellationCount, 4);
  assert.equal(totals.hoursByType.get('ביטול זמן'), 0);
  assert.equal(totals.totalHours, 8);
  assert.equal(totals.totalKilometers, 80);
  assert.match(adminAttendanceTotalsHtml(totals, '2026-10'), /ביטול זמן חריג/);
});
