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

beforeEach(() => setupDom());

async function freshModules() {
  const stamp = Date.now() + Math.random();
  const stateMod = await import(`${STATE_MODULE}?bust=${stamp}`);
  const apiMod = await import(`${API_MODULE}?bust=${stamp}`);
  return { ...stateMod, ...apiMod };
}

test('activities read-model path does not auto-fallback without explicit legacy flag', async () => {
  const { api, state } = await freshModules();
  state.token = 'token';
  const calls = [];
  global.fetch = async (_url, req) => {
    const body = JSON.parse(req.body);
    calls.push(body.action);
    if (body.action === 'readModelGet') return { status: 500, async text(){ return JSON.stringify({ ok:false, error:'x' }); } };
    if (body.action === 'activities') return { status: 200, async text(){ return JSON.stringify({ ok:true, data:{ rows: [] } }); } };
    if (body.action === 'readModelManifest') return { status: 200, async text(){ return JSON.stringify({ ok:true, data:{} }); } };
    throw new Error('unexpected action');
  };
  await assert.rejects(() => api.activities({}), /הנתונים מתעדכנים כעת/);
  assert.ok(calls.includes('readModelGet'));
  assert.equal(calls.includes('activities'), false);
});


test('dashboardSnapshot blocks implicit legacy fallback on readModelGet failure', async () => {
  const { api, state } = await freshModules();
  state.token = 'token';
  const calls = [];
  global.fetch = async (_url, req) => {
    const body = JSON.parse(req.body);
    calls.push(body.action);
    if (body.action === 'readModelGet') return { status: 500, async text(){ return JSON.stringify({ ok:false, error:'x' }); } };
    if (body.action === 'dashboardSnapshot') return { status: 200, async text(){ return JSON.stringify({ ok:true, data:{ totals:{ active: 7 } } }); } };
    if (body.action === 'readModelManifest') return { status: 200, async text(){ return JSON.stringify({ ok:true, data:{} }); } };
    throw new Error('unexpected action');
  };
  await assert.rejects(() => api.dashboardSnapshot({}), /הנתונים מתעדכנים כעת/);
  assert.ok(calls.includes('readModelGet'));
  assert.equal(calls.includes('dashboardSnapshot'), false);
});

test('explicit force_legacy still allows legacy fallback when requested', async () => {
  const { api, state } = await freshModules();
  state.token = 'token';
  global.fetch = async (_url, req) => {
    const body = JSON.parse(req.body);
    if (body.action === 'readModelGet') return { status: 500, async text(){ return JSON.stringify({ ok:false, error:'x' }); } };
    if (body.action === 'activities') return { status: 200, async text(){ return JSON.stringify({ ok:true, data:{ rows: [] } }); } };
    return { status: 200, async text(){ return JSON.stringify({ ok:true, data:{} }); } };
  };
  const data = await api.activities({ force_legacy: true }, { forceLegacy: true });
  assert.ok(Array.isArray(data?.rows));
});
