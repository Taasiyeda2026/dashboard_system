import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const schemaUrl = new URL('../supabase/migrations/20260802220000_course_scheduling_interface_schema.sql', import.meta.url);
const edgeFunctionUrl = new URL('../supabase/functions/scheduling-route/index.ts', import.meta.url);

test('the travel cache gains authority/school/address columns instead of a duplicate table', async () => {
  const sql = await readFile(schemaUrl, 'utf8');
  assert.match(sql, /alter table public\.scheduling_travel_cache/);
  for (const column of ['authority_id', 'origin_school_id', 'destination_school_id', 'origin_address', 'destination_address']) {
    assert.match(sql, new RegExp(`add column if not exists ${column}`));
  }
  assert.doesNotMatch(sql, /create table.*scheduling_travel_cache/);
});

test('the authority-school-locations helper only looks at school_2027 courses and reuses the existing address resolver', async () => {
  const sql = await readFile(schemaUrl, 'utf8');
  assert.match(sql, /create or replace function public\.scheduling_authority_school_locations/);
  assert.match(sql, /a\.activity_season = 'school_2027'/);
  assert.match(sql, /public\.scheduling_school_location\(a\.school_id, a\.school, a\.authority_id, a\.authority\)/);
});

test('the batch update stays a separate, explicit mode from the single-pair candidate lookup', async () => {
  const ts = await readFile(edgeFunctionUrl, 'utf8');
  assert.match(ts, /payload\.batch === true/);
  assert.match(ts, /function runBatchAuthorityUpdate/);
  // The single-pair path (per-candidate matching) must still exist untouched alongside it.
  assert.match(ts, /const origin = String\(payload\.origin \|\| ''\)\.trim\(\);/);
});

test('batch pairs are only ever generated within one authority group, never across authorities', async () => {
  const ts = await readFile(edgeFunctionUrl, 'utf8');
  const batchFn = ts.split('async function runBatchAuthorityUpdate')[1].split('Deno.serve')[0];
  assert.match(batchFn, /for \(const \[, list\] of groups\)/);
  assert.doesNotMatch(batchFn, /groups\.values\(\)\.flat\(\)/);
});

test('same-school pairs are stored as zero without ever calling the maps service', async () => {
  const ts = await readFile(edgeFunctionUrl, 'utf8');
  const batchFn = ts.split('async function runBatchAuthorityUpdate')[1].split('Deno.serve')[0];
  assert.match(batchFn, /cacheKey\(pair\.origin\) === cacheKey\(pair\.destination\)/);
  assert.match(batchFn, /distance_km: 0, duration_minutes: 0, provider: 'same_school'/);
});

test('a still-valid, address-matched cache entry is skipped instead of recomputed', async () => {
  const ts = await readFile(edgeFunctionUrl, 'utf8');
  const batchFn = ts.split('async function runBatchAuthorityUpdate')[1].split('Deno.serve')[0];
  assert.match(batchFn, /new Date\(cached\.expires_at\)\.getTime\(\) > Date\.now\(\)/);
  assert.match(batchFn, /String\(cached\.origin_address \|\| ''\) === pair\.origin/);
});

test('missing addresses are counted and reported instead of a fabricated distance', async () => {
  const ts = await readFile(edgeFunctionUrl, 'utf8');
  const batchFn = ts.split('async function runBatchAuthorityUpdate')[1].split('Deno.serve')[0];
  assert.match(batchFn, /missingAddressCount \+= 1/);
  assert.match(ts, /missing_address_count: missingAddressCount/);
});

test('the number of route calls per run is capped', async () => {
  const ts = await readFile(edgeFunctionUrl, 'utf8');
  assert.match(ts, /const MAX_PAIRS_PER_RUN = \d+/);
  assert.match(ts, /capped: pairs\.length > MAX_PAIRS_PER_RUN/);
});

test('the batch endpoint still requires the admin/operation_manager role like the single-pair endpoint', async () => {
  const ts = await readFile(edgeFunctionUrl, 'utf8');
  const roleCheckIndex = ts.indexOf("['admin', 'operation_manager'].includes");
  const batchDispatchIndex = ts.indexOf('runBatchAuthorityUpdate(db, key)');
  assert.ok(roleCheckIndex > -1 && batchDispatchIndex > roleCheckIndex, 'role check must happen before the batch mode can run');
});
