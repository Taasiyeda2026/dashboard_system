import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { performance } from 'node:perf_hooks';
import { runPlanningPreflight, startPlanningLeaseHeartbeat } from '../frontend/src/screens/course-scheduling-preflight.js';

import { prepareSchedulingRunContext, preliminaryCourseCandidatesCooperatively } from '../frontend/src/screens/course-scheduling-engine.js';
import { createPlanningCheckpoint } from '../frontend/src/screens/course-scheduling-planning.js';

const connectionString = process.env.PLANNING_RUN_TEST_DATABASE_URL;
if (connectionString) {
  const url = new URL(connectionString);
  if (!['127.0.0.1','localhost'].includes(url.hostname) || url.pathname !== '/codex_planning_run_test') {
    throw new Error('Use a disposable localhost database named codex_planning_run_test');
  }
}
const client = connectionString ? new pg.Client({ connectionString }) : null;
const ownerA = '11111111-1111-4111-8111-111111111111';
const ownerB = '22222222-2222-4222-8222-222222222222';
const runA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const runB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const scope = { periodKey:'year', district:'center' };
const sqlFile = path => readFile(new URL(path, import.meta.url), 'utf8');
const required = t => { if (client) return true; t.skip('Set PLANNING_RUN_TEST_DATABASE_URL to the disposable local PostgreSQL database'); return false; };
async function identity(db, uid=ownerA) { await db.query("select set_config('test.uid',$1,false),set_config('test.role','admin',false)",[uid]); }
async function facts() { return (await client.query("select public.get_scheduling_planning_preflight('year','center') value")).rows[0].value; }
async function acquire(id=runA,db=client) { return (await db.query("select public.acquire_scheduling_planning_run_lease('year','center',$1,120) value",[id])).rows[0].value; }
async function save(id=runA,expected=null,source=null) {
  const f=await facts();
  return (await client.query("select public.save_scheduling_planning_incremental_snapshot('year','center','current','data','context','[]'::jsonb,'[]'::jsonb,$1,$2,$3) value",[expected ?? f.workspace.revision,id,source ?? f.sourceRevision])).rows[0].value;
}

before(async () => {
  if (!client) return;
  await client.connect();
  await client.query('drop schema if exists public cascade; drop schema if exists auth cascade; create schema public');
  let fixture=await sqlFile('./fixtures/planning-invalidation-postgres-schema.sql');
  fixture=fixture.replace('create role authenticated;',()=>"do $$ begin if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if; end $$;");
  await client.query(fixture);
  await client.query("do $$ begin if not exists(select from pg_roles where rolname='anon') then create role anon; end if; if not exists(select from pg_roles where rolname='service_role') then create role service_role; end if; end $$;");
  await client.query(`alter table public.scheduling_planning_rows rename constraint scheduling_planning_rows_workspace_id_activity_id_key to scheduling_planning_rows_pkey;
    alter table public.users add column full_name text, add column name text, add column email text;
    alter table public.scheduling_planning_workspaces add column engine_version text not null default '', add column data_fingerprint text not null default '', add column context_fingerprint text not null default '', add column calculated_at timestamptz; alter table public.scheduling_planning_workspaces alter column revision set default 0;
    alter table public.activities add column calendar_sector text,add column draft_proposed_meetings jsonb,add column education_level text,add column district text;
    create table public.schools(id bigint primary key,sector text,institution_address text);
    create table public.school_calendar(id bigint primary key,start_date date,end_date date,calendar_sector text,is_active boolean,show_on_main_calendar boolean,title text);
    create table public.proposal_activity_pricing(id bigint primary key,activity_name text,activity_no text,meetings_count integer,hours_count numeric);
    create table public.contacts_schools(id bigint primary key,school_id bigint,address text,school text,authority text,authority_id bigint);
    create table public.authorities(id bigint primary key,name text);
    create table public.course_meeting_cancellations(id bigint primary key,activity_id text,meeting_date date);
    create table public.activity_completion_approval_uploads(id bigint primary key,activity_row_id text,status text);
    create table public.scheduling_course_meeting_substitutions(id bigint primary key,activity_id text,emp_id bigint);
    create table public.scheduling_travel_cache(id bigint primary key,origin_address text,destination_address text,distance_km numeric,duration_minutes numeric,updated_at timestamptz);
  `);
  await client.query(`create function public.scheduling_school_location(p_school_id bigint,p_school text,p_authority_id bigint,p_authority text) returns text language sql stable as $$ select coalesce((select address from public.contacts_schools where school_id=p_school_id order by id desc limit 1),(select institution_address from public.schools where id=p_school_id),concat_ws(', ',p_school,p_authority)) $$`);
  const v26=await sqlFile('../supabase/migrations/20261003170000_planning_v26_coherent_school_first.sql');
  const instructorHelperStart=v26.indexOf('create or replace function public.scheduling_planning_row_instructor_ids(');
  await client.query(v26.slice(instructorHelperStart,v26.indexOf('$$;',instructorHelperStart)+3));
  for (const file of ['20260924145500_shared_incremental_course_planning.sql','20260926195500_planning_silent_checkpoints.sql','20261004193000_optimize_planning_persistence.sql','20261005193000_scheduling_planning_run_leases.sql','20261005234644_planning_preflight_and_fenced_runs.sql']) {
    await client.query(await sqlFile('../supabase/migrations/'+file));
  }
  // Exercise the new epoch/commit fence with the deployed granular triggers.
  for (const file of ['20260927180000_mark_scheduling_planning_needs_recalc.sql','20260927200000_fix_planning_invalidation_activity_id_ambiguity.sql']) {
    await client.query(await sqlFile('../supabase/migrations/'+file));
  }
  const invalidation=await sqlFile('../supabase/migrations/20260927190000_planning_self_invalidation.sql');
  await client.query(invalidation.slice(0,invalidation.indexOf('-- Confirm: refuse stale dirty drafts')));
  for (const file of ['20260929190000_keep_live_planning_rows_out_of_dependency_invalidation.sql','20260930001500_narrow_activity_planning_invalidation.sql']) {
    await client.query(await sqlFile('../supabase/migrations/'+file));
  }
  await identity(client);
});

beforeEach(async () => {
  if (!client) return;
  await identity(client);
  await client.query(`truncate public.scheduling_planning_rows,public.scheduling_planning_workspaces,public.scheduling_planning_run_leases,public.scheduling_planning_checkpoints,public.activities,public.schools,public.school_calendar,public.proposal_activity_pricing,public.contacts_schools,public.course_meeting_cancellations,public.activity_completion_approval_uploads,public.scheduling_course_meeting_substitutions,public.scheduling_travel_cache,public.instructor_scheduling_profiles,public.instructor_availability_rules,public.instructor_availability_exceptions,public.contacts_instructors restart identity cascade;
    insert into public.activities(row_id,activity_season,school_id,activity_name,calendar_sector,date_1) values ('one','school_2027',1,'Program','general','2027-01-03'),('two','school_2027',2,'Other','general','2027-01-10');
    insert into public.schools values (1,'general','Address 1'),(2,'general','Address 2');
    insert into public.scheduling_planning_workspaces(period_key,district,engine_version,validated_source_revision) select 'year','center','current',revision from public.scheduling_planning_source_state;
    insert into public.scheduling_planning_rows(workspace_id,activity_id,row_data,activity_updated_at) select w.id,a.row_id,jsonb_build_object('courseId',a.row_id,'kind','proposal','schoolId',a.school_id,'meetings',jsonb_build_array(jsonb_build_object('date',a.date_1))),a.updated_at from public.scheduling_planning_workspaces w cross join public.activities a;
  `);
});
after(async () => { await client?.end(); });

test('PostgreSQL preflight: no-op reads exactly one small RPC and performs zero heavy work',async t=>{
  if(!required(t))return;
  let reads=0,acquires=0;
  const started=performance.now();
  const result=await runPlanningPreflight({scope,runId:runA,engineVersion:'current',load:async()=>{reads++;return facts();},acquire:async()=>{acquires++;return acquire();}});
  assert.equal(result.decision,'no-op');assert.equal(reads,1);assert.equal(acquires,0);
  assert.ok(JSON.stringify(result.facts).length<1000);
  console.log('POSTGRES_PREFLIGHT_MS',performance.now()-started);
});

test('PostgreSQL preflight: activity-sensitive changes are granular and notes are ignored',async t=>{
  if(!required(t))return;
  const original=await facts();await client.query("update public.activities set notes='note' where row_id='one'");
  assert.equal((await facts()).sourceRevision,original.sourceRevision);
  await client.query("update public.activities set education_level='Changed' where row_id='one'");
  const changed=await facts();assert.equal(changed.dirtyCount,1);assert.notEqual(changed.sourceRevision,original.sourceRevision);
});

test('PostgreSQL preflight: every snapshot source has transactional invalidation',async t=>{
  if(!required(t))return;
  for(const table of ['activities','contacts_instructors','instructor_scheduling_profiles','instructor_availability_rules','instructor_availability_exceptions','school_calendar','proposal_activity_pricing','schools','contacts_schools','authorities','course_meeting_cancellations','activity_completion_approval_uploads','scheduling_course_meeting_substitutions','scheduling_travel_cache']) {
    const result=await client.query("select count(*) n from pg_trigger where tgrelid=$1::regclass and tgname='zz_planning_source_revision'",['public.'+table]);
    assert.equal(Number(result.rows[0].n),1,table);
  }
  const old=await facts();await client.query("update public.schools set sector='arab' where id=1");
  const updated=await facts();assert.notEqual(updated.sourceRevision,old.sourceRevision);assert.equal(updated.dirtyCount,1);
  await client.query('begin');await client.query("update public.activities set activity_name='rollback' where row_id='two'");await client.query('rollback');
  assert.equal((await facts()).sourceRevision,updated.sourceRevision);
});

test('PostgreSQL leases: different run IDs for the same owner are blocked before heavy work',async t=>{
  if(!required(t))return;
  assert.equal((await acquire()).acquired,true);
  const result=await runPlanningPreflight({scope,runId:runB,engineVersion:'current',load:facts,acquire:()=>{throw Error('active lease must stop before acquire');}});
  assert.equal(result.decision,'blocked');assert.equal((await acquire(runB)).acquired,false);
});

test('PostgreSQL leases: different owners and simultaneous acquire serialize',async t=>{
  if(!required(t))return;
  const other=new pg.Client({connectionString});await other.connect();await identity(other,ownerB);
  try {
    const results=await Promise.all([acquire(runA),acquire(runB,other)]);
    assert.equal(results.filter(r=>r.acquired).length,1);
  } finally {await other.end();}
});

test('PostgreSQL leases: stale and expired takeover fence old heartbeat, commit and checkpoint clearing',async t=>{
  if(!required(t))return;
  await acquire();
  await client.query("update public.scheduling_planning_run_leases set heartbeat_at=clock_timestamp()-interval '61 seconds'");
  assert.equal((await facts()).activeLease,null);assert.equal((await acquire(runB)).acquired,true);
  const heartbeat=(await client.query("select public.heartbeat_scheduling_planning_run_lease('year','center',$1,120) value",[runA])).rows[0].value;
  assert.equal(heartbeat.ok,false);
  await assert.rejects(save(runA),/planning_run_ownership_lost/);
  const f=await facts();await assert.rejects(client.query("select public.clear_scheduling_planning_checkpoint('year','center',$1,$2)",[runA,f.sourceRevision]),/planning_run_ownership_lost/);
  await client.query("update public.scheduling_planning_run_leases set expires_at=clock_timestamp()-interval '1 second'");
  assert.equal((await acquire(runA)).acquired,true);
});

test('PostgreSQL commits: expected revision and snapshot source revision are both enforced',async t=>{
  if(!required(t))return;
  await acquire();const f=await facts();
  await assert.rejects(save(runA,f.workspace.revision+1,f.sourceRevision),/planning_revision_conflict/);
  await client.query("insert into public.proposal_activity_pricing values (1,'Program','100',8,1.5)");
  await assert.rejects(save(runA,f.workspace.revision,f.sourceRevision),/planning_source_revision_conflict/);
  assert.equal((await facts()).workspace.revision,f.workspace.revision);
});

test('PostgreSQL checkpoints: fenced saves never advance the engine; lost owners cannot overwrite resume data',async t=>{
  if(!required(t))return;
  await acquire();const f=await facts();
  const rows=[{__planningRunMeta:true,workspaceRevision:f.workspace.revision,phase:'running',sourceRevision:f.sourceRevision},{courseId:'one'}];
  await client.query(`select public.save_scheduling_planning_checkpoint('year','center','future','data','context',1,2,'["one"]',$1,$2,$3)`,[JSON.stringify(rows),runA,f.sourceRevision]);
  const checkpoint=(await facts()).checkpoint;assert.equal(checkpoint.completedCount,1);assert.equal(checkpoint.phase,'running');assert.equal((await facts()).workspace.engineVersion,'current');
  await client.query("update public.scheduling_planning_run_leases set heartbeat_at=clock_timestamp()-interval '61 seconds'");await acquire(runB);
  await assert.rejects(client.query(`select public.save_scheduling_planning_checkpoint('year','center','future','data','context',2,2,'["one","two"]',$1,$2,$3)`,[JSON.stringify(rows),runA,f.sourceRevision]),/planning_run_ownership_lost/);
  assert.equal((await facts()).checkpoint.completedCount,1);
});

test('PostgreSQL leases: success, error and cancellation release only the current owner',async t=>{
  if(!required(t))return;
  for(const status of ['success','error','cancel']){
    await acquire();try{if(status==='success')await save();else throw Error(status);}catch{}finally{await client.query("select public.release_scheduling_planning_run_lease('year','center',$1)",[runA]);}
    assert.equal((await facts()).activeLease,null);
  }
});

test('PostgreSQL checkpoint chunks accumulate distinct rows, update deltas and read complete resume data',async t=>{
  if(!required(t))return;
  await acquire();const f=await facts();const meta={__planningRunMeta:true,sourceRevision:f.sourceRevision,workspaceRevision:f.workspace.revision,phase:'running'};
  const chunk=async(rows,phase='running',total=2)=>client.query(`select public.save_scheduling_planning_checkpoint('year','center','future','data','context',2,$1,'["one","two"]',$2,$3,$4)`,[total,JSON.stringify([{...meta,phase},...rows]),runA,f.sourceRevision]);
  await chunk([{courseId:'one',value:1}]);assert.equal((await facts()).checkpoint.completedCount,1);
  await assert.rejects(chunk([], 'validated'),/checkpoint_incomplete/);
  await chunk([{courseId:'two',value:2}]);await chunk([{courseId:'one',value:3}],'validated');
  const c=(await client.query("select public.get_scheduling_planning_checkpoint('year','center','future','data','context') value")).rows[0].value;
  assert.equal(c.completedCount,2);assert.deepEqual(c.rows.slice(1),[{courseId:'one',value:3},{courseId:'two',value:2}]);
  const parent=(await client.query('select jsonb_array_length(rows_data) n from public.scheduling_planning_checkpoints')).rows[0];assert.equal(parent.n,1);
  await assert.rejects(chunk(Array.from({length:11},(_,i)=>({courseId:String(i)}))),/chunk_too_large/);
  await assert.rejects(chunk([{courseId:'oversized',detail:'x'.repeat(1024*1024)}]),/chunk_too_large/);
  await client.query("select public.clear_scheduling_planning_checkpoint('year','center',$1,$2)",[runA,f.sourceRevision]);
  assert.equal(Number((await client.query('select count(*) n from public.scheduling_planning_checkpoint_rows')).rows[0].n),0);
});

test('PostgreSQL permissions and missing fencing metadata fail closed',async t=>{
  if(!required(t))return;
  await acquire();const f=await facts();
  await assert.rejects(client.query(`select public.save_scheduling_planning_checkpoint('year','center','future','data','context',1,2,'["one"]','[{"courseId":"one"}]',$1,$2)`,[runA,f.sourceRevision]),/meta_required/);
  await assert.rejects(save(null),/ownership_lost/);
  await assert.rejects(client.query("select public.save_scheduling_planning_incremental_snapshot('year','center','current','data','context','[]','[]',null,$1,$2)",[runA,f.sourceRevision]),/revision_required/);
  await client.query("select set_config('test.uid','',false)");
  await assert.rejects(facts(),/permission_denied/);
  await identity(client);
  await client.query('set role authenticated');
  try{await assert.rejects(client.query("select public.save_scheduling_planning_incremental_snapshot_unfenced('year','center','current','data','context','[]','[]',0)"),/permission denied/);}finally{await client.query('reset role');}
});


test('PostgreSQL route currency: warming rescues missing rows; identical renewals do not invalidate; changed facts invalidate proposals',async t=>{
  if(!required(t))return;
  const before=await facts();
  await client.query(`update public.scheduling_planning_rows set row_data=jsonb_set(row_data,'{kind}','"missing"') where activity_id='one';
    insert into public.scheduling_travel_cache(id,origin_address,destination_address,distance_km,duration_minutes) values (1,'home','Address 1',5,10)`);
  const warm=await facts();assert.equal(warm.sourceRevision,before.sourceRevision);assert.equal(warm.dirtyCount,1);
  await client.query('update public.scheduling_planning_rows set needs_recalc=false');
  await client.query('update public.scheduling_travel_cache set updated_at=clock_timestamp()');
  assert.equal((await facts()).sourceRevision,before.sourceRevision);
  await client.query('update public.scheduling_travel_cache set distance_km=50');
  const changed=await facts();assert.notEqual(changed.sourceRevision,before.sourceRevision);assert.equal(changed.dirtyCount,1);
});

test('PostgreSQL joined sources invalidate comma-separated completion IDs and school-name address fallbacks',async t=>{
  if(!required(t))return;
  await client.query(`update public.activities set school='Fallback',authority='Authority' where row_id='one'; update public.scheduling_planning_rows set needs_recalc=false;
    insert into public.contacts_schools(id,address,school,authority) values (1,'New address','Fallback','Authority')`);
  assert.equal((await facts()).dirtyCount,1);
  await client.query(`update public.scheduling_planning_rows set needs_recalc=false; insert into public.activity_completion_approval_uploads(id,activity_row_id,status) values (1,'one, two','approved')`);
  assert.equal((await facts()).dirtyCount,2);
});

test('PostgreSQL canonical full save validates source and revision and cannot be overwritten by an old owner',async t=>{
  if(!required(t))return;
  await client.query('update public.scheduling_planning_workspaces set validated_source_revision=null');
  await acquire();const f=await facts();
  await assert.rejects(save(runA),/source_validation_required/);
  const rows=(await client.query(`select jsonb_build_object('activityId',a.row_id,'activityUpdatedAt',a.updated_at,'row',r.row_data) item from public.activities a join public.scheduling_planning_rows r on r.activity_id=a.row_id`)).rows.map(r=>r.item);
  const commit=(id,revision=f.workspace.revision)=>client.query(`select public.save_scheduling_planning_snapshot('year','center','future','data','context',$1,$2,$3,$4)`,[JSON.stringify(rows),revision,id,f.sourceRevision]);
  await commit(runA);const saved=await facts();assert.equal(saved.workspace.revision,f.workspace.revision+1);assert.equal(saved.workspace.engineVersion,'future');assert.equal(saved.workspace.validatedSourceRevision,f.sourceRevision);
  await client.query("update public.scheduling_planning_run_leases set heartbeat_at=clock_timestamp()-interval '61 seconds'");await acquire(runB);
  await assert.rejects(commit(runA,saved.workspace.revision),/ownership_lost/);
});


test('PostgreSQL source mutation and canonical commit serialize without deadlock and reject the obsolete token',async t=>{
  if(!required(t))return;
  await acquire();const f=await facts();
  const other=new pg.Client({connectionString});await other.connect();await identity(other);
  try {
    await other.query('begin');await other.query("update public.schools set sector='arab' where id=1");
    const committing=save(runA,f.workspace.revision,f.sourceRevision);
    const rejection=assert.rejects(committing,/source_revision_conflict/);
    await new Promise(resolve=>setTimeout(resolve,15));
    const waiting=(await other.query('select wait_event_type from pg_stat_activity where pid=$1',[client.processID])).rows[0];
    assert.equal(waiting.wait_event_type,'Lock');
    await other.query('commit');await rejection;
    assert.equal((await facts()).workspace.revision,f.workspace.revision);
  } finally {await other.query('rollback');await other.end();}
});


test('PostgreSQL real heartbeat remains responsive during CPU-heavy candidates and takeover stops the old engine before commit',async t=>{
  if(!required(t))return;
  await acquire();const other=new pg.Client({connectionString});await other.connect();await identity(other);
  const instructors=Array.from({length:6000},(_,i)=>({emp_id:String(i+1),active:'yes',address:'home',full_name:'Instructor'}));
  const profiles=Object.fromEntries(instructors.map(i=>[i.emp_id,{gender:'female',instruction_languages:['he']}]));
  const rules=Object.fromEntries(instructors.map(i=>[i.emp_id,[{weekday:0,available:true,start_time:'08:00',end_time:'18:00'}]]));
  const course={row_id:'cpu',activity_type:'course',activity_season:'school_2027',status:'פתוח',activity_name:'Program',sessions:1,school_id:1,school:'School',school_address:'Address 1',calendar_sector:'general',instruction_language:'he',required_instructor_gender:'any',date_1:'2027-01-03',start_time:'10:00',end_time:'11:30'};
  const input={activities:[course],instructors,profiles,rules,exceptions:{},schoolCalendar:[],periodKey:'year',targetCourse:course};
  const preparedContext=prepareSchedulingRunContext(input);const controller=new AbortController();let renewals=0;
  const heartbeat=startPlanningLeaseHeartbeat({intervalMs:2,renew:async()=>{
    renewals++;
    if(renewals===3){await other.query("update public.scheduling_planning_run_leases set heartbeat_at=clock_timestamp()-interval '61 seconds'");await acquire(runB,other);}
    return (await client.query("select public.heartbeat_scheduling_planning_run_lease('year','center',$1,120) value",[runA])).rows[0].value;
  },onLost:()=>controller.abort()});
  try {
    await assert.rejects(preliminaryCourseCandidatesCooperatively({...input,preparedContext},createPlanningCheckpoint({budgetMs:2,signal:controller.signal})),/planning_cancelled/);
    assert.equal(renewals,3);await assert.rejects(save(runA),/ownership_lost/);
  }finally{heartbeat.stop();await other.end();}
});
