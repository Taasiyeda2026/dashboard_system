import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeadlineFetch} from '../attendance/src/services/request-deadline.js';
import {confirmedMutation,recordMatchesPayload} from '../attendance/src/services/confirmed-mutation.js';

test('shared transport releases a request that never returns, aborts and does not retry',async()=>{
 let calls=0,signal;
 const fetch=createDeadlineFetch((_input,init)=>{calls++;signal=init.signal;return new Promise(()=>{});},15);
 await assert.rejects(fetch('https://local.test'),{name:'AttendanceTimeoutError'});
 assert.equal(calls,1);assert.equal(signal.aborted,true);
});
test('shared transport also bounds a response body stalled after HTTP headers',async()=>{
 const fetch=createDeadlineFetch(async()=>new Response(new ReadableStream({start(){}})),15);
 await assert.rejects(fetch('https://local.test'),{name:'AttendanceTimeoutError'});
});
test('shared transport preserves success, error status and caller cancellation',async()=>{
 const fetch=createDeadlineFetch(async(_input,init)=>{
  assert.equal(init.signal.aborted,true);
  return new Response('{"message":"forbidden"}',{status:403,headers:{'Content-Type':'application/json'}});
 },100);
 const ac=new AbortController();ac.abort();
 const response=await fetch('https://local.test',{signal:ac.signal});
 assert.equal(response.status,403);assert.equal((await response.json()).message,'forbidden');
 const empty=await createDeadlineFetch(async()=>new Response(null,{status:204}),100)('https://local.test');
 assert.equal(empty.status,204);
});
test('a lost mutation response is confirmed without issuing another write',async()=>{
 let writes=0,reads=0;
 const row={id:'stable-id',roundtrip_km:20};
 const result=await confirmedMutation(async()=>{writes++;throw new Error('network');},async()=>{reads++;return row;});
 assert.equal(result,row);assert.equal(writes,1);assert.equal(reads,1);
});
test('failed confirmation never claims success or automatically repeats a write',async()=>{
 let writes=0;
 await assert.rejects(confirmedMutation(async()=>{writes++;throw new Error('network');},async()=>{throw new Error('offline');}),/לא ניתן לאמת/);
 assert.equal(writes,1);
 await assert.rejects(confirmedMutation(async()=>{throw new Error('denied');},async()=>null),/denied/);
});
test('update confirmation matches every supplied field including nested values',()=>{
 assert.equal(recordMatchesPayload({a:1,b:{z:2,y:3}},{a:1,b:{y:3,z:2}}),true);
 assert.equal(recordMatchesPayload({a:1},{a:2}),false);
 assert.equal(recordMatchesPayload(null,{a:1}),false);
 assert.equal(recordMatchesPayload({start_time:'08:30:00',end_time:'10:00:00'},{start_time:'08:30',end_time:'10:00'}),true);
});

test('file transfer gets a longer but finite deadline while control calls stay short',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let signal;
 const fetch=createDeadlineFetch((_url,init)=>{signal=init.signal;return new Promise(()=>{});},20,{storageTimeoutMs:180});
 const pending=fetch('https://local.test/storage/v1/object/attendance-attachments/file.pdf',{method:'POST'});
 const rejected=assert.rejects(pending,{name:'AttendanceTimeoutError'});
 t.mock.timers.tick(21);assert.equal(signal.aborted,false);
 t.mock.timers.tick(160);await rejected;assert.equal(signal.aborted,true);
 const control=fetch('https://local.test/storage/v1/object/list/attendance-attachments',{method:'POST'});
 const short=assert.rejects(control,{name:'AttendanceTimeoutError'});
 t.mock.timers.tick(21);await short;
});
