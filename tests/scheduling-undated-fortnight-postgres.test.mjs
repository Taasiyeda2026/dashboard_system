import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const url=process.env.SCHEDULING_TEST_DATABASE_URL;
test('14-day migration changes only guarded scheduling validation bodies on isolated Postgres',
 {skip:!url},async()=>{
  const base=new URL(url);
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(base.hostname),'Refuse non-local database');
  const admin=new pg.Client({connectionString:url});await admin.connect();
  const dbName='undated_lead_'+randomUUID().replaceAll('-','');
  await admin.query('create database '+dbName);
  const local=new URL(url);local.pathname='/'+dbName;
  const client=new pg.Client({connectionString:local.href});
  try {
   await client.connect();
   await client.query(`create function public.get_scheduling_planning_preflight(p_period_key text,p_district text default '')
     returns jsonb language sql as $$
     select jsonb_build_object('minimum', (clock_timestamp() at time zone 'Asia/Jerusalem')::date + 7,
       'status', 'r.needs_recalc') $$;
   create function public.scheduling_v37_workspace_validation(p_workspace_id uuid,p_prior_rows jsonb default '[]'::jsonb)
     returns void language plpgsql as $$
     begin
       if (clock_timestamp() at time zone 'Asia/Jerusalem')::date + 7 <= current_date
         then raise exception 'planning_server_undated_start_too_soon';
       end if;
     end $$;`);
   const before=(await client.query(`select
      pg_get_functiondef('public.get_scheduling_planning_preflight(text,text)'::regprocedure) preflight,
      pg_get_functiondef('public.scheduling_v37_workspace_validation(uuid,jsonb)'::regprocedure) validator`)).rows[0];
   const migration=readFileSync(new URL('../supabase/migrations/20261030190000_scheduling_undated_fourteen_day_lead.sql',import.meta.url),'utf8');
   await client.query(migration);
   const after=(await client.query(`select
      pg_get_functiondef('public.get_scheduling_planning_preflight(text,text)'::regprocedure) preflight,
      pg_get_functiondef('public.scheduling_v37_workspace_validation(uuid,jsonb)'::regprocedure) validator`)).rows[0];
   for (const key of ['preflight','validator']) {
     assert.equal(after[key],before[key].replace('::date + 7','::date + 14'));
   }
   await assert.rejects(client.query(migration),/scheduling_undated_lead_function_shape_changed/);
  } finally {await client.end().catch(()=>{});await admin.query('drop database '+dbName);await admin.end();}
 });
