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

test('an active blocking school holiday shifts the sequence without an instructor exception',()=>{
  const holidayMeetings=['2026-10-20','2026-10-27','2026-11-03'].map((date)=>({date,start_time:'10:00',end_time:'11:00'}));
  const result=proposeDateAdjustments({
    meetings:holidayMeetings,
    rules:[{weekday:2,available:true,start_time:'08:00',end_time:'15:00'}],
    schoolCalendar:[{start_date:'2026-10-27',end_date:'2026-10-27',blocks_scheduling:true,is_active:true}]
  });
  assert.equal(result?.valid,true);
  assert.deepEqual(result.meetings.map(x=>x.date),['2026-10-20','2026-11-03','2026-11-10']);
  assert.equal(result.meetings.length,holidayMeetings.length);
  assert.equal(result.meetings.some(x=>x.date==='2026-10-27'),false);
});

test('two consecutive blocking holidays skip two weeks and leave unaffected sequences unchanged',()=>{
  const holidayMeetings=['2026-10-20','2026-10-27','2026-11-03'].map((date)=>({date,start_time:'10:00',end_time:'11:00'}));
  const schoolCalendar=['2026-10-27','2026-11-03'].map((date)=>({start_date:date,end_date:date,blocks_scheduling:true,is_active:true}));
  const result=proposeDateAdjustments({meetings:holidayMeetings,rules:[{weekday:2,available:true,start_time:'08:00',end_time:'15:00'}],schoolCalendar});
  assert.deepEqual(result.meetings.map(x=>x.date),['2026-10-20','2026-11-10','2026-11-17']);
  assert.equal(result.meetings.length,holidayMeetings.length);
  assert.equal(proposeDateAdjustments({meetings:holidayMeetings,rules:[{weekday:2,available:true,start_time:'08:00',end_time:'15:00'}],schoolCalendar:[]}),null);
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

test('proposed overlaps fail and travel requires a known route plus 10 minute safety',()=>{
  const overlap=proposeDateAdjustments({meetings,rules,exceptions:blocked,existingActivities:[{date:'2027-01-17',start_time:'10:30',end_time:'11:30'}]});
  assert.equal(overlap.reason,'proposed_overlap');
  const unknown=proposeDateAdjustments({meetings,rules,exceptions:blocked,transitions:{'2027-01-17':{previous:{end_time:'09:00',duration_minutes:null,distance_km:null}}}});
  assert.equal(unknown.reason,'transition_unverified');
  const tooFar=proposeDateAdjustments({meetings,rules,exceptions:blocked,transitions:{'2027-01-17':{previous:{end_time:'09:00',duration_minutes:10,distance_km:21}}}});
  assert.equal(tooFar.reason,'transition_distance_exceeded');
  const short=proposeDateAdjustments({meetings,rules,exceptions:blocked,transitions:{'2027-01-17':{previous:{end_time:'09:41',duration_minutes:10,distance_km:20}}}});
  assert.equal(short.reason,'transition_insufficient');
  const exact=proposeDateAdjustments({meetings,rules,exceptions:blocked,transitions:{'2027-01-17':{previous:{end_time:'09:40',duration_minutes:10,distance_km:20}}}});
  assert.equal(exact.valid,true,'a 20-minute gap covers 10 minutes travel plus one 10-minute buffer');
  const missingMinute=proposeDateAdjustments({meetings,rules,exceptions:blocked,transitions:{'2027-01-17':{previous:{end_time:'09:41',duration_minutes:10,distance_km:20}}}});
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
  assert.match(sql,/scheduling_proposed_meeting_count_mismatch/);
  assert.match(sql,/scheduling_assert_proposed_eligibility/);
  const trigger=sql.split('create or replace function public.scheduling_guard_activity_calendar_write')[1].split('drop trigger if exists')[0];
  assert.match(trigger,/activity_season is distinct from 'school_2027'/);
  assert.match(trigger,/activity_type::text.*not in \('קורס','course','program'\)/s);
  assert.match(trigger,/status::text.*not in \('פתוח','open'\)/s);
  assert.match(trigger,/old\.emp_id_2 is distinct from new\.emp_id_2/);
  assert.match(trigger,/foreach holder in array holders/);
  assert.doesNotMatch(trigger,/holder:=coalesce/);
  assert.doesNotMatch(sql,/backfill|approval_override/i);
});

test('calendar-change migration shifts only affected open series and guards the five election-day rows',async()=>{
  const sql=await readFile(new URL('../supabase/migrations/20260820120000_shift_open_activity_series_after_calendar_block.sql',import.meta.url),'utf8');
  assert.match(sql,/sc\.is_active is true\s+and sc\.blocks_scheduling is true/s);
  assert.match(sql,/first_blocked\.\.(?:array_length|coalesce)/);
  assert.match(sql,/candidate := candidate \+ 7/);
  assert.match(sql,/start_date = \$36, end_date = \$37/);
  assert.match(sql,/lower\(btrim\(coalesce\(a\.status::text, ''\)\)\) in \('פתוח', 'open'\)/);
  assert.match(sql,/expected_5_open_activities_on_2026_10_27_found_/);
  assert.match(sql,/title = 'יום הבחירות לכנסת ה-26'/);
  assert.doesNotMatch(sql,/update public\.activities[\s\S]*?emp_id\s*=/);
});

test('SQL validation preserves the official meeting count and proposed-date eligibility gates',async()=>{
  const sql=await readFile(new URL('../supabase/migrations/20260807120000_course_scheduling_proposed_dates.sql',import.meta.url),'utf8');
  const validator=sql.split('create or replace function public.scheduling_validate_proposed_meetings')[1].split('revoke all on function public.scheduling_validate_proposed_meetings')[0];
  assert.match(validator,/generate_series\(1,35\).*official_count/s);
  assert.match(validator,/jsonb_array_length\(p_meetings\) <> official_count/);
  const eligibility=sql.split('create or replace function public.scheduling_assert_proposed_eligibility')[1].split('revoke all on function public.scheduling_assert_proposed_eligibility')[0];
  for(const gate of ['instructor_inactive','scheduling_instructor_profile_incomplete','scheduling_language_mismatch','scheduling_gender_mismatch','scheduling_friday_not_allowed','scheduling_instructor_unavailable']) assert.match(eligibility,new RegExp(gate));
  assert.match(eligibility,/instructor_availability_exceptions/);
  assert.match(eligibility,/instructor_availability_rules/);
  assert.match(eligibility,/nullif\(btrim\(coalesce\(profile\.gender,''\)\),''\) is null then raise exception 'scheduling_instructor_profile_incomplete'/);
  assert.match(eligibility,/required_instructor_gender.*in \('male','female'\)/s);
  const draftRpc=sql.split('create or replace function public.save_course_assignment_draft_with_dates')[1].split('create or replace function public.assign_activity_instructor_with_dates')[0];
  const assignRpc=sql.split('create or replace function public.assign_activity_instructor_with_dates')[1].split('create or replace function public.cancel_course_assignment_draft_with_dates')[0];
  assert.match(draftRpc,/activity_type::text.*scheduling_activity_not_course/s);
  assert.match(assignRpc,/activity_type::text.*scheduling_activity_not_course/s);
  assert.ok(assignRpc.indexOf('scheduling_activity_not_course')<assignRpc.indexOf('scheduling_set_activity_meetings'),'course type is checked before official dates change');
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
