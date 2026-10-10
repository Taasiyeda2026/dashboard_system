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

await client.query('drop function public.scheduling_course_instructor_violations(text,bigint,boolean,date[])');
await client.query(await sqlFile('../supabase/migrations/20260930220000_scheduling_blocked_authorities_hard_constraint.sql'));
const proposedSource=await sqlFile('../supabase/migrations/20260926141500_allow_arab_sector_saturday.sql');
await client.query(proposedSource.slice(proposedSource.indexOf('CREATE OR REPLACE FUNCTION public.scheduling_validate_proposed_meetings('),proposedSource.indexOf('revoke all on function',proposedSource.indexOf('CREATE OR REPLACE FUNCTION public.scheduling_validate_proposed_meetings('))));
await client.end();
