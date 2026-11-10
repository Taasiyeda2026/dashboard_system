// Disposable localhost-only schema and real Auth/PostgREST fixtures. Never load production data.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import pg from 'pg';

export const status=JSON.parse(await readFile(process.env.ATTENDANCE_STABILITY_STATUS,'utf8'));
for(const value of [status.API_URL,status.DB_URL]){
  assert.ok(value,'Local URL required');
  assert.ok(['127.0.0.1','localhost'].includes(new URL(value).hostname),'Remote connection forbidden');
}
export const db=new pg.Client({connectionString:status.DB_URL});
await db.connect();
export const admin=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
export const anonymous=()=>createClient(status.API_URL,status.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});

function extract(source,name){
 const m=new RegExp('create\\s+or\\s+replace\\s+function\\s+public\\.'+name+'\\s*\\(','i').exec(source);
 assert.ok(m,'Missing RPC '+name);
 const tail=source.slice(m.index);
 const tagged=/\bas\s+(\$[a-z0-9_]*\$)/i.exec(tail);
 assert.ok(tagged,'Missing body '+name);
 const end=tail.indexOf(tagged[1],tagged.index+tagged[0].length);
 assert.ok(end>0,'Missing terminator '+name);
 return tail.slice(0,end+tagged[1].length)+';';
}
export const ok=(result,label)=>{if(result.error)throw Error(label+': '+result.error.message);return result.data;};

export async function bootstrap(){
 const marker=await db.query("select current_setting('app.attendance_stability_fixture',true) as marker");
 assert.equal(marker.rows[0].marker,'disposable','Refuse to reset a database not marked as a disposable attendance fixture');
 await db.query('drop schema public cascade;create schema public;grant usage on schema public to anon,authenticated,service_role');
 await db.query("delete from auth.users where email like 'travel-qa-%@example.test'");
 const dates=Array.from({length:35},(_,i)=>'date_'+(i+1)+' date').join(',');
 await db.query([
 "create table public.users(user_id text primary key,auth_user_id uuid unique references auth.users(id),username text,role text,is_active boolean default true,full_name text,name text,emp_id text,auth_email text,migrated_to_auth boolean default true);",
 "create table public.contacts_instructors(emp_id bigint primary key,address text,full_name text,direct_manager text,email text);",
 "create table public.schools(id uuid primary key default gen_random_uuid(),route_verified_address text);",
 "create table public.attendance_records(id uuid primary key default gen_random_uuid(),emp_id bigint,report_date date,generation_kind text,activity_type text,roundtrip_km numeric,cancellation_before_minutes integer,cancellation_after_minutes integer,total_hours numeric,expenses numeric,expense_details text,notes text,public_transport boolean,public_transport_cost numeric,activity_id bigint,activity_row_id text,activity_no text,activity_season text,meeting_no integer,program_name text,program_name_snapshot text,authority_id bigint,school_name text,semel_mosad bigint,training_schedule_id uuid,course_business_identity jsonb,course_dashboard_sources jsonb,updated_at timestamptz default now(),created_at timestamptz default now(),training_mode text,operation_meeting_mode text,start_time time,end_time time,school_id uuid,destination_address_snapshot text,school_name_snapshot text,authority_name_snapshot text,activity_name_snapshot text);",
 "create table public.attendance_daily_travel_reports(emp_id bigint,travel_date date,legs jsonb default '[]'::jsonb,no_travel boolean default false,total_km numeric,cancellation_minutes integer,public_transport_cost numeric,review_status text,reported_by uuid,reported_at timestamptz default now(),updated_at timestamptz default now(),approved_km numeric,approved_public_transport_cost numeric,approved_cancellation_minutes integer,review_by uuid,review_at timestamptz,review_note text,primary key(emp_id,travel_date));",
 "create table public.attendance_daily_travel_audit(id bigint generated always as identity primary key,emp_id bigint,travel_date date,previous_status text,previous_approved_km numeric,previous_approved_cancellation_minutes integer,previous_approved_public_transport_cost numeric,reason text,actor uuid);",
 "create table public.attendance_month_approvals(emp_id bigint,month_key text,status text,primary key(emp_id,month_key));",
 "create table public.payroll_control_approvals(id uuid default gen_random_uuid(),approved_at timestamptz,approved_by_name text,employee_id text,month_key text,status text,primary key(employee_id,month_key));",
 "create table public.activities(row_id uuid default gen_random_uuid(),emp_id text,emp_id_2 text,activity_type text,activity_name text,"+dates+");",
 "create table public.course_meeting_instructor_history(activity_id uuid,meeting_date date,emp_id text);",
 "create table public.course_meeting_cancellations(activity_id uuid,meeting_date date);",
 "create table public.instructor_training_schedule(emp_id bigint,training_date date,course_name text,is_online boolean);",
 "create or replace function public.scheduling_cached_travel_route(origin text,destination text) returns table(duration_minutes integer,distance_km numeric) language sql stable as $travel_fixture$select null::integer as duration_minutes,null::numeric as distance_km$travel_fixture$;"
 ].join('\n'));
 const funcs=[
 ['supabase/migrations/20260828223936_attendance_retention_foundation.sql','av2_attendance_month_is_closed'],
 ['supabase/migrations/20260828223936_attendance_retention_foundation.sql','av2_guard_attendance_record_lifecycle'],
 ['supabase/migrations/20260629120100_sync_auth_email_and_login_lookup_ids.sql','lookup_login_user_by_username'],
 ['supabase/migrations/20261004180500_employee_self_submit_after_admin_reopen.sql','av2_can_write_month'],
 ['supabase/migrations/20261104001600_daily_travel_route_integrity.sql','av2_daily_travel_route_matches'],
 ['supabase/migrations/20261104001500_daily_travel_cache_only_preview.sql','av2_preview_daily_travel'],
 ['supabase/migrations/20261104003500_instructor_travel_assigned_day_list.sql','av2_list_instructor_travel_days'],
 ['supabase/migrations/20261108223000_instructor_travel_saved_state_and_transit.sql','av2_get_daily_travel'],
 ['supabase/migrations/20261108223000_instructor_travel_saved_state_and_transit.sql','av2_save_daily_travel'],
 ['supabase/migrations/20261109213026_include_saved_travel_months_after_last_attendance_deleted.sql','av2_list_instructor_saved_travel_months']
 ];
 for(const [path,name] of funcs){
   const source=await readFile(new URL('../../'+path,import.meta.url),'utf8');
   await db.query(extract(source,name));
   await db.query("do $q$ declare f regprocedure;begin for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname='"+name+"' loop execute format('revoke all on function %s from public,anon',f);execute format('grant execute on function %s to authenticated',f);end loop;end $q$;");
 }
 await db.query("grant execute on function public.lookup_login_user_by_username(text) to anon");
 for(const table of ['users','attendance_records','attendance_daily_travel_reports'])
   await db.query('alter table public.'+table+' enable row level security');
 await db.query(await readFile(new URL('../../supabase/migrations/20261110194220_attendance_atomic_historical_travel.sql',import.meta.url),'utf8'));
 await db.query(await readFile(new URL('../../supabase/migrations/20261109224947_delete_linked_travel_cancellation_with_attendance.sql',import.meta.url),'utf8'));
 await db.query('create trigger av2_guard_attendance_record_lifecycle before insert or update or delete on attendance_records for each row execute function av2_guard_attendance_record_lifecycle();create trigger av2_mark_daily_travel_after_attendance_delete after delete on attendance_records for each row execute function av2_mark_daily_travel_after_attendance_delete()');
 await db.query(`
 create table public.attendance_record_attachments(id uuid primary key default gen_random_uuid(),record_id uuid references public.attendance_records(id) on delete cascade,storage_path text,file_name text,file_type text,file_size bigint);
 create policy own_user on public.users for select to authenticated using(auth_user_id=auth.uid());
 create policy own_attendance on public.attendance_records to authenticated
 using(emp_id=(select emp_id::bigint from public.users where auth_user_id=auth.uid()))
 with check(emp_id=(select emp_id::bigint from public.users where auth_user_id=auth.uid()) and public.av2_can_write_month(report_date));
 alter table public.attendance_month_approvals enable row level security;
 create policy own_month on public.attendance_month_approvals for select to authenticated using(emp_id=(select emp_id::bigint from public.users where auth_user_id=auth.uid()));
 create or replace function auth.uid() returns uuid language sql stable as $uid$select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub'))::uuid$uid$;
 grant usage on schema auth to authenticated,anon,service_role;
 grant execute on function auth.uid() to authenticated,anon,service_role;
 `);
 await db.query(`
 create table public.attendance_operation_options(id text primary key,label text,active boolean,sort_order integer,is_other boolean,address text);
 insert into public.attendance_operation_options values('team','צוות',true,1,false,'כתובת בדיקה 2');
 create function public.av2_get_instructor_activities(p_emp_id bigint,p_activity_seasons text[]) returns jsonb language sql stable as $directory$select '[]'::jsonb$directory$;
 create function public.av2_get_all_authority_school_list() returns jsonb language sql stable as $directory$select '[]'::jsonb$directory$;
 create function public.av2_get_authority_school_list(p_emp_id bigint) returns jsonb language sql stable as $directory$select '[]'::jsonb$directory$;
 alter table public.instructor_training_schedule add column id uuid default gen_random_uuid(),add column course_id bigint,add column start_time time,add column end_time time,add column location_name text,add column location_address text,add column participant_scope text,add column is_active boolean default true;
 `);
 await db.query('grant select,insert,update,delete on all tables in schema public to authenticated,service_role;grant usage,select on all sequences in schema public to authenticated,service_role');
 await db.query("notify pgrst, 'reload schema'");
}
export async function instructor(emp,day){
 const email='travel-qa-'+emp+'@example.test',password='Local-Only-'+randomUUID();
 const created=ok(await admin.auth.admin.createUser({email,password,email_confirm:true}),'create local auth user');
 const id=created.user.id;
 await db.query("insert into public.users(user_id,auth_user_id,username,role,full_name,emp_id,auth_email)values($1,$2,$1,'instructor','מדריך בדיקה',$1,$3)",[String(emp),id,email]);
 await db.query('insert into public.contacts_instructors(emp_id,address,full_name)values($1,$2,$3)',[emp,'כתובת בדיקה 1','מדריך בדיקה']);
 if(day)await db.query("insert into public.attendance_records(emp_id,report_date,activity_type,start_time,end_time,school_name_snapshot,destination_address_snapshot)values($1,$2,'הדרכה','08:30','10:00','בית ספר בדיקה','כתובת בדיקה 2')",[emp,day]);
 const client=anonymous();
 const lookup=ok(await client.rpc('lookup_login_user_by_username',{p_username:String(emp)}),'employee number lookup');
 assert.equal(lookup.length,1);assert.equal(lookup[0].auth_email,email);
 const login=ok(await client.auth.signInWithPassword({email:lookup[0].auth_email,password}),'real local Auth sign-in');
 assert.equal(login.user.id,id);
 return {emp,client,email,password};
}

// Reproduce the captured production access contract without any production rows.
// Install after seeding: the capture includes real INSERT assignment triggers.
export async function installProductionContract(){
 const c=JSON.parse(await readFile(new URL('../fixtures/attendance-production-contract-20261110.json',import.meta.url),'utf8'));
 const quote=value=>'"'+value.replaceAll('"','""')+'"';
 await db.query(`alter table users add column if not exists permissions jsonb default '{}'::jsonb;
 alter table attendance_records add column if not exists source_attendance_record_id uuid;
 alter table attendance_month_approvals add column if not exists manager_approved_at timestamptz;
 create schema if not exists private;create schema if not exists attendance_private;
 create table if not exists public.profiles(id uuid primary key,role text,is_active boolean,can_access_personal_reports boolean);`);
 for(const table of [...new Set(c.columns.map(x=>x.table))]){
  await db.query('create table if not exists public.'+quote(table)+'('+c.columns.filter(x=>x.table===table).map(x=>quote(x.column)+' '+x.type).join(',')+')');
 }
 const first=['public.app_current_role','public.app_user_can_manage_users','public.current_user_is_admin','private.dashboard_user_can_access_personal_reports','private.dashboard_user_can_manage_personal_reports','attendance_private.course_work','attendance_private.normalize_course_paid_hours'];
 const defs=new Map(c.functions.map(x=>[x.name,x.definition]));
 for(const name of [...first,...c.functions.map(x=>x.name).filter(x=>!first.includes(x))])await db.query(defs.get(name));
 const policies=await db.query("select tablename,policyname from pg_policies where schemaname='public' and tablename in ('users','attendance_records')");
 for(const p of policies.rows)await db.query('drop policy '+quote(p.policyname)+' on public.'+quote(p.tablename));
 for(const p of c.policies){
  const sql='create policy '+quote(p.name)+' on public.'+quote(p.table)+' as '+p.permissive+' for '+p.cmd+' to '+p.roles.map(x=>x==='public'?'public':quote(x)).join(',')+(p.qual?' using ('+p.qual+')':'')+(p.check?' with check ('+p.check+')':'');
  await db.query(sql);
 }
 // Match the important production distinction: users has column grants, not SELECT *.
 await db.query('revoke all on public.users from authenticated');
 const columns=c.grants.map(x=>x.column).filter(x=>['user_id','auth_user_id','username','role','is_active','full_name','name','emp_id','auth_email','migrated_to_auth','permissions'].includes(x));
 await db.query('grant select('+columns.map(quote).join(',')+') on public.users to authenticated');
 await db.query('grant usage on schema private,attendance_private to authenticated');
 const triggers=await db.query("select tgname from pg_trigger where tgrelid='public.attendance_records'::regclass and not tgisinternal");
 for(const row of triggers.rows)await db.query('drop trigger '+quote(row.tgname)+' on attendance_records');
 for(const sql of c.triggers)await db.query(sql);
 await db.query("notify pgrst, 'reload schema'");
 return c;
}
