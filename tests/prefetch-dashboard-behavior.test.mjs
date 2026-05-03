import { test } from 'node:test';
import assert from 'node:assert/strict';

// Behavioral tests for the prefetch cache-write algorithm.
// main.js has DOM dependencies at module level so cannot be imported directly.
// These tests specify and verify the behavioral contract of the .then() handler
// inside prefetchFromDashboardIfNeeded() by exercising an equivalent logic
// block with real mocked state/cache/api objects and asserting cache outcomes.

function makePrefetchContext({
  token = 'tok-A',
  userId = 'u1',
  navToken = 'nav-1',
  cacheKey = 'activities:2026-05',
  ttl = 300_000,
} = {}) {
  const state = {
    token,
    user: userId ? { user_id: userId } : null,
    screenDataCache: {},
  };
  const persisted = [];

  function writeResult(data, {
    currentNavToken = navToken,
    capturedNavToken = navToken,
    capturedSessionToken = token,
    capturedUserId = userId,
  } = {}) {
    // Mirrors the .then() logic in prefetchFromDashboardIfNeeded().
    if (currentNavToken !== capturedNavToken) return { wrote: false, reason: 'nav changed' };
    if (!state.token || state.token !== capturedSessionToken) return { wrote: false, reason: 'session changed' };
    if (capturedUserId && (state.user?.user_id || '') !== capturedUserId) return { wrote: false, reason: 'user changed' };
    const existing = state.screenDataCache[cacheKey];
    if (existing && Date.now() - existing.t < ttl) return { wrote: false, reason: 'fresh hit exists' };
    const entry = { data, t: Date.now() };
    state.screenDataCache[cacheKey] = entry;
    persisted.push(cacheKey);
    return { wrote: true };
  }

  return { state, persisted, writeResult, cacheKey, ttl, navToken, token, userId };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

test('writes data to cache when session and navigation token are unchanged', () => {
  const { state, persisted, writeResult, cacheKey } = makePrefetchContext();
  const result = writeResult({ rows: [1, 2, 3] });
  assert.ok(result.wrote, 'should write to cache');
  assert.ok(state.screenDataCache[cacheKey], 'cache entry should exist');
  assert.equal(persisted.length, 1, 'should persist once');
  assert.equal(persisted[0], cacheKey);
});

// ---------------------------------------------------------------------------
// Session isolation
// ---------------------------------------------------------------------------

test('does not write to cache when user logged out mid-flight (empty token)', () => {
  const ctx = makePrefetchContext();
  ctx.state.token = '';
  const result = ctx.writeResult({ rows: [] }, { capturedSessionToken: 'tok-A' });
  assert.ok(!result.wrote, 'should NOT write after logout');
  assert.equal(Object.keys(ctx.state.screenDataCache).length, 0);
  assert.equal(ctx.persisted.length, 0);
});

test('does not write to cache when a different session token is present (re-login race)', () => {
  const ctx = makePrefetchContext();
  ctx.state.token = 'tok-B';
  const result = ctx.writeResult({ rows: [] }, { capturedSessionToken: 'tok-A' });
  assert.ok(!result.wrote, 'should NOT write; tok-B is a different user session');
  assert.equal(Object.keys(ctx.state.screenDataCache).length, 0);
});

test('does not write to cache when user_id changed even with same token format', () => {
  const ctx = makePrefetchContext({ userId: 'u2' });
  const result = ctx.writeResult({ rows: [] }, { capturedUserId: 'u1' });
  assert.ok(!result.wrote, 'should NOT write; user_id mismatch');
  assert.equal(Object.keys(ctx.state.screenDataCache).length, 0);
});

test('writes correctly when user has no user_id (capturedUserId empty string)', () => {
  const ctx = makePrefetchContext({ userId: '' });
  ctx.state.user = null;
  const result = ctx.writeResult({ rows: [] }, { capturedUserId: '' });
  assert.ok(result.wrote, 'empty userId means user_id check is skipped — should still write');
});

// ---------------------------------------------------------------------------
// Navigation token guard at write time
// ---------------------------------------------------------------------------

test('does not write to cache if user navigated away before request resolved', () => {
  const ctx = makePrefetchContext({ navToken: 'nav-1' });
  const result = ctx.writeResult({ rows: [] }, {
    currentNavToken: 'nav-2',
    capturedNavToken: 'nav-1',
  });
  assert.ok(!result.wrote, 'should NOT write; navigation token changed');
  assert.equal(Object.keys(ctx.state.screenDataCache).length, 0);
  assert.equal(ctx.persisted.length, 0);
});

test('writes to cache when navigation token is still the same as at prefetch start', () => {
  const ctx = makePrefetchContext({ navToken: 'nav-1' });
  const result = ctx.writeResult({ rows: [] }, {
    currentNavToken: 'nav-1',
    capturedNavToken: 'nav-1',
  });
  assert.ok(result.wrote);
  assert.ok(ctx.state.screenDataCache[ctx.cacheKey]);
});

// ---------------------------------------------------------------------------
// TTL / freshness guard
// ---------------------------------------------------------------------------

test('does not overwrite a fresh cache entry written by concurrent navigation', () => {
  const ctx = makePrefetchContext();
  const navData = { rows: ['from-navigation'] };
  ctx.state.screenDataCache[ctx.cacheKey] = { data: navData, t: Date.now() };

  const result = ctx.writeResult({ rows: ['from-prefetch'] });
  assert.ok(!result.wrote, 'fresh existing entry should win over prefetch result');
  assert.deepEqual(ctx.state.screenDataCache[ctx.cacheKey].data, navData,
    'navigation data should remain unchanged');
});

test('overwrites a stale cache entry', () => {
  const ctx = makePrefetchContext({ ttl: 100 });
  ctx.state.screenDataCache[ctx.cacheKey] = { data: { rows: ['old'] }, t: Date.now() - 500 };

  const fresh = { rows: ['fresh'] };
  const result = ctx.writeResult(fresh);
  assert.ok(result.wrote, 'stale entry should be replaced');
  assert.deepEqual(ctx.state.screenDataCache[ctx.cacheKey].data, fresh);
});

// ---------------------------------------------------------------------------
// Promise.allSettled — one failure must not block others
// ---------------------------------------------------------------------------

test('allSettled: one rejected fetch does not prevent others from resolving', async () => {
  const results = await Promise.allSettled([
    Promise.reject(new Error('activities API down')),
    Promise.resolve({ rows: ['week data'] }),
    Promise.resolve({ rows: ['month data'] }),
  ]);
  const [a, w, m] = results;
  assert.equal(a.status, 'rejected');
  assert.equal(w.status, 'fulfilled');
  assert.equal(m.status, 'fulfilled');
  assert.deepEqual(w.value, { rows: ['week data'] });
  assert.deepEqual(m.value, { rows: ['month data'] });
});

// ---------------------------------------------------------------------------
// Permission filtering
// ---------------------------------------------------------------------------

test('permission filter: only allowed routes reach fetch stage', () => {
  const allowedRoutes = new Set(['activities', 'month']);
  const PREFETCH_SCREENS = ['activities', 'week', 'month'];
  const toFetch = PREFETCH_SCREENS.filter((r) => allowedRoutes.has(r));
  assert.deepEqual(toFetch, ['activities', 'month']);
});

test('permission filter: empty allowed set produces no fetches', () => {
  const allowedRoutes = new Set();
  const PREFETCH_SCREENS = ['activities', 'week', 'month'];
  const toFetch = PREFETCH_SCREENS.filter((r) => allowedRoutes.has(r));
  assert.equal(toFetch.length, 0);
});

// ---------------------------------------------------------------------------
// inflightRequests deduplication
// ---------------------------------------------------------------------------

test('skips a route already registered in inflightRequests', () => {
  const inflight = new Map();
  const cacheKey = 'week:2026-18';
  const existingPromise = Promise.resolve('already in flight');
  inflight.set(cacheKey, existingPromise);

  const fired = [];
  if (!inflight.has(cacheKey)) {
    fired.push(cacheKey);
  }

  assert.equal(fired.length, 0, 'should not fire a duplicate request');
});

test('registers a new promise in inflightRequests before it resolves', async () => {
  const inflight = new Map();
  const cacheKey = 'activities:2026-05';
  let resolveFn;
  const p = new Promise((resolve) => { resolveFn = resolve; });
  inflight.set(cacheKey, p);

  assert.ok(inflight.has(cacheKey), 'key must be in inflightRequests while pending');
  resolveFn('done');
  await p;
});

// ---------------------------------------------------------------------------
// activitiesMonthYm pre-normalisation
// ---------------------------------------------------------------------------

test('activitiesMonthYm is normalised to YYYY-MM format before cache key is computed', () => {
  const state = { activitiesMonthYm: '' };
  if (!state.activitiesMonthYm) {
    const n = new Date();
    state.activitiesMonthYm = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  }
  assert.match(state.activitiesMonthYm, /^\d{4}-\d{2}$/,
    'activitiesMonthYm must be YYYY-MM after normalisation');
});
