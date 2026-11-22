import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { instructorAttendanceError } from '../attendance/src/services/instructor-error.service.js';
import { listManualCancellationTravelConflictDays } from '../frontend/src/screens/attendance-control.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const migration = await read('supabase/migrations/20261122180000_allow_manual_cancellation_save_manager_review.sql');
const attendanceService = await read('attendance/src/services/attendance.service.js');
const systemic = await read('supabase/migrations/20261105013000_attendance_systemic_b_through_e.sql');
const doublePay = await read('supabase/migrations/20261119190227_nov_travel_double_pay_guard.sql');
const control = await read('frontend/src/screens/attendance-control.js');
const attendanceSw = await read('attendance/sw.js');
const attendanceIndex = await read('attendance/index.html');
const frontendSw = await read('frontend/sw.js');
const config = await read('frontend/src/config.js');

test('instructor createRecord no longer blocks manual ביטול זמן on system travel path', () => {
  assert.doesNotMatch(
    attendanceService,
    /attendance_manual_cancellation_blocked_system_travel_path/
  );
  assert.match(attendanceService, /Double-pay \/ eligibility conflicts are manager\+payroll/);
});

test('migration turns the blocking trigger into a no-op without dropping payroll helpers', () => {
  assert.match(migration, /av2_block_manual_cancellation_when_system_path/);
  assert.match(migration, /Formerly raised attendance_manual_cancellation_blocked_system_travel_path/);
  assert.match(migration, /return new;/);
  assert.doesNotMatch(migration, /raise exception 'attendance_manual_cancellation_blocked_system_travel_path'/);
  assert.match(systemic, /av2_month_has_double_cancellation/);
  assert.match(doublePay, /attendance_double_cancellation_same_day/);
  assert.match(doublePay, /av2_month_has_double_cancellation/);
});

test('legacy blocked-code maps to refresh guidance, not a manager-approval save gate', () => {
  assert.match(
    instructorAttendanceError({ message: 'attendance_manual_cancellation_blocked_system_travel_path' }),
    /גרסת שרת ישנה|רעננו/
  );
  assert.doesNotMatch(
    instructorAttendanceError({ message: 'attendance_manual_cancellation_blocked_system_travel_path' }),
    /פנו למנהל לחריג|אישור מנהל/
  );
  assert.match(
    instructorAttendanceError({ message: 'attendance_double_cancellation_same_day' }),
    /כפל ביטול זמן/
  );
});

test('manager control flags manual cancellation + travel path conflicts without inventing payroll pay', () => {
  const conflicts = listManualCancellationTravelConflictDays(
    [
      {
        attendance: {
          employeeId: '1538',
          date: '2026-11-19',
          activityType: 'ביטול זמן',
          _source: { generation_kind: null },
        },
      },
      {
        attendance: {
          employeeId: '1538',
          date: '2026-11-19',
          activityType: 'ביטול זמן',
          _source: { generationKind: 'daily_travel_cancellation' },
        },
      },
      {
        attendance: {
          employeeId: '1538',
          date: '2026-11-18',
          activityType: 'ביטול זמן',
          _source: {},
        },
      },
      {
        attendance: {
          employeeId: '1540',
          date: '2026-11-18',
          activityType: 'קורס',
          _source: {},
        },
      },
    ],
    [{ emp_id: 1538, travel_date: '2026-11-18' }]
  );
  assert.deepEqual(conflicts, ['1538|2026-11-18', '1538|2026-11-19']);
  assert.match(control, /listManualCancellationTravelConflictDays/);
  assert.match(control, /ימי חשד לכפל ביטול זמן/);
  assert.match(control, /data-attendance-month-blockers/);
});

test('cache markers bumped for attendance 180 and dashboard 2126', () => {
  assert.match(attendanceSw, /const CACHE_VERSION = 180/);
  assert.match(attendanceIndex, /\?v=180/);
  assert.doesNotMatch(attendanceIndex, /\?v=179/);
  assert.match(frontendSw, /const CACHE_VERSION = 2126/);
  assert.match(config, /instructor-save-manager-separation-20261122-v1/);
});
