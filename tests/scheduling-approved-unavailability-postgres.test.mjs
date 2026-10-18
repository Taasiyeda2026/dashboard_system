import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import pg from 'pg';

const url=process.env.SCHEDULING_UNAVAILABILITY_TEST_DATABASE_URL;
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');

test('verified unstaffed meetings on disposable PostgreSQL',{skip:!url},async()=>{
  const parsed=new URL(url);
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(parsed.hostname));
  const db=new pg.Client({connectionString:url});
  await db.connect();
  const q=async(sql,args=[])=> (await db.query(sql,args)).rows;
  try{
    await db.query(read('./fixtures/scheduling-approved-unavailability-pg.sql'));
    for(const file of [
      '20261018153000_scoped_permanent_availability_approval_core.sql',
      '20261018153100_confirm_permanent_unstaffed_availability.sql',
      '20261018153200_permanent_availability_dashboard_options.sql',
      '20261018153300_unstaffed_calendar_validation_and_integrity.sql',
      '20261018153400_keep_unstaffed_course_treatment_on_revalidation.sql'
    ])await db.query(read('../supabase/migrations/'+file));
    const manager='11111111-1111-4111-8111-111111111111';
    await db.query("select set_config('test.uid',$1,false),set_config('test.role','admin',false)",[manager]);
    await db.query("insert into public.users values($1,true)",[manager]);
    await db.query("insert into public.scheduling_agent_control values($1)",[manager]);
    await db.query("insert into public.contacts_instructors values(1550,'Liron','yes'),(2000,'Substitute','yes')");
    await db.query("insert into public.activities(row_id,start_time,end_time,date_1,date_2,date_3,date_4,date_5,date_6,emp_id,instructor_assignment_locked) values('course-a','10:00','11:00','2027-01-11','2027-01-18','2027-01-25','2027-02-01','2027-02-08','2027-02-15',null,false)");
    await db.query("insert into public.instructor_availability_exceptions(emp_id,exception_date,available) values (1550,'2027-01-18',false),(1550,'2027-01-25',false),(1550,'2027-02-01',false),(1550,'2027-02-08',false)");
    await assert.rejects(db.query("select public.scheduling_confirm_permanent_unavailability('course-a',1550,null)"),/scheduling_manager_approval_required/);
    await db.query("select public.scheduling_approve_permanent_unavailability('course-a',1550,'2027-01-17','2027-02-10','School approval for four unstaffed sessions')");
    assert.equal((await q("select (public.scheduling_confirm_permanent_unavailability('course-a',1550,null)).emp_id as id"))[0].id.toString(),'1550');
    const history=await q("select emp_id,assignment_kind from public.course_meeting_instructor_history where activity_id='course-a' order by meeting_date");
    assert.equal(history.length,4);
    assert.ok(history.every(x=>x.emp_id===''&&x.assignment_kind==='availability_blocked_pending'));
    assert.equal((await q("select public.scheduling_course_meeting_instructors('course-a')")) .length,6);
    assert.equal((await q("select public.scheduling_locked_course_validation_reason('course-a') v"))[0].v,'scheduling_blocked_meeting_pending');
    await assert.rejects(db.query("select public.scheduling_assert_proposed_eligibility('course-a',1550,jsonb_build_array(jsonb_build_object('date','2027-01-25')))"),/scheduling_instructor_unavailable/);
    await db.query("select public.set_course_meeting_substitute('course-a','2027-01-18',2000)");
    assert.equal((await q("select count(*)::int n from public.course_meeting_instructor_history where activity_id='course-a' and assignment_kind='availability_blocked_pending'"))[0].n,3);
    await db.query("select public.clear_course_meeting_substitute('course-a','2027-01-18')");
    assert.equal((await q("select count(*)::int n from public.course_meeting_instructor_history where activity_id='course-a' and assignment_kind='availability_blocked_pending'"))[0].n,4);
    assert.equal((await q("select count(*)::int n from public.instructor_availability_exceptions where emp_id=1550 and available=false"))[0].n,4);
  }finally{await db.end();}
});
