import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import {buildDashboardCourseOptions} from '../attendance/src/services/activities-report.helpers.js';

// Run only against a disposable local database, or an explicitly supplied embedded
// PostgreSQL engine. Neither path can connect to Production.
const connectionString = process.env.ATTENDANCE_CHOICE_TEST_DATABASE_URL;
const embeddedModule = process.env.ATTENDANCE_CHOICE_TEST_PGLITE_MODULE;
if (connectionString) {
  const url = new URL(connectionString);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/codex_attendance_choice_test') {
    throw new Error('Use a disposable localhost database named codex_attendance_choice_test');
  }
}
let db;
const fixtureDate = '2026-10-06';
const uid1 = '11111111-1111-4111-8111-111111111111';
const uid2 = '22222222-2222-4222-8222-222222222222';
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const required = t => { if (db) return true; t.skip('Configure ATTENDANCE_CHOICE_TEST_DATABASE_URL or ATTENDANCE_CHOICE_TEST_PGLITE_MODULE'); return false; };
async function identity(uid = uid1) {
  await db.query("select set_config('test.uid', $1, false)", [uid]);
  await db.query('set role authenticated');
}
async function choices(date = fixtureDate) {
  return (await db.query('select public.av2_get_current_instructor_activity_choices_for_date($1) value', [date])).rows[0].value;
}
async function save(rowId, overrides = {}) {
  const payload = { rowId, emp: 1, date: fixtureDate, school: 101, authority: 5, ...overrides };
  return db.query(`insert into public.attendance_records(emp_id, report_date, activity_type, activity_row_id, school_id, authority_id)
    values ($1,$2,'קורס',$3,$4,$5) returning *`, [payload.emp, payload.date, payload.rowId, payload.school, payload.authority]);
}
before(async () => {
  if (embeddedModule) {
    const { PGlite } = await import(embeddedModule);
    db = new PGlite();
  } else if (connectionString) {
    db = new pg.Client({ connectionString }); await db.connect();
  } else return;
  const exec = sql => embeddedModule ? db.exec(sql) : db.query(sql);
  await exec(`drop schema if exists public cascade; drop schema if exists auth cascade; create schema public; create schema auth;
    do $$ begin if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if;
      if not exists(select from pg_roles where rolname='anon') then create role anon; end if;
      if not exists(select from pg_roles where rolname='service_role') then create role service_role; end if; end $$;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
    grant usage on schema public, auth to authenticated, anon;
    create table public.users(emp_id bigint, auth_user_id uuid, is_active boolean, role text);
    create table public.activities(id bigint primary key, row_id text unique, emp_id text, emp_id_2 text,
      activity_no text, activity_name text, activity_type text, activity_season text, program_name text,
      start_time time, end_time time, authority_id bigint, authority_name text, school_link_status text,
      single_school_id bigint, single_semel_mosad text, single_school_name text, linked_schools_json jsonb default '[]',
      school_id bigint, grade text, class_group text, ${Array.from({ length: 35 }, (_, i) => `date_${i+1} date`).join(', ')});
    create view public.activities_directory_view as select * from public.activities;
    create table public.course_meeting_instructor_history(activity_id text, meeting_date date, emp_id text);
    create table public.course_meeting_cancellations(activity_id text, meeting_date date);
    create table public.attendance_records(id uuid primary key default gen_random_uuid(), emp_id bigint, report_date date, activity_type text,
      activity_row_id text, school_id bigint, authority_id bigint, generation_kind text, notes text,
      activity_id bigint, activity_no text, meeting_no int, start_time time, end_time time, total_hours numeric,
      activity_name_snapshot text, school_name_snapshot text, training_mode text, training_schedule_id uuid,
      destination_address_snapshot text,authority_name_snapshot text,source_attendance_record_id uuid references public.attendance_records(id) on delete cascade,
      roundtrip_km numeric default 0,public_transport boolean default false,public_transport_cost numeric default 0,
      expenses numeric default 0,expense_details text,updated_at timestamptz default now());
    create unique index one_generated_per_source on public.attendance_records(source_attendance_record_id)
      where generation_kind='travel_time_cancellation';
    create table auth.users(id uuid primary key);
    create function public.av2_can_write_month(date) returns boolean language sql as $$
      select coalesce(current_setting('test.month_open',true),'true') <> 'false' $$;

    create table public.activity_schools(activity_id text,school_id bigint);
    create table public.contacts_instructors(emp_id bigint,address text);
    create table public.schools(id bigint,school_name text,institution_address text,mailing_address text);
    create table public.contacts_schools(school_id bigint,address text);
    create schema extensions;
    create function extensions.digest(text,text) returns bytea language sql immutable as $$ select decode(md5($1),'hex') $$;
    create function public.scheduling_effective_meetings(public.activities,bigint) returns jsonb language sql as $$ select '[]'::jsonb $$;

    alter table public.attendance_records enable row level security;
    create policy self_write on public.attendance_records to authenticated using (
      emp_id = (select emp_id from public.users where auth_user_id=auth.uid() and is_active)
    ) with check (emp_id = (select emp_id from public.users where auth_user_id=auth.uid() and is_active));
    grant select on public.users to authenticated;
    grant select, insert, update on public.attendance_records to authenticated;

  `);
  const legacy = await read('../supabase/migrations/20260922011500_course_single_meeting_substitution.sql');
  const dateRpc = legacy.slice(legacy.indexOf('create or replace function public.av2_get_instructor_activities_for_date('), legacy.indexOf('-- Full course schedule for smart duplication.'));
  await exec(dateRpc);
  await exec(await read('../supabase/migrations/20261005000500_attendance_dashboard_course_choice.sql'));
  const model = await read('../supabase/migrations/20261006010711_attendance_course_date_assignment_guard.sql');
  await exec(model);
  const travel=await read('../supabase/migrations/20260908100000_attendance_travel_compensation.sql');
  await exec(travel.slice(travel.indexOf('create table if not exists public.attendance_travel_compensations ('),
    travel.indexOf('alter table public.attendance_travel_compensations enable row level security;')));
  for(const name of ['av2_prepare_attendance_travel','av2_reconcile_attendance_travel','av2_override_attendance_time_cancellation']) {
    const start=travel.indexOf(`create or replace function public.${name}(`);
    const end=travel.indexOf('end $$;',start)+7;
    await exec(travel.slice(start,end));
  }
  // Production already restricts prepare/reconcile to its trusted service role.
  await exec(`revoke all on function public.av2_prepare_attendance_travel(uuid,uuid),
    public.av2_reconcile_attendance_travel(uuid,text,integer,integer,text) from public,anon,authenticated;
    grant execute on function public.av2_prepare_attendance_travel(uuid,uuid),
    public.av2_reconcile_attendance_travel(uuid,text,integer,integer,text) to service_role;
    revoke all on function public.av2_override_attendance_time_cancellation(uuid,integer) from public,anon;
    grant execute on function public.av2_override_attendance_time_cancellation(uuid,integer) to authenticated;`);
});
beforeEach(async () => {
  if (!db) return;
  await db.query('reset role');
  await db.query("select set_config('test.month_open','true',false)");
  const exec = sql => embeddedModule ? db.exec(sql) : db.query(sql);
  await exec(`truncate public.attendance_travel_compensations, auth.users, public.contacts_instructors, public.schools, public.contacts_schools, public.users, public.activities, public.course_meeting_instructor_history, public.course_meeting_cancellations, public.attendance_records;
    insert into auth.users values ('${uid1}'),('${uid2}');
    insert into public.users values (1,'${uid1}',true,'instructor'), (2,'${uid2}',true,'instructor');
    insert into public.activities(id,row_id,emp_id,activity_name,activity_type,start_time,end_time,authority_id,authority_name,
      school_link_status,single_school_id,single_school_name,grade,class_group,date_1,date_2,date_3)
    values (1,'c1','1','ביומימיקרי','course','08:30','10:00',5,'תל אביב','single_school',101,'הרצל','ה','ה1','2026-09-22','2026-09-29','2026-10-06'),
      (2,'c2','1','ביומימיקרי','course','11:00','12:30',5,'תל אביב','single_school',101,'הרצל','ה','ה2',null,null,'2026-10-06'),
      (3,'sub','1','ביומימיקרי','course','13:00','14:30',5,'תל אביב','single_school',101,'הרצל','ה','ה3',null,null,'2026-10-06'),
      (4,'cancelled','1','ביומימיקרי','course','15:00','16:30',5,'תל אביב','single_school',101,'הרצל','ה','ה4',null,null,'2026-10-06');
    insert into public.course_meeting_instructor_history values ('sub','2026-10-06','2');
    insert into public.course_meeting_cancellations values ('cancelled','2026-10-06'),('c1','2026-09-29');
  `);
  await identity();
});
after(async () => { if (db) { if (embeddedModule) await db.close(); else await db.end(); } });

test('actual date RPC preserves cancelled-meeting numbering, exact times and class metadata', async t => {
  if (!required(t)) return;
  const rows = await choices();
  assert.deepEqual(rows.map(row => row.row_id), ['c1', 'c2']);
  assert.equal(rows[0].meeting_no, 2);
  assert.equal(rows[0].start_time, '08:30');
  assert.equal(rows[0].class_group, 'ה1');
  assert.equal(rows[1].start_time, '11:00');
});
test('one-time substitute is selectable and writable only by the substitute for that date', async t => {
  if (!required(t)) return;
  await assert.rejects(save('sub'), /אינו משויך/);
  await db.query('reset role'); await identity(uid2);
  assert.deepEqual((await choices()).map(row => row.row_id), ['sub']);
  assert.equal((await save('sub', { emp: 2 })).rows[0].activity_row_id, 'sub');
  assert.deepEqual(await choices('2026-10-07'), []);
});
test('direct writes reject cancelled, foreign, missing and wrong-date activity rows', async t => {
  if (!required(t)) return;
  for (const row of ['cancelled', 'sub', 'not-in-dashboard']) await assert.rejects(save(row), /אינו משויך/);
  await assert.rejects(save('c1', { date: '2026-10-07' }), /אינו משויך/);
  await assert.rejects(save('c1', { emp: 2 }), /מדריך אחר/);
  await db.query('reset role');
  await db.query("update public.activities set activity_type='workshop' where row_id='c2'");
  await identity();
  await assert.rejects(save('c2'), /אינו משויך/);
});
test('school-name fallback permits an authorized course when school ids and linked school JSON are null', async t => {
  if (!required(t)) return;
  await db.query('reset role');
  await db.query("update public.activities set single_school_id=null,linked_schools_json='null'::jsonb where row_id='c1'");
  await identity();
  assert.equal((await save('c1', { school: null })).rows[0].activity_row_id, 'c1');
});
test('direct writes reject school and authority mismatches', async t => {
  if (!required(t)) return;
  await assert.rejects(save('c1', { school: 102 }), /בית הספר/);
  await assert.rejects(save('c1', { authority: 6 }), /הרשות/);
});
test('valid course saves, ordinary corrections stay editable, invalid date reassignment is rejected', async t => {
  if (!required(t)) return;
  const saved = (await save('c1')).rows[0];
  await db.query("update public.attendance_records set notes='correction' where id=$1", [saved.id]);
  await assert.rejects(db.query("update public.attendance_records set report_date='2026-10-07' where id=$1", [saved.id]), /אינו משויך/);
});
test('other report types and automatic cancellation records retain existing write behavior', async t => {
  if (!required(t)) return;
  for (const type of ['סדנה','סיור','הכשרה','זום','תפעול','ביטול זמן']) {
    await db.query('insert into public.attendance_records(emp_id,report_date,activity_type) values (1,$1,$2)', [fixtureDate, type]);
  }
  assert.equal((await db.query('select count(*)::int count from public.attendance_records')).rows[0].count, 6);
});
test('no added API execute privileges and current-instructor RPC never accepts another employee id', async t => {
  if (!required(t)) return;
  const privileges = (await db.query(`select
    has_function_privilege('anon','public.av2_get_current_instructor_activity_choices_for_date(date)','EXECUTE') anon_choice,
    has_function_privilege('authenticated','public.av2_guard_course_date_assignment()','EXECUTE') api_guard,
    has_function_privilege('anon','public.av2_guard_course_date_assignment()','EXECUTE') anon_guard`)).rows[0];
  assert.deepEqual(privileges, { anon_choice: false, api_guard: false, anon_guard: false });
  assert.deepEqual((await db.query('select public.av2_get_instructor_activities_for_date(2,$1) value', [fixtureDate])).rows[0].value, []);
});

async function saveBusiness(overrides={}) {
  const identity=overrides.identity || ['ביומימיקרי',['id','101']];
  return (await db.query(`insert into public.attendance_records(emp_id,report_date,activity_type,school_id,authority_id,
    course_business_identity,course_dashboard_sources,total_hours,activity_row_id,meeting_no)
    values($1,$2,'קורס',$3,5,$4::jsonb,$5::jsonb,999,'forged',999) returning *`,
    [overrides.emp||1,overrides.date||fixtureDate,overrides.school===undefined?101:overrides.school,
      JSON.stringify(identity),JSON.stringify([{row_id:'forged'}])])).rows[0];
}
test('one business insert retains all authorized source meetings, excludes cancelled/substituted rows and computes salary', async t => {
  if(!required(t))return;
  const row=await saveBusiness();
  assert.equal(row.activity_row_id,null); assert.equal(row.activity_id,null); assert.equal(row.meeting_no,null);
  assert.deepEqual(row.course_dashboard_sources.map(x=>x.row_id),['c1','c2']);
  assert.deepEqual(row.course_dashboard_sources.map(x=>x.meeting_no),[2,1]);
  assert.deepEqual(row.course_dashboard_sources.map(x=>x.class_group),['ה1','ה2']);
  assert.equal(Number(row.total_hours),4); assert.equal(row.start_time,'08:15:00'); assert.equal(row.end_time,'12:45:00');
  const validation=(await db.query("select public.av2_validate_attendance_month_dashboard(1,'2026-10') value")).rows[0].value;
  assert.equal(validation[0].mismatch,false);
});
test('Production Alex 1507 / 2026-10-11 / school 2648 saves three sources and 450 paid minutes atomically', async t => {
  if(!required(t))return;
  await db.query('reset role');
  await db.query("update public.users set emp_id=1507 where emp_id=1");
  await db.query('truncate public.activities,public.course_meeting_cancellations,public.course_meeting_instructor_history');
  for(const [i,start] of [8,10,12].entries()) await db.query(`insert into public.activities(id,row_id,emp_id,activity_name,activity_type,
    start_time,end_time,authority_id,single_school_id,single_school_name,grade,class_group,date_1)
    values($1,$2,'1507','ביומימיקרי','course',$3,$4,5,2648,'הרצל','ה',$5,'2026-10-11')`,
    [59-i,`school_2027_0${59-i}`,`${String(start).padStart(2,'0')}:00`,`${start+2}:00`,`ה${i+1}`]);
  await identity();
  const row=await saveBusiness({emp:1507,date:'2026-10-11',school:2648,identity:['ביומימיקרי',['id','2648']]});
  assert.deepEqual(row.course_dashboard_sources.map(x=>x.row_id),['school_2027_057','school_2027_058','school_2027_059']);
  assert.equal(row.course_dashboard_sources.length,3);
  assert.ok(row.course_dashboard_sources.every(x=>x.resolved_emp_id===1507 && x.report_date==='2026-10-11'));
  assert.equal(Number(row.total_hours),7.5); assert.equal(row.start_time,'07:45:00'); assert.equal(row.end_time,'14:15:00');
  assert.equal((await db.query('select count(*)::int n from public.attendance_records')).rows[0].n,1);
  assert.equal((await db.query("select public.av2_validate_attendance_month_dashboard(1507,'2026-10') value")).rows[0].value[0].mismatch,false);
});
test('four simultaneous classes save all four links, with no duplicated instructional or preparation pay', async t => {
  if(!required(t))return;
  await db.query('reset role');
  await db.query('truncate public.course_meeting_cancellations,public.course_meeting_instructor_history');
  await db.query("update public.activities set start_time='08:30',end_time='10:00'"); await identity();
  const row=await saveBusiness(); assert.equal(row.course_dashboard_sources.length,4); assert.equal(Number(row.total_hours),2);
});
test('business writes cannot spoof owner, date, school, source list or salary; date changes rebuild sources', async t => {
  if(!required(t))return;
  await assert.rejects(saveBusiness({emp:2}),/מדריך אחר/);
  await assert.rejects(saveBusiness({date:'2026-10-07'}),/אינו משויך/);
  await assert.rejects(saveBusiness({school:102}),/בית הספר/);
  await assert.rejects(saveBusiness({identity:['ביומימיקרי',['id','102']]}),/אינו משויך/);
  const row=await saveBusiness();
  await db.query("update public.attendance_records set total_hours=999,course_dashboard_sources='[]'::jsonb where id=$1",[row.id]);
  const updated=(await db.query('select * from public.attendance_records where id=$1',[row.id])).rows[0];
  assert.equal(Number(updated.total_hours),4); assert.equal(updated.course_dashboard_sources.length,2);
  await db.query("update public.attendance_records set report_date='2026-09-22' where id=$1",[row.id]);
  const dated=(await db.query('select * from public.attendance_records where id=$1',[row.id])).rows[0];
  assert.equal(dated.course_dashboard_sources.length,1); assert.equal(dated.activity_row_id,'c1'); assert.equal(dated.meeting_no,1);
});
test('grouped substitution stays date-owned and dashboard changes are detected in monthly validation', async t => {
  if(!required(t))return;
  await db.query('reset role'); await identity(uid2);
  const row=await saveBusiness({emp:2}); assert.equal(row.activity_row_id,'sub'); assert.equal(row.course_dashboard_sources[0].resolved_emp_id,2);
  await db.query('reset role'); await db.query("insert into public.course_meeting_cancellations values('sub',$1)",[fixtureDate]); await identity(uid2);
  const validation=(await db.query("select public.av2_validate_attendance_month_dashboard(2,'2026-10') value")).rows[0].value;
  assert.equal(validation[0].mismatch,true);
  await assert.rejects(saveBusiness({emp:2}),/אינו משויך/);
});
test('private helpers are not executable through the API and cross-instructor RLS remains enforced', async t => {
  if(!required(t))return;
  assert.equal((await db.query("select has_schema_privilege('authenticated','attendance_private','USAGE') allowed")).rows[0].allowed,false);
  await assert.rejects(db.query("select attendance_private.course_work('[]'::jsonb)"),/permission denied/);
  const own=await saveBusiness(); await db.query('reset role'); await identity(uid2);
  assert.equal((await db.query('select * from public.attendance_records where id=$1',[own.id])).rows.length,0);
  assert.equal((await db.query("select public.av2_validate_attendance_month_dashboard(1,'2026-10') value")).rows[0].value.length,0);
});
test('group course travel uses one school destination, retains corrections and does not multiply trips', async t => {
  if(!required(t))return;
  await db.query('reset role');
  await db.query("insert into public.contacts_instructors values(1,'origin')");
  await db.query("insert into public.schools values(101,'הרצל','destination',null)");
  await identity(); const row=await saveBusiness();
  const context=(await db.query('select public.av2_attendance_travel_context($1,$2) value',[row.id,uid1])).rows[0].value;
  assert.equal(context.eligible,true); assert.equal(context.activity_row_id,null); assert.equal(context.destination_entity_key,'school_id:101');
  await db.query("update public.attendance_records set notes='correction' where id=$1",[row.id]);
  const corrected=(await db.query('select public.av2_attendance_travel_context($1,$2) value',[row.id,uid1])).rows[0].value;
  assert.equal(corrected.fingerprint,context.fingerprint);
});

test('trusted service actor resolves grouped travel without an end-user JWT', async t => {
  if(!required(t))return;
  const row=await saveBusiness(); await db.query('reset role');
  await db.query("insert into public.contacts_instructors values(1,'origin')");
  await db.query("insert into public.schools values(101,'הרצל','destination',null)");
  await db.query("select set_config('test.uid','',false)");
  const ctx=(await db.query('select public.av2_prepare_attendance_travel($1,$2) value',[row.id,uid1])).rows[0].value;
  assert.equal(ctx.eligible,true); assert.equal(ctx.emp_id,1);
  assert.equal(ctx.destination_entity_key,'school_id:101');
  await assert.rejects(db.query('select public.av2_prepare_attendance_travel($1,$2)',[row.id,uid2]),/source_not_found/);
});
test('grouped cancellation lifecycle: automatic once, manual 0:00, unchanged correction, reset and closed-month guard', async t => {
  if(!required(t))return;
  const row=await saveBusiness(); await db.query('reset role');
  await db.query("insert into public.contacts_instructors values(1,'origin')");
  await db.query("insert into public.schools values(101,'הרצל','destination',null)");
  const ctx=(await db.query('select public.av2_prepare_attendance_travel($1,$2) value',[row.id,uid1])).rows[0].value;
  await db.query('select public.av2_reconcile_attendance_travel($1,$2,65,60,null)',[row.id,ctx.fingerprint]);
  assert.equal((await db.query("select count(*)::int n from public.attendance_records where generation_kind='travel_time_cancellation'")).rows[0].n,1);
  await identity();
  let correction=(await db.query('select public.av2_override_attendance_time_cancellation($1,0) value',[row.id])).rows[0].value;
  assert.equal(correction.final_cancellation_minutes,0); assert.equal(correction.manually_overridden,true);
  await db.query("update public.attendance_records set notes='correction' where id=$1",[row.id]);
  await db.query('reset role');
  const unchanged=(await db.query('select public.av2_prepare_attendance_travel($1,$2) value',[row.id,uid1])).rows[0].value;
  assert.equal(unchanged.context_changed,false); assert.equal(unchanged.final_cancellation_minutes,0);
  await identity();
  correction=(await db.query('select public.av2_override_attendance_time_cancellation($1,35) value',[row.id])).rows[0].value;
  assert.equal(correction.final_cancellation_minutes,35); assert.equal(correction.manually_overridden,false);
  await db.query("select set_config('test.month_open','false',false)");
  await assert.rejects(db.query('select public.av2_override_attendance_time_cancellation($1,0)',[row.id]),/month_locked/);
});
test('business school-name fallback is used only without IDs and still writes all matching sources', async t => {
  if(!required(t))return;
  await db.query('reset role'); await db.query("update public.activities set single_school_id=null, linked_schools_json='null'::jsonb"); await identity();
  const row=await saveBusiness({school:null,identity:['ביומימיקרי',['name','הרצל']]});
  assert.equal(row.course_dashboard_sources.length,2); assert.equal(row.school_id,null);
});

test('actual dashboard school IDs separate identically named schools through option selection and persisted sources', async t => {
  if(!required(t))return;
  await db.query('reset role'); await db.query("update public.activities set single_school_id=102 where row_id='c2'"); await identity();
  const options=buildDashboardCourseOptions(await choices()); assert.equal(options.length,2);
  const first=await saveBusiness(); const second=await saveBusiness({school:102,identity:['ביומימיקרי',['id','102']]});
  assert.deepEqual(first.course_dashboard_sources.map(x=>x.row_id),['c1']);
  assert.deepEqual(second.course_dashboard_sources.map(x=>x.row_id),['c2']);
});
