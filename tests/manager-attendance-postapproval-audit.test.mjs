import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../supabase/migrations/20261125060000_manager_attendance_postapproval_audit.sql', import.meta.url), 'utf8');
const bridge = await readFile(new URL('../frontend/src/payroll-attendance-v2-bridge.js', import.meta.url), 'utf8');
const workspace = await readFile(new URL('../frontend/src/manager-board-workspace-runtime.js', import.meta.url), 'utf8');

test('postapproval audit is read-only, team-scoped and auth-restricted', () => {
  assert.match(migration, /create or replace function public\.get_manager_attendance_postapproval_changes/);
  assert.match(migration, /if auth\.uid\(\) is null then/);
  assert.match(migration, /public\.attendance_manager_can_review_employee\(m\.emp_id\)/);
  assert.match(migration, /r\.updated_at > m\.manager_approved_at/);
  assert.match(migration, /m\.emp_id = any\(p_employee_ids\)/);
  assert.match(migration, /revoke all on function public\.get_manager_attendance_postapproval_changes/);
  assert.match(migration, /grant execute on function public\.get_manager_attendance_postapproval_changes/);
  assert.doesNotMatch(migration, /\b(update|delete from|insert into)\s+public\.attendance_/i);
});

test('client queries the protected audit RPC and never mutates approved attendance', () => {
  assert.match(bridge, /api\.managerAttendancePostApprovalAudit = async function/);
  assert.match(bridge, /supabase\.rpc\('get_manager_attendance_postapproval_changes'/);
  assert.match(bridge, /p_employee_ids: ids/);
  assert.match(bridge, /p_month_key: month/);
});

test('manager board is fail-closed on audit errors and flags changed signed records', () => {
  assert.match(workspace, /const auditByEmployee = new Map\(\)/);
  assert.match(workspace, /api\.managerAttendancePostApprovalAudit\(\{ employeeIds: ids, monthKey: ym \}\)/);
  assert.match(workspace, /summary\.auditError/);
  assert.match(workspace, /postApprovalChanges > 0/);
  assert.match(workspace, /דיווחים עודכנו לאחר אישור המנהל — נדרש בירור/);
});
