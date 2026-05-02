import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const read = (p) => fs.readFile(new URL(`../${p}`, import.meta.url), 'utf8');

function mustMatch(src, re, msg) {
  assert.match(src, re, msg || String(re));
}

test('dashboard snapshot: force_full uses actionDashboard_; stale/missing uses lightweight stub (no legacy dashboard)', async () => {
  const snapshot = await read('backend/dashboard-snapshot.gs');

  mustMatch(snapshot, /if \(payload && payload\.force_full === true\) \{[\s\S]*var forcedData = actionDashboard_\(user, payload\);/);
  mustMatch(snapshot, /if \(!persistedStale\.snap \|\| !persistedStale\.hasSummarySnapshotSheet\) \{[\s\S]*_snapshot_unavailable:\s*true/);
  mustMatch(snapshot, /if \(!snap \|\| !hasSummarySnapshotSheet\) \{[\s\S]*_snapshot_unavailable:\s*true/);
  mustMatch(snapshot, /totals:\s*\{\},[\s\S]*kpi_cards:\s*\[\]/);
  const staleMissingBranch = snapshot.indexOf('if (!persistedStale.snap || !persistedStale.hasSummarySnapshotSheet)');
  assert.ok(staleMissingBranch >= 0);
  const staleMissingElse = snapshot.indexOf('} else {', staleMissingBranch);
  assert.ok(staleMissingElse > staleMissingBranch);
  assert.doesNotMatch(snapshot.slice(staleMissingBranch, staleMissingElse), /actionDashboard_\(/);
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
