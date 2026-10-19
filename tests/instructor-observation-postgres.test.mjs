import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import pg from 'pg';

const url=process.env.OBSERVATION_TEST_DATABASE_URL;
test('observation migration, RLS and immutable completed reports on disposable Postgres',{skip:!url},async()=>{
 const parsed=new URL(url);
 assert.ok(['localhost','127.0.0.1','[::1]'].includes(parsed.hostname));
 const db=new pg.Client({connectionString:url});
 await db.connect();
 const auth1='11111111-1111-4111-8111-111111111111';
 const auth2='22222222-2222-4222-8222-222222222222';
 try{
  await db.query(`
    create extension if not exists pgcrypto;
    create schema if not exists auth;
    do $$ begin
      if not exists(select from pg_roles where rolname='authenticated') then
        create role authenticated;
      end if;
    end $$;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
    create table public.users (
      auth_user_id uuid primary key, is_active boolean not null, role text not null
    );
    create table public.contacts_instructors (emp_id bigint primary key);
    create function public.app_has_permission(p_name text) returns boolean language sql stable as $$
      select p_name='view_instructors'
    $$;
    create function public.app_current_role() returns text language sql stable as $$
      select current_setting('test.role',true)
    $$;
    insert into public.users values
      ('11111111-1111-4111-8111-111111111111',true,'operation_manager'),
      ('22222222-2222-4222-8222-222222222222',true,'activities_manager');
    insert into public.contacts_instructors values(1550);
    grant usage on schema public,auth to authenticated;
    grant execute on function auth.uid() to authenticated;
  `);
  const migration=readFileSync(new URL('../supabase/migrations/20261019023000_instructor_observations.sql',import.meta.url),'utf8');
  await db.query(migration);
  await db.query("select set_config('test.uid',$1,false),set_config('test.role','operation_manager',false)",[auth1]);
  await db.query('set role authenticated');
  const q=async(sql,args=[])=> (await db.query(sql,args)).rows;
  const draft=await q("insert into public.instructor_observations(instructor_name,emp_id,observer_name) values('Instructor',1550,'Observer') returning id,created_by,status");
  assert.equal(draft[0].created_by,auth1);
  assert.equal(draft[0].status,'draft');
  const id=draft[0].id;
  await assert.rejects(db.query("update public.instructor_observations set status='completed',completed_at=now(),observation_date=current_date where id=$1",[id]),/instructor_observation_summary_incomplete/);
  const responses={};
  for(const [group,count] of [2,3,3,2,3,2].entries())for(let j=0;j<count;j++)responses[group+'-'+j]='טוב';
  const details={course:'Course',school:'School',class:'9A',school_staff:'כן',meeting:'2',students:'24'};
  const completed=await q("update public.instructor_observations set status='completed',completed_at=now(),observation_date=current_date,overall_rating=4,strengths='Excellent',improvements='Practice',summary='Good teaching',details=$2::jsonb,responses=$3::jsonb where id=$1 returning status",[id,JSON.stringify(details),JSON.stringify(responses)]);
  assert.equal(completed[0].status,'completed');
  await assert.rejects(db.query('update public.instructor_observations set strengths=$2 where id=$1',[id,'Tamper']),/completed_instructor_observation_is_immutable/);
  await db.query("select set_config('test.uid',$1,false),set_config('test.role','activities_manager',false)",[auth2]);
  assert.equal((await q('select count(*)::int as n from public.instructor_observations'))[0].n,0);
  const blocked=await q("update public.instructor_observations set summary='Changed' where id=$1 returning id",[id]);
  assert.equal(blocked.length,0);
  await db.query("select set_config('test.uid',$1,false),set_config('test.role','operation_manager',false)",[auth1]);
  assert.equal((await q('select count(*)::int as n from public.instructor_observations'))[0].n,1);
 }finally{await db.query('reset role').catch(()=>{});await db.end();}
});
