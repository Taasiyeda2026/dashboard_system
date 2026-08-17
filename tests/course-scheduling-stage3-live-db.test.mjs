/**
 * Stage 3 live-Postgres acceptance tests.
 *
 * Prove the four required RPC/DB behaviours by running the actual functions
 * against a real (throwaway) Postgres instance.
 *
 * Opt-in: set SCHEDULING_TEST_DATABASE_URL to a disposable connection string.
 * The test drops and recreates the public schema before every test suite run.
 * NEVER point this at a real / shared database.
 *
 * Without the env var every test is skipped — the suite still counts toward
 * the CI pass/fail total (0 failures, 4 skipped).
 *
 * Migration chain applied (in order):
 *   stub schema → 20260802220000 → 20260802221000 → 20260730170000
 *   → 20260807120000 → 20260807203000 → 20260809180000
 *   → 20260809210000 → 20260810230000 (stage 3 fix)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const connectionString = process.env.SCHEDULING_TEST_DATABASE_URL;

// ─── migration file URLs (applied in the order listed) ───────────────────────

const migrations = [
  '../tests/fixtures/course-scheduling-stub-schema.sql',
  '../supabase/migrations/20260802220000_course_scheduling_interface_schema.sql',
  '../supabase/migrations/20260802221000_course_scheduling_interface_rpcs.sql',
  '../supabase/migrations/20260730170000_course_scheduling_post_edit_revalidation.sql',
  '../supabase/migrations/20260807120000_course_scheduling_proposed_dates.sql',
  '../supabase/migrations/20260807203000_course_scheduling_e2e_alignment.sql',
  '../supabase/migrations/20260809180000_course_scheduling_contract_sync.sql',
  '../supabase/migrations/20260809200000_course_scheduling_legacy_cleanup.sql',
  '../supabase/migrations/20260809210000_manual_instructor_choice_authoritative.sql',
  '../supabase/migrations/20260810204500_course_scheduling_stage2_server_sync.sql',
  '../supabase/migrations/20260810230000_course_scheduling_stage3_validation.sql',
].map(p => new URL(p, import.meta.url));

// ─── database setup ───────────────────────────────────────────────────────────

async function setUpDatabase(client) {
  await client.query('drop schema public cascade; create schema public;');

  // Roles needed by migrations
  for (const role of ['authenticated', 'anon', 'service_role']) {
    await client.query(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${role}') then create role ${role}; end if; end $$;`);
  }

  // school_calendar is referenced by some migrations but not created by any of them.
  // course_meeting_cancellations and course_meeting_instructor_history are created by
  // 20260802221000 and 20260802220000 respectively — do NOT pre-create them here or
  // their "CREATE TABLE IF NOT EXISTS" will silently leave the wrong column layout.
  await client.query(`
    create table if not exists public.school_calendar (
      start_date date, end_date date,
      enforce_end_time boolean not null default false,
      school_day_end_time time,
      is_active boolean not null default true,
      blocks_scheduling boolean not null default false
    );
  `);

  for (const url of migrations) {
    const sql = await readFile(url, 'utf8');
    await client.query(sql);
  }
}

// ─── fixed test fixtures ──────────────────────────────────────────────────────
// Course: 2027-09-06 (Monday DOW=1, verified via psql), 10:00–11:00, school 'school א', authority 'חיפה'.
// Instructor: emp_id=1 'נועה', address='תל אביב', female, Hebrew.
// Availability (base): weekday=1 (Monday), 08:00–17:00.
// Travel cache: תל אביב → 'school א, חיפה' = 5 km.

async function seedFixtures(client) {
  await client.query(`
    insert into public.users (auth_user_id, role, is_active, emp_id)
    values ('11111111-1111-1111-1111-111111111111', 'admin', true, '999');

    insert into public.contacts_instructors (emp_id, full_name, active, address)
    values (1, 'נועה', 'yes', 'תל אביב');

    insert into public.instructor_scheduling_profiles
      (emp_id, gender, instruction_languages, education_levels, course_restriction_mode)
    values (1, 'female', array['he'], array['elementary'], 'all');

    -- Monday (weekday 1) availability: 08:00–17:00
    insert into public.instructor_availability_rules (emp_id, weekday, available, start_time, end_time)
    values (1, 1, true, '08:00', '17:00');

    -- Course: Mon 2027-09-06 (DOW=1), 10:00–11:00
    insert into public.activities (
      row_id, activity_season, activity_type, status,
      start_time, end_time, date_1,
      school, school_id, authority, authority_id,
      instruction_language, required_instructor_gender,
      education_level, activity_no, activity_name
    ) values (
      'course-a', 'school_2027', 'קורס', 'פתוח',
      '10:00', '11:00', '2027-09-06',
      'school א', 100, 'חיפה', 10,
      'he', 'female',
      'elementary', 'A1', 'קורס A'
    );

    -- Travel cache: instructor home → school location (fallback key: 'school א, חיפה')
    insert into public.scheduling_travel_cache
      (origin_key, destination_key, distance_km, duration_minutes, provider, expires_at)
    values
      ('תל אביב', 'school א, חיפה', 5, 10, 'google', now() + interval '365 days');
  `);
}

async function authenticate(client) {
  await client.query("select set_config('test.role', 'admin', false)");
  await client.query("select set_config('test.uid', '11111111-1111-1111-1111-111111111111', false)");
}

async function withFreshDb(fn) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await setUpDatabase(client);
    await seedFixtures(client);
    await authenticate(client);
    await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

// ─── test 1: availability removed → draft-save and confirm both rejected ──────

test('live-db: draft valid → availability removed → confirm-draft (assign_activity_instructor) is rejected', async (t) => {
  if (!connectionString) {
    t.skip('set SCHEDULING_TEST_DATABASE_URL to a disposable Postgres connection string to run this test');
    return;
  }

  await withFreshDb(async (client) => {
    // Step 1: save draft — must succeed while instructor is available.
    const { rows: [draft] } = await client.query(
      'select public.save_course_assignment_draft($1, $2, $3, null, null, null)',
      ['course-a', 1, 'נועה']
    );
    assert.ok(draft, 'draft save must succeed when instructor is eligible');

    // Verify the draft was written.
    const { rows: [activity] } = await client.query(
      "select draft_emp_id from public.activities where row_id='course-a'"
    );
    assert.equal(activity.draft_emp_id, '1', 'draft_emp_id must be set after save');

    // Step 2: remove Monday availability — state changes after the draft was created.
    await client.query('delete from public.instructor_availability_rules where emp_id=1 and weekday=1');

    // Step 3: attempt to confirm the draft — must be rejected with a fresh availability check.
    await assert.rejects(
      client.query(
        "select public.assign_activity_instructor('course-a', 1, 'נועה', 1, 90, 90, 'approved', null)"
      ),
      (err) => {
        assert.match(
          err.message,
          /scheduling_availability_missing|scheduling_instructor_unavailable/,
          `expected availability rejection, got: ${err.message}`
        );
        return true;
      }
    );

    // emp_id must still be null (assignment was never committed).
    const { rows: [after] } = await client.query(
      "select emp_id, instructor_assignment_locked from public.activities where row_id='course-a'"
    );
    assert.equal(after.emp_id, null, 'emp_id must remain null after rejected confirm');
    assert.equal(after.instructor_assignment_locked, false, 'assignment must remain unlocked after rejection');
  });
});

// ─── test 2: conflicting assignment added → confirm rejected ──────────────────

test('live-db: draft valid → conflicting assignment added → confirm-draft is rejected', async (t) => {
  if (!connectionString) {
    t.skip('set SCHEDULING_TEST_DATABASE_URL to a disposable Postgres connection string to run this test');
    return;
  }

  await withFreshDb(async (client) => {
    // Save a draft for course-a (Mon 10:00–11:00).
    await client.query(
      'select public.save_course_assignment_draft($1, $2, $3, null, null, null)',
      ['course-a', 1, 'נועה']
    );

    // Add a second course that overlaps (Mon 10:30–11:30) and assign the same instructor directly.
    await client.query(`
      insert into public.activities (
        row_id, activity_season, activity_type, status,
        start_time, end_time, date_1,
        school, school_id, authority, authority_id,
        instruction_language, required_instructor_gender,
        education_level, activity_no, activity_name,
        emp_id, instructor_name, instructor_assignment_locked, instructor_assignment_status
      ) values (
        'course-b', 'school_2027', 'קורס', 'פתוח',
        '10:30', '11:30', '2027-09-06',
        'school ב', 101, 'חיפה', 10,
        'he', 'female',
        'elementary', 'B1', 'קורס B',
        1, 'נועה', true, 'שובץ'
      );
    `);

    // Attempt to confirm draft for course-a — must fail: instructor is now busy Mon 10:30–11:30.
    await assert.rejects(
      client.query(
        "select public.assign_activity_instructor('course-a', 1, 'נועה', 1, 90, 90, 'approved', null)"
      ),
      (err) => {
        assert.match(
          err.message,
          /scheduling_conflict_detected/,
          `expected conflict rejection, got: ${err.message}`
        );
        return true;
      }
    );
  });
});

// ─── test 3: valid assignment → saved successfully ────────────────────────────

test('live-db: valid unchanged assignment → assign_activity_instructor succeeds', async (t) => {
  if (!connectionString) {
    t.skip('set SCHEDULING_TEST_DATABASE_URL to a disposable Postgres connection string to run this test');
    return;
  }

  await withFreshDb(async (client) => {
    // Confirm a clean assignment without any state changes between draft and confirm.
    const { rows: [result] } = await client.query(
      "select public.assign_activity_instructor('course-a', 1, 'נועה', 1, 90, 90, 'approved', null)"
    );
    assert.ok(result, 'assign_activity_instructor must return the updated activity');

    const { rows: [after] } = await client.query(
      "select emp_id, instructor_name, instructor_assignment_locked, instructor_assignment_status from public.activities where row_id='course-a'"
    );
    assert.equal(String(after.emp_id), '1', 'emp_id must be set');
    assert.equal(after.instructor_name, 'נועה', 'instructor_name must be set');
    assert.equal(after.instructor_assignment_locked, true, 'assignment must be locked');
    assert.equal(after.instructor_assignment_status, 'שובץ', "status must be 'שובץ'");
  });
});

// ─── test 4: activity edit invalidates assignment → edit saved, emp_id kept,  ─
//             status → 'נדרש טיפול'                                             ─

test("live-db: activity edit invalidates existing assignment → edit saved, emp_id kept, status = 'נדרש טיפול'", async (t) => {
  if (!connectionString) {
    t.skip('set SCHEDULING_TEST_DATABASE_URL to a disposable Postgres connection string to run this test');
    return;
  }

  await withFreshDb(async (client) => {
    // Assign instructor to course-a (locked, status = 'שובץ').
    await client.query(
      "select public.assign_activity_instructor('course-a', 1, 'נועה', 1, 90, 90, 'approved', null)"
    );

    const { rows: [before] } = await client.query(
      "select emp_id, instructor_name, instructor_assignment_status from public.activities where row_id='course-a'"
    );
    assert.equal(String(before.emp_id), '1', 'precondition: emp_id set');
    assert.equal(before.instructor_assignment_status, 'שובץ', "precondition: status 'שובץ'");

    // Remove Monday availability — instructor is no longer eligible.
    await client.query('delete from public.instructor_availability_rules where emp_id=1 and weekday=1');

    // Edit a scheduling-sensitive field on the activity.
    // The activities_revalidate_locked_assignment AFTER UPDATE trigger fires and calls
    // scheduling_apply_course_assignment_revalidation(), which reads fresh availability data,
    // finds the violation, and sets instructor_assignment_status = 'נדרש טיפול'.
    // The edit itself is NOT blocked (AFTER trigger, not BEFORE).
    await client.query(
      "update public.activities set activity_name='קורס A מעודכן' where row_id='course-a'"
    );

    const { rows: [after] } = await client.query(
      "select emp_id, instructor_name, instructor_assignment_locked, instructor_assignment_status from public.activities where row_id='course-a'"
    );

    // Edit saved: instructor identity preserved.
    assert.equal(String(after.emp_id), '1', 'emp_id must remain after edit');
    assert.equal(after.instructor_name, 'נועה', 'instructor_name must remain after edit');
    assert.equal(after.instructor_assignment_locked, true, 'assignment must remain locked');

    // Revalidation detected the violation: status changed to 'נדרש טיפול'.
    assert.equal(
      after.instructor_assignment_status,
      'נדרש טיפול',
      "status must be 'נדרש טיפול' after edit invalidates the assignment"
    );
  });
});

// ─── test 5: proposed dates override — official Saturday, proposed Monday ─────
// The official date is a Saturday (DOW=6, no availability) but the proposed meetings
// list a valid Monday.  save_course_assignment_draft_with_dates must use the proposed
// dates for the violations check and succeed.

test('live-db: proposed dates (Monday) override invalid official date (Saturday) → draft saved', async (t) => {
  if (!connectionString) {
    t.skip('set SCHEDULING_TEST_DATABASE_URL to a disposable Postgres connection string to run this test');
    return;
  }

  await withFreshDb(async (client) => {
    // Insert a course whose only official date is Saturday 2027-09-04 (DOW=6).
    // With official dates the violations check would fail (Saturday blocked).
    await client.query(`
      insert into public.activities (
        row_id, activity_season, activity_type, status,
        start_time, end_time, date_1,
        school, school_id, authority, authority_id,
        instruction_language, required_instructor_gender,
        education_level, activity_no, activity_name
      ) values (
        'course-pd', 'school_2027', 'קורס', 'פתוח',
        '10:00', '11:00', '2027-09-04',
        'school א', 100, 'חיפה', 10,
        'he', 'female',
        'elementary', 'PD1', 'קורס Proposed Dates'
      );
    `);

    // Proposed meetings: the same count (1) but date shifted to Monday 2027-09-06.
    const proposedMeetings = JSON.stringify([{ date: '2027-09-06' }]);

    const { rows: [result] } = await client.query(
      'select public.save_course_assignment_draft_with_dates($1, $2, $3, $4::jsonb, null, null, null)',
      ['course-pd', 1, 'נועה', proposedMeetings]
    );
    assert.ok(result, 'draft save must succeed when proposed dates are valid even if official date is Saturday');

    const { rows: [saved] } = await client.query(
      "select draft_emp_id, draft_proposed_meetings from public.activities where row_id='course-pd'"
    );
    assert.equal(saved.draft_emp_id, '1', 'draft_emp_id must be written');
    assert.ok(saved.draft_proposed_meetings, 'draft_proposed_meetings must be written');
    const meetings = typeof saved.draft_proposed_meetings === 'string'
      ? JSON.parse(saved.draft_proposed_meetings)
      : saved.draft_proposed_meetings;
    assert.equal(meetings[0]?.date, '2027-09-06', 'canonical proposed date must be the Monday date');
  });
});

// ─── test 6: proposed dates — official date valid but proposed creates conflict ─
// The official date is a valid Monday but the proposed meetings select a different
// Monday on which the instructor already has a locked assignment.
// save_course_assignment_draft_with_dates must fail with scheduling_conflict_detected.

test('live-db: proposed dates valid-officially but conflicting → draft rejected', async (t) => {
  if (!connectionString) {
    t.skip('set SCHEDULING_TEST_DATABASE_URL to a disposable Postgres connection string to run this test');
    return;
  }

  await withFreshDb(async (client) => {
    // seed instructor availability for the second Monday (2027-09-13) too — same rule covers it.
    // (weekday=1 rule already covers all Mondays; no extra insert needed.)

    // Insert course-pd with a valid official Monday 2027-09-06.
    await client.query(`
      insert into public.activities (
        row_id, activity_season, activity_type, status,
        start_time, end_time, date_1,
        school, school_id, authority, authority_id,
        instruction_language, required_instructor_gender,
        education_level, activity_no, activity_name
      ) values (
        'course-pd', 'school_2027', 'קורס', 'פתוח',
        '10:00', '11:00', '2027-09-06',
        'school א', 100, 'חיפה', 10,
        'he', 'female',
        'elementary', 'PD2', 'קורס Proposed Dates 2'
      );
    `);

    // Add a locked assignment for the same instructor on the NEXT Monday 2027-09-13.
    await client.query(`
      insert into public.activities (
        row_id, activity_season, activity_type, status,
        start_time, end_time, date_1,
        school, school_id, authority, authority_id,
        instruction_language, required_instructor_gender,
        education_level, activity_no, activity_name,
        emp_id, instructor_name, instructor_assignment_locked, instructor_assignment_status
      ) values (
        'course-conflict', 'school_2027', 'קורס', 'פתוח',
        '10:00', '11:00', '2027-09-13',
        'school א', 100, 'חיפה', 10,
        'he', 'female',
        'elementary', 'CF1', 'קורס מתנגש',
        1, 'נועה', true, 'שובץ'
      );
    `);

    // Propose to move course-pd to 2027-09-13 — the same day course-conflict is locked.
    const proposedMeetings = JSON.stringify([{ date: '2027-09-13' }]);

    await assert.rejects(
      client.query(
        'select public.save_course_assignment_draft_with_dates($1, $2, $3, $4::jsonb, null, null, null)',
        ['course-pd', 1, 'נועה', proposedMeetings]
      ),
      (err) => {
        assert.match(
          err.message,
          /scheduling_conflict_detected/,
          `expected conflict rejection on proposed date, got: ${err.message}`
        );
        return true;
      }
    );

    // No draft must have been committed — the transaction must have rolled back.
    const { rows: [state] } = await client.query(
      "select draft_emp_id, draft_proposed_meetings from public.activities where row_id='course-pd'"
    );
    assert.equal(state.draft_emp_id, null, 'draft_emp_id must remain null after rejected draft');
    assert.equal(state.draft_proposed_meetings, null, 'draft_proposed_meetings must remain null after rejection');
  });
});
