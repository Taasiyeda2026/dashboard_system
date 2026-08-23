import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const API_FILE = new URL('../frontend/src/api.js', import.meta.url);
const PR_FILE = new URL('../frontend/src/screens/personal-reports.js', import.meta.url);
const PERM_FILE = new URL('../frontend/src/screens/permissions.js', import.meta.url);
const MAIN_FILE = new URL('../frontend/src/main.js', import.meta.url);
const APPROVED_MATRIX_MIGRATION_FILE = new URL('../supabase/migrations/20260823200000_apply_approved_permission_matrix.sql', import.meta.url);

test('personal-reports route is not granted by role alone', async () => {
  const source = await readFile(API_FILE, 'utf8');
  const routesBlock = source.match(/const SUPABASE_ROLE_ROUTES = \{[\s\S]*?\};/);
  assert.ok(routesBlock, 'SUPABASE_ROLE_ROUTES should exist');
  assert.doesNotMatch(routesBlock[0], /'personal-reports'/);
});

test('buildBootstrapFromUser prefers canonical personal-report permission and uses profile only as compatibility fallback', async () => {
  const source = await readFile(API_FILE, 'utf8');
  assert.match(source, /function profileCanAccessPersonalReports\(/);
  assert.match(source, /PROFILE_PERSONAL_REPORTS_COLUMNS = 'id,is_active,can_access_personal_reports'/);
  assert.match(source, /if \(profileRow\.is_active === false\) return false;/);
  assert.match(source, /if \(!profileRow \|\| profileRow\.can_access_personal_reports === undefined\) return false;/);
  assert.match(source, /readPersonalReportsProfile\(/);
  assert.match(source, /hasPersonalReportsAccess/);
  assert.match(source, /has_personal_reports_access: hasPersonalReportsAccess/);
  assert.match(source, /Object\.prototype\.hasOwnProperty\.call\(flat, 'can_access_personal_reports'\)/);
  assert.match(source, /effectivePersonalReportsAccess\(flat, profileRow\)/);
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

test('savePermission writes canonical can_access_personal_reports and aligns the compatibility profile', async () => {
  const source = await readFile(API_FILE, 'utf8');
  assert.doesNotMatch(source, /'display_role2', 'can_access_personal_reports'\]\.includes\(k\)/);
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

test('main waits for Supabase auth session before bootstrap permission sync', async () => {
  const mainSource = await readFile(MAIN_FILE, 'utf8');
  const apiSource = await readFile(API_FILE, 'utf8');
  const clientSource = await readFile(new URL('../frontend/src/supabase-client.js', import.meta.url), 'utf8');
  assert.match(clientSource, /function waitForSupabaseAuthSession/);
  assert.match(mainSource, /waitForSupabaseAuthSession/);
  assert.match(mainSource, /permissionsReady/);
  assert.match(mainSource, /authSessionReady/);
  assert.match(apiSource, /await waitForSupabaseAuthSession\(\)/);
  assert.match(apiSource, /skipped: no supabase auth session/);
});

test('personal reports screen shows loading until permissions sync completes', async () => {
  const source = await readFile(PR_FILE, 'utf8');
  assert.match(source, /function personalReportsPermissionsPending/);
  assert.match(source, /permissionsReady === false/);
  assert.match(source, /personalReportsPermissionsLoadingHtml/);
  assert.match(source, /if \(personalReportsPermissionsPending\(ctx\?\.state\)\)/);
  assert.match(source, /if \(personalReportsPermissionsPending\(state\)\) return/);
  assert.match(source, /waitForSupabaseAuthSession/);
});

test('login and bootstrap expose personal_reports_manager without granting admin routes', async () => {
  const apiSource = await readFile(API_FILE, 'utf8');
  const routesBlock = apiSource.match(/const SUPABASE_ROLE_ROUTES = \{[\s\S]*?\};/);
  assert.ok(routesBlock, 'SUPABASE_ROLE_ROUTES should exist');
  assert.doesNotMatch(routesBlock[0], /personal_reports_manager/);
  assert.match(apiSource, /function canManagePersonalReportsUser\(/);
  assert.match(apiSource, /has_personal_reports_manager: hasPersonalReportsManager/);
  assert.match(apiSource, /personal_reports_manager: permissionFlagYes\(flat\.personal_reports_manager\)/);
});

test('main syncs personal_reports_manager from bootstrap', async () => {
  const source = await readFile(MAIN_FILE, 'utf8');
  assert.match(source, /state\.user\.personal_reports_manager = !!bootstrap\.has_personal_reports_manager/);
});

test('approved matrix stores personal reports manager canonically without granting admin tools', async () => {
  const sql = await readFile(APPROVED_MATRIX_MIGRATION_FILE, 'utf8');
  assert.match(sql, /personal_reports_manager/);
  assert.match(sql, /'7000'[\s\S]*'personal_reports_manager'/);
  assert.match(sql, /'view_permissions',case when m\.user_id = '8000' then 'yes' else 'no'/);
});

test('approved matrix aligns profile compatibility access for exactly the seven user IDs', async () => {
  const sql = await readFile(APPROVED_MATRIX_MIGRATION_FILE, 'utf8');
  assert.match(sql, /set can_access_personal_reports = u\.user_id in \('8000','6000','3030','7000','1500','5000'\)/);
  assert.match(sql, /u\.user_id = any\(array\['8000','6000','3000','3030','7000','1500','5000'\]\)/);
});
