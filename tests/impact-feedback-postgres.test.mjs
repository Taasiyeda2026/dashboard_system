import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

// Disposable database only: the test drops and recreates the public schema.
const connectionString = process.env.IMPACT_FEEDBACK_TEST_DATABASE_URL;

const ADMIN = '11111111-1111-1111-1111-111111111111';
const MANAGER = '22222222-2222-2222-2222-222222222222';
const MIGRATIONS = [
  '../supabase/migrations/20261008120000_impact_feedback_schema.sql',
  '../supabase/migrations/20261008120500_impact_feedback_seed.sql',
  '../supabase/migrations/20261008124500_instructor_feedback_per_program.sql'
];

async function asRole(client, role, uid = '') {
  await client.query('reset role');
  await client.query("select set_config('test.uid', $1, false)", [uid]);
  if (role) await client.query(`set role ${role}`);
}

function uuid(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function answerAll(questions, overrides = {}) {
  const answers = {};
  for (const q of questions) {
    if (q.type === 'rating_1_5') answers[q.id] = 4;
    else if (q.type === 'yes_no') answers[q.id] = true;
    else if (q.type === 'single_select') answers[q.id] = q.options[0].value;
    else if (q.type === 'multi_select') answers[q.id] = [q.options[0].value];
    else if (q.type === 'free_text') answers[q.id] = 'טקסט חופשי';
  }
  return { ...answers, ...overrides };
}

async function resetSchema(client) {
  await client.query('drop schema if exists public cascade; drop schema if exists private cascade; drop schema if exists auth cascade; create schema public;');
  await client.query(await readFile(new URL('./fixtures/impact-feedback-stub-schema.sql', import.meta.url), 'utf8'));
  for (const file of MIGRATIONS) await client.query(await readFile(new URL(file, import.meta.url), 'utf8'));
}

test('impact feedback DB contract: admin-only management, token-only public flow, versioning', async (t) => {
  if (!connectionString) {
    t.skip('set IMPACT_FEEDBACK_TEST_DATABASE_URL to a disposable Postgres database to run the impact feedback contract');
    return;
  }
  const client = new pg.Client({ connectionString });
  await client.connect();
  const rpc = async (sql, params = []) => (await client.query(sql, params)).rows[0];
  try {
    await resetSchema(client);
    // Idempotent re-run must not duplicate content or fail.
    for (const file of MIGRATIONS) await client.query(await readFile(new URL(file, import.meta.url), 'utf8'));

    await client.query(`insert into users values ('admin',$1,'admin',true,'{}'),('ops',$2,'operation_manager',true,'{}')`, [ADMIN, MANAGER]);
    await client.query(`insert into contacts_schools (id, school, contact_name, phone, mobile, email) values (7, 'בית ספר אלון', 'רונית כהן', '03-5555555', '050-1234567', 'ronit@example.test')`);
    await client.query(`insert into contacts_instructors values (1501, 'דנה לוי', '052-7654321', 'dana@example.test', 'פעיל')`);
    await client.query(`insert into activities (row_id, activity_season, activity_type, activity_name, authority, authority_id, school, school_id, grade, emp_id, instructor_name, instructor_assignment_locked, instructor_assignment_status, start_date, end_date, school_contact_id)
      values ('ACT-1','school_2027','course','פורצות דרך וצועדות קדימה','חיפה',10,'בית ספר אלון',20,'ח''','1501','דנה לוי',true,'שובץ','2026-10-01','2027-03-01',7),
             ('ACT-2','school_2027','course','סודות ויסודות הבינה המלאכותית','חיפה',10,'בית ספר אורן',21,'ב׳',null,null,'2026-10-01','',null),
             ('ACT-3','school_2027','course','סדנת פיזיקה',null,null,'בית ספר',22,'ה',null,null,null,null,null)`);

    // --- Permissions -------------------------------------------------------
    await asRole(client, 'anon');
    await assert.rejects(client.query('select * from feedback_campaigns'), /permission denied/);
    await assert.rejects(client.query('select * from feedback_answers'), /permission denied/);
    await assert.rejects(client.query("select feedback_admin_open_campaign('ACT-1','student','pre')"), /permission denied/);

    await asRole(client, 'authenticated', MANAGER);
    await assert.rejects(client.query("select feedback_admin_open_campaign('ACT-1','student','pre')"), /feedback_forbidden/);
    await assert.rejects(client.query('select * from feedback_admin_groups()'), /feedback_forbidden/);
    await assert.rejects(client.query("select * from feedback_admin_instructor_assignments('school_2027')"), /feedback_forbidden/);
    assert.equal((await client.query('select count(*)::int n from feedback_templates')).rows[0].n, 0, 'RLS hides templates from non-admin');

    // --- Admin opens student PRE ---------------------------------------------
    await asRole(client, 'authenticated', ADMIN);
    const groups = (await client.query("select * from feedback_admin_groups('school_2027')")).rows;
    assert.deepEqual(groups.map((g) => [g.row_id, g.program_key, g.program_source, g.age_band]).sort(), [
      ['ACT-1', 'trailblazers', 'name', 'g_i'],
      ['ACT-2', 'ai_foundations', 'name', 'a_c'],
      ['ACT-3', null, null, 'd_f']
    ], 'unrecognised course activities stay visible with program_key = null');
    const pre = (await rpc("select feedback_admin_open_campaign('ACT-1','student','pre') c")).c;
    assert.equal(pre.program_key, 'trailblazers');
    assert.equal(pre.age_band, 'g_i');
    assert.match(pre.public_token, /^[A-Za-z0-9_-]{40,}$/);
    const preAgain = (await rpc("select feedback_admin_open_campaign('ACT-1','student','pre') c")).c;
    assert.equal(preAgain.id, pre.id, 'opening the same slot twice is idempotent');
    const snapshot = (await rpc('select school_name, authority_name, grade, instructor_name, contact_name, academic_year, activity_start_date::text d from feedback_campaigns where id=$1', [pre.id]));
    assert.deepEqual(snapshot, { school_name: 'בית ספר אלון', authority_name: 'חיפה', grade: "ח'", instructor_name: 'דנה לוי', contact_name: 'רונית כהן', academic_year: 'school_2027', d: '2026-10-01' });
    await assert.rejects(client.query("select feedback_admin_open_campaign('ACT-3','student','pre')"), /feedback_program_unresolved/);
    await assert.rejects(client.query("select feedback_admin_open_campaign('ACT-1','student','final')"), /feedback_invalid_stage/);

    // --- Public student flow (anon) -----------------------------------------
    await asRole(client, 'anon');
    assert.equal((await rpc("select feedback_public_get('short') r")).r.state, 'invalid');
    assert.equal((await rpc(`select feedback_public_get('${'x'.repeat(43)}') r`)).r.state, 'invalid');
    const form = (await rpc('select feedback_public_get($1) r', [pre.public_token])).r;
    assert.equal(form.state, 'ok');
    assert.equal(form.program_title, 'פורצות דרך');
    assert.equal(form.questions.length, 10);
    assert.ok(form.questions.every((q) => !q.text.includes('{topic}')));
    assert.equal(JSON.stringify(form).includes('ACT-1'), false, 'no internal ids leak to the public payload');

    const missing = (await rpc('select feedback_public_submit($1,$2,$3) r', [pre.public_token, uuid(1), JSON.stringify({})])).r;
    assert.equal(missing.state, 'invalid_answers');
    const bad = (await rpc('select feedback_public_submit($1,$2,$3) r', [pre.public_token, uuid(1), JSON.stringify(answerAll(form.questions, { [form.questions[0].id]: 9 }))])).r;
    assert.deepEqual([bad.state, bad.invalid], ['invalid_answers', [form.questions[0].id]]);
    for (let i = 1; i <= 3; i += 1) {
      const ok = (await rpc('select feedback_public_submit($1,$2,$3,$4) r', [pre.public_token, uuid(i), JSON.stringify(answerAll(form.questions, { [form.questions[0].id]: i })), 95])).r;
      assert.deepEqual(ok, { ok: true, state: 'submitted' });
    }
    const dup = (await rpc('select feedback_public_submit($1,$2,$3) r', [pre.public_token, uuid(3), JSON.stringify(answerAll(form.questions))])).r;
    assert.equal(dup.state, 'already_received', 'double submit of the same submission id is stored once');
    await assert.rejects(client.query('insert into feedback_responses(campaign_id, template_version_id, client_submission_id) values ($1,$2,$3)', [pre.id, pre.template_version_id, uuid(99)]), /permission denied/);

    await asRole(client, 'authenticated', ADMIN);
    assert.equal((await rpc('select count(*)::int n from feedback_responses where campaign_id=$1', [pre.id])).n, 3);

    // closed / expired / not yet open
    await rpc("select feedback_admin_update_campaign($1,'close') c", [pre.id]);
    await asRole(client, 'anon');
    assert.equal((await rpc('select feedback_public_get($1) r', [pre.public_token])).r.state, 'closed');
    assert.equal((await rpc('select feedback_public_get($1) r', [pre.public_token])).r.questions.length, 0);
    assert.equal((await rpc('select feedback_public_submit($1,$2,$3) r', [pre.public_token, uuid(50), JSON.stringify(answerAll(form.questions))])).r.state, 'closed');
    await asRole(client, 'authenticated', ADMIN);
    await rpc("select feedback_admin_update_campaign($1,'reopen') c", [pre.id]);
    await asRole(client, 'postgres');
    await client.query("update feedback_campaigns set opens_at = now() - interval '2 days', expires_at = now() - interval '1 day' where id=$1", [pre.id]);
    await asRole(client, 'anon');
    assert.equal((await rpc('select feedback_public_get($1) r', [pre.public_token])).r.state, 'expired');
    await asRole(client, 'postgres');
    await client.query("update feedback_campaigns set opens_at = now() + interval '1 day', expires_at = null where id=$1", [pre.id]);
    await asRole(client, 'anon');
    assert.equal((await rpc('select feedback_public_get($1) r', [pre.public_token])).r.state, 'not_open');
    await asRole(client, 'postgres');
    await client.query('update feedback_campaigns set opens_at = now() - interval \'1 hour\' where id=$1', [pre.id]);

    // --- Student POST (PRE/POST comparison by the same question concept) ---
    await asRole(client, 'authenticated', ADMIN);
    const post = (await rpc("select feedback_admin_open_campaign('ACT-1','student','post') c")).c;
    assert.notEqual(post.public_token, pre.public_token, 'PRE and POST links differ');
    await asRole(client, 'anon');
    const postForm = (await rpc('select feedback_public_get($1) r', [post.public_token])).r;
    assert.equal(postForm.questions.length, 19);
    for (let i = 10; i < 12; i += 1) {
      await rpc('select feedback_public_submit($1,$2,$3) r', [post.public_token, uuid(i), JSON.stringify(answerAll(postForm.questions, { [postForm.questions[0].id]: 5 }))]);
    }

    // --- Educational staff is group-scoped; instructor is once per program/year assignment scope ---
    await asRole(client, 'authenticated', ADMIN);
    const staff = (await rpc("select feedback_admin_open_campaign('ACT-1','educational_staff','final') c")).c;
    assert.equal(staff.recipient.display_name, 'רונית כהן');
    assert.equal(staff.recipient.phone, '050-1234567');
    assert.equal(staff.public_token, null);
    await assert.rejects(client.query("select feedback_admin_open_campaign('ACT-2','educational_staff','final')"), /feedback_contact_missing/);

    await asRole(client, 'postgres');
    await client.query(`insert into activities
      (row_id, activity_season, activity_type, activity_name, authority, school, school_id, grade, emp_id, instructor_name, instructor_assignment_locked, instructor_assignment_status, start_date, end_date)
      values ('ACT-4','school_2027','course','פורצות דרך – קבוצה נוספת','חיפה','בית ספר נוסף',23,'ט','1501','דנה לוי',true,'שובץ','2026-10-15','2027-03-15')`);
    await asRole(client, 'authenticated', ADMIN);
    const instructorRows = (await client.query("select * from feedback_admin_instructor_assignments('school_2027') where instructor_emp_id='1501' and program_key='trailblazers'")).rows;
    assert.equal(instructorRows.length, 1, 'same instructor + program appears once regardless of number of groups');
    assert.deepEqual([instructorRows[0].assignment_count, instructorRows[0].school_count], [2, 2]);
    assert.equal(instructorRows[0].campaign, null);

    await assert.rejects(
      client.query("select feedback_admin_open_campaign('ACT-1','instructor','final')"),
      /feedback_instructor_scope_program/,
      'activity-scoped instructor feedback is blocked'
    );
    const instructor = (await rpc("select feedback_admin_open_instructor_campaign('1501','trailblazers','school_2027') c")).c;
    assert.equal(instructor.recipient.display_name, 'דנה לוי');
    assert.equal(instructor.activity_row_id, null);
    const instructorAgain = (await rpc("select feedback_admin_open_instructor_campaign('1501','trailblazers','school_2027') c")).c;
    assert.equal(instructorAgain.id, instructor.id, 'instructor campaign is idempotent per instructor + program + academic year');
    assert.equal((await rpc("select count(*)::int n from feedback_campaigns where audience='instructor' and instructor_emp_id='1501' and program_key='trailblazers' and academic_year='school_2027'")).n, 1);
    await assert.rejects(
      client.query("select feedback_admin_open_instructor_campaign('9999','trailblazers','school_2027')"),
      /feedback_instructor_not_assigned/
    );
    await rpc("select feedback_admin_update_campaign($1,'mark_shared',null,null,'whatsapp') c", [staff.id]);

    await asRole(client, 'anon');
    for (const campaign of [staff, instructor]) {
      const personal = (await rpc('select feedback_public_get($1) r', [campaign.recipient.token])).r;
      assert.equal(personal.state, 'ok');
      const first = (await rpc('select feedback_public_submit($1,$2,$3) r', [campaign.recipient.token, uuid(200), JSON.stringify(answerAll(personal.questions))])).r;
      assert.equal(first.state, 'submitted');
      const again = (await rpc('select feedback_public_submit($1,$2,$3) r', [campaign.recipient.token, uuid(201), JSON.stringify(answerAll(personal.questions))])).r;
      assert.deepEqual(again, { ok: false, state: 'completed' }, 'completed personal link is locked');
      assert.equal((await rpc('select feedback_public_get($1) r', [campaign.recipient.token])).r.state, 'completed');
    }

    // --- Results facts -------------------------------------------------------
    await asRole(client, 'authenticated', ADMIN);
    const facts = (await client.query(`select * from feedback_admin_answer_facts('{"activity_row_id":"ACT-1"}')`)).rows;
    const byAudience = (audience, stage) => facts.filter((f) => f.audience === audience && f.stage === stage);
    assert.equal(new Set(byAudience('student', 'pre').map((f) => f.response_id)).size, 3);
    assert.equal(new Set(byAudience('student', 'post').map((f) => f.response_id)).size, 2);
    assert.ok(byAudience('student', 'pre').every((f) => f.respondent_name === null), 'students are never identified');
    assert.equal(byAudience('instructor', 'final').length, 0, 'group facts do not attach the instructor survey to one activity');
    const instructorFacts = (await client.query(`select * from feedback_admin_answer_facts('{"academic_year":"school_2027","program":"trailblazers","instructor":"דנה לוי"}')`)).rows
      .filter((f) => f.audience === 'instructor');
    assert.ok(instructorFacts.length > 0);
    assert.ok(instructorFacts.every((f) => f.activity_row_id === null && f.respondent_name === 'דנה לוי'));
    const preComparisonIds = new Set(byAudience('student', 'pre').filter((f) => f.is_comparison).map((f) => f.question_id));
    const postComparisonIds = new Set(byAudience('student', 'post').filter((f) => f.is_comparison).map((f) => f.question_id));
    assert.deepEqual([...preComparisonIds].sort(), [...postComparisonIds].sort(), 'PRE and POST share the comparison question concepts');

    const groupRow = (await client.query("select * from feedback_admin_groups(null, 'ACT-1')")).rows[0];
    assert.equal(groupRow.campaigns.length, 3);
    assert.deepEqual(groupRow.campaigns.map((c) => [c.audience, c.stage, Number(c.responses)]),
      [['educational_staff', 'final', 1], ['student', 'post', 2], ['student', 'pre', 3]]);
    const instructorRowAfter = (await client.query("select * from feedback_admin_instructor_assignments('school_2027') where instructor_emp_id='1501' and program_key='trailblazers'")).rows[0];
    assert.equal(instructorRowAfter.campaign.id, instructor.id);
    assert.equal(instructorRowAfter.campaign.recipient.status, 'completed');

    // --- Versioning ---------------------------------------------------------
    const template = await rpc("select id, current_version_id from feedback_templates where program_key='trailblazers' and audience='student' and stage='pre'");
    await assert.rejects(client.query("update feedback_template_questions set wording='{\"default\":\"x\"}' where version_id=$1", [template.current_version_id]), /feedback_version_locked/);
    const draftId = (await rpc('select feedback_admin_get_draft($1) id', [template.id])).id;
    assert.equal((await rpc('select feedback_admin_get_draft($1) id', [template.id])).id, draftId, 'one draft per template');
    await client.query("update feedback_template_questions set wording='{\"default\":\"ניסוח חדש לבדיקה\"}' where version_id=$1 and sort_order=(select min(sort_order) from feedback_template_questions where version_id=$1)", [draftId]);
    await client.query('delete from feedback_template_questions where version_id=$1 and sort_order=(select max(sort_order) from feedback_template_questions where version_id=$1)', [draftId]);
    await rpc('select feedback_admin_publish_draft($1) id', [draftId]);
    const versions = (await client.query('select version_no, status from feedback_template_versions where template_id=$1 order by version_no', [template.id])).rows;
    assert.deepEqual(versions, [{ version_no: 1, status: 'archived' }, { version_no: 2, status: 'published' }]);

    await asRole(client, 'anon');
    const oldForm = (await rpc('select feedback_public_get($1) r', [pre.public_token])).r;
    assert.equal(oldForm.questions.length, 10, 'existing campaign keeps its pinned version');
    assert.ok(!oldForm.questions.some((q) => q.text === 'ניסוח חדש לבדיקה'));
    await asRole(client, 'authenticated', ADMIN);
    const refreshedPre = (await rpc("select c from feedback_admin_groups(null,'ACT-1') g, jsonb_array_elements(g.campaigns) c where c->>'id'=$1", [pre.id])).c;
    assert.equal(refreshedPre.template_is_current, false);
    assert.equal(refreshedPre.version_no, 1);
    await asRole(client, 'postgres');
    await assert.rejects(client.query('delete from feedback_template_versions where template_id=$1 and version_no=1', [template.id]), /feedback_version_locked/);
  } finally {
    await client.query('reset role').catch(() => {});
    await client.end();
  }
});

test('impact feedback DB contract: program fallback, manual mapping, catalog limits and age bands', async (t) => {
  if (!connectionString) {
    t.skip('set IMPACT_FEEDBACK_TEST_DATABASE_URL to a disposable Postgres database to run the impact feedback contract');
    return;
  }
  const client = new pg.Client({ connectionString });
  await client.connect();
  const one = async (sql, params = []) => (await client.query(sql, params)).rows[0];
  try {
    await resetSchema(client);
    await client.query(`insert into users values ('admin',$1,'admin',true,'{}'),('ops',$2,'operation_manager',true,'{}')`, [ADMIN, MANAGER]);
    await client.query(`insert into activities (row_id, activity_season, activity_type, activity_name, gefen_number, school, grade, instructor_name, emp_id) values
      ('M-1','school_2027','course','קורס יזמות מיוחד',null,'בית ספר א','ט','מדריכה','1'),
      ('M-2','school_2027','course','קורס יזמות מיוחד',null,'בית ספר ב','ח','מדריכה','1'),
      ('M-3','school_2027','course','אופק לתעשייה',null,'בית ספר ג','ט','מדריכה','1'),
      ('M-8','school_2027','course','קורס יזמות לתעשייה','52279','בית ספר ח','ח','מדריכה','1'),
      ('M-9','school_2027','course','תוכנית העצמה לבנות','3604','בית ספר ט','ט','מדריכה','1'),
      ('M-10','school_2027','course','קורס ללא שם מוכר','67861','בית ספר י','ט','מדריכה','1'),
      ('M-4','school_2027','course','תוכנית AI לבית הספר','9545','בית ספר ד','','מדריכה','1'),
      ('M-5','school_2027','course','פורצות דרך',null,'תיכון ה','י','מדריכה','1'),
      ('M-6','school_2027','course','משחקי קופסה',null,'בית ספר ו',null,'מדריכה','1'),
      ('M-7','school_2027','workshop','סדנת רובוטיקה',null,'בית ספר ז','ה','מדריכה','1')`);

    // --- Catalog limits & mapping corrections ----------------------------------------------------
    assert.equal((await one("select default_age_band b from feedback_programs where key='ai_foundations'")).b, 'g_i');
    const tooMany = (await client.query(`select t.program_key, t.stage, count(*)::int n from feedback_templates t
      join feedback_template_questions q on q.version_id = t.current_version_id and q.section = 'course'
      where t.audience = 'student' group by 1, 2 having count(*) > 5`)).rows;
    assert.deepEqual(tooMany, [], 'at most 5 course-specific questions per student questionnaire');
    const greenAi = (await client.query(`select question_key from feedback_questions
      where program_key = 'green_leadership' and (wording::text ilike '%AI%' or wording::text like '%בינה מלאכותית%')`)).rows;
    assert.deepEqual(greenAi, [], 'green leadership questions must not target AI');

    await client.query("select set_config('test.uid', $1, false)", [ADMIN]);
    await client.query('set role authenticated');
    const groups = Object.fromEntries((await client.query("select * from feedback_admin_groups('school_2027')")).rows.map((g) => [g.row_id, g]));
    assert.equal(groups['M-7'], undefined, 'non-course activities without a program are not listed');
    assert.deepEqual([groups['M-1'].program_key, groups['M-1'].program_source], [null, null], 'unknown name stays visible as unresolved');
    assert.deepEqual([groups['M-3'].program_key, groups['M-3'].program_source], ['ofek', 'name'], '"אופק לתעשייה" is Ofek – יזמות פרימיום (52279)');
    assert.deepEqual([groups['M-8'].program_key, groups['M-8'].program_source], ['ofek', 'gefen'], 'Gefen 52279 resolves to Ofek automatically');
    assert.deepEqual([groups['M-9'].program_key, groups['M-9'].program_source], ['trailblazers', 'gefen'], 'Gefen 3604 resolves to Trailblazers automatically');
    assert.deepEqual([groups['M-10'].program_key, groups['M-10'].program_source], [null, null], 'ids outside the final catalog are not auto-matched');
    const gefen = Object.fromEntries((await client.query('select key, gefen_numbers from feedback_programs')).rows.map((r) => [r.key, r.gefen_numbers]));
    assert.deepEqual(gefen, {
      biomimicry: ['6089'], green_leadership: ['67867'], space_tech: ['57651'], ai_applications: ['53819'],
      pharma: ['46091'], ofek: ['52279'], ai_foundations: ['9545'], trailblazers: ['3604']
    }, 'Gefen numbers match the final catalog');
    assert.deepEqual([groups['M-4'].program_key, groups['M-4'].program_source, groups['M-4'].age_band], ['ai_foundations', 'gefen', 'g_i'], 'Gefen number resolves; no grade -> program default (ז׳–ח׳)');
    assert.deepEqual([groups['M-5'].program_key, groups['M-5'].age_band], ['trailblazers', 'j_l'], 'grade י׳ in a ז׳–י׳ program resolves to the י׳–י״ב band');
    assert.deepEqual([groups['M-6'].program_key, groups['M-6'].age_band], [null, null], 'no grade and no program -> no age band');
    await assert.rejects(client.query("select feedback_admin_open_campaign('M-1','student','pre')"), /feedback_program_unresolved/);

    // --- Manual mapping (feedback-only; master data untouched) ---------------------------------------
    await client.query('reset role');
    const before = (await client.query('select to_jsonb(a) j from activities a order by row_id')).rows;
    await client.query("select set_config('test.uid', $1, false)", [MANAGER]);
    await client.query('set role authenticated');
    await assert.rejects(client.query("select feedback_admin_set_program('M-1','ofek')"), /feedback_forbidden/);
    await client.query("select set_config('test.uid', $1, false)", [ADMIN]);
    await assert.rejects(client.query("select feedback_admin_set_program('M-1','nope')"), /feedback_invalid_program/);
    const set1 = (await one("select feedback_admin_set_program('M-1','ofek', true) r")).r;
    assert.deepEqual(set1, { program_key: 'ofek', source: 'manual', excluded: false });
    const sameName = (await one("select * from feedback_admin_groups(null,'M-2')"));
    assert.deepEqual([sameName.program_key, sameName.program_source], ['ofek', 'manual_name'], 'name-level mapping applies to the same activity name');
    const opened = (await one("select feedback_admin_open_campaign('M-1','student','pre') c")).c;
    assert.equal(opened.program_key, 'ofek');
    await assert.rejects(client.query("select feedback_admin_set_program('M-1','pharma')"), /feedback_program_locked/, 'program is locked once feedback was opened');
    await client.query("select feedback_admin_set_program('M-2','pharma')");
    assert.equal((await one("select program_key from feedback_admin_groups(null,'M-2')")).program_key, 'pharma', 'activity-level choice overrides the name mapping');
    await client.query("select feedback_admin_set_program('M-3', null, false, true)");
    const excluded = await one("select * from feedback_admin_groups(null,'M-3')");
    assert.equal(excluded.feedback_excluded, true);
    await assert.rejects(client.query("select feedback_admin_open_campaign('M-3','student','pre')"), /feedback_activity_excluded/);
    await client.query("select feedback_admin_set_program('M-3', null)");
    assert.deepEqual(Object.values(await one("select program_key, feedback_excluded from feedback_admin_groups(null,'M-3')")), ['ofek', false], 'clearing the manual choice returns to automatic identification');
    await assert.rejects(client.query('insert into feedback_program_mappings(scope, activity_row_id, program_key) values ($1,$2,$3)', ['activity', 'M-6', 'ofek']), /permission denied/);
    await client.query('reset role');
    const after = (await client.query('select to_jsonb(a) j from activities a order by row_id')).rows;
    assert.deepEqual(after, before, 'manual program choice never modifies activities master data');
    assert.equal((await one('select count(*)::int n from feedback_programs')).n, 8, 'no course master data was created');

    // --- Age-band wording reaches the public form -----------------------------------------------------
    await client.query("select set_config('test.uid', $1, false)", [ADMIN]);
    await client.query('set role authenticated');
    const senior = (await one("select feedback_admin_open_campaign('M-5','student','pre') c")).c;
    assert.equal(senior.age_band, 'j_l');
    await client.query('set role anon');
    const form = (await one('select feedback_public_get($1) r', [senior.public_token])).r;
    assert.equal(form.age_band, 'j_l');
    assert.match(form.questions[0].text, /^אני מבין\/ה את העקרונות של התחום/, 'j_l variant is used when it exists');
    assert.equal(form.questions[1].text, 'אני מאמין/ה שאני מסוגל/ת לפתח רעיון לפתרון של בעיה אמיתית', 'falls back to default wording');
  } finally {
    await client.query('reset role').catch(() => {});
    await client.end();
  }
});
