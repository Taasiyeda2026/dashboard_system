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
