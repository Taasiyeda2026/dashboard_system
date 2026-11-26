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
 const activity={...course,...(assigned?{emp_id:'6',instructor_name:'קודם',instructor_assignment_locked:true}:{}),...(draft?{draft_emp_id:'7',draft_instructor_name:instructor.full_name}:{}),sessions:'1',...activityFields};
 const data={_manualOperationsCapabilityChecked:!rpcImpl,_manualOperationsAvailable:!rpcImpl,activities:[activity],instructors:[instructor,{emp_id:'8',full_name:'בחירה ידנית',active:'yes'}],scheduling:{},_is_stale:stale,_planningSharedLoadedKey:'year|',meetingState:{loaded:true,approvedDates:new Map(),cancelledDates:new Map()}};
 const root=document.querySelector('#root');const old=supabase.rpc;const calls=[];
 supabase.rpc=async(name,args)=>{calls.push({name,args});if(rpcImpl)return rpcImpl(name,args);
  if(name==='get_scheduling_manual_assignment_preview')return {data:{previewHash:'current',blockers:[],warnings:[],reasonRequired:assigned,instructorName:'בחירה ידנית'}};
  if(name==='commit_scheduling_manual_assignment')return mutateImpl ? mutateImpl(args,activity) : {data:{...activity,
    ...(args.p_action==='draft'?{draft_emp_id:String(args.p_emp_id),draft_instructor_name:'בחירה ידנית'}:{emp_id:args.p_emp_id,instructor_name:'בחירה ידנית',draft_emp_id:null}),updated_at:'2026-10-15T08:01:00Z'}};
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
function chooseManual(f, empId='8') {
 const input=f.root.querySelector('[data-manual-operation-field="empId"]');
 assert.ok(input,'direct manual editor'); input.value=empId;input.dispatchEvent(new window.Event('change',{bubbles:true}));
}
async function saveManual(f, {replacement=false}={}) {
 if(replacement){
  const effective=f.root.querySelector('[data-manual-operation-field="effectiveFrom"]');
  effective.value='2026-11-01';effective.dispatchEvent(new window.Event('input',{bubbles:true}));
 }
 f.root.querySelector('[data-manual-operation-save]').click();await settle();
 if(replacement){
  const reason=f.root.querySelector('[data-manual-operation-field="reason"]');
  reason.value='בחירה ידנית לצורך תפעולי';reason.dispatchEvent(new window.Event('input',{bubbles:true}));
  f.root.querySelector('[data-manual-operation-save]').click();await settle();
 }
}
for (const user of [eden, {role:'admin'}]) test(user.role+' keeps the instructor table and manual entry when planning is stale or deferred',async()=>{
 const f=ui({user});try{
  f.state.courseSchedulingPlanningStale=true;
  f.state.courseSchedulingPlanningRows=[{courseId:course.row_id,kind:'proposal',needsRecalc:true,_detailsDeferred:true,instructorEmpId:'7',instructorName:instructor.full_name,meetings:[{date:'2026-11-01',start_time:'10:00',end_time:'11:00'}]}];
  f.render();
  assert.ok(f.root.querySelector('.course-planning-completion-table'));
  assert.equal(f.root.querySelector('[data-planning-report]').dataset.planningReportMode,'operational-only');
  f.root.querySelector('[data-open-manual-course]').click();await settle();
  chooseManual(f); await saveManual(f);
  assert.equal(f.data.activities[0].draft_emp_id,'8');
  assert.ok(f.root.querySelector('.course-planning-completion-table'));
  assert.ok(!f.calls.some(c=>c.name==='get_scheduling_dashboard_candidates'));
  assert.equal(f.calls.filter(c=>c.name==='commit_scheduling_manual_assignment').length,1);
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
  chooseManual(f); await saveManual(f);
  const write=f.calls.find(c=>c.name==='commit_scheduling_manual_assignment');
  assert.equal(write.args.p_action,'draft'); assert.equal(f.data.activities[0].draft_emp_id,'8');
  assert.ok(!f.calls.some(c=>c.name==='get_scheduling_dashboard_candidates'));
 }finally{f.close();}
});
test('cached recommendations cannot appear in the manual workboard or trigger a planning read',async()=>{
 const f=ui();try{
  f.state.courseSchedulingResults=[agentCandidateResult(snapshot)];
  f.data._planningShared={rows:[{activityId:course.row_id,row:{kind:'proposal',planningLocked:true,instructorEmpId:'7'}}]};
  f.render();await settle();
  assert.deepEqual(f.state.courseSchedulingResults,[]);
  assert.equal(f.root.querySelector('[data-find-instructors]'),null);
  assert.equal(f.root.querySelector('[data-confirm-actual-draft]'),null);
  assert.ok(!f.calls.some(({name})=>/planning_(workspace|preflight|row_details)|dashboard_candidates/.test(name)));
 }finally{f.close();}
});
test('read-only scheduling role has no direct manual assignment entry',()=>{
 const f=ui({user:{...eden,role:'activities_manager'}});try{
  assert.equal(f.root.querySelector('[data-open-manual-course]'),null);
  assert.equal(f.root.querySelector('[data-open-manual-assignment]'),null);
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
  f.root.querySelector('[data-open-manual-assignment]').click(); chooseManual(f); await saveManual(f);
  const writes=f.calls.filter(c=>c.name==='commit_scheduling_manual_assignment');
  assert.equal(writes.length,1); assert.equal(writes[0].args.p_action,'draft');assert.equal(writes[0].args.p_emp_id,8);
  assert.equal(f.data.activities[0].draft_emp_id,'8');assert.ok(!f.calls.some(c=>c.name==='get_scheduling_dashboard_candidates'));
 }finally{f.close();}
});
test('manual action ignores earlier agent workspace revision',async()=>{
 const f=ui();try{
  f.data._agentAssignmentSnapshots=new Map([[course.row_id,snapshot]]);
  f.root.querySelector('[data-open-manual-assignment]').click();chooseManual(f);await saveManual(f);
  const write=f.calls.find(c=>c.name==='commit_scheduling_manual_assignment');
  assert.equal(write.args.p_expected_updated_at,version);
  assert.equal('p_expected_source_revision' in write.args,false);assert.equal('p_expected_workspace_revision' in write.args,false);
 }finally{f.close();}
});
test('Eden reassigns manually without agent suggestions',async()=>{
 const f=ui({assigned:true});try{
  f.root.querySelector('[data-change-assignment]').click();chooseManual(f);await saveManual(f,{replacement:true});
  const write=f.calls.find(c=>c.name==='commit_scheduling_manual_assignment');
  assert.equal(write.args.p_emp_id,8);assert.equal(write.args.p_effective_from,'2026-11-01');
  assert.ok(!f.calls.some(c=>c.name==='get_scheduling_dashboard_candidates'));
 }finally{f.close();}
});
test('planning-only lock does not force a global plan run before manual selection',async()=>{
 const f=ui();try{
  f.state.courseSchedulingPlanningRows=[{courseId:course.row_id,planningLocked:true,instructorEmpId:'7',kind:'planning-locked'}];f.render();
  f.root.querySelector('[data-open-manual-assignment]').click();assert.ok(f.root.querySelector('[data-manual-operations-overlay]'));
  assert.ok(!f.calls.some(c=>c.name==='get_scheduling_dashboard_candidates'));
 }finally{f.close();}
});

test('existing assignment replacement opens manual picker without calling the agent',async()=>{
 const f=ui({assigned:true});try{
  f.root.querySelector('[data-change-assignment]').click();
  assert.ok(f.root.querySelector('[data-manual-operations-overlay]'));assert.equal(f.calls.filter(c=>c.name==='get_scheduling_dashboard_candidates').length,0);
 }finally{f.close();}
});
test('cached UI offers explicit refresh and keeps write controls disabled',async()=>{
 const f=ui({stale:true});try{
  assert.ok(f.root.querySelector('[data-refresh-assignment-data]'));
  assert.equal(f.root.querySelector('[data-open-manual-assignment]').disabled,true);
  assert.ok(!f.calls.some(({name})=>name==='scheduling_dashboard_assignment'));
 }finally{f.close();}
});
test('missing operation_manager permission cannot enter scheduling controls',()=>{
 const f=ui({allowed:false});try{assert.match(f.root.textContent,/אין הרשאה/);assert.equal(f.root.querySelector('[data-find-instructors]'),null);}finally{f.close();}
});

test('Eden confirms a stored draft through the guarded server assignment RPC',async()=>{
 const f=ui({draft:true});try{
  await settle();f.root.querySelector('[data-confirm-draft]').click();await saveManual(f);
  const write=f.calls.find(c=>c.name==='commit_scheduling_manual_assignment');assert.equal(write.args.p_action,'confirm');assert.equal(write.args.p_emp_id,7);
  assert.equal(f.data.activities[0].emp_id,7);
 }finally{f.close();}
});
test('Eden confirms replacement without changing course dates',async()=>{
 const f=ui({assigned:true});try{
  f.root.querySelector('[data-change-assignment]').click();chooseManual(f,'7');await saveManual(f,{replacement:true});
  assert.equal(f.data.activities[0].emp_id,7);assert.equal(f.data.activities[0].date_1,course.date_1);
  const write=f.calls.find(c=>c.name==='commit_scheduling_manual_assignment');assert.equal(write.args.p_meetings,null);assert.equal(write.args.p_start_time,null);
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

for(const {failure,completed} of [{failure:null,completed:0},{failure:'scheduling_conflict_detected',completed:0},{failure:'scheduling_manager_approval_required',completed:0},{failure:null,completed:2}])test('manual replacement reaches server: '+(failure||'success')+' after '+completed+' meetings',async()=>{
 let resolveWrite;const pending=new Promise(resolve=>{resolveWrite=resolve;});
 const f=ui({assigned:true,mutateImpl:()=>pending,completed});
 try{
  f.root.querySelector('[data-change-assignment]').click();chooseManual(f);await saveManual(f,{replacement:true});
  const request=f.calls.find(c=>c.name==='commit_scheduling_manual_assignment');assert.ok(request);
  assert.equal(request.args.p_emp_id,8);assert.equal(request.args.p_effective_from,'2026-11-01');assert.equal(request.args.p_expected_updated_at,version);
  assert.equal(f.data.activities[0].emp_id,'6');
  assert.equal(f.root.querySelector('[data-manual-operation-save]').disabled,true);
  resolveWrite(failure?{error:{message:failure}}:{data:{...f.data.activities[0],emp_id:8,updated_at:'2026-10-15T08:01:00Z'}});await settle();
  assert.equal(f.data.activities[0].emp_id,failure?'6':8);assert.equal(f.data.activities[0].date_1,course.date_1);
  if(failure){assert.ok(f.root.querySelector('[data-manual-operations-overlay]'));assert.ok(f.state.courseSchedulingManualOperation.error);}
 }finally{resolveWrite({error:{message:'test_cleanup'}});f.close();}
});

for(const kind of ['recommended','bestAvailable'])test('direct result HTML includes exactly one manual picker beside '+kind,()=>{
 const result=agentCandidateResult(snapshot,{replacement:true});
 if(kind==='bestAvailable'){result.bestAvailable=result.recommended;result.recommended=null;}
 const dom=new JSDOM(instructorsResultsHtml(result,{}));
 assert.equal(dom.window.document.querySelectorAll('[data-manual-picker]').length,1);dom.window.close();
});
test('choosing an instructor through the manual picker still awaits server verification',async()=>{
 const f=ui({assigned:true});try{
  f.root.querySelector('[data-change-assignment]').click();chooseManual(f,'7');
  assert.equal(f.data.activities[0].emp_id,'6');assert.ok(!f.calls.some(c=>/manual_assignment/.test(c.name)));
 }finally{f.close();}
});

test('manual assignment replaces the selected activity sheet and restores it on close', async () => {
 const f=ui({activityFields:{sessions:'2'},rpcImpl:async name =>
  name==='scheduling_manual_capabilities'
   ? {data:{apiVersion:'manual-operations-v1',enabled:true,officialScheduleReadOnly:true}}
   : {data:[]}
 });
 try {
  await settle();
  const activityId=f.state.courseSchedulingSelectedId;
  assert.ok(f.root.querySelector('[data-course-detail].is-open'), 'activity sheet is open before editing');
  f.root.querySelector('[data-open-manual-course]').click();
  assert.ok(f.root.querySelector('[data-manual-operations-overlay]'));
  assert.ok(f.root.querySelector('.is-manual-editor-open'));
  assert.ok(!f.root.querySelector('[data-course-detail].is-open'), 'activity sheet is hidden during editing');
  assert.equal(f.root.querySelector('[data-course-detail] [data-course-work-panel]'),null);
  assert.equal(f.root.querySelectorAll('[aria-modal="true"]').length,1, 'only one modal is active');
  assert.equal(f.state.courseSchedulingSelectedId,activityId);

  f.root.querySelector('[data-manual-operation-close]').click();
  assert.equal(f.root.querySelector('[data-manual-operations-overlay]'),null);
  assert.equal(f.root.querySelector('.is-manual-editor-open'),null);
  assert.ok(f.root.querySelector('[data-course-detail].is-open'), 'activity sheet returns when the editor closes');
  assert.equal(f.state.courseSchedulingSelectedId,activityId);
  assert.equal(f.calls.filter(x=>x.name==='commit_scheduling_manual_assignment').length,0);
 } finally {f.close();}
});

test('Eden uses the enabled compact instructor editor with her own route acknowledgement', async () => {
 const requests=[];
 const f=ui({activityFields:{sessions:'1'},rpcImpl:async(name,args)=>{
  requests.push({name,args});
  if(name==='scheduling_manual_capabilities')return {data:{apiVersion:'manual-operations-v1',enabled:true,officialScheduleReadOnly:true}};
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
  f.root.querySelector('[data-manual-operation-save]').click();await settle();
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
  if(name==='scheduling_manual_capabilities')return {data:{apiVersion:'manual-operations-v1',enabled:true,officialScheduleReadOnly:true}};
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
  f.root.querySelector('[data-manual-operation-save]').click();await settle();
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

test('operator workboard precedes the operational instructor report',()=>{
 const f=ui();try{
  const list=f.root.querySelector('[data-course-list]');
  const summary=f.root.querySelector('.course-scheduling-summary');
  const report=f.root.querySelector('[data-planning-report]');
  assert.ok(summary&&list&&report);
  assert.ok(summary.compareDocumentPosition(list)&4);
  assert.ok(list.compareDocumentPosition(report)&4);
  assert.equal(f.root.querySelector('[data-planning-disclosure]'),null);
 }finally{f.close();}
});

test('refresh is part of filters and the daily workboard uses understandable statuses', () => {
 const f=ui();try{
  const scope=f.root.querySelector('.course-scheduling-scope');
  const refresh=f.root.querySelector('[data-refresh-assignment-data]');
  assert.ok(scope?.contains(refresh),'refresh is within the existing filter row');
  assert.equal(f.root.querySelector('.course-scheduling-operator-toolbar'),null);
  const labels=[...f.root.querySelectorAll('.course-scheduling-summary-card span')].map(el=>el.textContent.trim());
  assert.deepEqual(labels,['סה״כ','משובץ','ממתין לאישור','טרם שובץ']);
  assert.match(f.root.querySelector('[data-business-summary-filter="open"]').title,/טרם נשמר לה מדריך או טיוטת שיבוץ/);
  const row=f.root.querySelector('[data-course-card]');
  assert.ok(row);
  assert.equal(row.querySelector('.course-scheduling-compact-instructor').textContent.trim(),'—');
  assert.match(row.textContent,/טרם שובץ/);
  assert.equal(row.querySelector('.course-scheduling-school-context'),null);
  assert.equal(row.querySelector('.course-scheduling-workboard-alert'),null);
 }finally{f.close();}
});

test('the operational instructor report stays folded until requested',()=>{
 const f=ui();try{
  const report=f.root.querySelector('[data-planning-report]');
  assert.ok(report);
  assert.equal(report.open,false);
  assert.match(report.querySelector('summary').textContent,/שיבוצים קיימים לפי מדריכים/);
  assert.ok(report.querySelector('.course-planning-completion-table'));
  report.open=true;
  report.dispatchEvent(new window.Event('toggle'));
  f.render();
  assert.equal(f.root.querySelector('[data-planning-report]').open,true);
 }finally{f.close();}
});

test('selected activity opens in a dismissible sheet without altering the workboard or assignment',()=>{
 const f=ui();try{
  const screen=f.root.querySelector('.course-scheduling-screen');
  const list=f.root.querySelector('[data-course-list]');
  const detail=f.root.querySelector('[data-course-detail]');
  const close=detail.querySelector('[data-close-course-detail]');
  const count=list.querySelectorAll('[data-course-card]').length;
  assert.ok(screen.classList.contains('has-selected-course'));
  assert.equal(detail.classList.contains('is-open'),true);
  assert.ok(close);
  assert.equal(close.getAttribute('aria-label'),'סגור פרטי פעילות');
  close.click();
  assert.equal(f.state.courseSchedulingSelectedId,'');
  assert.equal(f.root.querySelector('[data-course-detail]').classList.contains('is-open'),false);
  assert.equal(f.root.querySelector('[data-course-list]').querySelectorAll('[data-course-card]').length,count);
  assert.equal(f.data.activities[0].emp_id,undefined);
  assert.equal(f.calls.filter(c=>c.name==='scheduling_dashboard_assignment').length,0);
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
   if(name==='scheduling_manual_capabilities')return {data:{apiVersion:'manual-operations-v1',enabled:true,officialScheduleReadOnly:true}};
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
  f.root.querySelector('[data-manual-operation-save]').click();await settle();
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

test('missing official-schedule server capability fails closed without opening legacy details', async()=>{
 const f=ui({rpcImpl:async name=>name==='scheduling_manual_capabilities'?{data:{apiVersion:'manual-operations-v1',enabled:true}}:{data:[]}});
 try{
  await settle(); f.state.courseSchedulingSelectedId='';f.render();
  f.root.querySelector('[data-open-manual-course]').click();
  assert.equal(f.root.querySelector('[data-manual-operations-overlay]'),null);
  assert.equal(f.root.querySelector('[data-course-detail].is-open'),null);
  assert.ok(!f.calls.some(c=>/manual_assignment|dashboard_candidates/.test(c.name)));
 }finally{f.close();}
});

test('stale activity reload reads only the requested activity and rechecks without automatically saving', async()=>{
 let reads=0,checks=0,writes=0;
 const oldFrom=supabase.from;
 const updated={...course,sessions:'1',date_1:'2026-11-08',start_date:'2026-11-08',updated_at:'2026-11-01T10:00:00Z'};
 const f=ui({rpcImpl:async name=>{
  if(name==='scheduling_manual_capabilities')return {data:{apiVersion:'manual-operations-v1',enabled:true,officialScheduleReadOnly:true}};
  if(name==='get_scheduling_manual_assignment_preview'){checks++;return {data:{previewHash:'new-check',blockers:[],warnings:[],reasonRequired:false}};}
  if(name==='commit_scheduling_manual_assignment'){writes++;return {error:{message:'scheduling_activity_revision_conflict'}};}
  return {data:[]};
 }});
 supabase.from=table=>{
  assert.equal(table,'activities');
  return {select(columns){assert.ok(!columns.includes('*'));return {eq(key,id){assert.equal(key,'row_id');assert.equal(id,course.row_id);return {async single(){reads++;return {data:updated};}};}};}};
 };
 try{
  await settle();f.root.querySelector('[data-open-manual-course]').click();chooseManual(f);await saveManual(f);
  assert.equal(reads,1);assert.equal(checks,2);assert.equal(writes,1);
  assert.equal(f.state.courseSchedulingManualOperation.activity.updated_at,updated.updated_at);
  assert.equal(f.state.courseSchedulingManualOperation.dates[0],'2026-11-08');
  assert.ok(f.root.querySelector('[data-manual-operations-overlay]'));
  assert.equal(f.state.courseSchedulingManualOperation.acknowledged,false);
 }finally{supabase.from=oldFrom;f.close();}
});
