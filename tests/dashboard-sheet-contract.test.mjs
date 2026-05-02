/**
 * Contract: Dashboard screen reads only dashboardSheet; backend reads dashboard sheet once.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), 'utf8');

test('actionDashboardSheet_ exists and reads dashboard sheet with single getRange', async () => {
  const src = await read('backend/dashboard-sheet.gs');
  assert.match(src, /function actionDashboardSheet_\(/);
  assert.match(src, /getSheetByName\(DASHBOARD_SHEET_NAME_\)/);
  assert.match(src, /getRange\(1,\s*1,\s*DASHBOARD_SHEET_MAX_ROW_,\s*DASHBOARD_SHEET_MAX_COL_\)/);
  assert.match(src, /DASHBOARD_SHEET_MAX_ROW_\s*=\s*17/);
  assert.match(src, /DASHBOARD_SHEET_MAX_COL_\s*=\s*23/);
  const getRangeCount = (src.match(/\.getRange\(/g) || []).length;
  assert.equal(getRangeCount, 1, 'dashboard sheet path must use exactly one getRange');
});

test('actionDashboardSheet_ does not call heavy dashboard internals', async () => {
  const src = await read('backend/dashboard-sheet.gs');
  assert.doesNotMatch(src, /actionDashboard_\(/);
  assert.doesNotMatch(src, /data_short/i);
  assert.doesNotMatch(src, /data_long/i);
  assert.doesNotMatch(src, /activity_meetings/i);
  assert.doesNotMatch(src, /refreshDashboardSnapshots_/);
  assert.doesNotMatch(src, /refreshAllReadModels_/);
});

test('api.js exposes dashboardSheet and wires to request()', async () => {
  const src = await read('frontend/src/api.js');
  assert.match(src, /dashboardSheet:\s*\(filters\)\s*=>\s*request\(\s*['"]dashboardSheet['"]/);
});

test('dashboardScreen.load uses dashboardSheet', async () => {
  const src = await read('frontend/src/screens/dashboard.js');
  assert.match(src, /api\.dashboardSheet\(\{\s*month:\s*ym\s*\}\)/);
});

test('dashboard.js: month navigation and screen never use dashboardSnapshot or api.dashboard', async () => {
  const src = await read('frontend/src/screens/dashboard.js');
  assert.match(src, /api\.dashboardSheet\(\{\s*month:\s*nextYm\s*\}\)/);
  assert.doesNotMatch(src, /api\.dashboardSnapshot\s*\(/);
  assert.doesNotMatch(src, /api\.dashboard\s*\(\s*\{/);
});

test('actionDashboardSheet_ throws DASHBOARD_MONTH_NOT_FOUND when month missing', async () => {
  const src = await read('backend/dashboard-sheet.gs');
  assert.match(src, /throw new Error\('DASHBOARD_MONTH_NOT_FOUND:'/);
});

test('actionDashboardSheet_ only opens the dashboard sheet by name constant', async () => {
  const src = await read('backend/dashboard-sheet.gs');
  assert.match(src, /getSheetByName\(DASHBOARD_SHEET_NAME_\)/);
  assert.equal((src.match(/getSheetByName\(/g) || []).length, 1);
});

test('dashboard sheet layout documents three fixed table_range blocks', async () => {
  const src = await read('backend/dashboard-sheet.gs');
  assert.match(src, /table_range:\s*'A1:G17'/);
  assert.match(src, /table_range:\s*'I1:O17'/);
  assert.match(src, /table_range:\s*'Q1:W17'/);
});

test('payload contract marker _is_dashboard_sheet in backend result', async () => {
  const src = await read('backend/dashboard-sheet.gs');
  assert.match(src, /_is_dashboard_sheet:\s*true/);
});

test('Hebrew translation for missing dashboard month', async () => {
  const src = await read('frontend/src/screens/shared/ui-hebrew.js');
  assert.match(src, /DASHBOARD_MONTH_NOT_FOUND/);
  assert.match(src, /החודש שנבחר לא קיים בגיליון הדשבורד/);
});

test('router and api_read_write register dashboardSheet', async () => {
  const router = await read('backend/router.gs');
  const apiRw = await read('backend/api_read_write.gs');
  assert.match(router, /dashboardSheet:\s*'dashboard'/);
  assert.match(apiRw, /dashboardSheet:\s*function\(u,\s*p\)/);
});
