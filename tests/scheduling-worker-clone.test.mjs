import test from 'node:test';
import assert from 'node:assert/strict';
import {FunctionsHttpError} from '@supabase/supabase-js';
import {planningRouteReply,planningCloneError} from '../frontend/src/screens/course-scheduling-worker-protocol.js';
import {SchedulingPointWorker} from '../frontend/src/screens/course-scheduling-worker-client.js';
test('route replies strip uncloneable nested SDK context without changing route data',()=>{
 const error=new FunctionsHttpError(new Response('unavailable',{status:503}));error.code='route_unavailable';error.context.callback=()=>{};
 const data={batch_lookup:true,results:{pair:{calculated:true,duration_min:25,distance_km:15}}};const dto=planningRouteReply({data,error,response:new Response("sdk response")});
 assert.equal(dto.data,data);assert.deepEqual(dto.error,{message:error.message,code:'route_unavailable'});assert.deepEqual(structuredClone(dto),dto);assert.ok(error.context instanceof Response);
 assert.deepEqual(planningRouteReply({data,error:null,response:new Response('ok')}),{data,error:null});
});
test('nested callback in snapshot fails closed with field path and clear user error',async()=>{
 const client=new SchedulingPointWorker({createWorker:()=>({terminate(){},postMessage:m=>structuredClone(m)})});client.ensureWorker('isolated');
 await assert.rejects(client.request('snapshot-patch',{entries:[['0',{constraints:{nested:{callback(){}}}}]]}),e=>{
  assert.equal(e.code,'planning_worker_data_clone_failed');assert.match(e.transportPath,/constraints.nested.callback/);assert.match(e.message,/constraints.nested.callback/);assert.doesNotMatch(e.message,/25\|25/);return true;
 });assert.equal(client.pending.size,0);assert.equal(client.worker,null);
});
test('nested Map and Set uncloneable values are located and non-clone errors preserved',()=>{
 const cause=new DOMException('bad clone','DataCloneError');const error=planningCloneError(cause,{type:'run',options:new Map([['key',new Set([()=>{}])]])});assert.match(error.transportPath,/mapValue0.0/);assert.equal(error.cause,cause);
 const other=new Error('worker unavailable');assert.equal(planningCloneError(other,{type:'run'}),other);
});

test('uncloneable route data fails the pending run with a diagnostic instead of numeric 25',async()=>{
 const client=new SchedulingPointWorker({createWorker:()=>({terminate(){},postMessage:m=>structuredClone(m)})});client.ensureWorker('isolated');
 const result=client.request('run-national',{}, {routeInvoke:async()=>({data:{nested:{callback(){}}},error:null})});
 await client.receive({id:1,type:'route',routeId:1,body:{}});
 await assert.rejects(result,e=>e.code==='planning_worker_data_clone_failed' && e.transportPath.endsWith('data.nested.callback'));
 assert.equal(client.pending.size,0);
});
