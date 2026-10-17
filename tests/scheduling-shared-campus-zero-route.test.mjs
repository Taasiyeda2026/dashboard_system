import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const edgePath = new URL('../supabase/functions/scheduling-route/index.ts', import.meta.url);
const migrationPath = new URL('../supabase/migrations/20261017032828_verify_shared_campus_zero_route_20261017.sql', import.meta.url);

test('reviewed same-campus zero does not generalize to generic same-city routes', async () => {
  const edge = await readFile(edgePath, 'utf8');
  assert.match(edge, /cached\.provider === 'manager_verified_shared_campus'/);
  assert.match(edge, /cached\.origin_type === 'school'/);
  assert.match(edge, /cached\.destination_type === 'school'/);
  assert.match(edge, /Number\(cached\.origin_school_id\) !== Number\(cached\.destination_school_id\)/);
  assert.match(edge, /&& !sharedCampusZero\) return false;/);
  assert.match(edge, /cached\.location_suspect === true/);
});

test('SQL route reader requires manager-verified distinct schools within 20 metres', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /q\.status='pending'/);
  assert.match(sql, /c\.provider='manager_verified_shared_campus'/);
  assert.match(sql, /ao\.approval_source='manager_confirmed_maps_20261017'/);
  assert.match(sql, /ad\.approval_source='manager_confirmed_maps_20261017'/);
  assert.match(sql, /c\.origin_school_id<>c\.destination_school_id/);
  assert.match(sql, /\)\)\)<=20/);
  assert.match(sql, /AND NOT c\.location_suspect/);
});
