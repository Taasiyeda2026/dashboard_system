import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const navSource = await readFile(new URL('../frontend/src/screens/shared/instructors-workspace-nav.js', import.meta.url), 'utf8');
const launcherSource = await readFile(new URL('../frontend/src/screens/shared/payroll-control-launcher.js', import.meta.url), 'utf8');
const attendanceSource = await readFile(new URL('../frontend/src/screens/attendance-control.js', import.meta.url), 'utf8');
const boardSource = await readFile(new URL('../frontend/src/manager-board-runtime.js', import.meta.url), 'utf8');
const workspaceSource = await readFile(new URL('../frontend/src/manager-board-workspace-runtime.js', import.meta.url), 'utf8');
const adminHomeSource = await readFile(new URL('../frontend/src/screens/admin-home.js', import.meta.url), 'utf8');
const rosterSql = await readFile(new URL('../supabase/migrations/20260817213953_manager_workspace_role_access.sql', import.meta.url), 'utf8');
const recordsSql = await readFile(new URL('../supabase/migrations/20260817215048_payroll_attendance_v2_control_bridge.sql', import.meta.url), 'utf8');
const liveRecordsSql = await readFile(new URL('../supabase/migrations/20260819223000_payroll_attendance_live_records_access.sql', import.meta.url), 'utf8');
const configSource = await readFile(new URL('../frontend/src/config.js', import.meta.url), 'utf8');
const swSource = await readFile(new URL('../frontend/sw.js', import.meta.url), 'utf8');
const indexSource = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('instructors, manager board, and admin use the new attendance-control names', () => {
  assert.match(navSource, /id: 'payroll-control', label: 'בקרת נוכחות'/);
  assert.doesNotMatch(navSource, /label: 'בקרת שכר'/);
  assert.match(boardSource, /data-manager-workspace-tab="attendance"[^>]*>בקרת נוכחות</);
  assert.match(boardSource, /data-manager-workspace-tab="payroll-attendance"[^>]*>בקרת נוכחות אדמין</);
  assert.match(workspaceSource, /<h2>בקרת נוכחות<\/h2>/);
  assert.match(workspaceSource, /<h2>בקרת נוכחות אדמין<\/h2>/);
  assert.match(adminHomeSource, /title: 'בקרת נוכחות אדמין'/);
  assert.match(attendanceSource, /data-attendance-title>בקרת נוכחות</);
  assert.match(attendanceSource, /אישור בקרת נוכחות/);
  assert.match(launcherSource, /popup\.document\.title = 'בקרת נוכחות'/);
});

test('the confusing payroll/attendance UI phrase is gone from this system', () => {
  assert.doesNotMatch(boardSource, /בקרת שכר\/נוכחות/);
  assert.doesNotMatch(workspaceSource, /בקרת שכר\/נוכחות/);
  assert.doesNotMatch(adminHomeSource, /בקרת שכר\/נוכחות/);
  assert.doesNotMatch(navSource, /בקרת שכר\/נוכחות/);
  assert.doesNotMatch(attendanceSource, /בקרת שכר\/נוכחות/);
});

test('both בקרת נוכחות entry points bind the same central attendance-control module', () => {
  assert.match(launcherSource, /import\('\.\.\/attendance-control\.js'\)/);
  assert.match(launcherSource, /bindAttendanceControl/);
  assert.match(workspaceSource, /import\('\.\/screens\/attendance-control\.js'\)/);
  assert.match(workspaceSource, /attendance\.bindAttendanceControl/);
  assert.match(workspaceSource, /buildScopedAttendanceApi\(roster\)/);
});

test('manager-board attendance scopes records to the manager team at the query, not only in the UI', () => {
  assert.match(workspaceSource, /supabase\.rpc\('get_manager_team_roster'/);
  assert.match(workspaceSource, /employeeIds/);
  assert.match(workspaceSource, /attendanceMonthDateRange\(ym\)/);
  assert.match(workspaceSource, /target\.attendanceControlRecords\(\{\s*\.\.\.opts,\s*employeeIds\s*\}\)/);
  assert.match(workspaceSource, /if \(!employeeIds\.length\) return \[\];/);
  assert.match(rosterSql, /if v_role = 'activities_manager' then\s+v_manager_name := v_own_name;/);
  assert.match(recordsSql, /v_role = 'activities_manager'/);
  assert.match(recordsSql, /lower\(trim\(coalesce\(ci\.direct_manager, ''\)\)\) = lower\(trim\(coalesce\(v_own_name, ''\)\)\)/);
  assert.match(liveRecordsSql, /'manager', 'instructor_manager'/);
  assert.match(liveRecordsSql, /month submission status is unrelated/);
});

test('activities_manager cannot pick another manager on the board', () => {
  assert.match(boardSource, /const MANAGER_BOARD_SELF_ROLE = 'activities_manager'/);
  assert.match(boardSource, /function isSelfManager\(\)/);
  assert.match(boardSource, /if \(isSelfManager\(\)\) \{\s*return `<div class="manager-board-manager-fixed"/);
});

test('admin attendance control loads every manager team from the existing roster RPC', () => {
  assert.match(workspaceSource, /function loadAllTeamRosters\(/);
  assert.match(workspaceSource, /activeTab === 'payroll-attendance'\s*\? await loadAllTeamRosters\(context\.schoolYear\)/);
  assert.match(workspaceSource, /loadRoster\(name, schoolYear, force\)/);
  assert.match(workspaceSource, /adminFinalizeAttendanceMonthPayroll/);
  assert.match(workspaceSource, /adminReopenAttendanceMonthForCorrection/);
  assert.match(workspaceSource, /canUsePayrollAttendanceAdminTab\(\) \{\n  return role\(\) === 'admin';/);
});

test('deploy cache markers were bumped for the unified attendance-control labels', () => {
  assert.match(swSource, /const CACHE_VERSION = 1572;/);
  assert.match(configSource, /attendance-control-live-records-sw-cache-1572-20260819-v1/);
  assert.match(indexSource, /manager-board-workspace-runtime\.js\?v=20260819-attendance-control-live-records-v1/);
});
