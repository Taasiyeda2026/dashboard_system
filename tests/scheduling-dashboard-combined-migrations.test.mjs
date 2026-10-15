import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
const url=process.env.SCHEDULING_TEST_DATABASE_URL;
const infraRoot=process.env.SCHEDULING_INFRA_PR_ROOT;
// Both unmerged PRs are checked out explicitly; never obtain migrations from production.
test('PR 2372 then 2373 coexist on disposable PostgreSQL',{skip:!url||!infraRoot},async t=>{
 const parsed=new URL(url);assert.ok(['localhost','127.0.0.1','[::1]'].includes(parsed.hostname));
 const read=p=>readFileSync(p,'utf8');
 const admin=new pg.Client({connectionString:url});await admin.connect();const db='scheduling_pair_'+randomUUID().replaceAll('-','');
 await admin.query('create database '+db);parsed.pathname='/'+db;const c=new pg.Client({connectionString:parsed.href});await c.connect();
 const owner='11111111-1111-4111-8111-111111111111',operator='22222222-2222-4222-8222-222222222222';
 try{
  await c.query(read(infraRoot+'/tests/fixtures/scheduling-agent-infra.sql'));
  let domain=read(new URL('./fixtures/scheduling-dashboard-agent.sql',import.meta.url));
  domain=domain.replace(/create schema auth;\n/,'').replace(/create function auth.uid\(\)[^\n]+\n/,'')
   .replace(/create table users\([^\n]+\n/,'').replace(/create function app_has_permission\(text\)[^\n]+\n/,'')
   .replace(/create table scheduling_planning_(?:workspaces|rows|source_state)\([^\n]+\n/g,'');
  await c.query(domain);
  await c.query("alter table scheduling_planning_workspaces add validated_source_revision bigint default 7,add engine_version text default 'planning-v38-20261015-transition-30-45';alter table scheduling_planning_rows add needs_recalc boolean default false");
  for(const name of ['20261015121500_scheduling_agent_team_optimization_queue.sql','20261015170000_scheduling_agent_worker_oidc_control.sql'])
   await c.query(read(new URL('../supabase/migrations/'+name,import.meta.url)));
  await c.query(read(infraRoot+'/supabase/migrations/20261016000000_scheduling_agent_durable_wakeup.sql'));
  await c.query(read(new URL('../supabase/migrations/20261016100000_scheduling_dashboard_agent_controls.sql',import.meta.url)));
  await c.query("insert into users(auth_user_id,is_active,role) values($1,true,'admin'),($2,true,'operation_manager')",[owner,operator]);
  await c.query('insert into scheduling_agent_control values(true,$1)',[owner]);
  await c.query("insert into scheduling_planning_source_state values(true,7);insert into scheduling_planning_workspaces(id,period_key,district,revision) values(gen_random_uuid(),'year','',1);insert into activities values('test',6,'2026-10-15T08:00:00Z',null)");
  await t.test('installation keeps worker and Cron paused and performs no dispatch',async()=>{
   assert.equal((await c.query('select autonomous_enabled from scheduling_agent_worker_settings')).rows[0].autonomous_enabled,false);
   assert.equal((await c.query('select active from cron.job')).rows[0].active,false);
   assert.equal((await c.query('select count(*)::int n from net.fixture_requests')).rows[0].n,0);
  });
  await t.test('operation_manager can read and replace manually while automatic compute stays paused',async()=>{
   await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[operator]);
   const snapshot=(await c.query("select get_scheduling_dashboard_candidates('test') result")).rows[0].result;
   assert.equal(snapshot.sourceRevision,7);assert.equal(snapshot.workspaceRevision,1);
   const args={p_activity_id:'test',p_new_emp_id:8,p_reason:'synthetic manual replacement'};
   const row=(await c.query("select to_jsonb(scheduling_dashboard_assignment('reassign_locked_course_instructor',$1,'2026-10-15T08:00:00Z',7,1)) result",[args])).rows[0].result;
   assert.equal(row.emp_id,8);await c.query('rollback');
   assert.equal((await c.query('select count(*)::int n from scheduling_agent_team_optimization_jobs')).rows[0].n,0);
  });
  await t.test('worker atomic receipt contract survives installing dashboard migration',async()=>{
   await c.query('begin');await c.query("select set_config('request.jwt.claim.role','service_role',true)");
   const probe=(await c.query("select scheduling_agent_worker_command('probe') result")).rows[0].result;
   assert.equal(probe.atomicCompletion,true);assert.equal(probe.enabled,false);await c.query('rollback');
  });
 }finally{await c.end();await admin.query('drop database '+db);await admin.end();}
});
