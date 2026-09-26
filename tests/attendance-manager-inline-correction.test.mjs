import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const control = await readFile(new URL('../frontend/src/screens/attendance-control.js', import.meta.url), 'utf8');
const finish = await readFile(new URL('../frontend/src/screens/payroll-control-finish.js', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20260927024000_allow_manager_attendance_date_correction.sql', import.meta.url), 'utf8');

test('attendance-only review exposes inline field editing and uses manual correction state', () => {
  assert.match(control, /data-attendance-manual-edit=/);
  assert.match(control, /data-attendance-manual-save=/);
  assert.match(control, /applyAttendanceManualCorrection\(entry, \{ \[field\]: parsed\.value \}\)/);
  assert.match(control, /data-attendance-focus-travel=/);
});

test('manager write-back supports corrected date in frontend and RPC', () => {
  assert.match(finish, /\['attendanceDate', 'date', false\]/);
  assert.match(migration, /report_date = case when p_fields \? 'attendanceDate'/);
  assert.match(migration, /payroll_attendance_permission_denied/);
});
