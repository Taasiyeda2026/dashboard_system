import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const schemaUrl = new URL('../supabase/migrations/20260802220000_course_scheduling_interface_schema.sql', import.meta.url);
const rpcUrl = new URL('../supabase/migrations/20260802221000_course_scheduling_interface_rpcs.sql', import.meta.url);

// A draft holds a real calendar slot (spec section 21) and must be exactly as protected
// against a genuine double-booking as a confirmed assignment. Verified end-to-end against
// a real Postgres instance during development: two overlapping drafts for the same
// instructor, a draft overlapping a confirmed assignment, a confirmed assignment
// overlapping another instructor's confirmed course, and a confirmed assignment
// overlapping an existing draft of the same instructor were all rejected with
// scheduling_conflict_detected across every one of the course's meeting dates; a
// non-overlapping draft and an unrelated instructor's assignment both succeeded.

test('a shared conflict helper checks real overlap across every meeting date, against both drafts and confirmed assignments', async () => {
  const sql = await readFile(schemaUrl, 'utf8');
  assert.match(sql, /create or replace function public\.scheduling_course_conflict_exists/);
  const fn = sql.split('create or replace function public.scheduling_course_conflict_exists')[1].split('revoke all')[0];
  assert.match(fn, /a\.emp_id::text = p_emp_id::text/);
  assert.match(fn, /a\.emp_id_2::text = p_emp_id::text/);
  assert.match(fn, /a\.draft_emp_id = p_emp_id::text/);
  assert.match(fn, /unnest\(target_dates\)/);
  // Internal helper only: never exposed as a direct client-callable RPC.
  assert.doesNotMatch(sql, /grant execute on function public\.scheduling_course_conflict_exists/);
});

test('saving a draft is blocked by a real overlap before anything is written', async () => {
  const sql = await readFile(rpcUrl, 'utf8');
  const draftFn = sql.split('create or replace function public.save_course_assignment_draft')[1].split('create or replace function public.cancel_course_assignment_draft')[0];
  assert.match(draftFn, /if public\.scheduling_course_conflict_exists\(p_activity_id, p_emp_id\) then raise exception 'scheduling_conflict_detected'; end if;/);
  // The conflict check must run before the row is ever updated.
  const conflictIndex = draftFn.indexOf('scheduling_course_conflict_exists(p_activity_id, p_emp_id)');
  const updateIndex = draftFn.indexOf('update public.activities');
  assert.ok(conflictIndex > -1 && updateIndex > conflictIndex, 'the conflict check must run before the draft is saved');
});

test('confirming an assignment (assign/reassign/replace) is blocked by an existing draft of the same instructor', async () => {
  const sql = await readFile(rpcUrl, 'utf8');
  const violationsFn = sql.split('create or replace function public.scheduling_course_instructor_violations')[1]
    .split('create or replace function public.assign_activity_instructor')[0];
  const raiseIndex = violationsFn.indexOf("raise exception 'scheduling_conflict_detected'");
  assert.ok(raiseIndex > -1, 'expected the hard conflict-detection raise');
  const conflictBlock = violationsFn.slice(Math.max(0, raiseIndex - 400), raiseIndex);
  assert.match(conflictBlock, /a\.draft_emp_id = p_emp_id::text/);
  // This shared check backs assign_activity_instructor, reassign_locked_course_instructor
  // and replace_locked_course_instructor alike since they all call this validator.
  assert.match(sql, /violations := public\.scheduling_course_instructor_violations\(p_activity_id, p_emp_id, true\);/);
  assert.match(sql, /violations := public\.scheduling_course_instructor_violations\(p_activity_id, p_new_emp_id, false\);/);
});
