import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRouteClient, routeMatrixKey } from '../frontend/src/screens/course-scheduling-travel.js';

test('scheduling-route edge function exposes batch_lookup mode', async () => {
  const source = await readFile(new URL('../supabase/functions/scheduling-route/index.ts', import.meta.url), 'utf8');
  assert.match(source, /mode === 'batch_lookup'/);
  assert.match(source, /runBatchDynamicRouteLookup/);
  assert.match(source, /MAX_BATCH_LOOKUP_PAIRS = 80/);
});

test('route client batches uncached pairs into one edge invoke', async () => {
  let invokes = 0;
  let maxPairs = 0;
  const client = createRouteClient({
    batchSize: 80,
    concurrency: 2,
    invoke: async (body) => {
      invokes += 1;
      assert.equal(body.mode, 'batch_lookup');
      maxPairs = Math.max(maxPairs, body.pairs?.length || 0);
      const results = Object.fromEntries((body.pairs || []).map((pair) => [
        pair.route_key,
        { calculated: true, cached: true, distance_km: 3, duration_minutes: 6 }
      ]));
      return { data: { batch_lookup: true, results } };
    }
  });

  const origins = Array.from({ length: 120 }, (_, index) => `origin-${index}`);
  await Promise.all(origins.map((origin) => client.request(origin, 'shared-dest')));
  await client.flush();

  assert.equal(invokes, 2);
  assert.equal(maxPairs, 80);
  assert.equal(client.batchInvokes, 2);
  assert.equal(client.googleCalls, 0);
  assert.equal(
    (await client.request('origin-0', 'shared-dest'))?.duration_minutes,
    6
  );
});

test('route client batch uses stable matrix keys', async () => {
  const seenKeys = [];
  const client = createRouteClient({
    invoke: async (body) => {
      for (const pair of body.pairs || []) seenKeys.push(pair.route_key);
      const results = Object.fromEntries((body.pairs || []).map((pair) => [
        pair.route_key,
        { calculated: true, cached: true, distance_km: 1, duration_minutes: 2 }
      ]));
      return { data: { batch_lookup: true, results } };
    }
  });
  await client.request('Alpha  Street', 'Beta  Lane');
  await client.flush();
  assert.deepEqual(seenKeys, [routeMatrixKey('Alpha  Street', 'Beta  Lane')]);
});

test('planning run lease migration defines acquire and release RPCs', async () => {
  const source = await readFile(
    new URL('../supabase/migrations/20261005193000_scheduling_planning_run_leases.sql', import.meta.url),
    'utf8'
  );
  assert.match(source, /scheduling_planning_run_leases/);
  assert.match(source, /acquire_scheduling_planning_run_lease/);
  assert.match(source, /release_scheduling_planning_run_lease/);
  assert.match(source, /period_key, district/);
  assert.match(source, /existing\.run_id <> v_run_id/);
  assert.match(source, /'reason', 'planning_run_locked'/);
  assert.doesNotMatch(source, /set run_id = v_run_id/);
});
