// Only disposable localhost PostgreSQL. Anonymous inputs, no production writes.
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { decisionInput } from './new-engine-input.mjs';
const {s,routes,input}=await decisionInput(process.env.DECISION_DIR);
const c=new pg.Client({connectionString:'postgresql://postgres:isolated-test-only@127.0.0.1:55439/codex_engine_decision'});await c.connect();
await c.query("BEGIN");
await c.query(`alter table public.activities add column activity_type text;
 alter table public.instructor_scheduling_profiles add column friday_allowed boolean;
 alter table public.school_calendar add column blocks_scheduling boolean,add column enforce_end_time boolean,add column school_day_end_time time;
 alter table public.scheduling_travel_cache add column origin_key text,add column destination_key text;
 create or replace function public.school_calendar_sector_for_school_id(p_school_id bigint) returns text language sql stable as $$ select sector from public.schools where id=p_school_id $$;
 create or replace function public.scheduling_activity_official_meetings(p_activity public.activities) returns jsonb language sql immutable as $$ select coalesce(jsonb_agg(jsonb_build_object('date',nullif(to_jsonb(p_activity)->>('date_'||n),''),'start_time',p_activity.start_time,'end_time',p_activity.end_time,'meeting_no',n) order by n),'[]'::jsonb) from generate_series(1,35)n where nullif(to_jsonb(p_activity)->>('date_'||n),'') is not null $$;
 create table if not exists public.course_meeting_instructor_history(activity_id text,meeting_date date,emp_id text);
 create or replace function public.app_has_permission(p_permission text) returns boolean language sql stable as $$ select current_setting('test.role',true) in ('admin','operation_manager') $$;`);
await c.query("select set_config('test.uid','11111111-1111-4111-8111-111111111111',false),set_config('test.role','admin',false)");
async function insert(table, rows) {
 const allowed=(await c.query('select column_name from information_schema.columns where table_schema=$1 and table_name=$2',['public',table])).rows.map(r=>r.column_name);
 const keys=allowed.filter(k=>rows.some(r=>Object.hasOwn(r,k)));if(!keys.length||!rows.length)return;
 const columns=keys.map(k=>'"'+k.replaceAll('"','""')+'"').join(',');
 await c.query(`insert into public."${table}" (${columns}) select ${columns} from jsonb_populate_recordset(null::public."${table}",$1::jsonb)`,[JSON.stringify(rows)]);
}
await insert('contacts_instructors',s.contacts_instructors.map(r=>({...r,full_name:'Instructor '+r.emp_id})));
await insert('instructor_scheduling_profiles',s.instructor_scheduling_profiles);
await insert('instructor_availability_rules',s.instructor_availability_rules);
await insert('instructor_availability_exceptions',s.instructor_availability_exceptions);
const locations=new Map(input.activities.map(a=>[String(a.school_id),a]));
await insert('schools',s.schools.map(r=>({...r,institution_address:locations.get(String(r.id))?.school_address||r.institution_address,sector:locations.get(String(r.id))?.calendar_sector||r.sector})));
await insert('school_calendar',s.school_calendar.map((r,i)=>({...r,id:i+1}))); 
await insert('proposal_activity_pricing',s.proposal_activity_pricing.map((r,i)=>({...r,id:i+1})));
await insert('activities',s.activities);
await insert('course_meeting_instructor_history',s.course_meeting_instructor_history || []);
await insert('course_meeting_cancellations',(s.course_meeting_cancellations || []).map((r,i)=>({...r,id:i+1})));
const unique=new Map(routes.map(r=>[r.origin_key+'|'+r.destination_key,r]));
await insert('scheduling_travel_cache',[...unique.values()].map((r,i)=>({...r,id:i+1})));
const migration=await readFile(new URL('../../supabase/migrations/20261009233840_scheduling_v37_trusted_plan_validation.sql',import.meta.url),'utf8');await c.query(migration);
await c.query("COMMIT");
console.log(JSON.stringify({isolated:true,activities:s.activities.length,routes:unique.size,migrationAppliedLocally:true}));await c.end();
