import test from 'node:test';
import assert from 'node:assert/strict';
import {runOneSchedulingAgentJob,SchedulingAgentRunError} from '../services/scheduling-agent/runner.mjs';

const ID='bcefc9af-7f12-4348-90ad-3f31b931a562';
function fixture({mode='incremental'}={}) {
 const events=[];
 const pre={sourceRevision:'649',dirtyCount:3,workspace:{
   revision:'12200',validatedSourceRevision:'439',engineVersion:'planning-v37'}};
 const data={sourceRevision:'649',workspaceRevision:'12200',
   dataFingerprint:'expected-data',contextFingerprint:'expected-context',
   targetCourseIds:['a'],routeClient:{},snapshot:{activities:[{row_id:'a'}]}};
 const backend={
   async claimJob(){events.push('claim');return{claimed:true,jobId:ID,mode};},
   async acquireLease(){events.push('lease');return{acquired:true};},
   async heartbeatLease(){events.push('heartbeat');return{ok:true};},
   async loadSnapshot(){events.push('snapshot');return data;},
   async readPreflight(){events.push('preflight');return pre;},
   async persistProposals(payload){
      events.push('persist');
      assert.equal(payload.sourceRevision,'649');
      assert.equal(payload.workspaceRevision,'12200');
      assert.equal(payload.runId,'11111111-1111-4111-8111-111111111111');
      pre.workspace.revision='12201';
      pre.workspace.engineVersion='planning-v38';
      pre.workspace.validatedSourceRevision='649';
      pre.dirtyCount=0;
      return {status:'completed',jobId:payload.jobId,runId:payload.runId};
   },
   async finishJob({success,failureCode}){events.push(success?'finish-success':`finish-failed:${failureCode}`);},
   async releaseLease(){events.push('release');}
 };
 const computePlan=async ({signal,mode:seen})=>{
   events.push('compute');
   assert.equal(seen,mode);
   assert.equal(signal.aborted,false);
   return {engineVersion:'planning-v38',diagnostics:{finalPlanValid:true},rows:[{courseId:'a'}]};
 };
 return {backend,data,pre,events,computePlan};
}

test('does nothing without queue work',async()=>{
 const backend={claimJob:async()=>({claimed:false})};
 for(const name of ['acquireLease','loadSnapshot','readPreflight','heartbeatLease','persistProposals','finishJob','releaseLease'])
   backend[name]=()=>{throw Error('unexpected_call')};
 assert.deepEqual(await runOneSchedulingAgentJob({backend}),{status:'idle'});
});

test('requires trusted backend adapter, never falls back to local/browser',async()=>{
 await assert.rejects(runOneSchedulingAgentJob(),e=>e instanceof SchedulingAgentRunError&&e.code==='secure_backend_adapter_required');
});

test('successful result only after atomic persistence returns the matching receipt',async()=>{
 const f=fixture();
 const result=await runOneSchedulingAgentJob({
   backend:f.backend,computePlan:f.computePlan,createRunId:()=> '11111111-1111-4111-8111-111111111111'
 });
 assert.equal(result.status,'completed');
 assert.deepEqual(f.events,[
   'claim','lease','snapshot','preflight','compute','preflight','persist','release'
 ]);
});

test('lost persistence response recovers committed receipt without reporting failure',async()=>{
 const f=fixture();let receipt;
 f.backend.persistProposals=async p=>{receipt={status:'completed',jobId:p.jobId,runId:p.runId};throw Error('connection_lost');};
 f.backend.finishJob=async()=>receipt;
 const result=await runOneSchedulingAgentJob({backend:f.backend,computePlan:f.computePlan});
 assert.equal(result.status,'completed');assert.equal(result.recoveredReceipt,true);
});

test('legacy save response cannot claim atomic completion',async()=>{
 const f=fixture();f.backend.persistProposals=async()=>({revision:2});
 const result=await runOneSchedulingAgentJob({backend:f.backend,computePlan:f.computePlan});
 assert.equal(result.status,'failed');assert.equal(result.failureCode,'worker_receipt_required');
});

test('a changed source revision refuses to save stale options',async()=>{
 const f=fixture();
 const before=f.backend.readPreflight;
 let count=0;
 f.backend.readPreflight=async(...args)=>{
   const v=await before(...args);
   if (++count===2) v.sourceRevision='650';
   return v;
 };
 const result=await runOneSchedulingAgentJob({backend:f.backend,computePlan:f.computePlan});
 assert.equal(result.status,'failed');
 assert.equal(result.failureCode,'snapshot_stale_before_commit');
 assert.ok(!f.events.includes('persist'));
 assert.ok(f.events.includes('release'));
});

test('a failed atomic save never marks a job complete',async()=>{
 const f=fixture();
 f.backend.persistProposals=async()=>{f.events.push('persist-failed');throw Object.assign(Error('conflict'),{code:'P0001'})};
 const result=await runOneSchedulingAgentJob({backend:f.backend,computePlan:f.computePlan});
 assert.equal(result.status,'failed');
 assert.equal(result.failureCode,'P0001');
 assert.ok(f.events.includes('finish-failed:P0001'));
 assert.ok(!f.events.includes('finish-success'));
});

test('a run without an acquired engine lease performs no input loading',async()=>{
 const f=fixture();
 f.backend.acquireLease=async()=>({acquired:false});
 const result=await runOneSchedulingAgentJob({backend:f.backend,computePlan:f.computePlan});
 assert.equal(result.status,'failed');
 assert.equal(result.failureCode,'planning_lease_unavailable');
 assert.ok(!f.events.includes('snapshot'));
});

test('invalid engine output is rejected before persistence',async()=>{
 const f=fixture();
 const result=await runOneSchedulingAgentJob({
  backend:f.backend,computePlan:async()=>({engineVersion:'planning-v38',diagnostics:{finalPlanValid:false},rows:[]})
 });
 assert.equal(result.status,'failed');
 assert.ok(!f.events.includes('persist'));
});
