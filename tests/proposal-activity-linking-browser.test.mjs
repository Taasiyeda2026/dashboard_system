import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const runtime = await readFile(new URL('../frontend/src/proposal-activity-linking.js', import.meta.url), 'utf8');
const PROPOSAL_ID = '10000000-0000-4000-8000-000000000001';
const ITEM_ONE = '20000000-0000-4000-8000-000000000001';
const ITEM_TWO = '20000000-0000-4000-8000-000000000002';

function dependencySource(pathname) {
  if (pathname.endsWith('/supabase-client.js')) return `
    const chain = (table) => {
      const api = { select: () => api, eq: () => api, is: () => api, order: () => api, limit: () => api,
        maybeSingle: async () => ({ data: window.__proposal, error: null }),
        then: (resolve) => resolve({ data: table === 'proposal_agreement_items' ? window.__items : window.__activities, error: null }) };
      return api;
    };
    export const supabase = {
      from: chain,
      rpc: async (name, body) => {
        const response = await fetch('/rest/v1/rpc/' + name, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        const data = await response.json();
        return response.ok ? { data, error: null } : { data: null, error: data };
      }
    };
  `;
  if (pathname.endsWith('/state.js')) return 'export const state = { user: { role: "admin" } }; export function clearScreenDataCache() { window.__cacheClears = (window.__cacheClears || 0) + 1; }';
  if (pathname.endsWith('/permissions.js')) return 'export function canAddActivityDirect() { return true; }';
  if (pathname.endsWith('/screens/shared/toast.js')) return 'export function showToast(message, type) { (window.__toasts ||= []).push({ message, type }); }';
  if (pathname.endsWith('/screens/shared/html.js')) return 'export function escapeHtml(value) { return String(value); }';
  return null;
}

async function startServer() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/frontend/src/proposal-activity-linking.js') {
      response.writeHead(200, { 'content-type': 'text/javascript' });
      response.end(runtime);
      return;
    }
    const dependency = dependencySource(url.pathname);
    if (dependency != null) {
      response.writeHead(200, { 'content-type': 'text/javascript' });
      response.end(dependency);
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><html><body><div id="app"></div></body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function installFixture(page, origin, { items, activities = [] }) {
  await page.goto(origin);
  await page.evaluate(({ proposalId, items, activities }) => {
    window.__proposal = { id: proposalId, quote_number: 'Q-1', status: 'approved', activity_type_group: 'next_year', archived_at: null, version_number: 1 };
    window.__items = items;
    window.__activities = activities;
    window.__toasts = [];
    const app = document.querySelector('#app');
    app.innerHTML = `<div data-pa-proposal-detail data-proposal-id="${proposalId}">
      <section class="ds-pa-activities-wide"><div data-proposal-activity-creator-host></div></section>
      <div data-proposal-domain-routing-host><span data-domain-sentinel>domain</span></div>
    </div>`;
  }, { proposalId: PROPOSAL_ID, items, activities });
  await page.addScriptTag({ type: 'module', url: `${origin}/frontend/src/proposal-activity-linking.js` });
  await page.waitForSelector('[data-proposal-activity-creator]');
}

function item(id, quantity, name) {
  return { id, proposal_agreement_id: PROPOSAL_ID, item_name: name, proposal_group: 'next_year', quantity, sort_order: 1 };
}

test('proposal creator keeps one lifecycle-safe RPC across observer rerenders, repeated clicks, quantities, items, and reopen', async (t) => {
  const { server, origin } = await startServer();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); server.close(); server.closeAllConnections(); });
  const page = await browser.newPage();
  const requests = [];
  await page.route('**/rest/v1/rpc/create_activity_from_proposal_item', async (route) => {
    requests.push({ body: route.request().postDataJSON(), lifecycle: await page.evaluate(() => ({ connected: window.__clickedButton?.isConnected, replacements: window.__replacements || 0 })) });
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ created_count: 2 }) });
  });
  await installFixture(page, origin, {
    items: [item(ITEM_ONE, 3, 'First'), item(ITEM_TWO, 1, 'Second')],
    activities: [{ proposal_item_id: ITEM_ONE, proposal_item_sequence: 1 }, { proposal_item_id: ITEM_TWO, proposal_item_sequence: 1 }]
  });

  assert.equal(await page.locator('[data-create-activity-from-proposal-item]').count(), 2);
  assert.equal(await page.locator(`[data-create-activity-from-proposal-item="${ITEM_ONE}"]`).textContent(), 'יצירת 2 פעילויות');
  assert.equal(await page.locator(`[data-create-activity-from-proposal-item="${ITEM_TWO}"]`).isDisabled(), true);
  assert.equal(await page.locator('[data-domain-sentinel]').textContent(), 'domain');

  await page.evaluate((id) => {
    const root = document.querySelector('[data-pa-proposal-detail]');
    const host = root.querySelector('[data-proposal-activity-creator-host]');
    window.__clickedButton = root.querySelector(`[data-create-activity-from-proposal-item="${id}"]`);
    window.__replacements = 0;
    new MutationObserver(() => { if (!window.__clickedButton.isConnected) window.__replacements += 1; }).observe(host, { childList: true, subtree: true });
    window.__clickedButton.click();
    root.removeAttribute('data-proposal-activity-loaded');
    for (let i = 0; i < 4; i += 1) document.body.append(document.createElement('i'));
  }, ITEM_ONE);
  await page.waitForTimeout(180);
  const replacementState = await page.evaluate((id) => ({
    originalConnected: window.__clickedButton.isConnected,
    currentDisabled: document.querySelector(`[data-create-activity-from-proposal-item="${id}"]`).disabled
  }), ITEM_ONE);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].body, { p_proposal_item_id: ITEM_ONE });
  assert.deepEqual(requests[0].lifecycle, { connected: true, replacements: 0 });
  assert.equal(replacementState.originalConnected, false);
  assert.equal(replacementState.currentDisabled, true);
  await page.locator(`[data-create-activity-from-proposal-item="${ITEM_ONE}"]`).click({ force: true });
  assert.equal(requests.length, 1);
  await page.waitForFunction(() => window.__cacheClears === 1);

  await page.evaluate(({ proposalId, itemId }) => {
    document.querySelector('[data-pa-proposal-detail]').remove();
    document.querySelector('#app').innerHTML = `<div data-pa-proposal-detail data-proposal-id="${proposalId}"><section><div data-proposal-activity-creator-host></div></section><div data-proposal-domain-routing-host><b data-domain-sentinel>reopened</b></div></div>`;
    window.__activities = [{ proposal_item_id: itemId, proposal_item_sequence: 1 }];
  }, { proposalId: PROPOSAL_ID, itemId: ITEM_ONE });
  await page.waitForSelector('[data-proposal-activity-creator]');
  assert.equal(await page.locator('[data-domain-sentinel]').textContent(), 'reopened');
  assert.equal(requests.length, 1);
});

test('failed proposal RPC survives observer replacement and restores the current button for a later click', async (t) => {
  const { server, origin } = await startServer();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); server.close(); server.closeAllConnections(); });
  const page = await browser.newPage();
  let calls = 0;
  await page.route('**/rest/v1/rpc/create_activity_from_proposal_item', async (route) => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 180));
    await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'rpc failed' }) });
  });
  await installFixture(page, origin, { items: [item(ITEM_ONE, 1, 'Retry')] });
  await page.evaluate(() => {
    document.querySelector('[data-create-activity-from-proposal-item]').click();
    document.querySelector('[data-pa-proposal-detail]').removeAttribute('data-proposal-activity-loaded');
    document.body.append(document.createElement('i'));
  });
  await page.waitForFunction(() => window.__toasts.some((entry) => entry.type === 'error'));
  const button = page.locator(`[data-create-activity-from-proposal-item="${ITEM_ONE}"]`);
  assert.equal(await button.isEnabled(), true);
  assert.equal(await button.textContent(), 'יצירת פעילות');
  await button.click();
  await page.waitForFunction(() => window.__toasts.filter((entry) => entry.type === 'error').length === 2);
  assert.equal(calls, 2);
});
