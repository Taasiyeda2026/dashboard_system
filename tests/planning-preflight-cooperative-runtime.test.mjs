import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runPlanningPreflight, startPlanningLeaseHeartbeat, planningLeaseWaitMessage, throwIfPlanningRunInvalidated } from '../frontend/src/screens/course-scheduling-preflight.js';
import { prepareSchedulingRunContext, prepareSchedulingRunContextCooperatively, preliminaryCourseCandidatesCooperatively, preliminaryCourseCandidates, forkSchedulingRunContext, appendSchedulingRunActivity, updateSchedulingRunContextCooperatively, instructorLoad } from '../frontend/src/screens/course-scheduling-engine.js';
import { createPlanningCheckpoint, recruitmentRescueProbeCooperatively } from '../frontend/src/screens/course-scheduling-planning.js';
import { isCheckpointResumable, canCommitValidatedCheckpoint, planningCheckpointChunks, resolvePlanningRunPlan } from '../frontend/src/screens/course-scheduling-run-plan.js';

const facts = {schemaVersion:1,sourceRevision:'12',dirtyCount:0,workspace:{engineVersion:'v28',revision:5,validatedSourceRevision:'12'}};
const scope = {periodKey:'year',district:'center'};
const course = {row_id:'target',activity_season:'school_2027',activity_type:'course',status:'פתוח',activity_name:'Program',school_id:1,school:'School',school_address:'school',authority:'Authority',calendar_sector:'general',instruction_language:'he',required_instructor_gender:'any',sessions:1,date_1:'2026-10-11',start_time:'10:00',end_time:'11:30'};
const instructors = Array.from({length:3},(_,i)=>({emp_id:String(i+1),full_name:`Instructor ${i+1}`,active:'yes',address:`home${i}`}));
const profiles = Object.fromEntries(instructors.map(i=>[i.emp_id,{gender:'female',instruction_languages:['he']}]));
const rules = Object.fromEntries(instructors.map(i=>[i.emp_id,[{weekday:0,available:true,start_time:'08:00',end_time:'18:00'}]]));
const input = {activities:[course],instructors,profiles,rules,exceptions:{},schoolCalendar:[],periodKey:'year'};

test('fast preflight: no-op and active lease skip acquisition; changed source, dirty row and forceFull acquire',async()=>{
  for(const [f,forceFull,decision] of [[facts,false,'no-op'],[{...facts,activeLease:{run_id:'other'}},true,'blocked'],[{...facts,sourceRevision:'13'},false,'run'],[{...facts,dirtyCount:1},false,'run'],[facts,true,'run']]) {
    const calls=[];
    const result=await runPlanningPreflight({scope,runId:'run',engineVersion:'v28',forceFull,load:async()=>{calls.push('preflight');return f;},acquire:async()=>{calls.push('acquire');return {acquired:true};}});
    assert.equal(result.decision,decision);assert.deepEqual(calls,decision==='run'?['preflight','acquire']:['preflight']);
  }
  await assert.rejects(runPlanningPreflight({scope,load:async()=>({}),acquire:()=>assert.fail()}),/migration_required/);
});

test('heartbeat is serialized; authoritative lease loss stops ownership; transport errors remain retryable',async()=>{
  let callback,finish,renewals=0,lost=0,cleared=false;
  const heartbeat=startPlanningLeaseHeartbeat({renew:()=>{renewals++;return new Promise(resolve=>{finish=resolve;});},onLost:()=>lost++,setTimer:cb=>{callback=cb;return 1;},clearTimer:()=>{cleared=true;}});
  callback();callback();await Promise.resolve();assert.equal(renewals,1);
  finish({ok:false,reason:'lease_missing'});await heartbeat.heartbeat();assert.equal(lost,1);
  heartbeat.stop();callback();assert.equal(renewals,1);assert.equal(cleared,true);
  let errors=0;
  const rejected=startPlanningLeaseHeartbeat({renew:async()=>{throw Error('transport');},onLost:()=>errors++,setTimer:()=>1,clearTimer:()=>{}});
  await rejected.heartbeat();assert.equal(errors,0);rejected.stop();
});

test('lease wait message derives its duration from server retry time',()=>{
  const now=Date.parse('2026-10-06T00:00:00Z');
  assert.match(planningLeaseWaitMessage({retry_at:'2026-10-06T00:00:45Z'},now),/45/);
  assert.match(planningLeaseWaitMessage({expires_at:'2026-10-06T00:14:21Z'},now),/15 דקות/);
});

test('school forks isolate provisional assignments and accept other-school deltas without leaking to their base',()=>{
  const first={...course,row_id:'planning-block:first',emp_id:'1',instructor_assignment_status:'assigned'};
  const second={...course,row_id:'planning-block:second',school_id:2,emp_id:'2',instructor_assignment_status:'assigned'};
  const base=prepareSchedulingRunContext({...input,activities:[first,second]});
  const fork=forkSchedulingRunContext(base,a=>a.school_id===1,'school-1');
  assert.equal(fork.assignedRows['1'].length,0);
  appendSchedulingRunActivity(base,{...first,row_id:'later',emp_id:'1'});
  assert.equal(fork.assignedRows['1'].length,0);
  appendSchedulingRunActivity(fork,{...second,row_id:'fork-only'});
  assert.equal(base.assignedRows['2'].length,1);
});

test('context deltas produce the same candidates and projected loads as a fresh rebuild',async()=>{
  const original={...course,row_id:'original',emp_id:'1',instructor_assignment_status:'assigned',start_time:'08:00',end_time:'09:30'};
  const context=prepareSchedulingRunContext({...input,activities:[original]});
  const moved={...original,emp_id:'2',date_1:'2026-10-18'};
  await updateSchedulingRunContextCooperatively(context,[moved]);
  const target={...input,activities:[course],targetCourse:course,targetCourseId:course.row_id,preparedContext:context};
  const updated=await preliminaryCourseCandidatesCooperatively(target);
  const fresh=preliminaryCourseCandidates({...target,preparedContext:prepareSchedulingRunContext({...input,activities:[moved]})});
  assert.deepEqual(updated,fresh);
  for(const {candidate} of updated) {
    const assigned=candidate.instructor.emp_id==='2'?[moved]:[];
    assert.deepEqual(candidate.load,instructorLoad([...assigned,candidate.periodCourse],profiles[candidate.instructor.emp_id],rules[candidate.instructor.emp_id],{periodKey:'year'}));
  }
});

test('CPU-heavy preparation yields inside one instructor history and cancellation interrupts that history',async()=>{
  const activities=Array.from({length:2500},(_,i)=>({...course,row_id:`history-${i}`,emp_id:'1',instructor_assignment_status:'assigned'}));
  const controller=new AbortController();let ticks=0;
  const interval=setInterval(()=>ticks++,1);
  const checkpoint=createPlanningCheckpoint({budgetMs:2,signal:controller.signal});
  const timer=setTimeout(()=>controller.abort(),15);
  try {await assert.rejects(prepareSchedulingRunContextCooperatively({...input,activities},checkpoint),/planning_cancelled/);assert.ok(ticks>0);}finally{clearTimeout(timer);clearInterval(interval);}
});

test('CPU-heavy candidate loop continues heartbeat and observes lost ownership before a result',async()=>{
  const many=Array.from({length:2000},(_,i)=>({...instructors[0],emp_id:String(i+1)}));
  const p=Object.fromEntries(many.map(i=>[i.emp_id,profiles['1']]));const r=Object.fromEntries(many.map(i=>[i.emp_id,rules['1']]));
  const preparedContext=prepareSchedulingRunContext({...input,instructors:many,profiles:p,rules:r});
  const controller=new AbortController();let renewals=0;
  const heartbeat=startPlanningLeaseHeartbeat({intervalMs:2,renew:async()=>({ok:++renewals<3}),onLost:()=>controller.abort()});
  try {await assert.rejects(preliminaryCourseCandidatesCooperatively({...input,instructors:many,profiles:p,rules:r,targetCourse:course,preparedContext},createPlanningCheckpoint({budgetMs:2,signal:controller.signal})),/planning_cancelled/);assert.equal(renewals,3);}finally{heartbeat.stop();}
});

test('resume after reload requires source, workspace revision, engine, fingerprints, phase and complete scope',()=>{
  const args={workspaceRevision:5,engineVersion:'v28',sourceRevision:'12',dataFingerprint:'data',contextFingerprint:'context',runType:'full-maintenance',requiredCourseIds:['target']};
  const checkpoint={rows:[{courseId:'target'}],completedActivityIds:['target'],meta:{...args,engineTo:'v28',phase:'validated'}};
  assert.equal(canCommitValidatedCheckpoint({...args,checkpoint}),true);
  for(const mismatch of [{sourceRevision:'13'},{workspaceRevision:6},{engineVersion:'v29'},{dataFingerprint:'other'},{contextFingerprint:'other'},{requiredCourseIds:['absent']}]) assert.equal(canCommitValidatedCheckpoint({...args,...mismatch,checkpoint}),false);
  assert.equal(isCheckpointResumable({...args,checkpoint:{...checkpoint,meta:null}}),false);
  assert.equal(canCommitValidatedCheckpoint({...args,checkpoint:{...checkpoint,meta:{...checkpoint.meta,phase:'running'}}}),false);
});

test('screen orchestration gates heavy work before snapshot load, preserves incremental retry and releases on pagehide',async()=>{
  const source=await readFile(new URL('../frontend/src/screens/course-scheduling.js',import.meta.url),'utf8');
  const run=source.slice(source.indexOf('const runCoursePlanning = async'),source.indexOf('const clonePlanningOption'));
  assert.ok(run.indexOf('await runPlanningPreflight')<run.indexOf('await loadSharedPlanningWorkspace'));
  assert.ok(run.indexOf("preflight.decision === 'no-op'")<run.indexOf('await loadSharedPlanningWorkspace'));
  assert.ok(!run.includes('loadSchedulingTravelCacheRows('));
  assert.match(run,/addEventListener\?\.\('pagehide'/);assert.match(run,/finally[\s\S]*releaseSchedulingPlanningRunLease/);
  const retry=source.slice(source.indexOf("root.querySelector('[data-run-course-planning]')"),source.indexOf("root.querySelector('[data-refresh-shared-planning]')"));
  assert.ok(retry.includes('runCoursePlanning({ forceFull: false, reuseSnapshot })'));
});


test('checkpoint errors abort immediately on source/revision/ownership loss and preserve retryable transport failures',()=>{
  for(const reason of ['planning_source_revision_conflict','planning_revision_conflict','planning_run_ownership_lost']) assert.throws(()=>throwIfPlanningRunInvalidated({message:reason}));
  assert.doesNotThrow(()=>throwIfPlanningRunInvalidated({message:'network timeout'}));
});

test('a hung renewal times out locally without falsely cancelling server ownership',async()=>{
  let lost=0;const heartbeat=startPlanningLeaseHeartbeat({renew:()=>new Promise(()=>{}),onLost:()=>lost++,timeoutMs:5,setTimer:()=>1,clearTimer:()=>{}});
  try{await heartbeat.heartbeat();assert.equal(lost,0);}finally{heartbeat.stop();}
});

test('fast rescue deadline interrupts pathological per-activity work without cancelling the planning run',async()=>{
  const {createPlanningDeadlineCheckpoint}=await import('../frontend/src/screens/course-scheduling-planning.js');
  let now=0;let baseCalls=0;
  const checkpoint=createPlanningDeadlineCheckpoint({budgetMs:12,now:()=>now,checkpoint:async()=>{baseCalls+=1;now+=5;}});
  await checkpoint();await checkpoint();
  await assert.rejects(checkpoint(),error=>error?.code==='planning_rescue_budget_exceeded');
  assert.equal(baseCalls,3);
});


test('checkpoint chunks bound UTF-8 wire bytes and rows, preserve every row, and validate only the complete final chunk',()=>{
  const rows=Array.from({length:25},(_,i)=>({courseId:String(i),detail:'ת'.repeat(30000)}));
  const meta={phase:'validated',sourceRevision:'12'};
  const chunks=[...planningCheckpointChunks({rows,meta,rpcArgs:{p_context_fingerprint:'context'}})];
  assert.ok(chunks.length>3);
  assert.deepEqual(chunks.flatMap(c=>c.p_rows.slice(1)),rows);
  for(const [index,chunk] of chunks.entries()){assert.ok(chunk.p_rows.length<=11);assert.ok(new TextEncoder().encode(JSON.stringify(chunk)).length<=256*1024);assert.equal(chunk.p_rows[0].phase,index===chunks.length-1?'validated':'running');}
  assert.equal(meta.phase,'validated');
  assert.throws(()=>[...planningCheckpointChunks({rows:[{courseId:'large',detail:'x'.repeat(1024*1024)}],meta})],/payload_too_large/);
});


test('default browser yield services timers even when scheduler continuations resolve immediately',async()=>{
  const previous=globalThis.scheduler;globalThis.scheduler={yield:async()=>{}};
  let timerRan=false;const timer=setTimeout(()=>{timerRan=true;},0);
  try{await createPlanningCheckpoint()({force:true});assert.equal(timerRan,true);}finally{clearTimeout(timer);if(previous===undefined)delete globalThis.scheduler;else globalThis.scheduler=previous;}
});

test('recruitment rescue cancellation is observed inside one instructor and one schedule history',async()=>{
  const controller=new AbortController();
  const row={courseId:course.row_id,scheduleOptions:[{startDate:course.date_1,endDate:course.date_1,startTime:course.start_time,endTime:course.end_time,meetings:[{date:course.date_1,start_time:course.start_time,end_time:course.end_time}]}]};
  const meetings=Array.from({length:35},()=>({date:'2027-01-03',start_time:'08:00',end_time:'09:00'}));
  const existingRows=Array.from({length:5000},(_,i)=>({courseId:`other-${i}`,instructorEmpId:'1',meetings}));
  const timer=setTimeout(()=>controller.abort(),5);
  try{await assert.rejects(recruitmentRescueProbeCooperatively({row,activity:course,instructors:[instructors[0]],profiles,rules,exceptions:{},existingRows},createPlanningCheckpoint({budgetMs:2,signal:controller.signal})),/planning_cancelled/);}finally{clearTimeout(timer);}
});


test('an existing workspace without a source cursor needs one bootstrap validation; verified one-row changes stay incremental',()=>{
  const input={shared:{workspace:{revision:5},rows:[{courseId:'one'},{courseId:'two'}]},currentCourseIds:['one','two'],regularAffectedIds:['one'],storedEngineVersion:'v28',currentEngineVersion:'v28'};
  const bootstrap=resolvePlanningRunPlan({...input,sourceValidationRequired:true});
  assert.equal(bootstrap.runType,'full-maintenance');assert.equal(bootstrap.reasons[0].code,'source_validation_bootstrap');
  const verified=resolvePlanningRunPlan(input);assert.equal(verified.runType,'incremental');assert.deepEqual(verified.baseRecalculationIds,['one']);
});

test('candidate load projection preserves proposed draft dates in instructor history',()=>{
  const history={...course,row_id:'draft-history',draft_emp_id:'3',draft_proposed_meetings:[{date:'2026-10-18',start_time:'10:00',end_time:'11:30'},{date:'2026-10-25',start_time:'10:00',end_time:'11:30'}]};
  const preparedContext=prepareSchedulingRunContext({...input,activities:[history]});
  const candidates=preliminaryCourseCandidates({...input,activities:[history,course],targetCourse:course,targetCourseId:course.row_id,preparedContext});
  assert.ok(candidates.length>0);
  assert.ok(candidates.some(({candidate})=>candidate.instructor.emp_id==='3'));
  for(const {candidate} of candidates){const assignments=candidate.instructor.emp_id==='3'?[history]:[];assert.deepEqual(candidate.load,instructorLoad([...assignments,candidate.periodCourse],profiles[candidate.instructor.emp_id],rules[candidate.instructor.emp_id],{periodKey:'year'}));assert.equal(candidate.projectedHalfHours,candidate.instructor.emp_id==='3'?4.5:1.5);}
});
