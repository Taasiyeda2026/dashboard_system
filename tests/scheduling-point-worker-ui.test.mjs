import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {courseSchedulingScreen} from '../frontend/src/screens/course-scheduling.js';
import {supabase} from '../frontend/src/supabase-client.js';
const fixture=JSON.parse(gunzipSync(Buffer.from(readFileSync(new URL('../docs/scheduling-point-engine-20261009/synthetic-fixture.json.gz.b64',import.meta.url),'utf8'),'base64')));
test('draft date/time/instructor edits during compute replace one course card and retain other rows, focus, plan and run state',()=>{
 const dom=new JSDOM('<main id="screen"></main>',{url:'http://localhost'}),keys=['window','document','sessionStorage','requestAnimationFrame','CustomEvent'],before=new Map(keys.map(k=>[k,globalThis[k]]));
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,sessionStorage:dom.window.sessionStorage,requestAnimationFrame:fn=>setTimeout(fn,0),CustomEvent:dom.window.CustomEvent});dom.window.scrollTo=()=>{};dom.window.confirm=()=>true;
 const oldSession=supabase.auth.getSession;supabase.auth.getSession=async()=>({data:{session:null},error:null});
 try{
 const rows=fixture.existing.slice(0,2),activities=fixture.activities.slice(0,2),data={activities,instructors:fixture.instructors,scheduling:{profiles:[],rules:[],exceptions:[]},meetingState:{},schoolCalendar:[],planningCatalog:[],_planningSharedLoadedKey:'year|'};
 const shared={workspace:{id:'isolated',revision:1},rows:rows.map(row=>({activityId:row.courseId,row}))},state={user:{role:'admin'},route:'course-scheduling',courseSchedulingPlanningSharedLoaded:true,courseSchedulingPlanningRows:rows,courseSchedulingPlanningShared:shared,courseSchedulingPlanningCalculatedAt:'2026-10-09',courseSchedulingPlanningLoading:true,courseSchedulingPlanningProgress:{phase:'עדכון שינויים בלבד',total:1},courseSchedulingAlternativesCourseId:rows[0].courseId};
 const root=document.querySelector('#screen');let rerenders=0;root.innerHTML=courseSchedulingScreen.render(data,{state});courseSchedulingScreen.bind({root,data,state,api:{},rerender:()=>{rerenders++},clearScreenDataCache:()=>{}});
 const other=root.querySelectorAll('[data-course-card]')[1],saved=JSON.stringify(rows);
 for(const selector of ['[data-planning-choice-date]','[data-planning-choice-time]','[data-planning-choice-instructor]']){
  const select=root.querySelector(selector);assert.ok(select,selector);select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));assert.equal(root.querySelectorAll('[data-course-card]')[1],other);assert.ok(document.activeElement.matches(selector));
 }
 assert.equal(rerenders,0);assert.equal(state.courseSchedulingPlanningLoading,true);assert.equal(JSON.stringify(rows),saved);assert.ok(state.courseSchedulingChoiceDrafts[rows[0].courseId]);
 }finally{supabase.auth.getSession=oldSession;for(const k of keys){if(before.get(k)===undefined)delete globalThis[k];else globalThis[k]=before.get(k);}dom.window.close();}
});

test('opening loaded courses keeps the list and binds draft approval once to the current activity',async()=>{
 const dom=new JSDOM('<main id="screen"></main>',{url:'http://localhost'}),keys=['window','document','sessionStorage','requestAnimationFrame','CustomEvent'],before=new Map(keys.map(k=>[k,globalThis[k]]));Object.assign(globalThis,{window:dom.window,document:dom.window.document,sessionStorage:dom.window.sessionStorage,requestAnimationFrame:fn=>setTimeout(fn,0),CustomEvent:dom.window.CustomEvent});dom.window.scrollTo=()=>{};dom.window.confirm=()=>true;
 const oldSession=supabase.auth.getSession,oldRpc=supabase.rpc;supabase.auth.getSession=async()=>({data:{session:null},error:null});let calls=[];
 supabase.rpc=async(name,args)=>{calls.push({name,args});return{data:{...activities.find(a=>a.row_id===args.p_activity_id),emp_id:args.p_emp_id,draft_emp_id:null},error:null};};
 const rows=fixture.existing.slice(0,2),activities=fixture.activities.slice(0,2).map(a=>({...a,draft_emp_id:'1',draft_instructor_name:'Synthetic'}));
 try{
 const data={activities,instructors:fixture.instructors,scheduling:{profiles:[],rules:[],exceptions:[]},meetingState:{},schoolCalendar:[],planningCatalog:[],_planningSharedLoadedKey:'year|'},shared={workspace:{id:'isolated',revision:1},rows:rows.map(row=>({activityId:row.courseId,row}))},state={user:{role:'admin'},route:'course-scheduling',courseSchedulingPlanningSharedLoaded:true,courseSchedulingPlanningRows:rows,courseSchedulingPlanningShared:shared,courseSchedulingPlanningCalculatedAt:'2026-10-09',courseSchedulingPlanningLoading:true,courseSchedulingPlanningProgress:{phase:'עדכון שינויים בלבד',total:1}};
 const root=document.querySelector('#screen');let rerenders=0;root.innerHTML=courseSchedulingScreen.render(data,{state});courseSchedulingScreen.bind({root,data,state,api:{},rerender:()=>{rerenders++},clearScreenDataCache:()=>{}});const list=root.querySelector('[data-course-list]');
 root.querySelectorAll('[data-course-card]')[0].click();assert.equal(root.querySelector('[data-course-list]'),list);assert.equal(rerenders,0);
 root.querySelectorAll('[data-course-card]')[1].click();assert.equal(root.querySelector('[data-course-list]'),list);assert.equal(rerenders,0);root.querySelector('[data-confirm-draft]').click();await new Promise(r=>setTimeout(r,10));
 assert.equal(calls.length,1);assert.equal(calls[0].args.p_activity_id,activities[1].row_id);assert.equal(calls[0].name,'assign_activity_instructor');assert.equal(state.courseSchedulingPlanningLoading,true);
 }finally{supabase.auth.getSession=oldSession;supabase.rpc=oldRpc;for(const k of keys){if(before.get(k)===undefined)delete globalThis[k];else globalThis[k]=before.get(k);}dom.window.close();}
});

test('start feedback paints before preflight and cancellation during the paint yield prevents any lease or calculation',async()=>{
 const {cancelCourseSchedulingPlanning}=await import('../frontend/src/screens/course-scheduling.js');const {PLANNING_ENGINE_VERSION}=await import('../frontend/src/screens/course-scheduling-planning.js');
 const dom=new JSDOM('<main id="screen"></main>',{url:'http://localhost',pretendToBeVisual:true}),keys=['window','document','sessionStorage','requestAnimationFrame','CustomEvent'],before=new Map(keys.map(k=>[k,globalThis[k]])),frames=[];
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,sessionStorage:dom.window.sessionStorage,requestAnimationFrame:fn=>{frames.push(fn);return frames.length},CustomEvent:dom.window.CustomEvent});dom.window.scrollTo=()=>{};
 const oldRpc=supabase.rpc,oldSession=supabase.auth.getSession;let calls=0;supabase.rpc=async()=>{calls++;return{data:null,error:{code:'42501'}}};supabase.auth.getSession=async()=>({data:{session:null},error:null});
 try{
  const rows=fixture.existing.slice(0,2),activities=fixture.activities.slice(0,2),data={activities,instructors:fixture.instructors,scheduling:{profiles:[],rules:[],exceptions:[]},schoolCalendar:[],planningCatalog:[],meetingState:{},_planningSharedLoadedKey:'year|'},shared={workspace:{id:'isolated',revision:1,engineVersion:PLANNING_ENGINE_VERSION},rows:rows.map(row=>({activityId:row.courseId,row}))};
  const state={user:{role:'admin'},route:'course-scheduling',courseSchedulingPlanningSharedLoaded:true,courseSchedulingPlanningRows:rows,courseSchedulingPlanningShared:shared,courseSchedulingPlanningCalculatedAt:'2026-10-09',courseSchedulingPlanningStoredEngineVersion:PLANNING_ENGINE_VERSION,courseSchedulingPlanningAffectedIds:[rows[0].courseId]},root=document.querySelector('#screen');
  root.innerHTML=courseSchedulingScreen.render(data,{state});courseSchedulingScreen.bind({root,data,state,api:{},rerender:()=>{},clearScreenDataCache:()=>{}});while(frames.length)frames.shift()(performance.now());
  root.querySelector('[data-run-course-planning]').click();assert.equal(state.courseSchedulingPlanningLoading,true);assert.equal(root.querySelector('[data-planning-status]').getAttribute('aria-busy'),'true');assert.ok(root.querySelector('[data-stop-course-planning]'));assert.equal(calls,0);
  frames.shift()(performance.now());assert.equal(calls,0);cancelCourseSchedulingPlanning(state);frames.shift()(performance.now());await new Promise(r=>setTimeout(r,20));assert.equal(calls,0);assert.equal(state.courseSchedulingPlanningLoading,false);
 }finally{cancelCourseSchedulingPlanning();supabase.rpc=oldRpc;supabase.auth.getSession=oldSession;for(const k of keys){if(before.get(k)===undefined)delete globalThis[k];else globalThis[k]=before.get(k)}dom.window.close();}
});
