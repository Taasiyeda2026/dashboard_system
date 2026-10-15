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
