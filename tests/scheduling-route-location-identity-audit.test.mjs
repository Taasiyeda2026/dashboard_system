import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRouteClient } from '../frontend/src/screens/course-scheduling-travel.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('quarantined routes never enter the warm scheduling cache', async () => {
  let calls = 0;
  const client = createRouteClient({
    preloadedRows: [
      { origin_key: 'city', destination_key: 'city', distance_km: 0, duration_minutes: 0, location_suspect: true },
      { origin_key: 'wrong home', destination_key: 'school', distance_km: 112, duration_minutes: 90, location_suspect: true },
      { origin_key: 'good home', destination_key: 'school', distance_km: 12, duration_minutes: 20, location_suspect: false }
    ],
    invoke: async () => { calls += 1; return { data: { batch_lookup: true, results: {} }, error: null }; }
  });
  assert.equal(client.peek('city', 'city'), null);
  assert.equal(await client.request('city', 'city'), null);
  assert.equal(client.peek('wrong home', 'school'), null);
  assert.equal((await client.request('good home','school')).distance_km, 12);
  assert.equal(calls, 0);
});

test('two different schools at the same town-level address do not become zero-distance', async () => {
  const client = createRouteClient({
    preloadedRows: [],
    invoke: async () => { throw Error('must not calculate a same-name collision'); }
  });
  const pair = {
    originSchoolName: 'School Alpha', destinationSchoolName: 'School Beta',
    originAuthorityName: 'Town', destinationAuthorityName: 'Town'
  };
  assert.equal(await client.request('Town', 'Town', pair), null);
  assert.equal(client.peek('Town', 'Town', pair), null);
});

test('the audit retains stored metrics, flags only defensible anomalies and never calls Google', async () => {
  const sql = await read('../supabase/migrations/20261016223000_route_location_identity_audit.sql');
  assert.match(sql, /add column if not exists location_suspect boolean not null default false/);
  assert.match(sql, /not c\.location_suspect/);
  assert.match(sql, /location_resolution_conflict/);
  assert.match(sql, /unverified_zero_between_distinct_schools/);
  assert.match(sql, /origin_school_id<>c\.destination_school_id/);
  assert.match(sql, /source_kind/);
  assert.doesNotMatch(sql, /routes\.googleapis|computeRoutes|pg_cron|cron\.schedule|http_post/);
  assert.doesNotMatch(sql, /delete from public\.scheduling_travel_cache|set\s+distance_km|set\s+duration_minutes/i);
});

test('edge routing does not replace a suspect route in background and maintains manual-only review', async () => {
  const edge = await read('../supabase/functions/scheduling-route/index.ts');
  assert.match(edge, /cached\.location_suspect === true/);
  assert.match(edge, /cached\?\.location_suspect === true/);
  assert.match(edge, /ambiguous_school_location/);
  assert.match(edge, /location_review_required/);
  const screen = await read('../frontend/src/screens/course-scheduling.js');
  assert.match(screen, /ביקורת מסלולים/);
  assert.match(screen, /unverified_zero_between_distinct_schools/);
  assert.match(screen, /location_resolution_conflict/);
  const queueLoad = screen.split('const reloadManualRouteQueue')[1].split('const reloadDistanceCoverage')[0];
  assert.doesNotMatch(queueLoad, /invokeDistanceRoute|runDistanceBuildLoop/);
});
