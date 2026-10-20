import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';

const connectionString = process.env.SCHEDULING_MANUAL_TEST_DATABASE_URL;
const actor = '00000000-0000-4000-8000-000000000001';

// This deliberately rebuilds only a named local disposable test database.
// Never use a Supabase/production URL, a forwarded remote host, or the postgres database.
function assertDisposable(url) {
  const parsed = new URL(url);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
    || !/^\/[a-z0-9_]+_test$/.test(parsed.pathname)) throw Error('disposable_local_test_database_required');
}
const columns = Array.from({ length: 35 }, (_, i) => 'date_' + (i + 1) + ' date').join(',');
const bootstrap = `
drop schema if exists scheduling_manual_private cascade;
drop schema public cascade;
create schema public;
create schema if not exists auth;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
end $$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
create table public.users(auth_user_id uuid primary key,is_active boolean,role text);
create table public.contacts_instructors(emp_id bigint primary key,full_name text,address text,active text);
create table public.activities(
  row_id text primary key,activity_season text,activity_type text,activity_no text,status text,
  school_id bigint,school text,authority_id bigint,authority text,
  instruction_language text,required_instructor_gender text,sessions text,
  emp_id bigint,emp_id_2 text,instructor_name text,instructor_name_2 text,
  instructor_assignment_locked boolean default false,instructor_assignment_status text,
  draft_emp_id text,draft_instructor_name text,draft_created_at timestamptz,draft_created_by uuid,
  draft_proposed_meetings jsonb,start_time time,end_time time,start_date date,end_date date,
  updated_at timestamptz default clock_timestamp(),notes text,${columns});
create table public.instructor_scheduling_profiles(
  emp_id bigint primary key,gender text,instruction_languages text[],course_restriction_mode text,
  course_ids text[],blocked_authorities text[],friday_allowed boolean);
create table public.instructor_availability_rules(emp_id bigint,weekday integer,available boolean,start_time time,end_time time);
create table public.instructor_availability_exceptions(emp_id bigint,exception_date date,available boolean,start_time time,end_time time);
create table public.course_meeting_cancellations(activity_id text,meeting_date date);
create table public.course_meeting_instructor_history(activity_id text,meeting_date date,emp_id text,instructor_name text,
  assignment_kind text default 'history',previous_emp_id text,reason text,recorded_by uuid,recorded_at timestamptz,availability_approval_id uuid,unique(activity_id,meeting_date));
create table public.activity_completion_approval_uploads(activity_row_id text,activity_date date,status text);
create table public.school_calendar(id bigserial,title text,is_active boolean,blocks_scheduling boolean,start_date date,end_date date,calendar_sector text,enforce_end_time boolean default false,school_day_end_time time);
create table public.scheduling_instructor_intents(activity_id text primary key,emp_id bigint,status text,version bigint,reason text,
  updated_at timestamptz,updated_by uuid);
create table public.instructor_assignment_audit(
  id uuid primary key default gen_random_uuid(),activity_id text,selected_emp_id text,selected_instructor_name text,
  decision_type text,reason text,selected_by uuid,created_at timestamptz default clock_timestamp(),
  previous_status text,new_status text,previous_emp_id text,previous_instructor_name text,
  meetings_completed_at_decision integer,effective_from date,decision_context jsonb);
create table public.edit_requests(request_type text,source_row_id text,status text,requested_payload jsonb);
create table public.fixture_routes(origin text,destination text,km numeric,minutes integer);
create function public.app_has_permission(text) returns boolean language sql stable as $$
 select exists(select 1 from public.users where auth_user_id=auth.uid() and is_active and role in ('admin','operation_manager'))
$$;
create function public.scheduling_lock_instructor_for_write(bigint) returns void language sql as $$
 select pg_advisory_xact_lock(hashtext('instructor'),hashtext($1::text))
$$;
create function public.scheduling_school_location(bigint,text,bigint,text) returns text language sql stable as $$
 select case when $1 is not null then 'school-'||$1::text else null end
$$;
create function public.scheduling_cached_travel_distance_km(text,text) returns numeric language sql stable as $$
 select km from public.fixture_routes where origin=$1 and destination=$2 limit 1
$$;
create function public.scheduling_cached_travel_minutes(text,text) returns integer language sql stable as $$
 select minutes from public.fixture_routes where origin=$1 and destination=$2 limit 1
$$;
create function public.scheduling_transition_buffer_minutes(numeric) returns integer language sql immutable as $$
 select case when $1 is not null and $1<=10 then 10 else 15 end
$$;
create function public.scheduling_authority_name_is_blocked(text[],text) returns boolean language sql immutable as $$
 select coalesce($2=any($1),false)
$$;
create function public.school_calendar_sector_for_school_id(bigint) returns text language sql immutable as $$ select 'jewish'::text $$;
create function public.school_calendar_sector_for_activity(text) returns text language sql stable as $ select 'jewish'::text $;
create function public.school_calendar_eden_20260930_request(date) returns boolean language sql stable as $ select false $;
create function public.school_calendar_activity_exception_exists(text,date) returns boolean language sql stable as $$ select false $$;
create function public.school_calendar_event_applies(text,text) returns boolean language sql immutable as $$ select $1 in ('general',$2) $$;
create function public.scheduling_effective_end_time(text,date,time) returns time language sql stable as $$ select $3 $$;
create function public.scheduling_activity_is_full_day_tour(public.activities) returns boolean language sql stable as $$
 select $1.activity_type='סיור'
$$;
create function public.scheduling_activity_official_meetings(public.activities) returns jsonb language sql stable as $
 select coalesce(jsonb_agg(jsonb_build_object('date',d) order by d),'[]'::jsonb) from (
   select nullif(to_jsonb($1)->>('date_'||n),'')::date d from generate_series(1,35) n
 ) dates where d is not null
$;
create function public.scheduling_effective_meetings(public.activities,bigint) returns jsonb language sql stable as $$
 select coalesce(jsonb_agg(jsonb_build_object('date',d,'start_time',$1.start_time,'end_time',$1.end_time) order by d),'[]'::jsonb)
 from (
  select (x->>'date')::date d from jsonb_array_elements($1.draft_proposed_meetings) x
    where $1.draft_emp_id=$2::text and $1.draft_proposed_meetings is not null
  union all select nullif(to_jsonb($1)->>('date_'||n),'')::date d from generate_series(1,35) n
    where not coalesce($1.draft_emp_id=$2::text and $1.draft_proposed_meetings is not null,false)
 ) dates where d is not null and not exists(
   select 1 from public.course_meeting_cancellations c where c.activity_id=$1.row_id and c.meeting_date=d)
$$;
create function public.scheduling_course_meetings_completed(text) returns integer language sql stable as $$
 select count(*)::integer from public.activities a,generate_series(1,35) n
 where a.row_id=$1 and nullif(to_jsonb(a)->>('date_'||n),'')::date<current_date
$$;
create function public.scheduling_course_instructor_violations(text,bigint,boolean) returns text[] language sql stable as $$
 select array['scheduling_home_route_unverified']::text[]
$$;
create function public.scheduling_manual_draft_requires_manager_approval(text,bigint,text) returns boolean language sql stable as $$ select true $$;
create function public.fixture_touch() returns trigger language plpgsql as $$ begin new.updated_at:=clock_timestamp();return new;end $$;
create trigger fixture_touch before update on public.activities for each row execute function public.fixture_touch();
`;

test('manual operations gateway on isolated local PostgreSQL', { skip: !connectionString }, async t => {
  assertDisposable(connectionString);
  const client = new Client({ connectionString });
  await client.connect();
  try {
    assert.match((await client.query('select current_database() as db')).rows[0].db, /_test$/);
    await client.query(bootstrap);
    const source = await readFile(new URL('../services/scheduling-agent/manual-operations.sql', import.meta.url), 'utf8');
    await client.query(source);
    // Exercise the actual promotion guard and actual locked revalidation function.
    await client.query(`
      create trigger calendar_guard before update of date_1,date_2,start_date,end_time on public.activities
        for each row execute function public.enforce_school_calendar_on_activity();
      create trigger tour_guard before update of emp_id,draft_emp_id,draft_proposed_meetings,date_1,date_2 on public.activities
        for each row execute function public.scheduling_guard_full_day_tour_conflicts();
      create trigger manual_approval before update of emp_id,draft_emp_id,instructor_assignment_locked on public.activities
        for each row execute function public.scheduling_guard_manual_exception_approval();
      create function public.fixture_revalidate() returns trigger language plpgsql as $$
      declare reason text;
      begin
        if pg_trigger_depth()>1 or new.emp_id is null then return new;end if;
        reason:=public.scheduling_locked_course_validation_reason(new.row_id);
        if reason is not null then update public.activities set instructor_assignment_status='נדרש טיפול' where row_id=new.row_id;end if;
        return new;
      end $$;
      create trigger fixture_revalidate after update on public.activities for each row execute function public.fixture_revalidate();
    `);
    const reset = async () => {
      await client.query(`
        truncate public.activities,public.contacts_instructors,public.instructor_scheduling_profiles,
          public.instructor_availability_rules,public.instructor_availability_exceptions,
          public.course_meeting_instructor_history,public.course_meeting_cancellations,
          public.activity_completion_approval_uploads,public.scheduling_instructor_intents,
          public.instructor_assignment_audit,public.fixture_routes,public.users,public.school_calendar,
          scheduling_manual_private.decisions;
        insert into public.users values('${actor}',true,'operation_manager');
        insert into public.contacts_instructors values(1507,'מדריך א','home-a','yes'),(1508,'מדריך ב','home-b','yes');
        insert into public.instructor_scheduling_profiles values
          (1507,'male',array['he'],'all','{}','{}',true),(1508,'male',array['he'],'all','{}','{}',true);
        insert into public.instructor_availability_rules
          select emp,day,true,time '08:00',time '20:00' from unnest(array[1507,1508]) emp,generate_series(0,6) day;
        insert into public.activities(row_id,activity_season,activity_type,status,school_id,school,authority,
          instruction_language,required_instructor_gender,sessions,start_time,end_time,date_1,date_2,start_date,end_date)
          values('manual-a','school_2027','קורס','פתוח',10,'בדיקה','רשות','he','any','2',
            '08:15','09:45','2027-05-05','2027-05-12','2027-05-05','2027-05-12');
        select set_config('request.jwt.claim.sub','${actor}',false);
      `);
    };
    const params = async (changes = {}) => ({
      p_activity_id: 'manual-a',p_emp_id: 1507,
      p_meetings: [{ date: '2027-05-05' },{ date: '2027-05-12' }],
      p_start_time: '08:15',p_end_time: '09:45',p_action: 'confirm',p_effective_from: null,
      p_expected_updated_at: (await client.query("select updated_at::text as updated_at from public.activities where row_id='manual-a'")).rows[0].updated_at,
      ...changes
    });
    const rpc = async (name, args) => {
      const entries = Object.entries(args);
      const query = 'select public.'+name+'('+entries.map(([key],index) => key+' => $'+(index+1)).join(',')+') as result';
      return (await client.query(query,entries.map(([,value]) => Array.isArray(value) ? JSON.stringify(value) : value))).rows[0].result;
    };
    const preview = args => rpc('get_scheduling_manual_assignment_preview',args);
    const commit = (args,p,extra={}) => rpc('commit_scheduling_manual_assignment',{
      ...args,p_preview_hash:p.previewHash,p_acknowledge_warnings:true,p_reason:'נבדק ידנית',...extra });

    await t.test('operator can acknowledge missing route and retain a valid locked assignment', async () => {
      await reset();const args=await params();const p=await preview(args);
      assert.equal(p.blockers.length,0);
      assert.ok(p.warnings.some(w=>w.code==='manual_home_route_unknown'));
      await assert.rejects(commit(args,p,{p_acknowledge_warnings:false}),/scheduling_manual_acknowledgement_required/);
      await commit(args,p);
      assert.equal((await client.query("select instructor_assignment_status from public.activities where row_id='manual-a'")).rows[0].instructor_assignment_status,'שובץ');
      assert.equal((await client.query('select count(*)::int n from scheduling_manual_private.decisions')).rows[0].n,1);
    });

    await t.test('anonymous inactive and non-operator callers are denied', async () => {
      await reset();const args=await params();
      await client.query("select set_config('request.jwt.claim.sub','',false)");
      await assert.rejects(preview(args),/scheduling_permission_denied/);
      await client.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
      await client.query("update public.users set role='instructor'");
      await assert.rejects(preview(args),/scheduling_permission_denied/);
      await client.query("update public.users set role='admin',is_active=false");
      await assert.rejects(preview(args),/scheduling_permission_denied/);
    });

    await t.test('activity change after preview rejects the stale save', async () => {
      await reset();const args=await params();const p=await preview(args);
      await client.query("update public.activities set notes='changed' where row_id='manual-a'");
      await assert.rejects(commit(args,p),/scheduling_activity_revision_conflict/);
    });

    await t.test('new overlap after preview is checked again inside commit', async () => {
      await reset();const args=await params();const p=await preview(args);
      await client.query(`insert into public.activities(row_id,activity_season,status,activity_type,emp_id,date_1,start_time,end_time)
        values('overlap','school_2027','פתוח','קורס',1507,'2027-05-05','09:00','10:00')`);
      await assert.rejects(commit(args,p),/scheduling_manual_preview_changed/);
      const current=await preview(args);assert.ok(current.warnings.some(w=>w.code==='scheduling_conflict_detected'));
      await commit(args,current);
      assert.equal((await client.query("select emp_id from public.activities where row_id='manual-a'")).rows[0].emp_id,'1507');
    });

    await t.test('known insufficient transition is explicit and requires operator acknowledgement', async () => {
      await reset();
      await client.query(`insert into public.activities(row_id,activity_season,status,activity_type,emp_id,school_id,date_1,start_time,end_time)
        values('next','school_2027','פתוח','קורס',1507,11,'2027-05-05','10:00','11:00');
        insert into public.fixture_routes values('school-10','school-11',10,25)`);
      const args=await params();const p=await preview(args);
      assert.ok(p.warnings.some(w=>w.code==='scheduling_transition_insufficient'));
      await assert.rejects(commit(args,p,{p_acknowledge_warnings:false}),/scheduling_manual_acknowledgement_required/);
      await commit(args,p);
    });

    await t.test('replacing an instructor preserves attribution before the effective date', async () => {
      await reset();
      await client.query("update public.activities set emp_id=1507,instructor_name='מדריך א',instructor_assignment_locked=true where row_id='manual-a'");
      const args=await params({p_emp_id:1508,p_effective_from:'2027-05-12'});const p=await preview(args);
      await commit(args,p);
      const h=(await client.query("select * from public.course_meeting_instructor_history where activity_id='manual-a'")).rows;
      assert.equal(h.length,1);assert.equal(h[0].emp_id,'1507');
      assert.equal((await client.query("select emp_id from public.activities where row_id='manual-a'")).rows[0].emp_id,'1508');
    });

    await t.test('protected history cannot be moved or retimed', async () => {
      await reset();
      await client.query("insert into public.course_meeting_instructor_history(activity_id,meeting_date,emp_id,instructor_name,assignment_kind) values('manual-a','2027-05-05','1507','מדריך א','history')");
      const args=await params({p_start_time:'08:30'});
      await assert.rejects(preview(args),/scheduling_historical_meetings_protected/);
    });

    await t.test('a different intended instructor requires acknowledgement and is explicitly released', async () => {
      await reset();
      await client.query("insert into public.scheduling_instructor_intents(activity_id,emp_id,status,version,reason) values('manual-a',1508,'active',1,'בחירה קודמת')");
      const args=await params();const p=await preview(args);
      assert.ok(p.warnings.some(w=>w.code==='manual_intended_instructor_changed'));
      await commit(args,p);
      assert.equal((await client.query("select status from public.scheduling_instructor_intents where activity_id='manual-a'")).rows[0].status,'released');
    });

    await t.test('unavailable inactive language and calendar limitations are warning-only for the operator', async () => {
      await reset();
      await client.query("update public.contacts_instructors set active='no' where emp_id=1507");
      await client.query("update public.instructor_scheduling_profiles set instruction_languages=array['ar'] where emp_id=1507");
      await client.query("update public.instructor_availability_rules set available=false where emp_id=1507");
      await client.query("insert into public.school_calendar(is_active,blocks_scheduling,start_date,end_date,calendar_sector,title) values(true,true,'2027-05-05','2027-05-05','general','בדיקה')");
      const args=await params();const p=await preview(args);
      for(const code of ['instructor_inactive','scheduling_language_mismatch','scheduling_instructor_unavailable','scheduling_school_calendar_blocked'])
        assert.ok(p.warnings.some(w=>w.code===code),code);
      assert.equal(p.blockers.length,0);await commit(args,p);
      assert.equal((await client.query("select instructor_assignment_status from public.activities where row_id='manual-a'")).rows[0].instructor_assignment_status,'שובץ');
    });

    await t.test('draft reserves chosen hours without changing official hours', async () => {
      await reset();let args=await params({p_start_time:'10:00',p_end_time:'11:30',p_action:'draft'});
      await commit(args,await preview(args));
      let a=(await client.query("select * from public.activities where row_id='manual-a'")).rows[0];
      assert.equal(a.start_time,'08:15:00');assert.equal(a.draft_proposed_meetings[0].start_time,'10:00:00');
      const effective=(await client.query("select public.scheduling_effective_meetings(a,1507) as m from public.activities a where row_id='manual-a'")).rows[0].m;
      assert.equal(effective[0].start_time,'10:00:00');
      args=await params({p_start_time:'10:00',p_end_time:'11:30',p_action:'confirm'});
      await commit(args,await preview(args));
      a=(await client.query("select * from public.activities where row_id='manual-a'")).rows[0];
      assert.equal(a.start_time,'10:00:00');assert.equal(a.draft_emp_id,null);
    });

    await t.test('short school day can be explicitly acknowledged without silently shortening the chosen time', async () => {
      await reset();
      await client.query("insert into public.school_calendar(is_active,blocks_scheduling,enforce_end_time,school_day_end_time,start_date,end_date,calendar_sector,title) values(true,false,true,'09:00','2027-05-05','2027-05-05','general','יום קצר')");
      const args=await params();const p=await preview(args);
      assert.ok(p.warnings.some(w=>w.code==='manual_short_school_day'));await commit(args,p);
      const m=(await client.query("select public.scheduling_effective_meetings(a,1507) as m from public.activities a where row_id='manual-a'")).rows[0].m;
      assert.equal(m[0].end_time,'09:45:00');
    });

    await t.test('private decision receipts are inaccessible to client roles', async () => {
      await reset();
      const row=(await client.query("select has_schema_privilege('authenticated','scheduling_manual_private','USAGE') s,has_table_privilege('authenticated','scheduling_manual_private.decisions','INSERT') i")).rows[0];
      assert.equal(row.s,false);assert.equal(row.i,false);
    });

  } finally { await client.end(); }
});
