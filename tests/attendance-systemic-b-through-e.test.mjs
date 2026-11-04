import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { instructorAttendanceError } from '../attendance/src/services/instructor-error.service.js';

const migration = await readFile(
  new URL('../supabase/migrations/20261105013000_attendance_systemic_b_through_e.sql', import.meta.url),
  'utf8'
);
const attendanceService = await readFile(
  new URL('../attendance/src/services/attendance.service.js', import.meta.url),
  'utf8'
);
const control = await readFile(
  new URL('../frontend/src/screens/attendance-control.js', import.meta.url),
  'utf8'
);
const admin = await readFile(
  new URL('../frontend/src/admin-attendance-standalone.js', import.meta.url),
  'utf8'
);
const bridge = await readFile(
  new URL('../frontend/src/payroll-attendance-v2-bridge.js', import.meta.url),
  'utf8'
);
const api = await readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
const frontendSw = await readFile(new URL('../frontend/sw.js', import.meta.url), 'utf8');
const attendanceSw = await readFile(new URL('../attendance/sw.js', import.meta.url), 'utf8');
const attendanceIndex = await readFile(new URL('../attendance/index.html', import.meta.url), 'utf8');
const config = await readFile(new URL('../frontend/src/config.js', import.meta.url), 'utf8');

test('B: manual ביטול זמן blocked when system travel path exists (DB + instructor client)', () => {
  assert.match(migration, /av2_day_has_system_travel_path/);
  assert.match(migration, /av2_block_manual_cancellation_when_system_path/);
  assert.match(migration, /attendance_manual_cancellation_blocked_system_travel_path/);
  assert.match(attendanceService, /ביטול זמן/);
  assert.match(attendanceService, /attendance_manual_cancellation_blocked_system_travel_path/);
  assert.match(
    instructorAttendanceError({ message: 'attendance_manual_cancellation_blocked_system_travel_path' }),
    /ביטול זמן ידני|מסלול נסיעות/
  );
});

test('B: anti-double-pay gate blocks payroll when manual and generated cancellation share a day', () => {
  assert.match(migration, /av2_month_has_double_cancellation/);
  assert.match(migration, /attendance_double_cancellation_same_day/);
  assert.match(migration, /av2_assert_payroll_travel_review_ready[\s\S]*av2_month_has_double_cancellation/);
  assert.match(
    instructorAttendanceError({ message: 'attendance_double_cancellation_same_day' }),
    /כפל ביטול זמן/
  );
});

test('C: manager travel review hides approve without guide report and surfaces month blockers', () => {
  assert.match(control, /const canApprove = hasGuideTravelReport && !suspectCancellation && reviewStatus !== 'awaiting_report'/);
  assert.match(control, /לאישור נדרש דיווח הלוך\/חזור של המדריך/);
  assert.match(control, /data-attendance-month-blockers/);
  assert.match(control, /calculationStatus === 'unavailable'/);
});

test('D: admin pinpoint edit uses correction RPC with audit and does not auto-reopen', () => {
  assert.match(migration, /admin_correct_attendance_record/);
  assert.match(migration, /attendance_record_correction_audit/);
  assert.match(migration, /Keep month approvals intact \(no reopen\)/);
  assert.match(admin, /Point edits stay on the locked\/approved month/);
  assert.match(admin, /לא יבטל אישורים/);
  assert.match(admin, /שחרור הנעילה/);
  assert.match(bridge, /admin_correct_attendance_record/);
  assert.match(bridge, /adminCorrectPatchFromFields/);
});

test('E: payroll hold, dispatch archive, expense/cutover gates, and admin UI wiring', () => {
  assert.match(migration, /payroll_hold boolean not null default false/);
  assert.match(migration, /admin_set_attendance_payroll_hold/);
  assert.match(migration, /payroll_attendance_dispatch_history/);
  assert.match(migration, /av2_archive_payroll_dispatch/);
  assert.match(migration, /attendance_expense_reviews_pending/);
  assert.match(migration, /report_date >= date '2026-11-01'/);
  assert.match(migration, /payroll_hold boolean,/);
  assert.match(api, /adminSetAttendancePayrollHold/);
  assert.match(bridge, /adminSetAttendancePayrollHold/);
  assert.match(admin, /data-admin-attendance-hold/);
  assert.match(admin, /data-admin-attendance-clear-hold/);
  assert.match(admin, /payroll_hold === true/);
  assert.match(admin, /adminAttendanceActionError/);
  assert.match(
    instructorAttendanceError({ message: 'attendance_payroll_hold_active' }),
    /מושהית/
  );
});

test('systemic B–E migration does not rewrite historical attendance or payroll amounts', () => {
  // Pinpoint admin_correct may UPDATE one row by id; forbid bulk history rewrites.
  assert.doesNotMatch(migration, /delete from public\.attendance_records/i);
  assert.doesNotMatch(migration, /update public\.attendance_records[\s\S]{0,80}where\s+(?!id\s*=)/i);
  assert.doesNotMatch(migration, /delete from public\.payroll_attendance_dispatches/i);
  assert.doesNotMatch(migration, /update public\.payroll_control_approvals/i);
  assert.doesNotMatch(migration, /update public\.payroll_attendance_dispatches\s+set/i);
});

test('deployable cache markers bumped for systemic attendance B–E', () => {
  assert.match(frontendSw, /const CACHE_VERSION = 2090;/);
  assert.match(attendanceSw, /const CACHE_VERSION = 148;/);
  assert.match(attendanceIndex, /\?v=148/);
  assert.doesNotMatch(attendanceIndex, /\?v=147/);
  assert.match(config, /attendance-systemic-b-e-20261105-v1/);
});
