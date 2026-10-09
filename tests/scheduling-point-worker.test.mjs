import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker as NodeWorker} from 'node:worker_threads';
import {SchedulingPointWorker} from '../frontend/src/screens/course-scheduling-worker-client.js';
import {planningRowPatches,applyPlanningRowPatches} from '../frontend/src/screens/course-scheduling-worker-protocol.js';
import {buildDynamicCoursePlan} from '../frontend/src/screens/course-scheduling-planning.js';
import {createRouteClient} from '../frontend/src/screens/course-scheduling-travel.js';
const endpoint=new URL('../frontend/src/screens/course-scheduling-point.worker.js',import.meta.url).href;
function nativeWorker(block=false){
 const entry=`import {parentPort} from 'node:worker_threads';globalThis.self={postMessage:m=>parentPort.postMessage(m)};await import(${JSON.stringify(endpoint)});parentPort.on('message',data=>{if(${block}&&data.type==='run')Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,3000);self.onmessage({data});});`;
 const native=new NodeWorker(new URL('data:text/javascript,'+encodeURIComponent(entry)),{type:'module'});
 const adapter={postMessage:m=>native.postMessage(m),terminate:()=>native.terminate()};
 native.on('message',data=>adapter.onmessage?.({data}));native.on('error',e=>adapter.onerror?.(e));return adapter;
}
const date='2026-10-12';
const base=()=>({activities:[{row_id:'a',school_id:'s',school:'s',school_address:'s',calendar_sector:'general',activity_season:'school_2027',activity_type:'קורס',activity_name:'Synthetic',status:'פתוח',sessions:1,instruction_language:'he',required_instructor_gender:'any',start_date:date,end_date:date,start_time:'09:15',end_time:'10:15',date_1:date}],instructors:[{emp_id:'1',full_name:'Synthetic',active:'yes',address:'home'}],profiles:{'1':{gender:'female',instruction_languages:['he']}},rules:{'1':[{weekday:1,available:true,start_time:'08:00',end_time:'18:00'}]},exceptions:{},schoolCalendar:[],catalog:[{activity_name:'Synthetic',meetings_count:1,hours_count:1}],existingRows:[],committedRows:[],lockedOptions:{},targetCourseIds:['a'],today:'2026-10-09',planningProfile:'fast',allowGlobalRepair:false,skipSoftOptimization:true});
const routeRows=[['home','s'],['s','home']].map(([origin_key,destination_key])=>({origin_key,destination_key,distance_km:5,duration_minutes:10}));
const hooks={owner:'admin-session',version:'v1',routeRows,routeInvoke:async()=>{throw Error('Network forbidden')},assertActive:()=>{},checkpoint:async()=>{}};
const make=()=>new SchedulingPointWorker({createWorker:nativeWorker,yieldControl:async()=>{}});
test('row deltas reconstruct exact results without cloning unchanged alternatives or mutating previous plan',()=>{
 const prior=[{courseId:'a',options:[{instructorEmpId:'1'}],obsolete:1},{courseId:'b',options:[{instructorEmpId:'2'}]}];
 const result=[{courseId:'b',options:prior[1].options},{courseId:'a',options:prior[0].options,startDate:date},{courseId:'c',options:[]}];
 const delta=planningRowPatches(result,prior),restored=applyPlanningRowPatches(delta,prior);
 assert.deepEqual(restored,result);assert.equal(restored[0],prior[1]);assert.equal(restored[1].options,prior[0].options);assert.equal(prior[0].obsolete,1);assert.equal(delta.patches.length,2);
});
test('real isolated worker equals direct engine; warm context sends no entries and availability delta only changes relevant input',async()=>{
 const client=make();try{
 const input=base(); input.committedRows=input.existingRows; const snapshot=JSON.stringify(input);
 const direct=await buildDynamicCoursePlan({...input,routeClient:createRouteClient({preloadedRows:routeRows,invoke:hooks.routeInvoke})});
 const first=await client.run(input,hooks);assert.deepEqual(first.rows,direct.rows);assert.equal(first.finalPlanValidation.valid,true);assert.equal(JSON.stringify(input),snapshot);
 const native=client.worker,entries=client.metrics.changedEntries;
 const second=await client.run(input,{...hooks,version:'v2'});assert.deepEqual(second.rows,first.rows);assert.equal(client.worker,native);assert.equal(client.metrics.changedEntries,entries);
 const blocked={...input,exceptions:{'1':[{exception_date:date,available:false}]}};
 const third=await client.run(blocked,{...hooks,version:'v3'});assert.equal(client.metrics.changedEntries-entries,1);assert.ok(!third.rows[0].instructorEmpId);assert.equal(third.rows[0].startDate,date);
 }finally{client.dispose();}
});
test('worker rejects national scope and unsupported construction instead of main-thread fallback',async()=>{
 const client=make();await assert.rejects(client.run({...base(),targetCourseIds:null},hooks),{code:'planning_worker_scope_required'});await assert.rejects(client.run({...base(),allowGlobalRepair:true},hooks),{code:'planning_worker_scope_required'});assert.equal(client.worker,null);
 const unavailable=new SchedulingPointWorker({createWorker:()=>{throw Error('Disabled')}});await assert.rejects(unavailable.run(base(),hooks),{code:'planning_worker_unavailable'});
});
test('logout/owner change replaces resident context; lease loss rejects the result',async()=>{
 const client=make();try{await client.run(base(),hooks);const before=client.worker;await client.run(base(),{...hooks,owner:'manager-session'});assert.notEqual(client.worker,before);
 await assert.rejects(client.run(base(),{...hooks,assertActive:()=>{throw Object.assign(Error('lost'),{code:'planning_run_ownership_lost'});}}),{code:'planning_run_ownership_lost'});assert.equal(client.worker,null);
 }finally{client.dispose();}
});
test('cancellation and worker crash reject without changing saved rows; cancellation acknowledged within one second',async()=>{
 for(const mode of ['cancel','crash']){const client=make(),controller=new AbortController(),input=base();input.existingRows=[{courseId:'untouched',kind:'proposal',options:[],meetings:[]}];const saved=JSON.stringify(input.existingRows);let started;
 try{const pending=client.run(input,{...hooks,signal:controller.signal,onProgress:()=>{started=performance.now();if(mode==='cancel')controller.abort();else client.worker.onerror(Error('crash'));}});
 await assert.rejects(pending,e=>e.code===(mode==='cancel'?'planning_cancelled':'planning_worker_failed'));assert.ok(performance.now()-started<1000);assert.equal(JSON.stringify(input.existingRows),saved);assert.equal(client.worker,null);
 }finally{client.dispose();}}
});

test('committed point refresh reloads only changed full rows, preserves alternatives, locks and flags, and fences concurrent revisions',async()=>{
 const {refreshCommittedPointWorkspace,reusablePointWorkspace}=await import('../frontend/src/screens/course-scheduling-point-workspace.js');
 const locked={courseId:'locked',planningLocked:true,options:[{instructorEmpId:'9'}]},old={courseId:'a',options:[]},updated={courseId:'a',options:[{instructorEmpId:'1'},{instructorEmpId:'2'}]};
 const previous={workspace:{id:'w',revision:1},rows:[{activityId:'locked',row:locked},{activityId:'a',row:old}]};const display={displayOnly:true,workspace:{id:'w',revision:2},rows:[{activityId:'locked',row:{_detailsDeferred:true},lockedOption:{instructorEmpId:'9'},needsRecalc:true},{activityId:'a',row:{_detailsDeferred:true},needsRecalc:false}]};
 let reads=[],verified=0,full=0;
 const args={previous,changedIds:['a'],saved:{id:'w',revision:2},loadDisplay:async()=>display,loadDetails:async p=>{reads.push(p);return updated},verifyRevision:async()=>{verified++},loadFull:async()=>{full++;return previous}};
 const result=await refreshCommittedPointWorkspace(args);assert.equal(result.displayOnly,false);assert.equal(result.rows[0].row,locked);assert.equal(result.rows[0].needsRecalc,true);assert.equal(result.rows[1].row.options.length,2);assert.deepEqual(reads,[{workspaceId:'w',activityId:'a',expectedRevision:2}]);assert.equal(verified,1);assert.equal(full,0);
 const cache={owner:'admin',scope:'year|',sourceRevision:'12',shared:result};const facts={sourceRevision:'12',workspace:{id:'w',revision:2}};assert.equal(reusablePointWorkspace(cache,{owner:'admin',scope:'year|',facts}),result);for(const change of [{owner:'other'},{scope:'a|'},{facts:{...facts,sourceRevision:'13'}},{facts:{...facts,workspace:{id:'w',revision:3}}},{facts:{...facts,workspace:{id:'replacement',revision:2}}}])assert.equal(reusablePointWorkspace(cache,{owner:'admin',scope:'year|',facts,...change}),null);
 const refreshed=reusablePointWorkspace(cache,{owner:'admin',scope:'year|',facts:{...facts,sourceRevision:'13'},display:{...display,rows:display.rows.map(e=>({...e,needsRecalc:true}))}});assert.equal(refreshed.rows[0].row,locked);assert.equal(refreshed.rows[1].row,updated);assert.equal(refreshed.rows[1].needsRecalc,true);assert.equal(refreshed.displayOnly,false);
 await refreshCommittedPointWorkspace({...args,loadDisplay:async()=>({...display,workspace:{id:'w',revision:3}})});assert.equal(full,1);
 await assert.rejects(refreshCommittedPointWorkspace({...args,verifyRevision:async()=>{throw Error('planning_revision_conflict')}}),/planning_revision_conflict/);
});

test('non-cooperative worker is terminated on cancel within one second, without commit or main-thread fallback',async()=>{
 const client=new SchedulingPointWorker({createWorker:()=>nativeWorker(true),yieldControl:async()=>{}}),controller=new AbortController();
 try{const pending=client.run(base(),{...hooks,signal:controller.signal});while(!client.metrics.runs)await new Promise(r=>setTimeout(r,1));const start=performance.now();controller.abort();await assert.rejects(pending,{code:'planning_cancelled'});assert.ok(performance.now()-start<1000);assert.equal(client.worker,null);
 }finally{client.dispose();}
});
test('route broker performs authorized callbacks on the caller and progress never transfers rows or credentials',async()=>{
 const client=make();let calls=0,progress=[];
 try{const result=await client.run(base(),{...hooks,routeRows:[],routeInvoke:async body=>{calls++;assert.equal(body.mode,'batch_lookup');const results=Object.fromEntries(body.pairs.map(p=>[p.route_key,{calculated:true,cached:true,distance_km:5,duration_minutes:10}]));return{data:{batch_lookup:true,results},error:null};},onProgress:p=>progress.push(p)});
 assert.ok(calls>0);assert.equal(result.rows[0].instructorEmpId,'1');assert.equal(result.finalPlanValidation.valid,true);assert.ok(progress.length);for(const p of progress){assert.deepEqual(Object.keys(p).sort(),['completed','phase','total']);assert.ok(JSON.stringify(p).length<500);}
 }finally{client.dispose();}
});

test('immutable stored payload hashes survive revision changes; dirty view markers clone frozen input instead of corrupting the context',async()=>{
 const {applyLocalPlanningNeedsRecalc}=await import('../frontend/src/screens/course-scheduling-planning-store.js');const client=make(),input=base();const stored={courseId:'a',kind:'missing',options:[{instructorEmpId:'1',meetings:[{date}]}]};input.existingRows=[stored];input.committedRows=input.existingRows;
 try{await client.run(input,hooks);assert.ok(Object.isFrozen(stored));assert.ok(Object.isFrozen(stored.options[0].meetings[0]));const cached=client.readonlyHashes.get(stored);await client.run(input,{...hooks,version:'workspace-2'});assert.equal(client.readonlyHashes.get(stored),cached);const state={courseSchedulingPlanningRows:[stored]};applyLocalPlanningNeedsRecalc(state,{activityIds:['a']});assert.notEqual(state.courseSchedulingPlanningRows[0],stored);assert.equal(state.courseSchedulingPlanningRows[0].needsRecalc,true);assert.equal(stored.needsRecalc,undefined);
 }finally{client.dispose();}
});

test('worker rechecks a saved fixed proposal against changed availability and empty instructor set without moving official dates',async()=>{
 const client=make();try{
  const input=base(),planned=await client.run(input,hooks);assert.equal(planned.rows[0].instructorEmpId,'1');
  const original=JSON.stringify(input.activities),saved=JSON.stringify(planned.rows);
  for(const [index,change] of [{exceptions:{'1':[{exception_date:date,available:false}]}},{instructors:[]}].entries()){
   const result=await client.run({...input,...change,existingRows:planned.rows,committedRows:planned.rows},{...hooks,version:'blocked-saved-'+index});
   assert.equal(result.finalPlanValidation.valid,true);assert.ok(!result.rows[0].instructorEmpId);assert.equal(result.rows[0].startDate,date);assert.equal(JSON.stringify(input.activities),original);assert.equal(JSON.stringify(planned.rows),saved);
  }
 }finally{client.dispose();}
});
