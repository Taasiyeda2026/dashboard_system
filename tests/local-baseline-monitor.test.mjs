import test from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapLocalBaselineMonitor, consumeQueryFlag, installLocalBaselineMonitor, normalizeResource, shouldEnableBaselineMonitor } from '../frontend/src/local-baseline-monitor.js';

function storage(value) { return { getItem: (key) => key === 'ds_baseline_enabled' ? value : null }; }

test('production without build flag stays disabled despite browser flags', () => {
  assert.equal(shouldEnableBaselineMonitor({ buildEnabled: false, location: { href: 'https://example.test/?dsBaseline=1' }, storage: storage('1') }), false);
});

test('staging build still requires an explicit browser flag', () => {
  assert.equal(shouldEnableBaselineMonitor({ buildEnabled: true, location: { href: 'https://example.test/' }, storage: storage(null) }), false);
  assert.equal(shouldEnableBaselineMonitor({ buildEnabled: true, location: { href: 'https://example.test/?dsBaseline=1' }, storage: storage(null) }), true);
});

test('query flag is removed without navigation and other parameters remain', () => {
  let replaced = '';
  const history = { state: { a: 1 }, replaceState(_state, _title, url) { replaced = url; } };
  assert.equal(consumeQueryFlag({ href: 'https://example.test/app?keep=yes&dsBaseline=1#x' }, history), true);
  assert.equal(replaced, '/app?keep=yes#x');
});

test('normalization redacts values and emits only allowed 2026 booleans', () => {
  const row = normalizeResource('https://project.supabase.co/rest/v1/activities?school=Secret&email=a%40b.test&activity_season=summer_2026', { salt: 'session' });
  assert.equal(row.path, '/rest/v1/activities');
  assert.equal(row.requested_summer_2026_period, true);
  assert.equal(JSON.stringify(row).includes('Secret'), false);
  assert.equal(JSON.stringify(row).includes('a@b.test'), false);
  const otherFilter = normalizeResource('https://project.supabase.co/rest/v1/activities?school=Different', { salt: 'session' });
  assert.notEqual(row.filter_fingerprint, otherFilter.filter_fingerprint);
});

test('fetch wrapper preserves request, signal, body, response and promise identity', async () => {
  const controller = new AbortController();
  const request = new Request('https://example.test/data?name=private', { method: 'POST', body: 'do-not-read', signal: controller.signal });
  const requestSignal = request.signal;
  const response = new Response(null, { status: 204 });
  const promise = Promise.resolve(response);
  let received;
  const scope = { fetch(...args) { received = args; return promise; }, Request, performance: { now: () => 1 } };
  const api = installLocalBaselineMonitor({ scope });
  const returned = scope.fetch(request);
  assert.equal(returned, promise);
  assert.equal(received[0], request);
  assert.equal(received[0].signal, requestSignal);
  assert.equal(await returned, response);
  assert.equal(await request.text(), 'do-not-read');
  api.uninstall();
});

test('uninstall is complete and does not overwrite a later wrapper', () => {
  let disconnected = 0; let removed = 0;
  class Observer { constructor() {} observe() {} disconnect() { disconnected += 1; } }
  const original = () => Promise.resolve(new Response());
  const document = { addEventListener() {}, removeEventListener() { removed += 1; } };
  const scope = { fetch: original, Request, PerformanceObserver: Observer, performance: { now: () => 0 } };
  const api = installLocalBaselineMonitor({ scope, document });
  const later = () => Promise.resolve(new Response()); scope.fetch = later;
  api.startScenario({ name: 'x' }); api.uninstall();
  assert.equal(scope.fetch, later); assert.equal(disconnected, 1); assert.equal(removed, 1); assert.equal(scope.__dsLocalBaseline, undefined);
});

test('bootstrap performs no installation without both flags', () => {
  let observerCreated = 0; let listenerAdded = 0;
  class Observer { constructor() { observerCreated += 1; } }
  const original = () => Promise.resolve(new Response());
  const scope = { fetch: original, PerformanceObserver: Observer, location: { href: 'https://example.test/?dsBaseline=1' }, localStorage: storage('1') };
  assert.equal(bootstrapLocalBaselineMonitor({ scope, buildEnabled: false, document: { addEventListener() { listenerAdded += 1; } } }), null);
  assert.equal(scope.fetch, original); assert.equal(scope.__dsLocalBaseline, undefined);
  assert.equal(observerCreated, 0); assert.equal(listenerAdded, 0);
});
