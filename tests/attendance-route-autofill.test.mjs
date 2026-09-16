import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const edge = await readFile(new URL('../supabase/functions/scheduling-route/index.ts', import.meta.url), 'utf8');
const api = await readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');

test('payroll route build includes actual attendance-day stops with stable school identity', () => {
  const fn = edge.split('async function loadPayrollMonthPairs')[1].split('async function mapWithConcurrency')[0];
  assert.match(fn, /from\('attendance_records'\)/);
  assert.match(fn, /activity_row_id/);
  assert.match(fn, /generation_kind/);
  assert.match(fn, /travel_time_cancellation/);
  assert.match(fn, /attendanceDayStops/);
  assert.match(fn, /row\.school_id \?\? linkedActivity\.school_id/);
  assert.match(fn, /resolvePayrollActivitySchool\(schoolSource, catalog\)/);
  assert.match(fn, /payrollSchoolSchoolPair\(sequence\[index - 1\]\.school, sequence\[index\]\.school\)/);
  assert.match(fn, /payrollInstructorSchoolPair\(instructor, sequence\[sequence\.length - 1\]\.school\)/);
});

test('route build can be scoped to only attendance-control employees', () => {
  assert.match(edge, /payload\.employee_ids/);
  assert.match(edge, /loadPayrollMonthPairs\(db, month, employeeIds\)/);
  const fn = edge.split('async function loadPayrollMonthPairs')[1].split('async function mapWithConcurrency')[0];
  assert.match(fn, /employeeFilter/);
  assert.match(fn, /assignedPayrollEmpIds\(activity\)\.filter\(employeeAllowed\)/);
});

test('attendance control auto-fills only missing monthly routes before reading the cache', () => {
  const fn = api.split('attendanceControlDashboardSources: async')[1].split('\n  },\n  activities: async')[0];
  assert.match(fn, /functions\.invoke\('scheduling-route'/);
  assert.match(fn, /mode: 'coverage'/);
  assert.match(fn, /missing_count/);
  assert.match(fn, /mode: 'build_cache'/);
  assert.match(fn, /scope: 'payroll_month'/);
  assert.match(fn, /employee_ids: routeEmployeeIds/);
  assert.match(fn, /limit: 40/);
});

test('attendance school ids participate in cache reads so actual-day school-to-school legs are available', () => {
  const fn = api.split('attendanceControlDashboardSources: async')[1].split('\n  },\n  activities: async')[0];
  assert.match(fn, /from\('attendance_records'\)[\s\S]*select\('school_id'\)/);
  assert.match(fn, /attendanceSchoolIds/);
  assert.match(fn, /origin_school_id/);
  assert.match(fn, /destination_school_id/);
});


test('attendance-control permission may build only scoped payroll-month routes', () => {
  assert.match(edge, /select\('role,is_active,permissions'\)/);
  assert.match(edge, /view_attendance_control/);
  assert.match(edge, /text\(payload\.scope\)\.toLowerCase\(\) === 'payroll_month'/);
  assert.match(edge, /attendanceEmployeeIds\.length > 0/);
  assert.match(edge, /attendanceEmployeeIds\.length <= 500/);
  assert.match(edge, /if \(!hasSchedulingRole && !isAttendanceRouteRequest\)/);
});
