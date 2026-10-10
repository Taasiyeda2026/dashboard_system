import test from 'node:test';import assert from 'node:assert/strict';
import {augmentingSearch} from '../frontend/src/screens/scheduling-core/augmenting-search.js';
import {operationalQuality,compareOperationalQuality,availabilityByInstructor} from '../frontend/src/screens/scheduling-core/quality.js';
import {buildDynamicCoursePlan,validatePlanningPlanCoherence} from '../frontend/src/screens/course-scheduling-planning.js';
import {compileConstraints} from '../frontend/src/screens/scheduling-core/constraints.js';
import {createRouteClient} from '../frontend/src/screens/course-scheduling-travel.js';
const activity=(id,extra={})=>({row_id:id,activity_season:'school_2027',activity_type:'קורס',activity_name:'Fixture',status:'פתוח',school_id:'1',school:'School',school_address:'school1',calendar_sector:'jewish',authority:'Authority',instruction_language:'he',required_instructor_gender:'any',sessions:1,start_time:'09:00',end_time:'10:00',date_1:'2026-10-12',...extra});
function input(activities,extra={}){const points=['home1','home2','home3','school1','school2'];return {activities,instructors:['1','2','3'].map(id=>({emp_id:id,active:'yes',address:'home'+id,full_name:'Instructor '+id})),profiles:Object.fromEntries(['1','2','3'].map(id=>[id,{gender:'female',instruction_languages:['he'],friday_allowed:false}])),rules:Object.fromEntries(['1','2','3'].map(id=>[id,Array.from({length:7},(_,weekday)=>({weekday,available:true,start_time:'08:00',end_time:'18:00'}))])),exceptions:{},schoolCalendar:[],catalog:[],today:'2026-10-09',periodKey:'year',planningProfile:'fast',skipSoftOptimization:false,allowGlobalRepair:true,existingRows:[],committedRows:[],lockedOptions:{},routeClient:createRouteClient({preloadedRows:points.flatMap(origin=>points.filter(x=>x!==origin).map(destination=>({origin_key:origin,destination_key:destination,distance_km:5,duration_minutes:10}))),invoke:async()=>({data:{calculated:false},error:null})}),...extra};}
test('augmenting search solves three-instructor chain beyond one displaced activity',async()=>{
 const initial=new Map([['A',{courseId:'A',instructorEmpId:'1'}],['B',{courseId:'B',instructorEmpId:'2'}],['C',{courseId:'C'}]]),choices={C:['1'],A:['1','2'],B:['2','3']};let steps=0;
 const config={rows:initial,targetId:'C',optionsFor:async id=>choices[id].map(instructorEmpId=>({instructorEmpId})),blockersFor:async(id,o,rows)=>[...rows.values()].filter(r=>r.instructorEmpId===o.instructorEmpId).map(r=>r.courseId),canMove:()=>true,toRow:(courseId,o)=>({courseId,...o}),checkpoint:async()=>{steps++;},branchLimit:10};
 assert.equal(await augmentingSearch({...config,maxDepth:1}),null);const trial=await augmentingSearch({...config,maxDepth:3});assert.equal(trial.get('C').instructorEmpId,'1');assert.equal(trial.get('A').instructorEmpId,'2');assert.equal(trial.get('B').instructorEmpId,'3');assert.equal(initial.get('A').instructorEmpId,'1');assert.ok(steps<100);
 assert.equal(await augmentingSearch({...config,maxDepth:3,canMove:id=>id!=='B'}),null);
});
test('strict objective cannot trade coverage or teaching hours for lower travel or idle time',()=>{
 const q={covered:2,meetingHours:4,waitingMinutes:100,totalTravelMinutes:50};assert.ok(compareOperationalQuality({...q,covered:1,waitingMinutes:0},q)<0);assert.ok(compareOperationalQuality({...q,meetingHours:3,waitingMinutes:0},q)<0);assert.ok(compareOperationalQuality({...q,waitingMinutes:50,totalTravelMinutes:500},q)>0);
});
test('quality measures explicit availability union, travel round trips, waiting and school sequences',()=>{
 const data=input([activity('a'),activity('b',{start_time:'10:00',end_time:'11:00'})]);data.rules['1'].push({weekday:1,available:true,start_time:'09:00',end_time:'12:00'});data.exceptions['1']=[{exception_date:'2026-10-12',available:false}];
 const context=compileConstraints(data),available=availabilityByInstructor(context,'year');assert.ok(available.get('1').availableHours<available.get('2').availableHours);
 const meetings=id=>[{date:'2026-10-19',start_time:id==='a'?'09:00':'10:00',end_time:id==='a'?'10:00':'11:00'}];const q=operationalQuality(['a','b'].map(courseId=>({courseId,instructorEmpId:'1',meetings:meetings(courseId)})),data,context,available);
 assert.equal(q.meetings,2);assert.equal(q.meetingHours,2);assert.equal(q.totalTravelMinutes,20);assert.equal(q.totalTravelKm,10);assert.equal(q.waitingMinutes,0);assert.equal(q.sameSchoolSequences,1);assert.equal(q.workDays,1);assert.equal(q.unknownRouteLegs,0);
});
test('scarce fixed activity precedes broadly eligible activity and neither loses coverage',async()=>{
 const data=input([activity('broad'),activity('scarce',{instruction_language:'ar'})]);data.profiles['1'].instruction_languages=['he','ar'];const plan=await buildDynamicCoursePlan(data);assert.equal(plan.planned,2);assert.equal(plan.rows.find(r=>r.courseId==='scarce').instructorEmpId,'1');assert.equal(plan.finalPlanValidation.valid,true);assert.equal(plan.optimization.optimal,false);
});
test('optimization keeps approved and planning locked anchors, official times and point scope',async()=>{
 const data=input([activity('live',{emp_id:'1',instructor_assignment_locked:true}),activity('other'),activity('next',{start_time:'10:00',end_time:'11:00'})]);const baseline=await buildDynamicCoursePlan({...data,skipSoftOptimization:true});const plan=await buildDynamicCoursePlan({...data,existingRows:baseline.rows,committedRows:baseline.rows});assert.equal(plan.rows[0].instructorEmpId,'1');assert.deepEqual(plan.rows[0].meetings,baseline.rows[0].meetings);assert.equal(validatePlanningPlanCoherence({...data,rows:plan.rows}).valid,true);
 const point=await buildDynamicCoursePlan({...data,existingRows:plan.rows,committedRows:plan.rows,targetCourseIds:['other'],allowGlobalRepair:false});assert.deepEqual(point.rows.find(r=>r.courseId==='next'),plan.rows.find(r=>r.courseId==='next'));assert.equal(point.newEngineMetrics.activitiesComputed,1);
});
test('zero optimizer budget returns best validated base; cancellation never yields a plan',async()=>{
 const data=input([activity('a'),activity('b')],{optimizationBudgetMs:0});const plan=await buildDynamicCoursePlan(data);assert.equal(plan.finalPlanValidation.valid,true);assert.equal(plan.optimization.completed,false);assert.equal(plan.optimization.failure,'planning_optimization_budget_exceeded');assert.ok(plan.rows.filter(r=>r.instructorEmpId).length===2);
 const controller=new AbortController();await assert.rejects(buildDynamicCoursePlan({...data,signal:controller.signal,onProgress:p=>{if(p.phase.includes('תיקון ארצי'))controller.abort();}}),e=>e.code==='planning_cancelled');
});
test('national opportunity cost prevents a three-instructor displacement trap',async()=>{
 const activities=[activity('A',{date_2:'2026-10-19',sessions:2}),activity('B',{school_id:'2',school_address:'school2',date_2:'2026-10-19',sessions:2}),activity('C',{school_id:'3',school_address:'school3',date_1:'2026-10-19'})];
 const data=input(activities),eligible={school1:['1','2'],school2:['2','3'],school3:['1']};
 const routes=Object.entries(eligible).flatMap(([school,ids])=>['1','2','3'].flatMap(id=>[{origin_key:'home'+id,destination_key:school,distance_km:ids.includes(id)?5:45,duration_minutes:10},{origin_key:school,destination_key:'home'+id,distance_km:ids.includes(id)?5:45,duration_minutes:10}]));
 data.routeClient=createRouteClient({preloadedRows:routes,invoke:async()=>({data:{calculated:false},error:null})});
 const base=await buildDynamicCoursePlan({...data,skipSoftOptimization:true});assert.equal(base.planned,3);
 const improved=await buildDynamicCoursePlan(data);assert.equal(improved.planned,3);assert.equal(improved.rows.find(r=>r.courseId==='C').instructorEmpId,'1');assert.equal(improved.rows.find(r=>r.courseId==='A').instructorEmpId,'2');assert.equal(improved.rows.find(r=>r.courseId==='B').instructorEmpId,'3');assert.equal(improved.finalPlanValidation.valid,true);assert.equal(improved.quality.covered,base.quality.covered);
});
test('point exception shifts the flexible series weekly and retains its instructor, but cannot move official dates',async()=>{
 const data=input([activity('flex',{date_1:null,start_time:null,end_time:null,sessions:3})],{catalog:[{activity_name:'Fixture',meetings_count:3,hours_count:3}],skipSoftOptimization:true});
 const initial=await buildDynamicCoursePlan(data),old=initial.rows[0],blocked=old.meetings[1].date;
 const changed={...data,existingRows:initial.rows,committedRows:initial.rows,targetCourseIds:['flex'],allowGlobalRepair:false,exceptions:{[old.instructorEmpId]:[{exception_date:blocked,available:false}]}};
 const next=await buildDynamicCoursePlan(changed);assert.equal(next.rows[0].instructorEmpId,old.instructorEmpId);assert.equal(next.rows[0].meetings[0].date,old.meetings[0].date);assert.ok(next.rows[0].meetings[1].date>blocked);assert.equal(next.finalPlanValidation.valid,true);
 const fixed=input([activity('fixed')],{skipSoftOptimization:true});const prior=await buildDynamicCoursePlan(fixed),id=prior.rows[0].instructorEmpId;
 const failed=await buildDynamicCoursePlan({...fixed,existingRows:prior.rows,committedRows:prior.rows,targetCourseIds:['fixed'],allowGlobalRepair:false,exceptions:{[id]:[{exception_date:'2026-10-12',available:false}]}});
 assert.ok(!failed.rows[0].instructorEmpId);assert.equal(failed.rows[0].meetings[0].date,'2026-10-12');assert.match(failed.rows[0].reason,/המדריך הקבוע לא הוחלף/);assert.equal(failed.finalPlanValidation.valid,true);
});
test('no suitable instructor yields actionable diagnostics without inventing travel or certification',async()=>{
 const data=input([activity('missing')]);data.instructors.forEach(i=>i.active='no');const plan=await buildDynamicCoursePlan(data);assert.ok(!plan.rows[0].instructorEmpId);assert.match(plan.rows[0].reason,/מדריך פעיל|פרופיל/);assert.equal(plan.finalPlanValidation.valid,true);
});
test('multi-blocker chain retains every covered activity and failed branch cannot mutate the input',async()=>{
 const rows=new Map([['A',{courseId:'A',instructorEmpId:'1',start:0,end:1}],['B',{courseId:'B',instructorEmpId:'1',start:1,end:2}],['C',{courseId:'C'}]]),before=JSON.stringify([...rows]);const opts={C:[{instructorEmpId:'1',start:0,end:2}],A:[{instructorEmpId:'2',start:0,end:1}],B:[{instructorEmpId:'2',start:1,end:2}]};
 const config={rows,targetId:'C',optionsFor:async id=>opts[id],blockersFor:async(id,o,current)=>[...current.values()].filter(r=>r.instructorEmpId===o.instructorEmpId&&o.start<r.end&&o.end>r.start).map(r=>r.courseId),canMove:()=>true,toRow:(courseId,o)=>({courseId,...o}),checkpoint:async()=>{},maxDepth:3};
 const trial=await augmentingSearch(config);assert.equal([...trial.values()].filter(r=>r.instructorEmpId).length,3);assert.equal(JSON.stringify([...rows]),before);assert.equal(await augmentingSearch({...config,canMove:id=>id!=='B'}),null);assert.equal(JSON.stringify([...rows]),before);
});
test('more than two blocked flexible meetings permits another permanent instructor under the existing policy',async()=>{
 const data=input([activity('flex',{date_1:null,start_time:null,end_time:null,sessions:3})],{catalog:[{activity_name:'Fixture',meetings_count:3,hours_count:3}],skipSoftOptimization:true});const base=await buildDynamicCoursePlan(data),row=base.rows[0];
 const next=await buildDynamicCoursePlan({...data,existingRows:base.rows,committedRows:base.rows,targetCourseIds:['flex'],allowGlobalRepair:false,exceptions:{[row.instructorEmpId]:row.meetings.map(m=>({exception_date:m.date,available:false}))}});
 assert.equal(next.finalPlanValidation.valid,true);assert.ok(next.rows[0].instructorEmpId);assert.notEqual(next.rows[0].instructorEmpId,row.instructorEmpId);
});
