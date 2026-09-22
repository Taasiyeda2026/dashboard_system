import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../supabase/migrations/20260922162526_attendance_base_training_travel_details.sql', import.meta.url),
  'utf8'
);
const bridge = await readFile(new URL('../frontend/src/payroll-attendance-v2-bridge.js', import.meta.url), 'utf8');
const control = await readFile(new URL('../frontend/src/screens/attendance-control.js', import.meta.url), 'utf8');

test('base training uses the fixed Greenwork destination for trusted travel calculation', () => {
  assert.match(migration, /6RVR\+XM, יקום/);
  assert.match(migration, /normalized_type = 'הכשרה'[\s\S]*הכשרת בסיס/);
  assert.match(migration, /destination_key[\s\S]*training:base_training/);
  assert.match(migration, /av2_prepare_attendance_travel\(rec\.id, rec\.auth_user_id\)/);
});

test('attendance control receives compensation for both source and generated rows', () => {
  assert.match(migration, /v\.record_id=c\.source_attendance_record_id[\s\S]*v\.record_id=c\.generated_attendance_record_id/);
  assert.match(migration, /calculation_status text[\s\S]*failure_code text/);
  assert.match(bridge, /travelBySource/);
  assert.match(bridge, /generated:\s*Boolean\(generatedTravel\)/);
  assert.match(bridge, /travelCalculationStatus:\s*text\(travel\?\.calculation_status\)/);
});

test('manager and admin report card shows automatic travel and time-cancellation detail', () => {
  assert.match(control, /זמן נסיעה הלוך/);
  assert.match(control, /זמן נסיעה חזור/);
  assert.match(control, /מחושב אוטומטית לפי זמן הנסיעה/);
  assert.match(control, /ממתין לחישוב זמן הנסיעה/);
  assert.match(control, /חסרה כתובת מדריך/);
  assert.match(control, /travelCompensationDisplay\(source\)/);
});
