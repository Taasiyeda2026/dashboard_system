import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../supabase/migrations/20260809120000_course_scheduling_production_contract_repair.sql', import.meta.url);
const draftRepairUrl = new URL('../supabase/migrations/20260809143000_course_scheduling_draft_ownership_repair.sql', import.meta.url);

test('production repair creates route dependencies before effective validation contract', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  const distance = sql.indexOf('function public.scheduling_cached_travel_distance_km');
  const homeRoute = sql.indexOf('function public.scheduling_assert_home_route');
  const effectiveMeetings = sql.indexOf('function public.scheduling_effective_meetings');
  const runtimeContract = sql.indexOf('function public.scheduling_runtime_contract');

  assert.ok(distance >= 0 && distance < homeRoute);
  assert.ok(homeRoute < effectiveMeetings && effectiveMeetings < runtimeContract);
  assert.match(sql, /if home_km is null then raise exception 'scheduling_home_route_unverified'/);
  assert.match(sql, /if home_km > 40 then raise exception 'scheduling_home_distance_exceeded'/);
  assert.match(sql, /when p_activity\.draft_proposed_meetings is not null/);
  assert.match(sql, /course_meeting_cancellations/);
});

test('latest repair keeps proposed dates scoped to their draft owner', async () => {
  const sql = await readFile(draftRepairUrl, 'utf8');
  assert.match(sql, /p_activity\.draft_emp_id = p_emp_id::text/);
  assert.match(sql, /and p_activity\.draft_proposed_meetings is not null/);
  assert.match(sql, /course_meeting_cancellations/);
});

test('canonical draft cancellation clears all draft state including proposed dates', async () => {
  const sql = await readFile(draftRepairUrl, 'utf8');
  const cancellation = sql.split('function public.cancel_course_assignment_draft')[1];
  for (const column of [
    'draft_emp_id',
    'draft_instructor_name',
    'draft_created_at',
    'draft_created_by',
    'draft_proposed_meetings'
  ]) assert.match(cancellation, new RegExp(`${column} = null`));
});

test('runtime contract verifies live RPC signatures and trigger targets', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  for (const signature of [
    'scheduling_assert_home_route(bigint,text)',
    'scheduling_assert_assignment_calendar(text,bigint,jsonb)',
    'save_course_assignment_draft_with_dates(text,bigint,text,jsonb,bigint,integer,integer)',
    'assign_activity_instructor_with_dates(text,bigint,text,jsonb,bigint,integer,integer,text,text)',
    'reassign_locked_course_instructor(text,bigint,text,bigint,integer,integer,text,text)'
  ]) {
    assert.ok(sql.includes(signature), `missing live signature check: ${signature}`);
  }
  assert.match(sql, /from pg_trigger/);
  assert.match(sql, /left join pg_proc target_function/);
  assert.match(sql, /grant execute on function public\.scheduling_runtime_contract\(\) to authenticated/);
});

const contractSyncUrl = new URL('../supabase/migrations/20260809180000_course_scheduling_contract_sync.sql', import.meta.url);

test('focused contract sync preserves owned drafts and removes meeting-count replacement lock', async () => {
  const sql = await readFile(contractSyncUrl, 'utf8');
  const effective = sql.split('function public.scheduling_effective_meetings')[1]
    .split('revoke all on function public.scheduling_effective_meetings')[0];
  assert.match(effective, /p_activity\.draft_emp_id = p_emp_id::text/);
  assert.match(effective, /p_activity\.draft_proposed_meetings is not null/);
  assert.match(effective, /course_meeting_cancellations/);

  const replacement = sql.split('function public.reassign_locked_course_instructor')[1];
  assert.match(replacement, /scheduling_course_instructor_violations\(p_activity_id, p_new_emp_id, false\)/);
  assert.match(replacement, /scheduling_course_meetings_completed\(p_activity_id\)/);
  assert.doesNotMatch(replacement, /scheduling_course_locked_for_reassignment/);
  assert.doesNotMatch(replacement, /meetings_done\s*>?=\s*2/);
  assert.doesNotMatch(replacement, /status\s*=\s*'(?:סגור|closed)'/i);
});

test('contract sync is idempotent and contains no activity data mutation or backfill', async () => {
  const sql = await readFile(contractSyncUrl, 'utf8');
  assert.match(sql, /create or replace function public\.scheduling_effective_meetings/);
  assert.match(sql, /create or replace function public\.reassign_locked_course_instructor/);
  assert.doesNotMatch(sql, /insert into public\.activities/i);
  assert.doesNotMatch(sql, /delete from public\.activities/i);
  assert.doesNotMatch(sql, /update public\.activities[\s\S]*set\s+status/i);
});
