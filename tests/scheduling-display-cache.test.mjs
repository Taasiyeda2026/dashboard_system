import test from 'node:test';
import assert from 'node:assert/strict';
import { compactPlanningWorkspace, courseListWindow } from '../frontend/src/screens/course-scheduling-display-data.js';
import { writeSchedulingSessionCache, readSchedulingSessionCache } from '../frontend/src/screens/course-scheduling-session-cache.js';
import { courseListHtml } from '../frontend/src/screens/course-scheduling.js';
import { sharedPlanningAffectedCourseIds } from '../frontend/src/screens/course-scheduling-planning-store.js';
import { auditStoredPlanningHardGates } from '../frontend/src/screens/course-scheduling-date-adjustments.js';
const identity = { userId: 'u', sessionId: 's' };
const option = (emp, date='2027-01-04') => ({ instructorEmpId: emp, startDate: date, startTime: '09:00', meetings: [{date, start_time:'09:00',end_time:'10:30',substituteEmpId:'sub'}], payload: 'x'.repeat(500) });
const row = {courseId:'c',kind:'proposal',instructorEmpId:'chosen',startDate:'2027-01-04',startTime:'09:00',meetings:option('chosen').meetings, options:[option('first'),option('chosen'),option('indirect','2027-01-11')],packingOptions:[option('packing')],scheduleOptions:[option('time')]};
const shared = {workspace:{id:'w',revision:1}, rows:[{activityId:'c',row,needsRecalc:false,lockedOption:null}]};
const storage = () => { const values = new Map(); return {values,getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}; };
test('display projection preserves current proposal, selected and first choices and full dependency footprint', () => {
 const display=compactPlanningWorkspace(shared);const compact=display.rows[0].row;
 assert.deepEqual(compact.options.map(o=>o.instructorEmpId),['first','chosen']);
 assert.equal(compact.optionCount,3);assert.equal(compact.scheduleOptionCount,1);
 assert.deepEqual(compact.meetings,row.meetings);assert.equal(compact.packingOptions.length,0);
 assert.ok(compact.dependencyInstructorIds.includes('indirect'));assert.ok(compact.dependencyInstructorIds.includes('packing'));assert.ok(compact.dependencyInstructorIds.includes('sub'));
 assert.ok(compact.dependencySlots.some(s=>s.date==='2027-01-11'));
 assert.equal(shared.rows[0].row._detailsDeferred,undefined);
 assert.deepEqual(compactPlanningWorkspace(display),display);
});
test('display projection preserves hard-gate audit and dependency closure results', () => {
 const activities=[{row_id:'c',updated_at:'new',school_id:'1'},{row_id:'other',school_id:'2',emp_id:'indirect',date_1:'2027-01-11',start_time:'09:00',end_time:'10:30'}];
 const display=compactPlanningWorkspace(shared);
 assert.deepEqual(auditStoredPlanningHardGates({shared,activities}),auditStoredPlanningHardGates({shared:display,activities}));
 const input={activities,currentCourseIds:['c','other']};
 assert.deepEqual(sharedPlanningAffectedCourseIds({...input,shared}),sharedPlanningAffectedCourseIds({...input,shared:display}));
});
test('253 rows mount at most 25 cards and all pages expose every activity', () => {
 const models=Array.from({length:253},(_,i)=>({id:`c${i}`,course:{row_id:`c${i}`,school:'School',activity_name:`Course ${i}`},bucket:'open',statusLabel:'open',scheduleLabel:'',instructorLabel:''}));
 const seen=new Set();for(let page=0;page<11;page++) {const html=courseListHtml(models,'',{courseSchedulingListPage:page});const ids=[...html.matchAll(/data-course-card="([^"]+)"/g)].map(m=>m[1]);assert.ok(ids.length<=25);ids.forEach(id=>seen.add(id));}
 assert.equal(seen.size,253);
 assert.equal(courseListWindow(models,999).page,10);
 assert.equal(courseListWindow([],5).page,0);
 const filtered=courseListHtml(models,'c252',{courseSchedulingListSearch:'Course 252'});assert.match(filtered,/data-course-card="c252"/);assert.equal([...filtered.matchAll(/data-course-card=/g)].length,1);
});
test('cache compacts large alternatives, isolates sessions and never persists credentials', () => {
 const store=storage();const bulky={...row,options:Array.from({length:1000},(_,i)=>option(String(i)))};
 assert.equal(writeSchedulingSessionCache(identity,{activities:[{row_id:'c'}],authSession:{access_token:'secret'},_planningShared:{...shared,rows:[{activityId:'c',row:bulky}]}},store,100),true);
 const restored=readSchedulingSessionCache(identity,store,200);assert.equal(restored._planningShared.rows[0].row.optionCount,1000);assert.equal(restored.authSession.access_token,undefined);
 assert.equal(readSchedulingSessionCache({...identity,sessionId:'other'},store,200),null);
 assert.equal(readSchedulingSessionCache(identity,store,0),null);
 assert.equal(readSchedulingSessionCache(identity,store,9*3600000),null);
 assert.ok(new TextEncoder().encode([...store.values.values()][0]).length<1024*1024);
});
test('quota/disabled/corrupt storage never interrupts display or restores obsolete data', () => {
 const store=storage();writeSchedulingSessionCache(identity,{activities:[]},store,100);
 const quota={...store,setItem(){throw Object.assign(new Error('full'),{name:'QuotaExceededError'});}};
 assert.equal(writeSchedulingSessionCache(identity,{activities:[1]},quota,200),false);
 assert.equal(readSchedulingSessionCache(identity,store,300),null);
 assert.equal(readSchedulingSessionCache(identity,{getItem(){throw Error('disabled')}},100),null);
 assert.equal(readSchedulingSessionCache(identity,{getItem(){return '{broken'}},100),null);
});
test('oversize source snapshot is not cached and old cache is removed', () => {
 const store=storage();writeSchedulingSessionCache(identity,{activities:[]},store,100);
 assert.equal(writeSchedulingSessionCache(identity,{activities:['x'.repeat(3*1024*1024)]},store,200),false);
 assert.equal(readSchedulingSessionCache(identity,store,300),null);
});

test('instructor details remain absent until opened and memoized overview invalidates on a new plan', async () => {
 const {planningCompletionOverviewHtml,planningCompletionInstructorDetailsHtml}=await import('../frontend/src/screens/course-scheduling-planning.js');
 const rows=[{...row,periodKey:'first',courseName:'Lazy activity',instructorName:'Chosen',endDate:'2027-01-04'}];
 const html=planningCompletionOverviewHtml(rows,{expandedInstructorIds:[]});
 assert.doesNotMatch(html,/course-planning-completion-activity-row/);
 assert.match(planningCompletionInstructorDetailsHtml(rows,'chosen'),/Lazy activity/);
 assert.match(planningCompletionOverviewHtml(rows,{expandedInstructorIds:['chosen']}),/course-planning-completion-activity-row/);
});

test('list search/paging preserve the detail DOM and selection; delegated actions reach unseen rows', async () => {
 const {JSDOM}=await import('jsdom');const {courseSchedulingScreen}=await import('../frontend/src/screens/course-scheduling.js');
 const dom=new JSDOM('<main></main>',{url:'http://localhost'});const previous={document:globalThis.document,window:globalThis.window};
 globalThis.document=dom.window.document;globalThis.window=dom.window;dom.window.scrollTo=()=>{};
 try {
  const activities=Array.from({length:253},(_,i)=>({row_id:`c${i}`,activity_season:'school_2027',activity_type:'קורס',status:'פתוח',school:'School',activity_name:`Activity ${i}`,draft_emp_id:'1',draft_instructor_name:'Instructor',draft_proposed_meetings:[{date:'2027-01-04',start_time:'09:00',end_time:'10:30'}]}));
  const state={user:{role:'admin'},route:'course-scheduling',routes:['instructors','course-scheduling'],courseSchedulingPlanningSharedLoaded:true,courseSchedulingSelectedId:'c0',courseSchedulingPlanningRows:[]};
  const data={activities,instructors:[],scheduling:{},meetingState:{loaded:true,approvedDates:new Map(),cancelledDates:new Map()},_planningSharedLoadedKey:'year|',reloadPlanningSnapshot:async()=>data};
  const root=dom.window.document.querySelector('main');const render=()=>{root.innerHTML=courseSchedulingScreen.render(data,{state});courseSchedulingScreen.bind({root,data,state,api:{},rerender:render,clearScreenDataCache:()=>{}});};render();
  const detail=root.querySelector('[data-course-detail]');const list=root.querySelector('[data-course-list]');list.scrollTop=40;
  const input=root.querySelector('[data-course-list-search]');input.value='Activity 252';input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  assert.equal(root.querySelector('[data-course-detail]'),detail);assert.equal(state.courseSchedulingSelectedId,'c0');assert.equal(list.scrollTop,40);
  assert.ok(root.querySelector('[data-course-card="c252"]'));
  let confirmations=0;dom.window.confirm=()=>{confirmations++;return false;};root.querySelector('[data-confirm-actual-draft]').click();
  assert.equal(confirmations,1);
  root.querySelector('[data-clear-course-list-search]').click();
  for(let i=0;i<10;i++)root.querySelector('[data-course-list-page]:last-child').click();
  assert.ok(root.querySelector('[data-course-card="c252"]'));
  root.querySelector('[data-course-card="c252"]').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  assert.equal(state.courseSchedulingSelectedId,'c252');
 } finally {globalThis.document=previous.document;globalThis.window=previous.window;dom.window.close();}
});

test('display aggregate cache is reused across page changes and invalidated when rows change', async () => {
 const {courseSchedulingScreen}=await import('../frontend/src/screens/course-scheduling.js');
 const activities=[{row_id:'c',activity_season:'school_2027',activity_type:'קורס',status:'פתוח',school:'S',activity_name:'A'}];
 const data={activities,instructors:[],scheduling:{},meetingState:{loaded:true,approvedDates:new Map(),cancelledDates:new Map()}};
 const state={user:{role:'admin'},routes:['instructors','course-scheduling'],courseSchedulingPlanningSharedLoaded:true,courseSchedulingPlanningRows:[{...row,periodKey:'first',courseName:'A',instructorName:'Chosen'}]};
 courseSchedulingScreen.render(data,{state});const cache=data._planningCompletionCache;
 state.courseSchedulingListPage=2;courseSchedulingScreen.render(data,{state});assert.equal(data._planningCompletionCache,cache);
 state.courseSchedulingPlanningRows=[{...state.courseSchedulingPlanningRows[0],instructorName:'Changed'}];
 courseSchedulingScreen.render(data,{state});assert.notEqual(data._planningCompletionCache,cache);assert.match(data._planningCompletionCache.html,/Changed/);
});

test('async cache fails safely when a worker fails and discards the previous snapshot', async () => {
 const {writeSchedulingSessionCacheAsync}=await import('../frontend/src/screens/course-scheduling-session-cache.js');
 const previous=globalThis.Worker;const store=storage();writeSchedulingSessionCache(identity,{activities:[]},store,100);
 globalThis.Worker=class{postMessage(){queueMicrotask(()=>this.onerror({message:'failed'}));}terminate(){}};
 try {assert.equal(await writeSchedulingSessionCacheAsync(identity,{activities:[]},store,200),false);assert.equal(readSchedulingSessionCache(identity,store,300),null);}
 finally{globalThis.Worker=previous;}
});

test('async cache only accepts the latest write and excludes credentials/runtime functions', async () => {
 const {writeSchedulingSessionCacheAsync}=await import('../frontend/src/screens/course-scheduling-session-cache.js');
 const {serializeSchedulingCacheEntry}=await import('../frontend/src/screens/course-scheduling-cache-serialization.js');
 const previous=globalThis.Worker;const workers=[];const store=storage();
 globalThis.Worker=class{constructor(){workers.push(this);}postMessage(entry){this.entry=entry;}terminate(){}};
 try{
  const old=writeSchedulingSessionCacheAsync(identity,{activities:['old']},store,100);
  const latest=writeSchedulingSessionCacheAsync(identity,{activities:['new'],reloadPlanningSnapshot(){},authSession:{access_token:'secret'}},store,200);
  assert.equal(workers[1].entry.data.authSession.access_token,undefined);assert.equal(workers[1].entry.data.reloadPlanningSnapshot,undefined);
  workers[1].onmessage({data:serializeSchedulingCacheEntry(workers[1].entry)});assert.equal(await latest,true);
  workers[0].onmessage({data:serializeSchedulingCacheEntry(workers[0].entry)});assert.equal(await old,false);
  assert.deepEqual(readSchedulingSessionCache(identity,store,300).activities,['new']);
 }finally{globalThis.Worker=previous;}
});

test('compact valid and invalid proposals produce the same hard-gate decisions', () => {
 const base={...row,meetings:[{date:'2027-01-04',start_time:'09:00',end_time:'10:30'}]};
 const activities=[{row_id:'c',sessions:1}];
 const input={activities,instructors:[{emp_id:'chosen',active:'yes'}],rules:{chosen:[{weekday:1,available:true,start_time:'08:00',end_time:'15:00'}]}};
 const valid={rows:[{activityId:'c',row:base}]};
 assert.equal(auditStoredPlanningHardGates({...input,shared:valid}).hardGateInvalidCount,0);
 assert.deepEqual(auditStoredPlanningHardGates({...input,shared:valid}),auditStoredPlanningHardGates({...input,shared:compactPlanningWorkspace(valid)}));
 const invalid={rows:[{activityId:'c',row:{...base,meetings:[{date:'2027-01-04',start_time:'07:00',end_time:'10:30'}]}}]};
 assert.equal(auditStoredPlanningHardGates({...input,shared:invalid}).hardGateInvalidCount,1);
 assert.deepEqual(auditStoredPlanningHardGates({...input,shared:invalid}),auditStoredPlanningHardGates({...input,shared:compactPlanningWorkspace(invalid)}));
});

test('hidden or stale completion overview is never constructed', async () => {
 const {courseSchedulingScreen}=await import('../frontend/src/screens/course-scheduling.js');
 for(const flags of [{courseSchedulingPlanningLoading:true},{courseSchedulingPlanningStale:true}]){
  const data={activities:[],instructors:[],scheduling:{},meetingState:{}};
  const state={user:{role:'admin'},routes:['instructors','course-scheduling'],courseSchedulingPlanningSharedLoaded:true,...flags};
  courseSchedulingScreen.render(data,{state});assert.equal(data._planningCompletionCache,undefined);
 }
});
