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

  // The stale branch (has rows) must NOT call actionDashboard_ — it reads from snapshot rows.
  const hasSummaryBranch = snapshot.indexOf('} else {', snapshot.indexOf('if (!persistedStale.snap || !persistedStale.hasSummarySnapshotSheet)'));
  assert.ok(hasSummaryBranch > 0, 'has-rows else branch must exist');
  const hasSummaryEnd = snapshot.indexOf('setRequestPerfField_(\'dashboard_fallback_used\', false)', hasSummaryBranch);
  assert.ok(hasSummaryEnd > hasSummaryBranch, 'has-rows branch end marker must be found');
  assert.doesNotMatch(
    snapshot.slice(hasSummaryBranch, hasSummaryEnd),
    /\bactionDashboard_\(/,
    'stale-but-has-rows branch must not call actionDashboard_'
  );
});

test('dashboard snapshot: missing branch tries inline full compute before returning empty stub', async () => {
  const snapshot = await read('backend/dashboard-snapshot.gs');

  const missingBranch = snapshot.indexOf('if (!persistedStale.snap || !persistedStale.hasSummarySnapshotSheet)');
  assert.ok(missingBranch >= 0, 'missing snapshot branch must exist');

  // Inline rebuild: must try actionDashboard_ for real data
  const elseMarker = snapshot.indexOf('} else {', missingBranch);
  const missingBranchText = snapshot.slice(missingBranch, elseMarker);
  assert.match(missingBranchText, /actionDashboard_\(user,/, 'missing branch must try inline actionDashboard_');
  assert.match(missingBranchText, /_snapshot_rebuilt_inline\s*[=:]\s*true/, 'missing branch must mark inline rebuild');

  // Empty stub fallback (catch block) must still have _snapshot_unavailable: true
  assert.match(missingBranchText, /_snapshot_unavailable:\s*true/, 'catch fallback must have _snapshot_unavailable: true');
});

test('dashboard snapshot: _is_stale flag propagated on both missing and stale-rows paths', async () => {
  const snapshot = await read('backend/dashboard-snapshot.gs');

  // Both paths set _is_stale: true
  mustMatch(snapshot, /inlineData\._is_stale\s*=\s*true/, 'inline rebuild sets _is_stale');
  mustMatch(snapshot, /stalePayload\._is_stale\s*=\s*true/, 'stale-rows path sets _is_stale');
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

  // The fast-path return must exclude server-stale entries
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
