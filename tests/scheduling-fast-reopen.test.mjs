import test from 'node:test';
import assert from 'node:assert/strict';
import { readSchedulingSessionCache, writeSchedulingSessionCache } from '../frontend/src/screens/course-scheduling-session-cache.js';
import { selectPendingRouteBatch } from '../supabase/functions/scheduling-route/pending-batch.js';

test('large scheduling snapshot restores only in its authenticated session without runtime flags', () => {
  const store = new Map();
  const storage = { getItem: k => store.get(k), setItem: (k, v) => store.set(k, v) };
  const identity = { userId: 'user', sessionId: 'session' };
  const data = { activities: [{ row_id: 'one' }], _planningShared: { rows: ['x'.repeat(2300000)] }, _planningSharedLoadedKey: 'year|', reloadPlanningSnapshot: () => {} };
  writeSchedulingSessionCache(identity, data, storage, 100);
  const restored = readSchedulingSessionCache(identity, storage, 200);
  assert.equal(restored._planningShared.rows[0].length, 2300000);
  assert.equal(restored._planningSharedLoadedKey, undefined);
  assert.equal(restored.reloadPlanningSnapshot, undefined);
  assert.equal(readSchedulingSessionCache({ ...identity, sessionId: 'another' }, storage, 200), null);
  assert.equal(readSchedulingSessionCache(identity, storage, 9 * 3600000), null);
});

test('route maintenance skips 2573 valid routes and keeps a stable cursor after writes', () => {
  const pairs = Array.from({ length: 2575 }, (_, i) => i);
  const missing = new Set([52, 2500]);
  const first = selectPendingRouteBatch(pairs, 0, 1, p => !missing.has(p));
  assert.deepEqual(first.pending, [52]);
  missing.delete(52);
  const last = selectPendingRouteBatch(pairs, first.nextOffset, 1, p => !missing.has(p));
  assert.deepEqual(last.pending, [2500]);
  assert.equal(last.nextOffset, 2575);
  assert.equal(first.skipped + last.skipped, 2573);
});
