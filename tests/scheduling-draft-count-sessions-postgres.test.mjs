import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {describeSchedulingSnapshot} from '../supabase/functions/scheduling-agent-team-gateway/diagnostics.mjs';

const dates=['2026-11-22','2026-11-29','2026-12-06','2026-12-13','2026-12-20',
 '2027-01-10','2027-01-17','2027-01-24','2027-01-31','2027-02-07'];
const proposed=dates.map(date=>({date}));
const dbUrl=process.env.DRAFT_COUNT_TEST_DATABASE_URL;
const migration=readFileSync(new URL('../supabase/migrations/20261018112000_fix_course_draft_sessions_count.sql',import.meta.url),'utf8');

test('new validator is based on sessions, not populated official dates',()=>{
 assert.match(migration,/required_count := sessions_text::integer/);
 assert.match(migration,/jsonb_array_length\(p_meetings\) <> required_count/);
 assert.match(migration,/official_count > 0 and official_count <> required_count/);
 assert.match(migration,/scheduling_existing_official_meetings_protected/);
 assert.match(migration,/scheduling_activity_sessions_invalid/);
 assert.doesNotMatch(migration,/jsonb_array_length\(p_meetings\) <> official_count/);
});
test('complete staged draft is not treated as a missing official calendar',()=>{
 const snap=describeSchedulingSnapshot({rows:[{
  activityId:'narat',startDate:null,endDate:null,startTime:'12:00',endTime:'14:00',
  sessions:'10',draftInstructorId:'1528',draftMeetingCount:10
 }]});
 assert.deepEqual(snap.rows[0].readiness.missing,[]);
 assert.equal(snap.rows[0].readiness.complete,true);
 assert.equal(snap.rows[0].readiness.requiredMeetingCount,10);
 assert.equal(snap.rows[0].readiness.officialDatesStillEmpty,true);
});
test('frontend separates period-overflow acknowledgement from final instructor confirmation',()=>{
 const html=readFileSync(new URL('../frontend/src/screens/course-scheduling.js',import.meta.url),'utf8');
 assert.match(html,/dateOverflowAcknowledged/);
 assert.match(html,/אישור מנהל לחריגת מדריך אינו בהכרח אישור לחריגת מחצית/);
 assert.match(html,/draftCount !== requestedCount/);
 assert.match(html,/if \(!window\.confirm\(approvalMessage\)\) return false/);
});
test('agent keeps an existing draft and does not retry failed writes',()=>{
 const gate=readFileSync(new URL('../supabase/functions/scheduling-agent-team-gateway/index.ts',import.meta.url),'utf8');
 assert.match(gate,/scheduling_agent_team_read_staged_schedule/);
 assert.match(gate,/meetingCountDetails/);
 assert.match(gate,/retrySameRequest:false/);
 const docs=readFileSync(new URL('../docs/SCHEDULING_AGENT_TEAM_ACTIONABLE_WORKFLOW.md',import.meta.url),'utf8');
 assert.match(docs,/sessions=10/);
 assert.match(docs,/2027-02-07/);
});

test('PostgreSQL: full lifecycle against disposable isolated database',{skip:!dbUrl},async t=>{
 const parsed=new URL(dbUrl);
 assert.ok(['localhost','127.0.0.1','[::1]'].includes(parsed.hostname),
  'Never point acceptance tests at live Supabase');
 const db=new pg.Client({connectionString:dbUrl});
 await db.connect();
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const stamp='2026-10-18T10:30:55Z';
 const modified='2026-10-18T10:31:55Z';
 const owner='11111111-1111-4111-8111-111111111111';
 async function makeCourse(id,count='10',options={}){
  const vals=[
   id,count,options.draft===false?null:'1528',
   options.draft===false?null:'Rinat Dahan',
   options.draft===false?null:JSON.stringify(options.proposed||proposed),
   options.draft===false?null:owner,options.draft===false?null:stamp,modified,
   options.emp??null,options.locked??false
  ];
  await q('insert into public.activities (row_id,sessions,draft_emp_id,draft_instructor_name,draft_proposed_meetings,draft_created_by,draft_created_at,updated_at,emp_id,instructor_assignment_locked) values ($1,$2,$3,$4,$5::jsonb,$6,$7::timestamptz,$8::timestamptz,$9,$10)',vals);
  await q('insert into public.test_guard(activity_id,fail_code,approval_status) values($1,$2,$3)',
   [id,options.failCode??null,options.approval??'approved']);
 }
 const validate=(id,m)=>db.query('select public.scheduling_validate_proposed_meetings($1,$2::jsonb) v',[id,JSON.stringify(m)]);
 try{
  await db.query(readFileSync(new URL('./fixtures/draft-session-count-postgres.sql',import.meta.url),'utf8'));
  await db.query(migration);
  await db.query("select set_config('test.uid',$1,false),set_config('test.role','admin',false)",[owner]);
  await db.query('insert into public.users values($1,true)',[owner]);
  await db.query("insert into public.contacts_instructors values(1528,'Rinat Dahan','yes')");
  await t.test('10/10 passes even with all 35 official date fields NULL',async()=>{
   await makeCourse('case-10');
   const result=(await validate('case-10',proposed)).rows[0].v;
   assert.equal(result.length,10);
   assert.equal(result[9].date,'2027-02-07');
   const live=(await q("select date_1,date_10,emp_id,draft_emp_id from activities where row_id='case-10'"))[0];
   assert.equal(live.date_1,null);
   assert.equal(live.date_10,null);
   assert.equal(live.emp_id,null);
   assert.equal(live.draft_emp_id,'1528');
  });
  await t.test('9 and 11 proposed meetings are each rejected',async()=>{
   await assert.rejects(validate('case-10',proposed.slice(0,9)),/scheduling_proposed_meeting_count_mismatch/);
   await assert.rejects(validate('case-10',[...proposed,{date:'2027-02-14'}]),/scheduling_proposed_meeting_count_mismatch/);
  });
  await t.test('missing or malformed sessions never becomes zero',async()=>{
   await makeCourse('case-null',null,{draft:false});
   await assert.rejects(validate('case-null',proposed),/scheduling_activity_sessions_invalid/);
   await makeCourse('case-bad','unknown',{draft:false});
   await assert.rejects(validate('case-bad',proposed),/scheduling_activity_sessions_invalid/);
  });
  await t.test('officially dated calendar consistency and protection',async()=>{
   await makeCourse('case-official','10',{draft:false});
   const save='update activities set '+dates.map((d,i)=>'date_'+(i+1)+"='"+d+"'").join(',')+
    " ,start_date='2026-11-22',end_date='2027-02-07' where row_id='case-official'";
   await db.query(save);
   await assert.rejects(db.query(
    "select public.assign_activity_instructor_with_dates('case-official',1528,'Rinat Dahan',$1::jsonb,null,null,null,'approved',null)",
    [JSON.stringify([{date:'2026-11-15'},...proposed.slice(1)])]
   ),/scheduling_existing_official_meetings_protected/);
   assert.equal((await q("select date_1 from activities where row_id='case-official'"))[0].date_1.toISOString().slice(0,10),'2026-11-22');
   await db.query("update activities set date_10=null where row_id='case-official'");
   await assert.rejects(validate('case-official',proposed),/scheduling_existing_official_meeting_count_conflict/);
  });
  await t.test('dashboard confirms approved draft, committing dates and instructor atomically',async()=>{
   await q("select public.assign_activity_instructor_with_dates('case-10',1528,'Rinat Dahan',$1::jsonb,null,null,null,'approved',null)",[JSON.stringify(proposed)]);
   const a=(await q("select emp_id,date_1,date_10,draft_emp_id,draft_proposed_meetings,instructor_assignment_locked from activities where row_id='case-10'"))[0];
   assert.equal(Number(a.emp_id),1528);
   assert.equal(a.date_1.toISOString().slice(0,10),'2026-11-22');
   assert.equal(a.date_10.toISOString().slice(0,10),'2027-02-07');
   assert.equal(a.draft_proposed_meetings,null);
   assert.equal(a.draft_emp_id,null);
   assert.equal(a.instructor_assignment_locked,true);
  });
  await t.test('server rejects a locked assignment and protects its official dates',async()=>{
   await assert.rejects(db.query(
    "select public.assign_activity_instructor_with_dates('case-10',1528,'Rinat Dahan',$1::jsonb,null,null,null,'approved',null)",[JSON.stringify(proposed)]
   ),/scheduling_assignment_locked/);
   assert.equal(Number((await q("select emp_id from activities where row_id='case-10'"))[0].emp_id),1528);
  });
  await t.test('failed instructor conflict rolls back every official date write',async()=>{
   await makeCourse('case-conflict','10',{failCode:'scheduling_conflict_detected'});
   await assert.rejects(db.query(
    "select public.assign_activity_instructor_with_dates('case-conflict',1528,'Rinat Dahan',$1::jsonb,null,null,null,'approved',null)",[JSON.stringify(proposed)]
   ),/scheduling_conflict_detected/);
   const a=(await q("select emp_id,date_1,date_10,draft_emp_id from activities where row_id='case-conflict'"))[0];
   assert.equal(a.emp_id,null);assert.equal(a.date_1,null);assert.equal(a.date_10,null);assert.equal(a.draft_emp_id,'1528');
  });
  await t.test('agent first refuses missing manager approval and keeps draft untouched',async()=>{
   await makeCourse('case-agent','10',{approval:'pending'});
   await assert.rejects(db.query(
    "select public.scheduling_agent_team_confirm_own_draft('case-agent')"
   ),/scheduling_manager_approval_required/);
   assert.equal((await q("select date_1 from activities where row_id='case-agent'"))[0].date_1,null);
   await db.query("update test_guard set approval_status='approved' where activity_id='case-agent'");
   const out=(await q("select public.scheduling_agent_team_confirm_own_draft('case-agent') result"))[0].result;
   assert.equal(Number(out.instructorId),1528);
   assert.equal((await q("select date_10 from activities where row_id='case-agent'"))[0].date_10.toISOString().slice(0,10),'2027-02-07');
  });
  await t.test('agent group confirms one approved staged draft without preliminary official writes',async()=>{
   await makeCourse('case-batch');
   const item={activityId:'case-batch',draftCreatedAt:stamp,activityUpdatedAt:modified};
   const out=(await q("select public.scheduling_agent_team_confirm_schedule_batch($1::jsonb) result",[JSON.stringify([item])]))[0].result;
   assert.equal(out.allOrNothing,true);
   assert.equal((await q("select date_1,date_10 from activities where row_id='case-batch'"))[0].date_10.toISOString().slice(0,10),'2027-02-07');
  });
  await t.test('atomic group rollback restores earlier course if a later course fails',async()=>{
   await makeCourse('case-group-first');
   await makeCourse('case-group-second','10',{failCode:'scheduling_conflict_detected'});
   const items=['case-group-first','case-group-second'].map(id=>({activityId:id,draftCreatedAt:stamp,activityUpdatedAt:modified}));
   await assert.rejects(db.query("select public.scheduling_agent_team_confirm_schedule_batch($1::jsonb)",[JSON.stringify(items)]),/scheduling_agent_batch_item_failed/);
   const rows=await q("select row_id,date_1,emp_id from activities where row_id like 'case-group-%' order by row_id");
   assert.equal(rows.length,2);assert.ok(rows.every(a=>a.date_1===null&&a.emp_id===null));
  });
  await t.test('read-only staged schedule exposes required, draft, official counts',async()=>{
   const result=(await q("select public.scheduling_agent_team_read_staged_schedule('case-conflict') data"))[0].data;
   assert.equal(result.requiredMeetingCount,'10');
   assert.equal(result.draftMeetingCount,10);
   assert.equal(result.officialMeetingCount,0);
  });
 }finally{await db.end();}
});
