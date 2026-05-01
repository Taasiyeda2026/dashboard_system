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

function mockOkFetch(capturedBodies = []) {
  global.fetch = async (_url, req) => {
    capturedBodies.push(JSON.parse(req.body));
    return {
      status: 200,
      async text() {
        return JSON.stringify({ ok: true, data: { done: true } });
      }
    };
  };
}

test('addActivity supports object payload (short)', async () => {
  const { api, state } = await freshModules();
  state.token = 'token';

  const bodies = [];
  mockOkFetch(bodies);

  await api.addActivity({ source: 'short', activity_name: 'A', start_date: '2026-04-01' });

  assert.equal(bodies[0].action, 'addActivity');
  assert.equal(bodies[0].activity.source, 'short');
  assert.equal(bodies[0].activity.activity_name, 'A');
});

test('addActivity supports (target, data) signature for long source', async () => {
  const { api, state } = await freshModules();
  state.token = 'token';
  const bodies = [];
  mockOkFetch(bodies);

  await api.addActivity('long', { activity_name: 'Program X', sessions: '8', Date1: '2026-04-02' });

  assert.equal(bodies[0].action, 'addActivity');
  assert.equal(bodies[0].activity.source, 'long');
  assert.equal(bodies[0].activity.activity_name, 'Program X');
  assert.equal(bodies[0].activity.Date1, '2026-04-02');
});

test('saveActivity sends source_sheet, source_row_id and changes in direct-edit flow', async () => {
  const { api, state } = await freshModules();
  state.token = 'token';
  const bodies = [];
  mockOkFetch(bodies);

  await api.saveActivity({
    source_sheet: 'data_long',
    source_row_id: 'LONG-123',
    changes: { activity_name: 'Updated', Date1: '2026-04-15' }
  });

  assert.equal(bodies[0].action, 'saveActivity');
  assert.equal(bodies[0].source_sheet, 'data_long');
  assert.equal(bodies[0].source_row_id, 'LONG-123');
  assert.equal(bodies[0].changes.activity_name, 'Updated');
});

test('submitEditRequest and reviewEditRequest send correct payloads', async () => {
  const { api, state } = await freshModules();
  state.token = 'token';
  const bodies = [];
  mockOkFetch(bodies);

  await api.submitEditRequest('LONG-2', { notes: 'x' });
  await api.reviewEditRequest('REQ-1', 'approved');

  assert.equal(bodies[0].action, 'submitEditRequest');
  assert.equal(bodies[0].source_row_id, 'LONG-2');
  assert.equal(bodies[0].changes.notes, 'x');

  assert.equal(bodies[1].action, 'reviewEditRequest');
  assert.equal(bodies[1].request_id, 'REQ-1');
  assert.equal(bodies[1].status, 'approved');
});

test('api mutation cache invalidation map includes required keys', async () => {
  const fs = await import('node:fs/promises');
  const source = await fs.readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
  assert.match(source, /submitEditRequest:\s*\['activities:',\s*'edit-requests'/);
  assert.match(source, /reviewEditRequest:\s*\['edit-requests',\s*'activities:',\s*'activityDetail:',\s*'dashboard:',\s*'exceptions:'/);
  assert.match(source, /addActivity:\s*\['activities:',\s*'activityDetail:'/);
});

test('heavy screens request read models by default with legacy fallback', async () => {
  const fs = await import('node:fs/promises');
  const source = await fs.readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
  assert.match(source, /dashboardSnapshot:\s*\(filters\)\s*=>\s*requestReadModel\('dashboard'/);
  assert.match(source, /activities:\s*\(filters\)\s*=>\s*requestReadModel\('activities'/);
  assert.match(source, /week:\s*\(params\)\s*=>\s*requestReadModel\('week'/);
  assert.match(source, /month:\s*\(params\)\s*=>\s*requestReadModel\('month'/);
  assert.match(source, /exceptions:\s*\(params\)\s*=>\s*requestReadModel\('exceptions'/);
  assert.match(source, /finance:\s*\(params\)\s*=>\s*requestReadModel\('finance'/);
  assert.match(source, /endDates:\s*\(\)\s*=>\s*requestReadModel\('end-dates'/);
});
