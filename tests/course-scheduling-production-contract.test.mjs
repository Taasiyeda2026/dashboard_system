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
const legacyCleanupUrl = new URL('../supabase/migrations/20260809200000_course_scheduling_legacy_cleanup.sql', import.meta.url);

test('focused contract sync makes completed meetings audit-only for replacement', async () => {
  const sql = await readFile(contractSyncUrl, 'utf8');
  const replacement = sql.split('function public.reassign_locked_course_instructor')[1]
    .split('create or replace function public.scheduling_course_instructor_violations')[0];
  assert.match(replacement, /scheduling_course_instructor_violations\(p_activity_id, p_new_emp_id, false\)/);
  assert.match(replacement, /meetings_done := public\.scheduling_course_meetings_completed\(p_activity_id\)/);
  assert.match(replacement, /meetings_completed_at_decision/);
  assert.doesNotMatch(replacement, /meetings_done\s*>?=/);
  assert.doesNotMatch(replacement, /scheduling_course_locked_for_reassignment/);
  assert.doesNotMatch(replacement, /status\s*=\s*'(?:סגור|closed)'/i);
});

test('initial validation and revalidation use one effective calendar contract', async () => {
  const sql = await readFile(contractSyncUrl, 'utf8');
  const conflict = sql.split('function public.scheduling_course_conflict_exists')[1]
    .split('function public.scheduling_course_instructor_violations')[0];
  assert.equal((conflict.match(/scheduling_effective_meetings/g) || []).length, 2);
  assert.doesNotMatch(conflict, /generate_series\(1,\s*35\)|date_' \|\| n/);

  const calendarAssert = sql.split('function public.scheduling_assert_assignment_calendar')[1]
    .split('function public.scheduling_course_instructor_violations')[0];
  assert.ok((calendarAssert.match(/scheduling_effective_meetings\(a,/g) || []).length >= 2);
  assert.match(calendarAssert, /course_meeting_cancellations/);
  assert.equal((calendarAssert.match(/scheduling_cached_travel_minutes/g) || []).length, 2);
  assert.equal((calendarAssert.match(/required_minutes \+ 15/g) || []).length, 2);
  assert.doesNotMatch(calendarAssert, /generate_series\(1,\s*35\)|date_' \|\| n|required_minutes \+ 15 \+ 15/);

  const validation = sql.split('function public.scheduling_course_instructor_violations')[1]
    .split('function public.scheduling_locked_course_validation_reason')[0];
  const revalidation = sql.split('function public.scheduling_locked_course_validation_reason')[1];

  for (const body of [validation, revalidation]) {
    assert.match(body, /scheduling_effective_meetings\(target,/);
    assert.ok((body.match(/scheduling_effective_meetings\(a,/g) || []).length >= 3);
    assert.doesNotMatch(body, /generate_series\(1,\s*35\)/);
    assert.doesNotMatch(body, /date_' \|\| n/);
    assert.equal((body.match(/scheduling_cached_travel_minutes/g) || []).length, 2);
    assert.equal((body.match(/required_minutes \+ 15/g) || []).length, 2);
    assert.doesNotMatch(body, /required_minutes \+ 15 \+ 15/);
  }
});

test('contract sync is idempotent and contains no activity data mutation or backfill', async () => {
  const sql = await readFile(contractSyncUrl, 'utf8');
  for (const functionName of [
    'scheduling_effective_meetings',
    'reassign_locked_course_instructor',
    'scheduling_course_conflict_exists',
    'scheduling_assert_assignment_calendar',
    'scheduling_course_instructor_violations',
    'scheduling_locked_course_validation_reason'
  ]) assert.match(sql, new RegExp(`create or replace function public\.${functionName}`));
  assert.doesNotMatch(sql, /insert into public\.activities/i);
  assert.doesNotMatch(sql, /delete from public\.activities/i);
  assert.doesNotMatch(sql, /update public\.activities[\s\S]*set\s+status/i);
});

test('revalidation delegates decisions to the canonical assignment validator', async () => {
  const sql = await readFile(legacyCleanupUrl, 'utf8');
  const revalidation = sql.split('function public.scheduling_locked_course_validation_reason')[1]
    .split('revoke all')[0];
  assert.match(revalidation, /scheduling_course_instructor_violations\(p_activity_id, target\.emp_id, false\)/);
  assert.doesNotMatch(revalidation, /instruction_languages|friday_allowed|instructor_availability|cached_travel|effective_meetings/);
  assert.doesNotMatch(sql, /update\s+public\.activities|insert\s+into\s+public\.activities|delete\s+from\s+public\.activities/i);
});

test('obsolete proposed-date cancellation wrapper is removed', async () => {
  const sql = await readFile(legacyCleanupUrl, 'utf8');
  const frontend = await readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
  assert.match(sql, /drop function if exists public\.cancel_course_assignment_draft_with_dates\(text\)/);
  assert.doesNotMatch(frontend, /cancel_course_assignment_draft_with_dates/);
  assert.match(frontend, /rpc\('cancel_course_assignment_draft'/);
});
