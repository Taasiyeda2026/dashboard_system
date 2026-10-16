import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workerUrl = new URL('../supabase/functions/scheduling-route-maintenance/index.ts', import.meta.url);
const migrationUrl = new URL('../supabase/migrations/20261016154952_scheduling_route_missing_segment_backfill_20261016.sql', import.meta.url);

test('route backfill is isolated from scheduling writes and requires vault authentication', async () => {
  const source = await readFile(workerUrl, 'utf8');
  assert.match(source, /scheduling_route_maintenance_authorized/);
  assert.match(source, /x-route-maintenance-key/);
  assert.match(source, /\.eq\('status', 'queued'\)/);
  assert.match(source, /requests\.length > 100/);
  assert.doesNotMatch(source, /\.from\('activities'\)|\.from\('scheduling_planning_rows'\)/);
  assert.doesNotMatch(source, /\.from\('attendance_records'\)|\.from\('payroll_/);
});

test('route repair refuses to infer zero distance from shared locality addresses', async () => {
  const source = await readFile(workerUrl, 'utf8');
  assert.match(source, /function ambiguousSameAddress/);
  assert.match(source, /ambiguous_same_address/);
  assert.match(source, /unverified_zero_route/);
  assert.match(source, /pair\.from\.entity !== pair\.to\.entity/);
  assert.match(source, /parseGoogleRouteMetrics/);
});

test('return routes satisfy existing cache destination-type contract', async () => {
  const source = await readFile(workerUrl, 'utf8');
  assert.match(source, /destination_type: pair\.to\.type === 'instructor' \? 'location' : pair\.to\.type/);
  assert.match(source, /if \(includeReverse\) pairs\.push\(travelPair\(to, from/);
  assert.match(source, /origin_entity_key: pair\.from\.entity/);
  assert.match(source, /destination_entity_key: pair\.to\.entity/);
});

test('the maintenance audit is isolated by RLS', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE .* FROM PUBLIC, anon, authenticated/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION .* FROM PUBLIC, anon, authenticated/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION .* TO service_role/i);
  assert.doesNotMatch(sql, /GRANT.*TO authenticated/i);
});

test('school map CID must match Google Places result, not a text-search guess', async () => {
  const source = await readFile(workerUrl, 'utf8');
  assert.match(source, /places\.googleMapsUri/);
  assert.match(source, /places:searchText/);
  assert.match(source, /c\.cid === cid/);
  assert.match(source, /not_verified/);
  assert.match(source, /resolveMode/);
  assert.match(source, /run_not_queued/);
});
