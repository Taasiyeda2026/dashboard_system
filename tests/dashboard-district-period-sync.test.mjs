import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const dashboardKpiSource = await readFile(new URL('../frontend/src/dashboard-kpi-corrections.js', import.meta.url), 'utf8');
const periodSelectorSource = await readFile(new URL('../frontend/src/activity-period-selector-access-hotfix.js', import.meta.url), 'utf8');

test('dashboard monthly activity projection includes district data', () => {
  assert.match(dashboardKpiSource, /'activity_manager', 'district'/);
  assert.match(dashboardKpiSource, /api\.allActivities\(\{ select: DASHBOARD_MONTH_ACTIVITY_COLUMNS \}\)/);
});

test('activity period selector delegates dashboard month selection to global state', () => {
  assert.match(periodSelectorSource, /setGlobalActivityPeriod\(effectiveInitialPeriod/);
  assert.match(periodSelectorSource, /setGlobalActivityPeriod\(selected\)/);
  assert.doesNotMatch(periodSelectorSource, /state\.dashboardMonthYm\s*=/);
});
