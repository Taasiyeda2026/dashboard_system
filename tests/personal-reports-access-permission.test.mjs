import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const API_FILE = new URL('../frontend/src/api.js', import.meta.url);
const PR_FILE = new URL('../frontend/src/screens/personal-reports.js', import.meta.url);
const PERM_FILE = new URL('../frontend/src/screens/permissions.js', import.meta.url);
const MAIN_FILE = new URL('../frontend/src/main.js', import.meta.url);
const MIGRATION_FILE = new URL('../supabase/migrations/20260608_personal_reports_access_permission.sql', import.meta.url);

test('personal-reports route is not granted by role alone', async () => {
  const source = await readFile(API_FILE, 'utf8');
  const routesBlock = source.match(/const SUPABASE_ROLE_ROUTES = \{[\s\S]*?\};/);
  assert.ok(routesBlock, 'SUPABASE_ROLE_ROUTES should exist');
  assert.doesNotMatch(routesBlock[0], /'personal-reports'/);
});

test('buildBootstrapFromUser gates personal-reports on can_access_personal_reports and is_active', async () => {
  const source = await readFile(API_FILE, 'utf8');
  assert.match(source, /function userCanAccessPersonalReports\(/);
  assert.match(source, /if \(!userRow\?\.is_active\) return false;/);
  assert.match(source, /can_access_personal_reports/);
  assert.match(source, /hasPersonalReportsAccess/);
  assert.match(source, /has_personal_reports_access: hasPersonalReportsAccess/);
});

test('login exposes can_access_personal_reports on session user', async () => {
  const source = await readFile(API_FILE, 'utf8');
  assert.match(source, /can_access_personal_reports: userCanAccessPersonalReports\(user\)/);
});

test('permissions editor includes can_access_personal_reports key flag', async () => {
  const source = await readFile(PERM_FILE, 'utf8');
  assert.match(source, /'can_access_personal_reports'/);
});

test('personal reports screen blocks users without can_access_personal_reports', async () => {
  const source = await readFile(PR_FILE, 'utf8');
  assert.match(source, /function canAccessPersonalReports\(/);
  assert.match(source, /if \(!canAccessPersonalReports\(ctx\?\.state\?\.user\)\)/);
  assert.match(source, /if \(!canAccessPersonalReports\(state\?\.user\)\) return;/);
});

test('main syncs can_access_personal_reports from bootstrap', async () => {
  const source = await readFile(MAIN_FILE, 'utf8');
  assert.match(source, /state\.user\.can_access_personal_reports = !!bootstrap\.has_personal_reports_access/);
});

test('migration seeds Yael Aviv without personal reports access and adds RLS guard', async () => {
  const sql = await readFile(MIGRATION_FILE, 'utf8');
  assert.match(sql, /yael_aviv@think\.org\.il/);
  assert.match(sql, /dashboard_user_can_access_personal_reports/);
  assert.match(sql, /can_access_personal_reports/);
  assert.match(sql, /permission_denied/);
});
