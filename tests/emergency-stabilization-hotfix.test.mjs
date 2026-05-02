import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const CONFIG_FILE = new URL('../frontend/src/config.js', import.meta.url);
const DASHBOARD_FILE = new URL('../frontend/src/screens/dashboard.js', import.meta.url);
const MAIN_FILE = new URL('../frontend/src/main.js', import.meta.url);
const API_FILE = new URL('../frontend/src/api.js', import.meta.url);
const ROUTER_FILE = new URL('../backend/router.gs', import.meta.url);
const ACTIONS_FILE = new URL('../backend/actions.gs', import.meta.url);
const API_READ_WRITE_FILE = new URL('../backend/api_read_write.gs', import.meta.url);
const DEPLOY_SCRIPT_FILE = new URL('../scripts/apps_script_snapshot_ops.mjs', import.meta.url);

async function read(url) { return readFile(url, 'utf8'); }

test('hotfix config pins diagnostics off and v2 marker', async () => {
  const src = await read(CONFIG_FILE);
  assert.match(src, /DIAGNOSTICS_UI_ENABLED:\s*false/);
  assert.match(src, /HOTFIX_VERSION:\s*'emergency-disable-diagnostics-v2'/);
});

test('dashboard load and render do not auto-run diagnostics', async () => {
  const src = await read(DASHBOARD_FILE);
  assert.doesNotMatch(src, /data-stage2c|run-stage2c|stop-stage2c/);
  assert.doesNotMatch(src, /diagnosticsConsistency\(/);
  assert.doesNotMatch(src, /DIAGNOSTICS_UI_ENABLED && isAdminOpsUser/);
});

test('frontend does not render hotfix/build marker text in header UI', async () => {
  const src = await read(MAIN_FILE);
  assert.match(src, /__HOTFIX_VERSION__/);
  assert.match(src, /emergency-disable-diagnostics-v2/);
  assert.doesNotMatch(src, /title="hotfix version"/);
  assert.doesNotMatch(src, /title="frontend build marker"/);
});

test('frontend keeps background refresh toggle (post-stabilization default off)', async () => {
  const src = await read(MAIN_FILE);
  assert.match(src, /const STABILITY_HOTFIX_DISABLE_BACKGROUND_REFRESH = false/);
});

test('login success flow forces first-route render and emits explicit lifecycle logs', async () => {
  const src = await read(MAIN_FILE);
  assert.match(src, /\[login-success\]/);
  assert.match(src, /\[first-route-render:start\]/);
  assert.match(src, /\[first-route-render:success\]/);
  assert.match(src, /\[first-route-render:failed\]/);
  assert.match(src, /renderShellLoadingImmediately\(\);[\s\S]*scheduleRender\(\);[\s\S]*mountScreen\(\)/);
});

test('route render flow reports start\/success\/failed and never silently leaves loading screen', async () => {
  const src = await read(MAIN_FILE);
  assert.match(src, /\[route-render:start\]/);
  assert.match(src, /\[route-render:success\]/);
  assert.match(src, /\[route-render:failed\]/);
  assert.match(src, /if \(afterText === 'טוען נתונים\.\.\.'\) \{\s*throw new Error\('render_stuck_on_loading'\);/);
});

test('deploymentInfo action exists and returns static read-only deployment identity', async () => {
  const router = await read(ROUTER_FILE);
  const actions = await read(ACTIONS_FILE);
  const apiRw = await read(API_READ_WRITE_FILE);
  assert.match(router, /deploymentInfo:\s*'dashboard'/);
  assert.match(apiRw, /deploymentInfo:\s*function\(u,\s*p\)\s*\{[\s\S]*return actionDeploymentInfo_\(u\)/);
  assert.match(actions, /function actionDeploymentInfo_\(user\) \{/);
  assert.match(actions, /backendVersion:\s*'emergency-disable-diagnostics-v2'/);
  assert.match(actions, /hasLocalDiagnosticsParsers:\s*true/);
  assert.match(actions, /diagnosticsEnabled:\s*false/);
  assert.match(actions, /readModelsEnabled:\s*(true|false)/);
});

test('deploymentInfo implementation is lightweight and avoids heavy dependencies', async () => {
  const actions = await read(ACTIONS_FILE);
  const fn = actions.match(/function actionDeploymentInfo_\(user\) \{[\s\S]*?\n\}/);
  assert.ok(fn, 'actionDeploymentInfo_ function should exist');
  assert.doesNotMatch(fn[0], /allActivitiesSummary_|SpreadsheetApp|DriveApp|CacheService|diagnosticsConsistency/);
});

test('deploy sync script includes backend actions/helpers/router files', async () => {
  const src = await read(DEPLOY_SCRIPT_FILE);
  assert.match(src, /readdirSync\(backendDir\)\.filter\(\(f\) => f\.endsWith\('\.gs'\)\)/);
  assert.match(src, /for \(const rel of localBackendFiles\)/);
});

test('frontend API does not expose diagnosticsConsistency as public api method', async () => {
  const src = await read(API_FILE);
  const exportsBlock = src.match(/export const api = \{[\s\S]*?\n\};/);
  assert.ok(exportsBlock);
  assert.doesNotMatch(exportsBlock[0], /diagnosticsConsistency:/);
});
