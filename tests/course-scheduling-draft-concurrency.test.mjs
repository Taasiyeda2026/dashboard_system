import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

// Real-transaction proof that pg_advisory_xact_lock actually serializes concurrent
// scheduling writes for the same instructor (see scheduling_lock_instructor_for_write()
// in supabase/migrations/20260802220000_course_scheduling_interface_schema.sql). A
// text/regex check on the SQL source cannot prove this — only two genuinely concurrent
// database transactions racing against each other can.
//
// Opt-in: set SCHEDULING_TEST_DATABASE_URL to a reachable, DISPOSABLE Postgres connection
// string to run it. The test resets the "public" schema of that database before seeding
// its own minimal fixtures and applying the two real course-scheduling migrations, so it
// must never point at a real/shared database. Without the env var this file is skipped —
// it is not part of the default `node --test` run.
const connectionString = process.env.SCHEDULING_TEST_DATABASE_URL;

async function setUpDatabase(client) {
  await client.query('drop schema public cascade; create schema public;');
  const stub = await readFile(new URL('./fixtures/course-scheduling-stub-schema.sql', import.meta.url), 'utf8');
  await client.query(stub);
  for (const roleName of ['authenticated', 'anon', 'service_role']) {
    await client.query(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${roleName}') then create role ${roleName}; end if; end $$;`);
  }
  const schemaMigration = await readFile(new URL('../supabase/migrations/20260802220000_course_scheduling_interface_schema.sql', import.meta.url), 'utf8');
  await client.query(schemaMigration);
  const rpcMigration = await readFile(new URL('../supabase/migrations/20260802221000_course_scheduling_interface_rpcs.sql', import.meta.url), 'utf8');
  await client.query(rpcMigration);
  await client.query('create table if not exists public.school_calendar (start_date date, end_date date, is_active boolean, blocks_scheduling boolean)');
  const proposedDatesMigration = await readFile(new URL('../supabase/migrations/20260807120000_course_scheduling_proposed_dates.sql', import.meta.url), 'utf8');
  await client.query(proposedDatesMigration);
}

async function seedFixtures(client) {
  await client.query("insert into public.users (auth_user_id, role, is_active, emp_id) values ('11111111-1111-1111-1111-111111111111', 'admin', true, '999')");
  await client.query("insert into public.contacts_instructors (emp_id, full_name, active, address) values (1, 'נועה', 'yes', 'חיפה')");
  await client.query("insert into public.instructor_scheduling_profiles (emp_id, gender, instruction_languages, education_levels, course_restriction_mode) values (1, 'female', array['he'], array['elementary'], 'all')");
  await client.query('insert into public.instructor_availability_rules (emp_id, weekday, available, start_time, end_time) select 1, weekday, true, \'08:00\', \'20:00\' from generate_series(0, 4) as weekday');
  // Same date, overlapping times, different schools — a genuine double-booking if both land.
  await client.query(`insert into public.activities (row_id, activity_season, activity_type, status, start_time, end_time, date_1, school, school_id, authority, authority_id, instruction_language, required_instructor_gender, education_level, activity_no, activity_name)
    values ('course-a', 'school_2027', 'קורס', 'פתוח', '10:00', '11:00', '2027-09-01', 'בית ספר א', 100, 'חיפה', 10, 'he', 'female', 'elementary', 'A1', 'קורס A')`);
  await client.query(`insert into public.activities (row_id, activity_season, activity_type, status, start_time, end_time, date_1, school, school_id, authority, authority_id, instruction_language, required_instructor_gender, education_level, activity_no, activity_name)
    values ('course-b', 'school_2027', 'קורס', 'פתוח', '10:30', '11:30', '2027-09-01', 'בית ספר ב', 101, 'חיפה', 10, 'he', 'female', 'elementary', 'B1', 'קורס B')`);
}

async function authenticate(client) {
  await client.query("select set_config('test.role', 'admin', false)");
  await client.query("select set_config('test.uid', '11111111-1111-1111-1111-111111111111', false)");
}

async function waitUntilBothWaitingOnTheLock(pool, pids, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await pool.query(
      "select count(*)::int as n from pg_stat_activity where pid = any($1) and wait_event_type = 'Lock' and wait_event = 'advisory'",
      [pids]
    );
    if (Number(rows[0].n) >= pids.length) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('timed out waiting for both concurrent draft saves to queue on the instructor advisory lock');
}

test('two concurrent draft saves for overlapping courses on the same instructor: only one succeeds', async (t) => {
  if (!connectionString) {
    t.skip('set SCHEDULING_TEST_DATABASE_URL to a disposable Postgres connection string to run this test');
    return;
  }

  const pool = new pg.Pool({ connectionString, max: 5 });
  try {
    const setupClient = await pool.connect();
    try {
      await setUpDatabase(setupClient);
      await seedFixtures(setupClient);
    } finally {
      setupClient.release();
    }

    const controlClient = await pool.connect();
    const clientA = await pool.connect();
    const clientB = await pool.connect();
    try {
      await Promise.all([authenticate(controlClient), authenticate(clientA), authenticate(clientB)]);

      // Hold the exact same instructor-scoped advisory lock the RPC takes, so both real
      // attempts below are guaranteed to be queued behind it (not just started close
      // together) before we release it and let them race for real.
      await controlClient.query('begin');
      await controlClient.query("select pg_advisory_xact_lock(hashtext('course_scheduling_instructor'), hashtext('1'))");

      const attempt = (client, activityId) => client.query(
        'select public.save_course_assignment_draft($1, $2, $3, null, null, null)',
        [activityId, 1, 'נועה']
      );
      const pending = Promise.allSettled([attempt(clientA, 'course-a'), attempt(clientB, 'course-b')]);

      await waitUntilBothWaitingOnTheLock(pool, [clientA.processID, clientB.processID]);
      await controlClient.query('commit'); // release the control lock; A and B now serialize.

      const [resultA, resultB] = await pending;
      const succeeded = [resultA, resultB].filter((r) => r.status === 'fulfilled');
      const failed = [resultA, resultB].filter((r) => r.status === 'rejected');

      assert.equal(succeeded.length, 1, `expected exactly one of the two overlapping concurrent drafts to succeed, got ${succeeded.length}`);
      assert.equal(failed.length, 1);
      assert.match(String(failed[0].reason?.message || ''), /scheduling_conflict_detected/);

      const { rows: drafts } = await pool.query("select row_id, draft_emp_id from public.activities where row_id in ('course-a', 'course-b') and draft_emp_id is not null");
      assert.equal(drafts.length, 1, 'exactly one of the two overlapping courses should end up with a saved draft');
    } finally {
      controlClient.release();
      clientA.release();
      clientB.release();
    }
  } finally {
    await pool.end();
  }
});

test('proposed-date migration enforces meeting counts and scopes the multi-instructor trigger', async (t) => {
  if (!connectionString) {
    t.skip('set SCHEDULING_TEST_DATABASE_URL to a disposable Postgres connection string to run this test');
    return;
  }
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    await setUpDatabase(client);
    await seedFixtures(client);
    await authenticate(client);
    await client.query("insert into public.contacts_instructors (emp_id,full_name,active,address) values (2,'דנה','yes','חיפה')");
    await client.query("update public.activities set date_2='2027-09-08',date_3='2027-09-15',date_4='2027-09-22',date_5='2027-09-29',date_6='2027-10-06',date_7='2027-10-13',date_8='2027-10-20',date_9='2027-10-27',date_10='2027-11-03',date_11='2027-11-10' where row_id='course-a'");
    const dates=(count)=>Array.from({length:count},(_,index)=>({date:new Date(Date.UTC(2027,8,1+index*7)).toISOString().slice(0,10)}));
    await assert.rejects(client.query('select public.scheduling_validate_proposed_meetings($1,$2::jsonb)',['course-a',JSON.stringify(dates(10))]),/scheduling_proposed_meeting_count_mismatch/);
    await assert.rejects(client.query('select public.scheduling_validate_proposed_meetings($1,$2::jsonb)',['course-a',JSON.stringify(dates(12))]),/scheduling_proposed_meeting_count_mismatch/);
    const accepted=await client.query('select public.scheduling_validate_proposed_meetings($1,$2::jsonb) value',['course-a',JSON.stringify(dates(11))]);
    assert.equal(accepted.rows[0].value.length,11);

    for (const [id,type,season,status] of [['workshop','סדנה','school_2027','פתוח'],['tour','סיור','school_2027','פתוח'],['old-course','קורס','school_2026','פתוח'],['closed-course','קורס','school_2027','סגור']]) {
      await client.query(`insert into public.activities(row_id,activity_season,activity_type,status,start_time,end_time,date_1,school,activity_name) values($1,$2,$3,$4,'10:00','11:00','2027-09-01','אחר',$1)`,[id,season,type,status]);
      await client.query('update public.activities set emp_id=1 where row_id=$1',[id]);
    }
    await client.query("update public.activities set emp_id=2 where row_id='course-b'");
    await assert.rejects(client.query("update public.activities set emp_id_2=1 where row_id='course-b'"),/scheduling_conflict_detected/);
  } finally {
    await client.end().catch(()=>{});
  }
});
