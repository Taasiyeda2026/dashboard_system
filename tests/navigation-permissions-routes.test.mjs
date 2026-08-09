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
  }
});

test('edit requests route is available to request submitters while review remains direct-manager only', async () => {
  const src = await readApiSource();

  for (const role of ['admin', 'operation_manager', 'activities_manager', 'instructor_manager', 'business_development_manager', 'finance']) {
    assert.doesNotMatch(extractRoleRoutes(src, role), /'edit-requests'/, `${role} must not receive edit-requests from an unrelated role route`);
  }

  assert.match(src, /const canReviewRequests = canDirectManageActivities;/, 'review permission should stay limited to admin and operation_manager');
  assert.match(src, /const canViewEditRequests = canReviewRequests \|\| canRequestEdit \|\| permissionFlagYes\(flat\.view_edit_requests\);/, 'bootstrap should distinguish viewing edit requests from approving them');
  assert.match(src, /if \(canViewEditRequests && !allowedRoutes\.includes\('edit-requests'\)\)/, 'bootstrap should expose edit-requests to users who may view or submit edit requests');
  assert.match(src, /if \(!canReviewEditRequestsUser\(\)\) throw new Error\('forbidden_review_edit_request'\);/, 'review action should keep the server-side non-reviewer guard');
});

test('operations-management is the active route and legacy operations defaults are normalized', async () => {
  const src = await readApiSource();
  assert.doesNotMatch(src, /\['operations'\]/, 'operations must not be emitted as an application route');
  assert.match(src, /flat\.default_view === 'operations'[\s\S]*?'operations-management'/);
  assert.match(src, /allowedRoutes\.includes\(requestedDefaultRoute\)/);
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
