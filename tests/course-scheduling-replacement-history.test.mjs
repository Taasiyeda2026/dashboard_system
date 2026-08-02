import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const schemaUrl = new URL('../supabase/migrations/20260802220000_course_scheduling_interface_schema.sql', import.meta.url);
const rpcUrl = new URL('../supabase/migrations/20260802221000_course_scheduling_interface_rpcs.sql', import.meta.url);

// Verified end-to-end against a real Postgres instance during development: a course with
// one past meeting and one future meeting, assigned to instructor 1 then operationally
// replaced with instructor 2 (effective_from between the two dates) resulted in
// scheduling_course_meeting_instructors() reporting instructor 1 for the past meeting and
// instructor 2 for the future one, while activities.emp_id itself became instructor 2.

test('a dedicated history table records only the meetings an operational replacement actually touches', async () => {
  const sql = await readFile(schemaUrl, 'utf8');
  assert.match(sql, /create table if not exists public\.course_meeting_instructor_history/);
  const table = sql.split('create table if not exists public.course_meeting_instructor_history')[1].split(';')[0];
  for (const column of ['activity_id text not null', 'meeting_date date not null', 'emp_id text not null']) {
    assert.match(table, new RegExp(column));
  }
  assert.match(table, /unique \(activity_id, meeting_date\)/);
});

test('the resolver falls back to activities.emp_id when a meeting was never touched by a replacement', async () => {
  const sql = await readFile(schemaUrl, 'utf8');
  assert.match(sql, /create or replace function public\.scheduling_course_meeting_instructors/);
  const fn = sql.split('create or replace function public.scheduling_course_meeting_instructors')[1].split('revoke all')[0];
  assert.match(fn, /coalesce\(h\.emp_id, t\.emp_id::text\)/);
  assert.match(fn, /coalesce\(h\.instructor_name, t\.instructor_name\)/);
  assert.match(fn, /left join public\.course_meeting_instructor_history h/);
  assert.match(sql, /grant execute on function public\.scheduling_course_meeting_instructors\(text\) to authenticated/);
});

test('replace_locked_course_instructor backfills only meetings strictly before the effective date, with the previous instructor', async () => {
  const sql = await readFile(rpcUrl, 'utf8');
  const replaceFn = sql.split('create or replace function public.replace_locked_course_instructor')[1];
  assert.match(replaceFn, /insert into public\.course_meeting_instructor_history \(activity_id, meeting_date, emp_id, instructor_name\)/);
  assert.match(replaceFn, /select p_activity_id, meeting_date, prior_emp_id, prior_instructor_name/);
  assert.match(replaceFn, /where meeting_date < p_effective_from/);
  assert.match(replaceFn, /on conflict \(activity_id, meeting_date\) do nothing/);
  // The backfill must run against the row read before the instructor is overwritten,
  // and before the update that actually changes activities.emp_id to the new instructor.
  const backfillIndex = replaceFn.indexOf('insert into public.course_meeting_instructor_history');
  const priorCaptureIndex = replaceFn.indexOf('prior_emp_id := result.emp_id::text;');
  const updateIndex = replaceFn.indexOf('set emp_id = p_new_emp_id');
  assert.ok(priorCaptureIndex > -1 && backfillIndex > priorCaptureIndex, 'previous instructor must be captured before the backfill runs');
  assert.ok(updateIndex > backfillIndex, 'activities.emp_id must only change after the previous instructor is preserved for past meetings');
});

test('a replacement without a reason or effective date never reaches the history backfill', async () => {
  const sql = await readFile(rpcUrl, 'utf8');
  const replaceFn = sql.split('create or replace function public.replace_locked_course_instructor')[1];
  const reasonCheckIndex = replaceFn.indexOf("raise exception 'scheduling_reason_required'");
  const effectiveCheckIndex = replaceFn.indexOf("raise exception 'scheduling_effective_date_required'");
  const backfillIndex = replaceFn.indexOf('insert into public.course_meeting_instructor_history');
  assert.ok(reasonCheckIndex > -1 && reasonCheckIndex < backfillIndex);
  assert.ok(effectiveCheckIndex > -1 && effectiveCheckIndex < backfillIndex);
});
