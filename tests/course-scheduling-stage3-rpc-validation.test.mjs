/**
 * Stage 3 RPC/DB-level validation tests (SQL source inspection).
 *
 * These tests use SQL source inspection of the Stage 3 migration
 * (20260810230000_course_scheduling_stage3_validation.sql) to prove that
 * the scheduling validation gates have been correctly restored for every
 * save path.
 *
 * Complement:
 *   - course-scheduling-stage3-save-validation.test.mjs  — JS engine acceptance tests
 *   - course-scheduling-stage3-live-db.test.mjs          — real Postgres integration tests
 *
 * Design decisions documented here:
 *   Admin override applies ONLY to post-edit activity changes (never to
 *   save_draft / confirm-draft / final-assign).  That distinction was
 *   collapsed in migration 20260809210000, which this migration reverts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const stage3MigrationUrl = new URL(
  '../supabase/migrations/20260810230000_course_scheduling_stage3_validation.sql',
  import.meta.url
);
const authoritativeMigrationUrl = new URL(
  '../supabase/migrations/20260809210000_manual_instructor_choice_authoritative.sql',
  import.meta.url
);
const revalidationMigrationUrl = new URL(
  '../supabase/migrations/20260730170000_course_scheduling_post_edit_revalidation.sql',
  import.meta.url
);
const contractSyncUrl = new URL(
  '../supabase/migrations/20260809180000_course_scheduling_contract_sync.sql',
  import.meta.url
);

// ─── save_course_assignment_draft ─────────────────────────────────────────────

test('save_course_assignment_draft (stage3): restored violations check — rejects ineligible instructor at draft-save time', async () => {
  const sql = await readFile(stage3MigrationUrl, 'utf8');

  const fnStart = sql.indexOf('create or replace function public.save_course_assignment_draft(');
  const fnEnd   = sql.indexOf(
    'revoke all on function public.save_course_assignment_draft(',
    fnStart
  );
  assert.ok(fnStart > -1 && fnEnd > fnStart, 'save_course_assignment_draft not found');
  const fn = sql.slice(fnStart, fnEnd);

  // Violations call restored.
  assert.match(fn, /scheduling_course_instructor_violations/, 'must call violations before writing');
  assert.match(fn, /coalesce\(array_length\(violations, 1\), 0\) > 0/, 'must raise when violations non-empty');
  assert.match(fn, /raise exception '%', violations\[1\]/, 'must raise the first violation');

  // Identity + status gates still present.
  assert.match(fn, /instructor_not_found/);
  assert.match(fn, /instructor_name_mismatch/);
  assert.match(fn, /scheduling_activity_not_open/);
  assert.match(fn, /scheduling_assignment_locked/);
});

// ─── assign_activity_instructor (confirm-draft / final assign) ────────────────

test('assign_activity_instructor (stage3): restored violations check — rejects stale draft at confirm time', async () => {
  const sql = await readFile(stage3MigrationUrl, 'utf8');

  const fnStart = sql.indexOf('create or replace function public.assign_activity_instructor(');
  const fnEnd   = sql.indexOf(
    'revoke all on function public.assign_activity_instructor(',
    fnStart
  );
  assert.ok(fnStart > -1 && fnEnd > fnStart, 'assign_activity_instructor not found');
  const fn = sql.slice(fnStart, fnEnd);

  // Violations call with p_expect_unassigned=true (same pattern as the original
  // pre-20260809210000 implementation; also verifies the activity is not already locked).
  assert.match(fn, /scheduling_course_instructor_violations\(p_activity_id, p_emp_id, true\)/, 'must call violations with p_expect_unassigned=true');
  assert.match(fn, /coalesce\(array_length\(violations, 1\), 0\) > 0/);
  assert.match(fn, /raise exception '%', violations\[1\]/);

  // Concurrency lock still acquired first.
  assert.match(fn, /scheduling_lock_instructor_for_write/);

  // Identity integrity still enforced.
  assert.match(fn, /instructor_name_mismatch/);
});

// ─── reassign_locked_course_instructor ────────────────────────────────────────

test('reassign_locked_course_instructor (stage3): restored violations check for the new instructor', async () => {
  const sql = await readFile(stage3MigrationUrl, 'utf8');

  const fnStart = sql.indexOf('create or replace function public.reassign_locked_course_instructor(');
  const fnEnd   = sql.indexOf(
    'revoke all on function public.reassign_locked_course_instructor(',
    fnStart
  );
  assert.ok(fnStart > -1 && fnEnd > fnStart, 'reassign_locked_course_instructor not found');
  const fn = sql.slice(fnStart, fnEnd);

  // Violations with p_expect_unassigned=false (activity IS locked, not unassigned).
  assert.match(fn, /scheduling_course_instructor_violations\(p_activity_id, p_new_emp_id, false\)/, 'must use false — activity is locked, not unassigned');
  assert.match(fn, /coalesce\(array_length\(violations, 1\), 0\) > 0/);
  assert.match(fn, /raise exception '%', violations\[1\]/);
});

// ─── scheduling_apply_course_assignment_revalidation ─────────────────────────

test('scheduling_apply_course_assignment_revalidation (stage3): restored — sets נדרש טיפול when invalid, never clears emp_id', async () => {
  const sql = await readFile(stage3MigrationUrl, 'utf8');

  const fnStart = sql.indexOf('create or replace function public.scheduling_apply_course_assignment_revalidation(');
  const fnEnd   = sql.indexOf('revoke all on function public.scheduling_apply_course_assignment_revalidation(', fnStart);
  assert.ok(fnStart > -1, 'scheduling_apply_course_assignment_revalidation not found');
  const fn = sql.slice(fnStart, fnEnd);

  // Calls the live-data validation function.
  assert.match(fn, /scheduling_locked_course_validation_reason/, 'must call live-data validation function');

  // Status is set based on validation result.
  assert.match(fn, /case when validation_reason is null then 'שובץ' else 'נדרש טיפול' end/, "must produce 'נדרש טיפול' when invalid");

  // emp_id and instructor_name are NEVER written here.
  assert.doesNotMatch(fn, /set[^;]*\bemp_id\s*=/i, 'must not write emp_id');
  assert.doesNotMatch(fn, /set[^;]*\binstructor_name\s*=/i, 'must not write instructor_name');

  // Only locked courses with an instructor are revalidated.
  assert.match(fn, /instructor_assignment_locked is not true/, 'must skip unlocked courses');
});

// ─── admin override boundary: post-edit activity trigger is AFTER UPDATE ──────

test('activities_revalidate_locked_assignment trigger is AFTER UPDATE — activity edit is never blocked', async () => {
  const sql = await readFile(revalidationMigrationUrl, 'utf8');
  assert.match(sql, /after update on public\.activities/i, 'trigger must be AFTER UPDATE');
  assert.doesNotMatch(sql, /before update on public\.activities/i, 'must NOT be BEFORE UPDATE');
});

// ─── 20260809210000 is superseded for save/confirm paths ─────────────────────

test('20260809210000 stripped violations from save/confirm paths; 20260810230000 is the authoritative version', async () => {
  const old = await readFile(authoritativeMigrationUrl, 'utf8');
  const fix = await readFile(stage3MigrationUrl, 'utf8');

  // The authoritative migration removed violations from assign_activity_instructor.
  const oldAssign = old.slice(
    old.indexOf('create or replace function public.assign_activity_instructor('),
    old.indexOf('revoke all on function public.assign_activity_instructor(')
  );
  assert.doesNotMatch(oldAssign, /scheduling_course_instructor_violations/, '20260809210000 must NOT have violations (it was the bug)');

  // The stage3 migration restores it.
  const newAssign = fix.slice(
    fix.indexOf('create or replace function public.assign_activity_instructor('),
    fix.indexOf('revoke all on function public.assign_activity_instructor(')
  );
  assert.match(newAssign, /scheduling_course_instructor_violations/, '20260810230000 must restore violations');
});

// ─── scheduling_locked_course_validation_reason reads fresh live data ─────────

test('scheduling_locked_course_validation_reason reads fresh availability and conflict data from live tables', async () => {
  const sql = await readFile(contractSyncUrl, 'utf8');

  const fnStart = sql.indexOf('create or replace function public.scheduling_locked_course_validation_reason(');
  const fnEnd   = sql.indexOf('revoke all on function public.scheduling_locked_course_validation_reason', fnStart);
  assert.ok(fnStart > -1, 'scheduling_locked_course_validation_reason not found');
  const fn = sql.slice(fnStart, fnEnd);

  // Reads from live availability tables — not from any cached value.
  assert.match(fn, /instructor_availability_rules/, 'must query live availability rules');
  assert.match(fn, /instructor_availability_exceptions/, 'must check date-specific exceptions');
  assert.match(fn, /scheduling_availability_missing/, 'must return availability-missing when no rule');

  // Reads from live activities for conflict detection.
  assert.match(fn, /from public\.activities a/, 'must query live activities for overlap');
  assert.match(fn, /a\.draft_emp_id = selected_emp_id::text/, 'must include draft assignments in conflict check');
  assert.match(fn, /scheduling_conflict_detected/, 'must detect live conflicts');
});
