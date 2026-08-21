import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const dashboardKpiSource = await readFile(new URL('../frontend/src/dashboard-kpi-corrections.js', import.meta.url), 'utf8');
const periodSelectorSource = await readFile(new URL('../frontend/src/activity-period-selector-access-hotfix.js', import.meta.url), 'utf8');

test('dashboard monthly activity projection includes district data', () => {
  assert.match(dashboardKpiSource, /'activity_manager', 'district'/);
  assert.match(dashboardKpiSource, /api\.allActivities\(\{ select: DASHBOARD_MONTH_ACTIVITY_COLUMNS \}\)/);
});

test('school 2027 period syncs dashboard month to its first valid month', () => {
  assert.match(periodSelectorSource, /defaultMonthForGlobalActivityPeriod/);
  assert.match(periodSelectorSource, /syncDashboardMonthToPeriod\(initialPeriod\)/);
  assert.match(periodSelectorSource, /syncDashboardMonthToPeriod\(selected\)/);
});
