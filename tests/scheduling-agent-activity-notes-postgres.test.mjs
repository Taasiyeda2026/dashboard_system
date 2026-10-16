import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const modulePath=process.env.PGLITE_MODULE_PATH;
test('activity notes PostgreSQL contracts',{skip:!modulePath},async t=>{
 const {PGlite}=await import(modulePath);const db=new PGlite();
 const uid='11111111-1111-4111-8111-111111111111';
 const rid=n=>`22222222-2222-4222-8222-${String(n).padStart(12,'0')}`;
 const read=async()=> (await db.query("select scheduling_agent_team_read_activity_notes('course-1') result")).rows[0].result;
 const append=async(note,version,id)=> (await db.query("select scheduling_agent_team_append_activity_note('course-1',$1,$2,$3) result",[note,version,id])).rows[0].result;
 try{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key);insert into auth.users values('${uid}');
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create function app_can_edit_direct() returns boolean language sql as $$select coalesce(current_setting('test.editor',true),'false')='true'$$;
 create function scheduling_agent_team_assert_member() returns void language plpgsql as $$begin if auth.uid() is null then raise exception 'permission_denied' using errcode='42501';end if;end$$;
 create table activities(row_id text primary key,activity_season text,activity_type text,school text,activity_name text,notes text,finance_notes text,operations_private_notes text,scheduling_note text,emp_id bigint,start_date date);
 insert into activities values('course-1','school_2027','course','Synthetic','Synthetic course','Existing text','Private finance','Private operations','Planning only',1,'2026-11-01');
 `);
 await db.exec(readFileSync(new URL('../supabase/migrations/20261016134025_scheduling_agent_activity_notes.sql',import.meta.url),'utf8'));
 await t.test('anonymous reads/writes and direct table access denied',async()=>{
  await assert.rejects(read(),/permission_denied/);
  const p=await db.query("select has_function_privilege('anon','scheduling_agent_team_append_activity_note(text,text,text,uuid)','execute') fn,has_table_privilege('authenticated','scheduling_activity_note_audit','select') tab");assert.equal(p.rows[0].fn,false);assert.equal(p.rows[0].tab,false);
 });
 await db.exec(`select set_config('test.uid','${uid}',false)`);
 await t.test('team reader can inspect general notes only but cannot write',async()=>{
  const r=await read();assert.equal(r.canAppendNotes,false);assert.equal(r.notes,'Existing text');assert.doesNotMatch(JSON.stringify(r),/Private|Planning only/);
  await assert.rejects(append('New',r.notesVersion,rid(1)),/activity_notes_permission_denied/);
 });
 await db.exec("select set_config('test.editor','true',false)");
 let firstVersion;
 await t.test('authorized non-admin editor appends without assignment changes',async()=>{
  firstVersion=(await read()).notesVersion;
  const r=await append('New',firstVersion,rid(1));assert.equal(r.notes,'Existing text\nNew');assert.equal(r.saved,true);assert.equal(r.assignmentChanged,false);
  const a=(await db.query('select * from activities')).rows[0];assert.equal(a.emp_id,1);assert.equal(a.start_date.toISOString().slice(0,10),'2026-11-01');assert.equal(a.finance_notes,'Private finance');assert.equal(a.operations_private_notes,'Private operations');assert.equal(a.scheduling_note,'Planning only');
  assert.equal((await db.query('select actor_id from scheduling_activity_note_audit')).rows[0].actor_id,uid);
 });
 await t.test('lost-ack retry is idempotent; changed payload and stale version rejected',async()=>{
  const r=await append('New',firstVersion,rid(1));assert.equal(r.alreadyApplied,true);assert.equal(r.notes,'Existing text\nNew');
  await assert.rejects(append('Different',firstVersion,rid(1)),/activity_notes_request_conflict/);
  await assert.rejects(append('Another',firstVersion,rid(2)),/activity_notes_version_conflict/);
  assert.equal((await db.query('select count(*)::int n from scheduling_activity_note_audit')).rows[0].n,1);
 });
 await t.test('concurrent external edit is preserved after reread; blank notes supported',async()=>{
  await db.exec("update activities set notes=notes || chr(10) || 'External edit'");
  const r=await append('Later',(await read()).notesVersion,rid(3));assert.equal(r.notes,'Existing text\nNew\nExternal edit\nLater');
  await db.exec('update activities set notes=null,start_date=null');
  assert.equal((await append('First',(await read()).notesVersion,rid(4))).notes,'First');
 });
 }finally{await db.close();}
});
