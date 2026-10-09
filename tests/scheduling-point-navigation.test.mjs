import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { courseSchedulingScreen, schedulingPlanningStatusHtml } from '../frontend/src/screens/course-scheduling.js';
import { setPlanningPerfEnabled, resetPlanningPerfReport, planningPerfSnapshot } from '../frontend/src/screens/course-scheduling-perf.js';
test('253 saved activities: real search, paging, course opening and re-entry never start engine computation or writes',async t=>{
 const dom=new JSDOM('<main></main>',{url:'http://localhost'});
 const previous={document:globalThis.document,window:globalThis.window,fetch:globalThis.fetch};const requests=[];
 globalThis.document=dom.window.document;globalThis.window=dom.window;dom.window.scrollTo=()=>{};
 globalThis.fetch=async(input,init={})=>{requests.push({path:new URL(String(input)).pathname,method:init.method||'GET'});throw Error('Read-only fixture has no network');};
 setPlanningPerfEnabled(true);resetPlanningPerfReport('saved-navigation-no-engine');
 try{
  const activities=Array.from({length:253},(_,i)=>({row_id:`c${i}`,school_id:String(i),activity_season:'school_2027',activity_type:'קורס',status:'פתוח',school:'School',activity_name:`Activity ${i}`,draft_emp_id:'1',draft_instructor_name:'Instructor',draft_proposed_meetings:[{date:'2027-01-04',start_time:'09:00',end_time:'10:30'}]}));
  const state={user:{role:'admin'},route:'course-scheduling',routes:['instructors','course-scheduling'],courseSchedulingPlanningSharedLoaded:true,courseSchedulingSelectedId:'c0',courseSchedulingPlanningRows:[]};
  const data={activities,instructors:[],scheduling:{},meetingState:{loaded:true,approvedDates:new Map(),cancelledDates:new Map()},_planningSharedLoadedKey:'year|',reloadPlanningSnapshot:async()=>{throw Error('Unexpected calculation snapshot reload');}};
  const root=dom.window.document.querySelector('main');const cleanups=[];
  const render=()=>{root.innerHTML=courseSchedulingScreen.render(data,{state});courseSchedulingScreen.bind({root,data,state,api:{onCleanup:fn=>cleanups.push(fn)},rerender:render,clearScreenDataCache:()=>{}});};render();
  const input=root.querySelector('[data-course-list-search]');input.value='Activity 252';input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  root.querySelector('[data-course-card="c252"]').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));assert.equal(state.courseSchedulingSelectedId,'c252');
  root.querySelector('[data-clear-course-list-search]').click();root.querySelector('[data-course-list-page]:last-child').click();
  state.route='instructors';for(const cleanup of cleanups.splice(0))cleanup();root.innerHTML='';state.route='course-scheduling';render();
  assert.equal(state.courseSchedulingSelectedId,'c252');await new Promise(resolve=>setTimeout(resolve,0));
  const counters=planningPerfSnapshot().counters;assert.equal(counters.activitiesComputed,0);assert.equal(counters.contextRebuilds,0);assert.equal(counters.scheduleCalls,0);assert.ok(requests.every(r=>r.method==='GET'||r.path.includes('/rpc/get_')||(r.method==='POST'&&r.path==='/rest/v1/rpc/course_assignment_manager_approval_state')),JSON.stringify(requests));
  t.diagnostic(JSON.stringify({activities:253,activitiesComputed:0,contextRebuilds:0,scheduleCalls:0,requests,writes:0}));for(const cleanup of cleanups.splice(0))cleanup();
 }finally{setPlanningPerfEnabled(false);Object.assign(globalThis,previous);dom.window.close();}
});
test('saved validated base with incomplete optimization is disclosed after reload and remains exportable',()=>{
 const html=schedulingPlanningStatusHtml({courseSchedulingPlanningSharedLoaded:true,courseSchedulingPlanningCalculatedAt:'2026-10-09',courseSchedulingPlanningRows:[{courseId:'a',diagnostics:{softOptimizationIncomplete:true}}]});
 assert.match(html,/בסיס התכנון נבדק; השיפור הנוסף לא הושלם/);assert.doesNotMatch(html,/הכול מעודכן/);assert.match(html,/data-export-course-planning/);
});
