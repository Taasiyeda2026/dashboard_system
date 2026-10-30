import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

// Explicit opt-in, disposable local container only. This cannot use DB URLs,
// project credentials, or any application connection configuration.
const container = process.env.ATTENDANCE_TRAVEL_TEST_CONTAINER;
if (container && container !== 'attendance-travel-2523-test') throw new Error('Use the isolated attendance-travel-2523-test container');
const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const migration = await read('supabase/migrations/20261030192830_attendance_travel_save_and_control_fixes.sql');
const original = await read('supabase/migrations/20261013042258_unified_attendance_travel_time_cancellation.sql');
const id = '11111111-1111-4111-8111-111111111111';
const child = '22222222-2222-4222-8222-222222222222';
const sql = query => execFileSync('docker', ['--host=unix:///var/run/docker.sock', 'exec', '-i', container,
  'psql', '-X', '-Atq', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'codex_attendance_travel_test'],
  { input: query, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }).trim();
const row = query => JSON.parse(sql(query));
const changedFunction = (source, name) => source.match(new RegExp('create or replace function public\\.' + name + '\\([\\s\\S]*?\\bas\\s+(\\$\\w*\\$)[\\s\\S]*?\\1\\s*;', 'i'))[0];
let definitionOnly;
const enabled = t => { if (container) return true; t.skip('Set ATTENDANCE_TRAVEL_TEST_CONTAINER to the disposable local container'); return false; };

before(async () => {
  if (!container) return;
  execFileSync('docker', ['--host=unix:///var/run/docker.sock','exec',container,'dropdb','--if-exists','--force','-U','postgres','codex_attendance_travel_test']);
  execFileSync('docker', ['--host=unix:///var/run/docker.sock','exec',container,'createdb','-U','postgres','codex_attendance_travel_test']);
  sql(await read('tests/fixtures/attendance-travel-2523.sql'));
  for (const name of ['av2_travel_cancellation_minutes','av2_travel_compensation_snapshot',
    'av2_append_travel_compensation_event','av2_compute_travel_review_status',
    'av2_compute_source_travel_review_status','av2_sync_travel_cancellation_payable',
    'av2_prepare_attendance_travel','av2_reconcile_attendance_travel']) sql(changedFunction(original,name));
  sql(changedFunction(await read('supabase/migrations/20261012132000_attendance_team_operation_mode.sql'),'av2_sync_operation_destination_address'));
  sql(changedFunction(await read('supabase/migrations/20260925111500_attendance_location_origin_context.sql'),'get_payroll_attendance_location_contexts'));
  sql(`revoke all on function get_payroll_attendance_location_contexts(bigint[],date,date) from public;
    grant execute on function get_payroll_attendance_location_contexts(bigint[],date,date) to authenticated;
    insert into attendance_records(id,emp_id,report_date,activity_type,roundtrip_km,total_hours) values ('${id}',1,'2026-10-25','קורס',88,2);
    insert into attendance_travel_compensations(source_attendance_record_id,emp_id,review_status,final_cancellation_minutes,approved_cancellation_minutes)
    values ('${id}',1,'approved',45,45);`);
  const before = sql('select jsonb_agg(to_jsonb(a)) from attendance_records a') + sql('select jsonb_agg(to_jsonb(c)) from attendance_travel_compensations c');
  sql(migration);
  definitionOnly = before === sql('select jsonb_agg(to_jsonb(a)) from attendance_records a') + sql('select jsonb_agg(to_jsonb(c)) from attendance_travel_compensations c');
  sql('create trigger destination before insert or update on attendance_records for each row execute function av2_sync_operation_destination_address();');
});
beforeEach(() => {
  if (!container) return;
  sql("truncate attendance_records,attendance_travel_compensations,attendance_travel_compensation_events,instructor_training_schedule; reset test.fingerprint;");
});
function source(extra = '') {
  sql(`insert into attendance_records(id,emp_id,report_date,activity_type,school_id,roundtrip_km,total_hours)
    values ('${id}',1,'2026-10-25','קורס',10,88,2); ${extra}`);
}
function prepare(fingerprint = 'fp') { return row(`set test.fingerprint='${fingerprint}'; select av2_prepare_attendance_travel('${id}',auth.uid())`); }
function reconcile(out = 30, ret = 25, fingerprint = 'fp') {
  return row(`select av2_reconcile_attendance_travel('${id}','${fingerprint}',${out},${ret},null,26.522)`);
}

test('migration changes definitions only and retains existing RPC access', t => {
  if (!enabled(t)) return;
  assert.equal(definitionOnly,true);
  assert.equal(sql("select has_function_privilege('authenticated','get_payroll_attendance_location_contexts(bigint[],date,date)','execute')"),'t');
  assert.equal(sql("select has_function_privilege('anon','get_payroll_attendance_location_contexts(bigint[],date,date)','execute')"),'f');
});
test('new 30/25 route resolves with zero cancellation, without altering reported km or creating payroll', t => {
  if (!enabled(t)) return;
  source(); prepare();
  assert.equal(sql(`select final_cancellation_minutes from attendance_travel_compensations where source_attendance_record_id='${id}'`),'0');
  const r=reconcile();
  assert.equal(r.calculation_status,'resolved'); assert.equal(r.calculated_cancellation_minutes,0);
  assert.equal(r.final_cancellation_minutes,0); assert.equal(r.system_distance_km,26.522);
  assert.equal(r.review_status,'none'); assert.equal(r.approved_cancellation_minutes,null);
  assert.equal(sql('select count(*) from attendance_records'),'1');
  assert.equal(sql(`select roundtrip_km||'/'||total_hours from attendance_records where id='${id}'`),'88/2');
});
test('legacy pending null final resolves and long routes still require review before payroll', t => {
  if (!enabled(t)) return;
  source(); sql(`insert into attendance_travel_compensations(source_attendance_record_id,emp_id,route_context_fingerprint) values ('${id}',1,'fp')`);
  const r=reconcile(70,60);
  assert.equal(r.calculated_cancellation_minutes,40); assert.equal(r.final_cancellation_minutes,0);
  assert.equal(r.review_status,'awaiting_report'); assert.equal(r.generated_attendance_record_id,null);
  assert.equal(sql('select count(*) from attendance_records'),'1');
});
test('existing manager approval, guide report and payable amount survive prepare and reconcile', t => {
  if (!enabled(t)) return;
  source(); prepare();
  sql(`update attendance_travel_compensations set review_status='approved',approved_cancellation_minutes=45,
    final_cancellation_minutes=45,reported_outbound_minutes=70,reported_return_minutes=65,
    review_by=auth.uid(),review_at='2026-10-20',review_note='keep',generated_attendance_record_id='${child}';
    insert into attendance_records(id,emp_id,report_date,activity_type,total_hours,source_attendance_record_id,generation_kind)
    values ('${child}',1,'2026-10-25','ביטול זמן',0.75,'${id}','travel_time_cancellation');`);
  const before=row('select to_jsonb(c) from attendance_travel_compensations c');
  // Exercise the ON CONFLICT branch as well as reconcile, without changing the manager decision.
  prepare('changed'); const r=reconcile(90,80,'changed');
  for (const field of ['review_status','approved_cancellation_minutes','final_cancellation_minutes',
    'reported_outbound_minutes','reported_return_minutes','review_by','review_at','review_note','generated_attendance_record_id']) assert.equal(r[field],before[field],field);
  assert.equal(Number(sql(`select total_hours from attendance_records where id='${child}'`)),0.75);
  assert.equal(sql('select count(*) from attendance_records'),'2');
});
test('physical training venue survives inserts and updates; online still clears travel', t => {
  if (!enabled(t)) return;
  sql(`insert into attendance_records(id,emp_id,activity_type,training_mode,destination_address_snapshot,roundtrip_km)
    values ('${id}',1,'הכשרה','physical','venue',88);`);
  assert.equal(sql(`select destination_address_snapshot from attendance_records where id='${id}'`),'venue');
  sql(`update attendance_records set destination_address_snapshot='new venue' where id='${id}'`);
  assert.equal(sql(`select destination_address_snapshot from attendance_records where id='${id}'`),'new venue');
  sql(`update attendance_records set training_mode='online',public_transport=true,public_transport_cost=20 where id='${id}'`);
  const r=row('select to_jsonb(a) from attendance_records a');
  assert.equal(r.destination_address_snapshot,null); assert.equal(r.roundtrip_km,0);
  assert.equal(r.public_transport,false); assert.equal(r.public_transport_cost,0);
});
test('corrected and rejected manager decisions stay locked during recalculation', t => {
  if (!enabled(t)) return;
  for (const decision of ['corrected','rejected']) {
    sql('truncate attendance_records,attendance_travel_compensations,attendance_travel_compensation_events');
    source(); prepare();
    const approved=decision==='corrected'?35:0;
    sql(`update attendance_travel_compensations set review_status='${decision}',
      approved_cancellation_minutes=${approved},final_cancellation_minutes=${approved},
      review_by=auth.uid(),review_at='2026-10-20',review_note='keep decision',
      manually_overridden=${decision==='corrected'},override_by=${decision==='corrected'?'auth.uid()':'null'},
      override_at=${decision==='corrected'?"'2026-10-20'":'null'};`);
    const r=reconcile(120,110);
    assert.equal(r.review_status,decision); assert.equal(r.approved_cancellation_minutes,approved);
    assert.equal(r.final_cancellation_minutes,approved); assert.equal(r.review_note,'keep decision');
    assert.equal(Number(sql("select coalesce(sum(total_hours),0) from attendance_records where generation_kind='travel_time_cancellation'")),approved/60);
  }
});
test('scheduled physical training preserves its canonical venue and public transport amounts', t => {
  if (!enabled(t)) return;
  sql(`insert into instructor_training_schedule values ('${child}',1,true,'2026-10-25',null,false,'name','scheduled venue');
    insert into attendance_records(id,emp_id,report_date,activity_type,training_schedule_id,public_transport,public_transport_cost)
    values ('${id}',1,'2026-10-25','הכשרה','${child}',true,35);`);
  const r=row('select to_jsonb(a) from attendance_records a');
  assert.equal(r.destination_address_snapshot,'scheduled venue'); assert.equal(r.public_transport,true);
  assert.equal(r.public_transport_cost,35); assert.equal(r.training_mode,'physical');
});
test('location RPC marks unnamed online training and team operations remote, retaining physical courses', t => {
  if (!enabled(t)) return;
  source();
  sql(`insert into attendance_records(emp_id,report_date,activity_type,activity_name_snapshot,training_mode,operation_meeting_mode)
    values (1,'2026-10-25','הכשרה','generic','online',null),
           (1,'2026-10-25','תפעול','צוות',null,'online'),
           (1,'2026-10-25','זום','legacy',null,null);`);
  assert.equal(sql("select count(*) from get_payroll_attendance_location_contexts(array[1::bigint],'2026-10-01','2026-10-31') where is_remote and destination_type='remote'"),'3');
  assert.equal(sql(`select is_remote from get_payroll_attendance_location_contexts(array[1::bigint],null,null) where record_id='${id}'`),'f');
});
