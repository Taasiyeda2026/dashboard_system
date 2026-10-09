// Disposable PostgreSQL only. Schema adapters reuse existing focused fixture, not production deployment.
import {readFile,writeFile} from 'node:fs/promises';import pg from 'pg';import assert from 'node:assert/strict';import {performance} from 'node:perf_hooks';
const connectionString='postgresql://postgres:isolated-test-only@127.0.0.1:55439/codex_engine_decision';const client=new pg.Client({connectionString});const ownerA='11111111-1111-4111-8111-111111111111';const runA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sqlFile=p=>readFile(new URL('../../tests/'+p,import.meta.url),'utf8');async function identity(db,uid=ownerA){await db.query("select set_config('test.uid',$1,false),set_config('test.role','admin',false)",[uid]);}
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
  for (const file of ['20260924145500_shared_incremental_course_planning.sql','20260926195500_planning_silent_checkpoints.sql','20261004193000_optimize_planning_persistence.sql','20261005193000_scheduling_planning_run_leases.sql','20261005234644_planning_preflight_and_fenced_runs.sql','20261006030853_prevent_planning_route_cache_self_invalidation.sql','20261006035447_tolerate_background_planning_heartbeats.sql','20261006132323_commit_validated_planning_checkpoint.sql','20261006135000_ignore_non_planning_instructor_contact_updates.sql']) {
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
const dir=process.env.DECISION_DIR,source=JSON.parse(await readFile(dir+'/anonymous-snapshot.json','utf8')),plan=JSON.parse(await readFile(dir+'/national-plan.json','utf8'));const results=[];
// Test identity is explicitly modeled. These checks do not claim real Supabase Auth/RLS parity.
await client.query("create or replace function public.app_has_permission(p_permission text) returns boolean language sql stable as $$ select current_setting('test.role',true) in ('admin','manager') $$");
for(const a of source.activities)await client.query('insert into public.activities(row_id,activity_season,school_id,school,authority,emp_id,instructor_assignment_locked,updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8)',[a.row_id,a.activity_season,a.school_id,a.school,a.authority,a.emp_id,a.instructor_assignment_locked,a.updated_at]);
const sourceRevision=(await client.query('select revision from public.scheduling_planning_source_state')).rows[0].revision;
await client.query("insert into public.scheduling_planning_workspaces(period_key,district,engine_version,validated_source_revision) values ('year','','planning-v31',$1)",[sourceRevision]);
let revision=(await client.query("select revision from public.scheduling_planning_workspaces where period_key='year' and district='' ")).rows[0].revision;
const acquire=()=>client.query("select public.acquire_scheduling_planning_run_lease('year','',$1,120) value",[runA]);await acquire();
const fp='anonymous-fixture',engine=source.scheduling_planning_workspaces[0].engine_version;
const checkpoint=async(phase,version='planning-v36-20261009-point-context-transition-guard-v2')=>{for(let i=0;i<plan.rows.length;i+=10){const meta={__planningRunMeta:true,phase:i+10>=plan.rows.length?phase:'running',planningStage:'planned',workspaceRevision:String(revision),sourceRevision:String(sourceRevision)};await client.query("select public.save_scheduling_planning_checkpoint('year','',$1,$2,$2,$3,$3,'[]'::jsonb,$4::jsonb,$5,$6)",[version,fp,plan.rows.length,JSON.stringify([meta,...plan.rows.slice(i,i+10)]),runA,sourceRevision]);}};
const commit=version=>client.query("select public.commit_scheduling_planning_checkpoint('year','',$1,$2,$2,$3,$4,$5) value",[version,fp,revision,runA,sourceRevision]);
const version='planning-v36-20261009-point-context-transition-guard-v2';
await checkpoint('running');await assert.rejects(commit(version),e=>e.message.includes('planning_validated_checkpoint_required'));results.push({case:'running checkpoint cannot commit',pass:true});
// Demonstrate storage fencing, not independent server semantic certification.
await checkpoint('validated');const before=performance.now(),saved=await commit(version);const saveMs=performance.now()-before;revision=saved.rows[0].value.revision;
const stored=(await client.query('select row_data from public.scheduling_planning_rows order by activity_id')).rows.map(r=>r.row_data);assert.deepEqual(stored,[...plan.rows].sort((a,b)=>a.courseId.localeCompare(b.courseId)));results.push({case:'national checkpoint actual SQL atomic commit/load parity',pass:true,rows:stored.length,saveMs,revision});
await acquire();await checkpoint('validated');await client.query("select public.release_scheduling_planning_run_lease('year','',$1)",[runA]);await assert.rejects(commit(version),e=>e.message.includes('planning_run_ownership_lost'));results.push({case:'cancel/release prevents commit',pass:true});
await acquire();await checkpoint('validated');await client.query("delete from public.scheduling_planning_checkpoint_rows where activity_id=$1",[plan.rows[0].courseId]);await assert.rejects(commit(version),e=>e.message.includes('planning_checkpoint_incomplete'));results.push({case:'corrupt missing checkpoint row prevents commit',pass:true});
await checkpoint('validated','planning-v31');await assert.rejects(commit(version),e=>e.message.includes('planning_validated_checkpoint_required'));results.push({case:'old engine checkpoint cannot commit as v36',pass:true});
await checkpoint('validated');await client.query("update public.scheduling_planning_run_leases set expires_at=clock_timestamp()-interval '1 second' where run_id=$1",[runA]);await assert.rejects(commit(version),e=>e.message.includes('planning_run_ownership_lost'));results.push({case:'crashed/expired owner cannot commit',pass:true});
await client.query("select set_config('test.role','denied',false)");await assert.rejects(acquire(),e=>e.code==='42501');results.push({case:'denied modeled permission blocks acquire',pass:true});
await identity(client);const canonical=(await client.query('select row_data from public.scheduling_planning_rows order by activity_id')).rows.map(r=>r.row_data);assert.deepEqual(canonical,stored);results.push({case:'failed canceled/corrupt/old/expired saves leave stored result unchanged',pass:true});
await writeFile(dir+'/postgres-acceptance.json',JSON.stringify({scope:'PostgreSQL 17 actual checkpoint/lease/commit functions with focused schema and explicitly modeled identity; not a full Supabase Auth deployment or server semantic validator',sourceRevision,results},null,2));console.log(JSON.stringify({results}));await client.end();
