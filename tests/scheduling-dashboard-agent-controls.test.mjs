import './scheduling-agent-fixed-assignments.test.mjs';
import './course-scheduling-manual-operations.test.mjs';
import './course-scheduling-manual-plan-independence.test.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {agentCandidateResult,manualInstructorResult,createAgentAssignmentClient} from '../frontend/src/screens/course-scheduling-agent-selection.js';
import {courseSchedulingScreen,instructorsResultsHtml,selectedCourseNotesHtml} from '../frontend/src/screens/course-scheduling.js';
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
function ui({assigned=false,draft=false,stale=false,allowed=true,rpcImpl,mutateImpl,completed=0,user,activityFields={}}={}){
 const dom=new JSDOM('<div id="root"></div>',{url:'https://example.invalid'});
 for(const key of ['window','document','sessionStorage','localStorage','CustomEvent'])globalThis[key]=key==='window'?dom.window:dom.window[key];
 dom.window.confirm=()=>true;
 const state={route:'course-scheduling',user:user||(allowed?eden:{role:'operation_manager',permissions:{}}),courseSchedulingSelectedId:course.row_id,courseSchedulingFocusMode:true,courseSchedulingPlanningSharedLoaded:true};
 const activity={...course,...(assigned?{emp_id:'6',instructor_name:'קודם',instructor_assignment_locked:true}:{}),...(draft?{draft_emp_id:'7',draft_instructor_name:instructor.full_name}:{}),...activityFields};
 const data={activities:[activity],instructors:[instructor,{emp_id:'8',full_name:'בחירה ידנית',active:'yes'}],scheduling:{},_is_stale:stale,_planningSharedLoadedKey:'year|',meetingState:{loaded:true,approvedDates:new Map(),cancelledDates:new Map()}};
 const root=document.querySelector('#root');const old=supabase.rpc;const calls=[];
 supabase.rpc=async(name,args)=>{calls.push({name,args});if(rpcImpl)return rpcImpl(name,args);
  if(name==='get_scheduling_dashboard_candidates')return {data:{...snapshot,activity}};
  if(name==='course_assignment_manager_approval_state')return {data:{requires_approval:false,can_confirm:true}};
  if(name==='scheduling_course_meetings_completed')return {data:completed};
  if(name==='scheduling_course_meeting_instructors')return {data:[]};
  if(name==='scheduling_dashboard_assignment'&&mutateImpl)return mutateImpl(args,activity);
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
for (const user of [eden, {role:'admin'}]) test(user.role+' keeps the instructor table and manual entry when planning is stale or deferred',async()=>{
 const f=ui({user});try{
  f.state.courseSchedulingPlanningStale=true;
  f.state.courseSchedulingPlanningRows=[{courseId:course.row_id,kind:'proposal',needsRecalc:true,_detailsDeferred:true,instructorEmpId:'7',instructorName:instructor.full_name,meetings:[{date:'2026-11-01',start_time:'10:00',end_time:'11:00'}]}];
  f.render();
  assert.ok(f.root.querySelector('.course-planning-completion-table'));
  assert.match(f.root.querySelector('[data-planning-overview-currency]').textContent,/ממתינות לעדכון/);
  f.root.querySelector('[data-open-manual-course]').click();await settle();
  assert.ok(f.root.querySelector('[data-manual-candidate="8"]'));
  f.root.querySelector('[data-manual-candidate="8"]').click();
  f.root.querySelector('[data-confirm-manual-candidate]').click();await settle();
  assert.equal(f.data.activities[0].draft_emp_id,'8');
  assert.ok(f.root.querySelector('.course-planning-completion-table'));
  assert.match(f.root.querySelector('.course-planning-completion-table').textContent,/בחירה ידנית/);
  assert.ok(!f.calls.some(c=>c.name==='get_scheduling_dashboard_candidates'));
  assert.equal(f.calls.filter(c=>c.name==='scheduling_dashboard_assignment').length,1);
 }finally{f.close();}
});
test('instructor table remains mounted before planning loads, during a run, and with no assignments',()=>{
 const f=ui();try{
  for(const flags of [
   {courseSchedulingPlanningSharedLoaded:false},
   {courseSchedulingPlanningSharedLoaded:true,courseSchedulingPlanningLoading:true},
   {courseSchedulingPlanningLoading:false,courseSchedulingPlanningStale:true}
  ]){
   Object.assign(f.state,flags);f.render();
   assert.ok(f.root.querySelector('.course-planning-completion-table'));
   assert.ok(f.root.querySelector('[data-open-manual-course]'));
  }
  f.data.activities=[];f.render();
  assert.ok(f.root.querySelector('.course-planning-completion-table'));
 }finally{f.close();}
});
for(const activity_type of ['סדנה','סיור'])test('manual '+activity_type+' assignment is available without extending automatic planning',async()=>{
 const f=ui({activityFields:{activity_type}});try{
  assert.ok(f.root.querySelector('[data-course-card="synthetic"]'));
  f.root.querySelector('[data-open-manual-course]').click();await settle();
  assert.equal(f.root.querySelector('[data-find-instructors]'),null);
  f.root.querySelector('[data-manual-candidate="8"]').click();
  f.root.querySelector('[data-confirm-manual-candidate]').click();await settle();
  const write=f.calls.find(c=>c.name==='scheduling_dashboard_assignment');
  assert.equal(write.args.p_rpc,'save_course_assignment_manual_draft');
  assert.equal(f.data.activities[0].draft_emp_id,'8');
  assert.ok(!f.calls.some(c=>c.name==='get_scheduling_dashboard_candidates'));
 }finally{f.close();}
});
test('late recommendation response cannot overwrite a manual selection or its activity revision',async()=>{
 let finish;
 const pending=new Promise(resolve=>{finish=resolve});
 const f=ui({rpcImpl:async name=>name==='get_scheduling_dashboard_candidates'?pending:{data:[]}});
 try{
  f.root.querySelector('[data-find-instructors]').click();
  f.root.querySelector('[data-open-manual-assignment]').click();await settle();
  assert.equal(f.state.courseSchedulingResults[0].manualOnly,true);
  f.data.activities[0].updated_at='2026-10-20T10:00:00Z';
  finish({data:snapshot});await settle();
  assert.equal(f.state.courseSchedulingResults[0].manualOnly,true);
  assert.equal(f.data.activities[0].updated_at,'2026-10-20T10:00:00Z');
  assert.equal(f.data._agentAssignmentSnapshots.size,0);
  assert.ok(f.root.querySelector('[data-manual-candidate="8"]'));
 }finally{finish({data:snapshot});f.close();}
});
test('read-only scheduling role has no direct manual assignment entry',()=>{
 const f=ui({user:{...eden,role:'activities_manager'}});try{
  assert.equal(f.root.querySelector('[data-open-manual-course]'),null);
  assert.equal(f.root.querySelector('[data-open-manual-assignment]'),null);
 }finally{f.close();}
});
test('Eden operation_manager loads agent candidates and saves a draft without browser matching',async()=>{
 const f=ui();try{
  const find=f.root.querySelector('[data-find-instructors]');assert.ok(find);assert.equal(find.disabled,false);find.click();await settle();
  assert.equal(f.state.courseSchedulingResults[0].recommended.instructor.emp_id,'7');
  const save=f.root.querySelector('[data-save-draft]');assert.ok(save);assert.equal(save.disabled,false);save.click();await settle();
  assert.ok(f.calls.some(c=>c.name==='scheduling_dashboard_assignment'&&c.args.p_rpc==='save_course_assignment_draft_with_dates'));
  assert.equal(f.data.activities[0].draft_emp_id,'7');
 }finally{f.close();}
});
test('manual candidates do not require agent options or pretend to be eligible',()=>{
 const r=manualInstructorResult(course,[instructor,{emp_id:'8',full_name:'בחירה ידנית'}]);
 assert.equal(r.manualOnly,true);assert.equal(r.agentSnapshot,undefined);
 assert.equal(r.recommended,null);assert.equal(r.manualCandidates.length,2);
 assert.equal(r.manualCandidates[1].serverValidationRequired,true);
 assert.equal(r.manualCandidates[1].eligible,false);
});
test('Eden saves a manual draft without calling the agent or planner',async()=>{
 const f=ui();try{
  f.root.querySelector('[data-open-manual-assignment]').click();await settle();
  assert.equal(f.state.courseSchedulingResults[0].manualOnly,true);
  assert.ok(f.root.querySelector('[data-manual-candidate="8"]'));
  assert.ok(!f.calls.some(c=>c.name==='get_scheduling_dashboard_candidates'));
  f.root.querySelector('[data-manual-candidate="8"]').click();
  f.root.querySelector('[data-confirm-manual-candidate]').click();await settle();
  const writes=f.calls.filter(c=>c.name==='scheduling_dashboard_assignment');
  assert.equal(writes.length,1);
  assert.equal(writes[0].args.p_rpc,'save_course_assignment_manual_draft');
  assert.equal(writes[0].args.p_args.p_emp_id,8);
  assert.equal(writes[0].args.p_expected_source_revision,null);
  assert.equal(writes[0].args.p_expected_workspace_revision,null);
  assert.equal(f.data.activities[0].draft_emp_id,'8');
  assert.ok(!f.calls.some(c=>c.name==='get_scheduling_dashboard_candidates'));
 }finally{f.close();}
});
test('manual action ignores earlier agent workspace revision',async()=>{
 const f=ui();try{
  f.root.querySelector('[data-find-instructors]').click();await settle();
  f.root.querySelector('[data-open-manual-assignment]').click();await settle();
  f.root.querySelector('[data-manual-candidate="8"]').click();
  f.root.querySelector('[data-confirm-manual-candidate]').click();await settle();
  const write=f.calls.find(c=>c.name==='scheduling_dashboard_assignment');
  assert.equal(write.args.p_expected_source_revision,null);
  assert.equal(write.args.p_expected_workspace_revision,null);
 }finally{f.close();}
});
test('Eden reassigns manually without agent suggestions',async()=>{
 const f=ui({assigned:true});try{
  f.root.querySelector('[data-change-assignment]').click();await settle();
  f.root.querySelector('[data-manual-candidate="8"]').click();
  f.root.querySelector('[data-confirm-manual-candidate]').click();await settle();
  assert.equal(f.state.courseSchedulingSelectedCandidateId,'8');
  const reason=f.root.querySelector('[data-replacement-reason]');
  reason.value='שיבוץ ידני תפעולי';reason.dispatchEvent(new window.Event('input',{bubbles:true}));
  f.root.querySelector('[data-assign-course]').click();await settle();
  const write=f.calls.find(c=>c.name==='scheduling_dashboard_assignment');
  assert.equal(write.args.p_rpc,'reassign_locked_course_instructor');
  assert.equal(write.args.p_args.p_new_emp_id,8);
  assert.ok(!f.calls.some(c=>c.name==='get_scheduling_dashboard_candidates'));
 }finally{f.close();}
});
test('planning-only lock does not force a global plan run before manual selection',async()=>{
 const f=ui();try{
  f.state.courseSchedulingPlanningRows=[{courseId:course.row_id,planningLocked:true,instructorEmpId:'7',kind:'planning-locked'}];
  f.render();
  const manual=f.root.querySelector('[data-open-manual-assignment]');
  assert.ok(manual);manual.click();await settle();
  assert.ok(f.root.querySelector('[data-manual-candidate="8"]'));
  assert.ok(!f.calls.some(c=>c.name==='get_scheduling_dashboard_candidates'));
 }finally{f.close();}
});
test('opening saved recommendations closes the direct manual picker exactly once',async()=>{
 const f=ui({assigned:true});try{
  f.root.querySelector('[data-change-assignment]').click();await settle();
  assert.equal(f.state.courseSchedulingManualPickerOpen,true);
  assert.ok(f.root.querySelector('[data-manual-candidate="8"]'));
  f.root.querySelector('[data-find-instructors]').click();await settle();
  assert.equal(f.state.courseSchedulingManualPickerOpen,false);
  assert.equal(f.root.querySelector('[data-manual-candidate="8"]'),null);
  f.root.querySelector('[data-toggle-manual-picker]').click();
  assert.equal(f.state.courseSchedulingManualPickerOpen,true);
  assert.ok(f.root.querySelector('[data-manual-candidate="8"]'));
  assert.equal(f.calls.filter(c=>c.name==='get_scheduling_dashboard_candidates').length,1);
 }finally{f.close();}
});
test('existing assignment replacement opens manual picker without calling the agent',async()=>{
 const f=ui({assigned:true});try{
  f.root.querySelector('[data-change-assignment]').click();await settle();
  assert.equal(f.state.courseSchedulingReplacementCourseId,course.row_id);
  assert.equal(f.calls.filter(c=>c.name==='get_scheduling_dashboard_candidates').length,0);
  assert.ok(f.root.querySelector('[data-manual-candidate="8"]'));
  assert.ok(!f.root.querySelector('[data-assign-course]'));
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
  f.root.querySelector('[data-find-instructors]').click();await settle();
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

for(const {failure,completed} of [{failure:null,completed:0},{failure:'scheduling_conflict_detected',completed:0},{failure:'scheduling_manager_approval_required',completed:0},{failure:null,completed:2}])test('manual replacement from recommended agent choice reaches server: '+(failure||'success')+' after '+completed+' meetings',async()=>{
 let resolveWrite;const pending=new Promise(resolve=>{resolveWrite=resolve;});
 const f=ui({assigned:true,mutateImpl:()=>pending,completed});
 try{
  f.root.querySelector('[data-change-assignment]').click();await settle();
  f.root.querySelector('[data-find-instructors]').click();await settle();
  assert.equal(f.state.courseSchedulingResults[0].recommended.instructor.emp_id,'7');
  assert.equal(f.root.querySelectorAll('[data-manual-picker]').length,1);
  f.root.querySelector('[data-toggle-manual-picker]').click();
  f.root.querySelector('[data-manual-candidate="8"]').click();
  f.root.querySelector('[data-confirm-manual-candidate]').click();await settle();
  assert.equal(f.state.courseSchedulingSelectedCandidateId,'8');
  assert.equal(f.state.courseSchedulingResults[0].checked.find(c=>c.instructor.emp_id==='8').eligible,false);
  assert.match(f.root.querySelector('[data-manual-validation-pending]').textContent,/שטרם אומתה/);
  assert.equal(f.data.activities[0].emp_id,'6');
  assert.ok(!f.calls.some(c=>c.name==='scheduling_dashboard_assignment'));
  const reason=f.root.querySelector('[data-replacement-reason]');reason.value='בחירה ידנית לצורך תפעולי';reason.dispatchEvent(new window.Event('input',{bubbles:true}));
  if(completed>=2){
   const effective=f.root.querySelector('[data-replacement-effective-from]');effective.value='2026-11-01';effective.dispatchEvent(new window.Event('change',{bubbles:true}));
   const confirmation=f.root.querySelector('[data-replacement-confirm]');confirmation.checked=true;confirmation.dispatchEvent(new window.Event('change',{bubbles:true}));
  }
  f.root.querySelector('[data-assign-course]').click();await settle();
  const request=f.calls.find(c=>c.name==='scheduling_dashboard_assignment');
  assert.equal(request.args.p_rpc,completed>=2?'replace_locked_course_instructor':'reassign_locked_course_instructor');
  if(completed>=2)assert.equal(request.args.p_args.p_effective_from,'2026-11-01');
  assert.equal(request.args.p_args.p_new_emp_id,8);
  assert.equal(request.args.p_args.p_reason,reason.value);
  assert.equal(request.args.p_expected_updated_at,version);
  assert.equal(request.args.p_expected_source_revision,null);
  assert.equal(request.args.p_expected_workspace_revision,null);
  assert.equal(f.data.activities[0].emp_id,'6');
  resolveWrite(failure?{error:{message:failure}}:{data:{...f.data.activities[0],emp_id:8,instructor_name:'בחירה ידנית',updated_at:'2026-10-15T08:01:00Z'}});
  await settle();
  assert.equal(f.data.activities[0].emp_id,failure?'6':8);
  assert.equal(f.data.activities[0].date_1,course.date_1);
  if(failure){assert.ok(f.root.querySelector('[data-manual-validation-pending]'));assert.equal(f.root.querySelector('[data-assign-course]').disabled,false);}
 }finally{resolveWrite({error:{message:'test_cleanup'}});f.close();}
});

for(const kind of ['recommended','bestAvailable'])test('direct result HTML includes exactly one manual picker beside '+kind,()=>{
 const result=agentCandidateResult(snapshot,{replacement:true});
 if(kind==='bestAvailable'){result.bestAvailable=result.recommended;result.recommended=null;}
 const dom=new JSDOM(instructorsResultsHtml(result,{}));
 assert.equal(dom.window.document.querySelectorAll('[data-manual-picker]').length,1);dom.window.close();
});
test('choosing the recommended instructor through manual picker still awaits server verification',async()=>{
 const f=ui({assigned:true});try{
  f.root.querySelector('[data-change-assignment]').click();await settle();
  f.root.querySelector('[data-find-instructors]').click();await settle();
  f.root.querySelector('[data-toggle-manual-picker]').click();
  f.root.querySelector('[data-manual-candidate="7"]').click();
  f.root.querySelector('[data-confirm-manual-candidate]').click();await settle();
  assert.ok(f.root.querySelector('[data-manual-validation-pending]'));
  assert.equal(f.data.activities[0].emp_id,'6');assert.ok(!f.calls.some(c=>c.name==='scheduling_dashboard_assignment'));
 }finally{f.close();}
});

test('Eden uses the enabled independent instructor and date editor with her own route acknowledgement', async () => {
 const requests=[];
 const f=ui({activityFields:{sessions:'1'},rpcImpl:async(name,args)=>{
  requests.push({name,args});
  if(name==='scheduling_manual_capabilities')return {data:{apiVersion:'manual-operations-v1',enabled:true}};
  if(name==='get_scheduling_manual_assignment_preview')return {data:{
   previewHash:'manual-preview',blockers:[],warnings:[{code:'manual_home_route_unknown'}],
   reasonRequired:true,instructorName:'בחירה ידנית',previousInstructorName:null}};
  if(name==='commit_scheduling_manual_assignment')return {data:{...course,sessions:'1',draft_emp_id:'8',
   draft_instructor_name:'בחירה ידנית',updated_at:'2026-10-20T12:00:00Z'}};
  return {data:[]};
 }});
 try{
  await settle();
  f.root.querySelector('[data-open-manual-course]').click();
  assert.ok(f.root.querySelector('[data-manual-operations-overlay]'));
  let instructor=f.root.querySelector('[data-manual-operation-field="empId"]');
  instructor.value='8';instructor.dispatchEvent(new window.Event('change',{bubbles:true}));
  f.root.querySelector('[data-manual-operation-check]').click();await settle();
  assert.equal(f.root.querySelector('[data-manual-operation-save]').disabled,true);
  const reason=f.root.querySelector('[data-manual-operation-field="reason"]');
  reason.value='נבדק מול המדריך';reason.dispatchEvent(new window.Event('input',{bubbles:true}));
  const ack=f.root.querySelector('[data-manual-operation-field="acknowledged"]');
  ack.checked=true;ack.dispatchEvent(new window.Event('change',{bubbles:true}));
  assert.equal(f.root.querySelector('[data-manual-operation-save]').disabled,false);
  f.root.querySelector('[data-manual-operation-save]').click();await settle();
  assert.equal(f.data.activities[0].draft_emp_id,'8');
  assert.equal(f.root.querySelector('[data-manual-operations-overlay]'),null);
  assert.ok(f.root.querySelector('.course-planning-completion-table'));
  assert.ok(!requests.some(r=>['get_scheduling_dashboard_candidates','scheduling_dashboard_assignment'].includes(r.name)));
  const commit=requests.find(r=>r.name==='commit_scheduling_manual_assignment');
  assert.equal(commit.args.p_acknowledge_warnings,true);
  assert.equal(commit.args.p_preview_hash,'manual-preview');
  assert.equal(commit.args.p_expected_updated_at,version);
 }finally{f.close();}
});

test('manual editor includes inactive instructors from the full directory and requires their warning acknowledgement', async () => {
 const f=ui({activityFields:{sessions:'1'},rpcImpl:async(name,args)=>{
  if(name==='scheduling_manual_capabilities')return {data:{apiVersion:'manual-operations-v1',enabled:true}};
  if(name==='get_scheduling_manual_assignment_preview')return {data:{
   previewHash:'inactive-preview',blockers:[],warnings:[{code:'instructor_inactive',empId:9}],
   reasonRequired:true,instructorName:'מדריך לא פעיל'}};
  if(name==='commit_scheduling_manual_assignment')return {data:{...course,sessions:'1',
   draft_emp_id:'9',draft_instructor_name:'מדריך לא פעיל',updated_at:'2026-10-20T12:00:00Z'}};
  return {data:[]};
 }});
 try {
  f.data.manualInstructors=[...f.data.instructors,{emp_id:'9',full_name:'מדריך לא פעיל',active:'no'}];
  await settle();
  f.root.querySelector('[data-open-manual-course]').click();
  const picker=f.root.querySelector('[data-manual-operation-field="empId"]');
  assert.match(picker.querySelector('option[value="9"]').textContent,/לא פעיל/);
  assert.ok(!f.data.instructors.some(i=>i.emp_id==='9'),'automatic pool remains active-only');
  picker.value='9';picker.dispatchEvent(new window.Event('change',{bubbles:true}));
  f.root.querySelector('[data-manual-operation-check]').click();await settle();
  assert.match(f.root.querySelector('[role="alertdialog"]').textContent,/המדריך אינו פעיל/);
  assert.equal(f.root.querySelector('[data-manual-operation-save]').disabled,true);
  const reason=f.root.querySelector('[data-manual-operation-field="reason"]');
  reason.value='אושר מראש';reason.dispatchEvent(new window.Event('input',{bubbles:true}));
  const ack=f.root.querySelector('[data-manual-operation-field="acknowledged"]');
  ack.checked=true;ack.dispatchEvent(new window.Event('change',{bubbles:true}));
  f.root.querySelector('[data-manual-operation-save]').click();await settle();
  assert.equal(f.data.activities[0].draft_emp_id,'9');
  assert.ok(!f.calls.some(c=>c.name==='get_scheduling_dashboard_candidates'));
 } finally {f.close();}
});

test('operator workboard prioritizes manual assignment above deferred agent planning', () => {
 const f=ui();try{
  const list=f.root.querySelector('[data-course-list]');
  const summary=f.root.querySelector('.course-scheduling-summary');
  const plan=f.root.querySelector('[data-planning-disclosure]');
  assert.ok(summary&&list&&plan);
  assert.ok(summary.compareDocumentPosition(list)&4,'summary appears before workboard');
  assert.ok(list.compareDocumentPosition(plan)&4,'agent planning appears below workboard');
  assert.equal(plan.open,false,'agent planning is collapsed by default');
  assert.ok(plan.querySelector('.course-planning-completion-table'),'planning information remains available');
  plan.open=true;plan.dispatchEvent(new window.Event('toggle'));
  f.render();
  assert.equal(f.root.querySelector('[data-planning-disclosure]').open,true,'disclosure survives rerender');
 }finally{f.close();}
});

test('activity notes are escaped, labeled, and operational private notes are role-restricted',()=>{
 const activity={notes:'תיאום מול בית הספר <script>alert(1)</script>',scheduling_note:'רביעי בלבד',operations_private_notes:'הערה תפעולית פנימית'};
 const admin=selectedCourseNotesHtml(activity,{role:'admin'});
 assert.match(admin,/הערות פעילות/);
 assert.match(admin,/הנחיות לשיבוץ/);
 assert.match(admin,/הערות תפעול/);
 assert.match(admin,/&lt;script&gt;/);
 assert.doesNotMatch(admin,/<script>/);
 const basic=selectedCourseNotesHtml(activity,{role:'activities_manager',permissions:{view_operations_scheduling:'yes'}});
 assert.doesNotMatch(basic,/הערה תפעולית פנימית/);
 assert.match(basic,/רביעי בלבד/);
});

test('new server manual API makes one operator action and warning acknowledgement without an agent run',async()=>{
 const f=ui({activityFields:{sessions:'1',notes:'לתאם מראש',scheduling_note:'להתקשר לבית הספר'},
  rpcImpl:async(name,args)=>{
   if(name==='scheduling_manual_capabilities')return {data:{apiVersion:'manual-operations-v1',enabled:true}};
   if(name==='get_scheduling_manual_assignment_preview')return {data:{
    previewHash:'approval-fence',blockers:[],warnings:[{code:'scheduling_conflict_detected',date:'2026-11-01',otherActivity:'other'}],
    reasonRequired:true,instructorName:'בחירה ידנית',previousInstructorName:''
   }};
   if(name==='commit_scheduling_manual_assignment')return {data:{...course,emp_id:8,instructor_name:'בחירה ידנית',
    notes:'לתאם מראש',scheduling_note:'להתקשר לבית הספר',updated_at:'2026-10-21T12:30:00Z'}};
   if(name==='course_assignment_manager_approval_state')return {data:{requires_approval:false}};
   if(name==='scheduling_course_meetings_completed')return {data:0};
   if(name==='scheduling_course_meeting_instructors')return {data:[]};
   return {data:[]};
  }});
 try{
  await settle();
  const card=f.root.querySelector('[data-course-card="synthetic"]');
  assert.ok(card.querySelector('[data-open-manual-course]'));
  assert.equal(card.querySelectorAll('[data-course-row-action]').length,1,'one row action instead of competing manual/agent buttons');
  card.querySelector('[data-open-manual-course]').click();await settle();
  let selected=f.root.querySelector('[data-manual-operation-field="empId"]');
  assert.ok(selected,'independent manual editor opened');
  selected.value='8';selected.dispatchEvent(new window.Event('change',{bubbles:true}));
  f.root.querySelector('[data-manual-operation-check]').click();await settle();
  const dialog=f.root.querySelector('[data-manual-operations-overlay] [role="alertdialog"]');
  assert.ok(dialog,'conflict is a consolidated warning, not a hard reject');
  const reason=f.root.querySelector('[data-manual-operation-field="reason"]');
  reason.value='סוכם מראש מול המנהל';reason.dispatchEvent(new window.Event('input',{bubbles:true}));
  const acknowledged=f.root.querySelector('[data-manual-operation-field="acknowledged"]');
  acknowledged.checked=true;acknowledged.dispatchEvent(new window.Event('change',{bubbles:true}));
  f.root.querySelector('[data-manual-operation-save]').click();await settle();
  assert.equal(f.data.activities[0].emp_id,8);
  assert.equal(f.calls.filter(c=>c.name==='commit_scheduling_manual_assignment').length,1);
  assert.ok(!f.calls.some(c=>c.name==='get_scheduling_dashboard_candidates'),'no agent candidate evaluation');
  assert.ok(!f.calls.some(c=>c.name==='scheduling_dashboard_assignment'),'no legacy gateway write');
 }finally{f.close();}
});
