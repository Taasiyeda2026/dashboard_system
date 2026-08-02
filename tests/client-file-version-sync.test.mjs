import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  beginLoginServiceWorkerUpdate,
  LOGIN_SW_RELOAD_GUARD_KEY
} from '../frontend/src/login-service-worker-update.js';

const SW_FILE = new URL('../frontend/sw.js', import.meta.url);
const CONFIG_FILE = new URL('../frontend/src/config.js', import.meta.url);
const LOGIN_FILE = new URL('../frontend/src/screens/login.js', import.meta.url);
const LOGIN_SW_UPDATE_FILE = new URL('../frontend/src/login-service-worker-update.js', import.meta.url);
const INDEX_FILE = new URL('../index.html', import.meta.url);
const DASHBOARD_CSS_FILE = new URL('../frontend/src/styles/dashboard-layout.css', import.meta.url);
const ENTRY_FILE = new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url);
const ANNUAL_REVIEW_PRINT_FILE = new URL('../frontend/src/annual-reviews-isolated-print.js', import.meta.url);

class MockEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type) {
    for (const listener of this.listeners.get(type) || []) listener();
  }
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); }
  };
}

test('service worker and client-file hotfix versions are current and structurally valid', async () => {
  const [sw, config, login, loginUpdate] = await Promise.all([
    readFile(SW_FILE, 'utf8'),
    readFile(CONFIG_FILE, 'utf8'),
    readFile(LOGIN_FILE, 'utf8'),
    readFile(LOGIN_SW_UPDATE_FILE, 'utf8')
  ]);

  const cacheVersion = Number(sw.match(/const CACHE_VERSION = (\d+);/)?.[1] || 0);
  assert.ok(Number.isInteger(cacheVersion) && cacheVersion >= 1362, 'CACHE_VERSION must include the scheduling requirements simplification rollout');

  const hotfixVersion = config.match(/HOTFIX_VERSION:\s*'([^']+)'/)?.[1] || '';
  assert.ok(hotfixVersion.trim(), 'HOTFIX_VERSION must be defined');
  assert.match(
    hotfixVersion,
    /(?:proposal-pdf-(?:svg-origin-clean|storage-key)|client-contact-secure-rpc)/,
    'HOTFIX_VERSION must describe a supported current client hotfix generation'
  );
  assert.match(hotfixVersion, /activity-drawer-cache-20260727-v1/, 'HOTFIX_VERSION must clear persisted screen data after the activity drawer redesign');
  assert.match(hotfixVersion, /performance-cache-20260727-v1/, 'HOTFIX_VERSION must clear persisted data for the performance cache rollout');
  assert.match(hotfixVersion, /login-sw-refresh-20260729-v1/, 'HOTFIX_VERSION must identify the automatic login refresh rollout');
  assert.match(hotfixVersion, /annual-review-isolated-print-20260730-v2/, 'HOTFIX_VERSION must identify isolated annual review printing');
  assert.match(hotfixVersion, /2026-readonly-complete-history-20260802-v1/, 'HOTFIX_VERSION must identify the 2026 read-only history rollout');
  assert.match(hotfixVersion, /proposal-type-tashpaz-totals-20260802-v1/, 'HOTFIX_VERSION must identify the proposal type and תשפ״ז totals rollout');
  assert.match(hotfixVersion, /proposal-pdf-full-document-20260802-v1/, 'HOTFIX_VERSION must identify the full proposal PDF document fix');
  assert.match(hotfixVersion, /simplify-activity-scheduling-requirements-20260802-v1/, 'HOTFIX_VERSION must identify the activity scheduling requirements simplification');

  assert.match(login, /beginLoginServiceWorkerUpdate\(\)/);
  assert.match(login, /await onLogin\(userId, code, errorNode\);[\s\S]*await serviceWorkerUpdate\.reloadIfUpdated\(\);/);
  assert.match(loginUpdate, /serviceWorker\.getRegistration\(\)/);
  assert.match(loginUpdate, /registration\.update\(\)/);
  assert.match(loginUpdate, /controllerchange/);
  assert.match(loginUpdate, /SKIP_WAITING/);
  assert.match(loginUpdate, /LOGIN_SW_RELOAD_GUARD_KEY/);

  const installBlock = sw.match(/self\.addEventListener\('install',[\s\S]*?\n\}\);/)?.[0] || '';
  assert.doesNotMatch(installBlock, /deleteOutdatedCaches\(/);
  assert.match(sw, /self\.addEventListener\('activate'[\s\S]*deleteOutdatedCaches\(/);
  assert.match(sw, /clients\.claim/);
  assert.match(sw, /isApiLikeUrl/);
});

test('login update reloads once only after a newer worker controls the page', async () => {
  const serviceWorker = new MockEventTarget();
  serviceWorker.controller = { id: 'old-controller' };
  const oldActive = { id: 'old-active' };
  const newActive = { id: 'new-active' };
  const registration = {
    active: oldActive,
    waiting: null,
    installing: null,
    async update() {
      registration.active = newActive;
      queueMicrotask(() => serviceWorker.dispatch('controllerchange'));
      return registration;
    }
  };
  serviceWorker.getRegistration = async () => registration;

  let reloadCount = 0;
  const storage = memoryStorage();
  const attempt = beginLoginServiceWorkerUpdate({
    navigatorRef: { serviceWorker },
    windowRef: { location: { reload() { reloadCount += 1; } } },
    sessionStorageRef: storage,
    now: () => 1_000_000,
    updateCheckTimeoutMs: 50,
    activationTimeoutMs: 50,
    postLoginWaitMs: 100
  });

  assert.equal(await attempt.reloadIfUpdated(), true);
  assert.equal(reloadCount, 1);
  assert.equal(storage.getItem(LOGIN_SW_RELOAD_GUARD_KEY), '1000000');
});

test('login update does not reload when there is no newer worker', async () => {
  const serviceWorker = new MockEventTarget();
  serviceWorker.controller = { id: 'controller' };
  const registration = {
    active: { id: 'active' },
    waiting: null,
    installing: null,
    async update() { return registration; }
  };
  serviceWorker.getRegistration = async () => registration;

  let reloadCount = 0;
  const attempt = beginLoginServiceWorkerUpdate({
    navigatorRef: { serviceWorker },
    windowRef: { location: { reload() { reloadCount += 1; } } },
    sessionStorageRef: memoryStorage(),
    updateCheckTimeoutMs: 50,
    activationTimeoutMs: 50,
    postLoginWaitMs: 100
  });

  assert.equal(await attempt.reloadIfUpdated(), false);
  assert.equal(reloadCount, 0);
});

test('login update guard prevents a reload loop in the same tab', async () => {
  const serviceWorker = new MockEventTarget();
  serviceWorker.controller = { id: 'old-controller' };
  const registration = {
    active: { id: 'old-active' },
    waiting: null,
    installing: null,
    async update() {
      registration.active = { id: 'new-active' };
      queueMicrotask(() => serviceWorker.dispatch('controllerchange'));
      return registration;
    }
  };
  serviceWorker.getRegistration = async () => registration;

  let reloadCount = 0;
  const attempt = beginLoginServiceWorkerUpdate({
    navigatorRef: { serviceWorker },
    windowRef: { location: { reload() { reloadCount += 1; } } },
    sessionStorageRef: memoryStorage({ [LOGIN_SW_RELOAD_GUARD_KEY]: '990000' }),
    now: () => 1_000_000,
    updateCheckTimeoutMs: 50,
    activationTimeoutMs: 50,
    postLoginWaitMs: 100
  });

  assert.equal(await attempt.reloadIfUpdated(), false);
  assert.equal(reloadCount, 0);
});

test('dashboard layout stylesheet is loaded and keeps the intended responsive structure', async () => {
  const [indexHtml, dashboardCss] = await Promise.all([
    readFile(INDEX_FILE, 'utf8'),
    readFile(DASHBOARD_CSS_FILE, 'utf8')
  ]);

  const sharedStylesheetIndex = indexHtml.indexOf('./frontend/src/styles/main.css');
  const dashboardStylesheetIndex = indexHtml.indexOf('./frontend/src/styles/dashboard-layout.css');

  assert.ok(sharedStylesheetIndex >= 0, 'main.css must remain linked');
  assert.ok(dashboardStylesheetIndex > sharedStylesheetIndex, 'dashboard layout must load after main.css');
  assert.match(dashboardCss, /#app \.screen-root:has\(\.ds-dashboard-wrap\)\s*\{[\s\S]*zoom:\s*1;/);
  assert.match(dashboardCss, /#app \.ds-dashboard-wrap\s*\{[\s\S]*width:\s*100%;[\s\S]*max-width:\s*1180px;[\s\S]*zoom:\s*0\.75;/);
  assert.doesNotMatch(dashboardCss, /#app \.ds-dashboard-wrap\s*\{[\s\S]*width:\s*125%;/);
  assert.match(dashboardCss, /\.ds-dashboard-kpi-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\);/);
  assert.match(dashboardCss, /\.ds-dashboard-kpi-grid--row2\s*\{[\s\S]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(dashboardCss, /\.ds-manager-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(dashboardCss, /@media \(max-width: 720px\)[\s\S]*\.ds-manager-grid\s*\{[\s\S]*grid-template-columns:\s*1fr;/);
});

test('annual review printing uses a compact management-document layout', async () => {
  const [indexHtml, featureLoaders, printRuntime] = await Promise.all([
    readFile(INDEX_FILE, 'utf8'),
    readFile(new URL('../frontend/src/feature-loaders.js', import.meta.url), 'utf8'),
    readFile(ANNUAL_REVIEW_PRINT_FILE, 'utf8')
  ]);

  assert.match(indexHtml, /main-with-proposal-pdf-hotfix\.js\?v=20260802-scheduling-requirements-v1/);
  assert.match(indexHtml, /styles\/main\.css\?v=20260802-scheduling-requirements-v1/);
  assert.match(featureLoaders, /annual-reviews-isolated-print\.js\?v=20260730-compact-print-v4/);
  assert.match(printRuntime, /window\.open\('', name/);
  assert.match(printRuntime, /doc\.write\(buildPrintDocument\(sourceRoot\)\)/);
  assert.match(printRuntime, /event\.stopImmediatePropagation\(\)/);
  assert.match(printRuntime, /printWindow\.print\(\)/);
  assert.match(printRuntime, /function buildGoalsTable/);
  assert.match(printRuntime, /ar2-print-goals-table/);
  assert.match(printRuntime, /ar2-print-question-heading/);
  assert.match(printRuntime, /\.ar2-question__prompt \{ display: none !important; \}/);
  assert.match(printRuntime, /cloneRoot\.querySelectorAll\('\.ar2-status'\)/);
  assert.match(printRuntime, /@page \{ size: A4 portrait; margin: 10mm; \}/);
  assert.doesNotMatch(printRuntime, /data-ar2-isolated-print-frame|headResourcesHtml|opacity:\s*0/);
});
