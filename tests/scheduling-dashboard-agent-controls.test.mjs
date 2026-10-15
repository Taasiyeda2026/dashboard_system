import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {agentCandidateResult,createAgentAssignmentClient} from '../frontend/src/screens/course-scheduling-agent-selection.js';
import {courseSchedulingScreen} from '../frontend/src/screens/course-scheduling.js';
import {supabase} from '../frontend/src/supabase-client.js';
const version='2026-10-15T08:00:00Z';
const course={row_id:'synthetic',activity_season:'school_2027',activity_type:'קורס',status:'פתוח',school:'בדיקה',authority:'בדיקה',activity_name:'בדיקה',updated_at:version,start_date:'2026-11-01',date_1:'2026-11-01',start_time:'10:00',end_time:'11:00'};
const instructor={emp_id:'7',full_name:'מדריך בדיקה',active:'yes'};
const snapshot={activity:course,instructors:[instructor,{emp_id:'8',full_name:'בחירה ידנית',active:'yes'}],sourceRevision:666,workspaceRevision:12,planFresh:true,row:{instructorEmpId:'7',options:[{instructor,eligible:true,score:80,meetings:[{date:'2026-11-01',start_time:'10:00',end_time:'11:00'}]}]}};
const eden={role:'operation_manager',permissions:{view_operations_management:'yes',view_operations_scheduling:'yes',view_instructors:'yes'}};
test('renders stored agent options and leaves uncomputed manual choices for server validation',()=>{
 const r=agentCandidateResult(snapshot);assert.equal(r.recommended.instructor.emp_id,'7');
 assert.equal(r.manualCandidates[1].eligible,false);assert.equal(r.manualCandidates[1].serverValidationRequired,true);
 assert.equal(r.recommended.dateAdjustment.meetings[0].date,'2026-11-01');
 assert.equal(agentCandidateResult(snapshot,{replacement:true}).recommended.dateAdjustment,undefined);
});
test('stale source hides recommendations without trapping the manual picker',()=>{
 const r=agentCandidateResult({...snapshot,planFresh:false});assert.equal(r.recommended,null);assert.equal(r.manualCandidates.length,2);
});
test('selection snapshot survives rebinding and write carries activity/source/workspace versions',async()=>{
 const snapshots=new Map(),calls=[];let current={...course};
 const options={snapshots,getActivity:()=>current,onActivity:r=>{current=r;},rpc:async(name,args)=>{
  calls.push({name,args});return {data:name==='get_scheduling_dashboard_candidates'?snapshot:{...course,updated_at:'2026-10-15T08:01:00Z'}};}};
 await createAgentAssignmentClient(options).candidates(course.row_id);
 await createAgentAssignmentClient(options).mutate('save_course_assignment_draft',{p_activity_id:course.row_id,p_emp_id:7});
 assert.equal(calls[1].name,'scheduling_dashboard_assignment');assert.equal(calls[1].args.p_expected_source_revision,666);
 assert.equal(calls[1].args.p_expected_updated_at,version);assert.equal(snapshots.size,0);
});
for(const message of ['planning_revision_conflict','scheduling_permission_denied'])test(message+' clears selection fence for explicit recovery',async()=>{
 const snapshots=new Map();let recovered=0;
 const c=createAgentAssignmentClient({snapshots,getActivity:()=>course,onConflict:()=>recovered++,rpc:async name=>name==='get_scheduling_dashboard_candidates'?{data:snapshot}:{error:{message}}});
 await c.candidates(course.row_id);assert.ok((await c.mutate('assign_activity_instructor',{p_activity_id:course.row_id})).error);
 assert.equal(snapshots.size,0);assert.equal(recovered,1);
});
test('network failure is returned to UI instead of leaving a rejected async handler',async()=>{
 const c=createAgentAssignmentClient({getActivity:()=>course,rpc:async()=>{throw Error('offline');}});
 assert.equal((await c.mutate('cancel_course_assignment_draft',{p_activity_id:course.row_id})).error.message,'offline');
});
function ui({assigned=false,draft=false,stale=false,allowed=true,rpcImpl}={}){
 const dom=new JSDOM('<div id="root"></div>',{url:'https://example.invalid'});
 for(const key of ['window','document','sessionStorage','localStorage','CustomEvent'])globalThis[key]=key==='window'?dom.window:dom.window[key];
 dom.window.confirm=()=>true;
 const state={route:'course-scheduling',user:allowed?eden:{role:'operation_manager',permissions:{}},courseSchedulingSelectedId:course.row_id,courseSchedulingFocusMode:true,courseSchedulingPlanningSharedLoaded:true};
 const activity={...course,...(assigned?{emp_id:'6',instructor_name:'קודם',instructor_assignment_locked:true}:{}),...(draft?{draft_emp_id:'7',draft_instructor_name:instructor.full_name}:{})};
 const data={activities:[activity],instructors:[instructor],scheduling:{},_is_stale:stale,_planningSharedLoadedKey:'year|',meetingState:{loaded:true,approvedDates:new Map(),cancelledDates:new Map()}};
 const root=document.querySelector('#root');const old=supabase.rpc;const calls=[];
 supabase.rpc=async(name,args)=>{calls.push({name,args});if(rpcImpl)return rpcImpl(name,args);
  if(name==='get_scheduling_dashboard_candidates')return {data:{...snapshot,activity}};
  if(name==='course_assignment_manager_approval_state')return {data:{requires_approval:false,can_confirm:true}};
  if(name==='scheduling_course_meetings_completed')return {data:0};
  if(name==='scheduling_course_meeting_instructors')return {data:[]};
  if(name==='scheduling_dashboard_assignment')return {data:{...activity,
    ...(args.p_rpc.startsWith('save_')?{draft_emp_id:String(args.p_args.p_emp_id),draft_instructor_name:args.p_args.p_instructor_name}:
      args.p_rpc.startsWith('cancel_')?{emp_id:null,instructor_name:null,instructor_assignment_locked:false,draft_emp_id:null}:
      {emp_id:7,instructor_name:instructor.full_name,instructor_assignment_locked:true,draft_emp_id:null}),updated_at:'2026-10-15T08:01:00Z'}};
  throw Error('unexpected '+name);
 };
 const render=()=>{root.innerHTML=courseSchedulingScreen.render(data,{state});courseSchedulingScreen.bind({root,data,state,rerender:render,clearScreenDataCache:()=>{}});};
 render();
 return {root,state,data,calls,render,close(){supabase.rpc=old;dom.window.close();for(const key of ['window','document','sessionStorage','localStorage','CustomEvent'])delete globalThis[key];}};
}
const settle=()=>new Promise(resolve=>setTimeout(resolve,25));
test('Eden operation_manager loads agent candidates and saves a draft without browser matching',async()=>{
 const f=ui();try{
  const find=f.root.querySelector('[data-find-instructors]');assert.ok(find);assert.equal(find.disabled,false);find.click();await settle();
  assert.equal(f.state.courseSchedulingResults[0].recommended.instructor.emp_id,'7');
  const save=f.root.querySelector('[data-save-draft]');assert.ok(save);assert.equal(save.disabled,false);save.click();await settle();
  assert.ok(f.calls.some(c=>c.name==='scheduling_dashboard_assignment'&&c.args.p_rpc==='save_course_assignment_draft_with_dates'));
  assert.equal(f.data.activities[0].draft_emp_id,'7');
 }finally{f.close();}
});
test('existing assignment replacement opens agent choices instead of disabled runFindInstructors',async()=>{
 const f=ui({assigned:true});try{
  f.root.querySelector('[data-change-assignment]').click();await settle();
  assert.equal(f.state.courseSchedulingReplacementCourseId,course.row_id);
  assert.ok(f.calls.some(c=>c.name==='get_scheduling_dashboard_candidates'));
  assert.ok(f.root.querySelector('[data-assign-course]'));
 }finally{f.close();}
});
test('cached UI offers explicit refresh and keeps write controls disabled',async()=>{
 const f=ui({stale:true});try{
  assert.ok(f.root.querySelector('[data-refresh-assignment-data]'));
  f.root.querySelector('[data-find-instructors]').click();await settle();
  assert.equal(f.root.querySelector('[data-save-draft]').disabled,true);
 }finally{f.close();}
});
test('missing operation_manager permission cannot enter scheduling controls',()=>{
 const f=ui({allowed:false});try{assert.match(f.root.textContent,/אין הרשאה/);assert.equal(f.root.querySelector('[data-find-instructors]'),null);}finally{f.close();}
});

test('Eden confirms a stored draft through the guarded server assignment RPC',async()=>{
 const f=ui({draft:true});try{
  await settle();f.root.querySelector('[data-confirm-draft]').click();await settle();
  assert.ok(f.calls.some(c=>c.name==='scheduling_dashboard_assignment'&&c.args.p_rpc==='assign_activity_instructor'),JSON.stringify({calls:f.calls,error:f.state.courseSchedulingError,activity:f.data.activities[0]}));
  assert.equal(f.data.activities[0].emp_id,7);
 }finally{f.close();}
});
test('Eden confirms replacement without changing course dates',async()=>{
 const f=ui({assigned:true});try{
  f.root.querySelector('[data-change-assignment]').click();await settle();
  f.root.querySelector('[data-assign-course]').click();await settle();
  assert.ok(f.calls.some(c=>c.name==='scheduling_dashboard_assignment'&&c.args.p_rpc==='reassign_locked_course_instructor'));
  assert.equal(f.data.activities[0].emp_id,7);assert.equal(f.data.activities[0].date_1,course.date_1);
 }finally{f.close();}
});
test('Eden chooses an uncomputed manual instructor and server stages the draft',async()=>{
 const f=ui();try{
  f.root.querySelector('[data-find-instructors]').click();await settle();
  f.root.querySelector('[data-toggle-manual-picker]').click();
  f.root.querySelector('[data-manual-candidate="8"]').click();
  f.root.querySelector('[data-confirm-manual-candidate]').click();await settle();
  assert.ok(f.calls.some(c=>c.name==='scheduling_dashboard_assignment'&&c.args.p_rpc==='save_course_assignment_manual_draft'&&c.args.p_args.p_emp_id===8));
 }finally{f.close();}
});
test('Eden cancellation stays in the existing audited cancellation RPC',async()=>{
 const f=ui({assigned:true});try{
  f.root.querySelector('[data-open-cancel-assignment]').click();f.state.courseSchedulingCancelReason='בדיקת ביטול';f.root.querySelector('[data-cancel-assignment-reason]').value='בדיקת ביטול';
  f.root.querySelector('[data-confirm-cancel-assignment]').click();await settle();
  assert.ok(f.calls.some(c=>c.name==='scheduling_dashboard_assignment'&&c.args.p_rpc==='cancel_confirmed_course_assignment'),JSON.stringify({calls:f.calls,error:f.state.courseSchedulingError,cancel:f.state.courseSchedulingCancelCourseId,reason:f.state.courseSchedulingCancelReason}));
  assert.equal(f.data.activities[0].emp_id,null);
 }finally{f.close();}
});

test('Eden cannot finalize a draft waiting for manager approval',async()=>{
 const f=ui({draft:true,rpcImpl:async name=>name==='course_assignment_manager_approval_state'?{data:{approval_required:true,request_status:'pending'}}:{error:{message:'unexpected'}}});
 try{await settle();assert.equal(f.root.querySelector('[data-confirm-draft]').disabled,true);assert.ok(!f.calls.some(c=>c.name==='scheduling_dashboard_assignment'));}finally{f.close();}
});
test('approval read failure and refresh failure remain retryable without automatic rerender loop',async()=>{
 const f=ui({draft:true,rpcImpl:async()=>({error:{message:'scheduling_permission_denied'}})});
 try{await settle();assert.equal(f.root.querySelector('[data-confirm-draft]').disabled,true);
  const count=f.calls.length;await settle();assert.equal(f.calls.length,count);
  f.data.reloadPlanningSnapshot=async()=>{throw Error('offline');};
  f.root.querySelector('[data-refresh-assignment-data]').click();await settle();
  assert.equal(f.root.querySelector('[data-refresh-assignment-data]').disabled,false);assert.match(f.state.courseSchedulingError,/הרענון נכשל/);
 }finally{f.close();}
});

test('cancel permission conflict restores UI without using expired event.currentTarget',async()=>{
 const f=ui({assigned:true,rpcImpl:async name=>name==='scheduling_dashboard_assignment'?{error:{message:'scheduling_permission_denied'}}:{error:{message:'unexpected'}}});
 try{
  f.root.querySelector('[data-open-cancel-assignment]').click();
  f.root.querySelector('[data-cancel-assignment-reason]').value='בדיקה';
  f.root.querySelector('[data-confirm-cancel-assignment]').click();await settle();
  assert.ok(f.root.querySelector('[data-refresh-assignment-data]'));
  assert.equal(f.root.querySelector('[data-confirm-cancel-assignment]').disabled,false);
  assert.match(f.state.courseSchedulingError,/הרשאות השתנו/);
 }finally{f.close();}
});
