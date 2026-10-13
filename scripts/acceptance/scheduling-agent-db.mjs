// Isolated PostgreSQL harness. Existing scheduling RPCs are transactional stubs;
// this verifies the new approval wrapper, not the full production scheduler.
// PGLITE_MODULE points at an installed @electric-sql/pglite 0.5.9 module.
import {readFileSync,readdirSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
if(!process.env.PGLITE_MODULE)throw Error('PGLITE_MODULE is required; do not run this against production');
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite();
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const hash='a'.repeat(64),key='33333333-3333-4333-8333-333333333333';
const dates=Array.from({length:35},(_,i)=>`date_${i+1} date`).join(',');
await db.exec(`
 create role anon;create role authenticated;
 create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('test.jwt',true),''),'{}')::jsonb$$;
 create function public.app_has_permission(text) returns boolean language sql stable as $$select coalesce(current_setting('test.permission',true),'true')='true'$$;
 create function public.app_current_role() returns text language sql stable as $$select coalesce(nullif(current_setting('test.role',true),''),'admin')$$;
 create table public.users(auth_user_id uuid,is_active boolean);
 create table public.activities(row_id text primary key,activity_season text,status text,activity_type text,activity_no text,activity_name text,school_id bigint,school text,authority text,
 emp_id bigint,emp_id_2 text,instructor_name text,start_date date,end_date date,start_time time,end_time time,sessions text,updated_at timestamptz,instructor_assignment_locked boolean default false,draft_emp_id text,activity_manager text,instruction_language text,${dates});
 create table public.scheduling_planning_source_state(singleton boolean primary key,revision bigint);
 create table public.scheduling_planning_workspaces(id uuid primary key,period_key text,district text,revision bigint,engine_version text,validated_source_revision bigint,calculated_at timestamptz);
 create table public.scheduling_planning_rows(workspace_id uuid,activity_id text,row_data jsonb,locked_option jsonb,needs_recalc boolean,activity_updated_at timestamptz);
 create table test_events(event text);
 create function public.set_scheduling_planning_lock(text,text,text,jsonb,bigint) returns void language plpgsql as $$begin
  if $5<>(select revision from public.scheduling_planning_workspaces) then raise exception 'stub_revision_conflict'; end if;
  update public.scheduling_planning_rows set locked_option=$4 where activity_id=$3;
  update public.scheduling_planning_workspaces set revision=revision+1;
  insert into test_events values('lock');end$$;
 create function public.confirm_scheduling_planning_draft(text,text,text,bigint) returns public.activities language plpgsql as $$declare a public.activities;begin
  if current_setting('test.fail',true)='true' then raise exception 'stub_guard_failure';end if;
  update public.activities set emp_id=10,instructor_name='Instructor',start_date='2090-10-24',end_date='2090-10-24',updated_at=clock_timestamp() where row_id=$3 returning * into a;
  update public.scheduling_planning_source_state set revision=revision+1;
  insert into test_events values('assignment');return a;end$$;
`);
const root=new URL('../../',import.meta.url);
const migration=readdirSync(new URL('supabase/migrations/',root)).find(p=>p.endsWith('_scheduling_agent_approval_gateway.sql'));
await db.exec(readFileSync(new URL('supabase/migrations/'+migration,root),'utf8'));
const humanMigration=readdirSync(new URL('supabase/migrations/',root)).find(p=>p.endsWith('_scheduling_agent_human_approval_channel.sql'));
await db.exec(readFileSync(new URL('supabase/migrations/'+humanMigration,root),'utf8'));
async function reset(){await db.exec(`
 reset role;select set_config('test.uid','${owner}',false),set_config('test.role','admin',false),set_config('test.permission','true',false),set_config('test.fail','false',false),set_config('test.jwt','{}',false);
 truncate public.scheduling_agent_requests,public.activities,public.scheduling_planning_rows,public.scheduling_planning_workspaces,public.scheduling_planning_source_state,public.users,test_events;
 update public.scheduling_agent_control set enabled=false,approver_id='${owner}';
 insert into public.users values('${owner}',true),('${other}',true);
 insert into public.scheduling_planning_source_state values(true,442);
 insert into public.scheduling_planning_workspaces values('${owner}','year','',12070,'v37',439,now());
 insert into public.activities(row_id,activity_season,status,activity_type,activity_no,activity_name,school_id,school,authority,sessions,updated_at) values('course','school_2027','פתוח','course','6089','Program',1,'School','Authority','1','2026-10-13T00:00:00Z');
 insert into public.scheduling_planning_rows values('${owner}','course','{"options":[{"instructorEmpId":"10","eligible":true,"routeVerified":true,"meetings":[{"date":"2090-10-24","start_time":"08:00","end_time":"09:30"}]},{"instructorEmpId":"11","eligible":true,"routeVerified":true,"meetings":[{"date":"2090-10-24","start_time":"10:00","end_time":"11:30"}]}]}',null,false,'2026-10-13T00:00:00Z');
`);}
const q=async sql=>(await db.query(sql)).rows;
const preview=(revision=12070,source=442)=>q(`select public.scheduling_agent_preview('course',0,${revision},${source},'${hash}') as p`);
async function req(){return (await q(`select public.scheduling_agent_request_approval('course',0,12070,442,'${hash}','${key}') as r`))[0].r;}
async function approve(r){await q(`select public.scheduling_agent_approve('${r.requestId}','${r.previewHash}')`);}
const commit=(r,h=hash)=>q(`select public.scheduling_agent_commit_approved('${r.requestId}','${h}') as r`);
const cases=[
 ['migration enables RLS, denies anonymous execution and starts with writes off',async()=>{
  const rows=await q("select relrowsecurity from pg_class where relname in ('scheduling_agent_control','scheduling_agent_requests')");assert.equal(rows.every(r=>r.relrowsecurity),true);
  assert.equal((await q("select has_function_privilege('anon','public.scheduling_agent_read_snapshot()','execute') as allowed"))[0].allowed,false);
  assert.equal((await q('select enabled from public.scheduling_agent_control'))[0].enabled,false);
 }],
 ['owner binding and permission gate reject another active user',async()=>{await q(`select set_config('test.uid','${other}',false)`);await assert.rejects(preview(),/permission_denied/);}],
 ['anonymous and missing operational permission fail closed',async()=>{await q("select set_config('test.uid','',false)");await assert.rejects(preview(),/permission_denied/);await q(`select set_config('test.uid','${owner}',false),set_config('test.permission','false',false)`);await assert.rejects(preview(),/permission_denied/);}],
 ['read snapshot performs no planning writes and excludes arbitrary columns',async()=>{const snap=(await q('select public.scheduling_agent_read_snapshot() as s'))[0].s;assert.equal(snap.rows.length,1);assert.equal('activityManager' in snap.rows[0],true);assert.equal('instructionLanguage' in snap.rows[0],true);assert.equal((await q('select count(*)::int as n from test_events'))[0].n,0);assert.equal('private_notes' in snap.rows[0],false);}],
 ['workspace/source mismatches reject rather than override',async()=>{await assert.rejects(preview(12069),/revision_conflict/);await assert.rejects(preview(12070,441),/revision_conflict/);}],
 ['confirmed assignments and dirty proposals cannot enter preview',async()=>{await q("update public.activities set emp_id=10");await assert.rejects(preview(),/protected_assignment/);await db.exec("update public.activities set emp_id=null;update public.scheduling_planning_rows set needs_recalc=true");await assert.rejects(preview(),/stale_planning/);}],
 ['rolling seven-day start policy is evaluated at request time',async()=>{await q("update public.scheduling_planning_rows set row_data=jsonb_set(row_data,'{options,0,meetings,0,date}',to_jsonb(current_date::text))");await assert.rejects(preview(),/start_too_soon/);}],
 ['idempotent approval requests do not duplicate and cannot reuse a key for a different option',async()=>{const a=await req(),b=await req();assert.equal(a.requestId,b.requestId);await assert.rejects(q(`select public.scheduling_agent_request_approval('course',1,12070,442,'${hash}','${key}')`),/idempotency_conflict/);}],
 ['approval binds exact preview hash and admin identity',async()=>{const r=await req();await assert.rejects(q(`select public.scheduling_agent_approve('${r.requestId}','wrong')`),/approval_invalid/);await q("select set_config('test.role','operation_manager',false)");await assert.rejects(approve(r),/human_session_required/);}],
 ['OAuth agent tokens cannot grant human approval or read the operator queue',async()=>{const r=await req();await q(`select set_config('test.jwt','{"client_id":"mcp-agent"}',false)`);await assert.rejects(approve(r),/human_session_required/);await assert.rejects(q('select public.scheduling_agent_list_requests()'),/human_session_required/);await q("select set_config('test.jwt','{}',false)");assert.equal((await q('select public.scheduling_agent_list_requests() as q'))[0].q.length,1);}],
 ['default-off switch blocks every commit without modifying a course',async()=>{const r=await req();await approve(r);await assert.rejects(commit(r),/writes_disabled/);assert.equal((await q('select emp_id from public.activities'))[0].emp_id,null);}],
 ['pending and expired approvals cannot commit',async()=>{const r=await req();await q('update public.scheduling_agent_control set enabled=true');await assert.rejects(commit(r),/approval_required/);await approve(r);await q("update public.scheduling_agent_requests set expires_at=clock_timestamp()-interval '1 second'");await assert.rejects(commit(r),/approval_required/);}],
 ['changed sheet or new source revision invalidates approval',async()=>{const r=await req();await approve(r);await q('update public.scheduling_agent_control set enabled=true');await assert.rejects(commit(r,'b'.repeat(64)),/sheet_changed/);await q('update public.scheduling_planning_source_state set revision=443');await assert.rejects(commit(r),/revision_conflict/);}],
 ['scheduler failure rolls back selection and preserves unconsumed approval',async()=>{const r=await req();await approve(r);await db.exec("update public.scheduling_agent_control set enabled=true;select set_config('test.fail','true',false)");await assert.rejects(commit(r),/stub_guard_failure/);
  assert.equal((await q('select count(*)::int as n from test_events'))[0].n,0);assert.equal((await q('select state from public.scheduling_agent_requests'))[0].state,'approved');assert.equal((await q('select locked_option from public.scheduling_planning_rows'))[0].locked_option,null);
 }],
 ['commit is atomic and retried response never creates a second assignment',async()=>{const r=await req();await approve(r);await q('update public.scheduling_agent_control set enabled=true');const a=(await commit(r))[0].r,b=(await commit(r))[0].r;assert.deepEqual(a,b);assert.equal((await q("select count(*)::int as n from test_events where event='assignment'"))[0].n,1);
  assert.equal((await q(`select public.scheduling_agent_verify_commit('${r.requestId}') as v`))[0].v.matchesCommittedVersion,true);
 }],
 ['authenticated users cannot mutate approvals/control tables or call the inner owner helper',async()=>{await q('set role authenticated');await assert.rejects(q('update public.scheduling_agent_control set enabled=true'),/permission denied/);await assert.rejects(q('update public.scheduling_agent_requests set state=\'approved\''),/permission denied/);await assert.rejects(q('select public.scheduling_agent_assert_owner()'),/permission denied/);}],
];
for(const [name,fn] of cases)await test(name,async()=>{await reset();await fn();});
await db.close();
