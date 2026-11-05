import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const data = source => 'data:text/javascript,' + encodeURIComponent(source);
const policy = read('frontend/src/permission-policy.js')
  .replace("'./permissions.js'", JSON.stringify(data(read('frontend/src/permissions.js'))))
  .replace("'./capability-registry.js'", JSON.stringify(data(read('frontend/src/capability-registry.js'))));
const { hasPermission } = await import(data(policy));
const board = read('frontend/src/manager-board-runtime.js');
const workspace = read('frontend/src/manager-board-workspace-runtime.js');
const extract = (source, name) => source.match(new RegExp('function ' + name + '\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}'))[0];
const viewer = { role: 'business_development_manager', permissions: {
  view_manager_board: 'yes', view_manager_tracking: 'yes', view_manager_gantt: 'yes',
  view_attendance_control: 'no', finance_access: 'no'
}};
function tabsFor(user) {
  return new Function('state', 'hasPermission', 'role',
    extract(workspace, 'canUsePayrollAttendanceAdminTab') + ';' +
    extract(workspace, 'workspaceTabs') + ';return workspaceTabs();'
  )({ user }, hasPermission, () => user.role);
}
test('explicit viewer gets tracking without attendance or payroll controls', () => {
  assert.deepEqual(tabsFor(viewer), ['management', 'tracking']);
  assert.deepEqual(tabsFor({ role: 'admin' }), ['management', 'attendance', 'tracking', 'payroll-attendance']);
  assert.deepEqual(tabsFor({ ...viewer, permissions: {} }), ['management']);
  const html = new Function('state', 'hasPermission', 'currentRole',
    extract(board, 'workspaceShellHtml') + ';return workspaceShellHtml("<team/>");'
  )({ user: viewer }, hasPermission, () => viewer.role);
  assert.match(html, /data-manager-workspace-tabs/);
  assert.match(html, /data-manager-workspace-tab="tracking"/);
  assert.doesNotMatch(html, /data-manager-workspace-tab="attendance"/);
  assert.doesNotMatch(html, /data-manager-workspace-tab="payroll-attendance"/);
});
test('viewer tracking renders data without the SharePoint synchronization action', () => {
  const view = {};
  const root = { querySelector: () => view };
  new Function('state', 'hasPermission', 'escapeHtml', 'sharePointRootButton', 'trackingTableHtml', 'root', 'context', 'roster',
    extract(workspace, 'renderTracking') + ';renderTracking(root, context, roster);'
  )({ user: viewer }, hasPermission, String, () => '', () => '<table/>',
    root, { manager: 'manager', schoolYear: '2027' }, []);
  assert.match(view.innerHTML, /<table\/>/);
  assert.doesNotMatch(view.innerHTML, /data-manager-tracking-sync>/);
  assert.match(extract(workspace, 'syncTrackingDocuments'), /hasPermission\(state\?\.user, 'view_attendance_control'\)/);
});
test('tracking and Gantt permissions require the manager board parent', () => {
  assert.equal(hasPermission(viewer, 'view_manager_tracking'), true);
  assert.equal(hasPermission(viewer, 'view_manager_gantt'), true);
  const missingParent = { ...viewer, permissions: { ...viewer.permissions, view_manager_board: 'no' } };
  assert.equal(hasPermission(missingParent, 'view_manager_tracking'), false);
  assert.equal(hasPermission(missingParent, 'view_manager_gantt'), false);
});
