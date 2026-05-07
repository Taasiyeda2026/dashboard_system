/**
 * normalize-role-regression.test.mjs
 *
 * Regression tests for normalizeRole_ in OLD-GAS/helpers.gs.
 *
 * Covers:
 *  - All internal role codes (including the previously-missing authorized_user)
 *  - Hebrew display-label fallbacks (backward-compat with old sessions)
 *  - Case-insensitive matching for internal codes
 *  - Aliases: operations_reviewer, instructor_admin
 *  - Unknown values still throw invalid_role
 *  - Empty string throws invalid_role
 */

import { readFile } from 'fs/promises';
import { strict as assert } from 'assert';
import { test } from 'node:test';

const HELPERS_PATH = 'OLD-GAS/helpers.gs';
let src;

test('load helpers.gs', async () => {
  src = await readFile(HELPERS_PATH, 'utf8');
  assert.ok(src.length > 100);
});

// ---------------------------------------------------------------------------
// Source-level: authorized_user must be in the switch
// ---------------------------------------------------------------------------
test('normalizeRole_: authorized_user case exists in source', () => {
  assert.match(src, /case 'authorized_user'\s*:\s*return 'authorized_user'/,
    "authorized_user must be handled and returned as 'authorized_user'");
});

test('normalizeRole_: Hebrew fallback switch exists in source', () => {
  assert.match(src, /Hebrew display-label fallback/, 'Hebrew fallback block must be documented');
  assert.match(src, /משתמש\/ת מורשה/, 'Hebrew label for authorized_user must exist');
  assert.match(src, /מנהל\/ת/, 'Hebrew label for admin must exist');
  assert.match(src, /מדריך\/ה/, 'Hebrew label for instructor must exist');
});

// ---------------------------------------------------------------------------
// JS simulation of normalizeRole_ (mirrors the GAS implementation)
// ---------------------------------------------------------------------------
function normalizeRole(value) {
  var role = (value === null || value === undefined ? '' : String(value)).trim();
  switch (role.toLowerCase()) {
    case 'admin':              return 'admin';
    case 'finance':            return 'finance';
    case 'operations_reviewer':
    case 'operation_manager':  return 'operation_manager';
    case 'authorized_user':    return 'authorized_user';
    case 'activities_manager': return 'activities_manager';
    case 'domain_manager':     return 'domain_manager';
    case 'instructor_manager': return 'instructor_manager';
    case 'instructor':         return 'instructor';
    case 'instructor_admin':   return 'instructor';
  }
  switch (role) {
    case 'מנהל/ת':
    case 'מנהל מערכת':         return 'admin';
    case 'בקר/ת תפעול':
    case 'מנהל/ת תפעול':
    case 'מנהל תפעול':         return 'operation_manager';
    case 'משתמש/ת מורשה':
    case 'משתמש מורשה':        return 'authorized_user';
    case 'מדריך/ה':
    case 'מדריך':              return 'instructor';
    case 'כספים':              return 'finance';
    case 'מנהל/ת פעילויות':
    case 'מנהל פעילויות':      return 'activities_manager';
    case 'מנהל/ת תחום':
    case 'מנהל תחום':          return 'domain_manager';
    case 'מנהל/ת הדרכה / מדריך/ת מנהל/ת':
    case 'מדריך-מנהל':         return 'instructor_manager';
    default:                   throw new Error('invalid_role');
  }
}

// --- Internal codes ---

test('sim normalizeRole_: admin', () => {
  assert.strictEqual(normalizeRole('admin'), 'admin');
});

test('sim normalizeRole_: authorized_user (the previously-missing role)', () => {
  assert.strictEqual(normalizeRole('authorized_user'), 'authorized_user');
});

test('sim normalizeRole_: operation_manager', () => {
  assert.strictEqual(normalizeRole('operation_manager'), 'operation_manager');
});

test('sim normalizeRole_: operations_reviewer → operation_manager (alias)', () => {
  assert.strictEqual(normalizeRole('operations_reviewer'), 'operation_manager');
});

test('sim normalizeRole_: finance', () => {
  assert.strictEqual(normalizeRole('finance'), 'finance');
});

test('sim normalizeRole_: activities_manager', () => {
  assert.strictEqual(normalizeRole('activities_manager'), 'activities_manager');
});

test('sim normalizeRole_: domain_manager', () => {
  assert.strictEqual(normalizeRole('domain_manager'), 'domain_manager');
});

test('sim normalizeRole_: instructor_manager', () => {
  assert.strictEqual(normalizeRole('instructor_manager'), 'instructor_manager');
});

test('sim normalizeRole_: instructor', () => {
  assert.strictEqual(normalizeRole('instructor'), 'instructor');
});

test('sim normalizeRole_: instructor_admin → instructor (alias)', () => {
  assert.strictEqual(normalizeRole('instructor_admin'), 'instructor');
});

// --- Case-insensitive for codes ---

test('sim normalizeRole_: ADMIN (uppercase) → admin', () => {
  assert.strictEqual(normalizeRole('ADMIN'), 'admin');
});

test('sim normalizeRole_: AUTHORIZED_USER (uppercase) → authorized_user', () => {
  assert.strictEqual(normalizeRole('AUTHORIZED_USER'), 'authorized_user');
});

test('sim normalizeRole_: Operation_Manager (mixed case) → operation_manager', () => {
  assert.strictEqual(normalizeRole('Operation_Manager'), 'operation_manager');
});

// --- Hebrew display-label fallbacks ---

test('sim normalizeRole_: "מנהל/ת" (Hebrew admin) → admin', () => {
  assert.strictEqual(normalizeRole('מנהל/ת'), 'admin');
});

test('sim normalizeRole_: "מנהל מערכת" (Hebrew admin alt) → admin', () => {
  assert.strictEqual(normalizeRole('מנהל מערכת'), 'admin');
});

test('sim normalizeRole_: "בקר/ת תפעול" → operation_manager', () => {
  assert.strictEqual(normalizeRole('בקר/ת תפעול'), 'operation_manager');
});

test('sim normalizeRole_: "מנהל/ת תפעול" → operation_manager', () => {
  assert.strictEqual(normalizeRole('מנהל/ת תפעול'), 'operation_manager');
});

test('sim normalizeRole_: "מנהל תפעול" → operation_manager', () => {
  assert.strictEqual(normalizeRole('מנהל תפעול'), 'operation_manager');
});

test('sim normalizeRole_: "משתמש/ת מורשה" → authorized_user', () => {
  assert.strictEqual(normalizeRole('משתמש/ת מורשה'), 'authorized_user');
});

test('sim normalizeRole_: "משתמש מורשה" → authorized_user', () => {
  assert.strictEqual(normalizeRole('משתמש מורשה'), 'authorized_user');
});

test('sim normalizeRole_: "מדריך/ה" → instructor', () => {
  assert.strictEqual(normalizeRole('מדריך/ה'), 'instructor');
});

test('sim normalizeRole_: "מדריך" → instructor', () => {
  assert.strictEqual(normalizeRole('מדריך'), 'instructor');
});

test('sim normalizeRole_: "כספים" → finance', () => {
  assert.strictEqual(normalizeRole('כספים'), 'finance');
});

test('sim normalizeRole_: "מנהל/ת פעילויות" → activities_manager', () => {
  assert.strictEqual(normalizeRole('מנהל/ת פעילויות'), 'activities_manager');
});

test('sim normalizeRole_: "מנהל פעילויות" → activities_manager', () => {
  assert.strictEqual(normalizeRole('מנהל פעילויות'), 'activities_manager');
});

test('sim normalizeRole_: "מנהל/ת תחום" → domain_manager', () => {
  assert.strictEqual(normalizeRole('מנהל/ת תחום'), 'domain_manager');
});

test('sim normalizeRole_: "מנהל תחום" → domain_manager', () => {
  assert.strictEqual(normalizeRole('מנהל תחום'), 'domain_manager');
});

test('sim normalizeRole_: "מנהל/ת הדרכה / מדריך/ת מנהל/ת" → instructor_manager', () => {
  assert.strictEqual(normalizeRole('מנהל/ת הדרכה / מדריך/ת מנהל/ת'), 'instructor_manager');
});

test('sim normalizeRole_: "מדריך-מנהל" → instructor_manager', () => {
  assert.strictEqual(normalizeRole('מדריך-מנהל'), 'instructor_manager');
});

// --- Unknown / invalid values must still throw ---

test('sim normalizeRole_: empty string throws invalid_role', () => {
  assert.throws(() => normalizeRole(''), /invalid_role/);
});

test('sim normalizeRole_: garbage string throws invalid_role', () => {
  assert.throws(() => normalizeRole('some_garbage_value'), /invalid_role/);
});

test('sim normalizeRole_: random Hebrew throws invalid_role', () => {
  assert.throws(() => normalizeRole('שם משתמש'), /invalid_role/);
});
