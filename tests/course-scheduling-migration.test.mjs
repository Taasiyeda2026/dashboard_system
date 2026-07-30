import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const permissionMigrationUrl = new URL('../supabase/migrations/20260730120000_course_scheduling_2027_permission_rls_fix.sql', import.meta.url);
const executionMigrationUrl = new URL('../supabase/migrations/20260730160000_course_scheduling_execution_hardening.sql', import.meta.url);

test('RPC rejects NULL and unauthorized roles while retaining authorized roles and safety checks', async () => {
  const sql = await readFile(permissionMigrationUrl, 'utf8');
  assert.match(sql, /caller_role is null or caller_role not in \('admin','operation_manager'\)/);
  assert.match(sql, /auth_user_id = auth\.uid\(\).*is_active is true/);
  for (const guard of ['instructor_inactive', 'scheduling_activity_not_school_2027', 'scheduling_activity_not_course', 'scheduling_activity_not_open', 'scheduling_assignment_locked', 'scheduling_conflict_detected', 'scheduling_reason_required']) {
    assert.match(sql, new RegExp(guard));
  }
});

test('corrective migration drops legacy open policy names before role-scoped policies', async () => {
  const sql = await readFile(permissionMigrationUrl, 'utf8');
  assert.match(sql, /drop policy if exists instructor_assignment_audit_read/);
  assert.match(sql, /drop policy if exists scheduling_travel_cache_read/);
  assert.doesNotMatch(sql, /using\s*\(\s*true\s*\)/i);
  assert.equal((sql.match(/app_current_role\(\) = any/g) || []).length, 2);
});

test('execution migration validates all mandatory matching fields on the server', async () => {
  const sql = await readFile(executionMigrationUrl, 'utf8');
  for (const guard of [
    'scheduling_instructor_profile_incomplete',
    'scheduling_language_mismatch',
    'scheduling_gender_mismatch',
    'scheduling_education_level_mismatch',
    'scheduling_course_not_allowed',
    'scheduling_course_blocked',
    'scheduling_instructor_blocked',
    'scheduling_instructor_not_allowed',
    'scheduling_authority_blocked',
    'scheduling_school_blocked',
    'scheduling_availability_missing',
    'scheduling_instructor_unavailable',
    'scheduling_saturday_blocked',
    'scheduling_friday_not_allowed',
    'scheduling_conflict_detected',
    'scheduling_transition_unverified',
    'scheduling_transition_insufficient',
    'scheduling_daily_sequence_exceeded'
  ]) assert.match(sql, new RegExp(guard));
  assert.match(sql, /emp_id_2::text/);
  assert.match(sql, /instructor_name_2/);
  assert.match(sql, /scheduling_travel_cache/);
  assert.match(sql, /validate_course_instructor_assignment/);
});

test('rejected suggestions are recorded with a reason and a treatment status', async () => {
  const sql = await readFile(executionMigrationUrl, 'utf8');
  assert.match(sql, /reject_activity_instructor_suggestion/);
  assert.match(sql, /decision_type in \('draft','approved','overridden','exception_approved','rejected'\)/);
  assert.match(sql, /'rejected'.*'נדרש טיפול'/s);
  assert.match(sql, /scheduling_reason_required/);
  assert.match(sql, /grant execute on function public\.reject_activity_instructor_suggestion/);
});

test('final migration keeps audit and travel-cache reads role scoped', async () => {
  const sql = await readFile(executionMigrationUrl, 'utf8');
  assert.doesNotMatch(sql, /using\s*\(\s*true\s*\)/i);
  assert.equal((sql.match(/app_current_role\(\) = any/g) || []).length, 2);
  assert.match(sql, /drop policy if exists instructor_assignment_audit_read/);
  assert.match(sql, /drop policy if exists scheduling_travel_cache_read/);
});
