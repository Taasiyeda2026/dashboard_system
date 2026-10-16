import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const modulePath=process.env.PGLITE_MODULE_PATH;
test('planning intent PostgreSQL contracts', {skip:!modulePath},async t=>{
 const {PGlite}=await import(modulePath);const db=new PGlite();
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create table auth.users(id uuid primary key);insert into auth.users values('11111111-1111-4111-8111-111111111111');
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create table contacts_instructors(emp_id bigint primary key,active text);
 insert into contacts_instructors values(1,'yes'),(2,'yes');
 create table activities(row_id text primary key,activity_season text,activity_type text,status text,emp_id bigint,emp_id_2 text,instructor_assignment_locked boolean,draft_emp_id text,start_time time,end_time time);
 insert into activities values('course-1','school_2027','course','פתוח',null,null,false,null,null,null);
 create table course_meeting_cancellations(activity_id text,meeting_date date);
 create table scheduling_planning_rows(activity_id text,needs_recalc boolean,row_data jsonb,locked_option jsonb);
 insert into scheduling_planning_rows values('course-1',false,'{"instructorEmpId":"2","options":[{}]}',null);
 create table scheduling_planning_source_state(singleton boolean,revision bigint,updated_at timestamptz);insert into scheduling_planning_source_state values(true,1,now());
 create function scheduling_activity_official_meetings(a activities) returns jsonb language sql as $$select '[]'::jsonb$$;
 create function scheduling_agent_team_assert_member() returns void language plpgsql as $$begin if auth.uid() is null then raise exception 'permission_denied' using errcode='42501';end if;end$$;
 `);
 await db.exec(readFileSync(new URL('../supabase/migrations/20261016123512_scheduling_agent_planning_intents.sql',import.meta.url),'utf8'));
 await t.test('anonymous callers cannot save',async()=>{
  await assert.rejects(db.query("select scheduling_agent_team_save_planning_baseline(1,'Sunday',0)"),/permission_denied/);
  const p=await db.query("select has_function_privilege('anon','scheduling_agent_team_save_planning_baseline(bigint,text,bigint)','execute') allowed");assert.equal(p.rows[0].allowed,false);
 });
 await db.exec("select set_config('test.uid','11111111-1111-4111-8111-111111111111',false)");
 await t.test('baseline persists independently with version and audit',async()=>{
  await db.query("select scheduling_agent_team_save_planning_baseline(1,'Sunday: primary; alternative only',0)");
  await assert.rejects(db.query("select scheduling_agent_team_save_planning_baseline(1,'overwrite',0)"),/planning_intent_version_conflict/);
  const r=await db.query('select scheduling_agent_team_read_planning_intents(1) result');assert.equal(r.rows[0].result.baselines[0].version,'1');
 });
 await t.test('undated instructor choice clears old proposals, fences runs, never assigns',async()=>{
  await db.query("select scheduling_agent_team_save_intended_instructor('course-1',1,'Pending dates','active',0)");
  const r=await db.query('select emp_id from activities');assert.equal(r.rows[0].emp_id,null);
  const p=await db.query('select row_data,needs_recalc from scheduling_planning_rows');assert.equal(p.rows[0].row_data.instructorEmpId,null);assert.equal(p.rows[0].needs_recalc,true);
  assert.equal((await db.query('select revision from scheduling_planning_source_state')).rows[0].revision,2);
 });
 await t.test('stale workers and conflicting manual assignments cannot overwrite a hold',async()=>{
  await assert.rejects(db.query(`update scheduling_planning_rows set row_data='{"instructorEmpId":"2"}'`),/planning_intent_protected/);
  await assert.rejects(db.query("update activities set emp_id_2='2' where row_id='course-1'"),/planning_intent_protected/);
  await assert.rejects(db.query("update activities set emp_id=2 where row_id='course-1'"),/planning_intent_protected/);
  await assert.rejects(db.query("select scheduling_agent_team_save_intended_instructor('course-1',2,'overwrite','active',0)"),/planning_intent_version_conflict/);
 });
 await t.test('explicit versioned release permits normal optimization again',async()=>{
  await db.query("select scheduling_agent_team_save_intended_instructor('course-1',1,'User released','released',1)");
  await db.query(`update scheduling_planning_rows set row_data='{"instructorEmpId":"2"}'`);
  assert.equal((await db.query('select count(*)::int n from scheduling_intent_audit')).rows[0].n,3);
 });
 }finally{await db.close();}
});
