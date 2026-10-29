import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
const modulePath = process.env.NOTIFICATION_TEST_PGLITE_MODULE;
let db;
const U = { idan: '11111111-1111-4111-8111-111111111111', toni: '22222222-2222-4222-8222-222222222222', manager: '33333333-3333-4333-8333-333333333333', employee: '44444444-4444-4444-8444-444444444444', other: '55555555-5555-4555-8555-555555555555' };
const R = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const P = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const required = t => { if(db) return true; t.skip('Set NOTIFICATION_TEST_PGLITE_MODULE to a disposable embedded PostgreSQL engine'); return false; };
const admin = () => db.exec('reset role');
const identity = async (who, role = 'authenticated') => { await db.exec('reset role'); await db.query("select set_config('test.uid',$1,false)",[U[who] || '']); await db.exec(`set role ${role}`); };
const scalar = async sql => Object.values((await db.query(sql)).rows[0])[0];
before(async () => {
 if(!modulePath) return;
 const { PGlite }=await import(modulePath); db=new PGlite();
 await db.exec(`create schema auth;create schema private;
 create role authenticated;create role anon;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 grant usage on schema public,auth to authenticated,anon;
 create table auth.users(id uuid primary key);
 create table public.users(user_id text,auth_user_id uuid,username text,role text,is_active boolean default true,full_name text,name text,emp_id text,permissions jsonb default '{}',approve_proposals_agreements boolean,manage_proposals_agreements boolean);
 create table public.profiles(id uuid primary key,email text,full_name text,role text,is_active boolean,can_access_personal_reports boolean);
 create table public.employee_profiles(user_id text,emp_id text,direct_manager text,full_name text);
 create table public.contacts_instructors(emp_id bigint primary key,full_name text,direct_manager text);
 create table public.personal_reports(id uuid primary key default gen_random_uuid(),employee_id uuid,report_month int,report_year int,status text);
 create table public.proposals_agreements(id uuid primary key default gen_random_uuid(),created_by text,status text,archived_at timestamptz,quote_number text,client_authority text);
 create table public.attendance_month_approvals(id uuid primary key default gen_random_uuid(),emp_id bigint,month_key text,status text,manager_approved_at timestamptz);
 create table public.payroll_control_approvals(id uuid primary key default gen_random_uuid(),employee_id text,month_key text,status text);
 alter table public.profiles enable row level security;
 create policy profiles_own_update on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
 create policy profiles_select on public.profiles for select to authenticated using(id=auth.uid());
 grant select,update on public.profiles to authenticated;
 `);
 for(const [name,id] of Object.entries(U)) {
  await db.query('insert into auth.users values($1)',[id]);
  await db.query('insert into public.users(user_id,auth_user_id,username,role,full_name,emp_id,permissions) values($1,$2,$3,$4,$5,$6,$7)',
   [name==='idan'?'8000':name==='toni'?'7000':name, id,name==='idan'?'idann':name==='toni'?'tonin':name,name==='idan'?'admin':name==='toni'?'finance':name==='manager'?'activities_manager':'employee',name,name==='employee'?'10':name==='other'?'11':null,JSON.stringify({personal_reports_manager:'yes',manage_proposals_agreements:'yes',view_attendance_control:'yes',view_finance_payroll:'yes'})]);
  await db.query('insert into public.profiles values($1,$2,$3,$4,true,true)',[id,`${name}@example.test`,name,name==='idan'?'admin':'employee']);
 }
 await db.exec("insert into public.contacts_instructors values(10,'employee','manager'),(11,'other','manager')");
 const files=await readdir(new URL('../supabase/migrations/',import.meta.url));
 const file=files.find(x=>x.endsWith('_central_notifications.sql'));
 const sql = await readFile(new URL(file ? `../supabase/migrations/${file}` : '../supabase/pending/central-notifications.sql',import.meta.url),'utf8');
 await db.exec(sql);
});
beforeEach(async()=>{if(!db)return;await admin();await db.exec("select set_config('test.uid','',false);delete from public.dashboard_notification_tasks;delete from public.dashboard_notifications;delete from private.dashboard_notification_routing_issues;delete from private.dashboard_notification_events;delete from private.dashboard_notification_versions;truncate public.personal_reports,public.proposals_agreements,public.attendance_month_approvals,public.payroll_control_approvals;");});
after(async()=>{if(db)await db.close();});

test('personal reports: one recipient, no duplicate save, separate read state, correction cycle, self-approval exception',async t=>{
 if(!required(t))return;
 await db.query("insert into personal_reports values($1,$2,10,2026,'draft')",[R,U.employee]);
 await db.exec(`update personal_reports set status='submitted' where id='${R}';update personal_reports set status='submitted' where id='${R}'`);
 assert.equal(await scalar('select count(*) from dashboard_notifications'),1);
 await identity('employee'); assert.equal(await scalar('select count(*) from dashboard_notifications'),0);
 await identity('idan'); assert.equal(await scalar('select count(*) from dashboard_notification_tasks where closed_at is null'),1);
 const id=await scalar('select id from dashboard_notifications');
 await db.query('select mark_dashboard_notification_read($1)',[id]);
 assert.equal(await scalar('select count(*) from dashboard_notifications where read_at is null'),0);
 assert.equal(await scalar('select count(*) from dashboard_notification_tasks where closed_at is null'),1);
 await admin(); await db.exec(`update personal_reports set status='needs_correction' where id='${R}'`);
 await identity('employee'); assert.equal(await scalar('select count(*) from dashboard_notification_tasks where closed_at is null'),1);
 await db.query('select mark_dashboard_notification_read($1)',[id]);
 await admin(); await db.exec(`update personal_reports set status='submitted' where id='${R}';update personal_reports set status='approved' where id='${R}';update personal_reports set status='paid' where id='${R}'`);
 assert.equal(await scalar('select count(*) from private.dashboard_notification_events'),5);
 assert.equal(await scalar('select count(*) from dashboard_notification_tasks where closed_at is null'),0);
 await db.query("insert into personal_reports values(gen_random_uuid(),$1,10,2026,'submitted')",[U.idan]);
 assert.equal(await scalar('select count(*) from private.dashboard_notification_routing_issues'),1);
});

test('proposal signature and responsible routing, cancellation and batch closure preserve history',async t=>{
 if(!required(t))return;
 await db.query("insert into proposals_agreements(id,created_by,status,quote_number,client_authority) values($1,'employee','draft','1045','client')",[P]);
 await db.exec(`update proposals_agreements set status='pending_approval' where id='${P}'`);
 await identity('idan'); assert.equal(await scalar('select count(*) from dashboard_notification_tasks where closed_at is null'),1);
 await admin(); await db.exec(`update proposals_agreements set status='returned_for_changes' where id='${P}'`);
 await identity('employee');assert.equal(await scalar('select count(*) from dashboard_notification_tasks where closed_at is null'),1);
 const ids=(await db.query('select id from dashboard_notifications')).rows.map(x=>x.id);
 const labels=(await db.query('select dashboard_notification_labels($1) labels',[ids])).rows[0].labels;
 assert.match(Object.values(labels)[0].subject_label,/1045/);
 await admin(); await db.exec(`update proposals_agreements set status='pending_approval' where id='${P}';update proposals_agreements set status='approved' where id='${P}';update proposals_agreements set status='sent' where id='${P}'`);
 assert.equal(await scalar('select count(*) from dashboard_notification_tasks where closed_at is null'),0);
 assert.equal(await scalar('select count(*) from dashboard_notifications'),4);
 await db.exec(`update proposals_agreements set status='pending_approval';update proposals_agreements set status='cancelled'`);
 assert.equal(await scalar('select count(*) from dashboard_notification_tasks where closed_at is null'),0);
});

test('attendance uses actual direct manager then Idan then explicit payroll dispatch to Toni',async t=>{
 if(!required(t))return;
 await db.exec("insert into attendance_month_approvals(emp_id,month_key,status) values(10,'2026-10','submitted')");
 await identity('manager');assert.equal(await scalar('select count(*) from dashboard_notification_tasks where closed_at is null'),1);
 await identity('idan');assert.equal(await scalar('select count(*) from dashboard_notification_tasks where closed_at is null'),0);
 await admin();await db.exec("update attendance_month_approvals set status='locked',manager_approved_at=now()");
 await identity('idan');assert.equal(await scalar('select count(*) from dashboard_notification_tasks where closed_at is null'),1);
 await admin();await db.exec("insert into payroll_control_approvals(employee_id,month_key,status) values('10','2026-10','admin_approved')");
 await identity('toni');assert.equal(await scalar('select count(*) from dashboard_notifications'),0);
 await admin();await db.exec("update payroll_control_approvals set status='approved_for_payroll'");
 await identity('toni');assert.equal(await scalar('select count(*) from dashboard_notifications'),1);
 assert.equal(await scalar('select count(*) from dashboard_notification_tasks where closed_at is null'),0);
 await admin();await db.exec("delete from payroll_control_approvals;update attendance_month_approvals set status='open'");
 await identity('employee');assert.equal(await scalar('select count(*) from dashboard_notification_tasks where closed_at is null'),1);
});

test('ambiguous and missing recipients create routing issues without broadcasting or blocking workflow',async t=>{
 if(!required(t))return;
 await db.exec("update contacts_instructors set direct_manager='missing' where emp_id=10;insert into attendance_month_approvals(emp_id,month_key,status) values(10,'2026-10','submitted')");
 assert.equal(await scalar('select count(*) from dashboard_notifications'),0);
 assert.equal(await scalar('select count(*) from private.dashboard_notification_routing_issues'),1);
 await db.exec("update contacts_instructors set direct_manager='manager' where emp_id=10");
 await db.query("insert into proposals_agreements(id,created_by,status) values($1,'manual_import_chatgpt','approved')",[P]);
 assert.equal(await scalar('select count(*) from private.dashboard_notification_routing_issues'),2);
});

test('RLS isolates notifications and labels; client cannot forge delivery, close tasks or call internal emit',async t=>{
 if(!required(t))return;
 await db.query("insert into personal_reports values($1,$2,10,2026,'submitted')",[R,U.employee]);
 const id=await scalar('select id from dashboard_notifications');
 await identity('other');assert.equal(await scalar('select count(*) from dashboard_notifications'),0);
 assert.deepEqual((await db.query('select dashboard_notification_labels($1) labels',[[id]])).rows[0].labels,{});
 assert.equal(await scalar(`select mark_dashboard_notification_read('${id}')`),false);
 await assert.rejects(()=>db.exec('update dashboard_notification_tasks set closed_at=now()'),/permission denied/);
 await assert.rejects(()=>db.exec("select private.emit_dashboard_notification('proposal','x','approved',null,'approved','sign',true)"),/permission denied/);
 await identity('', 'anon');await assert.rejects(()=>db.exec('select * from dashboard_notifications'),/permission denied/);
});

test('profiles block sensitive self-update while allowing own name and existing app admin management',async t=>{
 if(!required(t))return;
 await identity('employee');
 await assert.rejects(()=>db.exec("update profiles set role='admin'"),/profile_security_fields_forbidden/);
 await assert.rejects(()=>db.exec('update profiles set can_access_personal_reports=false'),/profile_security_fields_forbidden/);
 await db.exec("update profiles set full_name='new name'");
 await identity('idan');await db.exec("update profiles set full_name='admin name'");
 await identity('toni');await assert.rejects(()=>db.exec("update profiles set role='admin'"),/profile_security_fields_forbidden/);
});

test('rollback creates no notification and history keyset filters remain scoped',async t=>{
 if(!required(t))return;
 await db.query("insert into personal_reports values($1,$2,10,2026,'draft')",[R,U.employee]);
 await db.exec(`begin;update personal_reports set status='submitted' where id='${R}';rollback`);
 assert.equal(await scalar('select count(*) from dashboard_notifications'),0);
 await db.exec(`update personal_reports set status='submitted' where id='${R}';update personal_reports set status='needs_correction' where id='${R}';update personal_reports set status='submitted' where id='${R}'`);
 await identity('idan');const rows=(await db.query('select * from dashboard_notification_history()')).rows;
 assert.equal(rows.length,2);
 const older=(await db.query('select * from dashboard_notification_history($1,$2)',[rows[0].created_at,rows[0].id])).rows;
 assert.equal(older.length,1);
 assert.equal((await db.query("select * from dashboard_notification_history(null,null,'proposal')")).rows.length,0);
});

test('owner sees explicit self-report routing exception and other users cannot inspect it',async t=>{
 if(!required(t))return;
 await db.query("insert into personal_reports values($1,$2,10,2026,'submitted')",[R,U.idan]);
 await identity('idan');assert.equal((await db.query('select * from dashboard_notification_routing_issues()')).rows.length,1);
 await identity('toni');assert.equal((await db.query('select * from dashboard_notification_routing_issues()')).rows.length,0);
});

test('closed tasks are historical and inaccessible to another recipient; inactive accounts lose access',async t=>{
 if(!required(t))return;
 await db.exec("insert into attendance_month_approvals(emp_id,month_key,status) values(10,'2026-10','submitted');update attendance_month_approvals set status='locked',manager_approved_at=now()");
 await identity('manager');assert.equal((await db.query('select * from dashboard_notification_task_history()')).rows.length,1);
 await identity('other');assert.equal((await db.query('select * from dashboard_notification_task_history()')).rows.length,0);
 await admin();await db.query('update users set is_active=false where auth_user_id=$1',[U.manager]);
 await identity('manager');assert.equal(await scalar('select count(*) from dashboard_notifications'),0);
 await admin();await db.query('update users set is_active=true where auth_user_id=$1',[U.manager]);
});

test('Idan self-report requires an explicit different capable approver; Toni is not promoted by routing',async t=>{
 if(!required(t))return;
 await db.query("insert into personal_reports values($1,$2,10,2026,'submitted')",[R,U.idan]);
 assert.equal(await scalar('select count(*) from dashboard_notification_tasks'),0);
 await db.query("insert into private.dashboard_notification_assignments values('personal_report',$1,'review',$2)",[R,U.toni]);
 await db.exec(`update personal_reports set status='needs_correction' where id='${R}';update personal_reports set status='submitted' where id='${R}'`);
 assert.equal(await scalar("select count(*) from dashboard_notification_tasks where stage='review' and closed_at is null"),0);
 assert.equal(await scalar("select role from profiles where full_name='toni'"),'employee');
 await db.exec("update profiles set role='admin' where id='55555555-5555-4555-8555-555555555555'");
 await db.query("delete from private.dashboard_notification_assignments where domain='personal_report' and entity_key=$1",[R]);
 await db.query("insert into private.dashboard_notification_assignments values('personal_report',$1,'review',$2)",[R,U.other]);
 await db.exec(`update personal_reports set status='needs_correction' where id='${R}';update personal_reports set status='submitted' where id='${R}'`);
 await identity('other');assert.equal(await scalar("select count(*) from dashboard_notification_tasks where stage='review' and closed_at is null"),1);
 await admin();await db.exec("select set_config('test.uid','',false);delete from private.dashboard_notification_assignments where entity_key='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';update profiles set role='employee' where id='55555555-5555-4555-8555-555555555555'");
});

test('reviewed initialization is idempotent and does not invent historic payroll notifications',async t=>{
 if(!required(t))return;
 // Simulate records that predate the newly installed capture triggers.
 await db.exec('alter table proposals_agreements disable trigger capture_proposal_notifications');
 await db.query("insert into proposals_agreements(id,created_by,status) values($1,'employee','pending_approval')",[P]);
 await db.exec('alter table proposals_agreements enable trigger capture_proposal_notifications');
 assert.equal(await scalar('select private.initialize_dashboard_notifications()'),1);
 assert.equal(await scalar('select private.initialize_dashboard_notifications()'),0);
 assert.equal(await scalar('select count(*) from dashboard_notification_tasks where closed_at is null'),1);
 assert.equal(await scalar("select count(*) from dashboard_notifications where event_type='dispatched_to_payroll'"),0);
 await identity('employee');await assert.rejects(()=>db.exec('select private.initialize_dashboard_notifications()'),/permission denied/);
});

test('specific appointment overrides the default, ambiguity never fans out, and recipient deletion is unblocked',async t=>{
 if(!required(t))return;
 const temporary='66666666-6666-4666-8666-666666666666';
 await db.query('insert into auth.users values($1)',[temporary]);
 await db.query("insert into users(user_id,auth_user_id,username,role,is_active,full_name) values('temporary',$1,'temporary','admin',true,'temporary')",[temporary]);
 await db.query("insert into private.dashboard_notification_assignments values('proposal',$1,'sign',$2)",[P,temporary]);
 await db.query("insert into proposals_agreements(id,created_by,status) values($1,'employee','pending_approval')",[P]);
 assert.equal(await scalar('select count(*) from dashboard_notification_tasks where closed_at is null'),1);
 assert.equal(await scalar('select recipient_auth_user_id::text from dashboard_notification_tasks where closed_at is null'),temporary);
 await db.query("insert into private.dashboard_notification_assignments values('proposal',$1,'sign',$2)",[P,U.idan]);
 await db.exec(`update proposals_agreements set status='draft';update proposals_agreements set status='pending_approval'`);
 assert.equal(await scalar('select count(*) from dashboard_notification_tasks where closed_at is null'),0);
 assert.equal(await scalar('select count(*) from private.dashboard_notification_routing_issues'),1);
 await db.query('delete from auth.users where id=$1',[temporary]);
 assert.equal(await scalar(`select count(*) from dashboard_notifications where recipient_auth_user_id='${temporary}'`),0);
 await db.query("delete from private.dashboard_notification_assignments where domain='proposal' and entity_key=$1",[P]);
});

test('attendance manager routing uses only the instructor roster, never staff manager fallback',async t=>{
 if(!required(t))return;
 await db.exec("insert into employee_profiles(user_id,emp_id,direct_manager,full_name) values('employee','10','manager','staff name');delete from contacts_instructors where emp_id=10;insert into attendance_month_approvals(emp_id,month_key,status) values(10,'2026-11','submitted')");
 assert.equal(await scalar('select count(*) from dashboard_notification_tasks'),0);
 assert.equal(await scalar('select count(*) from dashboard_notifications'),0);
 assert.equal(await scalar('select count(*) from private.dashboard_notification_routing_issues'),1);
 // A staff profile cannot override the instructor's real manager or label.
 await db.exec("update employee_profiles set direct_manager='idan';insert into contacts_instructors(emp_id,full_name,direct_manager) values(10,'instructor name','manager');insert into attendance_month_approvals(emp_id,month_key,status) values(10,'2026-12','submitted')");
 await identity('manager');assert.equal(await scalar('select count(*) from dashboard_notification_tasks where closed_at is null'),1);
 const taskId=await scalar('select id from dashboard_notification_tasks where closed_at is null');
 const labels=(await db.query('select dashboard_notification_labels($1) labels',[[taskId]])).rows[0].labels;
 assert.equal(labels[taskId].subject_label,'instructor name');
 await identity('idan');assert.equal(await scalar('select count(*) from dashboard_notification_tasks where closed_at is null'),0);
 await admin();await db.exec("delete from employee_profiles;update contacts_instructors set full_name='employee' where emp_id=10");
});

test('staff personal report notifications remain independent of instructor attendance membership',async t=>{
 if(!required(t))return;
 await db.exec("insert into employee_profiles(user_id,emp_id,direct_manager,full_name) values('employee','10','manager','staff name');delete from contacts_instructors where emp_id=10");
 await db.query("insert into personal_reports values($1,$2,10,2026,'submitted')",[R,U.employee]);
 await identity('idan');assert.equal(await scalar('select count(*) from dashboard_notification_tasks where closed_at is null'),1);
 await admin();await db.query("update personal_reports set status='needs_correction' where id=$1",[R]);
 await identity('employee');assert.equal(await scalar('select count(*) from dashboard_notifications'),1);
 assert.equal(await scalar('select count(*) from dashboard_notification_tasks where closed_at is null'),1);
 await admin();await db.query("update personal_reports set status='submitted' where id=$1",[R]);
 await identity('idan');assert.equal(await scalar('select count(*) from dashboard_notification_tasks where closed_at is null'),1);
 await admin();await db.query("update personal_reports set status='approved' where id=$1",[R]);
 await db.query("update personal_reports set status='paid' where id=$1",[R]);
 await identity('employee');assert.equal(await scalar('select count(*) from dashboard_notifications'),3);
 assert.equal(await scalar('select count(*) from dashboard_notification_tasks where closed_at is null'),0);
 await identity('manager');assert.equal(await scalar('select count(*) from dashboard_notifications'),0);
 await identity('other');assert.equal(await scalar('select count(*) from dashboard_notifications'),0);
 await admin();assert.equal(await scalar('select count(*) from private.dashboard_notification_events'),5);
 await db.exec("delete from employee_profiles;insert into contacts_instructors(emp_id,full_name,direct_manager) values(10,'employee','manager')");
});
