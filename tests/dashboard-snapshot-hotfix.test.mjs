import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const read = (p) => fs.readFile(new URL(`../${p}`, import.meta.url), 'utf8');

function mustMatch(src, re, msg) {
  assert.match(src, re, msg || String(re));
}

test('dashboard snapshot: force_full uses actionDashboard_; stale-but-has-rows branch does NOT call legacy actionDashboard_', async () => {
  const snapshot = await read('backend/dashboard-snapshot.gs');

  mustMatch(snapshot, /if \(payload && payload\.force_full === true\) \{[\s\S]*var forcedData = actionDashboard_\(user, payload\);/);

  // The has-rows (else) branch must NOT call actionDashboard_ — it reads from snapshot rows.
  const missingBranch = snapshot.indexOf('if (!persistedStale.snap || !persistedStale.hasSummarySnapshotSheet)');
  assert.ok(missingBranch >= 0, 'stale missing-snapshot branch must exist');
  const hasRowsBranch = snapshot.indexOf('} else {', missingBranch);
  assert.ok(hasRowsBranch > missingBranch, 'has-rows else branch must exist after missing branch');
  const hasRowsEnd = snapshot.indexOf('setRequestPerfField_(\'dashboard_fallback_used\', false)', hasRowsBranch);
  assert.ok(hasRowsEnd > hasRowsBranch, 'has-rows branch end marker must be found');
  assert.doesNotMatch(
    snapshot.slice(hasRowsBranch, hasRowsEnd),
    /\bactionDashboard_\(/,
    'stale-but-has-rows branch must not call actionDashboard_'
  );
});

test('dashboard snapshot: both missing-snapshot paths use rebuildSnapshotInlineForMissing_ (not direct actionDashboard_)', async () => {
  const snapshot = await read('backend/dashboard-snapshot.gs');

  // Path 1 (stale branch) — checks for inline rebuild helper call
  const stalePath = snapshot.indexOf('if (!persistedStale.snap || !persistedStale.hasSummarySnapshotSheet)');
  assert.ok(stalePath >= 0, 'stale missing-snapshot path must exist');
  const staleMissEnd = snapshot.indexOf('} else {', stalePath);
  assert.ok(staleMissEnd > stalePath);
  const staleMissText = snapshot.slice(stalePath, staleMissEnd);
  assert.match(staleMissText, /rebuildSnapshotInlineForMissing_\(/, 'stale missing path must use rebuildSnapshotInlineForMissing_');
  assert.doesNotMatch(staleMissText, /actionDashboard_\(user,/, 'stale missing path must NOT call actionDashboard_ directly');

  // Path 2 (fresh branch — after monthly view lookup)
  const freshPath = snapshot.indexOf('if (!snap || !hasSummarySnapshotSheet)');
  assert.ok(freshPath >= 0, 'fresh missing-snapshot path must exist');
  const freshMissText = snapshot.slice(freshPath, freshPath + 1500);
  assert.match(freshMissText, /rebuildSnapshotInlineForMissing_\(/, 'fresh missing path must use rebuildSnapshotInlineForMissing_');
});

test('dashboard snapshot: rebuildSnapshotInlineForMissing_ exits read-only scope, calls refreshDashboardSnapshots_, re-reads and returns _is_snapshot: true', async () => {
  const snapshot = await read('backend/dashboard-snapshot.gs');

  mustMatch(snapshot, /function rebuildSnapshotInlineForMissing_\(ym, showOnlyNonzero\)/,
    'helper function must be defined');
  mustMatch(snapshot, /endReadOnlyApiScope_\(\)[\s\S]*refreshDashboardSnapshots_\(\)[\s\S]*beginReadOnlyApiScope_\(\)/,
    'must exit scope, call refresh, restore scope');
  mustMatch(snapshot, /readPersistedDashboardSnapshotRowsForMonth_\(ym\)/,
    'must re-read snapshot after rebuild');
  mustMatch(snapshot, /payload\._is_snapshot\s*=\s*true/,
    'returned payload must have _is_snapshot: true');
  mustMatch(snapshot, /return null/,
    'must return null on failure so caller falls through to empty stub');
});

test('dashboard snapshot: _is_stale flag propagated on both stale-rows path and fallback stub', async () => {
  const snapshot = await read('backend/dashboard-snapshot.gs');

  mustMatch(snapshot, /stalePayload\._is_stale\s*=\s*true/, 'stale-rows path sets _is_stale');
  mustMatch(snapshot, /_snapshot_unavailable:\s*true[\s\S]*_is_stale:\s*true|_is_stale:\s*true[\s\S]*_snapshot_unavailable:\s*true/,
    'fallback stub has both _is_stale and _snapshot_unavailable');
});

test('dashboard snapshot: ensureDashboardSnapshotTrigger_ installs 10-minute trigger if missing', async () => {
  const snapshot = await read('backend/dashboard-snapshot.gs');
  const code = await read('backend/Code.gs');

  mustMatch(snapshot, /function ensureDashboardSnapshotTrigger_\(\)/,
    'ensureDashboardSnapshotTrigger_ must be defined in dashboard-snapshot.gs');
  mustMatch(snapshot, /refreshDashboardSnapshotsTrigger[\s\S]*everyMinutes\(10\)/,
    'trigger install must use everyMinutes(10)');
  mustMatch(snapshot, /status:\s*'already_installed'/,
    'must be idempotent — already_installed path required');
  mustMatch(code, /function ensureDashboardSnapshotTrigger\(\)/,
    'public entrypoint ensureDashboardSnapshotTrigger must exist in Code.gs');
  mustMatch(code, /ensureDashboardSnapshotTrigger_\(\)/,
    'Code.gs entrypoint must delegate to private function');
});

test('dashboard manager mapping keeps display-only district labels', async () => {
  const snapshot = await read('backend/dashboard-snapshot.gs');

  mustMatch(snapshot, /var SNAPSHOT_MANAGER_DISPLAY_NAMES_ = \{[\s\S]*'גיל נאמן'\s*:\s*'מחוז צפון',[\s\S]*'לינוי שמואל מזרחי'\s*:\s*'מחוז דרום'[\s\S]*\};/);
});

test('dashboard snapshot payload strips finance fields from fallback payload', async () => {
  const snapshot = await read('backend/dashboard-snapshot.gs');
  mustMatch(snapshot, /function sanitizeDashboardSnapshotPayloadNoFinance_\(/);
  mustMatch(snapshot, /delete payload\.can_view_finance/);
  mustMatch(snapshot, /delete payload\.summary\.finance_open_count/);
});

test('frontend loadScreenDataWithCache: server _is_stale bypasses TTL fast-path to trigger background refresh', async () => {
  const main = await read('frontend/src/main.js');

  mustMatch(main, /const serverMarkedStale\s*=\s*!!\(hit && hit\.data && hit\.data\._is_stale === true\)/,
    'serverMarkedStale guard must be computed');
  mustMatch(main, /if \(hit && age < ttl && !serverMarkedStale\) return hit\.data/,
    'TTL fast-path must be gated on !serverMarkedStale');
});

test('frontend navigate: isStale also true when rawEntry.data._is_stale from server', async () => {
  const main = await read('frontend/src/main.js');

  mustMatch(
    main,
    /const isStale = rawEntry && \(Date\.now\(\) - rawEntry\.t >= screenCacheTtl\(\) \|\| rawEntry\.data\?._is_stale === true\)/,
    'isStale must include server _is_stale flag'
  );
});

test('frontend navigate: fresh stale load schedules 3s background refresh', async () => {
  const main = await read('frontend/src/main.js');

  mustMatch(main, /if \(data\?._is_stale === true && !STABILITY_HOTFIX_DISABLE_BACKGROUND_REFRESH\)/,
    'must check _is_stale on fresh load');
  mustMatch(main, /setTimeout\(\(\) => \{[\s\S]*backgroundRefreshScreen\(screen, cacheKey\)[\s\S]*\},\s*3000\)/,
    '3-second delayed background refresh must be scheduled');
});
