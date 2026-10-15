import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
const url=process.env.SCHEDULING_TEST_DATABASE_URL;
test('dashboard assignment migration on isolated PostgreSQL',{skip:!url},async t=>{
 const local=new URL(url);assert.ok(['localhost','127.0.0.1','[::1]'].includes(local.hostname),'refuse production');
 const admin=new pg.Client({connectionString:url});await admin.connect();const db='dashboard_ui_'+randomUUID().replaceAll('-','');
 await admin.query('create database '+db);local.pathname='/'+db;const pool=new pg.Pool({connectionString:local.href,max:4});
 const uid='11111111-1111-4111-8111-111111111111',stamp='2026-10-15T08:00:00Z';
 const query=(s,p)=>pool.query(s,p);
 async function call(name='cancel_course_assignment_draft',args={p_activity_id:'test'},expected=stamp,source=null,workspace=null){
  const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[uid]);
   const r=await c.query('select scheduling_dashboard_assignment($1,$2,$3,$4,$5) result',[name,args,expected,source,workspace]);await c.query('commit');return r.rows[0].result;
  }catch(e){await c.query('rollback');throw e;}finally{c.release();}
 }
 async function reset(){await query('truncate fixture_calls');await query('update fixture_guard set code=null');await query('update users set is_active=true,allowed=true');await query('update activities set emp_id=null,updated_at=$1',[stamp]);}
 try{
  for(const path of ['./fixtures/scheduling-dashboard-agent.sql','../supabase/migrations/20261016100000_scheduling_dashboard_agent_controls.sql'])await query(readFileSync(new URL(path,import.meta.url),'utf8'));
  await query("insert into users values($1,true,'operation_manager',true)",[uid]);await query("insert into activities values('test',null,$1,null)",[stamp]);
  await query("insert into scheduling_planning_source_state values(true,666);insert into scheduling_planning_workspaces values(gen_random_uuid(),'year','',12,665,'planning-v38-20261015-transition-30-45')");
  await t.test('active Eden-equivalent permission admits existing write RPCs',async()=>{
   for(const name of ['save_course_assignment_draft','save_course_assignment_draft_with_dates','save_course_assignment_manual_draft','assign_activity_instructor','assign_activity_instructor_with_dates','reassign_locked_course_instructor','replace_locked_course_instructor','cancel_course_assignment_draft','cancel_confirmed_course_assignment']){
    await reset();await call(name,{p_activity_id:'test',p_emp_id:7,p_new_emp_id:8,p_proposed_meetings:[]});assert.equal((await query('select name from fixture_calls')).rows[0].name,name);
   }
  });
  await t.test('inactive or permission-denied operation_manager cannot mutate',async()=>{
   await reset();await query('update users set allowed=false');await assert.rejects(call(),/permission_denied/);
   await query('update users set allowed=true,is_active=false');await assert.rejects(call(),/permission_denied/);
  });
  await t.test('optimistic activity/source/workspace conflicts never call saver',async()=>{
   await reset();await assert.rejects(call(undefined,undefined,'2026-10-15T07:00:00Z'),/activity_revision_conflict/);
   await assert.rejects(call(undefined,undefined,stamp,665,12),/source_revision_conflict/);
   await assert.rejects(call(undefined,undefined,stamp,666,11),/planning_revision_conflict/);
   assert.equal((await query('select count(*)::int n from fixture_calls')).rows[0].n,0);
  });
  await t.test('concurrent identical commands permit only one mutation',async()=>{
   await reset();const r=await Promise.allSettled([call(),call()]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);
   assert.equal((await query('select count(*)::int n from fixture_calls')).rows[0].n,1);
  });
  await t.test('language/availability/distance/overlap/training/admin guards are propagated atomically',async()=>{
   for(const code of ['scheduling_language_mismatch','scheduling_instructor_unavailable','scheduling_home_distance_exceeded','scheduling_conflict_detected','scheduling_course_blocked','scheduling_manager_approval_required']){
    await reset();await query('update fixture_guard set code=$1',[code]);await assert.rejects(call('save_course_assignment_draft',{p_activity_id:'test',p_emp_id:7}),new RegExp(code));
    await assert.rejects(call('assign_activity_instructor',{p_activity_id:'test',p_emp_id:7}),new RegExp(code));
    assert.equal((await query('select count(*)::int n from fixture_calls')).rows[0].n,0);
   }
  });
  await t.test('candidate read returns stale-plan status and never certifies a manual choice',async()=>{
   await reset();await query("insert into contacts_instructors values(7,'synthetic','yes')");
   const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[uid]);
    const r=(await c.query("select get_scheduling_dashboard_candidates('test') result")).rows[0].result;
    assert.equal(r.planFresh,false);assert.equal(r.instructors.length,1);assert.equal(r.activity.row_id,'test');
    await c.query('rollback');
   }finally{c.release();}
   assert.equal((await query('select count(*)::int n from fixture_calls')).rows[0].n,0);
  });
  await t.test('unsupported action is rejected and anonymous API execution denied',async()=>{
   await reset();await assert.rejects(call('review_course_assignment_manager_approval'),/action_not_allowed/);
   assert.equal((await query("select has_function_privilege('anon','scheduling_dashboard_assignment(text,jsonb,timestamptz,bigint,bigint)','execute') allowed")).rows[0].allowed,false);
  });
 }finally{await pool.end();await admin.query('drop database '+db);await admin.end();}
});
