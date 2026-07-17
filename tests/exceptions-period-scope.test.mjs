import { test } from 'node:test';
import assert from 'node:assert/strict';

import { activityMatchesPeriodKey } from '../frontend/src/screens/shared/summer-activity.js';

const storage = () => ({ getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} });
globalThis.sessionStorage ||= storage();
globalThis.localStorage ||= storage();

const { getActivityExceptions, isActivityInPreparation } = await import('../frontend/src/api.js');

const incompleteActivity = {
  RowID: 'school-2027-1',
  activity_name: 'פעילות ללא נתונים',
  activity_season: 'school_2027',
  status: 'היערכות'
};

test('preparation activities never produce exception rows or instances', () => {
  assert.equal(isActivityInPreparation(incompleteActivity), true);
  const result = getActivityExceptions([incompleteActivity], '2027-01');
  assert.equal(result.rows.length, 0);
  assert.equal(result.instances.length, 0);
});

test('an activity returns to normal exception calculation after preparation', () => {
  const result = getActivityExceptions([{ ...incompleteActivity, status: 'פתוח' }], '2027-01');
  assert.equal(result.rows.length, 1);
  assert.ok(result.rows[0].exception_types.includes('missing_instructor'));
  assert.ok(result.rows[0].exception_types.includes('missing_start_date'));
  assert.ok(result.rows[0].exception_types.includes('missing_end_date'));
});

test('global activity periods separate school 2027 from 2026 including summer 2026', () => {
  const school2027 = { activity_season: 'school_2027' };
  const school2026 = { activity_season: 'regular' };
  const summer2026 = { activity_season: 'summer_2026' };

  assert.equal(activityMatchesPeriodKey(school2027, 'regular'), false);
  assert.equal(activityMatchesPeriodKey(school2027, 'school_2027'), true);
  assert.equal(activityMatchesPeriodKey(school2026, 'school_2027'), false);
  assert.equal(activityMatchesPeriodKey(summer2026, 'regular'), true);
});

test('exceptions request and cache are scoped by the selected global activity period', async () => {
  const screenSource = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../frontend/src/screens/exceptions.js', import.meta.url), 'utf8'));
  const apiSource = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8'));
  const mainSource = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../frontend/src/main.js', import.meta.url), 'utf8'));

  assert.match(screenSource, /api\.exceptions\(\{ month, activity_period: state\?\.activityPeriodTab \}\)/);
  assert.match(apiSource, /const periodRows = filterRowsByGlobalActivityPeriod\(allRows, activityPeriod\);/);
  assert.match(apiSource, /buildExceptionsModelFromRows\(periodRows, month,/);
  assert.match(mainSource, /if \(route === 'exceptions'\) \{\s*return withActivityPeriod\(route\);/);
});
