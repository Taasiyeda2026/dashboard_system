import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const API_MODULE = new URL('../frontend/src/api.js', import.meta.url).href;
const STATE_MODULE = new URL('../frontend/src/state.js', import.meta.url).href;

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  global.sessionStorage = dom.window.sessionStorage;
  global.performance = { now: () => 0 };
  global.requestAnimationFrame = (cb) => cb();
}

beforeEach(() => {
  setupDom();
});

async function freshModules() {
  const stamp = Date.now() + Math.random();
  const stateMod = await import(`${STATE_MODULE}?bust=${stamp}`);
  const apiMod = await import(`${API_MODULE}?bust=${stamp}`);
  return { ...stateMod, ...apiMod };
}

test('only dashboard read model is gradually enabled; activities stay on legacy endpoint', async () => {
  const { api, state } = await freshModules();
  state.token = 'token';
  const calls = [];
  global.fetch = async (_url, req) => {
    const body = JSON.parse(req.body);
    calls.push(body.action);
    if (body.action === 'activities') {
      return { status: 200, async text() { return JSON.stringify({ ok: true, data: {} }); } };
    }
    throw new Error(`unexpected action: ${body.action}`);
  };

  await api.activities({});
  assert.deepEqual(calls, ['activities']);
});

test('dashboardSnapshot without month stays on legacy while rollout switch is off', async () => {
  const { api, state } = await freshModules();
  state.token = 'token';
  const calls = [];
  global.fetch = async (_url, req) => {
    const body = JSON.parse(req.body);
    calls.push(body.action);
    if (body.action === 'dashboardSnapshot') {
      return { status: 200, async text() { return JSON.stringify({ ok: true, data: { totals: { active: 7 } } }); } };
    }
    throw new Error(`unexpected action: ${body.action}`);
  };

  const data = await api.dashboardSnapshot({});
  assert.equal(data?.totals?.active, 7);
  assert.deepEqual(calls, ['dashboardSnapshot']);
});

test('dashboardSnapshot with month falls back to legacy endpoint (no read model key mismatch)', async () => {
  const { api, state } = await freshModules();
  state.token = 'token';
  const calls = [];
  global.fetch = async (_url, req) => {
    const body = JSON.parse(req.body);
    calls.push(body.action);
    if (body.action === 'dashboardSnapshot') {
      return { status: 200, async text() { return JSON.stringify({ ok: true, data: { month: body.month, from: 'legacy' } }); } };
    }
    throw new Error(`unexpected action: ${body.action}`);
  };
  const data = await api.dashboardSnapshot({ month: '2026-04' });
  assert.equal(data?.from, 'legacy');
  assert.deepEqual(calls, ['dashboardSnapshot']);
});

test('dashboardSnapshot load works via legacy route when rollout is off', async () => {
  const { api, state } = await freshModules();
  state.token = 'token';
  global.fetch = async (_url, req) => {
    const body = JSON.parse(req.body);
    if (body.action === 'dashboardSnapshot') {
      return { status: 200, async text() { return JSON.stringify({ ok: true, data: { rows: [{ RowID: 'A1' }] } }); } };
    }
    return { status: 200, async text() { return JSON.stringify({ ok: true, data: {} }); } };
  };

  const data = await api.dashboardSnapshot({});
  assert.ok(Array.isArray(data?.rows));
  assert.equal(data.rows[0]?.RowID, 'A1');
});
