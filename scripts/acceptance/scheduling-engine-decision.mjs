// Manual-only. Uses database-side anonymized sources; never contacts production.
import {readFile,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {buildDynamicCoursePlan,createPlanningCheckpoint,planningPlanQuality,planningWorkspaceCourses,validatePlanningPlanCoherence,PLANNING_ENGINE_VERSION} from '../../frontend/src/screens/course-scheduling-planning.js';
import {createRouteClient} from '../../frontend/src/screens/course-scheduling-travel.js';
import {normalizeCalendarSector} from '../../frontend/src/screens/shared/school-calendar-logic.js';
import {setPlanningPerfEnabled,resetPlanningPerfReport,flushPlanningPerfReport} from '../../frontend/src/screens/course-scheduling-perf.js';
const dir=resolve(process.env.DECISION_DIR||'/workspace/work/scheduling-engine-decision-20261010');
const snapshotText=await readFile(dir+'/anonymous-snapshot.json','utf8'),s=JSON.parse(snapshotText),routes=JSON.parse(await readFile(dir+'/anonymous-routes.json','utf8'));
globalThis.fetch=async()=>{throw Error('Engine test network disabled');};
const schools=new Map(s.schools.map(r=>[String(r.id),r]));
const activities=s.activities.map(a=>{const school=schools.get(String(a.school_id));return {...a,school_address:school?.institution_address||'',school_sector:school?.sector||'',calendar_sector:normalizeCalendarSector(school?.sector)};});
const instructors=s.contacts_instructors.map(i=>({...i,full_name:'Instructor '+i.emp_id}));
const profiles=Object.fromEntries(s.instructor_scheduling_profiles.map(p=>[p.emp_id,p]));
const grouped=rows=>{const result={};for(const r of rows)(result[r.emp_id]||=[]).push(r);return result;};
let unavailableRoutes=0;const routeClient=createRouteClient({preloadedRows:routes,invoke:async()=>{unavailableRoutes++;return {data:{calculated:false},error:null};}});
const input={activities,instructors,profiles,rules:grouped(s.instructor_availability_rules),exceptions:grouped(s.instructor_availability_exceptions),schoolCalendar:s.school_calendar,catalog:s.proposal_activity_pricing,today:'2026-10-09',periodKey:'year',routeClient,existingRows:[],committedRows:[],lockedOptions:{},targetCourseIds:null,planningProfile:process.env.DECISION_PROFILE||'deep',allowGlobalRepair:true,skipSoftOptimization:false};
if(process.env.DECISION_USE_SAVED==='1'){const saved=JSON.parse(await readFile(dir+'/anonymous-saved.json','utf8'));input.existingRows=saved.rows.map(r=>r.row);input.committedRows=input.existingRows;input.lockedOptions=Object.fromEntries(saved.rows.filter(r=>r.lockedOption).map(r=>[r.activityId,r.lockedOption]));}
if(process.env.DECISION_CANONICAL==='1'){const {decisionInput}=await import('./scheduling-decision-input.mjs');const canonical=await decisionInput(dir);Object.assign(input,canonical.input,{planningProfile:process.env.DECISION_PROFILE||'fast',allowGlobalRepair:true,skipSoftOptimization:false,targetCourseIds:null,routeClient});}
const targets=planningWorkspaceCourses(input.activities,'','year');
await writeFile(dir+'/input-summary.json',JSON.stringify({engineVersion:PLANNING_ENGINE_VERSION,snapshotAt:s.snapshot_at,inputSha256:createHash('sha256').update(snapshotText).digest('hex'),allSourceActivities:activities.length,engineActivities:input.activities.length,canonicalSchoolLocations:process.env.DECISION_CANONICAL==='1',targets:targets.length,locked:targets.filter(a=>a.instructor_assignment_locked).length,missingSchoolAddress:targets.filter(a=>!a.school_address).length,missingSchoolSector:targets.filter(a=>!a.calendar_sector).length,instructors:input.instructors.length,profiles:Object.keys(profiles).length,rules:s.instructor_availability_rules.length,exceptions:s.instructor_availability_exceptions.length,routes:routes.length,catalog:input.catalog.length,holidays:input.schoolCalendar.length},null,2));
const controller=new AbortController();input.signal=controller.signal;input.checkpoint=createPlanningCheckpoint({signal:controller.signal});
process.on('SIGTERM',()=>controller.abort());
let phase='',last=0;input.onProgress=async p=>{if(p.snapshotRows?.length)await writeFile(dir+'/observed-checkpoint.json',JSON.stringify({engineVersion:PLANNING_ENGINE_VERSION,phase:p.phase,rows:p.snapshotRows}));if(phase!==p.phase||performance.now()-last>15000){phase=p.phase;last=performance.now();console.log(JSON.stringify({phase,completed:p.completed,total:p.total,elapsedMs:Math.round(performance.now()-start)}));}};
setPlanningPerfEnabled(true);resetPlanningPerfReport('representative-national');const start=performance.now(),cpu=process.cpuUsage(),memoryBefore=process.memoryUsage();let peakRss=memoryBefore.rss;const timer=setInterval(()=>{peakRss=Math.max(peakRss,process.memoryUsage().rss);},20);
let plan,error;try{plan=await buildDynamicCoursePlan(input);}catch(e){error={message:e.message,stack:e.stack,code:e.code,failures:e.failures,repairCourseIds:e.repairCourseIds};}
clearInterval(timer);const used=process.cpuUsage(cpu),metrics={elapsedMs:performance.now()-start,cpuMs:(used.user+used.system)/1000,memoryBefore,memoryAfter:process.memoryUsage(),peakRssSampled:Math.max(peakRss,process.memoryUsage().rss),routeMissRequests:unavailableRoutes,perf:flushPlanningPerfReport({log:false}),error};
if(plan){await writeFile(dir+'/national-plan.json',JSON.stringify(plan));metrics.quality=planningPlanQuality(plan.rows);metrics.validation=validatePlanningPlanCoherence({...input,rows:plan.rows});metrics.finalPlanValidation=plan.finalPlanValidation;metrics.kinds=plan.rows.reduce((out,r)=>(out[r.kind]=(out[r.kind]||0)+1,out),{});}
await writeFile(dir+'/national-metrics.json',JSON.stringify(metrics,null,2));console.log(JSON.stringify({done:true,elapsedMs:metrics.elapsedMs,error,kinds:metrics.kinds,quality:metrics.quality?Object.fromEntries(Object.entries(metrics.quality).filter(([,v])=>v===null||typeof v!=='object')):undefined,validation:metrics.validation}));
