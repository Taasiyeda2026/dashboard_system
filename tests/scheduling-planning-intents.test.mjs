import test from 'node:test';
import assert from 'node:assert/strict';
import {applyPlanningIntents} from '../services/scheduling-agent/planning-intents.mjs';
import {computeAgentSchedulingPlan} from '../services/scheduling-agent/compute-plan.mjs';
const course={row_id:'course-1',school:'Synthetic',activity_name:'Test',activity_season:'school_2027',activity_type:'course',status:'פתוח'};
const intent={activity_id:'course-1',emp_id:1,status:'active',version:1};
const snapshot={activities:[course],planningIntents:[intent],instructors:[],profiles:[],rules:[],exceptions:[],schoolCalendar:[],catalog:[],today:'2026-10-16',skipSoftOptimization:true};
test('undated intended instructor survives full computation without becoming an assignment',async()=>{
 const before=JSON.stringify(snapshot);
 const result=await computeAgentSchedulingPlan({snapshot,sourceRevision:'1',workspaceRevision:'1',mode:'full',routeClient:{peek:()=>null,request:async()=>null}});
 assert.equal(result.rows.length,1);
 assert.equal(result.rows[0].planningIntent.instructorId,1);
 assert.equal(result.rows[0].instructorEmpId,null);
 assert.deepEqual(result.rows[0].meetings,[]);
 assert.equal(JSON.stringify(snapshot),before);
});
test('holds remove stale proposals and preserve official non-cancelled meeting dates',()=>{
 const out=applyPlanningIntents({...snapshot,activities:[{...course,date_1:'2026-11-01',date_2:'2026-11-08',start_time:'10:00',end_time:'11:30',cancelled_meeting_dates:['2026-11-08']}],existingRows:[{courseId:'course-1',instructorEmpId:99}],committedRows:[{courseId:'course-1'}]});
 assert.equal(out.snapshot.activities.length,0);assert.equal(out.snapshot.existingRows.length,0);
 assert.deepEqual(out.rows[0].meetings,[{date:'2026-11-01',start_time:'10:00',end_time:'11:30',meeting_no:1}]);
});
test('released intentions and official assignments remain in the normal validated engine',()=>{
 assert.equal(applyPlanningIntents({...snapshot,planningIntents:[{...intent,status:'released'}]}).rows.length,0);
 assert.equal(applyPlanningIntents({...snapshot,activities:[{...course,emp_id:1}]}).snapshot.activities.length,1);
});
let handler;
globalThis.Deno={env:{get:()=> 'test-key'},serve:h=>{handler=h;}};
await import('../supabase/functions/scheduling-agent-team-gateway/index.ts');
async function call(name,args,auth=true){
 const original=globalThis.fetch;const calls=[];
 globalThis.fetch=async(url,opts)=>{calls.push({url,opts});return Response.json(url.endsWith('/auth/v1/user')?{id:'test-user'}:url.endsWith('/scheduling_agent_team_identity')?{authorized:true}:{saved:true});};
 try{const r=await handler(new Request('https://test.invalid/mcp',{method:'POST',headers:auth?{Authorization:'Bearer test-jwt'}:{},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})}));return {status:r.status,body:await r.json(),calls};}finally{globalThis.fetch=original;}
}
test('gateway saves instructor without dates using caller JWT and exact version',async()=>{
 const r=await call('save_intended_instructor',{activityId:'course-1',instructorId:1,reason:'Pending dates',status:'active',expectedVersion:'0'});
 assert.equal(r.body.result.isError,false);
 assert.match(r.calls.at(-1).url,/scheduling_agent_team_save_intended_instructor$/);
 assert.equal(r.calls.at(-1).opts.headers.Authorization,'Bearer test-jwt');
 assert.deepEqual(JSON.parse(r.calls.at(-1).opts.body),{p_activity_id:'course-1',p_emp_id:1,p_reason:'Pending dates',p_status:'active',p_expected_version:'0'});
});
test('gateway rejects missing version, injected fields and unauthenticated save',async()=>{
 for(const args of [{instructorId:1,planText:'Sunday'}, {instructorId:1,planText:'Sunday',expectedVersion:'0',override:true}]){
  const r=await call('save_planning_baseline',args);assert.equal(r.body.result.isError,true);assert.equal(r.calls.length,2);
 }
 assert.equal((await call('save_planning_baseline',{},false)).status,401);
});
test('gateway saves baseline and reads versions separately from schedule confirmation',async()=>{
 for(const [name,args] of [['save_planning_baseline',{instructorId:1,planText:'Sunday primary; alternative only',expectedVersion:'0'}],['read_planning_intents',{instructorId:1}]]){
  const r=await call(name,args);assert.equal(r.body.result.isError,false);assert.equal(r.calls.length,3);
 }
});
