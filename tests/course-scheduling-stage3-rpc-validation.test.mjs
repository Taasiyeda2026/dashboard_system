/**
 * Stage 3 RPC/DB-level validation tests.
 *
 * These tests use SQL source inspection to prove the actual server-side
 * behavior for every scheduling save path.  They complement the JS-engine
 * acceptance tests in course-scheduling-stage3-save-validation.test.mjs,
 * which prove the matching-engine logic, and the migration tests in
 * course-scheduling-migration.test.mjs, which cover the post-edit
 * revalidation trigger.
 *
 * Design context (migration 20260809210000_manual_instructor_choice_authoritative):
 *   "Manual instructor choices are authoritative.  Recommendation
 *   constraints remain available for ranking, but do not block a
 *   persisted decision by admin or operation_manager."
 *
 * Concretely:
 *  - save_course_assignment_draft   – identity + status checks only; no
 *    scheduling-constraint gate.  Scheduling checks live in the JS engine.
 *  - assign_activity_instructor     – same: no availability / conflict gate.
 *    Once an admin confirms a draft, the DB records the choice as-is.
 *  - Post-edit revalidation         – trigger fires AFTER UPDATE (edit is
 *    never blocked).  scheduling_apply_course_assignment_revalidation
 *    (20260809210000 version) resets status to 'שובץ' for locked courses;
 *    it never clears emp_id / instructor_name.
 *  - Manual re-check                – scheduling_locked_course_validation_reason
 *    (20260809180000) queries live tables (instructor_availability_rules,
 *    activities) so it always reflects current state; it is the backing
 *    function for the revalidate_course_instructor_assignment RPC.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Migration files under test
const authoritativeMigrationUrl = new URL(
  '../supabase/migrations/20260809210000_manual_instructor_choice_authoritative.sql',
  import.meta.url
);
const contractSyncUrl = new URL(
  '../supabase/migrations/20260809180000_course_scheduling_contract_sync.sql',
  import.meta.url
);
const revalidationMigrationUrl = new URL(
  '../supabase/migrations/20260730170000_course_scheduling_post_edit_revalidation.sql',
  import.meta.url
);

// ─── save_course_assignment_draft ─────────────────────────────────────────────

test('save_course_assignment_draft checks identity and status, not scheduling constraints', async () => {
  const sql = await readFile(authoritativeMigrationUrl, 'utf8');

  // Extract just the save_course_assignment_draft function body.
  const fnStart = sql.indexOf('create or replace function public.save_course_assignment_draft(');
  const fnEnd   = sql.indexOf(
    'revoke all on function public.save_course_assignment_draft(',
    fnStart
  );
  assert.ok(fnStart > -1 && fnEnd > fnStart, 'save_course_assignment_draft not found in migration');
  const fn = sql.slice(fnStart, fnEnd);

  // Identity + activity-status gates that MUST be present.
  assert.match(fn, /instructor_not_found/, 'must reject if instructor does not exist');
  assert.match(fn, /instructor_name_mismatch/, 'must reject if display name does not match DB');
  assert.match(fn, /scheduling_activity_not_school_2027/, 'must reject non-2027 activities');
  assert.match(fn, /scheduling_activity_not_course/, 'must reject non-course activities');
  assert.match(fn, /scheduling_activity_not_open/, 'must reject closed/cancelled activities');
  assert.match(fn, /scheduling_assignment_locked/, 'must reject already-locked assignments');

  // Scheduling constraints are deliberately NOT checked here — the
  // recommendation engine handles them client-side.  Writing a draft is a
  // planning step, not a final authoritative write.
  assert.doesNotMatch(fn, /scheduling_course_instructor_violations/, 'draft-save must not call violations (not a write gate)');
  assert.doesNotMatch(fn, /scheduling_course_conflict_exists/, 'draft-save must not call conflict-exists (not a write gate)');
  assert.doesNotMatch(fn, /scheduling_availability_missing/, 'draft-save must not gate on availability');
});

// ─── assign_activity_instructor (confirm-draft path) ──────────────────────────

test('assign_activity_instructor (confirm-draft) does not gate on availability or conflicts — admin override is authoritative', async () => {
  const sql = await readFile(authoritativeMigrationUrl, 'utf8');

  const fnStart = sql.indexOf('create or replace function public.assign_activity_instructor(');
  const fnEnd   = sql.indexOf(
    'revoke all on function public.assign_activity_instructor(',
    fnStart
  );
  assert.ok(fnStart > -1 && fnEnd > fnStart, 'assign_activity_instructor not found');
  const fn = sql.slice(fnStart, fnEnd);

  // The function does still enforce identity integrity.
  assert.match(fn, /instructor_name_mismatch/, 'must enforce name integrity');
  assert.match(fn, /scheduling_lock_instructor_for_write/, 'must take advisory lock for concurrency safety');

  // By design, scheduling constraints do NOT block a persisted admin decision.
  // The migration comment: "Recommendation constraints remain available for
  // ranking, but do not block a persisted decision by admin or operation_manager."
  assert.doesNotMatch(fn, /scheduling_course_instructor_violations/, 'assign must not call violations — admin override');
  assert.doesNotMatch(fn, /scheduling_availability_missing/, 'assign must not gate on availability — admin override');
  assert.doesNotMatch(fn, /scheduling_conflict_detected/, 'assign must not gate on conflict — advisory lock ensures concurrency, not eligibility');
});

// ─── scheduling_locked_course_validation_reason reads fresh live data ─────────

test('scheduling_locked_course_validation_reason reads fresh availability and conflict data from live tables', async () => {
  const sql = await readFile(contractSyncUrl, 'utf8');

  const fnStart = sql.indexOf('create or replace function public.scheduling_locked_course_validation_reason(');
  const fnEnd   = sql.indexOf('revoke all on function public.scheduling_locked_course_validation_reason', fnStart);
  assert.ok(fnStart > -1, 'scheduling_locked_course_validation_reason not found in contract_sync migration');
  const fn = sql.slice(fnStart, fnEnd);

  // Reads from live availability tables — not from any cached value.
  assert.match(fn, /instructor_availability_rules/, 'must query live availability rules');
  assert.match(fn, /instructor_availability_exceptions/, 'must also check date-specific exceptions');
  assert.match(fn, /scheduling_availability_missing/, 'must return availability-missing when rule absent');
  assert.match(fn, /scheduling_instructor_unavailable/, 'must return unavailable when rule exists but hours conflict');

  // Reads from live activities for conflict detection.
  assert.match(fn, /from public\.activities a/, 'must query live activities for overlap detection');
  assert.match(fn, /a\.draft_emp_id = selected_emp_id::text/, 'must include draft assignments in conflict check');
  assert.match(fn, /scheduling_conflict_detected/, 'must return conflict-detected when overlap found');

  // The revalidation RPC that wraps this function lives in the post-edit revalidation
  // migration (20260730170000) — verified by course-scheduling-migration.test.mjs line 122-128.
});

// ─── post-edit revalidation trigger is AFTER (edit is never blocked) ──────────

test('activities_revalidate_locked_assignment fires AFTER UPDATE — activity edit is never blocked by scheduling constraints', async () => {
  const sql = await readFile(revalidationMigrationUrl, 'utf8');

  // Trigger is AFTER UPDATE — the row write completes before revalidation runs.
  assert.match(sql, /after update on public\.activities/i, 'trigger must be AFTER UPDATE');
  assert.doesNotMatch(sql, /before update on public\.activities/i, 'trigger must NOT be BEFORE UPDATE — edits are never blocked');

  // The trigger fires on scheduling-sensitive column changes only.
  assert.match(sql, /scheduling_assignment_sensitive_changed/, 'must gate on sensitive-column changes');

  // The revalidation function called by the trigger.
  assert.match(sql, /scheduling_revalidate_assignment_after_activity_change/, 'trigger must call the correct handler');
  assert.match(sql, /scheduling_apply_course_assignment_revalidation/, 'handler must call the revalidation function');
});

// ─── post-edit revalidation never clears emp_id / instructor_name ─────────────

test('scheduling_apply_course_assignment_revalidation preserves emp_id and instructor_name after any activity edit', async () => {
  const sql = await readFile(authoritativeMigrationUrl, 'utf8');

  const fnStart = sql.indexOf('create or replace function public.scheduling_apply_course_assignment_revalidation(');
  const fnEnd   = sql.indexOf('revoke all on function public.scheduling_apply_course_assignment_revalidation(', fnStart);
  assert.ok(fnStart > -1, 'scheduling_apply_course_assignment_revalidation not found');
  const fn = sql.slice(fnStart, fnEnd);

  // The function only touches instructor_assignment_status.
  // emp_id and instructor_name are never written here.
  assert.match(fn, /update public\.activities set instructor_assignment_status/, 'must update status');
  assert.doesNotMatch(fn, /set[^;]*\bemp_id\s*=(?!\s*p_emp_id)/i, 'must not clear or change emp_id');
  assert.doesNotMatch(fn, /set[^;]*\binstructor_name\s*=/i, 'must not clear or change instructor_name');

  // The authoritative design: a locked assignment stays locked after edits.
  // Status is corrected to 'שובץ' (not to 'נדרש טיפול') by this function.
  // 'נדרש טיפול' is produced by the older scheduling_locked_course_validation_reason
  // path, available via the manual revalidate_course_instructor_assignment RPC.
  assert.match(fn, /instructor_assignment_locked is true/, 'must only act on locked assignments');
  assert.match(fn, /instructor_assignment_status='שובץ'/, 'must reset status to שובץ for locked courses');
});

// ─── valid happy-path assignment proceeds without error ───────────────────────

test('assign_activity_instructor succeeds for a valid assignment: sets emp_id, instructor_name, locked = true, status = שובץ', async () => {
  const sql = await readFile(authoritativeMigrationUrl, 'utf8');

  const fnStart = sql.indexOf('create or replace function public.assign_activity_instructor(');
  const fnEnd   = sql.indexOf('revoke all on function public.assign_activity_instructor(', fnStart);
  const fn = sql.slice(fnStart, fnEnd);

  // The happy path: UPDATE sets all four columns atomically.
  assert.match(fn, /set emp_id = p_emp_id/,                    'must write emp_id');
  assert.match(fn, /instructor_name = selected_instructor\.full_name/, 'must write canonical instructor_name');
  assert.match(fn, /instructor_assignment_locked = true/,       'must lock the assignment');
  assert.match(fn, /instructor_assignment_status = final_status/, 'must set status');
  // final_status is always 'שובץ' in the authoritative migration.
  assert.match(fn, /final_status := 'שובץ'/, "happy path status is always 'שובץ'");

  // An audit record is written on every successful assignment.
  assert.match(fn, /insert into public\.instructor_assignment_audit/, 'must audit every successful assignment');
});
