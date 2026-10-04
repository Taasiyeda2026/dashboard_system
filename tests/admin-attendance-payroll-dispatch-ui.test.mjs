import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const admin = await readFile(new URL('../frontend/src/admin-attendance-standalone.js', import.meta.url), 'utf8');
const api = await readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
const migration = await readFile(
  new URL('../supabase/migrations/20261004205500_admin_attendance_payroll_dispatch.sql', import.meta.url),
  'utf8'
);
const hardeningMigration = await readFile(
  new URL('../supabase/migrations/20261004211500_harden_admin_attendance_payroll_dispatch.sql', import.meta.url),
  'utf8'
);
const finance = await readFile(new URL('../frontend/src/screens/finance.js', import.meta.url), 'utf8');

test('admin attendance overview keeps missing approvals visually empty and hides report-count noise', () => {
  assert.match(admin, /if \(!who && !when\) return '';/);
  assert.doesNotMatch(admin, /טרם אושר עובד|טרם אושר מנהל|טרם אושר סופית/);
  assert.doesNotMatch(admin, /קיים · \$\{reportCount\} דיווחים/);
  assert.match(admin, /monthMode\(monthKey\)\.key === 'closed' && !reportCount/);
  assert.match(admin, /<th>אישור אדמין<\/th>/);
});

test('admin attendance uses short operational statuses and exposes approval timestamps as details', () => {
  for (const label of ['פתוח', 'נפתח לעדכון', 'ממתין לעובד', 'ממתין למנהל', 'ממתין לאדמין', 'מוכן לשכר', 'הועבר לשכר', 'דורש תיקון']) {
    assert.match(admin, new RegExp(label));
  }
  assert.match(admin, /title="\$\{escapeHtml\(details\)\}">✓ אושר/);
});

test('payroll dispatch is explicit after admin approval and supports one or all ready employees', () => {
  assert.match(migration, /status in \('admin_approved', 'approved_for_payroll'\)/);
  assert.match(migration, /'admin_approved'/);
  assert.match(migration, /admin_send_attendance_month_to_payroll\(/);
  assert.match(migration, /admin_send_attendance_month_to_payroll_batch\(/);
  assert.match(api, /adminSendAttendanceMonthToPayroll:/);
  assert.match(api, /adminSendAttendanceMonthToPayrollBatch:/);
  assert.match(admin, /data-admin-attendance-send-payroll/);
  assert.match(admin, /data-admin-attendance-send-all/);
  assert.match(finance, /statuses: \['approved_for_payroll'\]/);
});

test('dispatch history is independent from the current approval row so reopen cannot erase payroll history', () => {
  assert.match(migration, /create table if not exists public\.payroll_attendance_dispatches/);
  assert.match(migration, /unique \(approval_id\)/);
  assert.match(migration, /alter table public\.payroll_attendance_dispatches enable row level security/);
  assert.match(migration, /grant select on table public\.payroll_attendance_dispatches to authenticated/);
  assert.match(hardeningMigration, /payroll_attendance_dispatches_insert/);
  assert.match(hardeningMigration, /app_current_role\(\)\) = 'admin'/);
  assert.match(hardeningMigration, /admin_send_attendance_month_to_payroll\(text, text, text\)[\s\S]*security invoker/);
  assert.match(hardeningMigration, /admin_send_attendance_month_to_payroll_batch\(text, text\[\], text\)[\s\S]*security invoker/);
  assert.match(api, /listAttendancePayrollDispatches:/);
  assert.match(admin, /priorDispatch/);
  assert.match(admin, /דורש תיקון/);
});
