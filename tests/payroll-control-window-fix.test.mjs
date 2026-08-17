import test from 'node:test';
import assert from 'node:assert/strict';
import {
  payrollMonthPickerYears,
  payrollTeamDisplayLabel,
  shouldHidePayrollTeamOption
} from '../frontend/src/payroll-control-window-fix.js';

test('team picker removes only the redundant generic הכל option', () => {
  assert.equal(shouldHidePayrollTeamOption('הכל', 'הכל'), true);
  assert.equal(shouldHidePayrollTeamOption('כל הצוותים', '__all__'), false);
  assert.equal(shouldHidePayrollTeamOption('גיל', 'גיל'), false);
});

test('legacy Linoy team is displayed as Hila while keeping the underlying team value available', () => {
  assert.equal(payrollTeamDisplayLabel('לינוי'), 'הילה');
  assert.equal(payrollTeamDisplayLabel('לינוי שמואל מזרחי'), 'הילה');
  assert.equal(payrollTeamDisplayLabel('גיל'), 'גיל');
  assert.equal(payrollTeamDisplayLabel('הילה'), 'הילה');
});

test('month picker year range is compact and includes an existing selected year', () => {
  assert.deepEqual(payrollMonthPickerYears(new Date('2026-08-17T00:00:00Z'), '2021-05'), [2021, 2024, 2025, 2026, 2027, 2028, 2029]);
});
