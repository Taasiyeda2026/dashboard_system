import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const permissionMigrationUrl = new URL('../supabase/migrations/20260730120000_course_scheduling_2027_permission_rls_fix.sql', import.meta.url);
const executionMigrationUrl = new URL('../supabase/migrations/20260730160000_course_scheduling_execution_hardening.sql', import.meta.url);
const revalidationMigrationUrl = new URL('../supabase/migrations/20260730170000_course_scheduling_post_edit_revalidation.sql', import.meta.url);
const travelCacheReadinessMigrationUrl = new URL('../supabase/migrations/20260803193000_course_scheduling_travel_cache_production_readiness.sql', import.meta.url);

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

test('locked 2027 assignments are revalidated after every scheduling-sensitive activity edit', async () => {
  const sql = await readFile(revalidationMigrationUrl, 'utf8');
  assert.match(sql, /scheduling_assignment_sensitive_changed/);
  for (const field of [
    'activity_season', 'activity_type', 'status', 'start_time', 'end_time',
    'school_id', 'school', 'authority_id', 'authority', 'instruction_language',
    'required_instructor_gender', 'education_level', 'grade', 'activity_no',
    'activity_name', 'blocked_instructor_ids', 'allowed_instructor_ids'
  ]) assert.match(sql, new RegExp(`p_old\\.${field} is distinct from p_new\\.${field}`));
  assert.match(sql, /for n in 1\.\.35 loop/);
  assert.match(sql, /create trigger activities_revalidate_locked_assignment/);
  assert.match(sql, /after update on public\.activities/);
});

test('post-edit revalidation preserves the selected instructor and changes only assignment status', async () => {
  const sql = await readFile(revalidationMigrationUrl, 'utf8');
  assert.match(sql, /scheduling_locked_course_validation_reason/);
  assert.match(sql, /next_status := case when validation_reason is null then 'שובץ' else 'נדרש טיפול' end/);
  assert.match(sql, /update public\.activities\s+set instructor_assignment_status = next_status/s);
  assert.doesNotMatch(sql, /update public\.activities\s+set[^;]*\bemp_id\s*=/is);
  assert.match(sql, /decision_type[\s\S]*'revalidated'/);
  assert.match(sql, /previous_status[\s\S]*new_status/);
});

test('revalidation repeats mandatory profile, availability, conflict, travel and sequence checks', async () => {
  const sql = await readFile(revalidationMigrationUrl, 'utf8');
  for (const guard of [
    'scheduling_instructor_profile_incomplete', 'scheduling_language_mismatch',
    'scheduling_gender_mismatch', 'scheduling_education_level_mismatch',
    'scheduling_course_not_allowed', 'scheduling_course_blocked',
    'scheduling_instructor_blocked', 'scheduling_instructor_not_allowed',
    'scheduling_authority_blocked', 'scheduling_school_blocked',
    'scheduling_availability_missing', 'scheduling_instructor_unavailable',
    'scheduling_conflict_detected', 'scheduling_transition_unverified',
    'scheduling_transition_insufficient', 'scheduling_daily_sequence_exceeded'
  ]) assert.match(sql, new RegExp(guard));
  assert.match(sql, /scheduling_cached_travel_minutes/);
  assert.match(sql, /instructor_availability_exceptions/);
  assert.match(sql, /instructor_availability_rules/);
});

test('school-address changes also revalidate matching locked assignments', async () => {
  const sql = await readFile(revalidationMigrationUrl, 'utf8');
  assert.match(sql, /contacts_schools_revalidate_assignments/);
  assert.match(sql, /contacts_schools_insert_revalidate_assignments/);
  assert.match(sql, /schools_revalidate_assignments/);
  assert.match(sql, /institution_address, mailing_address, city, house_number/);
  assert.match(sql, /school_address_changed/);
});

test('manual revalidation is restricted to active admin and operation manager users', async () => {
  const sql = await readFile(revalidationMigrationUrl, 'utf8');
  assert.match(sql, /revalidate_course_instructor_assignment/);
  assert.match(sql, /caller_role is null or caller_role not in \('admin','operation_manager'\)/);
  assert.match(sql, /auth_user_id = auth\.uid\(\) and is_active is true/);
  assert.match(sql, /revoke all on function public\.revalidate_course_instructor_assignment\(text\) from public/);
  assert.match(sql, /grant execute on function public\.revalidate_course_instructor_assignment\(text\) to authenticated/);
});

test('travel-cache readiness migration grants service_role and meeting-table select privileges', async () => {
  const sql = await readFile(travelCacheReadinessMigrationUrl, 'utf8');
  assert.match(sql, /grant execute on function public\.scheduling_authority_school_locations\(\) to service_role/i);
  assert.match(sql, /grant select, insert, update, delete on public\.scheduling_travel_cache to service_role/i);
  assert.match(sql, /grant select on public\.course_meeting_cancellations to authenticated/i);
  assert.match(sql, /grant select on public\.course_meeting_instructor_history to authenticated/i);
  assert.match(sql, /origin_instructor_emp_id/);
  assert.doesNotMatch(sql, /using\s*\(\s*true\s*\)/i);
});