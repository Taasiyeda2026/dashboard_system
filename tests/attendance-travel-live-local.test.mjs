// Disposable local Supabase Auth/PostgREST test. Refuse all non-local destinations.
// Uses original server RPC source definitions; no production data or remote writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import pg from 'pg';

const wd='work/attendance-travel-qa';
const status=JSON.parse(execFileSync('supabase',['status','--workdir',wd,'--output','json'],{encoding:'utf8'}));
for(const value of [status.API_URL,status.DB_URL]){
  assert.ok(value,'Local URL required');
  assert.ok(['127.0.0.1','localhost'].includes(new URL(value).hostname),'Remote connection forbidden');
}
const db=new pg.Client({connectionString:status.DB_URL});
await db.connect();
const admin=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const anonymous=()=>createClient(status.API_URL,status.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});

function extract(source,name){
 const m=new RegExp('create\\s+or\\s+replace\\s+function\\s+public\\.'+name+'\\s*\\(','i').exec(source);
 assert.ok(m,'Missing RPC '+name);
 const tail=source.slice(m.index);
 const tagged=/\bas\s+(\$[a-z0-9_]*\$)/i.exec(tail);
 assert.ok(tagged,'Missing body '+name);
 const end=tail.indexOf(tagged[1]+';',tagged.index+tagged[0].length);
 assert.ok(end>0,'Missing terminator '+name);
 return tail.slice(0,end+tagged[1].length+1);
}
const ok=(result,label)=>{if(result.error)throw Error(label+': '+result.error.message);return result.data;};

async function bootstrap(){
 const dates=Array.from({length:35},(_,i)=>'date_'+(i+1)+' date').join(',');
 await db.query([
 "create table public.users(user_id text primary key,auth_user_id uuid unique references auth.users(id),username text,role text,is_active boolean default true,full_name text,name text,emp_id text,auth_email text,migrated_to_auth boolean default true);",
 "create table public.contacts_instructors(emp_id bigint primary key,address text,full_name text,direct_manager text);",
 "create table public.schools(id uuid primary key default gen_random_uuid(),route_verified_address text);",
 "create table public.attendance_records(id uuid primary key default gen_random_uuid(),emp_id bigint,report_date date,generation_kind text,activity_type text,training_mode text,operation_meeting_mode text,start_time time,end_time time,school_id uuid,destination_address_snapshot text,school_name_snapshot text,authority_name_snapshot text,activity_name_snapshot text);",
 "create table public.attendance_daily_travel_reports(emp_id bigint,travel_date date,legs jsonb default '[]'::jsonb,no_travel boolean default false,total_km numeric,cancellation_minutes integer,public_transport_cost numeric,review_status text,reported_by uuid,reported_at timestamptz default now(),updated_at timestamptz default now(),approved_km numeric,approved_public_transport_cost numeric,approved_cancellation_minutes integer,review_by uuid,review_at timestamptz,review_note text,primary key(emp_id,travel_date));",
 "create table public.attendance_daily_travel_audit(id bigint generated always as identity primary key,emp_id bigint,travel_date date,previous_status text,previous_approved_km numeric,previous_approved_cancellation_minutes integer,previous_approved_public_transport_cost numeric,reason text,actor uuid);",
 "create table public.attendance_month_approvals(emp_id bigint,month_key text,status text,primary key(emp_id,month_key));",
 "create table public.payroll_control_approvals(employee_id text,month_key text,status text,primary key(employee_id,month_key));",
 "create table public.activities(row_id uuid default gen_random_uuid(),emp_id text,emp_id_2 text,activity_type text,activity_name text,"+dates+");",
 "create table public.course_meeting_instructor_history(activity_id uuid,meeting_date date,emp_id text);",
 "create table public.course_meeting_cancellations(activity_id uuid,meeting_date date);",
 "create table public.instructor_training_schedule(emp_id bigint,training_date date,course_name text,is_online boolean);",
 "create or replace function public.scheduling_cached_travel_route(origin text,destination text) returns table(duration_minutes integer,distance_km numeric) language sql stable as $select null::integer as duration_minutes,null::numeric as distance_km$;"
 ].join('\n'));
 const funcs=[
 ['supabase/migrations/20260629120100_sync_auth_email_and_login_lookup_ids.sql','lookup_login_user_by_username'],
 ['supabase/migrations/20261004180500_employee_self_submit_after_admin_reopen.sql','av2_can_write_month'],
 ['supabase/migrations/20261104001600_daily_travel_route_integrity.sql','av2_daily_travel_route_matches'],
 ['supabase/migrations/20261104001500_daily_travel_cache_only_preview.sql','av2_preview_daily_travel'],
 ['supabase/migrations/20261104003500_instructor_travel_assigned_day_list.sql','av2_list_instructor_travel_days'],
 ['supabase/migrations/20261108223000_instructor_travel_saved_state_and_transit.sql','av2_get_daily_travel'],
 ['supabase/migrations/20261108223000_instructor_travel_saved_state_and_transit.sql','av2_save_daily_travel']
 ];
 for(const [path,name] of funcs){
   const source=await readFile(path,'utf8');
   await db.query(extract(source,name));
   await db.query("do $q$ declare f regprocedure;begin for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname='"+name+"' loop execute format('revoke all on function %s from public,anon',f);execute format('grant execute on function %s to authenticated',f);end loop;end $q$;");
 }
 await db.query("grant execute on function public.lookup_login_user_by_username(text) to anon");
 for(const table of ['users','attendance_records','attendance_daily_travel_reports'])
   await db.query('alter table public.'+table+' enable row level security');
 await db.query("notify pgrst, 'reload schema'");
}
async function instructor(emp,day){
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
 return {emp,client};
}

test('real local Auth, assigned days, travel preview, save, read and authorization',async()=>{
 try{
   await bootstrap();
   const day='2026-11-10',employee=await instructor(99002,day);
   const outsider=await instructor(99003,null);
   const days=ok(await employee.client.rpc('av2_list_instructor_travel_days',
     {p_from:'2026-11-01',p_to:day}),'travel days');
   assert.ok(days.some(x=>x.date===day&&x.ready));
   const preview=ok(await employee.client.rpc('av2_preview_daily_travel',{p_date:day}),'preview');
   assert.deepEqual(preview.map(x=>x.kind),['outbound','return']);
   const legs=preview.map((x,i)=>({...x,mode:'car',minutes:i?55:70,kilometers:i?18:19,transportCost:0}));
   const data=ok(await employee.client.rpc('av2_save_daily_travel',
     {p_date:day,p_legs:legs,p_no_travel:false}),'save daily travel');
   assert.equal(data.travel_date,day);
   assert.equal(Number(data.total_km),37);
   assert.equal(Number(data.cancellation_minutes),35);
   const reports=ok(await employee.client.rpc('av2_get_daily_travel',
     {p_emp_id:employee.emp,p_from:day,p_to:day}),'read daily travel');
   assert.equal(reports.length,1);
   assert.equal(reports[0].review_status,'pending_review');
   ok(await employee.client.rpc('av2_save_daily_travel',
     {p_date:day,p_legs:legs,p_no_travel:false}),'repeat same report');
   const count=await db.query('select count(*)::integer as n from public.attendance_daily_travel_reports where emp_id=$1 and travel_date=$2',[employee.emp,day]);
   assert.equal(count.rows[0].n,1,'No duplicate daily report');
   const forbidden=await outsider.client.rpc('av2_get_daily_travel',
     {p_emp_id:employee.emp,p_from:day,p_to:day});
   assert.ok(forbidden.error,'Other instructor must not read employee report');
   const forbiddenSave=await outsider.client.rpc('av2_save_daily_travel',
     {p_date:day,p_legs:legs,p_no_travel:false});
   assert.ok(forbiddenSave.error,'Other instructor must not save for day without attendance');
   await db.query("insert into public.attendance_month_approvals(emp_id,month_key,status)values($1,'2026-11','submitted')",[employee.emp]);
   const locked=await employee.client.rpc('av2_save_daily_travel',
     {p_date:day,p_legs:legs,p_no_travel:false});
   assert.ok(locked.error,'Locked month must reject updates');
   const unchanged=await db.query('select total_km,cancellation_minutes from public.attendance_daily_travel_reports where emp_id=$1',[employee.emp]);
   assert.equal(Number(unchanged.rows[0].total_km),37);
   assert.equal(Number(unchanged.rows[0].cancellation_minutes),35);
 }finally{await db.end();}
});
