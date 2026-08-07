import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const schemaUrl = new URL('../supabase/migrations/20260802220000_course_scheduling_interface_schema.sql', import.meta.url);
const rpcUrl = new URL('../supabase/migrations/20260802221000_course_scheduling_interface_rpcs.sql', import.meta.url);
const alignmentUrl = new URL('../supabase/migrations/20260807203000_course_scheduling_e2e_alignment.sql', import.meta.url);

test('assign_activity_instructor no longer runs the old all-or-nothing validator', async () => {
  const sql = await readFile(rpcUrl, 'utf8');
  assert.doesNotMatch(sql, /perform public\.validate_course_instructor_assignment/);
  assert.match(sql, /violations := public\.scheduling_course_instructor_violations/);
});

test('hard gates cannot be bypassed with exception_approved', async () => {
  const sql = await readFile(alignmentUrl, 'utf8');
  assert.match(sql, /Hard gates cannot be bypassed through exception_approved/);
  assert.match(sql, /if coalesce\(array_length\(violations, 1\), 0\) > 0 then\s*raise exception '%', violations\[1\];/s);
  assert.doesNotMatch(sql, /p_decision_type <> 'exception_approved'/);
});

test('hard, physically-impossible conditions always raise regardless of decision type', async () => {
  const sql = await readFile(alignmentUrl, 'utf8');
  const violationsFn = sql.split('create or replace function public.scheduling_course_instructor_violations')[1]
    .split('create or replace function public.scheduling_assert_assignment_calendar')[0];
  for (const hardGuard of [
    'scheduling_saturday_blocked',
    'scheduling_conflict_detected',
    'scheduling_transition_insufficient',
    'scheduling_transition_unverified',
    'scheduling_home_route_unverified',
    'scheduling_home_distance_exceeded',
    'instructor_inactive',
    'scheduling_assignment_locked'
  ]) {
    assert.match(violationsFn, new RegExp(`raise exception '${hardGuard}'`));
  }
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
  const sql = await readFile(alignmentUrl, 'utf8');
  const draftFn = sql.split('create or replace function public.save_course_assignment_draft(')[1]
    .split('create or replace function public.save_course_assignment_draft_with_dates')[0];
  assert.doesNotMatch(draftFn, /set\s+emp_id\s*=/);
  assert.match(draftFn, /draft_emp_id = p_emp_id::text/);
  assert.match(draftFn, /הקורס כבר נשמר כטיוטה/);
});
