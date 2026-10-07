import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../supabase/migrations/20261007093814_inactive_instructor_attendance_payroll_continuity.sql', import.meta.url),
  'utf8'
);
const bridge = await readFile(new URL('../frontend/src/payroll-attendance-v2-bridge.js', import.meta.url), 'utf8');
const control = await readFile(new URL('../frontend/src/screens/attendance-control.js', import.meta.url), 'utf8');
const adminAttendance = await readFile(new URL('../frontend/src/admin-attendance-standalone.js', import.meta.url), 'utf8');
const managerWorkspace = await readFile(new URL('../frontend/src/manager-board-workspace-runtime.js', import.meta.url), 'utf8');

test('inactive instructors remain visible only in months with attendance or workflow history', () => {
  assert.match(migration, /get_payroll_attendance_team_roster_for_month/);
  assert.match(migration, /attendance_records[\s\S]*report_date between v_from and v_to/);
  assert.match(migration, /attendance_month_approvals[\s\S]*month_key = trim\(p_month_key\)/);
  assert.match(migration, /payroll_control_approvals[\s\S]*month_key = trim\(p_month_key\)/);
  assert.match(migration, /ci\.active::text[\s\S]*or exists/);
});

test('manager attendance authorization no longer rejects a historical direct report only because active is false', () => {
  const helper = migration.match(/CREATE OR REPLACE FUNCTION public\.attendance_manager_can_review_employee[\s\S]*?\$function\$/)?.[0] || '';
  assert.match(helper, /direct_manager/);
  assert.doesNotMatch(helper, /v_active/);
  assert.doesNotMatch(helper, /ci\.active/);

  const recordRead = migration.match(/CREATE OR REPLACE FUNCTION public\.get_payroll_attendance_records[\s\S]*?\$function\$/)?.[0] || '';
  assert.match(recordRead, /direct_manager/);
  assert.doesNotMatch(recordRead, /ci\.active::text/);
});

test('attendance control refreshes roster for the selected month', () => {
  assert.match(bridge, /get_payroll_attendance_team_roster_for_month/);
  assert.match(control, /attendanceControlTeams\(\{ monthKey: monthInput\.value \}\)/);
  assert.match(control, /monthInput\.addEventListener\('change',[\s\S]*refreshTeamRoster/);
});


test('admin attendance board uses the month-aware roster instead of active-only contacts', () => {
  assert.match(adminAttendance, /get_payroll_attendance_team_roster_for_month/);
  assert.match(adminAttendance, /loadEmployees\(monthKey\)/);
  assert.doesNotMatch(adminAttendance, /if \(!id \|\| !isActiveEmployee\(row\)/);
});

test('manager attendance and admin payroll tabs use the selected-month roster while tracking keeps active team roster', () => {
  assert.match(managerWorkspace, /function loadAttendanceRosterForMonth\(/);
  assert.match(managerWorkspace, /get_payroll_attendance_team_roster_for_month/);
  assert.match(managerWorkspace, /activeTab === 'attendance'[\s\S]*loadAttendanceRosterForMonth\(context\.manager, context\.ym/);
  assert.match(managerWorkspace, /activeTab === 'payroll-attendance'[\s\S]*loadAttendanceRosterForMonth\('', context\.ym/);
  assert.match(managerWorkspace, /await loadRoster\(context\.manager, context\.schoolYear, force && activeTab === 'tracking'\)/);
});
