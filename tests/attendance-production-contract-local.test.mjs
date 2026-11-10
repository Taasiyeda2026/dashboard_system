// Manual-only: original production policies, grants and attendance triggers,
// synthetic users/rows in the disposable runtime. Never executes on production.
import test from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {bootstrap,instructor,db,ok,installProductionContract} from './helpers/attendance-stability-local.mjs';

test('new historical RPC under captured production policies and triggers',async t=>{
 try{
  await bootstrap();
  const owner=await instructor(99020,null),other=await instructor(99021,null);
  await db.query("insert into attendance_month_approvals(emp_id,month_key,status)values($1,'2026-10','reopened')",[owner.emp]);
  await db.query("insert into attendance_records(emp_id,report_date,activity_type,total_hours,roundtrip_km,cancellation_before_minutes,cancellation_after_minutes)values($1,'2026-10-20','קורס',1,10,5,5),($1,'2026-10-20','תפעול',1,20,5,5)",[owner.emp]);
  await installProductionContract();
  const rows=ok(await owner.client.from('attendance_records').select().eq('emp_id',owner.emp).order('roundtrip_km'),'read');
  const changes=rows.map((r,i)=>({id:r.id,expected_updated_at:r.updated_at,payload:{roundtrip_km:30+i,cancellation_before_minutes:5,cancellation_after_minutes:5}}));
  const save=(client=owner.client,items=changes)=>client.rpc('av2_save_historical_travel_batch',{p_emp_id:owner.emp,p_date:'2026-10-20',p_changes:items});
  await t.test('column-only users grants and production instructor ownership allow reopened historical batch',async()=>{
   const grant=await db.query("select has_table_privilege('authenticated','public.users','select') as whole,has_column_privilege('authenticated','public.users','role','select') as col");
   assert.equal(grant.rows[0].whole,false);assert.equal(grant.rows[0].col,true);
   assert.equal(ok(await save(),'historical save').length,2);
  });
  await t.test('another instructor, generated records and closed payroll month remain protected',async()=>{
   assert.ok((await save(other.client)).error);
   await db.query("insert into payroll_control_approvals(employee_id,month_key,status)values($1,'2026-10','approved_for_payroll')",[String(owner.emp)]);
   assert.ok((await save()).error);
   await db.query('delete from payroll_control_approvals where employee_id=$1',[String(owner.emp)]);
   // Existing generated rows cannot be selected FOR UPDATE by instructor policies.
   await db.query("select set_config('app.av2_compensation_write','1',false)");
   await db.query("update attendance_records set generation_kind='travel_time_cancellation' where id=$1",[rows[0].id]);
   assert.ok((await save()).error);
   await db.query('update attendance_records set generation_kind=null where id=$1',[rows[0].id]);
  });
  await t.test('reviewed cancellation trigger rejects a batch without partially saving other kilometres',async()=>{
   await db.query("insert into attendance_travel_compensations(source_attendance_record_id,emp_id,review_status)values($1,$2,'approved')",[rows[1].id,owner.emp]);
   const current=ok(await owner.client.from('attendance_records').select().eq('emp_id',owner.emp),'current');
   const invalid=changes.map((change,i)=>({...change,expected_updated_at:current.find(r=>r.id===change.id).updated_at,payload:{...change.payload,roundtrip_km:99,cancellation_before_minutes:i===1?10:5}}));
   assert.ok((await save(owner.client,invalid)).error);
   const after=ok(await owner.client.from('attendance_records').select('roundtrip_km').eq('emp_id',owner.emp),'after');
   assert.deepEqual(after.map(x=>Number(x.roundtrip_km)).sort(),[30,31]);
  });
  await t.test('migration can be applied twice and does not grant anon access or bypass RLS',async()=>{
   const source=await readFile(new URL('../supabase/migrations/20261110194220_attendance_atomic_historical_travel.sql',import.meta.url),'utf8');
   await db.query(source);await db.query(source);
   const result=await db.query("select prosecdef,has_function_privilege('anon',oid,'execute') as anon,has_function_privilege('authenticated',oid,'execute') as authenticated from pg_proc where proname='av2_save_historical_travel_batch'");
   assert.deepEqual(result.rows,[{prosecdef:false,anon:false,authenticated:true}]);
   assert.equal(ok(await save(),'idempotent batch').length,2);
  });
 }finally{await db.end();}
});
