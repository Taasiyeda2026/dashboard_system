import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workspace = await readFile(new URL('../frontend/src/manager-board-workspace-runtime.js', import.meta.url), 'utf8');
const api = await readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
const finalFixes = await readFile(new URL('../frontend/src/manager-board-final-fixes-runtime.js', import.meta.url), 'utf8');
const bridge = await readFile(new URL('../frontend/src/payroll-attendance-v2-bridge.js', import.meta.url), 'utf8');
const snapshotMigration = await readFile(new URL('../supabase/migrations/20260926203000_manager_attendance_review_snapshot.sql', import.meta.url), 'utf8');

test('manager attendance drilldown loads only the clicked instructor on demand', () => {
  assert.match(workspace, /async function openEmployeeAttendance\(empId, roster, context, summary\)/);
  assert.match(workspace, /selectedRoster[\s\S]*text\(row\?\.emp_id\) === text\(empId\)/);
  assert.match(workspace, /snapshot = await loadAttendanceReviewSnapshot\(empId, context\)/);
  assert.match(workspace, /await bindEmbeddedAttendance\(host, selectedRoster, context, snapshot, summary\?\.records \|\| \[\]\)/);
  assert.doesNotMatch(workspace, /await bindEmbeddedAttendance\(host, roster, context\);/);
  assert.match(workspace, /button\.textContent = 'טוען דוח…'/);
  assert.match(workspace, />פתח דוח לבדיקה<\/button>/);
});

test('manager drilldown scopes dashboard sources and does not block on route generation', () => {
  assert.match(workspace, /prop === 'attendanceControlDashboardSources'/);
  assert.match(workspace, /employeeIds,[\s\S]*skipRouteBuild: true,[\s\S]*compactScope: true/);
  assert.match(api, /attendanceControlDashboardSources: async \(\{ employeeIds = \[\], fromDate = '', toDate = '', skipRouteBuild = false, compactScope = false \}/);
  assert.match(api, /if \(!skipRouteBuild && routeMonth && routeEmployeeIds\.length && supabase\?\.functions\?\.invoke\)/);
});

test('manager attendance workflow badge targets the status column', () => {
  assert.match(finalFixes, /td\[data-label="סטטוס אישור"\]/);
  assert.match(finalFixes, /אושר על ידי העובד · ממתין לבקרת מנהל/);
  assert.match(workspace, /טרם אושר ע״י העובד/);
  assert.match(workspace, /אושר ע״י העובד/);
});


test('manager detail uses a single snapshot and keeps loaded attendance as fallback', () => {
  assert.match(workspace, /let records = \[\];/);
  assert.match(workspace, /const value = \{ recordCounts, totalHours, approvals, records, recordsError, approvalsError \}/);
  assert.match(workspace, /function buildScopedAttendanceApi\(roster, snapshot = null, preloadedRecords = null\)/);
  assert.match(workspace, /snapshotRecords = Array\.isArray\(snapshot\?\.records\)/);
  assert.match(workspace, /if \(snapshot\?\.sources\) return snapshot\.sources/);
  assert.match(workspace, /prop === 'listPayrollControlApprovals' && snapshot/);
  assert.match(workspace, /prop === 'attendanceControlMonthWorkflowStatuses' && snapshot/);
});

test('compact manager detail avoids loading the full school catalog and scopes activities at Supabase', () => {
  assert.match(api, /compactScope \? Promise\.resolve\(null\) : readAuthoritySchoolCatalog\(\)/);
  assert.match(api, /employeeIds: compactScope \? ids : \[\]/);
  assert.match(api, /query = query\.or\(\`emp_id\.in\.\(\$\{values\}\),emp_id_2\.in\.\(\$\{values\}\)\`\)/);
  assert.match(api, /effectiveCatalog = \{[\s\S]*schoolLookup: buildSchoolCatalogLookup\(compactSchools\)[\s\S]*authorityLookup: buildAuthorityCatalogLookup\(compactAuthorities\)/);
});


test('manager attendance snapshot bridge performs one RPC and normalizes the response', () => {
  assert.match(bridge, /api\.managerAttendanceReviewSnapshot = async function/);
  assert.match(bridge, /supabase\.rpc\('get_manager_attendance_review_snapshot'/);
  assert.match(bridge, /legacyRecordsFromSnapshotParts/);
  assert.match(bridge, /schoolLookup: \{ list:/);
  assert.match(bridge, /authorityLookup: \{ list:/);
});

test('snapshot RPC contains the full manager review payload behind server-side authorization', () => {
  assert.match(snapshotMigration, /create or replace function public\.get_manager_attendance_review_snapshot/);
  assert.match(snapshotMigration, /payroll_attendance_permission_denied/);
  assert.match(snapshotMigration, /get_payroll_attendance_records/);
  assert.match(snapshotMigration, /from public\.activities a/);
  assert.match(snapshotMigration, /scheduling_travel_cache/);
  assert.match(snapshotMigration, /get_payroll_attendance_month_statuses/);
  assert.match(snapshotMigration, /grant execute on function public\.get_manager_attendance_review_snapshot/);
});
