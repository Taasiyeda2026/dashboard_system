// Real process interruption; local files only. No server or production writes.
import {fork} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {decisionInput} from './new-engine-input.mjs';
import {buildDynamicCoursePlan,planningWorkspaceCourses,PLANNING_ENGINE_VERSION,validateResumedPlanningRows} from '../../frontend/src/screens/course-scheduling-planning.js';
import {planningResumeReopenIds} from '../../frontend/src/screens/course-scheduling-run-plan.js';
import {createRouteClient} from '../../frontend/src/screens/course-scheduling-travel.js';
const dir=process.env.ACCEPTANCE_OUT, inputDir=process.env.DECISION_DIR;
if(process.argv.includes('--child')){
 const {input,routes}=await decisionInput(inputDir);Object.assign(input,{allowGlobalRepair:true,_nationalRun:true,skipSoftOptimization:false,targetCourseIds:null});
 input.routeClient=createRouteClient({preloadedRows:routes,invoke:async()=>({data:{calculated:false},error:null})});const rows=new Map();
 input.onProgress=async p=>{if(!p.row)return;rows.set(p.row.courseId,p.row);if(rows.size===12){await writeFile(dir+'/interrupted-process-checkpoint.json',JSON.stringify({engineVersion:PLANNING_ENGINE_VERSION,phase:'running',planningStage:'rows',rows:[...rows.values()],completedActivityIds:[...rows.keys()]}));process.send({checkpointWritten:true,completed:rows.size});await new Promise(()=>{});}};
 await buildDynamicCoursePlan(input);throw Error('Expected interruption before result');
}else{
 const began=performance.now(),child=fork(new URL(import.meta.url),['--child'],{stdio:['ignore','ignore','inherit','ipc']});let notification;
 await new Promise((resolve,reject)=>{child.once('message',m=>{notification=m;child.kill('SIGKILL');});child.once('exit',(code,signal)=>signal==='SIGKILL'?resolve():reject(Error('Unexpected child exit '+code)));child.once('error',reject);});
 const interruptedMs=performance.now()-began,checkpoint=JSON.parse(await readFile(dir+'/interrupted-process-checkpoint.json','utf8'));
 const {input,routes}=await decisionInput(inputDir),checked=await validateResumedPlanningRows({...input,rows:checkpoint.rows}),reopen=new Set(planningResumeReopenIds(checkpoint.rows)),completed=new Set(checkpoint.completedActivityIds.filter(id=>!reopen.has(id)));
 const report={notification,signal:'SIGKILL',interruptedMs,checkpointRows:checkpoint.rows.length,checkpointInternalValidation:checked.valid,partialCommitAttempted:false};
 if(!checked.valid){report.partialResumeRefused=true;report.repairCourseIds=checked.repairCourseIds;Object.assign(input,{targetCourseIds:null,allowGlobalRepair:true,_nationalRun:true,skipSoftOptimization:false});input.routeClient=createRouteClient({preloadedRows:routes,invoke:async()=>({data:{calculated:false},error:null})});const restart=performance.now();const rebuilt=await buildDynamicCoursePlan(input);Object.assign(report,{safeRestart:true,resumedMs:performance.now()-restart,rows:rebuilt.rows.length,internalValidation:rebuilt.finalPlanValidation});}else{
 Object.assign(input,{existingRows:checkpoint.rows,targetCourseIds:planningWorkspaceCourses(input.activities).map(a=>a.row_id).filter(id=>!completed.has(id)),optimizationScopeCourseIds:null,resumeFromCheckpoint:true,allowGlobalRepair:true,_nationalRun:true,skipSoftOptimization:false});input.routeClient=createRouteClient({preloadedRows:routes,invoke:async()=>({data:{calculated:false},error:null})});
 const at=performance.now();try{const plan=await buildDynamicCoursePlan(input);await writeFile(dir+'/process-resumed-plan.json',JSON.stringify(plan));Object.assign(report,{resumedMs:performance.now()-at,reopened:reopen.size,resumedTargets:input.targetCourseIds.length,rows:plan.rows.length,internalValidation:plan.finalPlanValidation});}catch(e){Object.assign(report,{resumedMs:performance.now()-at,error:{code:e.code,message:e.message,failures:e.failures}});}
 }
 await writeFile(dir+'/process-recovery.json',JSON.stringify(report,null,2));if(!report.internalValidation?.valid)throw Error('Resume did not produce a valid result');console.log(JSON.stringify(report));
}
