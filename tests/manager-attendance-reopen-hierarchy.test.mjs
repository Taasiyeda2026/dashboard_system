import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../supabase/migrations/20261005224842_manager_employee_reopen_hierarchy.sql', import.meta.url),
  'utf8'
);
const workspace = await readFile(new URL('../frontend/src/manager-board-workspace-runtime.js', import.meta.url), 'utf8');
const api = await readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
const control = await readFile(new URL('../frontend/src/screens/attendance-control.js', import.meta.url), 'utf8');

test('direct manager reopen RPC is limited to submitted direct-report months', () => {
  assert.match(migration, /manager_reopen_attendance_month_for_employee/);
  assert.match(migration, /v_role not in \('activities_manager', 'manager', 'instructor_manager'\)/);
  assert.match(migration, /attendance_manager_can_review_employee\(v_emp_id\)/);
  assert.match(migration, /status\), ''\), 'open'\) <> 'submitted'/);
  assert.match(migration, /manager_approved_at is not null/);
  assert.match(migration, /'employee_must_submit', true/);
});

test('reopened months are employee-owned in both database and UI gates', () => {
  assert.match(migration, /v_status <> 'submitted'/);
  assert.doesNotMatch(control, /submissionStatus === 'submitted' \|\| submissionStatus === 'reopened'/);
  assert.match(control, /submissionStatus === 'submitted'/);
  assert.match(control, /statusLabel: 'פתוח לעובד לתיקון ואישור'/);
  assert.match(control, /actionKind: 'view'/);
});

test('manager overview has the approved five columns and reopen action', () => {
  assert.match(workspace, /<th>מדריך<\/th><th>מס׳ עובד<\/th><th>דיווח \$\{escapeHtml\(ym\)\}<\/th><th>סטטוס אישור<\/th><th>פעולות<\/th>/);
  assert.match(workspace, /data-label="מס׳ עובד"/);
  assert.match(workspace, /data-label="פעולות"/);
  assert.match(workspace, /overview\.status !== 'submitted'/);
  assert.match(workspace, /data-manager-attendance-reopen-employee/);
  assert.match(workspace, /פתח חודש לעובד/);
});

test('manager and admin paths use separate server-authorized reopen RPCs', () => {
  assert.match(api, /managerReopenAttendanceMonthForEmployee/);
  assert.match(api, /manager_reopen_attendance_month_for_employee/);
  assert.match(workspace, /role\(\) === 'admin'/);
  assert.match(workspace, /adminReopenAttendanceMonthForCorrection/);
  assert.match(workspace, /managerReopenAttendanceMonthForEmployee/);
});
