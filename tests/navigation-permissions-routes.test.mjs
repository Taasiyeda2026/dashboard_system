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

test('catalog is a default route for requested manager and finance roles without adding orders', async () => {
  const src = await readApiSource();

  for (const role of ['activities_manager', 'instructor_manager', 'finance']) {
    const routes = extractRoleRoutes(src, role);
    assert.match(routes, /'catalog'/, `${role} should see catalog by default`);
  }

  assert.doesNotMatch(extractRoleRoutes(src, 'activities_manager'), /'orders'/, 'activities_manager should not gain orders by default');
  assert.doesNotMatch(extractRoleRoutes(src, 'instructor_manager'), /'orders'/, 'instructor_manager should not gain orders by default');
  assert.doesNotMatch(extractRoleRoutes(src, 'finance'), /'orders'/, 'finance should not gain orders by default');
});

test('edit requests route is available to request submitters while review remains direct-manager only', async () => {
  const src = await readApiSource();

  for (const role of ['activities_manager', 'instructor_manager', 'business_development_manager', 'finance']) {
    assert.match(extractRoleRoutes(src, role), /'edit-requests'/, `${role} should have edit-requests route for its badge/screen`);
  }

  assert.match(src, /const canReviewRequests = canDirectManageActivities;/, 'review permission should stay limited to admin and operation_manager');
  assert.match(src, /if \(canRequestEdit && !allowedRoutes\.includes\('edit-requests'\)\)/, 'bootstrap should expose edit-requests to users who can request edits');
  assert.match(src, /if \(!canReviewEditRequestsUser\(\)\) throw new Error\('forbidden_review_edit_request'\);/, 'review action should keep the server-side non-reviewer guard');
});

test('default permissions grant catalog but not edit-review to requested roles', async () => {
  const src = await readApiSource();

  for (const role of ['activities_manager', 'instructor_manager', 'finance']) {
    const defaults = extractDefaultPermission(src, role);
    assert.match(defaults, /view_catalog: 'yes'/, `${role} should get catalog default permission`);
    assert.match(defaults, /can_review_requests: 'no'/, `${role} should not get review permission`);
  }
});
