import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const connectionString = process.env.PLANNING_INVALIDATION_TEST_DATABASE_URL;
const client = connectionString ? new pg.Client({ connectionString }) : null;

async function sql(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), 'utf8');
}

function selfInvalidationPrefix(source) {
  return source.slice(0, source.indexOf('-- Confirm: refuse stale dirty drafts'));
}

function confirmFunction(source) {
  const start = source.indexOf('create or replace function public.confirm_scheduling_planning_draft(');
  const endMarker = 'grant execute on function public.confirm_scheduling_planning_draft(text, text, text, bigint) to authenticated;';
  const end = source.indexOf(endMarker, start) + endMarker.length;
  return source.slice(start, end);
}

async function resetFixtures() {
  await client.query(`
    truncate public.scheduling_planning_rows, public.scheduling_planning_workspaces,
      public.activities, public.contacts_instructors, public.instructor_availability_exceptions,
      public.instructor_availability_rules, public.instructor_scheduling_profiles restart identity cascade;
    insert into public.scheduling_planning_workspaces(period_key, district) values ('2027', 'north');
    insert into public.activities(
      row_id, activity_season, activity_name, status, sessions, start_date, end_date,
      start_time, end_time, date_1, instruction_language, required_instructor_gender
    ) values
      ('activity-a', 'school_2027', 'Original', 'פתוח', '1', '2027-01-03', '2027-01-03', '10:00', '11:00', '2027-01-03', 'he', 'female'),
      ('activity-b', 'school_2027', 'Other', 'פתוח', '1', '2027-01-10', '2027-01-10', '10:00', '11:00', '2027-01-10', 'he', 'female');
    insert into public.contacts_instructors(emp_id, full_name, active, address)
      values (100, 'Instructor', 'yes', 'Address');
    insert into public.scheduling_planning_rows(workspace_id, activity_id, row_data, locked_option, activity_updated_at)
    select w.id, 'activity-a',
      '{"instructorEmpId":"100","options":[{"instructorEmpId":"100"}]}'::jsonb,
      '{"instructorEmpId":"100","score":"90","meetings":[{"date":"2027-01-03","start_time":"10:00","end_time":"11:00"}]}'::jsonb,
      a.updated_at
    from public.scheduling_planning_workspaces w cross join public.activities a where a.row_id='activity-a';
    insert into public.scheduling_planning_rows(workspace_id, activity_id, row_data)
    select w.id, 'activity-b', '{"instructorEmpId":"200"}'::jsonb
    from public.scheduling_planning_workspaces w;
  `);
}

before(async () => {
  if (!client) return;
  await client.connect();
  await client.query('drop schema if exists public cascade; drop schema if exists auth cascade;');
  await client.query('drop role if exists authenticated;');
  await client.query('create schema public;');
  await client.query(await sql('./fixtures/planning-invalidation-postgres-schema.sql'));
  await client.query(await sql('../supabase/migrations/20260927180000_mark_scheduling_planning_needs_recalc.sql'));
  await client.query(await sql('../supabase/migrations/20260927200000_fix_planning_invalidation_activity_id_ambiguity.sql'));
  const selfInvalidation = await sql('../supabase/migrations/20260927190000_planning_self_invalidation.sql');
  await client.query(selfInvalidationPrefix(selfInvalidation));
  await client.query(await sql('../supabase/migrations/20260929190000_keep_live_planning_rows_out_of_dependency_invalidation.sql'));
  await client.query(await sql('../supabase/migrations/20260930001500_narrow_activity_planning_invalidation.sql'));
  await client.query(confirmFunction(selfInvalidation));
  await client.query("select set_config('test.uid', '11111111-1111-1111-1111-111111111111', false)");
  await client.query("select set_config('test.role', 'admin', false)");
  await client.query("insert into public.users(auth_user_id, role) values ('11111111-1111-1111-1111-111111111111', 'admin')");
});

beforeEach(async () => {
  if (client) await resetFixtures();
});

after(async () => {
  await client?.end();
});

function requirePostgres(t) {
  if (client) return true;
  t.skip('set PLANNING_INVALIDATION_TEST_DATABASE_URL to a disposable PostgreSQL database');
  return false;
}

test('PostgreSQL: scheduling-sensitive activity UPDATE runs the trigger and marks its row', async (t) => {
  if (!requirePostgres(t)) return;
  await client.query("update public.activities set activity_name='Changed' where row_id='activity-a'");
  const { rows: [row] } = await client.query("select needs_recalc from public.scheduling_planning_rows where activity_id='activity-a'");
  assert.equal(row.needs_recalc, true);
});

test('PostgreSQL: notes/contact-only UPDATE is ignored by planning invalidation', async (t) => {
  if (!requirePostgres(t)) return;
  await client.query("update public.activities set notes='note', school_contact_id=1120 where row_id='activity-a'");
  const { rows: [row] } = await client.query("select needs_recalc from public.scheduling_planning_rows where activity_id='activity-a'");
  assert.equal(row.needs_recalc, false);
});

test("PostgreSQL: soft delete status='נמחק' succeeds and invalidates planning", async (t) => {
  if (!requirePostgres(t)) return;
  await client.query("update public.activities set status='נמחק' where row_id='activity-a'");
  const { rows: [row] } = await client.query("select a.status, r.needs_recalc from public.activities a join public.scheduling_planning_rows r on r.activity_id=a.row_id where a.row_id='activity-a'");
  assert.deepEqual(row, { status: 'נמחק', needs_recalc: true });
});

test('PostgreSQL: mark_scheduling_planning_needs_recalc_many handles multiple activity ids', async (t) => {
  if (!requirePostgres(t)) return;
  const { rows: [result] } = await client.query("select public.mark_scheduling_planning_needs_recalc_many(array['activity-a','activity-b'], false) payload");
  assert.deepEqual(result.payload.markedActivityIds.sort(), ['activity-a', 'activity-b']);
});

test('PostgreSQL: confirm_scheduling_planning_draft can update activities through the trigger', async (t) => {
  if (!requirePostgres(t)) return;
  const { rows: [result] } = await client.query("select (public.confirm_scheduling_planning_draft('2027','north','activity-a',1)).emp_id");
  assert.equal(result.emp_id, '100');
});

test('PostgreSQL: availability, profile, and instructor-contact triggers invalidate linked rows', async (t) => {
  if (!requirePostgres(t)) return;
  await client.query("insert into public.instructor_availability_exceptions values (100, '2027-01-03', false, null, null)");
  let result = await client.query("select needs_recalc from public.scheduling_planning_rows where activity_id='activity-a'");
  assert.equal(result.rows[0].needs_recalc, true);
  await client.query("update public.scheduling_planning_rows set needs_recalc=false where activity_id='activity-a'");
  await client.query("insert into public.instructor_scheduling_profiles values (100, 'female', array['he'], 'all', '{}', '{}', '{}')");
  result = await client.query("select needs_recalc from public.scheduling_planning_rows where activity_id='activity-a'");
  assert.equal(result.rows[0].needs_recalc, true);
  await client.query("update public.scheduling_planning_rows set needs_recalc=false where activity_id='activity-a'");
  await client.query("update public.contacts_instructors set address='New address' where emp_id=100");
  result = await client.query("select needs_recalc from public.scheduling_planning_rows where activity_id='activity-a'");
  assert.equal(result.rows[0].needs_recalc, true);
});

test('PostgreSQL: a trigger exception rolls back both the activity and planning writes', async (t) => {
  if (!requirePostgres(t)) return;
  await client.query(`create or replace function public.fail_after_planning_invalidation() returns trigger language plpgsql as $$ begin raise exception 'forced_failure'; end $$`);
  await client.query(`create trigger zz_forced_failure after update on public.activities for each row execute function public.fail_after_planning_invalidation()`);
  await assert.rejects(client.query("update public.activities set activity_name='Rolled back' where row_id='activity-a'"), /forced_failure/);
  await client.query('drop trigger zz_forced_failure on public.activities');
  const { rows: [row] } = await client.query("select a.activity_name, r.needs_recalc from public.activities a join public.scheduling_planning_rows r on r.activity_id=a.row_id where a.row_id='activity-a'");
  assert.deepEqual(row, { activity_name: 'Original', needs_recalc: false });
});


test('PostgreSQL: activity changes do not dirty unrelated live rows sharing an instructor', async (t) => {
  if (!requirePostgres(t)) return;
  await client.query(`update public.scheduling_planning_rows set locked_option=null, row_data='{"kind":"live","instructorEmpId":"100"}'::jsonb where activity_id='activity-b'`);
  await client.query("update public.activities set activity_name='Changed' where row_id='activity-a'");
  const { rows } = await client.query('select activity_id, needs_recalc from public.scheduling_planning_rows order by activity_id');
  assert.deepEqual(rows, [{ activity_id: 'activity-a', needs_recalc: true }, { activity_id: 'activity-b', needs_recalc: false }]);
});

test('PostgreSQL: instructor changes do not dirty live rows', async (t) => {
  if (!requirePostgres(t)) return;
  await client.query(`update public.scheduling_planning_rows set locked_option=null, row_data='{"kind":"live","instructorEmpId":"100"}'::jsonb where activity_id='activity-b'`);
  await client.query("insert into public.instructor_availability_exceptions values (100, '2027-01-10', false, null, null)");
  const { rows } = await client.query("select needs_recalc from public.scheduling_planning_rows where activity_id='activity-b'");
  assert.equal(rows[0].needs_recalc, false);
});

test('PostgreSQL: activity invalidation marks only the changed activity, not rows that merely list the same instructor as an option', async (t) => {
  if (!requirePostgres(t)) return;
  await client.query(`update public.scheduling_planning_rows
    set row_data='{"kind":"proposal","instructorEmpId":"100","options":[{"instructorEmpId":"100"}]}'::jsonb
    where activity_id='activity-b'`);
  await client.query("select public.mark_scheduling_planning_needs_recalc('activity-a', false)");
  const { rows } = await client.query('select activity_id, needs_recalc from public.scheduling_planning_rows order by activity_id');
  assert.deepEqual(rows, [
    { activity_id: 'activity-a', needs_recalc: true },
    { activity_id: 'activity-b', needs_recalc: false }
  ]);
});
