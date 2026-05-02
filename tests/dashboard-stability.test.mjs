/**
 * Post–PR #240 dashboard stability: routes, snapshot API, stale banners, nav loading, lockfile.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const DASHBOARD_JS = new URL('../frontend/src/screens/dashboard.js', import.meta.url);
const PKG_JSON = new URL('../package.json', import.meta.url);
const PKG_LOCK = new URL('../package-lock.json', import.meta.url);

async function readText(url) {
  return readFile(url, 'utf8');
}

test('dashboard.js: no legacy end_dates route token', async () => {
  const src = await readText(DASHBOARD_JS);
  assert.doesNotMatch(src, /\bend_dates\b/, 'must not use end_dates; official route is end-dates');
});

test('dashboard.js: KPI endings navigates to end-dates', async () => {
  const src = await readText(DASHBOARD_JS);
  assert.match(src, /kpi\|endings[\s\S]{0,400}state\.route\s*=\s*['"]end-dates['"]/);
});

test('dashboard.js: uses dashboardSheet, not bare api.dashboard', async () => {
  const src = await readText(DASHBOARD_JS);
  assert.match(src, /api\.dashboardSheet\s*\(/, 'must load via dashboardSheet');
  assert.doesNotMatch(
    src,
    /api\.dashboard\s*\(\s*\{/,
    'must not call api.dashboard({ — use dashboardSheet only'
  );
});

test('dashboard.js: stale banner covers read model, is_stale, and snapshot unavailable', async () => {
  const src = await readText(DASHBOARD_JS);
  assert.match(src, /_read_model_stale/);
  assert.match(src, /_is_stale/);
  assert.match(src, /_snapshot_unavailable/);
  assert.match(src, /נתוני לוח הבקרה מתעדכנים כעת/);
  assert.match(src, /מוצגים נתוני מטמון אחרונים/);
});

test('dashboard.js: applyYm resets dashboardNavLoading in finally', async () => {
  const src = await readText(DASHBOARD_JS);
  const start = src.indexOf('const applyYm = async');
  const end = src.indexOf("root.querySelector('[data-dash-month-prev]')");
  assert.ok(start >= 0 && end > start, 'applyYm and month-prev handler must exist');
  const block = src.slice(start, end);
  const iTry = block.indexOf('try {');
  const iFinally = block.indexOf('finally {');
  const iClear = block.indexOf('state.dashboardNavLoading = false');
  assert.ok(iTry >= 0 && iFinally > iTry && iClear > iFinally, 'applyYm must use try/finally and clear loading in finally');
});

test('package-lock.json root devDependencies lists xlsx like package.json', async () => {
  const [lockRaw, pkgRaw] = await Promise.all([readText(PKG_LOCK), readText(PKG_JSON)]);
  const lock = JSON.parse(lockRaw);
  const pkg = JSON.parse(pkgRaw);
  assert.ok(lock.packages && lock.packages[''], 'lockfile must have packages[""]');
  const rootDev = lock.packages[''].devDependencies || {};
  assert.ok(pkg.devDependencies && pkg.devDependencies.xlsx, 'package.json should declare xlsx in devDependencies');
  assert.ok(
    rootDev.xlsx,
    `package-lock root devDependencies must include xlsx (got: ${Object.keys(rootDev).join(', ')})`
  );
});
