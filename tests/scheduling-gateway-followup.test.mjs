import test from 'node:test';
import assert from 'node:assert/strict';
import {schedulingError} from '../supabase/functions/scheduling-agent-team-gateway/diagnostics.mjs';
let handler;
globalThis.Deno={env:{get:()=> 'fake-publishable-key'},serve:h=>{handler=h;}};
await import('../supabase/functions/scheduling-agent-team-gateway/index.ts');
const url='https://example.test/functions/v1/scheduling-agent-team-gateway/mcp';
const originalFetch=globalThis.fetch;
async function call({name='review_manager_approval',args={activityId:'activity-1',requestId:'request-1',decision:'approved'},auth=true,identity=true,state={},reviewStatus=200,network=false}={}){
  const calls=[];
  globalThis.fetch=async (url,opts)=>{
    calls.push({url,opts});
    if(url.endsWith('/auth/v1/user'))return Response.json({id:'fake-user'});
    if(url.endsWith('/scheduling_agent_team_identity'))return Response.json({authorized:identity});
    if(url.endsWith('/scheduling_agent_team_manager_approval_state'))return Response.json({request_id:'request-1',request_status:'pending',approval_required:true,...state});
    if(network)throw Error('network acknowledgement lost');
    if(reviewStatus!==200)return Response.json({code:'42501',message:'scheduling_permission_denied',details:'private data'}, {status:reviewStatus});
    return Response.json({request_id:'request-1',source_row_id:'activity-1',status:'approved',reviewed_at:'2026-10-15',requested_payload:{finance:'DO NOT LEAK'},reviewer_user_id:'PRIVATE'});
  };
  try{
    const response=await handler(new Request(url,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer fake-user-jwt'}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})}));
    const raw=await response.json();
    const text=raw.result?.content?.[0]?.text;
    let payload;try{payload=JSON.parse(text);}catch{payload=text;}
    return {response,raw,payload,calls};
  }finally{globalThis.fetch=originalFetch;}
}
test('uses only caller JWT and existing reviewer; receipt excludes raw payload',async()=>{
 const r=await call();const review=r.calls.find(c=>c.url.endsWith('/review_course_assignment_manager_approval'));
 assert.ok(review);assert.equal(review.opts.headers.Authorization,'Bearer fake-user-jwt');
 assert.deepEqual(JSON.parse(review.opts.body),{p_request_id:'request-1',p_status:'approved'});
 assert.deepEqual(Object.keys(r.payload.result).sort(),['activityId','assignmentFinalized','requestId','reviewedAt','status'].sort());
 assert.equal(r.payload.result.assignmentFinalized,false);assert.doesNotMatch(JSON.stringify(r.raw),/PRIVATE|finance|DO NOT LEAK/);
});
test('unauthenticated request never reaches RPC',async()=>{const r=await call({auth:false});assert.equal(r.response.status,401);assert.equal(r.calls.length,0);});
test('membership denial stops before preflight',async()=>{const r=await call({identity:false});assert.equal(r.response.status,401);assert.equal(r.calls.length,2);});
for(const state of [{request_id:'other'},{request_status:'approved'},{approval_required:false}])test('stale/inapplicable approval blocked '+JSON.stringify(state),async()=>{const r=await call({state});assert.equal(r.payload.error,'approval_state_not_current');assert.equal(r.calls.length,3);});
test('database owner denial is propagated, never bypassed',async()=>{const r=await call({reviewStatus:403});assert.equal(r.payload.ok,false);assert.equal(r.payload.writesCommitted,false);assert.equal(r.payload.reasonCode,'scheduling_permission_denied');});
for(const decision of ['rejected','approved'])test('exact decision forwarded '+decision,async()=>{const r=await call({args:{activityId:'activity-1',requestId:'request-1',decision}});assert.equal(JSON.parse(r.calls.at(-1).opts.body).p_status,decision);});
for(const args of [{activityId:'activity-1',requestId:'request-1',decision:'approve'},{activityId:'activity-1',requestId:'',decision:'approved'},{activityId:'activity-1',requestId:'request-1',decision:'approved',owner:true}])test('invalid review arguments cannot dispatch '+JSON.stringify(args),async()=>{const r=await call({args});assert.equal(r.payload,'invalid_or_unauthorized_arguments');assert.equal(r.calls.length,2);});
test('lost acknowledgement does not claim rollback and does not retry',async()=>{const r=await call({network:true});assert.equal(r.payload.writesCommitted,null);assert.equal(r.payload.outcome,'unknown');assert.equal(r.payload.retrySameRequest,false);assert.equal(r.calls.length,4);});
test('HTTP 502 leaves write outcome unknown',async()=>{const r=await call({reviewStatus:502});assert.equal(r.payload.writesCommitted,null);assert.equal(r.payload.outcome,'unknown');});
test('ordinary draft writes also have unknown outcome on network failure',async()=>{const r=await call({name:'confirm_own_draft',args:{activityId:'activity-1'},network:true});assert.equal(r.payload.writesCommitted,null);assert.equal(r.payload.outcome,'unknown');});
for(const reason of ['scheduling_transition_distance_forbidden','scheduling_transition_unverified','scheduling_transition_insufficient','scheduling_instructor_unavailable'])test('safe actionable diagnostic '+reason,()=>{assert.equal(schedulingError({message:reason},400).reasonCode,reason);});
test('unknown SQL details never leaked',()=>{const r=schedulingError({message:'secret SQL',details:'sensitive'},400);assert.doesNotMatch(JSON.stringify(r),/secret SQL|sensitive/);});
