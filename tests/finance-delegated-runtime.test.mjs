import test from 'node:test';
import assert from 'node:assert/strict';
import { financeDelegatedHeaders, resumeFinanceInvoiceDrafts, createFinanceInvoiceResumeRuntime } from '../frontend/src/microsoft/finance-invoice-mail.js';
const user={auth_user_id:'issuer',email:'toni@think.org.il',role:'admin'};
test('shared Microsoft token acquisition is silent and an unavailable session does not block issuance',async()=>{
  let request;
  assert.deepEqual(await financeDelegatedHeaders(user,async(...args)=>{request=args;return 'token';}),{'x-microsoft-mail-token':'token'});
  assert.deepEqual(request,[user.email,{interactive:false}]);
  assert.deepEqual(await financeDelegatedHeaders(user,async()=>''),{});
  assert.deepEqual(await financeDelegatedHeaders(user,async()=>{throw Error('signed_out');}),{});
});
test('reconnect automatically completes pending account IDs with the same transient token',async()=>{
  const calls=[];const api={pendingFinanceDelegatedAccounts:async options=>{assert.equal(options.reconnected,true);return[{id:'a'},{id:'b'}];},
    dispatchFinanceTransactionAccount:async(...args)=>{calls.push(args);return{outlookStatus:'draft_ready'};}};
  const r=await resumeFinanceInvoiceDrafts({user,api,tokenProvider:async()=>'token',reconnected:true});
  assert.equal(r.length,2);assert.deepEqual(calls.map(c=>c[0]),[{accountId:'a'},{accountId:'b'}]);
  assert.ok(calls.every(c=>c[1].mailHeaders['x-microsoft-mail-token']==='token'));
});
test('resume does not open a popup or dispatch when signed out or not finance-authorized',async()=>{
  let dispatched=0;const api={pendingFinanceDelegatedAccounts:async()=>[{id:'a'}],dispatchFinanceTransactionAccount:async()=>{dispatched++;}};
  assert.deepEqual(await resumeFinanceInvoiceDrafts({user,api,tokenProvider:async()=>''}),[]);
  assert.deepEqual(await resumeFinanceInvoiceDrafts({user:{auth_user_id:'other',role:'instructor'},api,tokenProvider:async()=>'token'}),[]);
  assert.equal(dispatched,0);
});
test('session change during a resume batch cannot dispatch under a different dashboard user',async()=>{
  let current=user,calls=0;const target=new EventTarget();
  const runtime=createFinanceInvoiceResumeRuntime({getUser:()=>current,target,tokenProvider:async()=>'token',api:{
    pendingFinanceDelegatedAccounts:async()=>[{id:'a'},{id:'b'}],
    dispatchFinanceTransactionAccount:async()=>{calls++;current={...user,auth_user_id:'different-user'};return{};}
  }});
  runtime.sync();await new Promise(resolve=>setTimeout(resolve,10));runtime.stop();assert.equal(calls,1);
});
test('concurrent reconnect and focus callbacks cannot start overlapping resume batches',async()=>{
  let calls=0,release;const wait=new Promise(r=>release=r);
  const runtime=createFinanceInvoiceResumeRuntime({getUser:()=>user,target:new EventTarget(),tokenProvider:async()=>'token',api:{
    pendingFinanceDelegatedAccounts:async()=>{calls++;await wait;return[];},dispatchFinanceTransactionAccount:async()=>{}
  }});
  runtime.sync();await runtime.tick();await runtime.tick();release();await new Promise(r=>setTimeout(r,5));runtime.stop();assert.equal(calls,1);
});
