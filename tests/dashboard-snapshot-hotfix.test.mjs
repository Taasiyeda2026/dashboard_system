import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const read = (p) => fs.readFile(new URL(`../${p}`, import.meta.url), 'utf8');

function mustMatch(src, re, msg) {
  assert.match(src, re, msg || String(re));
}

// ---------------------------------------------------------------------------
// T1: force_full path stays legacy; stale-has-rows branch does NOT call actionDashboard_
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

  const stalePath = snapshot.indexOf('if (!persistedStale.snap || !persistedStale.hasSummarySnapshotSheet)');
  assert.ok(stalePath >= 0, 'stale missing-snapshot path must exist');
  const staleMissEnd = snapshot.indexOf('} else {', stalePath);
  assert.ok(staleMissEnd > stalePath);
  const staleMissText = snapshot.slice(stalePath, staleMissEnd);
  assert.match(staleMissText, /rebuildSnapshotInlineForMissing_\(/, 'stale missing path must use rebuildSnapshotInlineForMissing_');
  assert.doesNotMatch(staleMissText, /actionDashboard_\(user,/, 'stale missing path must NOT call actionDashboard_ directly');

  const freshPath = snapshot.indexOf('if (!snap || !hasSummarySnapshotSheet)');
  assert.ok(freshPath >= 0, 'fresh missing-snapshot path must exist');
  const freshMissText = snapshot.slice(freshPath, freshPath + 1500);
  assert.match(freshMissText, /rebuildSnapshotInlineForMissing_\(/, 'fresh missing path must use rebuildSnapshotInlineForMissing_');
});

// ---------------------------------------------------------------------------
// T3: rebuildSnapshotInlineForMissing_ — ordered call chain and return contract
// ---------------------------------------------------------------------------
test('rebuildSnapshotInlineForMissing_ exits read-only scope, calls refreshDashboardSnapshots_, re-reads and returns _is_snapshot:true', async () => {
  const snapshot = await read('backend/dashboard-snapshot.gs');

  mustMatch(snapshot, /function rebuildSnapshotInlineForMissing_\(ym, showOnlyNonzero\)/,
    'helper function must be defined');

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

  assert.match(helperText, /readPersistedDashboardSnapshotRowsForMonth_\(ym\)/, 'must re-read snapshot after rebuild');
  assert.match(helperText, /payload\._is_snapshot\s*=\s*true/, 'returned payload must have _is_snapshot: true');
  assert.match(helperText, /return null/, 'must return null on failure so caller falls through to empty stub');
});

// ---------------------------------------------------------------------------
// T4: _is_stale flag propagation on stale-rows path and fallback stub
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
// T5: refreshDashboardSnapshots_ bumps cache version after rebuild (cache invalidation fix)
// ---------------------------------------------------------------------------
test('refreshDashboardSnapshots_ calls bumpDataViewsCacheVersion_ after successful rebuild to invalidate cached stale responses', async () => {
  const snapshot = await read('backend/dashboard-snapshot.gs');

  const fnStart = snapshot.indexOf('function refreshDashboardSnapshots_()');
  assert.ok(fnStart >= 0, 'refreshDashboardSnapshots_ must be defined');
  const fnText = snapshot.slice(fnStart, fnStart + 2000);

  // bumpDataViewsCacheVersion_ must appear AFTER updateDashboardRefreshControl_ (success path)
  const updateIdx = fnText.indexOf('updateDashboardRefreshControl_');
  const bumpIdx = fnText.indexOf('bumpDataViewsCacheVersion_()');
  assert.ok(updateIdx >= 0, 'must call updateDashboardRefreshControl_ after rebuild');
  assert.ok(bumpIdx >= 0, 'must call bumpDataViewsCacheVersion_() to invalidate stale cache entries');
  assert.ok(bumpIdx > updateIdx, 'bumpDataViewsCacheVersion_() must come AFTER updateDashboardRefreshControl_ (success only)');
});

// ---------------------------------------------------------------------------
// T6: ensureDashboardSnapshotTrigger_ uses PropertiesService for cadence tracking
// ---------------------------------------------------------------------------
test('ensureDashboardSnapshotTrigger_ uses PropertiesService to record and validate 10-minute cadence', async () => {
  const snapshot = await read('backend/dashboard-snapshot.gs');
  const code = await read('backend/Code.gs');

  mustMatch(snapshot, /function ensureDashboardSnapshotTrigger_\(\)/,
    'ensureDashboardSnapshotTrigger_ must be defined in dashboard-snapshot.gs');

  const fnStart = snapshot.indexOf('function ensureDashboardSnapshotTrigger_');
  const fnText = snapshot.slice(fnStart, fnStart + 1500);

  // PropertiesService cadence key must be used
  assert.match(fnText, /PropertiesService\.getScriptProperties\(\)/, 'must use PropertiesService to track cadence');
  assert.match(fnText, /setProperty\(CADENCE_KEY,.*EXPECTED_CADENCE\)/, 'must record confirmed cadence after install');

  // Short-circuit only when BOTH trigger count === 1 AND recorded cadence matches
  assert.match(fnText, /snapshotTriggers\.length === 1 && recordedCadence === EXPECTED_CADENCE/,
    'must require both trigger-exists AND recorded cadence to match before returning early');

  // Must delete+reinstall with everyMinutes(10) when cadence unconfirmed or trigger count wrong
  assert.match(fnText, /deleteTrigger\(t\)/, 'must delete existing triggers before reinstall');
  assert.match(fnText, /everyMinutes\(10\)/, 'must reinstall at everyMinutes(10)');
  assert.match(fnText, /'repaired'/, 'must distinguish repaired vs installed (repaired literal must exist)');
  assert.match(fnText, /status:\s*'already_installed'/, 'already_installed path required when fully validated');

  // Public entrypoint in Code.gs
  mustMatch(code, /function ensureDashboardSnapshotTrigger\(\)/, 'public entrypoint must exist in Code.gs');
  mustMatch(code, /ensureDashboardSnapshotTrigger_\(\)/, 'Code.gs entrypoint must delegate to private function');
});

// ---------------------------------------------------------------------------
// T7: ensureDashboardSnapshotTrigger_ wired into installProductionAutomation (setup path)
// ---------------------------------------------------------------------------
test('ensureDashboardSnapshotTrigger_ is called from installProductionAutomation for setup-time cadence guarantee', async () => {
  const code = await read('backend/Code.gs');

  const setupStart = code.indexOf('function installProductionAutomation()');
  assert.ok(setupStart >= 0, 'installProductionAutomation must exist');
  const setupText = code.slice(setupStart, setupStart + 6000);
  assert.match(setupText, /ensureDashboardSnapshotTrigger_\(\)/,
    'installProductionAutomation must call ensureDashboardSnapshotTrigger_() to record cadence at setup time');
});

// ---------------------------------------------------------------------------
// T8: keepWarm calls ensureDashboardSnapshotTrigger_ (5-min self-healing)
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
// T9: scheduleSnapshotRebuildSoon_ cleans up and schedules one-time trigger
// ---------------------------------------------------------------------------
test('scheduleSnapshotRebuildSoon_ cleans stale pending triggers then schedules a fresh one-time rebuild', async () => {
  const snapshot = await read('backend/dashboard-snapshot.gs');

  mustMatch(snapshot, /function scheduleSnapshotRebuildSoon_\(\)/,
    'scheduleSnapshotRebuildSoon_ must be defined');

  const fnStart = snapshot.indexOf('function scheduleSnapshotRebuildSoon_');
  const fnText = snapshot.slice(fnStart, fnStart + 600);

  assert.match(fnText, /getHandlerFunction.*===.*['"]scheduledSnapshotRebuildTrigger['"]/,
    'must filter for scheduledSnapshotRebuildTrigger before deleting');
  assert.match(fnText, /deleteTrigger\(t\)/, 'must delete stale pending triggers');
  assert.match(fnText, /newTrigger\('scheduledSnapshotRebuildTrigger'\)/, 'must create new one-time trigger');
  assert.match(fnText, /\.after\(1000\)/, 'must schedule with .after(1000) for earliest possible execution');
});

// ---------------------------------------------------------------------------
// T10: scheduledSnapshotRebuildTrigger — calls refresh and self-cleans
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
// T11 (behavioral chain): router → scheduleSnapshotRebuildSoon_ after mutations
// ---------------------------------------------------------------------------
test('router.gs calls scheduleSnapshotRebuildSoon_ after data mutations to initiate background rebuild', async () => {
  const router = await read('backend/router.gs');

  mustMatch(router, /scheduleSnapshotRebuildSoon_\(\)/,
    'router must call scheduleSnapshotRebuildSoon_ after mutations');

  const markIdx = router.indexOf('markDashboardSnapshotsRefreshNeeded_');
  const schedIdx = router.indexOf('scheduleSnapshotRebuildSoon_()');
  assert.ok(markIdx >= 0, 'markDashboardSnapshotsRefreshNeeded_ must be called');
  assert.ok(schedIdx >= 0, 'scheduleSnapshotRebuildSoon_ must be called');
  assert.ok(schedIdx > markIdx, 'scheduleSnapshotRebuildSoon_ must come AFTER markDashboardSnapshotsRefreshNeeded_');
});

// ---------------------------------------------------------------------------
// T12: dashboard screen uses dashboardSnapshot (not dashboardSheet)
// ---------------------------------------------------------------------------
test('dashboard screen: load() and applyYm() use api.dashboardSnapshot — never api.dashboardSheet', async () => {
  const screen = await read('frontend/src/screens/dashboard.js');

  mustMatch(screen, /api\.dashboardSnapshot\(\s*\{/, 'dashboard load must use api.dashboardSnapshot');
  assert.doesNotMatch(screen, /api\.dashboardSheet/, 'dashboard must NOT call api.dashboardSheet');
  mustMatch(screen, /action:\s*'dashboardSnapshot'/, 'console.info/warn must log action dashboardSnapshot');
});

// ---------------------------------------------------------------------------
// T12b: api.js wires dashboardSnapshot directly to request() (not requestReadModel)
// ---------------------------------------------------------------------------
test('api.js wires dashboardSnapshot directly to request() — bypassing read-model stale error path', async () => {
  const src = await read('frontend/src/api.js');

  mustMatch(src, /dashboardSnapshot:\s*\(filters\)\s*=>\s*request\(\s*'dashboardSnapshot'/,
    'dashboardSnapshot must use request() directly so stale read-model state does not block dashboard load');

  assert.doesNotMatch(src, /dashboardSnapshot:.*requestReadModel/,
    'dashboardSnapshot must NOT route through requestReadModel (which throws on stale read model)');
});

// ---------------------------------------------------------------------------
// T12c: behavioral — mutation flow wires _is_stale to dashboard via actionDashboardSnapshot_
// ---------------------------------------------------------------------------
test('behavioral: actionDashboardSnapshot_ returns _is_stale:true when snapshot freshness control is not fresh', async () => {
  const snapshot = await read('backend/dashboard-snapshot.gs');

  // getDashboardSnapshotFreshness_ is called to check freshness
  mustMatch(snapshot, /getDashboardSnapshotFreshness_\(refreshControlMap\)/,
    'must check snapshot freshness via getDashboardSnapshotFreshness_');

  // When not fresh, stalePayload._is_stale = true is set BEFORE returning to client
  const notFreshPath = snapshot.indexOf('if (!snapshotFreshness.fresh)');
  assert.ok(notFreshPath >= 0, '!snapshotFreshness.fresh branch must exist');
  const notFreshText = snapshot.slice(notFreshPath, notFreshPath + 3000);
  assert.match(notFreshText, /stalePayload\._is_stale\s*=\s*true/,
    'not-fresh branch must mark _is_stale=true on the returned payload');
  assert.match(notFreshText, /return sanitizeDashboardSnapshotPayloadNoFinance_\(stalePayload\)/,
    'not-fresh branch must return the stale payload to client');

  // markDashboardSnapshotsRefreshNeeded_ → updateDashboardRefreshControl_('pending')
  // → getDashboardSnapshotFreshness_ sees 'pending' status → !fresh → _is_stale:true
  const markFn = snapshot.indexOf("function markDashboardSnapshotsRefreshNeeded_");
  assert.ok(markFn >= 0, 'markDashboardSnapshotsRefreshNeeded_ must be defined');
  const markText = snapshot.slice(markFn, markFn + 500);
  assert.match(markText, /updateDashboardRefreshControl_\('pending'/,
    'marking refresh needed must set control to pending status');
});

// ---------------------------------------------------------------------------
// T12d: NEITHER trigger acquires outer lock — avoids double-lock / skipped rebuilds
// ---------------------------------------------------------------------------
test('refreshDashboardSnapshotsTrigger and scheduledSnapshotRebuildTrigger have NO outer LockService lock', async () => {
  const code = await read('backend/Code.gs');

  // Helper: strip comment lines before checking for actual code calls
  function stripComments(s) {
    return s.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  }

  // 10-minute periodic trigger must NOT have outer lock
  const periodicStart = code.indexOf('function refreshDashboardSnapshotsTrigger()');
  assert.ok(periodicStart >= 0, 'refreshDashboardSnapshotsTrigger must be defined');
  const periodicText = stripComments(code.slice(periodicStart, periodicStart + 400));
  assert.doesNotMatch(periodicText, /LockService\.getScriptLock\(\)/,
    'refreshDashboardSnapshotsTrigger must NOT acquire outer lock — causes double-lock skip inside refreshDashboardSnapshots_()');
  assert.match(periodicText, /refreshDashboardSnapshots_\(\)/,
    'refreshDashboardSnapshotsTrigger must delegate directly to refreshDashboardSnapshots_()');

  // One-time rebuild trigger must NOT have outer lock either
  const onetimeStart = code.indexOf('function scheduledSnapshotRebuildTrigger()');
  assert.ok(onetimeStart >= 0, 'scheduledSnapshotRebuildTrigger must be defined');
  const onetimeText = stripComments(code.slice(onetimeStart, onetimeStart + 600));
  assert.doesNotMatch(onetimeText, /LockService\.getScriptLock\(\)/,
    'scheduledSnapshotRebuildTrigger must NOT acquire outer lock');
  assert.match(onetimeText, /refreshDashboardSnapshots_\(\)/,
    'scheduledSnapshotRebuildTrigger must call refreshDashboardSnapshots_()');
});

// ---------------------------------------------------------------------------
// T12e: rebuildSnapshotInlineForMissing_ treats skipped rebuild as failure
// ---------------------------------------------------------------------------
test('rebuildSnapshotInlineForMissing_ returns null when refreshDashboardSnapshots_ returns { skipped: true }', async () => {
  const snapshot = await read('backend/dashboard-snapshot.gs');

  const fnStart = snapshot.indexOf('function rebuildSnapshotInlineForMissing_(');
  assert.ok(fnStart >= 0);
  const fnText = snapshot.slice(fnStart, fnStart + 2000);

  assert.match(fnText, /rebuildResult = refreshDashboardSnapshots_\(\)/,
    'must capture the return value of refreshDashboardSnapshots_()');
  assert.match(fnText, /rebuildResult\.skipped === true/,
    'must check skipped:true and treat it as a failed rebuild (lock was busy)');
  assert.match(fnText, /return null/,
    'must return null when rebuild was skipped so caller serves empty stub, not stale data');
});

// ---------------------------------------------------------------------------
// T13: frontend — serverMarkedStale bypass in loadScreenDataWithCache
// ---------------------------------------------------------------------------
test('frontend loadScreenDataWithCache: server _is_stale bypasses TTL fast-path to trigger background refresh', async () => {
  const main = await read('frontend/src/main.js');

  mustMatch(main, /const serverMarkedStale\s*=\s*!!\(hit && hit\.data && hit\.data\._is_stale === true\)/,
    'serverMarkedStale guard must be computed');
  mustMatch(main, /if \(hit && age < ttl && !serverMarkedStale\) return hit\.data/,
    'TTL fast-path must be gated on !serverMarkedStale');
});

// ---------------------------------------------------------------------------
// T13: frontend — isStale respects server _is_stale flag
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
// T14: frontend — fresh stale load schedules 3s background refresh
// ---------------------------------------------------------------------------
test('frontend navigate: fresh stale load schedules 3s background refresh', async () => {
  const main = await read('frontend/src/main.js');

  mustMatch(main, /if \(data\?._is_stale === true && !STABILITY_HOTFIX_DISABLE_BACKGROUND_REFRESH\)/,
    'must check _is_stale on fresh load');
  mustMatch(main, /setTimeout\(\(\) => \{[\s\S]*backgroundRefreshScreen\(screen, cacheKey\)[\s\S]*\},\s*3000\)/,
    '3-second delayed background refresh must be scheduled');
});
