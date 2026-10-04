import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const control = await readFile(new URL('../frontend/src/screens/attendance-control.js', import.meta.url), 'utf8');
const bridge = await readFile(new URL('../frontend/src/payroll-attendance-v2-bridge.js', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20261004164845_manager_add_missing_attendance_during_review.sql', import.meta.url), 'utf8');

test('manager-created attendance is limited to active manager review and direct-manager scope', () => {
  assert.match(migration, /create or replace function public\.create_manager_attendance_record/);
  assert.match(migration, /attendance_manager_can_review_employee\(p_employee_id\)/);
  assert.match(migration, /v_status <> 'submitted'/);
  assert.match(migration, /attendance_month_not_in_manager_review/);
  assert.match(migration, /av2_attendance_month_is_closed\(p_employee_id, v_report_date\)/);
  assert.match(migration, /app\.av2_manager_attendance_write/);
  assert.match(migration, /v_manager_review_write/);
  assert.match(migration, /ama\.status = 'submitted'/);
  assert.match(migration, /insert into public\.attendance_records/);
  assert.match(migration, /'requiresManagerReview', true/);
});

test('manager-created attendance RPC is authenticated-only and exposed through the frontend bridge', () => {
  assert.match(migration, /revoke all on function public\.create_manager_attendance_record\(bigint, jsonb\) from public/);
  assert.match(migration, /revoke execute on function public\.create_manager_attendance_record\(bigint, jsonb\) from anon/);
  assert.match(migration, /grant execute on function public\.create_manager_attendance_record\(bigint, jsonb\) to authenticated/);
  assert.match(bridge, /attendanceControlCreateRecord = async function/);
  assert.match(bridge, /supabase\.rpc\('create_manager_attendance_record'/);
});

test('attendance review UI offers missing-record creation only in submitted review and reloads after create', () => {
  assert.match(control, /canManagerAddMissingAttendanceRecord/);
  assert.match(control, /resolvePayrollMonthWorkflow\(workflow\)\.status === 'submitted'/);
  assert.match(control, /data-attendance-add-record=/);
  assert.match(control, /הוספת דיווח שנשכח/);
  assert.match(control, /attendanceControlCreateRecord\(employeeId, fields\)/);
  assert.match(control, /await loadAttendanceReview\(\{ successMessage:/);
  assert.match(control, /תמתין לאישור רשומה רגיל לפני אישור החודש/);
});
