import test, {before, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
import {isUsableCachedRoute} from '../supabase/functions/_shared/travel-cache-contract.js';
import {buildCorrectedAttendanceWorkbook} from '../frontend/src/screens/attendance-control.js';
import * as XLSX from 'xlsx';

// Opt-in only; fixed local daemon, disposable DB, synthetic data, no URLs or secrets.
const container=process.env.ATTENDANCE_TRAVEL_DELETE_TEST_CONTAINER;
if(container && container!=='attendance-travel-delete-test')throw new Error('Use attendance-travel-delete-test only');
const docker=['--host=unix:///var/run/docker.sock'];
const env={...process.env};
for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[key];
const run=(args,input)=>execFileSync('docker',[...docker,...args],{input,env,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const db='codex_attendance_daily_delete_test';
const sql=input=>run(['exec','-i',container,'psql','-U','postgres','-d',db,'-X','-Atq','-v','ON_ERROR_STOP=1'],"set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';\n"+input);
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const first='11111111-1111-4111-8111-111111111111';
const second='22222222-2222-4222-8222-222222222222';
const enabled=t=>{if(container)return true;t.skip('Set ATTENDANCE_TRAVEL_DELETE_TEST_CONTAINER to the disposable local container');return false;};
before(()=>{
 if(!container)return;
 assert.equal(run(['inspect','--format','{{.HostConfig.NetworkMode}}',container]),'none');
 run(['exec',container,'dropdb','--if-exists','--force','-U','postgres',db]);
 run(['exec',container,'createdb','-U','postgres',db]);
 const fixture=read('tests/fixtures/attendance-daily-delete.sql');
 const triggers=fixture.indexOf('create trigger av2_invalidate_daily_travel_after_activity_change');
 sql(fixture.slice(0,triggers));
 sql(read('supabase/patches/attendance-daily-travel-delete.sql'));
 sql(fixture.slice(triggers));
 sql(read('supabase/migrations/20261110202214_attendance_travel_integrity_bundle.sql'));
});
beforeEach(()=>{
 if(!container)return;
 sql("truncate attendance_records,attendance_travel_compensations,attendance_daily_travel_reports,attendance_daily_travel_audit,attendance_month_approvals,payroll_control_approvals cascade; delete from users where emp_id<>1; update users set role='instructor',is_active=true; insert into attendance_month_approvals values(1,'2026-11','reopened'); update contacts_instructors set direct_manager=null;");
});
function activity(id,start='09:00',end='10:00',extra=''){
 sql(`insert into attendance_records(id,emp_id,report_date,start_time,end_time,activity_type,school_id) values('${id}',1,'2026-11-05','${start}','${end}','קורס',10);${extra}`);
}
function save(two=true){
 const legs=[{kind:'outbound',from:'בית',to:'בית ספר',toRecordId:first,minutes:60,kilometers:10,mode:'car'}];
 if(two)legs.push({kind:'between',from:'בית ספר',to:'בית ספר',fromRecordId:first,toRecordId:second,minutes:60,kilometers:0,mode:'car'});
 legs.push({kind:'return',from:'בית ספר',to:'בית',fromRecordId:two?second:first,minutes:60,kilometers:10,mode:'car'});
 const fp=sql("select private.av2_daily_travel_context_fingerprint(1,'2026-11-05')");
 for(const leg of legs)leg.contextFingerprint=fp;
 return sql(`select av2_save_daily_travel('2026-11-05','${JSON.stringify(legs)}',false)`);
}
function setup(two=true){activity(first);if(two)activity(second,'11:00','12:00');save(two);}
function approve(){sql("update users set role='admin'; select av2_review_daily_travel(1,'2026-11-05','approve'); update users set role='instructor';");}

const asInstructor=q=>sql('set role authenticated; '+q);
const payload=()=>JSON.parse(sql('select legs from attendance_daily_travel_reports'));
const attempt=legs=>asInstructor(`select av2_save_daily_travel('2026-11-05','${JSON.stringify(legs)}',false)`);

test('deleting one activity removes the whole pending chain and preserves all other attendance fields',t=>{
 if(!enabled(t))return;setup();
 const before=sql(`select to_jsonb(a) from attendance_records a where id='${first}'`);
 sql(`delete from attendance_records where id='${second}'`);
 assert.equal(sql('select count(*) from attendance_daily_travel_reports'),'0');
 assert.equal(sql(`select to_jsonb(a) from attendance_records a where id='${first}'`),before);
 assert.equal(sql("select count(*) from attendance_daily_travel_audit where reason='attendance_deleted_travel_removed'"),'1');
});
test('approved daily payable disappears even when its anchor attendance remains',t=>{
 if(!enabled(t))return;setup();approve();
 assert.equal(sql("select count(*) from attendance_records where generation_kind='daily_travel_cancellation'"),'1');
 sql(`delete from attendance_records where id='${second}'`);
 assert.equal(sql('select count(*) from attendance_daily_travel_reports'),'0');
 assert.equal(sql("select count(*) from attendance_records where generation_kind is not null"),'0');
 assert.equal(sql(`select count(*) from attendance_records where id='${first}'`),'1');
});
test('deleting the anchor removes payable without deleting another physical record',t=>{
 if(!enabled(t))return;setup();approve();sql(`delete from attendance_records where id='${first}'`);
 assert.equal(sql('select count(*) from attendance_daily_travel_reports'),'0');
 assert.equal(sql(`select count(*) from attendance_records where id='${second}'`),'1');
 assert.equal(sql("select count(*) from attendance_records where generation_kind is not null"),'0');
});
test('deleting the last activity leaves neither trip nor payable',t=>{
 if(!enabled(t))return;setup(false);approve();sql(`delete from attendance_records where id='${first}'`);
 assert.equal(sql('select count(*) from attendance_records'),'0');
 assert.equal(sql('select count(*) from attendance_daily_travel_reports'),'0');
});
test('same-day independent manual cancellation, other employee and other day are unchanged',t=>{
 if(!enabled(t))return;setup();
 sql("insert into attendance_records(emp_id,report_date,start_time,end_time,activity_type,notes) values(1,'2026-11-05','13:00','14:00','ביטול זמן','independent'),(2,'2026-11-05','09:00','10:00','קורס','other employee'),(1,'2026-11-06','09:00','10:00','קורס','other day')");
 const before=sql("select jsonb_agg(to_jsonb(a) order by id) from attendance_records a where notes is not null");
 sql(`delete from attendance_records where id='${second}'`);
 assert.equal(sql("select jsonb_agg(to_jsonb(a) order by id) from attendance_records a where notes is not null"),before);
});
test('refill and repeat save/approval generate one new daily trip and one payable',t=>{
 if(!enabled(t))return;setup();approve();sql(`delete from attendance_records where id='${second}'`);
 save(false);save(false);approve();
 assert.equal(sql('select count(*) from attendance_daily_travel_reports'),'1');
 assert.equal(sql("select count(*) from attendance_records where generation_kind='daily_travel_cancellation'"),'1');
 assert.equal(sql("select roundtrip_km from attendance_records where generation_kind='daily_travel_cancellation'"),'20');
 assert.equal(sql("select count(*) from attendance_records child left join attendance_records parent on parent.id=child.source_attendance_record_id where child.generation_kind is not null and parent.id is null"),'0');
});
test('online attendance deletion leaves the saved physical trip unchanged',t=>{
 if(!enabled(t))return;setup(false);
 sql(`insert into attendance_records(id,emp_id,report_date,start_time,end_time,activity_type) values('${second}',1,'2026-11-05','15:00','16:00','זום')`);
 const before=sql('select to_jsonb(d) from attendance_daily_travel_reports d');
 sql(`delete from attendance_records where id='${second}'`);
 assert.equal(sql('select to_jsonb(d) from attendance_daily_travel_reports d'),before);
});
test('before-November source-linked children cascade but unrelated attendance is preserved',t=>{
 if(!enabled(t))return;
 sql(`set app.av2_compensation_write='1'; insert into attendance_records(id,emp_id,report_date,start_time,end_time,activity_type) values('${first}',1,'2026-10-05','09:00','10:00','קורס'),('${second}',1,'2026-10-05','11:00','12:00','קורס'); insert into attendance_records(emp_id,report_date,activity_type,generation_kind,source_attendance_record_id) values(1,'2026-10-05','ביטול זמן','travel_time_cancellation','${first}'); delete from attendance_records where id='${first}'`);
 assert.equal(sql('select count(*) from attendance_records'),'1');
 assert.equal(sql(`select count(*) from attendance_records where id='${second}'`),'1');
});

test('RPC rejects incomplete, null, fractional, negative and wrongly typed travel without changing the saved row',t=>{
 if(!enabled(t))return;setup(false);
 const original=sql('select to_jsonb(d) from attendance_daily_travel_reports d');
 const changes=[['minutes',undefined],['minutes',null],['minutes',2.5],['minutes',-1],['minutes',1441],
  ['minutes','60'],['kilometers',undefined],['kilometers',null],['kilometers',-1],['kilometers',2001],
  ['kilometers','10'],['transportCost',null],['transportCost','5'],['transportCost',-1],
  ['mode',null],['mode','invalid'],['from',{}],['to',''],['kind',null]];
 for(const [key,value] of changes){const legs=payload();if(value===undefined)delete legs[0][key];else legs[0][key]=value;
  assert.throws(()=>attempt(legs),undefined,`must reject ${key}=${value}`);
  assert.equal(sql('select to_jsonb(d) from attendance_daily_travel_reports d'),original);
 }
});
test('stale browser draft and pending approval are blocked after attendance address change',t=>{
 if(!enabled(t))return;setup(false);const old=payload();
 sql(`update attendance_records set destination_address_snapshot='new address' where id='${first}'`);
 assert.throws(()=>attempt(old),/attendance_travel_route_changed/);
 assert.throws(()=>sql("update users set role='admin'; select av2_review_daily_travel(1,'2026-11-05','approve')"),/attendance_travel_route_changed/);
 sql("update users set role='instructor'");save(false);approve();
 assert.equal(sql("select count(*) from attendance_records where generation_kind='daily_travel_cancellation'"),'1');
});
test('approved trip loses approval and payable on material change, while note-only edit retains them',t=>{
 if(!enabled(t))return;setup(false);approve();
 const original=sql('select to_jsonb(d) from attendance_daily_travel_reports d');
 sql(`update attendance_records set notes='only a note' where id='${first}'`);
 assert.equal(sql('select to_jsonb(d) from attendance_daily_travel_reports d'),original);
 sql(`update attendance_records set end_time='10:30' where id='${first}'`);
 assert.equal(sql('select review_status from attendance_daily_travel_reports'),'pending_review');
 assert.equal(sql("select count(*) from attendance_records where generation_kind='daily_travel_cancellation'"),'0');
 assert.throws(()=>sql("update users set role='admin'; select av2_review_daily_travel(1,'2026-11-05','approve')"),/attendance_travel_route_changed/);
});
test('changed school fallback blocks new approval without rewriting a saved or historical report',t=>{
 if(!enabled(t))return;setup(false);
 const before=sql('select to_jsonb(d) from attendance_daily_travel_reports d');
 sql("update schools set route_verified_address='new verified school' where id=10");
 assert.equal(sql('select to_jsonb(d) from attendance_daily_travel_reports d'),before);
 assert.throws(()=>sql("update users set role='admin'; select av2_review_daily_travel(1,'2026-11-05','approve')"),/attendance_travel_route_changed/);
});
test('legacy report is not backfilled, but source change marks it for a fresh save',t=>{
 if(!enabled(t))return;setup(false);
 sql('update attendance_daily_travel_reports set context_fingerprint=null');
 approve();assert.equal(sql('select context_fingerprint is null from attendance_daily_travel_reports'),'t');
 sql(`update attendance_records set destination_address_snapshot='legacy changed' where id='${first}'`);
 assert.equal(sql('select context_fingerprint from attendance_daily_travel_reports'),'changed');
 assert.throws(()=>sql("update users set role='admin'; select av2_review_daily_travel(1,'2026-11-05','approve')"),/attendance_travel_route_changed/);
});
test('own instructor RPC succeeds, anonymous, unknown, inactive and other-employee record IDs are rejected',t=>{
 if(!enabled(t))return;setup(false);attempt(payload());
 const legs=payload();legs[0].toRecordId=second;assert.throws(()=>attempt(legs));
 assert.throws(()=>sql("set role anon; select av2_save_daily_travel('2026-11-05','[]',true)"),/permission denied/);
 assert.throws(()=>sql("set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; set role authenticated; select av2_save_daily_travel('2026-11-05','[]',true)"),/instructor_required/);
 sql('update users set is_active=false');assert.throws(()=>attempt(payload()),/instructor_required/);
});
test('manager scope and mapped identity are enforced when approving a trip',t=>{
 if(!enabled(t))return;setup(false);
 assert.throws(()=>asInstructor("select av2_review_daily_travel(1,'2026-11-05','approve')"),/review_denied/);
 assert.throws(()=>sql("set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; set role authenticated; select av2_review_daily_travel(1,'2026-11-05','approve')"),/review_denied/);
 sql("update users set role='manager',full_name='Manager A'; update contacts_instructors set direct_manager='Manager B' where emp_id=1");
 assert.throws(()=>asInstructor("select av2_review_daily_travel(1,'2026-11-05','approve')"),/review_denied/);
 sql("update contacts_instructors set direct_manager='Manager A' where emp_id=1");
 asInstructor("select av2_review_daily_travel(1,'2026-11-05','approve')");
 assert.equal(sql('select review_status from attendance_daily_travel_reports'),'approved');
});
test('RLS blocks another employee deletion and direct writes to daily reports and generated payroll',t=>{
 if(!enabled(t))return;setup();
 sql("insert into users(emp_id,auth_user_id,is_active,role) values(2,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true,'instructor'); insert into attendance_month_approvals values(2,'2026-11','reopened')");
 sql("set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; set role authenticated; delete from attendance_records");
 assert.equal(sql('select count(*) from attendance_records'),'2');
 assert.throws(()=>asInstructor('delete from attendance_daily_travel_reports'),/permission denied/);
 assert.throws(()=>asInstructor("insert into attendance_records(emp_id,report_date,activity_type,generation_kind) values(1,'2026-11-05','ביטול זמן','daily_travel_cancellation')"));
 assert.throws(()=>asInstructor("select private.av2_daily_travel_context_fingerprint(1,'2026-11-05')"),/permission denied/);
 asInstructor(`delete from attendance_records where id='${second}'`);
 assert.equal(sql('select count(*) from attendance_daily_travel_reports'),'0');
 assert.equal(sql('select count(*) from attendance_records'),'1');
});
test('closed and payroll-approved months reject save, approval and deletion atomically',t=>{
 if(!enabled(t))return;setup(false);const legs=payload();
 for(const payroll of [false,true]){
  sql("update users set role='instructor'");
  if(payroll)sql("update attendance_month_approvals set status='reopened'; insert into payroll_control_approvals values('1','2026-11','approved_for_payroll')");
  else sql("update attendance_month_approvals set status='locked'");
  assert.throws(()=>attempt(legs),/month_locked/);
  assert.equal(asInstructor(`with d as(delete from attendance_records where id='${first}' returning id)select count(*) from d`),'0');
  assert.throws(()=>sql("update users set role='admin'; select av2_review_daily_travel(1,'2026-11-05','approve')"),/month_locked/);
  assert.equal(sql('select count(*) from attendance_daily_travel_reports'),'1');
 }
});
test('mixed transport, same-site gap and corrected approval enter payroll once and disappear on deletion',t=>{
 if(!enabled(t))return;setup();const legs=payload();
 legs[0]={...legs[0],mode:'public_transport',minutes:0,kilometers:0,transportCost:18};
 attempt(legs);
 assert.equal(sql('select total_km||\'/\'||cancellation_minutes||\'/\'||public_transport_cost from attendance_daily_travel_reports'),'10/75/18');
 sql("update users set role='admin'; select av2_review_daily_travel(1,'2026-11-05','correct',9,65)");
 assert.equal(sql("select roundtrip_km||'/'||round(total_hours*60)||'/'||public_transport_cost from attendance_records where generation_kind='daily_travel_cancellation'"),'9/65/18');
 sql(`delete from attendance_records where id='${second}'`);
 assert.equal(sql("select coalesce(sum(roundtrip_km),0)||'/'||coalesce(sum(total_hours),0)||'/'||coalesce(sum(public_transport_cost),0) from attendance_records where generation_kind='daily_travel_cancellation'"),'0/0/0');
});
test('no-travel declaration is limited to one physical activity and remains subject to context validation',t=>{
 if(!enabled(t))return;setup();assert.throws(()=>asInstructor("select av2_save_daily_travel('2026-11-05','[]',true)"),/between_activities_requires_report/);
 sql(`delete from attendance_records where id='${second}'`);
 asInstructor("select av2_save_daily_travel('2026-11-05','[]',true)");
 sql(`update attendance_records set destination_address_snapshot='changed' where id='${first}'`);
 assert.throws(()=>sql("update users set role='admin'; select av2_review_daily_travel(1,'2026-11-05','approve')"),/route_changed/);
});

test('JS and the live SQL route reader agree on positive, zero, alias, suspect and verified-campus cases',t=>{
 if(!enabled(t))return;
 const cases=[
  {origin:'home',destination:'school',distance_km:10,duration_minutes:20,expected:true},
  {origin:'home',destination:'school',distance_km:0,duration_minutes:0,provider:'google_verified_zero',expected:false},
  {origin:'same',destination:'same',distance_km:0,duration_minutes:0,expected:true},
  {origin:'same',destination:'same',distance_km:0,duration_minutes:0,location_suspect:true,expected:false},
  {origin:'דלית אל כרמל',destination:'דאלית אל-כרמל',distance_km:0,duration_minutes:0,expected:true},
  {origin:'home',destination:'school',distance_km:10,duration_minutes:0,expected:false},
  {origin:'home',destination:'school',distance_km:10,duration_minutes:20,location_suspect:true,expected:false},
  {origin:'campus a',destination:'campus b',distance_km:0,duration_minutes:0,provider:'manager_verified_shared_campus',
   origin_type:'school',destination_type:'school',origin_school_id:10,destination_school_id:20,expected:true},
 ];
 for(const c of cases){
  sql('truncate scheduling_travel_cache,scheduling_route_missing_queue,scheduling_route_approved_points');
  const row={...c,provider:c.provider||'google',location_suspect:c.location_suspect||false};
  const fields=['distance_km','duration_minutes','provider','location_suspect','origin_type','destination_type','origin_school_id','destination_school_id'];
  const literal=v=>v==null?'null':typeof v==='string'?"'"+v.replaceAll("'","''")+"'":String(v);
  sql(`insert into scheduling_travel_cache(origin_key,destination_key,${fields.join(',')}) values(scheduling_normalize_location('${c.origin}'),scheduling_normalize_location('${c.destination}'),${fields.map(k=>literal(row[k])).join(',')}); insert into scheduling_route_approved_points values('school_id:10','manager_confirmed_maps_20261017',32,35),('school_id:20','manager_confirmed_maps_20261017',32,35)`);
  const actual=sql(`select count(*) from scheduling_cached_travel_route('${c.origin}','${c.destination}')`)==='1';
  assert.equal(actual,c.expected,JSON.stringify(c));
  assert.equal(isUsableCachedRoute(row,c.origin,c.destination),actual,JSON.stringify(c));
 }
});

test('actual saved/approved/deleted DB values flow into the existing monthly payroll workbook once',t=>{
 if(!enabled(t))return;setup();sql("update attendance_records set total_hours=2 where generation_kind is null");approve();
 const summary=()=>{
  const rows=JSON.parse(sql('select jsonb_agg(a) from attendance_records a'));
  const activities=rows.map(a=>({final:{employeeId:String(a.emp_id),employeeName:'Test',date:a.report_date,
   activityType:a.activity_type,program:a.activity_name_snapshot||'קורס',startTime:a.start_time,endTime:a.end_time,
   workHours:Number(a.total_hours||0),kilometers:Number(a.roundtrip_km||0),
   publicTransport:a.public_transport,publicTransportCost:Number(a.public_transport_cost||0),generationKind:a.generation_kind}}));
  const book=buildCorrectedAttendanceWorkbook(activities,[{employeeId:'1',employmentType:'תעשיידע'}]);
  const table=XLSX.utils.sheet_to_json(book.Sheets['סיכום חודשי'],{header:1});
  return name=>table[1][table[0].indexOf(name)];
 };
 let value=summary();assert.equal(value('סה"כ קילומטרים'),20);assert.equal(value('שעות ביטול זמן'),'1:30');assert.equal(value('שעות קורס'),'4:00');
 sql(`delete from attendance_records where id='${second}'`);
 value=summary();assert.equal(Number(value('סה"כ קילומטרים')||0),0);
 assert.ok(['0:00','',undefined,0].includes(value('שעות ביטול זמן')));assert.equal(value('שעות קורס'),'2:00');
});

test('a concurrent stale save waits for attendance deletion and cannot resurrect an orphan daily chain',async t=>{
 if(!enabled(t))return;setup();const stale=payload();
 const child=spawn('docker',[...docker,'exec','-i',container,'psql','-U','postgres','-d',db,'-X','-Atq','-v','ON_ERROR_STOP=1'],{env,stdio:['pipe','pipe','pipe']});
 const exited=new Promise((resolve,reject)=>{let stderr='';child.stderr.on('data',d=>stderr+=d);child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(stderr)));});
 const held=new Promise((resolve,reject)=>{child.stdout.on('data',d=>{if(String(d).includes('held'))resolve();});child.on('error',reject);child.on('exit',code=>{if(code!==0)reject(new Error('Concurrent delete failed'));});});
 child.stdin.end(`set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';begin;delete from attendance_records where id='${second}';select 'held';select pg_sleep(0.4);commit;`);
 await held;
 assert.throws(()=>attempt(stale),/route_changed|legs_count_mismatch/);
 await exited;
 assert.equal(sql('select count(*) from attendance_daily_travel_reports'),'0');
 assert.equal(sql('select count(*) from attendance_records'),'1');
});

test('read/review permissions separate instructor ownership, finance read-only and admin approval',t=>{
 if(!enabled(t))return;setup(false);
 assert.equal(JSON.parse(asInstructor("select av2_get_daily_travel(1,'2026-11-01','2026-11-30')")).length,1);
 sql("insert into users(emp_id,auth_user_id,is_active,role) values(2,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true,'instructor')");
 const other=q=>sql("set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';set role authenticated;"+q);
 assert.throws(()=>other("select av2_get_daily_travel(1,'2026-11-01','2026-11-30')"),/read_denied/);
 sql("update users set role='finance' where emp_id=2");
 assert.equal(JSON.parse(other("select av2_get_daily_travel(1,'2026-11-01','2026-11-30')")).length,1);
 assert.throws(()=>other("select av2_review_daily_travel(1,'2026-11-05','approve')"),/review_denied/);
 assert.throws(()=>other("select av2_sync_daily_travel_payable(1,'2026-11-05')"),/permission denied/);
 sql("update users set role='admin' where emp_id=2");
 other("select av2_review_daily_travel(1,'2026-11-05','approve')");
 assert.equal(sql('select review_status from attendance_daily_travel_reports'),'approved');
});

test('applying the release definitions does not backfill or rewrite an existing approved report or payroll',t=>{
 if(!enabled(t))return;setup(false);sql('update attendance_daily_travel_reports set context_fingerprint=null');approve();
 const snapshot=()=>sql("select jsonb_build_object('daily',(select jsonb_agg(d) from attendance_daily_travel_reports d),'attendance',(select jsonb_agg(a order by id) from attendance_records a),'audit',(select jsonb_agg(a) from attendance_daily_travel_audit a))");
 const before=snapshot();sql(read('supabase/migrations/20261110202214_attendance_travel_integrity_bundle.sql'));
 assert.equal(snapshot(),before);
});

test('a manager with no matching nonempty identity cannot read another employee travel report',t=>{
 if(!enabled(t))return;setup(false);
 sql("insert into users(emp_id,auth_user_id,is_active,role) values(2,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true,'manager'); update contacts_instructors set direct_manager=null");
 const query="set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; set role authenticated; select av2_get_daily_travel(1,'2026-11-01','2026-11-30')";
 assert.throws(()=>sql(query),/read_denied/);
 sql("update users set full_name='Manager A' where emp_id=2; update contacts_instructors set direct_manager='Manager A' where emp_id=1");
 assert.equal(JSON.parse(sql(query)).length,1);
});

test('online-only changes do not invalidate an untouched legacy physical travel report',t=>{
 if(!enabled(t))return;setup(false);sql('update attendance_daily_travel_reports set context_fingerprint=null');
 const before=sql('select to_jsonb(d) from attendance_daily_travel_reports d');
 sql(`insert into attendance_records(id,emp_id,report_date,start_time,end_time,activity_type) values('${second}',1,'2026-11-05','15:00','16:00','זום'); delete from attendance_records where id='${second}'`);
 assert.equal(sql('select to_jsonb(d) from attendance_daily_travel_reports d'),before);
});

test('new context validation blocks payment approval but preserves existing rejection workflow',t=>{
 if(!enabled(t))return;setup(false);
 sql(`update attendance_records set destination_address_snapshot='changed address' where id='${first}'; update users set role='admin'`);
 asInstructor("select av2_review_daily_travel(1,'2026-11-05','reject')");
 assert.equal(sql('select review_status from attendance_daily_travel_reports'),'rejected');
 assert.equal(sql("select count(*) from attendance_records where generation_kind='daily_travel_cancellation'"),'0');
});
