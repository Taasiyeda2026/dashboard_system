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

test('read-model cache miss fetches readModelGet without blocking on readModelManifest first', async () => {
  const { api, state } = await freshModules();
  state.token = 'token';
  const calls = [];
  global.fetch = async (_url, req) => {
    const body = JSON.parse(req.body);
    calls.push(body.action);
    if (body.action === 'readModelGet') {
      return { status: 200, async text() { return JSON.stringify({ ok: true, data: { data: { items: [] }, version: 'v1', hash: 'h1' } }); } };
    }
    if (body.action === 'readModelManifest') {
      return { status: 200, async text() { return JSON.stringify({ ok: true, data: {} }); } };
    }
    throw new Error(`unexpected action: ${body.action}`);
  };

  await api.activities({});
  assert.equal(calls[0], 'readModelGet');
});

test('manifest/get failures fallback to legacy endpoint and do not break screen load', async () => {
  const { api, state } = await freshModules();
  state.token = 'token';
  global.fetch = async (_url, req) => {
    const body = JSON.parse(req.body);
    if (body.action === 'readModelGet') {
      throw new Error('network failure');
    }
    if (body.action === 'activities') {
      return { status: 200, async text() { return JSON.stringify({ ok: true, data: { rows: [{ RowID: 'A1' }] } }); } };
    }
    return { status: 200, async text() { return JSON.stringify({ ok: true, data: {} }); } };
  };

  const data = await api.activities({});
  assert.ok(Array.isArray(data?.rows));
  assert.equal(data.rows[0]?.RowID, 'A1');
});
