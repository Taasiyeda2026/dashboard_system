import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const container = process.env.MANAGER_ATTENDANCE_TEST_CONTAINER;
if (container && container !== 'attendance-manager-review-test') throw new Error('Disposable manager attendance container required');
const sql = query => execFileSync('docker', ['--host=unix:///var/run/docker.sock', 'exec', '-i', container,
  'psql', '-X', '-Atq', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'], { input: query, encoding: 'utf8' }).trim();
const migration = readFileSync(new URL('../supabase/migrations/20261101011727_manager_attendance_training_review.sql', import.meta.url), 'utf8');
const actor = (id, query) => sql(`begin; select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000000${id}',true); ${query}; rollback;`).split('\n').slice(1).join('\n');
const enabled = t => { if (!container) { t.skip('Set MANAGER_ATTENDANCE_TEST_CONTAINER to the disposable test container'); return false; } return true; };
let dataPreserved;
before(() => {
  if (!container) return;
  sql(`create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table users(auth_user_id uuid,role text,full_name text,name text,username text,is_active boolean);
    insert into users values ('00000000-0000-4000-8000-000000000001','admin','Admin','','',true),
      ('00000000-0000-4000-8000-000000000002','activities_manager','Alice','','',true),
      ('00000000-0000-4000-8000-000000000003','instructor','Instructor','','',true);
    create table contacts_instructors(emp_id bigint,full_name text,employment_type text,direct_manager text);
    insert into contacts_instructors values (1550,'Zoom','employee','Alice'),(1551,'Physical','employee','Bob');
    create table attendance_records(id uuid,emp_id bigint,report_date date,start_time time,end_time time,total_hours numeric,
      activity_type text,school_name_snapshot text,authority_name_snapshot text,program_name_snapshot text,program_name text,
      activity_name_snapshot text,meeting_no int,expenses numeric,roundtrip_km numeric,expense_details text,notes text,
      activity_row_id text,activity_id bigint,activity_no text,activity_season text,authority_id bigint,school_id bigint,semel_mosad bigint,
      public_transport boolean,public_transport_cost numeric,training_mode text);
    create table attendance_record_attachments(id uuid,record_id uuid,file_name text,storage_path text,file_type text,file_size bigint);
    insert into attendance_records(id,emp_id,report_date,start_time,end_time,total_hours,activity_type,program_name,roundtrip_km,expenses,training_mode)
    values ('d688878d-609e-4e94-8d4a-44259ca19d38',1550,'2026-10-29','13:45','15:00',1.25,'הכשרה','פורצות דרך',0,12,'online'),
      ('00000000-0000-4000-8000-000000000011',1551,'2026-10-29','10:00','12:00',2,'הכשרה','Physical',80,7,'physical'),
      ('00000000-0000-4000-8000-000000000012',1550,'2026-10-29','10:00','11:00',1,'הכשרה','Legacy',37,0,null);
    create function get_payroll_attendance_records(bigint[] default null,date default null,date default null) returns void language sql as $$select$$;
    create function get_manager_attendance_review_snapshot(p_employee_id bigint,p_month_key text) returns jsonb language plpgsql as $$
    declare records jsonb; begin
      select jsonb_agg(to_jsonb(r)) into records from get_payroll_attendance_records(array[p_employee_id],(p_month_key||'-01')::date,((p_month_key||'-01')::date+interval '1 month - 1 day')::date) r;
      return jsonb_build_object('records',records);
    end$$;`);
  const before = sql('select jsonb_agg(to_jsonb(r) order by id) from attendance_records r');
  sql(`begin; ${migration} commit;`);
  dataPreserved = before === sql('select jsonb_agg(to_jsonb(r) order by id) from attendance_records r');
});
test('projection migration does not change historical attendance hours, kilometers or expenses', t => {
  if (!enabled(t)) return; assert.equal(dataPreserved, true);
});
test('payroll RPC appends raw mode without changing payroll fields or inventing missing mode', t => {
  if (!enabled(t)) return;
  const rows = JSON.parse(actor(1, 'select jsonb_agg(to_jsonb(r)) from get_payroll_attendance_records(null,null,null) r'));
  assert.equal(rows.length, 3);
  const zoom = rows.find(r => r.record_id.startsWith('d688'));
  assert.equal(zoom.training_mode,'online'); assert.equal(zoom.work_hours,1.25); assert.equal(zoom.kilometers,0); assert.equal(zoom.total_expenses,12);
  assert.equal(rows.find(r => r.employee_id === '1551').training_mode,'physical');
  assert.equal(rows.find(r => r.program_name === 'Legacy').training_mode,null);
  assert.equal(rows.find(r => r.program_name === 'Legacy').kilometers,37);
});
test('manager snapshot JSON automatically includes the same training_mode projection', t => {
  if (!enabled(t)) return;
  const snapshot = JSON.parse(actor(1,"select get_manager_attendance_review_snapshot(1550,'2026-10')"));
  assert.equal(snapshot.records.find(r => r.record_id.startsWith('d688')).training_mode,'online');
});
test('direct managers remain restricted to their own instructor roster', t => {
  if (!enabled(t)) return;
  assert.equal(actor(2,'select count(*) from get_payroll_attendance_records(array[1551::bigint],null,null)'), '0');
  assert.equal(actor(2,'select count(*) from get_payroll_attendance_records(array[1550::bigint],null,null)'), '2');
});
test('unauthenticated and instructor reads remain denied and anon execute stays revoked', t => {
  if (!enabled(t)) return;
  assert.throws(() => actor(3,'select count(*) from get_payroll_attendance_records(null,null,null)'), /permission_denied/);
  assert.throws(() => sql('select * from get_payroll_attendance_records(null,null,null)'), /auth_required/);
  assert.equal(sql("select has_function_privilege('anon','get_payroll_attendance_records(bigint[],date,date)','execute')"),'f');
  assert.equal(sql("select has_function_privilege('authenticated','get_payroll_attendance_records(bigint[],date,date)','execute')"),'t');
});
