import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const API_FILE = new URL('../frontend/src/api.js', import.meta.url);
const PR_FILE = new URL('../frontend/src/screens/personal-reports.js', import.meta.url);
const PERM_FILE = new URL('../frontend/src/screens/permissions.js', import.meta.url);
const MAIN_FILE = new URL('../frontend/src/main.js', import.meta.url);
const MIGRATION_FILE = new URL('../supabase/migrations/20260609_profiles_personal_reports_access.sql', import.meta.url);

test('personal-reports route is not granted by role alone', async () => {
  const source = await readFile(API_FILE, 'utf8');
  const routesBlock = source.match(/const SUPABASE_ROLE_ROUTES = \{[\s\S]*?\};/);
  assert.ok(routesBlock, 'SUPABASE_ROLE_ROUTES should exist');
  assert.doesNotMatch(routesBlock[0], /'personal-reports'/);
});

test('buildBootstrapFromUser gates personal-reports on profiles.can_access_personal_reports and is_active', async () => {
  const source = await readFile(API_FILE, 'utf8');
  assert.match(source, /function profileCanAccessPersonalReports\(/);
  assert.match(source, /PROFILE_PERSONAL_REPORTS_COLUMNS = 'id,is_active,can_access_personal_reports'/);
  assert.match(source, /if \(profileRow\.is_active === false\) return false;/);
  assert.match(source, /if \(!profileRow \|\| profileRow\.can_access_personal_reports === undefined\) return false;/);
  assert.match(source, /readPersonalReportsProfile\(/);
  assert.match(source, /hasPersonalReportsAccess/);
  assert.match(source, /has_personal_reports_access: hasPersonalReportsAccess/);
  assert.doesNotMatch(source, /parsePermissions\(userRow\?\.permissions\)\.can_access_personal_reports/);
});

test('login exposes can_access_personal_reports from profiles on session user', async () => {
  const source = await readFile(API_FILE, 'utf8');
  assert.match(source, /can_access_personal_reports: hasPersonalReportsAccess/);
  assert.match(source, /profile_is_active: profileRow\?\.is_active !== false/);
});

test('permissions editor includes can_access_personal_reports key flag', async () => {
  const source = await readFile(PERM_FILE, 'utf8');
  assert.match(source, /'can_access_personal_reports'/);
});

test('savePermission writes can_access_personal_reports to profiles not users.permissions', async () => {
  const source = await readFile(API_FILE, 'utf8');
  assert.match(source, /'can_access_personal_reports'\]\.includes\(k\)/);
  assert.match(source, /\.from\('profiles'\)\s*\n\s*\.update\(profilePatch\)/);
});

test('personal reports screen blocks users without profile personal reports access', async () => {
  const source = await readFile(PR_FILE, 'utf8');
  assert.match(source, /function canAccessPersonalReports\(/);
  assert.match(source, /if \(user\?\.profile_is_active === false\) return false;/);
  assert.match(source, /if \(!canAccessPersonalReports\(ctx\?\.state\?\.user\)\)/);
  assert.match(source, /if \(!canAccessPersonalReports\(state\?\.user\)\) return;/);
  assert.match(source, /can_access_personal_reports/);
});

test('main syncs can_access_personal_reports from bootstrap', async () => {
  const source = await readFile(MAIN_FILE, 'utf8');
  assert.match(source, /state\.user\.can_access_personal_reports = !!bootstrap\.has_personal_reports_access/);
  assert.match(source, /state\.user\.profile_is_active = bootstrap\.profile_is_active !== false/);
});

test('migration grants personal reports access only to explicit profile whitelist', async () => {
  const sql = await readFile(MIGRATION_FILE, 'utf8');
  assert.match(sql, /DEFAULT false/);
  assert.match(sql, /SET can_access_personal_reports = false/);
  assert.match(sql, /idann@think\.org\.il/);
  assert.match(sql, /esraas@think\.org\.il/);
  assert.match(sql, /gilneeman@think\.org\.il/);
  assert.match(sql, /hilar@think\.org\.il/);
  assert.match(sql, /toni@think\.org\.il/);
  assert.match(sql, /edenc@think\.org\.il/);
  assert.doesNotMatch(sql, /WHERE is_active = true[\s\S]*SET can_access_personal_reports = true/);
  assert.match(sql, /public\.profiles/);
  assert.match(sql, /dashboard_user_can_access_personal_reports/);
  assert.match(sql, /DROP FUNCTION IF EXISTS public\.verify_personal_reports_entry_code\(text, text\)/);
});
