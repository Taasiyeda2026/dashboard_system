import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const API_FILE = new URL('../frontend/src/api.js', import.meta.url).pathname;

async function readApiSource() {
  return readFile(API_FILE, 'utf8');
}

function extractRoleRoutes(src, role) {
  const pattern = new RegExp(`${role}: \\[([^\\]]*)\\]`);
  const match = src.match(pattern);
  assert.ok(match, `missing routes for role ${role}`);
  return match[1];
}

function extractDefaultPermission(src, role) {
  const pattern = new RegExp(`${role}: \\{([^\\}]*)\\}`);
  const match = src.match(pattern);
  assert.ok(match, `missing default permissions for role ${role}`);
  return match[1];
}

test('catalog and orders are default routes for requested manager and finance roles', async () => {
  const src = await readApiSource();

  for (const role of ['activities_manager', 'instructor_manager', 'finance']) {
    const routes = extractRoleRoutes(src, role);
    assert.match(routes, /'catalog'/, `${role} should see catalog by default`);
    assert.match(routes, /'orders'/, `${role} should see orders by default`);
    assert.doesNotMatch(routes, /'edit-requests'/, `${role} should not receive edit requests from its role alone`);
  }
});

test('edit-requests route is available to request submitters while review remains direct-manager only', async () => {
  const src = await readApiSource();

  for (const role of ['admin', 'operation_manager', 'activities_manager', 'instructor_manager', 'business_development_manager', 'finance']) {
    assert.doesNotMatch(extractRoleRoutes(src, role), /'edit-requests'/, `${role} should not receive edit-requests from its role alone`);
  }

  assert.match(src, /const canReviewRequests = canDirectManageActivities;/, 'review permission should stay limited to admin and operation_manager');
  assert.match(src, /const canViewEditRequests = canReviewRequests \|\| canRequestEdit \|\| permissionFlagYes\(flat\.view_edit_requests\);/, 'bootstrap should derive route access only from relevant capabilities');
  assert.match(src, /if \(canViewEditRequests && !allowedRoutes\.includes\('edit-requests'\)\)/, 'bootstrap should expose edit-requests to users who may view or submit edit requests');
  assert.match(src, /if \(!canReviewEditRequestsUser\(\)\) throw new Error\('forbidden_review_edit_request'\);/, 'review action should keep the server-side non-reviewer guard');
});

test('edit request submission uses can_request_edit and its legacy alias, never can_edit_request', async () => {
  const [apiSource, permissionsSource] = await Promise.all([
    readApiSource(),
    readFile(new URL('../frontend/src/permissions.js', import.meta.url), 'utf8')
  ]);
  assert.match(permissionsSource, /p\.can_request_edit, p\.can_request_edit_2/);
  assert.doesNotMatch(`${apiSource}\n${permissionsSource}`, /can_edit_request/);
});

test('default_view is normalized only to an allowed active route', async () => {
  const src = await readApiSource();
  assert.match(src, /const preferred = flat\.default_view === 'operations' \? 'operations-management' : flat\.default_view;/);
  assert.match(src, /return allowedRoutes\.includes\(preferred\) \? preferred : \(allowedRoutes\[0\] \|\| 'my-data'\);/);
  assert.doesNotMatch(src, /['"]operations['"]\s*[,\]]/);
});

test('default permissions grant catalog but not edit-review to requested roles', async () => {
  const src = await readApiSource();

  for (const role of ['activities_manager', 'instructor_manager', 'finance']) {
    const defaults = extractDefaultPermission(src, role);
    assert.match(defaults, /view_catalog: 'yes'/, `${role} should get catalog default permission`);
    assert.match(defaults, /view_orders: 'yes'/, `${role} should get orders default permission`);
    assert.match(defaults, /can_review_requests: 'no'/, `${role} should not get review permission`);
  }
});

test('shell route navigation is delegated so newly rendered operations tabs stay clickable', async () => {
  const mainSource = await readFile(new URL('../frontend/src/main.js', import.meta.url), 'utf8');
  assert.match(mainSource, /document\.addEventListener\('click', \(event\) => \{\s*const button = event\.target\?\.closest\?\.\('\[data-route\]'\);\s*if \(button\) navigateToRoute\(button\.dataset\.route\);/s);
  assert.doesNotMatch(mainSource, /document\.querySelectorAll\('\[data-route\]'\)\.forEach\(\(button\) => \{\s*button\.addEventListener\('click',[\s\S]*?navigateToRoute\(button\.dataset\.route\)/);
});
