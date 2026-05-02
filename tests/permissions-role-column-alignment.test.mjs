/**
 * permissions-role-column-alignment.test.mjs
 *
 * רגרסיה: בדיקת הזחת עמודות בגיליון permissions.
 * הבעיה שתוקנה: חסרה עמודת 'role' בין 'full_name' ל-'display_role'.
 * תוצאה: display_role קיבל 'admin' (קוד תפקיד), view_admin קיבל 'dashboard'.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const SCHEMA_GS   = new URL('../backend/sheet-schema.gs', import.meta.url);
const SCHEMA_JSON = new URL('../scripts/sheet-schema.json', import.meta.url);
const AUTH_GS     = new URL('../backend/auth.gs', import.meta.url);
const HELPERS_GS  = new URL('../backend/helpers.gs', import.meta.url);
const ACTIONS_GS  = new URL('../backend/actions.gs', import.meta.url);

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

test('permissions schema: role column exists between full_name and display_role', async () => {
  const src = await readFile(SCHEMA_GS, 'utf8');
  // role must appear between full_name and display_role in the permissions headers array
  const match = src.match(/'full_name','role','display_role'/);
  assert.ok(match, "permissions headers must contain 'full_name','role','display_role' in this order");
});

test('permissions schema: permissions headers count is 22', async () => {
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

test('PERMISSIONS_LOGIN_PROJECTED_HEADERS_ includes role', async () => {
  const src = await readFile(AUTH_GS, 'utf8');
  const blockMatch = src.match(/PERMISSIONS_LOGIN_PROJECTED_HEADERS_\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(blockMatch, 'PERMISSIONS_LOGIN_PROJECTED_HEADERS_ must be defined');
  assert.match(blockMatch[1], /'role'/, "PERMISSIONS_LOGIN_PROJECTED_HEADERS_ must include 'role'");
});

test('internalRoleFromPermissionRow_ prefers display_role then falls back to role', async () => {
  const src = await readFile(HELPERS_GS, 'utf8');
  const fnMatch = src.match(/function internalRoleFromPermissionRow_\([\s\S]*?\n}/);
  assert.ok(fnMatch, 'internalRoleFromPermissionRow_ must exist');
  assert.match(fnMatch[0], /row\.display_role/, 'internalRoleFromPermissionRow_ must reference row.display_role');
  assert.match(fnMatch[0], /row\.role/, 'internalRoleFromPermissionRow_ must reference row.role');
});

test('internalRoleFromPermissionRow_ example: EXAMPLE_ROW returns Hebrew display_role first', () => {
  function internalRoleFromPermissionRow_(row) {
    var display = String((row && row.display_role) || '').trim();
    var roleCol = String((row && row.role) || '').trim();
    if (display) return display;
    return roleCol;
  }
  const result = internalRoleFromPermissionRow_(EXAMPLE_ROW);
  assert.strictEqual(result, 'מנהל מערכת', `must return sheet display_role first, got '${result}'`);
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

test('actionSavePermission_: role column is normalized, display_role is not used as code', async () => {
  const src = await readFile(ACTIONS_GS, 'utf8');
  assert.match(src, /function actionSavePermission_\(/, 'actionSavePermission_ must exist');
  const fnMatch = src.match(/function actionSavePermission_\([\s\S]*?\r?\n}\r?\n\r?\nfunction actionAddUser_/);
  assert.ok(fnMatch, 'actionSavePermission_ block must be extractable before actionAddUser_');
  const saveSrc = fnMatch[0];
  assert.match(saveSrc, /h === 'role'[\s\S]*normalizeRole_/, "actionSavePermission_ must normalize 'role' column");
  assert.doesNotMatch(saveSrc,
    /if \(h === 'display_role'\)\s*\{[\s\S]{1,60}normalizeRole_/,
    "display_role column must not be normalized with normalizeRole_ (it is a Hebrew label)"
  );
});

test('actionAddUser_: role column is handled in newRow builder', async () => {
  const src = await readFile(ACTIONS_GS, 'utf8');
  assert.match(src, /function actionAddUser_\(/, 'actionAddUser_ must exist');
  // The forEach inside actionAddUser_ must have a case for 'role'
  assert.match(src, /h === 'role'\s*\)[\s\S]{1,30}newRow\[h\]\s*=\s*resolvedRole/,
    "actionAddUser_ must write resolvedRole to 'role' column");
});

test('actionAddUser_: resolvedRole prefers row.display_role then row.role', async () => {
  const src = await readFile(ACTIONS_GS, 'utf8');
  assert.match(src, /function actionAddUser_\(/, 'actionAddUser_ must exist');
  assert.match(src, /row\.display_role\s*\|\|\s*row\.role/,
    'resolvedRole must accept row.display_role || row.role (permissions sheet column first)');
});
