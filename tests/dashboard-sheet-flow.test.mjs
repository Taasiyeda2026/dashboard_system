import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboardScreen = fs.readFileSync(new URL('../frontend/src/screens/dashboard.js', import.meta.url), 'utf8');
const apiFile = fs.readFileSync(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
const actions = fs.readFileSync(new URL('../backend/actions.gs', import.meta.url), 'utf8');
const apiReadWrite = fs.readFileSync(new URL('../backend/api_read_write.gs', import.meta.url), 'utf8');


test('dashboard screen uses dashboardSnapshot (not dashboardSheet)', () => {
  assert.match(dashboardScreen, /api\.dashboardSnapshot\(\{ month: ym \}\)/);
  assert.match(dashboardScreen, /api\.dashboardSnapshot\(\{ month: nextYm \}\)/);
  assert.doesNotMatch(dashboardScreen, /api\.dashboardSheet\(/);
  assert.doesNotMatch(dashboardScreen, /api\.dashboard\(/);
});

test('frontend api exposes dashboardSheet action', () => {
  assert.match(apiFile, /dashboardSheet:\s*\(filters\)\s*=>\s*request\('dashboardSheet', filters \|\| \{\}\)/);
});

test('actionDashboardSheet_ uses fixed dashboard range and no heavy fallback sources', () => {
  const fn = actions.match(/function actionDashboardSheet_[\s\S]*?\n}\n/);
  assert.ok(fn, 'missing actionDashboardSheet_');
  const body = fn[0];
  assert.match(body, /getSheetByName\('dashboard'\)/);
  assert.match(body, /rangeA1\s*=\s*'A1:X64'/);
  assert.match(body, /getRange\(rangeA1\)\.getValues\(\)/);
  assert.doesNotMatch(body, /actionDashboard_\(/);
  assert.doesNotMatch(body, /refreshDashboardSnapshots_/);
  assert.doesNotMatch(body, /refreshAllReadModels_/);
  assert.doesNotMatch(body, /data_short|data_long|activity_meetings/);
});

test('actionDashboardSheet_ returns controlled month-missing error and expected payload fields', () => {
  const fn = actions.match(/function actionDashboardSheet_[\s\S]*?\n}\n/)[0];
  assert.match(fn, /throw new Error\('DASHBOARD_MONTH_NOT_FOUND:' \+ ym\)/);
  assert.match(fn, /month:\s*ym/);
  assert.match(fn, /totals:/);
  assert.match(fn, /by_activity_manager:/);
  assert.match(fn, /summary:/);
  assert.match(fn, /kpi_cards:/);
  assert.match(fn, /_is_dashboard_sheet:\s*true/);
});

test('backend routes dashboardSheet as read action', () => {
  assert.match(apiReadWrite, /dashboardSheet:\s*true/);
  assert.match(apiReadWrite, /dashboardSheet:\s*function\(u, p\)\s*\{\s*return actionDashboardSheet_\(u, p\);\s*}/s);
});
