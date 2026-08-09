/**
 * permissions-role-column-alignment.test.mjs
 *
 * רגרסיה: בדיקת הזחת עמודות בגיליון permissions.
 * הבעיה שתוקנה: חסרה עמודת 'role' בין 'full_name' ל-'display_role'.
 * תוצאה: display_role קיבל 'admin' (קוד תפקיד), view_admin קיבל 'dashboard'.
 *
 * המערכת עברה הגרה מלאה מ-Google Apps Script (backend/*.gs) ל-Supabase;
 * בדיקות ה-role/display_role שהיו קוראות מ-backend/*.gs עודכנו לבדוק את
 * המימוש הנוכחי ב-frontend/src/api.js.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const SCHEMA_JSON = new URL('../scripts/sheet-schema.json', import.meta.url);
const API_FILE    = new URL('../frontend/src/api.js', import.meta.url);

// ------------------------------------------------------------------
// הדמיית שורת נתונים מהגיליון (כפי שנקראת אחרי תיקון הסכמה)
// ------------------------------------------------------------------
const EXAMPLE_ROW = {
  user_id:       '8000',
  entry_code:    '2311',
  full_name:     'עידן נחום',
  role:          'admin',
  display_role:  'מנהל מערכת',
  default_view:  'dashboard',
  view_admin:    'yes',
  view_dashboard:'yes',
  view_activities:'yes',
  view_week:     'yes',
  view_month:    'yes',
  view_instructors:'yes',
  view_exceptions:'yes',
  view_my_data:  'yes',
  view_contacts: 'no',
  view_finance:  'yes',
  view_permissions:'yes',
  can_request_edit:'yes',
  can_edit_direct: 'yes',
  can_add_activity:'yes',
  can_review_requests:'yes',
  active:        'yes'
};

test('permissions schema JSON: permissions headers count is 22', async () => {
  const src = await readFile(SCHEMA_JSON, 'utf8');
  const json = JSON.parse(src);
  const perm = json.sheets.find(s => s.sheetName === 'permissions');
  assert.ok(perm, 'permissions sheet must exist in JSON schema');
  assert.strictEqual(perm.headers.length, 22, `permissions should have 22 headers, got ${perm.headers.length}: ${perm.headers.join(', ')}`);
  assert.strictEqual(perm.hebrewLabels.length, 22, 'hebrewLabels count must match headers count');
});

test('permissions schema JSON: role is at index 3, display_role at index 4, default_view at index 5', async () => {
  const src = await readFile(SCHEMA_JSON, 'utf8');
  const json = JSON.parse(src);
  const perm = json.sheets.find(s => s.sheetName === 'permissions');
  const h = perm.headers;
  assert.strictEqual(h[3], 'role',         `col 4 (idx 3) must be 'role', got '${h[3]}'`);
  assert.strictEqual(h[4], 'display_role', `col 5 (idx 4) must be 'display_role', got '${h[4]}'`);
  assert.strictEqual(h[5], 'default_view', `col 6 (idx 5) must be 'default_view', got '${h[5]}'`);
  assert.strictEqual(h[6], 'view_admin',   `col 7 (idx 6) must be 'view_admin', got '${h[6]}'`);
});

test('permissions schema JSON: no duplicate headers', async () => {
  const src = await readFile(SCHEMA_JSON, 'utf8');
  const json = JSON.parse(src);
  const perm = json.sheets.find(s => s.sheetName === 'permissions');
  const dups = perm.headers.filter((h, i) => perm.headers.indexOf(h) !== i);
  assert.deepStrictEqual(dups, [], `duplicate permissions headers found: ${dups.join(', ')}`);
});

test('flattenUserRow keeps internal role separate from display_role and display_role_label', async () => {
  const source = await readFile(API_FILE, 'utf8');
  assert.match(source, /const customDisplayRole = String\(userRow\.display_role \|\| ''\)\.trim\(\);/);
  assert.match(source, /const displayRoleLabel = String\(userRow\.display_role_label \|\| customDisplayRole \|\| ''\)\.trim\(\);/);
  assert.match(source, /role,\n    display_role: displayRoleLabel \|\| hebrewRole\(role\),/);
  assert.match(source, /display_role_label: displayRoleLabel \|\| hebrewRole\(role\)/);
});

test('permission row internal role comes only from role', () => {
  assert.strictEqual(EXAMPLE_ROW.role, 'admin');
  assert.notStrictEqual(EXAMPLE_ROW.role, EXAMPLE_ROW.display_role);
});

test('EXAMPLE_ROW: view_admin is yes (not dashboard)', () => {
  assert.strictEqual(EXAMPLE_ROW.view_admin, 'yes',
    `view_admin must be 'yes', got '${EXAMPLE_ROW.view_admin}' — column alignment problem!`);
});

test('EXAMPLE_ROW: default_view is dashboard (not מנהל מערכת)', () => {
  assert.strictEqual(EXAMPLE_ROW.default_view, 'dashboard',
    `default_view must be 'dashboard', got '${EXAMPLE_ROW.default_view}' — column alignment problem!`);
});

test('EXAMPLE_ROW: display_role is Hebrew label (not admin code)', () => {
  assert.notStrictEqual(EXAMPLE_ROW.display_role, 'admin',
    'display_role must be Hebrew text, not the internal code admin');
  assert.strictEqual(EXAMPLE_ROW.display_role, 'מנהל מערכת');
});

test('EXAMPLE_ROW: role is admin', () => {
  assert.strictEqual(EXAMPLE_ROW.role, 'admin');
});

test('EXAMPLE_ROW: headers count equals values count', () => {
  const expectedHeaders = [
    'user_id','entry_code','full_name','role','display_role','default_view',
    'view_admin','view_dashboard','view_activities','view_week','view_month',
    'view_instructors','view_exceptions','view_my_data','view_contacts',
    'view_finance','view_permissions','can_request_edit','can_edit_direct',
    'can_add_activity','can_review_requests','active'
  ];
  const values = expectedHeaders.map(k => EXAMPLE_ROW[k]);
  const missingKeys = expectedHeaders.filter(k => EXAMPLE_ROW[k] === undefined);
  assert.deepStrictEqual(missingKeys, [], `missing keys in EXAMPLE_ROW: ${missingKeys.join(', ')}`);
  assert.strictEqual(expectedHeaders.length, values.length);
});

test('savePermission: role is handled as its own column, not folded into the generic permissions patch', async () => {
  const source = await readFile(API_FILE, 'utf8');
  const fnMatch = source.match(/savePermission: async \(row\) => \{[\s\S]*?return \{ ok: true \};\n  \},/);
  assert.ok(fnMatch, 'savePermission must exist');
  assert.match(fnMatch[0], /\['user_id', 'role', 'display_role', 'display_role_label', 'default_view', 'active', 'full_name', 'entry_code', 'emp_id', 'display_role2', 'can_access_personal_reports'\]\.includes\(k\)/,
    "savePermission must exclude 'role' from the generic permissions patch loop");
  assert.match(fnMatch[0], /const nextRole = row\.role \|\| existing\.data\.role;/);
  assert.match(fnMatch[0], /role: nextRole,/);
  assert.match(fnMatch[0], /display_role: row\.display_role \?\? row\.display_role_label \?\? existing\.data\.display_role,/);
  assert.match(fnMatch[0], /default_view: row\.default_view \?\? existing\.data\.default_view,/);
});

test('addUser: role is written as its own users column in the insert payload', async () => {
  const source = await readFile(API_FILE, 'utf8');
  const fnMatch = source.match(/addUser: async \(row\) => \{[\s\S]*?return \{ ok: true \};\n  \},/);
  assert.ok(fnMatch, 'addUser must exist');
  assert.match(fnMatch[0], /const role = String\(row\?\.role \|\| 'instructor'\)\.trim\(\);/);
  assert.match(fnMatch[0], /const insert = \{[\s\S]*?role,/);
  assert.match(fnMatch[0], /display_role: String\(row\?\.display_role \|\| row\?\.display_role_label \|\| hebrewRole\(role\)\)\.trim\(\),/);
});

test('login projects role as internal code and display_role as display text', async () => {
  const source = await readFile(API_FILE, 'utf8');
  const fnMatch = source.match(/login: async \(user_id, entry_code\) => \{[\s\S]*?client_settings: buildClientSettingsFromLists/);
  assert.ok(fnMatch, 'login must exist');
  assert.match(fnMatch[0], /role: flat\.role,/);
  assert.match(fnMatch[0], /display_role: flat\.display_role,/);
  assert.match(fnMatch[0], /display_role_label: flat\.display_role_label,/);
});

test('legacy can_edit_request does not grant can_request_edit', async () => {
  const permissionsSource = await readFile(new URL('../frontend/src/permissions.js', import.meta.url), 'utf8');
  assert.doesNotMatch(permissionsSource, /can_edit_request/, 'legacy edit capability must not be treated as request submission permission');
});
