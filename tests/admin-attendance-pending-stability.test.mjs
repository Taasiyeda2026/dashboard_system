import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let moduleSequence = 0;
let state;
let api;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function installDom(body = '<main id="app"></main>') {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${body}</body></html>`, {
    url: 'https://example.test/',
    pretendToBeVisual: true
  });
  const globals = [
    'window', 'document', 'Element', 'HTMLElement', 'HTMLInputElement', 'Node',
    'MutationObserver', 'CustomEvent', 'Event', 'MouseEvent', 'localStorage', 'sessionStorage'
  ];
  for (const key of globals) globalThis[key] = dom.window[key];
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  if (state) {
    state.user = { role: 'admin', full_name: 'Admin Test' };
    state.route = 'admin-home';
  }
  return dom;
}

installDom();
({ state } = await import('../frontend/src/state.js'));
({ api } = await import('../frontend/src/api.js'));

async function importRuntime() {
  moduleSequence += 1;
  return import(`../frontend/src/admin-attendance-standalone.js?pending-stability=${moduleSequence}`);
}

async function settle(ms = 45) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function tileMarkup({ legacy = false } = {}) {
  const attrs = legacy
    ? 'data-admin-hub-manager-tab="payroll-attendance" data-manager-board-open="true"'
    : 'data-admin-attendance-open="true"';
  return `<button type="button" class="admin-management-tile" ${attrs}>
    <span class="admin-management-tile__content"><strong>נוכחות</strong><small>בקרת נוכחות</small></span>
  </button>`;
}

test('pending badge DOM is idempotent for all count transitions', async () => {
  const dom = installDom(`<main id="app">${tileMarkup()}</main>`);
  api.adminPendingAttendanceByMonth = async () => [];
  const { applyAdminHubPendingBadge } = await importRuntime();
  const tile = document.querySelector('[data-admin-attendance-open]');
  const records = [];
  const observer = new MutationObserver((batch) => records.push(...batch));
  observer.observe(tile, { attributes: true, childList: true, characterData: true, subtree: true });

  applyAdminHubPendingBadge(0);
  await Promise.resolve();
  assert.equal(records.length, 0, '0 → 0 must not mutate');

  applyAdminHubPendingBadge(13);
  await Promise.resolve();
  assert.equal(tile.querySelector('[data-admin-attendance-pending-count]')?.textContent, '13');
  assert.equal(records.filter((record) => record.type === 'childList').length, 1, '0 → positive appends one complete badge');

  records.length = 0;
  applyAdminHubPendingBadge(13);
  await Promise.resolve();
  assert.equal(records.length, 0, 'same positive total must perform no DOM writes');

  applyAdminHubPendingBadge(12);
  await Promise.resolve();
  assert.equal(tile.querySelector('[data-admin-attendance-pending-count]')?.textContent, '12');
  assert.equal(records.length, 1, 'different positive total updates only the count text');
  assert.equal(records[0].type, 'childList');

  records.length = 0;
  applyAdminHubPendingBadge(0);
  await Promise.resolve();
  assert.equal(tile.querySelector('[data-admin-attendance-pending-label]'), null);
  assert.equal(records.filter((record) => record.type === 'childList').length, 1, 'positive → 0 removes one badge');

  records.length = 0;
  applyAdminHubPendingBadge(0);
  await Promise.resolve();
  assert.equal(records.length, 0, '0 → 0 after removal must not mutate');
  observer.disconnect();
  dom.window.close();
});

test('observer stabilizes, coalesces bursts, and pending loads are single-flight with one trailing refresh', async () => {
  const dom = installDom(`<main id="app"><div id="screenRoot">${tileMarkup({ legacy: true })}</div></main>`);
  const requests = [];
  let activeRequests = 0;
  let maxActiveRequests = 0;
  api.adminPendingAttendanceByMonth = () => {
    const request = deferred();
    requests.push(request);
    activeRequests += 1;
    maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
    return request.promise.finally(() => { activeRequests -= 1; });
  };

  let observerCallbacks = 0;
  const NativeMutationObserver = globalThis.MutationObserver;
  globalThis.MutationObserver = class CountingMutationObserver extends NativeMutationObserver {
    constructor(callback) {
      super((records, observer) => {
        observerCallbacks += 1;
        callback(records, observer);
      });
    }
  };
  dom.window.MutationObserver = globalThis.MutationObserver;

  let structuralSyncs = 0;
  const nativeQuerySelectorAll = document.querySelectorAll.bind(document);
  document.querySelectorAll = (selector) => {
    if (selector === '[data-admin-hub-manager-tab="payroll-attendance"]') structuralSyncs += 1;
    return nativeQuerySelectorAll(selector);
  };

  const runtime = await importRuntime();
  document.dispatchEvent(new Event('DOMContentLoaded'));
  await settle(25);
  assert.equal(requests.length, 1, 'initial mount starts one RPC');

  const joined = [
    runtime.loadAdminPendingSummary(),
    runtime.loadAdminPendingSummary(true),
    runtime.loadAdminPendingSummary(true),
    runtime.loadAdminPendingSummary(true)
  ];
  assert.equal(requests.length, 1, 'callers join the active request');
  requests[0].resolve([{ month_key: '2026-09', pending_count: 13 }]);
  await settle(0);
  assert.equal(requests.length, 2, 'force invalidation schedules exactly one trailing refresh');
  requests[1].resolve([{ month_key: '2026-09', pending_count: 12 }]);
  const summaries = await Promise.all(joined);
  assert.ok(summaries.every((summary) => summary.total === 12), 'all joined callers receive the freshest result');
  await settle();

  assert.equal(maxActiveRequests, 1, 'only one pending-summary RPC is active at once');
  assert.equal(document.querySelector('[data-admin-attendance-pending-count]')?.textContent, '12');
  const stableCallbackCount = observerCallbacks;
  await settle();
  assert.equal(observerCallbacks, stableCallbackCount, 'idle observer activity reaches zero after stabilization');

  const syncsBeforeBurst = structuralSyncs;
  const app = document.getElementById('app');
  for (let index = 0; index < 20; index += 1) {
    app.append(document.createElement('i'));
    await Promise.resolve();
  }
  await settle();
  assert.equal(structuralSyncs - syncsBeforeBurst, 1, '20 mutation callbacks coalesce into one full sync');
  assert.equal(requests.length, 2, 'cache hit within TTL does not start another RPC');
  const afterBurstCallbacks = observerCallbacks;
  await settle();
  assert.equal(observerCallbacks, afterBurstCallbacks, 'badge rendering does not restart a feedback loop');
  dom.window.close();
});

test('no tile means no RPC and failure backoff prevents observer retry storms while explicit force recovers', async () => {
  const dom = installDom('<main id="app"><div id="screenRoot"></div></main>');
  let rpcCalls = 0;
  api.adminPendingAttendanceByMonth = async () => {
    rpcCalls += 1;
    throw new Error('temporary failure');
  };
  const runtime = await importRuntime();
  document.dispatchEvent(new Event('DOMContentLoaded'));
  const app = document.getElementById('app');
  for (let index = 0; index < 20; index += 1) app.append(document.createElement('b'));
  await settle();
  assert.equal(rpcCalls, 0, 'general mutations outside admin-home attendance tile never load pending summary');

  document.getElementById('screenRoot').innerHTML = tileMarkup({ legacy: true });
  await settle();
  assert.equal(rpcCalls, 1, 'tile mount makes one failed attempt');
  for (let index = 0; index < 20; index += 1) app.append(document.createElement('em'));
  await settle();
  assert.equal(rpcCalls, 1, 'failure backoff prevents immediate observer retries');

  api.adminPendingAttendanceByMonth = async () => {
    rpcCalls += 1;
    return [{ month_key: '2026-09', pending_count: 4 }];
  };
  const recovered = await runtime.loadAdminPendingSummary(true);
  assert.equal(recovered.total, 4, 'explicit force bypasses failure backoff');
  assert.equal(rpcCalls, 2);
  dom.window.close();
});

test('approval checks keep the admin overview compact and expose approval details only in a small popover', async () => {
  const dom = installDom('<main id="app"><button id="outside" type="button">outside</button></main>');
  const runtime = await importRuntime();
  document.dispatchEvent(new Event('DOMContentLoaded'));
  await settle();
  assert.equal(runtime.approvalCell('admin', '', ''), '', 'missing approval remains an empty cell');
  const host = document.createElement('div');
  host.innerHTML = runtime.approvalCell('manager', 'גיל נאמן', '2026-10-05T10:49:00Z');
  document.getElementById('app').append(host);
  const check = host.querySelector('[data-admin-attendance-approval-check]');
  assert.equal(check.textContent.trim(), '✓');
  assert.doesNotMatch(check.textContent, /גיל|2026|אושר/);
  check.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  let popover = document.querySelector('[data-admin-attendance-approval-popover]');
  assert.ok(popover);
  assert.match(popover.textContent, /אישור מנהל/);
  assert.match(popover.textContent, /גיל נאמן/);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(document.querySelector('[data-admin-attendance-approval-popover]'), null);
  check.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  document.getElementById('outside').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(document.querySelector('[data-admin-attendance-approval-popover]'), null);
  dom.window.close();
});

test('management click is not intercepted, attendance tile stays standalone, and remount does not duplicate listeners', async () => {
  const dom = installDom(`<main id="app"><nav><button data-route="admin-home">ניהול</button></nav><div id="screenRoot"><section class="admin-management-home">${tileMarkup()}</section></div></main>`);
  api.adminPendingAttendanceByMonth = async () => [];
  await importRuntime();
  document.dispatchEvent(new Event('DOMContentLoaded'));
  await settle();

  let navigationClicks = 0;
  document.addEventListener('click', (event) => {
    if (event.target.closest?.('[data-route="admin-home"]')) navigationClicks += 1;
  });
  const management = document.querySelector('[data-route="admin-home"]');
  assert.equal(management.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })), true);
  assert.equal(navigationClicks, 1, 'attendance capture listener does not intercept management navigation');

  const attendanceTile = document.querySelector('[data-admin-attendance-open]');
  assert.equal(attendanceTile.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })), false);
  await settle();
  assert.ok(document.querySelector('[data-admin-attendance-standalone]'), 'attendance tile opens the standalone screen');

  document.getElementById('screenRoot').innerHTML = `<section class="admin-management-home">${tileMarkup()}</section>`;
  await settle();
  assert.equal(management.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })), true);
  assert.equal(navigationClicks, 2, 'navigation remains single-bound after an away/back-style remount');

  const sharedLayer = document.createElement('div');
  sharedLayer.id = 'ds-shared-ui-layer';
  sharedLayer.className = 'is-backdrop-visible';
  sharedLayer.innerHTML = '<div class="ds-ui-backdrop" style="pointer-events:auto"></div>';
  document.getElementById('app').append(sharedLayer);
  document.getElementById('screenRoot').insertAdjacentHTML('beforeend', '<section class="manager-board-screen" data-manager-board-root></section>');
  await import(`../frontend/src/manager-board-final-fixes-runtime.js?pending-stability=${moduleSequence}`);
  await settle();
  assert.equal(sharedLayer.classList.contains('is-backdrop-visible'), false);
  assert.equal(sharedLayer.querySelector('.ds-ui-backdrop').hidden, true);
  assert.equal(sharedLayer.querySelector('.ds-ui-backdrop').style.pointerEvents, '');
  dom.window.close();
});
