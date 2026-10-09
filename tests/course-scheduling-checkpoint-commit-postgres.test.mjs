import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const connectionString=process.env.PLANNING_INVALIDATION_TEST_DATABASE_URL;
if (connectionString && !['localhost','127.0.0.1'].includes(new URL(connectionString).hostname)) {
  throw new Error('Disposable localhost database required');
}
const runId='00000000-0000-4000-8000-000000000002';
const workspaceId='00000000-0000-4000-8000-000000000001';

test('actual validated-checkpoint SQL commits 253 entries and all 104 dirty flags only after validation', async (t) => {
  if (!connectionString) return t.skip('Missing disposable Postgres connection');
  const client=new pg.Client({connectionString});
  await client.connect();
  try {
    await client.query([
      'drop schema if exists public cascade;',
      'drop schema if exists auth cascade;',
      'create schema public;',
      'create schema auth;',
      "do $$ begin if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if; end $$;",
      'create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;',
      'create table public.scheduling_planning_workspaces (id uuid primary key,period_key text,district text,revision bigint,engine_version text,data_fingerprint text,context_fingerprint text,calculated_at timestamptz,updated_at timestamptz,updated_by uuid,validated_source_revision bigint);',
      'create table public.scheduling_planning_checkpoints (period_key text,district text,phase text,engine_version text,data_fingerprint text,context_fingerprint text,completed_count integer,total_count integer,rows_data jsonb);',
      'create table public.scheduling_planning_checkpoint_rows (period_key text,district text,activity_id text,row_data jsonb);',
      'create table public.scheduling_planning_rows (workspace_id uuid,activity_id text,row_data jsonb,activity_updated_at timestamptz,needs_recalc boolean,updated_at timestamptz,constraint scheduling_planning_rows_pkey primary key(workspace_id,activity_id));',
      'create table public.activities(row_id text primary key, updated_at timestamptz default now());',
      "create function public.assert_scheduling_planning_run_ownership(p_period text,p_district text,p_run_id uuid,p_revision bigint,p_source_revision bigint) returns void language plpgsql as $fn$ begin if p_run_id is distinct from '00000000-0000-4000-8000-000000000002'::uuid then raise exception 'planning_run_ownership_lost'; end if; if p_source_revision is distinct from 239 then raise exception 'planning_source_revision_conflict'; end if; if p_revision is not null and p_revision is distinct from (select revision from public.scheduling_planning_workspaces where period_key=p_period and district=p_district) then raise exception 'planning_revision_conflict'; end if; end $fn$;"
    ].join('\n'));
    const migration=await readFile(new URL('../supabase/migrations/20261006132323_commit_validated_planning_checkpoint.sql',import.meta.url),'utf8');
    await client.query(migration);
    await client.query([
      "insert into public.scheduling_planning_workspaces(id,period_key,district,revision,engine_version,data_fingerprint,context_fingerprint,validated_source_revision) values ($1,'year','',11946,'planning-v31','data-fp','context-fp',111);",
      "insert into public.activities(row_id) select 'activity-'||n from generate_series(0,252) n;",
      "insert into public.scheduling_planning_rows(workspace_id,activity_id,row_data,needs_recalc) select $1,'activity-'||n,jsonb_build_object('courseId','activity-'||n,'kind',case when n<101 then 'live' when n<180 then 'proposal' when n<186 then 'fixed-proposal' when n<236 then 'missing' else 'recruitment' end,'instructorEmpId',case when n<186 then 'staff-'||n else '' end),n<104 from generate_series(0,252) n;",
      "insert into public.scheduling_planning_checkpoint_rows(period_key,district,activity_id,row_data) select 'year','',activity_id,case when activity_id='activity-110' then jsonb_set(row_data,'{instructorEmpId}',to_jsonb('replanned-staff'::text)) else row_data end from public.scheduling_planning_rows;",
      "insert into public.scheduling_planning_checkpoints(period_key,district,phase,engine_version,data_fingerprint,context_fingerprint,completed_count,total_count,rows_data) values ('year','','running','planning-v35','data-fp','context-fp',253,253,jsonb_build_array(jsonb_build_object('__planningRunMeta',true,'planningStage','planned','sourceRevision','239','workspaceRevision','11946')));"
    ].map(statement => statement.replaceAll('$1', "'"+workspaceId+"'")).join('\n'));

    const call="select public.commit_scheduling_planning_checkpoint('year','','planning-v35','data-fp','context-fp',$1,$2,239) payload";
    const blocked=async(message,revision=11946,id=runId)=>{
      await assert.rejects(client.query(call,[revision,id]),err=>String(err.message).includes(message));
    };
    await blocked('planning_validated_checkpoint_required');
    await client.query("update public.scheduling_planning_checkpoints set phase='validated',completed_count=252");
    await blocked('planning_validated_checkpoint_required');
    await client.query("update public.scheduling_planning_checkpoints set completed_count=253");
    await client.query("delete from public.scheduling_planning_checkpoint_rows where activity_id='activity-252'");
    await blocked('planning_checkpoint_incomplete');
    await client.query("insert into public.scheduling_planning_checkpoint_rows(period_key,district,activity_id,row_data) values ('year','','activity-252',jsonb_build_object('courseId','activity-252','kind','recruitment'))");
    await blocked('planning_run_ownership_lost',11946,'00000000-0000-4000-8000-000000000099');
    await blocked('planning_revision_conflict',11945);
    const saved=await client.query(call,[11946,runId]);
    assert.equal(Number(saved.rows[0].payload.revision),11947);
    const {rows:[row]}=await client.query([
      'select',
      '(select count(*) from public.scheduling_planning_rows) as total,',
      '(select count(*) from public.scheduling_planning_rows where needs_recalc) as dirty,',
      "(select count(*) from public.scheduling_planning_rows where row_data->>'kind'='live') as live,",
      "(select row_data->>'instructorEmpId' from public.scheduling_planning_rows where activity_id='activity-110') as replanned,",
      "(select engine_version from public.scheduling_planning_workspaces where period_key='year') as engine,",
      "(select validated_source_revision from public.scheduling_planning_workspaces where period_key='year') as source"
    ].join('\n'));
    assert.equal(Number(row.total),253);
    assert.equal(Number(row.dirty),0);
    assert.equal(Number(row.live),101);
    assert.equal(row.replanned,'replanned-staff');
    assert.equal(row.engine,'planning-v35');
    assert.equal(Number(row.source),239);
  } finally {
    await client.end();
  }
});
