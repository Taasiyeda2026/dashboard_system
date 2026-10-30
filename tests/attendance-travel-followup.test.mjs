import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { applyAttendanceDayRouteKilometers, applyDashboardRouteKilometers } from '../frontend/src/screens/attendance-control.js';

const container=process.env.ATTENDANCE_TRAVEL_FOLLOWUP_TEST_CONTAINER;
if(container && container!=='attendance-travel-followup-test') throw new Error('Use the disposable attendance-travel-followup-test container');
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
const migration=await read('supabase/migrations/20261030203143_attendance_travel_followup.sql')+'\n'+await read('supabase/migrations/20261030210018_attendance_control_resolved_course_meetings.sql');
const sql=q=>execFileSync('docker',['--host=unix:///var/run/docker.sock','exec','-i',container,'psql','-X','-Atq','-v','ON_ERROR_STOP=1','-U','postgres','-d','codex_attendance_travel_followup'],{input:q,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const json=q=>JSON.parse(sql(q));
const enabled=t=>{if(container)return true;t.skip('Set ATTENDANCE_TRAVEL_FOLLOWUP_TEST_CONTAINER to the disposable local container');return false;};
const definition=(source,name,schema='public')=>source.match(new RegExp('create or replace function '+schema+'\\.'+name+'\\([\\s\\S]*?\\bas\\s+(\\$\\w*\\$)[\\s\\S]*?\\1\\s*;','i'))[0];
const id='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
let unchanged,aclBefore;
const snapshot=()=>sql(`select jsonb_build_array(
 (select jsonb_agg(to_jsonb(a) order by id) from attendance_records a),
 (select jsonb_agg(to_jsonb(c) order by source_attendance_record_id) from attendance_travel_compensations c),
 (select jsonb_agg(to_jsonb(p)) from payroll_control_approvals p),
 (select jsonb_agg(to_jsonb(c) order by origin_key,destination_key) from scheduling_travel_cache c))`);
before(async()=>{
 if(!container)return;
 execFileSync('docker',['--host=unix:///var/run/docker.sock','exec',container,'dropdb','--if-exists','--force','-U','postgres','codex_attendance_travel_followup']);
 execFileSync('docker',['--host=unix:///var/run/docker.sock','exec',container,'createdb','-U','postgres','codex_attendance_travel_followup']);
 sql(await read('tests/fixtures/attendance-travel-2523.sql'));
 sql(await read('tests/fixtures/attendance-travel-followup.sql'));
 const course=await read('supabase/migrations/20261006024731_attendance_course_date_assignment_guard.sql');
 for(const n of ['instructor_rows_for_date','course_identity','course_sources'])sql(definition(course,n,'attendance_private'));
 sql(definition(await read('supabase/migrations/20261030192830_attendance_travel_save_and_control_fixes.sql'),'get_payroll_attendance_location_contexts'));
 sql(definition(await read('supabase/migrations/20260926203000_manager_attendance_review_snapshot.sql'),'get_manager_attendance_review_snapshot'));
 sql(`revoke all on function get_payroll_attendance_location_contexts(bigint[],date,date),get_manager_attendance_review_snapshot(bigint,text) from public,anon;
 grant execute on function get_payroll_attendance_location_contexts(bigint[],date,date),get_manager_attendance_review_snapshot(bigint,text) to authenticated;
 insert into attendance_records(id,emp_id,report_date,roundtrip_km,total_hours) values('${id}',1,'2026-10-25',88,2);
 insert into attendance_travel_compensations(source_attendance_record_id,emp_id,review_status,final_cancellation_minutes,approved_cancellation_minutes)
 values('${id}',1,'approved',45,45);
 insert into payroll_control_approvals values('1','2026-10','approved_for_payroll','2026-10-29');
 insert into scheduling_travel_cache(origin_key,destination_key,distance_km)values('home','school',26.522);`);
 aclBefore=sql("select proacl::text from pg_proc where oid='get_manager_attendance_review_snapshot(bigint,text)'::regprocedure");
 const before=snapshot();sql(migration);unchanged=before===snapshot();
});
beforeEach(()=>{
 if(!container)return;
 sql(`truncate attendance_records,attendance_travel_compensations,activities,contacts_schools,schools,
 contacts_instructors,scheduling_travel_cache,course_meeting_instructor_history,course_meeting_cancellations,payroll_control_approvals;
 update users set role='admin'; reset test.actor;
 insert into contacts_instructors(emp_id,address,full_name)values(1,'home','Guide');
 insert into schools(id,school_name,institution_address)values(10,'School','school');
 insert into activities(row_id,id,emp_id,school_id,activity_no,activity_name,date_1,start_time,end_time,grade,class_group)
 values('ACT-1',101,1,10,'old','Program','2026-10-25','08:00','10:00','A','1');
 insert into attendance_records(id,emp_id,report_date,start_time,activity_type,activity_row_id,school_id,roundtrip_km,course_business_identity,course_dashboard_sources)
 values('${id}',1,'2026-10-25','08:00','קורס','ACT-1',10,88,'["Program",["id","10"]]',
 attendance_private.course_sources(1,'2026-10-25','["Program",["id","10"]]'));`);
});
const context=()=>json(`select av2_attendance_travel_context('${id}',auth.uid())`);
const cache=()=>json(`select get_payroll_attendance_route_cache(array[1::bigint],'2026-10-01','2026-10-31')`);
const manager=()=>json("select get_manager_attendance_review_snapshot(1,'2026-10')");

test('definition-only migration preserves reports, approvals, payroll, cache and existing RPC grants',t=>{
 if(!enabled(t))return;
 assert.equal(unchanged,true);
 assert.equal(sql("select proacl::text from pg_proc where oid='get_manager_attendance_review_snapshot(bigint,text)'::regprocedure"),aclBefore);
 for(const sig of ['get_payroll_attendance_route_cache(bigint[],date,date)','get_payroll_attendance_location_contexts(bigint[],date,date)','get_payroll_attendance_course_activities(bigint[],date,date)']){
  assert.equal(sql("select has_function_privilege('anon','"+sig+"','execute')"),'f');
  assert.equal(sql("select has_function_privilege('authenticated','"+sig+"','execute')"),'t');
 }
});
test('one school address is shared by time context and control despite multiple contacts',t=>{
 if(!enabled(t))return;
 sql("insert into contacts_schools values(10,'z contact'),(10,'a contact'),(10,''); update schools set route_verified_address='verified school';");
 assert.equal(context().destination_address,'verified school');
 let loc=json(`select jsonb_agg(l)from get_payroll_attendance_location_contexts(array[1::bigint],'2026-10-01','2026-10-31')l`);
 assert.equal(loc.length,1);assert.equal(loc[0].destination_address,'verified school');
 sql("update schools set route_verified_address=null");assert.equal(context().destination_address,'school');
 sql("update schools set institution_address=null");assert.equal(context().destination_address,'a contact');
 sql("update attendance_records set destination_address_snapshot='explicit venue'");
 assert.equal(context().destination_address,'explicit venue');
 loc=json(`select jsonb_agg(l)from get_payroll_attendance_location_contexts(array[1::bigint],'2026-10-01','2026-10-31')l`);
 assert.equal(loc.length,1);assert.equal(loc[0].destination_address,'explicit venue');
});
test('historical course survives display changes and reassignment with valid meeting history',t=>{
 if(!enabled(t))return;
 const before=sql("select course_dashboard_sources::text||'/'||roundtrip_km from attendance_records");
 sql("update activities set activity_no='new',grade='B',class_group='2',start_time='08:15',end_time='09:45',emp_id=2; insert into course_meeting_instructor_history values('ACT-1','2026-10-25','1');");
 assert.equal(context().eligible,true);
 assert.equal(sql("select course_dashboard_sources::text||'/'||roundtrip_km from attendance_records"),before);
});
test('changed school, meeting, source, assignment, cancellation or program still invalidates course context',t=>{
 if(!enabled(t))return;
 for(const mutation of [
  "update attendance_records set school_id=20",
  "update activities set date_1='2026-10-26'",
  "update attendance_records set course_dashboard_sources=jsonb_set(course_dashboard_sources,'{0,row_id}',to_jsonb('OTHER'::text))",
  "update activities set emp_id=2",
  "insert into course_meeting_cancellations values('ACT-1','2026-10-25')",
  "update activities set activity_name='Different program'",
  "update attendance_records set course_dashboard_sources='[]'",
 ]){
  assert.equal(json(`begin;${mutation};select av2_attendance_travel_context('${id}',auth.uid());rollback;`).eligible,false,mutation);
 }
});
test('Liron: both controls load the address-only reverse without rewriting a zero claim',t=>{
 if(!enabled(t))return;
 sql(`update attendance_records set roundtrip_km=0;
 insert into scheduling_travel_cache(origin_key,destination_key,origin_address,destination_address,distance_km,origin_instructor_emp_id,destination_school_id)
 values('home','school','home','school',26.522,1,10);
 insert into scheduling_travel_cache(origin_key,destination_key,origin_address,destination_address,distance_km)
 values('school','home','school','home',12.339);`);
 const before=snapshot(),central=cache(),embedded=manager().travel_cache;
 assert.deepEqual(embedded,central);assert.equal(central.length,2);
 for(const routes of [central,embedded]){
  const rows=[{employeeId:'1',date:'2026-10-25',activityId:'ACT-1',schoolId:10}];
  applyAttendanceDayRouteKilometers(rows,[{employeeId:'1',date:'2026-10-25',activityId:'ACT-1',activityType:'קורס',originAddress:'home',destinationAddress:'school',destinationEntityKey:'school_id:10'}],routes);
  assert.equal(rows[0].kilometers,38.86);
 }
 assert.equal(snapshot(),before);
});
test('Ilana: verified directions replace the quarantined raw alias in both control paths',t=>{
 if(!enabled(t))return;
 sql(`update schools set route_verified_address='verified school';
 insert into contacts_schools values(10,'school with city');
 insert into scheduling_travel_cache(origin_key,destination_key,origin_address,destination_address,distance_km,location_suspect,origin_school_id,destination_school_id,origin_instructor_emp_id,origin_entity_key,destination_entity_key)
 values('school','home','school','home',131.116,true,null,null,null,null,null),
 ('home','verified school','home','verified school',2.845,false,null,10,1,'instructor:1','school_id:10'),
 ('verified school','home','verified school','home',2.758,false,10,null,null,'school_id:10','instructor:1');`);
 const before=snapshot();
 for(const routes of [cache(),manager().travel_cache]){
  const rows=[{employeeId:'1',date:'2026-10-25',activityId:'ACT-1',schoolId:10}];
  applyAttendanceDayRouteKilometers(rows,[{employeeId:'1',date:'2026-10-25',activityId:'ACT-1',activityType:'קורס',originAddress:'home',destinationAddress:'verified school',destinationEntityKey:'school_id:10'}],routes);
  assert.equal(rows[0].kilometers,5.6);
 }
 assert.equal(snapshot(),before);
});
test('legacy city aliases acquire identity only in the response; planned-school coverage remains',t=>{
 if(!enabled(t))return;
 sql(`update schools set route_verified_address='school verified';
 insert into contacts_schools values(10,'school with city');
 insert into schools(id,school_name,institution_address)values(20,'Second','next');
 insert into activities(row_id,id,emp_id,school_id,date_1)values('ACT-2',102,1,20,'2026-10-25');
 insert into scheduling_travel_cache(origin_key,destination_key,origin_address,destination_address,distance_km)
 values('school with city','next','school with city','next',14.787);`);
 const r=cache().find(x=>x.distance_km===14.787);
 assert.equal(r.origin_entity_key,'school_id:10');assert.equal(r.destination_entity_key,'school_id:20');
 assert.equal(sql("select origin_entity_key is null and destination_school_id is null from scheduling_travel_cache"),'t');
 assert.deepEqual(manager().travel_cache,cache());
 sql("insert into schools(id,institution_address)values(30,'school with city')");
 assert.equal(cache().find(x=>x.distance_km===14.787).origin_entity_key,null);
});
test('cache reader rejects anonymous access and cannot expand employee scope through shared schools',t=>{
 if(!enabled(t))return;
 sql(`insert into contacts_instructors(emp_id,address,direct_manager)values(2,'private-home','Other');
 insert into attendance_records(id,emp_id,report_date,school_id)values('${other}',2,'2026-10-25',10);
 insert into scheduling_travel_cache(origin_key,destination_key,origin_address,destination_address,distance_km)
 values('private-home','school','private-home','school',99),
 ('private-home','shared venue','private-home','shared venue',88);
 update attendance_records set destination_address_snapshot='shared venue' where emp_id=1;
 update users set role='manager';`);
 assert.deepEqual(cache(),[]);
 assert.equal(sql("select jsonb_array_length(get_payroll_attendance_route_cache(array[2::bigint],'2026-10-01','2026-10-31'))"),'0');
 assert.throws(()=>sql("set test.actor='none';select get_payroll_attendance_route_cache(null,null,null)"),/payroll_attendance_auth_required/);
});
test('dated course source honors historical and secondary assignments, cancellations and access scope',t=>{
 if(!enabled(t))return;
 const planned=()=>json("select get_payroll_attendance_course_activities(array[1::bigint],'2026-10-01','2026-10-31')");
 sql("update activities set emp_id=2; insert into course_meeting_instructor_history values('ACT-1','2026-10-25','1')");
 const before=snapshot(),rows=planned();
 assert.equal(rows.length,1);assert.equal(rows[0].emp_id,1);
 assert.equal(rows[0].meetings[0].date,'2026-10-25');
 assert.equal(rows[0].school_id,10);
 assert.deepEqual(manager().course_activities,rows);
 assert.equal(snapshot(),before);
 sql("truncate course_meeting_instructor_history; update activities set emp_id_2='1'");
 assert.equal(planned().length,1);
 sql("insert into course_meeting_cancellations values('ACT-1','2026-10-25')");
 assert.deepEqual(planned(),[]);
 assert.equal(sql("select jsonb_array_length(get_payroll_attendance_course_activities(array[2::bigint],'2026-10-01','2026-10-31'))"),'0');
 assert.throws(()=>sql("set test.actor='none';select get_payroll_attendance_course_activities(null,null,null)"),/payroll_attendance_auth_required/);
});
test('route cache returns one JSON value beyond the PostgREST row limit',t=>{
 if(!enabled(t))return;
 sql("insert into scheduling_travel_cache(origin_key,destination_key,origin_address,destination_address,distance_km) select 'home','school-'||n,'home','school-'||n,1 from generate_series(1,1001)n");
 assert.equal(cache().length,1001);
 assert.equal(sql("select proretset from pg_proc where oid='get_payroll_attendance_route_cache(bigint[],date,date)'::regprocedure"),'f');
});
test('suspect segments cannot contribute or hide behind symmetric fallback',()=>{
 const report={employeeId:'1',date:'2026-10-25',activityId:'ACT-1',activityType:'קורס',originAddress:'home',destinationAddress:'school',destinationEntityKey:'school_id:10'};
 for(const badSide of ['out','return']){
  const rows=[{employeeId:'1',date:'2026-10-25',activityId:'ACT-1',schoolId:10}];
  applyAttendanceDayRouteKilometers(rows,[report],[
   {origin_address:'home',destination_address:'school',distance_km:2.845,location_suspect:badSide==='out'},
   {origin_address:'school',destination_address:'home',distance_km:131.116,location_suspect:badSide==='return'}]);
  assert.equal(rows[0].kilometers,null,badSide);
 }
 const planned=[{employeeId:'1',date:'2026-10-25',schoolId:10},{employeeId:'1',date:'2026-10-25',schoolId:20}];
 applyDashboardRouteKilometers(planned,[
  {origin_instructor_emp_id:1,destination_school_id:10,distance_km:10},
  {origin_instructor_emp_id:1,destination_school_id:20,distance_km:20},
  {origin_school_id:10,destination_school_id:20,distance_km:99,location_suspect:true}]);
 assert.deepEqual(planned.map(x=>x.kilometers),[null,null]);
});
