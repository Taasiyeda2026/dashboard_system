// Anonymous offline incremental/recovery checks. No production calls.
import {readFile,writeFile} from 'node:fs/promises';import assert from 'node:assert/strict';
import {decisionInput} from './new-engine-input.mjs';
import {buildDynamicCoursePlan,validateResumedPlanningRows,planningWorkspaceCourses,PLANNING_ENGINE_VERSION} from '../../frontend/src/screens/course-scheduling-planning.js';
import {sharedPlanningAffectedCourseIds} from '../../frontend/src/screens/course-scheduling-planning-store.js';
import {createRouteClient} from '../../frontend/src/screens/course-scheduling-travel.js';
import {isCheckpointResumable,PLANNING_RUN_TYPES} from '../../frontend/src/screens/course-scheduling-run-plan.js';
const out=process.env.ACCEPTANCE_OUT,{input,routes}=await decisionInput(process.env.DECISION_DIR),plan=JSON.parse(await readFile(out+'/national-plan.json','utf8'));
input.routeClient=createRouteClient({preloadedRows:routes,invoke:async()=>({data:{calculated:false},error:null})});input.existingRows=plan.rows;input.committedRows=plan.rows;
const target=plan.rows.find(r=>r.kind==='fixed-proposal'&&r.instructorEmpId),date=target.meetings[0].date,emp=target.instructorEmpId;
input.targetCourseIds=sharedPlanningAffectedCourseIds({shared:{rows:plan.rows.map(row=>({activityId:row.courseId,activityUpdatedAt:input.activities.find(a=>a.row_id===row.courseId)?.updated_at,row,needsRecalc:false}))},activities:input.activities,currentCourseIds:planningWorkspaceCourses(input.activities,'','year').map(a=>a.row_id),contextDiff:{changedExceptionInstructorIds:[emp],changedExceptionDatesByInstructor:{[emp]:[date]}}});
input.exceptions={...input.exceptions,[emp]:[...(input.exceptions[emp]||[]),{exception_date:date,available:false}]};
const at=performance.now(),changed=await buildDynamicCoursePlan(input),results=[];
assert.equal(changed.finalPlanValidation.valid,true);const updated=changed.rows.find(r=>r.courseId===target.courseId);assert.notEqual(updated.instructorEmpId,emp);assert.deepEqual(updated.meetings.map(m=>m.date),target.meetings.map(m=>m.date));
for(const old of plan.rows.filter(r=>r.kind==='live')){const row=changed.rows.find(r=>r.courseId===old.courseId);assert.deepEqual(row.meetings,old.meetings);assert.equal(row.instructorEmpId,old.instructorEmpId);}
results.push({case:'blocked-date dependency closure, full-result validation, official/protected preservation',pass:true,affected:input.targetCourseIds.length,computed:changed.newEngineMetrics.activitiesComputed,elapsedMs:performance.now()-at,target:target.courseId,date});
const meta={engineTo:PLANNING_ENGINE_VERSION,sourceRevision:'12',workspaceRevision:1,dataFingerprint:'anonymous',contextFingerprint:'anonymous',phase:'validated',runType:PLANNING_RUN_TYPES.FULL_MAINTENANCE};const envelope={checkpoint:{rows:plan.rows,completedActivityIds:plan.rows.map(r=>r.courseId),meta},engineVersion:PLANNING_ENGINE_VERSION,sourceRevision:'12',workspaceRevision:1,dataFingerprint:'anonymous',contextFingerprint:'anonymous',runType:PLANNING_RUN_TYPES.FULL_MAINTENANCE};
assert.ok(isCheckpointResumable(envelope));assert.ok(!isCheckpointResumable({...envelope,checkpoint:{...envelope.checkpoint,meta:{...meta,engineTo:'planning-v36'}}}));assert.ok(!isCheckpointResumable({...envelope,sourceRevision:'13'}));results.push({case:'matching checkpoint resumes; old engine/stale source rejected',pass:true});
const corrupt=structuredClone(changed.rows);corrupt.find(r=>r.kind==='proposal'&&r.instructorEmpId).meetings[0].end_time='23:59';const checked=await validateResumedPlanningRows({...input,rows:corrupt});assert.equal(checked.valid,false);results.push({case:'corrupt checkpoint timing fails full resumed validation',pass:true,repairIds:checked.repairCourseIds});
await writeFile(out+'/recovery-acceptance.json',JSON.stringify({results,scope:'actual new core, isolated representative point change; checkpoint version/source and corrupt-result rejection; no browser-survival claim'},null,2));console.log(JSON.stringify({results}));
