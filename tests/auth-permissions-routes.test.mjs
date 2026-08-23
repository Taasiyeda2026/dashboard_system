import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Edit-request permission and route gating now live in frontend/src/permissions.js
// and frontend/src/api.js (no Google Apps Script backend/*.gs layer — that stack
// was fully retired when the system moved to Supabase).
const PERMISSIONS_FILE = new URL('../frontend/src/permissions.js', import.meta.url);
const API_FILE = new URL('../frontend/src/api.js', import.meta.url);
const MAIN_FILE = new URL('../frontend/src/main.js', import.meta.url);

test('canRequestEdit is driven only by can_request_edit flags, not roles or view_edit_requests', async () => {
  const source = await readFile(PERMISSIONS_FILE, 'utf8');
  const fnMatch = source.match(/export function canRequestEdit\([\s\S]*?\n}/);
  assert.ok(fnMatch, 'canRequestEdit should exist');
  assert.match(fnMatch[0], /activityChildPermission\(user, 'can_request_edit', \['can_request_edit_2'\]\)/);
  assert.doesNotMatch(fnMatch[0], /ACTIVITY_REQUEST_ROLES/);
  assert.doesNotMatch(fnMatch[0], /view_edit_requests/);
});

test('create activity requests require their dedicated permission', async () => {
  const { canRequestCreateActivity } = await import(PERMISSIONS_FILE);
  assert.equal(canRequestCreateActivity({ permissions: { view_activities: 'yes', can_request_edit: 'yes' } }), false);
  assert.equal(canRequestCreateActivity({ permissions: { view_activities: 'yes', can_request_create_activity: 'yes' } }), true);
  assert.equal(canRequestCreateActivity({ permissions: { view_activities: 'no', can_request_create_activity: 'yes' } }), false);
  assert.equal(canRequestCreateActivity({ role: 'admin' }), true);
});

test('edit-requests route includes reviewers, edit requesters, create requesters, and explicit viewers', async () => {
  const source = await readFile(API_FILE, 'utf8');
  assert.match(source, /const canReviewRequests = canReviewEditRequestsUser\(flat\);/);
  assert.match(source, /const canViewEditRequests = canReviewRequests \|\| canRequestEdit \|\| canRequestCreateActivity\(flat\) \|\| permissionFlagYes\(flat\.view_edit_requests\);/);
  assert.match(source, /if \(canViewEditRequests && !allowedRoutes\.includes\('edit-requests'\)\) \{[\s\S]*?allowedRoutes\.push\('edit-requests'\);/);
});

test('operations is not a standalone route; only operations-management is granted', async () => {
  const apiSource = await readFile(API_FILE, 'utf8');
  const routesBlock = apiSource.match(/const SUPABASE_ROLE_ROUTES = \{[\s\S]*?\};/);
  assert.ok(routesBlock, 'SUPABASE_ROLE_ROUTES should exist');
  assert.doesNotMatch(routesBlock[0], /'operations'(?!-management)/);
  assert.match(routesBlock[0], /'operations-management'/);

  const mainSource = await readFile(MAIN_FILE, 'utf8');
  assert.doesNotMatch(mainSource, /operations:\s*\(\)\s*=>\s*import\('\.\/screens\/operations\.js'\)/);
});
