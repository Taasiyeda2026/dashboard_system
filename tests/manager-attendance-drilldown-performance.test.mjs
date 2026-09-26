import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workspace = await readFile(new URL('../frontend/src/manager-board-workspace-runtime.js', import.meta.url), 'utf8');
const api = await readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
const finalFixes = await readFile(new URL('../frontend/src/manager-board-final-fixes-runtime.js', import.meta.url), 'utf8');

test('manager attendance drilldown loads only the clicked instructor on demand', () => {
  assert.match(workspace, /async function openEmployeeAttendance\(empId, roster, context, summary\)/);
  assert.match(workspace, /selectedRoster[\s\S]*text\(row\?\.emp_id\) === text\(empId\)/);
  assert.match(workspace, /await bindEmbeddedAttendance\(host, selectedRoster, context, summary\?\.records \|\| \[\]\)/);
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


test('manager detail reuses summary attendance rows instead of refetching the same month', () => {
  assert.match(workspace, /let records = \[\];/);
  assert.match(workspace, /const value = \{ recordCounts, totalHours, approvals, records, recordsError, approvalsError \}/);
  assert.match(workspace, /function buildScopedAttendanceApi\(roster, preloadedRecords = null\)/);
  assert.match(workspace, /const records = scopedPreloadedRecords \?\? await target\.attendanceControlRecords/);
});

test('compact manager detail avoids loading the full school catalog and scopes activities at Supabase', () => {
  assert.match(api, /compactScope \? Promise\.resolve\(null\) : readAuthoritySchoolCatalog\(\)/);
  assert.match(api, /employeeIds: compactScope \? ids : \[\]/);
  assert.match(api, /query = query\.or\(\`emp_id\.in\.\(\$\{values\}\),emp_id_2\.in\.\(\$\{values\}\)\`\)/);
  assert.match(api, /effectiveCatalog = \{[\s\S]*schoolLookup: buildSchoolCatalogLookup\(compactSchools\)[\s\S]*authorityLookup: buildAuthorityCatalogLookup\(compactAuthorities\)/);
});
