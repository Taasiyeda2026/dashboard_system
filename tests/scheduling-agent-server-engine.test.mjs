import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  verifyAgentPlanningInput,
  computeAgentSchedulingPlan,
  AgentPlanningInputError
} from '../services/scheduling-agent/compute-plan.mjs';
import {PLANNING_ENGINE_VERSION} from '../frontend/src/screens/course-scheduling-planning.js';
import {createRouteClient} from '../frontend/src/screens/course-scheduling-travel.js';

const routeClient=createRouteClient({
  preloadedRows: [],
  invoke: async()=>{ throw new Error('No external route network in isolated test'); }
});
const basic={
  activities:[],instructors:[],profiles:[],rules:[],exceptions:[],
  schoolCalendar:[],catalog:[],today:'2026-10-15',
  skipSoftOptimization:true
};

test('server validates authoritative snapshot, source and workspace version',()=>{
  const opts={snapshot:basic,sourceRevision:'649',workspaceRevision:'12200',
    mode:'incremental',targetCourseIds:['activity-one'],routeClient};
  assert.deepEqual(verifyAgentPlanningInput(opts).targetCourseIds,['activity-one']);
  assert.equal(verifyAgentPlanningInput(opts).engineVersion,PLANNING_ENGINE_VERSION);
  assert.throws(()=>verifyAgentPlanningInput({...opts,sourceRevision:null}),e=>e.code==='invalid_source_revision');
  assert.throws(()=>verifyAgentPlanningInput({...opts,snapshot:{...basic,rules:null}}),e=>e.code==='missing_rules');
  assert.throws(()=>verifyAgentPlanningInput({...opts,targetCourseIds:[]}),e=>e.code==='incremental_affected_courses_required');
  assert.throws(()=>verifyAgentPlanningInput({...opts,routeClient:null}),e=>e.code==='authoritative_route_client_required');
});

test('server entrypoint stops before computing on cancellation',async()=>{
  const c=new AbortController();c.abort();
  await assert.rejects(computeAgentSchedulingPlan({
    snapshot:basic,sourceRevision:'649',workspaceRevision:'12200',
    mode:'full',routeClient,signal:c.signal
  }),e=>e instanceof AgentPlanningInputError&&e.code==='planning_cancelled');
});

test('server engine entrypoint has no browser, Supabase client or write access',()=>{
  const text=readFileSync(new URL('../services/scheduling-agent/compute-plan.mjs',import.meta.url),'utf8');
  assert.match(text,/buildDynamicCoursePlan\(/);
  assert.match(text,/PLANNING_ENGINE_VERSION/);
  assert.doesNotMatch(text,/import .*supabase-client|window\.|document\.|saveSharedPlanningSnapshot|assign_activity_instructor/);
});

test('pure server entrypoint computes an empty fixture without changing source',async()=>{
  const original=JSON.stringify(basic);
  const out=await computeAgentSchedulingPlan({
    snapshot:basic,sourceRevision:'649',workspaceRevision:'12200',
    mode:'full',routeClient
  });
  assert.equal(out.engineVersion,PLANNING_ENGINE_VERSION);
  assert.equal(out.diagnostics.finalPlanValid,true);
  assert.equal(out.rows.length,0);
  assert.equal(JSON.stringify(basic),original);
});

test('a full retry reuses a completed proposal and computes only the unfinished course',async()=>{
 const date='2026-11-29';
 const course=(id,home,start,end)=>({
  row_id:id,activity_season:'school_2027',activity_type:'course',status:'פתוח',
  school_id:home,school_address:home,school:home,calendar_sector:'general',
  activity_name:'Synthetic',instruction_language:'he',required_instructor_gender:'any',
  sessions:1,date_1:date,start_time:start,end_time:end
 });
 const done=course('done','school','09:00','10:00');
 const unfinished=course('pending','school','10:15','11:15');
 const snapshot={...basic,today:'2026-11-26',activities:[done,unfinished],
  instructors:[{emp_id:'1',full_name:'Synthetic',active:'yes',address:'school'}],
  profiles:{1:{gender:'female',instruction_languages:['he']}},
  rules:{1:[{weekday:0,available:true,start_time:'08:00',end_time:'16:00'}]}};
 const seed=await computeAgentSchedulingPlan({snapshot,sourceRevision:'7',workspaceRevision:'1',
  targetCourseIds:['done'],routeClient});
 const prior=seed.rows.find(row=>row.courseId==='done');
 assert.equal(prior.instructorEmpId,'1');
 const retry=await computeAgentSchedulingPlan({snapshot,sourceRevision:'7',workspaceRevision:'1',
  mode:'full',resumeRows:[prior],routeClient});
 assert.equal(retry.diagnostics.metrics.activitiesComputed,1);
 assert.equal(retry.diagnostics.finalPlanValid,true);
 assert.deepEqual(retry.rows.find(row=>row.courseId==='done').meetings,prior.meetings);
 assert.equal(retry.rows.find(row=>row.courseId==='pending').instructorEmpId,'1');
});
