import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

// Disposable localhost database only. The migration is applied to a minimal
// schema containing just the tables the invalidation trigger touches.
const connectionString = process.env.PLANNING_INVALIDATION_TEST_DATABASE_URL;
if (connectionString) {
  const url = new URL(connectionString);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error('Use a disposable localhost database');
  }
}
// CI sets PLANNING_INVALIDATION_REQUIRE_DB=1 so a missing database fails the job instead of skipping.
if (!connectionString && process.env.PLANNING_INVALIDATION_REQUIRE_DB === '1') {
  throw new Error('PLANNING_INVALIDATION_TEST_DATABASE_URL is required in CI');
}
const client = connectionString ? new pg.Client({ connectionString }) : null;
const required = (t) => {
  if (client) return true;
  t.skip('Set PLANNING_INVALIDATION_TEST_DATABASE_URL to a disposable local PostgreSQL database');
  return false;
};
const migration = await readFile(new URL('../supabase/migrations/20261009031000_planning_precise_invalidation.sql', import.meta.url), 'utf8');
const migrationSource = migration;

const schema = `
drop schema if exists public cascade;
create schema public;
create table public.scheduling_planning_source_state (singleton boolean primary key default true, revision bigint not null default 0, updated_at timestamptz);
insert into public.scheduling_planning_source_state default values;
create table public.scheduling_planning_rows (
  workspace_id uuid not null, activity_id text not null, row_data jsonb not null default '{}',
  needs_recalc boolean not null default false, primary key (workspace_id, activity_id));
create table public.scheduling_planning_workspaces (id uuid primary key, period_key text, district text, engine_version text, data_fingerprint text,
  context_fingerprint text, calculated_at timestamptz, updated_at timestamptz, updated_by uuid, revision bigint not null default 0);
create table public.scheduling_planning_run_leases (period_key text not null, district text not null default '', run_id uuid not null,
  owner_id uuid not null, acquired_at timestamptz not null default now(), heartbeat_at timestamptz not null default now(),
  expires_at timestamptz not null, primary key (period_key, district));
create table public.activities (row_id text primary key, school_id text, authority_id text, school text, authority text);
create table public.contacts_instructors (emp_id bigint primary key, active text, address text, seniority_years int, phone text);
create table public.instructor_scheduling_profiles (emp_id bigint primary key, default_start_time time not null default '08:00',
  default_end_time time not null default '15:00', friday_allowed boolean not null default false, notes text, updated_at timestamptz default now(), updated_by uuid);
create table public.instructor_availability_rules (id serial primary key, emp_id bigint not null, weekday smallint not null, available boolean not null default true,
  start_time time, end_time time, notes text, updated_at timestamptz default now(), updated_by uuid);
create table public.instructor_availability_exceptions (id serial primary key, emp_id bigint not null, exception_date date not null, available boolean not null default false,
  start_time time, end_time time, notes text, updated_at timestamptz default now(), updated_by uuid);
create function public.scheduling_planning_source_activity_payload(jsonb) returns jsonb language sql immutable as 'select $1';
create function public.scheduling_planning_route_affects_row(public.scheduling_planning_rows, text[]) returns boolean language sql immutable as 'select false';
`;
const attach = `
create trigger t_contacts after insert or update or delete on public.contacts_instructors for each row execute function public.scheduling_track_planning_source_change();
create trigger t_profiles after insert or update or delete on public.instructor_scheduling_profiles for each row execute function public.scheduling_track_planning_source_change();
create trigger t_rules after insert or update or delete on public.instructor_availability_rules for each row execute function public.scheduling_track_planning_source_change();
create trigger t_exceptions after insert or update or delete on public.instructor_availability_exceptions for each row execute function public.scheduling_track_planning_source_change();
`;
const ws = '00000000-0000-4000-8000-000000000001';

async function resetRows() {
  await client.query(`truncate public.scheduling_planning_rows`);
  await client.query(`insert into public.scheduling_planning_rows(workspace_id, activity_id, row_data) values
    ($1,'missing-1','{"kind":"missing"}'), ($1,'recruit-1','{"kind":"recruitment"}'), ($1,'proposal-1','{"kind":"proposal"}')`, [ws]);
}
const dirtyIds = async () => (await client.query(
  `select activity_id from public.scheduling_planning_rows where needs_recalc order by activity_id`
)).rows.map((row) => row.activity_id);
const revision = async () => Number((await client.query(`select revision from public.scheduling_planning_source_state`)).rows[0].revision);

before(async () => {
  if (!client) return;
  await client.connect();
  await client.query(schema);
  await client.query(`do $$ begin
    if not exists (select from pg_roles where rolname='anon') then create role anon; end if;
    if not exists (select from pg_roles where rolname='authenticated') then create role authenticated; end if;
  end $$;`);
  await client.query(migration);
  await client.query(attach);
  await client.query(`insert into public.contacts_instructors values (1,'yes','כתובת',3,'050'), (2,'no','כתובת',1,'052')`);
  await client.query(`insert into public.instructor_scheduling_profiles(emp_id) values (1)`);
  await client.query(`insert into public.instructor_availability_rules(emp_id, weekday, available, start_time, end_time) values (1, 1, true, '08:00', '15:00')`);
});
after(async () => { if (client) await client.end(); });

async function expectMarks(t, statement, expected, { bumps = true } = {}) {
  await resetRows();
  const rev = await revision();
  await client.query(statement);
  assert.deepEqual(await dirtyIds(), expected, statement);
  assert.equal(await revision() > rev, bumps, `source revision bump for: ${statement}`);
}

test('notes-only and capacity-reducing instructor edits keep the fence but do not flag missing/recruitment', async (t) => {
  if (!required(t)) return;
  await expectMarks(t, `update public.instructor_scheduling_profiles set notes='הערה' where emp_id=1`, []);
  await expectMarks(t, `update public.instructor_scheduling_profiles set default_end_time='14:00' where emp_id=1`, []);
  await expectMarks(t, `update public.instructor_availability_rules set available=false, start_time=null, end_time=null where emp_id=1 and weekday=1`, []);
  await expectMarks(t, `insert into public.instructor_availability_exceptions(emp_id, exception_date, available) values (1, '2026-11-02', false)`, []);
  await expectMarks(t, `update public.contacts_instructors set active='no' where emp_id=1`, []);
  await expectMarks(t, `update public.contacts_instructors set address='כתובת חדשה' where emp_id=2`, []);
});

test('edits that can add capacity still flag missing/recruitment so a newly suitable instructor is found', async (t) => {
  if (!required(t)) return;
  await expectMarks(t, `update public.contacts_instructors set active='yes' where emp_id=1`, ['missing-1', 'recruit-1']);
  await expectMarks(t, `update public.contacts_instructors set address='כתובת אחרת' where emp_id=1`, ['missing-1', 'recruit-1']);
  await expectMarks(t, `update public.instructor_scheduling_profiles set default_end_time='17:00' where emp_id=1`, ['missing-1', 'recruit-1']);
  await expectMarks(t, `update public.instructor_scheduling_profiles set friday_allowed=true where emp_id=1`, ['missing-1', 'recruit-1']);
  await expectMarks(t, `update public.instructor_availability_rules set available=true, start_time='08:00', end_time='16:00' where emp_id=1 and weekday=1`, ['missing-1', 'recruit-1']);
  await expectMarks(t, `insert into public.instructor_availability_rules(emp_id, weekday, available, start_time, end_time) values (1, 2, true, '08:00', '15:00')`, ['missing-1', 'recruit-1']);
  await expectMarks(t, `delete from public.instructor_availability_exceptions where emp_id=1 and exception_date='2026-11-02'`, ['missing-1', 'recruit-1']);
  await expectMarks(t, `insert into public.contacts_instructors values (3,'yes','כתובת',0,'053')`, ['missing-1', 'recruit-1']);
});

test('irrelevant contact edits stay invisible to planning', async (t) => {
  if (!required(t)) return;
  await expectMarks(t, `update public.contacts_instructors set phone='054' where emp_id=1`, [], { bumps: false });
});

test('every needs_recalc flag records when it was set; saves that clear it keep the last time', async (t) => {
  if (!required(t)) return;
  await resetRows();
  await client.query(`update public.scheduling_planning_rows set needs_recalc=true where activity_id='proposal-1'`);
  const first = (await client.query(`select needs_recalc_marked_at from public.scheduling_planning_rows where activity_id='proposal-1'`)).rows[0].needs_recalc_marked_at;
  assert.ok(first instanceof Date);
  await client.query(`select pg_sleep(0.01)`);
  // Re-flagging an already dirty row refreshes the time: the rebase uses this.
  await client.query(`update public.scheduling_planning_rows set needs_recalc=true where activity_id='proposal-1'`);
  const second = (await client.query(`select needs_recalc_marked_at from public.scheduling_planning_rows where activity_id='proposal-1'`)).rows[0].needs_recalc_marked_at;
  assert.ok(second > first);
  await client.query(`update public.scheduling_planning_rows set needs_recalc=false where activity_id='proposal-1'`);
  const cleared = (await client.query(`select needs_recalc, needs_recalc_marked_at from public.scheduling_planning_rows where activity_id='proposal-1'`)).rows[0];
  assert.equal(cleared.needs_recalc, false);
  assert.equal(cleared.needs_recalc_marked_at.getTime(), second.getTime());
});

test('a run never clears flags set after it started (route-cache insert without revision bump)', async (t) => {
  if (!required(t)) return;
  await resetRows();
  await client.query(`delete from public.scheduling_planning_workspaces; delete from public.scheduling_planning_run_leases`);
  await client.query(`insert into public.scheduling_planning_workspaces(id, period_key, district) values ($1, 'year', '')`, [ws]);
  // missing-1: flagged before this migration (no flag time). recruit-1: flagged before the run.
  await client.query(`alter table public.scheduling_planning_rows disable trigger scheduling_planning_rows_stamp_recalc`);
  await client.query(`update public.scheduling_planning_rows set needs_recalc=true where activity_id='missing-1'`);
  await client.query(`alter table public.scheduling_planning_rows enable trigger scheduling_planning_rows_stamp_recalc`);
  await client.query(`update public.scheduling_planning_rows set needs_recalc=true where activity_id='recruit-1'`);
  await client.query(`select pg_sleep(0.01)`);
  await client.query(`insert into public.scheduling_planning_run_leases(period_key, district, run_id, owner_id, acquired_at, expires_at)
    values ('year', '', gen_random_uuid(), gen_random_uuid(), clock_timestamp(), clock_timestamp() + interval '2 minutes')`);
  await client.query(`select pg_sleep(0.01)`);
  // While the run calculates, a new route lands in the cache and flags proposal-1.
  await client.query(`update public.scheduling_planning_rows set needs_recalc=true where activity_id='proposal-1'`);
  const revisionBefore = await revision();
  // The run's commit writes every row with needs_recalc=false.
  await client.query(`update public.scheduling_planning_rows set needs_recalc=false`);
  assert.deepEqual(await dirtyIds(), ['proposal-1'], 'only the flag raised during the run survives');
  assert.equal(await revision(), revisionBefore, 'no source revision involved');
  // Without an active run (lease expired), an ordinary save clears normally.
  await client.query(`update public.scheduling_planning_run_leases set expires_at = clock_timestamp() - interval '1 second'`);
  await client.query(`update public.scheduling_planning_rows set needs_recalc=false`);
  assert.deepEqual(await dirtyIds(), []);
});

test('migration is additive and exposes the flag time to the planning workspace', () => {
  assert.match(migrationSource, /add column if not exists needs_recalc_marked_at timestamptz/);
  assert.doesNotMatch(migrationSource, /\b(drop table|truncate|delete from public\.scheduling_planning)/i);
  assert.match(migrationSource, /'needsRecalcMarkedAt', r\.needs_recalc_marked_at/);
  assert.match(migrationSource, /update public\.scheduling_planning_source_state\s+set revision=revision\+1/);
});
