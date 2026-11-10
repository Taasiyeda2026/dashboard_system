// Manual-only integration suite. ATTENDANCE_STABILITY_STATUS must identify an
// empty disposable local runtime; the helper rejects all non-local URLs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {bootstrap,instructor,db,ok} from './helpers/attendance-stability-local.mjs';

test('real local Auth/PostgREST: attendance lifecycle, atomic history, payroll gates and isolation',async t=>{
 try{
  await bootstrap();
  const employee=await instructor(99002,'2026-11-10');
  const outsider=await instructor(99003,null);
  const client=employee.client;
  await t.test('authenticated instructor creates, edits, reads and deletes own attendance',async()=>{
   const row=ok(await client.from('attendance_records').insert({emp_id:employee.emp,report_date:'2026-11-10',activity_type:'הדרכה',start_time:'11:00',end_time:'12:00',total_hours:1}).select().single(),'create');
   const edited=ok(await client.from('attendance_records').update({notes:'בדיקה'}).eq('id',row.id).select().single(),'update');
   assert.equal(edited.notes,'בדיקה');
   const forbidden=await outsider.client.from('attendance_records').update({notes:'אסור'}).eq('id',row.id).select();
   assert.deepEqual(forbidden.data,[]);
   const deleted=ok(await client.from('attendance_records').delete().eq('id',row.id).select(),'delete');assert.equal(deleted.length,1);
  });
  await t.test('real daily travel RPC saves twice without duplicates and blocks other instructor',async()=>{
   const legs=ok(await client.rpc('av2_preview_daily_travel',{p_date:'2026-11-10'}),'preview').map(x=>({...x,mode:'car',minutes:70,kilometers:20,transportCost:0}));
   for(let i=0;i<2;i++){
    const result=ok(await client.rpc('av2_save_daily_travel',{p_date:'2026-11-10',p_legs:legs,p_no_travel:false}),'save');
    assert.equal(Number(result.total_km),40);assert.equal(Number(result.cancellation_minutes),50);
   }
   assert.equal(ok(await client.rpc('av2_get_daily_travel',{p_emp_id:employee.emp,p_from:'2026-11-10',p_to:'2026-11-10'}),'read').length,1);
   assert.ok((await outsider.client.rpc('av2_get_daily_travel',{p_emp_id:employee.emp,p_from:'2026-11-10',p_to:'2026-11-10'})).error);
  });
  const oldDay='2026-10-20';
  await db.query("insert into attendance_month_approvals(emp_id,month_key,status)values($1,'2026-10','reopened')",[employee.emp]);
  const rows=(await db.query("insert into attendance_records(emp_id,report_date,activity_type,roundtrip_km,cancellation_before_minutes,cancellation_after_minutes)values($1,$2,'הדרכה',10,5,5),($1,$2,'הדרכה',20,10,10)returning *",[employee.emp,oldDay])).rows;
  for(const row of rows){const exact=ok(await client.from('attendance_records').select('updated_at').eq('id',row.id).single(),'version');row.updated_at=exact.updated_at;}
  const changes=rows.map((row,i)=>({id:row.id,expected_updated_at:row.updated_at,payload:{roundtrip_km:30+i,cancellation_before_minutes:15,cancellation_after_minutes:20}}));
  const rpc=items=>client.rpc('av2_save_historical_travel_batch',{p_emp_id:employee.emp,p_date:oldDay,p_changes:items});
  await t.test('historical batch rolls back every row when one row is invalid',async()=>{
   const invalid=structuredClone(changes);invalid[1].payload.roundtrip_km=-1;
   assert.ok((await rpc(invalid)).error);
   const actual=(await db.query('select roundtrip_km from attendance_records where id=any($1::uuid[])order by roundtrip_km',[rows.map(r=>r.id)])).rows;
   assert.deepEqual(actual.map(r=>Number(r.roundtrip_km)),[10,20]);
  });
  await t.test('historical batch commits in full and repeated submission is a no-op',async()=>{
   assert.equal(ok(await rpc(changes),'batch').length,2);
   const before=(await db.query('select id,updated_at from attendance_records where id=any($1::uuid[])order by id',[rows.map(r=>r.id)])).rows;
   ok(await rpc(changes),'repeat');
   const after=(await db.query('select id,updated_at from attendance_records where id=any($1::uuid[])order by id',[rows.map(r=>r.id)])).rows;
   assert.deepEqual(after,before);
  });
  await t.test('stale, unauthorized and locked historical updates cannot change data',async()=>{
   const stale=structuredClone(changes);stale[0].payload.roundtrip_km=44;
   assert.ok((await rpc(stale)).error);
   assert.ok((await outsider.client.rpc('av2_save_historical_travel_batch',{p_emp_id:employee.emp,p_date:oldDay,p_changes:changes})).error);
   await db.query("update attendance_month_approvals set status='submitted' where emp_id=$1 and month_key='2026-10'",[employee.emp]);
   assert.ok((await rpc(changes)).error);
  });
 }finally{await db.end();}
});
