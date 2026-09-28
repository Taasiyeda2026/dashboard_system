import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../supabase/migrations/20260928120000_fix_attendance_approval_input_regexes.sql', import.meta.url),
  'utf8'
);

const validMonths = ['2026-09', '2026-01', '2026-12'];
const invalidMonths = ['2026-00', '2026-13', '26-09', '2026-9', 'abc'];
const validEmployeeIds = ['1530', '1503'];
const invalidEmployeeIds = ['abc', '15x0', ''];

function functionBody(name) {
  const start = migration.indexOf(`create or replace function public.${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const bodyStart = migration.indexOf('as $$', start);
  const end = migration.indexOf('$$;', bodyStart);
  assert.ok(bodyStart > start && end > bodyStart, `incomplete ${name}`);
  return migration.slice(bodyStart + 5, end);
}

// PostgreSQL standard-conforming string literals preserve backslashes. Passing
// the extracted pattern to RegExp therefore reproduces the escaping regression:
// a stored `\\d` would match a literal backslash plus "d", not an ASCII digit.
function guardFor(name, parameter) {
  const body = functionBody(name);
  const parameterIndex = body.indexOf(parameter);
  assert.notEqual(parameterIndex, -1, `${name} does not guard ${parameter}`);
  const guard = body.slice(parameterIndex).match(/!~\s*'((?:''|[^'])+)'\s+then([\s\S]*?)end if;/i);
  assert.ok(guard, `missing regex guard for ${parameter} in ${name}`);
  const pattern = guard[1].replaceAll("''", "'");
  const rejection = /raise exception\s+'([^']+)'/i.exec(guard[2])?.[1]
    ?? (/return\s+'\[\]'/i.test(guard[2]) ? 'silent_empty_result' : 'unknown_rejection');
  return { regex: new RegExp(pattern), rejection };
}

function verifyGuard(name, parameter, accepted, rejected, expectedRejection) {
  const guard = guardFor(name, parameter);
  for (const value of accepted) {
    assert.equal(guard.regex.test(value), true, `${name} rejected valid ${parameter} ${value}`);
  }
  for (const value of rejected) {
    assert.equal(guard.regex.test(value), false, `${name} accepted invalid ${parameter} ${value}`);
  }
  assert.equal(guard.rejection, expectedRejection, `${name} must reject invalid ${parameter} explicitly`);
}

test('all attendance approval month paths execute the strict YYYY-MM guard', () => {
  for (const name of [
    'av2_submit_attendance_month',
    'admin_submit_attendance_month_on_behalf',
    'manager_finalize_attendance_month_review',
    'admin_finalize_attendance_month_payroll',
    'admin_reopen_attendance_month_for_correction',
    'get_payroll_attendance_month_statuses',
    'av2_validate_attendance_month_dashboard'
  ]) {
    verifyGuard(name, 'p_month_key', validMonths, invalidMonths, 'invalid_month_key');
  }
});

test('all text employee-id approval paths execute the ASCII-digit guard', () => {
  const expectedErrors = new Map([
    ['admin_submit_attendance_month_on_behalf', 'attendance_admin_submission_invalid_employee'],
    ['manager_finalize_attendance_month_review', 'invalid_employee_id'],
    ['admin_finalize_attendance_month_payroll', 'invalid_employee_id'],
    ['admin_reopen_attendance_month_for_correction', 'invalid_employee_id']
  ]);
  for (const [name, error] of expectedErrors) {
    verifyGuard(name, 'p_employee_id', validEmployeeIds, invalidEmployeeIds, error);
  }

  verifyGuard(
    'av2_approval_before_insert',
    'v_override_emp_id',
    validEmployeeIds,
    invalidEmployeeIds,
    'attendance_admin_submission_invalid_employee'
  );
});
