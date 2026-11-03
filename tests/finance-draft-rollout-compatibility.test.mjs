import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../frontend/src/api.js',import.meta.url),'utf8');
const start=source.indexOf('  dispatchFinanceTransactionAccount: ');
const method=source.slice(start+'  dispatchFinanceTransactionAccount: '.length,source.indexOf('  login:',start)).trim().replace(/,$/,'');
function dispatcher(invoke) {
  return new Function('supabase','assertPermission',`return (${method});`)({functions:{invoke}},()=>{});
}
test('monthly, manual and recovery dispatches request drafts on either Edge version during rollout',async()=>{
  const calls=[];const dispatch=dispatcher(async(name,options)=>{calls.push({name,...options});return{data:{outlookStatus:'draft_ready'}};});
  for(const accountId of ['monthly','manual','existing'])assert.equal((await dispatch({accountId})).outlookStatus,'draft_ready');
  assert.deepEqual(calls.map(c=>c.body),['monthly','manual','existing'].map(accountId=>({accountId,createDraft:true})));
});
test('compatibility does not hide permission errors or change account identity',async()=>{
  let sent;
  const dispatch=dispatcher(async(name,options)=>{sent=options.body;return {error:{context:{status:403,json:async()=>({error:'backend_not_authorized'})}}};});
  await assert.rejects(dispatch({accountId:'original',createDraft:false}),/backend_not_authorized/);
  assert.deepEqual(sent,{accountId:'original',createDraft:true});
});
