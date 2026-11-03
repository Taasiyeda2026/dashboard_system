import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../frontend/src/api.js',import.meta.url),'utf8');
const start=source.indexOf('  dispatchFinanceTransactionAccount: ');
const method=source.slice(start+'  dispatchFinanceTransactionAccount: '.length,source.indexOf('  login:',start)).trim().replace(/,$/,'')
  .replace("const { financeDelegatedHeaders } = await import('./microsoft/finance-invoice-mail.js');",'');
function dispatcher(invoke, headers=async()=>({'x-microsoft-mail-token':'delegated'})) {
  return new Function('supabase','assertPermission','financeDelegatedHeaders','state',`return (${method});`)
    ({functions:{invoke}},()=>{},headers,{user:{auth_user_id:'original',email:'toni@think.org.il'}});
}
test('monthly, manual and recovery dispatches request drafts on either Edge version during rollout',async()=>{
  const calls=[];const dispatch=dispatcher(async(name,options)=>{calls.push({name,...options});return{data:{outlookStatus:'draft_ready'}};});
  for(const accountId of ['monthly','manual','existing'])assert.equal((await dispatch({accountId})).outlookStatus,'draft_ready');
  assert.deepEqual(calls.map(c=>c.body),['monthly','manual','existing'].map(accountId=>({accountId,createDraft:true})));
  assert.ok(calls.every(c=>c.headers['x-microsoft-mail-token']==='delegated'));
});
test('issuance still reaches PDF dispatch without Microsoft and resume reuses its transient header',async()=>{
  const calls=[];const dispatch=dispatcher(async(name,options)=>{calls.push(options);return{data:{outlookStatus:'waiting_connection',documentPreserved:true}};},async()=>({}));
  assert.equal((await dispatch({accountId:'saved'})).documentPreserved,true);assert.deepEqual(calls[0].headers,{});
  await dispatch({accountId:'saved'},{mailHeaders:{'x-microsoft-mail-token':'reconnected'}});
  assert.equal(calls[1].headers['x-microsoft-mail-token'],'reconnected');assert.equal(calls[1].body.accountId,'saved');
});
test('compatibility does not hide permission errors or change account identity',async()=>{
  let sent;
  const dispatch=dispatcher(async(name,options)=>{sent=options.body;return {error:{context:{status:403,json:async()=>({error:'backend_not_authorized'})}}};});
  await assert.rejects(dispatch({accountId:'original',createDraft:false}),/backend_not_authorized/);
  assert.deepEqual(sent,{accountId:'original',createDraft:true});
});
