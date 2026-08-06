import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { proposeDateAdjustments } from '../frontend/src/screens/course-scheduling-date-adjustments.js';

const meetings = ['2027-01-03','2027-01-10','2027-01-17'].map((date)=>({date,start_time:'10:00',end_time:'11:00'}));
const rules = [{weekday:0,available:true,start_time:'08:00',end_time:'15:00'}];
const blocked = [{exception_date:'2027-01-10',available:false}];

test('an available=false exception proposes the next weekly dates and leaves the activity input untouched',()=>{
  const original=structuredClone(meetings);
  const result=proposeDateAdjustments({meetings,rules,exceptions:blocked});
  assert.equal(result.valid,true); assert.equal(result.label,'מתאים בכפוף להתאמת מועדים');
  assert.deepEqual(result.meetings.map(x=>x.date),['2027-01-03','2027-01-17','2027-01-24']);
  assert.equal(result.movedCount,2); assert.deepEqual(meetings,original);
});

test('a narrower exception proposes an adjustment even though regular weekly availability covers the meeting',()=>{
  const result=proposeDateAdjustments({meetings,rules,exceptions:[{exception_date:'2027-01-10',available:true,start_time:'10:30',end_time:'12:00'}]});
  assert.equal(result?.valid,true);
  assert.deepEqual(result.meetings.map(x=>x.date),['2027-01-03','2027-01-17','2027-01-24']);
});

test('an exception that expands availability and covers the meeting does not create an adjustment',()=>{
  const result=proposeDateAdjustments({meetings,rules,exceptions:[{exception_date:'2027-01-10',available:true,start_time:'07:00',end_time:'17:00'}]});
  assert.equal(result,null);
});

test('holidays and another instructor exception are skipped without an arbitrary meeting limit',()=>{
  const many=Array.from({length:35},(_,i)=>({date:new Date(Date.UTC(2027,0,3+i*7)).toISOString().slice(0,10),start_time:'10:00',end_time:'11:00'}));
  const result=proposeDateAdjustments({meetings:many,rules,exceptions:[...blocked,{exception_date:'2027-01-17',available:false}],schoolCalendar:[{start_date:'2027-01-24',end_date:'2027-01-24',blocks_scheduling:true,is_active:true}]});
  assert.equal(result.valid,true); assert.equal(result.meetings[1].date,'2027-01-31'); assert.equal(result.meetings.length,35);
});

test('proposed overlaps fail and travel requires a known route plus 15 minute safety',()=>{
  const overlap=proposeDateAdjustments({meetings,rules,exceptions:blocked,existingActivities:[{date:'2027-01-17',start_time:'10:30',end_time:'11:30'}]});
  assert.equal(overlap.reason,'proposed_overlap');
  const unknown=proposeDateAdjustments({meetings,rules,exceptions:blocked,transitions:{'2027-01-17':{previous:{end_time:'09:00',duration_minutes:null}}}});
  assert.equal(unknown.reason,'transition_unverified');
  const short=proposeDateAdjustments({meetings,rules,exceptions:blocked,transitions:{'2027-01-17':{previous:{end_time:'09:40',duration_minutes:10}}}});
  assert.equal(short.reason,'transition_insufficient');
  const exact=proposeDateAdjustments({meetings,rules,exceptions:blocked,transitions:{'2027-01-17':{previous:{end_time:'09:35',duration_minutes:10}}}});
  assert.equal(exact.valid,true,'a 25-minute gap covers 10 minutes travel plus one 15-minute buffer');
  const missingMinute=proposeDateAdjustments({meetings,rules,exceptions:blocked,transitions:{'2027-01-17':{previous:{end_time:'09:36',duration_minutes:10}}}});
  assert.equal(missingMinute.reason,'transition_insufficient');
});

test('half overflow is an explicit warning state, not a separate approval field',()=>{
  const result=proposeDateAdjustments({meetings,rules,exceptions:blocked,halfEnd:'2027-01-20'});
  assert.equal(result.exceedsHalf,true);
});

test('migration stores draft proposals separately and applies dates atomically through RPC transactions',async()=>{
  const sql=await readFile(new URL('../supabase/migrations/20260807120000_course_scheduling_proposed_dates.sql',import.meta.url),'utf8');
  assert.match(sql,/draft_proposed_meetings jsonb/);
  assert.match(sql,/save_course_assignment_draft_with_dates/);
  assert.match(sql,/assign_activity_instructor_with_dates/);
  assert.match(sql,/cancel_course_assignment_draft_with_dates/);
  assert.match(sql,/for update/);
  assert.match(sql,/school_calendar.*blocks_scheduling/s);
  assert.match(sql,/set draft_proposed_meetings=null/);
  assert.match(sql,/scheduling_validate_proposed_meetings/);
  assert.doesNotMatch(sql.split('create or replace function public.save_course_assignment_draft_with_dates')[1].split('create or replace function public.assign_activity_instructor_with_dates')[0],/scheduling_set_activity_meetings/);
  assert.match(sql,/scheduling_proposed_hours_mismatch/);
  assert.match(sql,/required_minutes \+ 15/);
  assert.match(sql,/scheduling_transition_unverified/);
  assert.match(sql,/scheduling_daily_sequence_exceeded/);
  assert.match(sql,/scheduling_effective_meetings\(a,p_emp_id\)/);
  assert.match(sql,/create trigger activities_guard_effective_scheduling_calendar/);
  assert.doesNotMatch(sql,/backfill|approval_override/i);
});

test('final half overflow confirmation happens before RPC and draft payloads contain dates only',async()=>{
  const screen=await readFile(new URL('../frontend/src/screens/course-scheduling.js',import.meta.url),'utf8');
  assert.match(screen,/שמירת טיוטה אינה מאשרת את החריגה/);
  assert.match(screen,/מסתיימים בתאריך/);
  assert.match(screen,/meetings\?\.map\(\(\{ date \}\) => \(\{ date \}\)\)/);
  const approval=screen.slice(screen.lastIndexOf("detailRoot.querySelector('[data-assign-course]')"),screen.lastIndexOf("detailRoot.querySelector('[data-save-draft]')"));
  assert.ok(approval.indexOf('window.confirm(approvalMessage)') < approval.indexOf('supabase.rpc('));
  const draftApproval=screen.slice(screen.lastIndexOf("detailRoot.querySelector('[data-confirm-draft]')"),screen.lastIndexOf("detailRoot.querySelector('[data-cancel-draft]')"));
  assert.ok(draftApproval.indexOf('window.confirm(approvalMessage)') < draftApproval.indexOf('supabase.rpc('));
});
