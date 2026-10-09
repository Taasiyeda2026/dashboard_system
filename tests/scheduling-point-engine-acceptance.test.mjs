import test from 'node:test';
import assert from 'node:assert/strict';
import { schedulingTransitionFailure } from '../frontend/src/screens/instructor-matching-engine.js';
import { filterPlanningOptionsAgainstChosenRows, reconcileSelectedPlanningOverlaps, validatePlanningPlanCoherence, buildDynamicCoursePlan, PlanningCancelledError } from '../frontend/src/screens/course-scheduling-planning.js';
import { expandPlanningAffectedIdsBySchool, sharedPlanningAffectedCourseIds, planningEngineUpgradeAffectedCourseIds } from '../frontend/src/screens/course-scheduling-planning-store.js';
import { createRouteClient } from '../frontend/src/screens/course-scheduling-travel.js';
const date='2026-10-12';
const meeting=(start='08:00',end='09:00')=>({date,start_time:start,end_time:end});
const activity=(id,school=id)=>({row_id:id,school_id:school,school_address:school,school,calendar_sector:'general',activity_season:'school_2027',activity_type:'קורס',activity_name:'Synthetic',status:'פתוח',sessions:1,instruction_language:'he',required_instructor_gender:'any',start_date:date,end_date:date,start_time:'09:15',end_time:'10:15',date_1:date,updated_at:'2026-10-09'});
const row=(id,emp='1',school=id,m=meeting())=>({courseId:id,kind:'proposal',schoolId:school,instructorEmpId:emp,instructorName:emp,meetings:[m],startDate:date,endDate:date,startTime:m.start_time,endTime:m.end_time,options:[]});
const option=(start='09:00',end='10:00',emp='1')=>({instructorEmpId:emp,meetings:[meeting(start,end)]});
const routeClient={peek:()=>({distance_km:5,duration_minutes:10})};
test('chosen candidates and authoritative validation reject the same short travel gap; legal alternative survives',()=>{
 const a=activity('a'),b=activity('b');const prior=row('a');const options=[option(),option('09:15','10:15')];
 const accepted=filterPlanningOptionsAgainstChosenRows({activity:b,options,rowsById:new Map([['a',prior]]),activityById:new Map([['a',a]]),routeClient});
 assert.equal(accepted.length,1);assert.equal(accepted[0],options[1]);
 const invalid=validatePlanningPlanCoherence({rows:[prior,row('b','1','b',meeting('09:00','10:00'))],activities:[a,b],routeClient});
 assert.ok(invalid.failures.some(f=>f.reason==='transition_insufficient'&&f.availableMinutes===0&&f.requiredMinutes===15));
 const valid=validatePlanningPlanCoherence({rows:[prior,row('b','1','b',meeting('09:15','10:15'))],activities:[a,b],routeClient});
 assert.ok(!valid.failures.some(f=>f.reason.startsWith('transition')));
});
test('transition boundaries, unknown routes, direction and same-school adjacency are explicit',()=>{
 const failure=(gap,km=5,duration=10)=>schedulingTransitionFailure({gapMinutes:gap,route:{distance_km:km,duration_minutes:duration}});
 assert.equal(failure(14),'transition_insufficient');assert.equal(failure(15),null);
 assert.equal(failure(25,20),null);assert.equal(failure(25,20.1),'transition_distance_exceeded');
 assert.equal(failure(121,30),null);assert.equal(schedulingTransitionFailure({gapMinutes:30,route:null}),'travel_unverified');
 assert.equal(schedulingTransitionFailure({sameSchool:true,gapMinutes:0}),null);
 const a=activity('a','same'),b=activity('b','same');assert.equal(filterPlanningOptionsAgainstChosenRows({activity:b,options:[option()],rowsById:new Map([['a',row('a','1','same')]]),activityById:new Map([['a',a]]),routeClient}).length,1);
 const calls=[];filterPlanningOptionsAgainstChosenRows({activity:activity('b'),options:[option('07:00','08:00')],rowsById:new Map([['a',row('a','1','a',meeting('08:15','09:15'))]]),activityById:new Map([['a',activity('a')]]),routeClient:{peek:(from,to)=>{calls.push([from,to]);return{distance_km:5,duration_minutes:10};}}});assert.deepEqual(calls,[['b','a']]);
});
test('reconciliation repairs a zero-gap school transition while immutable and unrelated rows stay identical',()=>{
 const a={...row('a'),planningLocked:true,kind:'planning-locked'},b={...row('b','1','b',meeting('09:00','10:00')),options:[option('09:15','10:15')]};
 const untouched=row('untouched','9');const map=new Map([['a',a],['b',b],['untouched',untouched]]);
 const repairs=reconcileSelectedPlanningOverlaps({rowsById:map,activities:[activity('a'),activity('b'),activity('untouched')],routeClient,targetCourseIds:['b']});
 assert.deepEqual(repairs,[{courseId:'b',action:'alternate'}]);assert.equal(map.get('a'),a);assert.equal(map.get('untouched'),untouched);assert.equal(map.get('b').startTime,undefined);assert.equal(map.get('b').meetings[0].start_time,'09:15');
});
test('fixed-point dependencies cross schools via school peers and candidate/substitute instructors, excluding unrelated dates and immutable peers',()=>{
 const entries=[['a','s1','1',date],['b','s1','2',date],['c','s2','2',date],['d','s2','3',date],['e','s3','3',date],['other','s4','3','2026-10-19'],['unrelated','s5','9',date]].map(([id,school,emp,d])=>({activityId:id,row:{...row(id,emp,school),meetings:[{...meeting(),date:d}]}}));
 const activities=entries.map(e=>({...activity(e.activityId,e.row.schoolId),date_1:e.row.meetings[0].date}));
 entries.push({activityId:'locked',lockedOption:option(),row:{...row('locked','1','s1'),planningLocked:true}});activities.push(activity('locked','s1'));
 assert.deepEqual(new Set(expandPlanningAffectedIdsBySchool({affectedIds:['a'],shared:{rows:entries},activities})),new Set(['a','b','c','d','e']));
 const compact=entries.map(e=>({...e,row:{...e.row,dependencyInstructorIds:[e.row.instructorEmpId],dependencySlots:e.row.meetings,options:[]}}));
 assert.deepEqual(new Set(expandPlanningAffectedIdsBySchool({affectedIds:['a'],shared:{rows:compact},activities})),new Set(['a','b','c','d','e']));
 const availability=sharedPlanningAffectedCourseIds({shared:{rows:entries.map(e=>({...e,activityUpdatedAt:'2026-10-09'}))},activities,currentCourseIds:activities.map(a=>a.row_id),contextDiff:{changedAvailabilityInstructorIds:['2']}});
 assert.ok(availability.includes('e'));assert.ok(!availability.includes('unrelated'));
});
const instructors=[{emp_id:'1',full_name:'Synthetic',active:'yes',address:'home'}];
const profiles={'1':{gender:'female',instruction_languages:['he']}};
const rules={'1':[{weekday:1,available:true,start_time:'08:00',end_time:'18:00'}]};
const routes=()=>createRouteClient({preloadedRows:[['home','a'],['a','home']].map(([origin,destination])=>({origin_key:origin,destination_key:destination,distance_km:5,duration_minutes:10})),invoke:async()=>{throw Error('No network');}});
const input=()=>({activities:[activity('a')],instructors,profiles,rules,exceptions:{},schoolCalendar:[],today:'2026-10-09',routeClient:routes(),planningProfile:'fast',allowGlobalRepair:false,catalog:[{activity_name:'Synthetic',meetings_count:1,hours_count:1}],targetCourseIds:['a'],checkpoint:async()=>{}});
test('optional optimizer error preserves a hard-validated base, without pretending optimization succeeded',async()=>{
 const result=await buildDynamicCoursePlan({...input(),onProgress:({phase})=>{if(phase==='אריזת בתי ספר הושלמה')throw Error('synthetic_optimizer_failure');}});
 assert.equal(result.rows[0].kind,'fixed-proposal');assert.equal(result.finalPlanValidation.valid,true);assert.equal(result.optimization.completed,false);assert.equal(result.optimization.basePreserved,true);assert.equal(result.optimization.failure,'optimization_failed');assert.equal(result.rows[0].diagnostics.softOptimizationIncomplete,true);
});
test('cancellation and ownership loss during optional optimization still abort, never silently save the base',async()=>{
 for(const error of [new PlanningCancelledError(),Object.assign(new Error('planning_run_ownership_lost'),{code:'planning_run_ownership_lost'})])await assert.rejects(buildDynamicCoursePlan({...input(),onProgress:({phase})=>{if(phase==='אריזת בתי ספר הושלמה')throw error;}}),e=>e===error);
});
test('no suitable instructor or blocked fixed date yields no unsafe assignment and never moves the official date',async()=>{
 for(const change of [{instructors:[]},{exceptions:{'1':[{exception_date:date,available:false,reason:'synthetic blocked'}]}}]){
 const i={...input(),...change,skipSoftOptimization:true};const before=JSON.stringify(i.activities);const result=await buildDynamicCoursePlan(i);
 assert.ok(!result.rows[0].instructorEmpId);assert.equal(JSON.stringify(i.activities),before);assert.equal(result.rows[0].startDate,date);assert.equal(result.finalPlanValidation.valid,true);
 }
});

test('final guard rejects a fixed proposal moved off its official date',()=>{
 const moved={...row('a','1','a'),kind:'fixed-proposal',meetings:[{...meeting('09:15','10:15'),date:'2026-10-19'}]};
 const r=validatePlanningPlanCoherence({rows:[moved],activities:[activity('a')],instructors,profiles,rules,routeClient});
 assert.ok(r.failures.some(f=>f.reason==='official_schedule_changed'));
});

test('synchronous and async self-route views agree while different missing addresses remain unknown',async()=>{
 const client=createRouteClient({invoke:async()=>{throw Error('No external routes');}});
 assert.deepEqual(client.peek(' same address ','same address'),{distance_km:0,duration_minutes:0,cached:true});
 const route=await client.request('same address','same address');assert.equal(route.distance_km,0);assert.equal(route.duration_minutes,0);
 assert.equal(client.peek('A','B'),null);
});

test('v36 upgrades recheck only known fixed-date drift; valid snapshots do not generate national targets',()=>{
 const a=activity('a'),prior=row('a');prior.kind='fixed-proposal';prior.meetings=[meeting('09:15','10:15')];
 const args={activities:[a],storedEngineVersion:'planning-v35-old',currentEngineVersion:'planning-v36-current',shared:{rows:[{activityId:'a',row:prior}]}};
 assert.deepEqual(planningEngineUpgradeAffectedCourseIds(args),[]);
 prior.meetings=[{...meeting('09:15','10:15'),date:'2026-10-19'}];assert.deepEqual(planningEngineUpgradeAffectedCourseIds(args),['a']);
});
