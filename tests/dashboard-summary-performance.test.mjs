import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const storage = () => ({ getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} });
globalThis.sessionStorage ||= storage();
globalThis.localStorage ||= storage();

test('dashboard summary stays on the central read model without allActivities or exceptions wrappers', async () => {
  const [apiSource, loaderSource] = await Promise.all([
    readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8'),
    readFile(new URL('../frontend/src/feature-loaders.js', import.meta.url), 'utf8')
  ]);
  const readModel = apiSource.slice(apiSource.indexOf('async function dashboardReadModelFromSupabase'), apiSource.indexOf('function emptyDashboardPayload'));
  assert.equal((readModel.match(/selectActivitiesFromSupabase\(/g) || []).length, 1);
  assert.doesNotMatch(readModel, /api\.allActivities|api\.exceptions/);
  assert.doesNotMatch(loaderSource, /dashboard-kpi-corrections|dashboard-exception-count-hotfix/);
});

test('endings retain the existing course and after-school-only rule', async () => {
  const { isDashboardEndingActivity } = await import('../frontend/src/api.js');
  assert.equal(isDashboardEndingActivity({ activity_type: 'course', end_date: '2027-04-10' }, '2027-04'), true);
  assert.equal(isDashboardEndingActivity({ activity_type: 'after_school', end_date: '2027-04-11' }, '2027-04'), true);
  for (const activity_type of ['workshop', 'tour', 'escape_room']) {
    assert.equal(isDashboardEndingActivity({ activity_type, end_date: '2027-04-10' }, '2027-04'), false);
  }
});
