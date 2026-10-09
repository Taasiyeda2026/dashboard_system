import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { expandPlanningAffectedIdsBySchool, sharedPlanningAffectedCourseIds, planningEngineUpgradeAffectedCourseIds, planningEngineUpgradeExecutionScopes } from '../frontend/src/screens/course-scheduling-planning-store.js';
import { PLANNING_ENGINE_VERSION, validateResumedPlanningRows, buildDynamicCoursePlan } from '../frontend/src/screens/course-scheduling-planning.js';
import { resolvePlanningRunPlan, isCheckpointResumable, canCommitValidatedCheckpoint, PLANNING_RUN_TYPES } from '../frontend/src/screens/course-scheduling-run-plan.js';
import { createRouteClient } from '../frontend/src/screens/course-scheduling-travel.js';
const date='2026-10-12';
const meeting=(d=date)=>({meeting_no:1,date:d,start_time:'09:00',end_time:'10:00'});
const activity=(id,school=id)=>({row_id:id,school_id:school,school_address:school,school,activity_season:'school_2027',activity_type:'course',status:'פתוח',activity_name:'Synthetic',calendar_sector:'general',sessions:1,instruction_language:'he',required_instructor_gender:'any',updated_at:'2026-10-09',date_1:date,start_time:'09:00',end_time:'10:00'});
const row=(id,emp='1',school=id)=>({courseId:id,kind:'proposal',schoolId:school,instructorEmpId:emp,meetings:[meeting()],startDate:date,endDate:date,startTime:'09:00',endTime:'10:00',options:[]});
const entry=(id,emp,school,extra={})=>({activityId:id,activityUpdatedAt:'2026-10-09',row:row(id,emp,school),...extra});
const oldCheckpoint=version=>({rows:[row('dirty')],completedActivityIds:['dirty'],meta:{engineTo:version,workspaceRevision:7,sourceRevision:'9',dataFingerprint:'data',contextFingerprint:'context',runType:PLANNING_RUN_TYPES.ENGINE_UPGRADE,phase:'validated'}});
test('dependency closure traverses locked and approved bridges without targeting or mutating either, including compact rows',t=>{
 const entries=[entry('seed','1','s1'),entry('locked','2','s1',{lockedOption:{instructorEmpId:'2',meetings:[meeting()]}}),entry('approved','2','s2',{row:{...row('approved','2','s2'),kind:'live'}}),entry('peer','3','s2'),entry('end','3','s3'),entry('unrelated','4','s4')];
 const activities=entries.map(e=>({...activity(e.activityId,e.row.schoolId),...(e.activityId==='approved'?{emp_id:'2'}:{})}));
 for(const shared of [{rows:entries},{rows:entries.map(e=>({...e,row:{...e.row,dependencyInstructorIds:[e.row.instructorEmpId],dependencySlots:e.row.meetings,meetings:[]}}))},{rows:entries.map(e=>e.activityId==='approved'?{...e,row:{...e.row,kind:'proposal'}}:e)}]){
  const before=JSON.stringify({shared,activities}),start=performance.now();const ids=expandPlanningAffectedIdsBySchool({affectedIds:['seed'],shared,activities});
  assert.deepEqual(new Set(ids),new Set(['seed','peer','end']));assert.equal(JSON.stringify({shared,activities}),before);
  t.diagnostic(JSON.stringify({case:'immutable-bridge',compact:shared.rows!==entries,elapsedMs:performance.now()-start,targets:ids,immutableTargets:0}));
 }
});
test('previous engine versions keep needs_recalc work scoped and reject an old checkpoint while preserving saved proposals and official dates',()=>{
 for(const version of ['planning-v22-old','planning-v28-old','planning-v31-old','planning-v35-old','planning-v35-old--base-saved-opt-pending']){
  const activities=['fixed','proposal','dirty','locked','approved'].map(id=>activity(id));
  const shared={workspace:{revision:7,engineVersion:version},rows:activities.map((a,i)=>entry(a.row_id,String(i+1),a.school_id))};
  shared.rows[0].row.kind='fixed-proposal';shared.rows[2].needsRecalc=true;shared.rows[3].lockedOption={instructorEmpId:'1',meetings:[meeting()]};shared.rows[4].row.kind='live';
  const before=JSON.stringify({shared,activities});const currentCourseIds=activities.map(a=>a.row_id);
  const regularAffectedIds=sharedPlanningAffectedCourseIds({shared,activities,currentCourseIds});
  const engineUpgradeAffectedIds=planningEngineUpgradeAffectedCourseIds({shared,activities,storedEngineVersion:version,currentEngineVersion:PLANNING_ENGINE_VERSION});
  assert.deepEqual(regularAffectedIds,['dirty']);assert.deepEqual(engineUpgradeAffectedIds,[]);
  const upgradeExecution=planningEngineUpgradeExecutionScopes({regularAffectedIds,engineUpgradeAffectedIds,storedEngineVersion:version,currentEngineVersion:PLANNING_ENGINE_VERSION});
  const plan=resolvePlanningRunPlan({shared,currentCourseIds,regularAffectedIds,engineUpgradeAffectedIds,upgradeExecution,storedEngineVersion:version,currentEngineVersion:PLANNING_ENGINE_VERSION,currentDataFingerprint:'data',currentContextFingerprint:'context',sourceRevision:'9',resumableCheckpoint:oldCheckpoint(version)});
  assert.deepEqual(plan.baseRecalculationIds,['dirty']);assert.equal(plan.resume,null);assert.notEqual(plan.runType,PLANNING_RUN_TYPES.FULL_MAINTENANCE);assert.equal(JSON.stringify({shared,activities}),before);
 }
});
test('valid previous-version snapshot requires validation-only marker advancement and never resumes the old checkpoint',()=>{
 const version='planning-v31-old';const shared={workspace:{revision:7},rows:[entry('a','1','a')]};
 const plan=resolvePlanningRunPlan({shared,currentCourseIds:['a'],storedEngineVersion:version,currentEngineVersion:PLANNING_ENGINE_VERSION,resumableCheckpoint:oldCheckpoint(version)});
 assert.equal(plan.runType,PLANNING_RUN_TYPES.NO_OP);assert.equal(plan.advanceEngineMarker,true);assert.deepEqual(plan.affectedIds,[]);assert.equal(plan.resume,null);
});
test('v36 detects official date and time drift in fixed and legacy proposal rows, without targeting locks or approvals',()=>{
 const activities=['fixed','legacy','array','locked','approved'].map(id=>activity(id));activities[2]={...activities[2],date_1:null,meetings:[meeting()]};
 const shared={rows:activities.map(a=>entry(a.row_id,'1',a.school_id))};shared.rows[0].row.kind='fixed-proposal';shared.rows[0].row.meetings[0].start_time='09:15';
 for(const e of shared.rows.slice(1))e.row.meetings[0].date='2026-10-19';
 shared.rows[3].lockedOption={instructorEmpId:'1',meetings:[meeting()]};shared.rows[4].row.kind='live';
 assert.deepEqual(new Set(planningEngineUpgradeAffectedCourseIds({shared,activities,storedEngineVersion:'planning-v35-old',currentEngineVersion:PLANNING_ENGINE_VERSION})),new Set(['fixed','legacy','array']));
});
test('old validated and legacy checkpoints cannot resume or commit as v36 under the current source revision',()=>{
 const input={workspaceRevision:7,engineVersion:PLANNING_ENGINE_VERSION,dataFingerprint:'data',contextFingerprint:'context',sourceRevision:'9',runType:PLANNING_RUN_TYPES.ENGINE_UPGRADE};
 for(const checkpoint of [oldCheckpoint('planning-v35-old'),{rows:[row('dirty')],completedActivityIds:['dirty']}]){
  assert.equal(isCheckpointResumable({...input,checkpoint}),false);assert.equal(canCommitValidatedCheckpoint({...input,checkpoint}),false);
 }
 assert.equal(isCheckpointResumable({...input,checkpoint:oldCheckpoint(PLANNING_ENGINE_VERSION)}),true);
});
const instructors=[{emp_id:'1',active:'yes',full_name:'Synthetic',address:'home'}];const profiles={'1':{gender:'female',instruction_languages:['he']}};const rules={'1':Array.from({length:6},(_,weekday)=>({weekday,available:true,start_time:'08:00',end_time:'18:00'}))};
test('explicit saved-row validation rejects legacy proposal drift before any version marker may advance',async t=>{
 const a=activity('a'),old=row('a');old.meetings=[meeting('2026-10-19')];const before=JSON.stringify({a,old}),start=performance.now();
 const checked=await validateResumedPlanningRows({activities:[a],rows:[old],instructors,profiles,rules,checkpoint:async()=>{}});
 assert.equal(checked.valid,false);assert.ok(checked.failures.some(f=>f.reason==='official_schedule_changed'));assert.equal(JSON.stringify({a,old}),before);t.diagnostic(JSON.stringify({case:'stale-official-date',elapsedMs:performance.now()-start,valid:checked.valid}));
});
test('scoped v36 repair restores official dates and retains an existing unaffected proposal and source data',async()=>{
 const a=activity('a'),other={...activity('other'),date_1:null};const existing=[{...row('a'),kind:'fixed-proposal',meetings:[meeting('2026-10-19')]},{...row('other'),meetings:[meeting('2026-10-20')]}];
 const input={activities:[a,other],existingRows:existing,committedRows:existing,instructors,profiles,rules,catalog:[{activity_name:'Synthetic',meetings_count:1,hours_count:1}],today:'2026-10-09',targetCourseIds:['a'],skipSoftOptimization:true,allowGlobalRepair:false,checkpoint:async()=>{},routeClient:createRouteClient({preloadedRows:['a','other'].flatMap(s=>[{origin_key:'home',destination_key:s,distance_km:5,duration_minutes:10},{origin_key:s,destination_key:'home',distance_km:5,duration_minutes:10}]),invoke:async()=>{throw Error('No network');}})};
 const before=JSON.stringify({activities:input.activities,existing});const result=await buildDynamicCoursePlan(input);
 assert.equal(result.finalPlanValidation.valid,true);assert.equal(result.rows.find(r=>r.courseId==='a').meetings[0].date,date);const retained=result.rows.find(r=>r.courseId==='other');assert.deepEqual(retained.meetings,existing[1].meetings);assert.equal(retained.instructorEmpId,existing[1].instructorEmpId);assert.equal(JSON.stringify({activities:input.activities,existing}),before);
});

test('official date without official hours allows a legal proposed time while still forbidding a changed date',async()=>{
 const a={...activity('date-only'),start_time:null,end_time:null};
 const saved=row('date-only');
 const checked=await validateResumedPlanningRows({activities:[a],rows:[saved],instructors,profiles,rules,checkpoint:async()=>{}});assert.equal(checked.valid,true);
 saved.meetings=[meeting('2026-10-19')];const moved=await validateResumedPlanningRows({activities:[a],rows:[saved],instructors,profiles,rules,checkpoint:async()=>{}});assert.equal(moved.valid,false);assert.ok(moved.failures.some(f=>f.reason==='official_schedule_changed'));
});
