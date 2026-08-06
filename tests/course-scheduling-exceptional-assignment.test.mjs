import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const schemaUrl = new URL('../supabase/migrations/20260802220000_course_scheduling_interface_schema.sql', import.meta.url);
const rpcUrl = new URL('../supabase/migrations/20260802221000_course_scheduling_interface_rpcs.sql', import.meta.url);

// These structural checks are a permanent regression guard. The actual fix was verified
// end-to-end against a real Postgres instance during development (assign, double-assign,
// soft-violation block on the normal path, exception_approved bypass with an audit trail,
// Saturday staying a hard block under exception_approved, the 0/1/2 meeting rule, and the
// operational-replacement path) — this file locks the source-level guarantees in place.

test('assign_activity_instructor no longer runs the old all-or-nothing validator', async () => {
  const sql = await readFile(rpcUrl, 'utf8');
  // The bug: exception_approved was accepted as a decision type, but every mismatch still
  // raised unconditionally, so an exceptional assignment could never actually be saved.
  assert.doesNotMatch(sql, /perform public\.validate_course_instructor_assignment/);
  assert.match(sql, /violations := public\.scheduling_course_instructor_violations/);
});

test('non-exceptional decisions still fail closed on any unmet condition', async () => {
  const sql = await readFile(rpcUrl, 'utf8');
  assert.match(sql, /coalesce\(array_length\(violations, 1\), 0\) > 0 and p_decision_type <> 'exception_approved'/);
});

test('exceptional assignment records what was bypassed instead of silently hiding it', async () => {
  const sql = await readFile(rpcUrl, 'utf8');
  assert.match(sql, /bypassed_constraints/);
  assert.match(sql, /'שיבוץ חריג'/);
});

test('hard, physically-impossible conditions always raise regardless of decision type', async () => {
  const sql = await readFile(rpcUrl, 'utf8');
  const violationsFn = sql.split('create or replace function public.scheduling_course_instructor_violations')[1]
    .split('create or replace function public.assign_activity_instructor')[0];
  for (const hardGuard of ['scheduling_saturday_blocked', 'scheduling_conflict_detected', 'scheduling_transition_insufficient', 'instructor_inactive', 'scheduling_assignment_locked']) {
    const line = violationsFn.split('\n').find((entry) => entry.includes(hardGuard));
    assert.ok(line, `expected a hard-raise line for ${hardGuard}`);
    assert.match(line, /raise exception/, `${hardGuard} must always raise, not be collected into the bypassable violations array`);
  }
});

test('soft mismatches are collected into the violations array instead of raising immediately', async () => {
  const sql = await readFile(rpcUrl, 'utf8');
  for (const softGuard of ['scheduling_language_mismatch', 'scheduling_gender_mismatch', 'scheduling_education_level_mismatch', 'scheduling_authority_blocked', 'scheduling_school_blocked']) {
    assert.match(sql, new RegExp(`violations := array_append\\(violations, '${softGuard}'\\)`));
  }
});

test('the exceptional-assignment audit trail is server-authoritative, never client-supplied', async () => {
  const sql = await readFile(rpcUrl, 'utf8');
  assert.match(sql, /meetings_completed_at_decision/);
  assert.match(sql, /public\.scheduling_course_meetings_completed\(p_activity_id\)/);
});

test('a locked course (2+ meetings) can only be changed through the separate operational-replacement action', async () => {
  const sql = await readFile(rpcUrl, 'utf8');
  assert.match(sql, /if meetings_done >= 2 then raise exception 'scheduling_course_locked_for_reassignment'/);
  assert.match(sql, /create or replace function public\.replace_locked_course_instructor/);
  assert.match(sql, /previous_emp_id, previous_instructor_name, effective_from/);
});

test('a single completed meeting always requires an explicit reason to change the instructor', async () => {
  const sql = await readFile(rpcUrl, 'utf8');
  assert.match(sql, /meetings_done >= 1 or p_decision_type in \('overridden','exception_approved'\)/);
});

test('meetings-completed reuses existing completion-approval and cancellation data, not a new counter', async () => {
  const sql = await readFile(schemaUrl, 'utf8');
  assert.match(sql, /activity_completion_approval_uploads/);
  assert.match(sql, /course_meeting_cancellations/);
  assert.doesNotMatch(sql, /meetings_completed\s+integer\s+not null default/);
});

test('every protected function checks an active user and an authorized role', async () => {
  const sql = await readFile(rpcUrl, 'utf8');
  const functionBodies = sql.split(/create or replace function/).slice(1);
  const protectedFunctions = functionBodies.filter((body) => /security definer/.test(body) && /^\s*public\.(assign_activity_instructor|save_course_assignment_draft|cancel_course_assignment_draft|set_course_meeting_cancelled|reassign_locked_course_instructor|replace_locked_course_instructor)/.test(body));
  assert.ok(protectedFunctions.length >= 6, 'expected all six write RPCs to be present');
  for (const body of protectedFunctions) {
    assert.match(body, /caller_role is null or caller_role not in \('admin','operation_manager'\)/);
    assert.match(body, /auth_user_id = auth\.uid\(\) and u\.is_active is true/);
  }
});

test('drafts never write the official instructor columns', async () => {
  const sql = await readFile(rpcUrl, 'utf8');
  const draftFn = sql.split('create or replace function public.save_course_assignment_draft')[1].split('create or replace function public.cancel_course_assignment_draft')[0];
  assert.doesNotMatch(draftFn, /set\s+emp_id\s*=/);
  assert.match(draftFn, /draft_emp_id = p_emp_id::text/);
});
