import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const read = (p) => fs.readFile(new URL(`../${p}`, import.meta.url), 'utf8');

function mustMatch(src, re, msg) {
  assert.match(src, re, msg || String(re));
}

test('dashboard snapshot stale/missing falls back to actionDashboard_ instead of empty payload', async () => {
  const snapshot = await read('backend/dashboard-snapshot.gs');

  mustMatch(snapshot, /if \(!persistedStale\.snap \|\| !persistedStale\.hasSummarySnapshotSheet\) \{[\s\S]*stalePayload = actionDashboard_\(user, payload \|\| \{\}\);/);
  mustMatch(snapshot, /stalePayload\._is_snapshot = false;/);
  mustMatch(snapshot, /stalePayload\._is_stale = true;/);
  mustMatch(snapshot, /stalePayload\._snapshot_fallback_reason = staleReason \|\| 'missing_snapshot';/);

  mustMatch(snapshot, /if \(!snap \|\| !hasSummarySnapshotSheet\) \{[\s\S]*fallbackData = actionDashboard_\(user, payload \|\| \{\}\);[\s\S]*fallbackData\._snapshot_fallback_reason = 'missing_snapshot';/);
});

test('dashboard manager mapping keeps display-only district labels', async () => {
  const snapshot = await read('backend/dashboard-snapshot.gs');

  mustMatch(snapshot, /var SNAPSHOT_MANAGER_DISPLAY_NAMES_ = \{[\s\S]*'גיל נאמן'\s*:\s*'מחוז צפון',[\s\S]*'לינוי שמואל מזרחי'\s*:\s*'מחוז דרום'[\s\S]*\};/);
});
