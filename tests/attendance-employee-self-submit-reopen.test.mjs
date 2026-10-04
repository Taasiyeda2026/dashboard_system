import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canEditMonth } from '../attendance/src/services/month-gate.service.js';

const migration = await readFile(
  new URL('../supabase/migrations/20261004180500_employee_self_submit_after_admin_reopen.sql', import.meta.url),
  'utf8'
);
const runtime = await readFile(new URL('../frontend/src/attendance-self-submit-reopen-runtime.js', import.meta.url), 'utf8');
const marker = await readFile(new URL('../frontend/src/release-marker-20260908.js', import.meta.url), 'utf8');
const attendanceIndex = await readFile(new URL('../attendance/index.html', import.meta.url), 'utf8');
const attendanceSw = await readFile(new URL('../attendance/sw.js', import.meta.url), 'utf8');

test('normal month cutoff remains day 2 while explicit admin reopen stays editable until employee submits', () => {
  const oct4 = new Date(2026, 9, 4, 12, 0, 0);
  assert.equal(canEditMonth(2026, 9, null, oct4), false);
  assert.equal(canEditMonth(2026, 9, { status: 'open' }, oct4), false);
  assert.equal(canEditMonth(2026, 9, { status: 'reopened' }, oct4), true);
  assert.equal(canEditMonth(2026, 8, { status: 'reopened' }, oct4), true);
  assert.equal(canEditMonth(2026, 9, { status: 'submitted' }, oct4), false);
  assert.equal(canEditMonth(2026, 9, { status: 'locked' }, oct4), false);
});

test('database reopen creates missing approval row, requires admin reason, and preserves target employee identity', () => {
  assert.match(migration, /attendance_reopen_reason_required/);
  assert.match(migration, /if v_role <> 'admin'/);
  assert.match(migration, /insert into public\.attendance_month_approvals/);
  assert.match(migration, /on conflict \(emp_id, month_key\) do update/);
  assert.match(migration, /app\.av2_submission_override_emp_id/);
  assert.match(migration, /'employee_must_submit', true/);
  assert.match(migration, /reopened_at/);
  assert.match(migration, /reopened_by_name/);
  assert.match(migration, /reopen_reason/);
});

test('server write gate treats reopened as explicit exception and blocks final payroll', () => {
  assert.match(migration, /if v_status = 'reopened' then\s+return true;/);
  assert.match(migration, /pca\.status = 'approved_for_payroll'/);
  assert.match(migration, /if v_status in \('submitted', 'locked'\) then\s+return false;/);
});

test('admin submit-on-behalf is disabled for signed-in application users', () => {
  assert.match(
    migration,
    /revoke all on function public\.admin_submit_attendance_month_on_behalf\(text, text, text\)\s+from public, anon, authenticated;/
  );
});

test('dashboard runtime exposes reopen-to-employee and replaces ambiguous manager status', () => {
  assert.match(runtime, /פתח לעובד להשלמה ואישור/);
  assert.match(runtime, /טרם אושר על ידי העובד/);
  assert.match(runtime, /פתוח לעובד להשלמה ואישור/);
  assert.match(runtime, /✓ המדריך אישר · ממתין לבקרת מנהל/);
  assert.match(runtime, /טרם אושר על ידי המדריך/);
  assert.match(runtime, /adminReopenAttendanceMonthForCorrection/);
  assert.match(marker, /attendance-self-submit-reopen-runtime\.js\?v=20261004-employee-self-submit-v1/);
});

test('attendance app cache version is bumped so the reopened-month gate reaches instructors', () => {
  assert.match(attendanceSw, /const CACHE_VERSION = 104;/);
  assert.match(attendanceIndex, /src\/main\.js\?v=104/);
});
