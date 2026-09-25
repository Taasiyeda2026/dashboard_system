import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20260925102000_attendance_generic_location_contexts.sql', import.meta.url), 'utf8');
const bridge = await readFile(new URL('../frontend/src/payroll-attendance-v2-bridge.js', import.meta.url), 'utf8');
const control = await readFile(new URL('../frontend/src/screens/attendance-control.js', import.meta.url), 'utf8');

test('generic attendance location context is manager-scoped and supports non-school destinations', () => {
  assert.match(migration, /get_payroll_attendance_records/);
  assert.match(migration, /destination_address_snapshot/);
  assert.match(migration, /destination_type text/);
  assert.match(migration, /in \('school','location'\)/);
  assert.match(migration, /grant execute[\s\S]*to authenticated/);
});

test('attendance bridge and control preserve physical location identity', () => {
  assert.match(bridge, /get_payroll_attendance_location_contexts/);
  assert.match(bridge, /destinationAddress/);
  assert.match(bridge, /destinationEntityKey/);
  assert.match(control, /destinationAddress/);
  assert.match(control, /routeLocationFromStop/);
  assert.match(control, /A null school_id by itself is not a missing route/);
});

test('travel compensation context treats a trusted physical destination as a location, not a school requirement', () => {
  assert.match(migration, /av2_attendance_travel_context/);
  assert.match(migration, /destination_address_snapshot/);
  assert.match(migration, /destination_type', 'location'/);
  assert.match(migration, /s\.school_id is null[\s\S]*destination_address/);
  assert.match(migration, /training:base_training/);
  assert.match(migration, /location:training:/);
  assert.match(migration, /location:external:/);
});

test('generic location SQL keeps canonical whitespace regex and matching training identities', () => {
  assert.equal(migration.includes("'\\\\s+'"), false, 'SQL regex must contain one backslash, not a literal double-backslash');
  assert.ok((migration.match(/location:training:/g) || []).length >= 2, 'location RPC and travel context must use the same training identity');
});
