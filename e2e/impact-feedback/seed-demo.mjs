/**
 * Local-only demo data for the impact feedback E2E stack (manual runs, not CI).
 * DESTRUCTIVE for the target database: drops and recreates public/private/auth. Use a disposable DB.
 *
 *   E2E_DATABASE_URL=postgres://postgres@127.0.0.1:54329/fb_e2e E2E_ALLOW_RESET=1 node e2e/impact-feedback/seed-demo.mjs
 *
 * Builds: the stub production tables, every feedback migration, PostgREST roles, demo activities of several
 * courses (including look-alike names), opened campaigns and submitted questionnaires with known values,
 * so the admin screen can be checked against exact expected numbers.
 */
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.E2E_DATABASE_URL;
if (!url || process.env.E2E_ALLOW_RESET !== '1') {
  console.error('Set E2E_DATABASE_URL to a disposable database and E2E_ALLOW_RESET=1.');
  process.exit(1);
}

export const ADMIN_ID = '11111111-1111-1111-1111-111111111111';
export const MANAGER_ID = '22222222-2222-2222-2222-222222222222';
const root = new URL('../../', import.meta.url);
const client = new pg.Client({ connectionString: url });

async function asAdmin() {
  await client.query('reset role');
  await client.query("select set_config('test.uid', $1, false)", [ADMIN_ID]);
  await client.query('set role authenticated');
}
async function asAnon() {
  await client.query('reset role');
  await client.query('set role anon');
}
async function one(sql, params = []) {
  return (await client.query(sql, params)).rows[0];
}

let submission = 0;
function nextSubmission() {
  submission += 1;
  return `00000000-0000-4000-8000-${String(submission).padStart(12, '0')}`;
}

function answers(questions, rating, text = '') {
  const out = {};
  for (const q of questions) {
    if (q.type === 'rating_1_5') out[q.id] = rating;
    else if (q.type === 'yes_no') out[q.id] = rating >= 3;
    else if (q.type === 'single_select') out[q.id] = q.options[Math.min(1, q.options.length - 1)].value;
    else if (q.type === 'multi_select') out[q.id] = [q.options[0].value];
    else if (q.type === 'free_text' && text) out[q.id] = text;
  }
  return out;
}

async function submit(token, rating, count, text = '') {
  await asAnon();
  const form = (await one('select feedback_public_get($1) r', [token])).r;
  for (let i = 0; i < count; i += 1) {
    const result = (await one('select feedback_public_submit($1,$2,$3) r', [token, nextSubmission(), JSON.stringify(answers(form.questions, rating, i === 0 ? text : ''))])).r;
    if (result.state !== 'submitted') throw new Error(`submit failed: ${JSON.stringify(result)}`);
  }
}

async function openGroup(rowId, audience, stage) {
  await asAdmin();
  return (await one('select feedback_admin_open_campaign($1,$2,$3) c', [rowId, audience, stage])).c;
}

async function openInstructor(emp, program, stage) {
  await asAdmin();
  return (await one("select feedback_admin_open_instructor_campaign($1,$2,'school_2027',$3) c", [emp, program, stage])).c;
}

async function main() {
  await client.connect();
  await client.query('drop schema if exists public cascade; drop schema if exists private cascade; drop schema if exists auth cascade; create schema public;');
  await client.query(await readFile(new URL('tests/fixtures/impact-feedback-stub-schema.sql', root), 'utf8'));
  const files = (await readdir(new URL('supabase/migrations/', root)))
    .filter((f) => f >= '20261008120000' && /feedback/.test(f))
    .sort();
  for (const file of files) await client.query(await readFile(new URL(`supabase/migrations/${file}`, root), 'utf8'));

  await client.query(`do $$ begin
    if not exists (select from pg_roles where rolname = 'authenticator') then
      create role authenticator login noinherit password 'authenticator';
    end if;
  end $$;
  grant anon, authenticated to authenticator;`);

  await client.query(`insert into users values ('admin',$1,'admin',true,'{}'),('ops',$2,'operation_manager',true,'{}')`, [ADMIN_ID, MANAGER_ID]);
  await client.query(`insert into contacts_schools (id, school, contact_name, phone, mobile, email) values
    (7, 'בית ספר אלון', 'רונית כהן', '03-5555555', '050-1234567', 'ronit@example.test'),
    (8, 'בית ספר הגפן', 'משה לוי', '', '050-2222222', ''),
    (9, 'חטיבת רמות', 'נועה בר', '', '050-3333333', 'noa@example.test')`);
  await client.query(`insert into contacts_instructors values
    (1501, 'דנה לוי', '052-7654321', 'dana@example.test', 'פעיל'),
    (1502, 'אורי מזרחי', '052-1111111', '', 'פעיל')`);
  await client.query(`insert into activities (row_id, activity_season, activity_type, activity_name, gefen_number, authority, school, school_id, grade, emp_id, instructor_name,
      instructor_assignment_locked, instructor_assignment_status, start_date, end_date, school_contact_id, activity_manager, participants_count) values
    ('ACT-1','school_2027','course','פורצות דרך',null,'חיפה','בית ספר אלון',20,'ח','1501','דנה לוי',true,'שובץ','2026-10-01','2027-03-01',7,'הילה רוזן','25'),
    ('ACT-2','school_2027','course','פורצות דרך',null,'חיפה','בית ספר הגפן',21,'ט','1501','דנה לוי',true,'שובץ','2026-10-05','2027-03-10',8,'הילה רוזן','20'),
    ('ACT-3','school_2027','course','רוקחים עולם',null,'תל אביב','חטיבת רמות',22,'ט','1502','אורי מזרחי',true,'שובץ','2026-10-10','2027-02-20',9,'גיל נאמן',null),
    ('ACT-4','school_2027','course','ביומימיקרי',null,'חולון','יסודי השקד',23,'ד',null,null,false,null,'2026-11-01','2027-01-30',null,null,null),
    ('ACT-5','school_2027','course','ביומימיקרי',null,'חולון','חטיבת השקד',24,'ח',null,null,false,null,'2026-11-01','2027-01-30',null,null,null),
    ('ACT-6','school_2027','course','יישומי AI','53819','רמת גן','תיכון אורט',25,'י',null,null,false,null,'2026-11-01','2027-02-01',null,null,null),
    ('ACT-7','school_2027','course','סודות ויסודות הבינה המלאכותית','9545','רמת גן','חטיבת ביאליק',26,'ז',null,null,false,null,'2026-11-01','2027-02-01',null,null,null),
    ('ACT-8','school_2027','course','קורס יזמות מיוחד',null,'עפולה','בית ספר הדר',27,'ח',null,null,false,null,'2026-11-01','2027-02-01',null,null,null),
    ('ACT-9','school_2027','course','ביומימיקרי – חדר בריחה',null,'עפולה','יסודי הדר',28,'ה',null,null,false,null,'2026-11-01','2027-02-01',null,null,null)`);

  // Trailblazers: two groups whose sizes differ, so pooled means differ from a mean of group means.
  const t1pre = await openGroup('ACT-1', 'student', 'pre');
  const t2pre = await openGroup('ACT-2', 'student', 'pre');
  await submit(t1pre.public_token, 2, 4);
  await submit(t2pre.public_token, 4, 2);
  const t1post = await openGroup('ACT-1', 'student', 'post');
  const t2post = await openGroup('ACT-2', 'student', 'post');
  await submit(t1post.public_token, 4, 3, 'הכי אהבתי לבנות את אב הטיפוס');
  await submit(t2post.public_token, 5, 1);
  const s1 = await openGroup('ACT-1', 'educational_staff', 'final');
  await openGroup('ACT-2', 'educational_staff', 'final');
  await submit(s1.recipient.token, 4, 1, 'התלמידות היו מעורבות מאוד');
  const ipre = await openInstructor('1501', 'trailblazers', 'pre');
  const ifinal = await openInstructor('1501', 'trailblazers', 'final');
  await submit(ipre.recipient.token, 3, 1, 'צריך עוד תרגול בחלק המעשי');
  await submit(ifinal.recipient.token, 4, 1, 'התוכנית עבדה היטב');

  // Pharma: only an end-of-course student questionnaire and an unanswered instructor link.
  const p3post = await openGroup('ACT-3', 'student', 'post');
  await submit(p3post.public_token, 3, 5);
  await openInstructor('1502', 'pharma', 'final');

  await client.query('reset role');
  console.log(JSON.stringify({ ok: true, migrations: files.length, links: { trailblazersPre: t1pre.public_token, staff: s1.recipient.token } }));
  await client.end();
}

main().catch(async (error) => {
  console.error(error);
  await client.end().catch(() => {});
  process.exit(1);
});
