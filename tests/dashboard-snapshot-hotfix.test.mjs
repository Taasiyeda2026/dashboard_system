import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const read = (p) => fs.readFile(new URL(`../${p}`, import.meta.url), 'utf8');

function mustMatch(src, re, msg) {
  assert.match(src, re, msg || String(re));
}

// ---------------------------------------------------------------------------
// T1: force_full path
// ---------------------------------------------------------------------------
test('dashboard snapshot: force_full uses actionDashboard_; stale-but-has-rows branch does NOT call legacy actionDashboard_', async () => {
  const snapshot = await read('backend/dashboard-snapshot.gs');

  mustMatch(snapshot, /if \(payload && payload\.force_full === true\) \{[\s\S]*var forcedData = actionDashboard_\(user, payload\);/);

  const missingBranch = snapshot.indexOf('if (!persistedStale.snap || !persistedStale.hasSummarySnapshotSheet)');
  assert.ok(missingBranch >= 0, 'stale missing-snapshot branch must exist');
  const hasRowsBranch = snapshot.indexOf('} else {', missingBranch);
  assert.ok(hasRowsBranch > missingBranch, 'has-rows else branch must exist after missing branch');
  const hasRowsEnd = snapshot.indexOf("setRequestPerfField_('dashboard_fallback_used', false)", hasRowsBranch);
  assert.ok(hasRowsEnd > hasRowsBranch, 'has-rows branch end marker must be found');
  assert.doesNotMatch(
    snapshot.slice(hasRowsBranch, hasRowsEnd),
    /\bactionDashboard_\(/,
    'stale-but-has-rows branch must not call actionDashboard_'
  );
});

// ---------------------------------------------------------------------------
// T2: both missing-snapshot paths use rebuildSnapshotInlineForMissing_
// ---------------------------------------------------------------------------
test('dashboard snapshot: both missing-snapshot paths use rebuildSnapshotInlineForMissing_ (not direct actionDashboard_)', async () => {
  const snapshot = await read('backend/dashboard-snapshot.gs');

  // Path 1 (stale branch)
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

// ---------------------------------------------------------------------------
// T3: rebuildSnapshotInlineForMissing_ — behavioral check of the call chain
// ---------------------------------------------------------------------------
test('rebuildSnapshotInlineForMissing_ exits read-only scope, calls refreshDashboardSnapshots_, re-reads and returns _is_snapshot:true', async () => {
  const snapshot = await read('backend/dashboard-snapshot.gs');

  mustMatch(snapshot, /function rebuildSnapshotInlineForMissing_\(ym, showOnlyNonzero\)/,
    'helper function must be defined');

  // Call-chain order: endReadOnlyApiScope_ comes before refreshDashboardSnapshots_ which comes before beginReadOnlyApiScope_
  const helperStart = snapshot.indexOf('function rebuildSnapshotInlineForMissing_(');
  assert.ok(helperStart >= 0);
  const helperText = snapshot.slice(helperStart, helperStart + 2000);
  const endIdx = helperText.indexOf('endReadOnlyApiScope_()');
  const refreshIdx = helperText.indexOf('refreshDashboardSnapshots_()');
  const beginIdx = helperText.indexOf('beginReadOnlyApiScope_()');
  assert.ok(endIdx >= 0, 'must call endReadOnlyApiScope_()');
  assert.ok(refreshIdx >= 0, 'must call refreshDashboardSnapshots_()');
  assert.ok(beginIdx >= 0, 'must call beginReadOnlyApiScope_() to restore scope');
  assert.ok(endIdx < refreshIdx, 'must exit scope BEFORE calling refresh');
  assert.ok(refreshIdx < beginIdx, 'must call refresh BEFORE restoring scope');

  // Must re-read snapshot after rebuild, then return _is_snapshot:true
  assert.match(helperText, /readPersistedDashboardSnapshotRowsForMonth_\(ym\)/, 'must re-read snapshot after rebuild');
  assert.match(helperText, /payload\._is_snapshot\s*=\s*true/, 'returned payload must have _is_snapshot: true');
  assert.match(helperText, /return null/, 'must return null on failure so caller falls through to empty stub');
});

// ---------------------------------------------------------------------------
// T4: _is_stale flag propagation
// ---------------------------------------------------------------------------
test('dashboard snapshot: _is_stale flag propagated on both stale-rows path and fallback stub', async () => {
  const snapshot = await read('backend/dashboard-snapshot.gs');

  mustMatch(snapshot, /stalePayload\._is_stale\s*=\s*true/, 'stale-rows path sets _is_stale');
  mustMatch(
    snapshot,
    /_snapshot_unavailable:\s*true[\s\S]*_is_stale:\s*true|_is_stale:\s*true[\s\S]*_snapshot_unavailable:\s*true/,
    'fallback stub has both _is_stale and _snapshot_unavailable'
  );
});

// ---------------------------------------------------------------------------
// T5: ensureDashboardSnapshotTrigger_ — repairs duplicates, guarantees 10-min cadence
// ---------------------------------------------------------------------------
test('ensureDashboardSnapshotTrigger_ repairs duplicates and guarantees 10-minute cadence', async () => {
  const snapshot = await read('backend/dashboard-snapshot.gs');
  const code = await read('backend/Code.gs');

  mustMatch(snapshot, /function ensureDashboardSnapshotTrigger_\(\)/,
    'ensureDashboardSnapshotTrigger_ must be defined in dashboard-snapshot.gs');

  // Must filter to only the relevant handler — not all triggers
  mustMatch(snapshot, /getHandlerFunction.*===.*['"]refreshDashboardSnapshotsTrigger['"]/,
    'must filter triggers by refreshDashboardSnapshotsTrigger handler');

  // Duplicate repair: must delete existing triggers before reinstalling
  const fnStart = snapshot.indexOf('function ensureDashboardSnapshotTrigger_');
  const fnText = snapshot.slice(fnStart, fnStart + 1200);
  assert.match(fnText, /deleteTrigger\(t\)/, 'must delete existing triggers to repair duplicates');
  assert.match(fnText, /everyMinutes\(10\)/, 'must reinstall with everyMinutes(10) to guarantee cadence');
  assert.match(fnText, /status:.*'repaired'|'repaired'.*status:/, 'must distinguish repaired vs installed state');

  // Must be idempotent when exactly one trigger exists
  assert.match(fnText, /snapshotTriggers\.length === 1/, 'must short-circuit when exactly 1 trigger exists');
  assert.match(fnText, /status:\s*'already_installed'/, 'already_installed path required for idempotency');

  // Public entrypoint in Code.gs
  mustMatch(code, /function ensureDashboardSnapshotTrigger\(\)/, 'public entrypoint must exist in Code.gs');
  mustMatch(code, /ensureDashboardSnapshotTrigger_\(\)/, 'Code.gs entrypoint must delegate to private function');
});

// ---------------------------------------------------------------------------
// T6: keepWarm wires ensureDashboardSnapshotTrigger_ (auto-heal on every 5-min run)
// ---------------------------------------------------------------------------
test('keepWarm calls ensureDashboardSnapshotTrigger_ for automatic trigger self-healing', async () => {
  const code = await read('backend/Code.gs');

  const keepWarmStart = code.indexOf('function keepWarm()');
  assert.ok(keepWarmStart >= 0, 'keepWarm must be defined');
  const keepWarmText = code.slice(keepWarmStart, keepWarmStart + 400);
  assert.match(keepWarmText, /ensureDashboardSnapshotTrigger_\(\)/,
    'keepWarm must call ensureDashboardSnapshotTrigger_ on every run');
});

// ---------------------------------------------------------------------------
// T7: scheduleSnapshotRebuildSoon_ — one-time trigger background refresh
// ---------------------------------------------------------------------------
test('scheduleSnapshotRebuildSoon_ cleans stale pending triggers then schedules a fresh one-time rebuild', async () => {
  const snapshot = await read('backend/dashboard-snapshot.gs');

  mustMatch(snapshot, /function scheduleSnapshotRebuildSoon_\(\)/,
    'scheduleSnapshotRebuildSoon_ must be defined');

  const fnStart = snapshot.indexOf('function scheduleSnapshotRebuildSoon_');
  const fnText = snapshot.slice(fnStart, fnStart + 600);

  // Must delete stale pending rebuild triggers first (cleanup)
  assert.match(fnText, /getHandlerFunction.*===.*['"]scheduledSnapshotRebuildTrigger['"]/,
    'must filter for scheduledSnapshotRebuildTrigger before deleting');
  assert.match(fnText, /deleteTrigger\(t\)/, 'must delete stale pending triggers');

  // Must create a new one-time trigger
  assert.match(fnText, /newTrigger\('scheduledSnapshotRebuildTrigger'\)/, 'must create new one-time trigger');
  assert.match(fnText, /\.after\(1000\)/, 'must schedule with .after(1000) for earliest possible execution');
});

// ---------------------------------------------------------------------------
// T8: scheduledSnapshotRebuildTrigger — behavioral: runs full refresh, self-cleans
// ---------------------------------------------------------------------------
test('scheduledSnapshotRebuildTrigger in Code.gs calls refreshDashboardSnapshots_ and self-cleans trigger', async () => {
  const code = await read('backend/Code.gs');

  mustMatch(code, /function scheduledSnapshotRebuildTrigger\(\)/, 'handler function must exist in Code.gs');
  const fnStart = code.indexOf('function scheduledSnapshotRebuildTrigger');
  const fnText = code.slice(fnStart, fnStart + 800);
  assert.match(fnText, /refreshDashboardSnapshots_\(\)/, 'must call refreshDashboardSnapshots_()');
  assert.match(fnText, /deleteTrigger\(t\)/, 'must self-clean after running');
  assert.match(fnText, /scheduledSnapshotRebuildTrigger/, 'must delete triggers matching its own handler name');
});

// ---------------------------------------------------------------------------
// T9: router calls scheduleSnapshotRebuildSoon_ after data mutations (behavioral chain)
// ---------------------------------------------------------------------------
test('router.gs calls scheduleSnapshotRebuildSoon_ after data mutations to initiate background rebuild', async () => {
  const router = await read('backend/router.gs');

  mustMatch(router, /scheduleSnapshotRebuildSoon_\(\)/,
    'router must call scheduleSnapshotRebuildSoon_ after mutations');

  // The call must appear AFTER markDashboardSnapshotsRefreshNeeded_ in the mutation block
  const markIdx = router.indexOf('markDashboardSnapshotsRefreshNeeded_');
  const schedIdx = router.indexOf('scheduleSnapshotRebuildSoon_()');
  assert.ok(markIdx >= 0, 'markDashboardSnapshotsRefreshNeeded_ must be called');
  assert.ok(schedIdx >= 0, 'scheduleSnapshotRebuildSoon_ must be called');
  assert.ok(schedIdx > markIdx, 'scheduleSnapshotRebuildSoon_ must come AFTER markDashboardSnapshotsRefreshNeeded_');
});

// ---------------------------------------------------------------------------
// T10: frontend — serverMarkedStale bypass in loadScreenDataWithCache
// ---------------------------------------------------------------------------
test('frontend loadScreenDataWithCache: server _is_stale bypasses TTL fast-path to trigger background refresh', async () => {
  const main = await read('frontend/src/main.js');

  mustMatch(main, /const serverMarkedStale\s*=\s*!!\(hit && hit\.data && hit\.data\._is_stale === true\)/,
    'serverMarkedStale guard must be computed');
  mustMatch(main, /if \(hit && age < ttl && !serverMarkedStale\) return hit\.data/,
    'TTL fast-path must be gated on !serverMarkedStale');
});

// ---------------------------------------------------------------------------
// T11: frontend — isStale respects server _is_stale flag
// ---------------------------------------------------------------------------
test('frontend navigate: isStale also true when rawEntry.data._is_stale from server', async () => {
  const main = await read('frontend/src/main.js');

  mustMatch(
    main,
    /const isStale = rawEntry && \(Date\.now\(\) - rawEntry\.t >= screenCacheTtl\(\) \|\| rawEntry\.data\?._is_stale === true\)/,
    'isStale must include server _is_stale flag'
  );
});

// ---------------------------------------------------------------------------
// T12: frontend — fresh stale load schedules 3s background refresh
// ---------------------------------------------------------------------------
test('frontend navigate: fresh stale load schedules 3s background refresh', async () => {
  const main = await read('frontend/src/main.js');

  mustMatch(main, /if \(data\?._is_stale === true && !STABILITY_HOTFIX_DISABLE_BACKGROUND_REFRESH\)/,
    'must check _is_stale on fresh load');
  mustMatch(main, /setTimeout\(\(\) => \{[\s\S]*backgroundRefreshScreen\(screen, cacheKey\)[\s\S]*\},\s*3000\)/,
    '3-second delayed background refresh must be scheduled');
});
