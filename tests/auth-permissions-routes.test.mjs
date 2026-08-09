import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Edit-request permission and route gating now live in frontend/src/permissions.js
// and frontend/src/api.js (no Google Apps Script backend/*.gs layer — that stack
// was fully retired when the system moved to Supabase).
const PERMISSIONS_FILE = new URL('../frontend/src/permissions.js', import.meta.url);
const API_FILE = new URL('../frontend/src/api.js', import.meta.url);
const MAIN_FILE = new URL('../frontend/src/main.js', import.meta.url);

test('canRequestEdit is driven only by can_request_edit flags/roles, not view_edit_requests', async () => {
  const source = await readFile(PERMISSIONS_FILE, 'utf8');
  const fnMatch = source.match(/export function canRequestEdit\([\s\S]*?\n}/);
  assert.ok(fnMatch, 'canRequestEdit should exist');
  assert.match(fnMatch[0], /p\.can_request_edit/);
  assert.match(fnMatch[0], /ACTIVITY_REQUEST_ROLES\.has\(userRole\(user\)\)/);
  assert.doesNotMatch(fnMatch[0], /view_edit_requests/);
});

test('edit-requests route is granted by direct-manage or can_request_edit, and by view_edit_requests alone as a fallback', async () => {
  const source = await readFile(API_FILE, 'utf8');
  assert.match(source, /const canReviewRequests = canDirectManageActivities;/);
  assert.match(source, /const canViewEditRequests = canReviewRequests \|\| canRequestEdit \|\| permissionFlagYes\(flat\.view_edit_requests\) \|\| allowedRoutes\.includes\('edit-requests'\);/);
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
