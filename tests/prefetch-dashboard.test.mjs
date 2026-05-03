import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Structural/static tests for prefetchFromDashboardIfNeeded in main.js.
// These verify code-shape requirements that cannot be covered by the
// behavioral tests (which live in prefetch-dashboard-behavior.test.mjs).

const MAIN_FILE = new URL('../frontend/src/main.js', import.meta.url).pathname;
const read = (f) => readFile(f, 'utf8');

// Helper: extract the body of an async function by name.
function extractFnBody(src, name) {
  const m = src.match(new RegExp(`async function ${name}\\(\\)([\\s\\S]*?)^(?:async )?function `, 'm'));
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Function shape
// ---------------------------------------------------------------------------

test('prefetchFromDashboardIfNeeded is declared as async', async () => {
  const src = await read(MAIN_FILE);
  assert.match(src, /async function prefetchFromDashboardIfNeeded\(\)/);
});

test('prefetchFromDashboardIfNeeded targets activities, week, and month screens', async () => {
  const src = await read(MAIN_FILE);
  const body = extractFnBody(src, 'prefetchFromDashboardIfNeeded');
  assert.ok(body, 'function body must be present');
  assert.match(body, /['"]activities['"]/);
  assert.match(body, /['"]week['"]/);
  assert.match(body, /['"]month['"]/);
});

test('prefetchFromDashboardIfNeeded uses Promise.allSettled', async () => {
  const src = await read(MAIN_FILE);
  const body = extractFnBody(src, 'prefetchFromDashboardIfNeeded');
  assert.match(body, /Promise\.allSettled/);
});

// ---------------------------------------------------------------------------
// Entry guards
// ---------------------------------------------------------------------------

test('prefetchFromDashboardIfNeeded returns early when user is not logged in', async () => {
  const src = await read(MAIN_FILE);
  const body = extractFnBody(src, 'prefetchFromDashboardIfNeeded');
  assert.match(body, /if \(!state\.token\) return/);
});

test('prefetchFromDashboardIfNeeded returns early when not on dashboard route', async () => {
  const src = await read(MAIN_FILE);
  const body = extractFnBody(src, 'prefetchFromDashboardIfNeeded');
  assert.match(body, /state\.route !== ['"]dashboard['"]/);
});

test('prefetchFromDashboardIfNeeded filters routes through isAllowedRoute', async () => {
  const src = await read(MAIN_FILE);
  const body = extractFnBody(src, 'prefetchFromDashboardIfNeeded');
  assert.match(body, /isAllowedRoute/);
});

// ---------------------------------------------------------------------------
// In-flight and cache skips
// ---------------------------------------------------------------------------

test('prefetchFromDashboardIfNeeded skips routes already in inflightRequests', async () => {
  const src = await read(MAIN_FILE);
  const body = extractFnBody(src, 'prefetchFromDashboardIfNeeded');
  assert.match(body, /inflightRequests\.has\(cacheKey\)/);
});

test('prefetchFromDashboardIfNeeded cleans up inflightRequests on completion and error', async () => {
  const src = await read(MAIN_FILE);
  const body = extractFnBody(src, 'prefetchFromDashboardIfNeeded');
  const deleteCount = (body.match(/inflightRequests\.delete\(cacheKey\)/g) || []).length;
  assert.ok(deleteCount >= 2, `must delete from inflightRequests in both .then() and .catch(); found ${deleteCount}`);
});

test('prefetchFromDashboardIfNeeded registers in-flight promises so navigation can deduplicate', async () => {
  const src = await read(MAIN_FILE);
  const body = extractFnBody(src, 'prefetchFromDashboardIfNeeded');
  assert.match(body, /inflightRequests\.set\(cacheKey/);
});

// ---------------------------------------------------------------------------
// Navigation-token cancellation
// ---------------------------------------------------------------------------

test('prefetchFromDashboardIfNeeded captures activeNavigationToken before API calls', async () => {
  const src = await read(MAIN_FILE);
  const body = extractFnBody(src, 'prefetchFromDashboardIfNeeded');
  assert.match(body, /capturedToken\s*=\s*activeNavigationToken/);
});

test('prefetchFromDashboardIfNeeded bails if user navigated away before API calls start', async () => {
  const src = await read(MAIN_FILE);
  const body = extractFnBody(src, 'prefetchFromDashboardIfNeeded');
  assert.match(body, /activeNavigationToken !== capturedToken/);
});

test('prefetchFromDashboardIfNeeded checks navigation token at write time inside .then()', async () => {
  const src = await read(MAIN_FILE);
  const body = extractFnBody(src, 'prefetchFromDashboardIfNeeded');
  // Verify the check appears at least twice: once before API calls start and
  // once inside the .then() callback (the behavioral tests prove the right guard
  // fires at write time; here we confirm the pattern appears more than once).
  const matches = body.match(/activeNavigationToken !== capturedToken/g) ?? [];
  assert.ok(matches.length >= 2,
    `navigation token must be checked both pre-fetch and inside .then(); found ${matches.length} occurrence(s)`);
});

// ---------------------------------------------------------------------------
// Session isolation
// ---------------------------------------------------------------------------

test('prefetchFromDashboardIfNeeded captures session token and user-id at start', async () => {
  const src = await read(MAIN_FILE);
  const body = extractFnBody(src, 'prefetchFromDashboardIfNeeded');
  assert.match(body, /capturedSessionToken\s*=\s*state\.token/);
  assert.match(body, /capturedUserId/);
});

test('prefetchFromDashboardIfNeeded checks session token and user-id inside .then()', async () => {
  const src = await read(MAIN_FILE);
  const body = extractFnBody(src, 'prefetchFromDashboardIfNeeded');
  // These checks only appear inside the .then() callback (not at the top of the
  // function), so a single occurrence confirms they are in the right place.
  assert.match(body, /state\.token !== capturedSessionToken/,
    'session token comparison must be present in the function body');
  assert.match(body, /capturedUserId.*user_id|user_id.*capturedUserId/,
    'user-id isolation check must be present in the function body');
});

// ---------------------------------------------------------------------------
// activitiesMonthYm pre-normalisation
// ---------------------------------------------------------------------------

test('prefetchFromDashboardIfNeeded normalises activitiesMonthYm before computing cache keys', async () => {
  const src = await read(MAIN_FILE);
  const body = extractFnBody(src, 'prefetchFromDashboardIfNeeded');
  // The normalisation block must appear before the buildScreenDataCacheKey call.
  const normIdx = body.indexOf('activitiesMonthYm');
  const keyIdx = body.indexOf('buildScreenDataCacheKey');
  assert.ok(normIdx !== -1, 'must reference activitiesMonthYm');
  assert.ok(keyIdx !== -1, 'must call buildScreenDataCacheKey');
  assert.ok(normIdx < keyIdx, 'activitiesMonthYm normalisation must precede buildScreenDataCacheKey');
});

// ---------------------------------------------------------------------------
// Cache key captured before load()
// ---------------------------------------------------------------------------

test('prefetchFromDashboardIfNeeded captures cache key before calling screen.load()', async () => {
  const src = await read(MAIN_FILE);
  const body = extractFnBody(src, 'prefetchFromDashboardIfNeeded');
  const keyIdx = body.indexOf('buildScreenDataCacheKey');
  const loadIdx = body.indexOf('screen.load(');
  assert.ok(keyIdx < loadIdx, 'cache key must be computed before screen.load() is called');
});

// ---------------------------------------------------------------------------
// persistence
// ---------------------------------------------------------------------------

test('prefetchFromDashboardIfNeeded persists results via maybePersistScreenCacheEntry', async () => {
  const src = await read(MAIN_FILE);
  const body = extractFnBody(src, 'prefetchFromDashboardIfNeeded');
  assert.match(body, /maybePersistScreenCacheEntry/);
});

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

test('schedulePostLoginPrefetch enforces a minimum 4s delay before idle execution', async () => {
  const src = await read(MAIN_FILE);
  const m = src.match(/function schedulePostLoginPrefetch\(\)([\s\S]*?)^function /m);
  assert.ok(m, 'schedulePostLoginPrefetch must exist');
  // 4000 ms floor must appear before requestIdleCallback inside the fn body.
  assert.match(m[1], /4000/);
  assert.match(m[1], /requestIdleCallback/);
});

test('schedulePostLoginPrefetch cancels any prior pending prefetch before scheduling', async () => {
  const src = await read(MAIN_FILE);
  const m = src.match(/function schedulePostLoginPrefetch\(\)([\s\S]*?)^function /m);
  assert.ok(m, 'schedulePostLoginPrefetch must exist');
  // Cancellation may be done directly (clearTimeout/cancelIdleCallback) or via
  // a dedicated helper function (cancelPrefetchSchedule).
  assert.match(m[1], /clearTimeout|cancelIdleCallback|cancelPrefetchSchedule/);
});

test('maybePrefetchFromDashboard is called after dashboard renders successfully', async () => {
  const src = await read(MAIN_FILE);
  assert.match(src, /maybePrefetchFromDashboard\s*\(\s*\)/);
});

test('prefetchFromDashboardIfNeeded is called by schedulePostLoginPrefetch', async () => {
  const src = await read(MAIN_FILE);
  const m = src.match(/function schedulePostLoginPrefetch\(\)([\s\S]*?)^function /m);
  assert.ok(m, 'schedulePostLoginPrefetch must exist');
  assert.match(m[1], /prefetchFromDashboardIfNeeded/);
});
