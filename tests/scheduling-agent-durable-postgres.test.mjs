import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';

const url=process.env.SCHEDULING_TEST_DATABASE_URL;
const owner='11111111-1111-4111-8111-111111111111';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test('durable queue on isolated PostgreSQL', {skip:!url},async t=>{
 const parsed=new URL(url);
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(parsed.hostname),'Tests refuse non-local databases');
 const admin=new pg.Client({connectionString:url});await admin.connect();
 const db='scheduling_infra_'+randomUUID().replaceAll('-','');
 await admin.query('create database '+db);
 const local=new URL(url);local.pathname='/'+db;
 const pool=new pg.Pool({connectionString:local.href,max:8});
 const query=(q,p)=>pool.query(q,p);
 async function command(action,payload={},role='service_role'){
  const c=await pool.connect();
  try{await c.query('begin');await c.query("select set_config('request.jwt.claim.role',$1,true)",[role]);
   const r=await c.query('select scheduling_agent_worker_command($1,$2) result',[action,payload]);
   await c.query('commit');return r.rows[0].result;
  }catch(e){await c.query('rollback');throw e;}finally{c.release();}
 }
 async function wake(action,payload={}){
  const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.role','service_role',true)");
   const r=await c.query('select scheduling_agent_wakeup_command($1,$2) result',[action,payload]);await c.query('commit');return r.rows[0].result;
  }catch(e){await c.query('rollback');throw e;}finally{c.release();}
 }
 async function reset(){
  await query('truncate scheduling_agent_team_optimization_jobs,scheduling_agent_worker_audit,scheduling_planning_run_leases,fixture_saves,net.fixture_requests');
  await query('update scheduling_agent_worker_settings set enabled=true,autonomous_enabled=true');
  await query('update scheduling_planning_workspaces set revision=1');
 }
 async function enqueue(){return (await query("insert into scheduling_agent_team_optimization_jobs(created_by,mode) values($1,'incremental') returning id",[owner])).rows[0].id;}
 async function claimed(){const runId=randomUUID();const j=await command('claim',{runId});assert.equal(j.claimed,true);await command('lease',{jobId:j.jobId,runId});return {jobId:j.jobId,runId};}
 const payload=j=>({...j,mode:'incremental',sourceRevision:'7',workspaceRevision:'1',engineVersion:'planning-v38-20261015-transition-30-45',
  dataFingerprint:'synthetic',contextFingerprint:'synthetic',rows:[{activityId:'synthetic-course',row:{courseId:'synthetic-course'}}]});
 try{
  await query(read('./fixtures/scheduling-agent-infra.sql'));
  await query(read('../supabase/migrations/20261015121500_scheduling_agent_team_optimization_queue.sql'));
  await query(read('../supabase/migrations/20261015170000_scheduling_agent_worker_oidc_control.sql'));
  await query(read('../supabase/migrations/20261016000000_scheduling_agent_durable_wakeup.sql'));
  await query('insert into users values($1,true,\'admin\');',[owner]);
  await query('insert into scheduling_agent_control values(true,$1)',[owner]);
  await query("insert into scheduling_planning_workspaces values(gen_random_uuid(),'year','',1)");
  await query('insert into scheduling_planning_source_state values(true,7)');
  await t.test('migration is inert until explicit activation',async()=>{
   assert.equal((await query('select autonomous_enabled from scheduling_agent_worker_settings')).rows[0].autonomous_enabled,false);
   assert.equal((await query('select active from cron.job')).rows[0].active,false);
   assert.equal((await command('probe')).atomicCompletion,true);
   assert.equal((await command('claim')).claimed,false);
  });
  await t.test('concurrent authenticated requests reuse one durable job',async()=>{
   await reset();const ids=await Promise.all(Array.from({length:8},async()=>{
    const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[owner]);
     const r=await c.query("select scheduling_agent_team_request_optimization('incremental') result");await c.query('commit');return r.rows[0].result.jobId;
    }catch(e){await c.query('rollback');throw e;}finally{c.release();}
   }));assert.equal(new Set(ids).size,1);
  });
  await t.test('immediate wake is transactional and rolls back with enqueue',async()=>{
   await reset();await query("insert into vault.decrypted_secrets values('scheduling_agent_wakeup_secret',repeat('x',32))");
   const c=await pool.connect();try{await c.query('begin');await c.query("insert into scheduling_agent_team_optimization_jobs(created_by,mode) values($1,'incremental')",[owner]);await c.query('rollback');}finally{c.release();}
   assert.equal((await query('select count(*)::int n from net.fixture_requests')).rows[0].n,0);
   await enqueue();assert.equal((await query('select count(*)::int n from net.fixture_requests')).rows[0].n,1);
  });
  await t.test('duplicate wakeups reserve only one dispatch',async()=>{
   await reset();await enqueue();const r=await Promise.all([wake('reserve'),wake('reserve')]);
   assert.equal(r.filter(x=>x.reserved).length,1);
  });
  await t.test('lost dispatch response expires and is retried',async()=>{
   await reset();await enqueue();const first=await wake('reserve');
   await query("update scheduling_agent_team_optimization_jobs set dispatch_expires_at=now()-interval '1 second',dispatch_due_at=now()-interval '1 second'");
   const next=await wake('reserve');assert.equal(next.jobId,first.jobId);assert.notEqual(next.dispatchToken,first.dispatchToken);
   await assert.rejects(wake('ack',{...first,accepted:true}),/dispatch_reservation_lost/);
  });
  await t.test('unclaimed accepted dispatches stop after six attempts',async()=>{
   await reset();await enqueue();await query('update scheduling_agent_team_optimization_jobs set dispatch_attempts=6');
   assert.equal((await wake('reserve')).reserved,false);
   assert.equal((await query('select status from scheduling_agent_team_optimization_jobs')).rows[0].status,'failed');
  });
  await t.test('concurrent workers cannot claim the same or parallel national job',async()=>{
   await reset();await enqueue();const r=await Promise.all([command('claim',{runId:randomUUID()}),command('claim',{runId:randomUUID()})]);
   assert.equal(r.filter(x=>x.claimed).length,1);assert.ok(r.find(x=>x.claimed).runId);
  });
  await t.test('crash before lease recovers the same job and fences old attempt',async()=>{
   await reset();const id=await enqueue();const first=await command('claim',{runId:randomUUID()});
   await query("update scheduling_agent_team_optimization_jobs set worker_heartbeat_at=now()-interval '16 minutes'");
   await query('select scheduling_agent_recover_jobs()');
   await query("update scheduling_agent_team_optimization_jobs set next_attempt_at=now()-interval '1 second'");
   const next=await command('claim',{runId:randomUUID()});assert.equal(next.jobId,id);
   await assert.rejects(command('persist',payload({jobId:id,runId:first.runId})),/worker_job_ownership_lost/);
  });
  await t.test('active lease prevents stale heartbeat recovery',async()=>{
   await reset();await enqueue();await claimed();
   await query("update scheduling_agent_team_optimization_jobs set worker_heartbeat_at=now()-interval '16 minutes'");
   await query('select scheduling_agent_recover_jobs()');
   assert.equal((await query('select status from scheduling_agent_team_optimization_jobs')).rows[0].status,'running');
  });
  await t.test('transient failure retries but domain failure is terminal',async()=>{
   await reset();await enqueue();const j=await claimed();
   assert.equal((await command('finish',{...j,success:false,failureCode:'worker_transport_failed'})).status,'queued');
   await command('release',j);await query("update scheduling_agent_team_optimization_jobs set next_attempt_at=now()-interval '1 second'");
   const next=await claimed();assert.equal((await command('finish',{...next,success:false,failureCode:'P0001'})).status,'failed');
  });
  await t.test('third interrupted attempt exhausts retries',async()=>{
   await reset();await enqueue();await command('claim',{runId:randomUUID()});
   await query("update scheduling_agent_team_optimization_jobs set attempt_count=3,worker_heartbeat_at=now()-interval '16 minutes'");
   await query('select scheduling_agent_recover_jobs()');assert.equal((await query('select status from scheduling_agent_team_optimization_jobs')).rows[0].status,'failed');
  });
  await t.test('domain validator failure rolls back save and receipt together',async()=>{
   await reset();await enqueue();const j=await claimed();const p=payload(j);p.rows[0].row.invalid=true;
   await assert.rejects(command('persist',p),/fixture_domain_rejected/);
   assert.equal((await query('select count(*)::int n from fixture_saves')).rows[0].n,0);
   assert.equal((await query('select result_receipt from scheduling_agent_team_optimization_jobs')).rows[0].result_receipt,null);
   assert.equal((await query('select revision from scheduling_planning_workspaces')).rows[0].revision,'1');
  });
  await t.test('lost persist response and duplicate delivery apply exactly once',async()=>{
   await reset();await enqueue();const j=await claimed();const [a,b]=await Promise.all([command('persist',payload(j)),command('persist',payload(j))]);
   assert.deepEqual(a,b);assert.equal(a.status,'completed');
   assert.equal((await query('select count(*)::int n from fixture_saves')).rows[0].n,1);
   assert.deepEqual(await command('finish',{...j,success:false,failureCode:'worker_transport_failed'}),a);
   assert.equal((await command('claim',{runId:randomUUID()})).claimed,false);
  });
  await t.test('source change and locked row prevent writes',async()=>{
   await reset();await enqueue();const j=await claimed();let p=payload(j);p.sourceRevision='6';
   await assert.rejects(command('persist',p),/planning_source_revision_conflict/);
   await query("insert into scheduling_planning_rows select id,'synthetic-course','{\"protected\":true}','{}' from scheduling_planning_workspaces");
   await assert.rejects(command('persist',payload(j)),/worker_protected_row_mutation_denied/);
   await query('truncate scheduling_planning_rows');
  });
  await t.test('human identities denied and success without receipt rejected',async()=>{
   await reset();await enqueue();await assert.rejects(command('claim',{},'authenticated'),/worker_machine_identity_required/);
   const j=await claimed();await assert.rejects(command('finish',{...j,success:true}),/worker_receipt_required/);
   const grants=await query("select has_function_privilege('authenticated','scheduling_agent_wakeup_command(text,jsonb)','execute') allowed");
   assert.equal(grants.rows[0].allowed,false);
  });
 }finally{await pool.end();await admin.query('drop database '+db);await admin.end();}
});
