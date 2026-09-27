import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const control = await readFile(new URL('../frontend/src/screens/attendance-control.js', import.meta.url), 'utf8');
const finish = await readFile(new URL('../frontend/src/screens/payroll-control-finish.js', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20260927025000_sync_manager_attendance_generated_travel_corrections.sql', import.meta.url), 'utf8');

test('attendance-only review exposes inline field editing and uses manual correction state', () => {
  assert.match(control, /data-attendance-edit-record=/);
  assert.match(control, /data-attendance-approve-reported=/);
  assert.match(control, /data-attendance-manual-edit=/);
  assert.match(control, /data-attendance-manual-save=/);
  assert.match(control, /applyAttendanceManualCorrection\(entry, \{ \[field\]: parsed\.value \}\)/);
  assert.match(control, /TRAVEL_EDITABLE_FIELDS\.has\(field\)/);
  assert.match(control, /data-field-key="\$\{escapeHtml\(key\)\}"/);
  assert.doesNotMatch(control, /data-attendance-focus-travel="\$\{escapeHtml\(entry\.id\)\}">עריכת נסיעה/);
});

test('manager write-back supports corrected date and keeps generated travel cancellation synchronized', () => {
  assert.match(finish, /\['attendanceDate', 'date', false\]/);
  assert.match(migration, /report_date = case when p_fields \? 'attendanceDate'/);
  assert.match(migration, /set_config\('app\.av2_compensation_write', '1', true\)/);
  assert.match(migration, /child\.source_attendance_record_id = v_row\.id/);
  assert.match(migration, /child\.generation_kind = 'travel_time_cancellation'/);
  assert.match(migration, /final_cancellation_minutes = greatest/);
  assert.match(migration, /manually_overridden = true/);
  assert.match(migration, /override_by = auth\.uid\(\)/);
  assert.match(migration, /payroll_attendance_permission_denied/);
});
