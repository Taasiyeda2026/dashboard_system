import test from 'node:test';
import assert from 'node:assert/strict';
import { manualAccountViewHtml,prepareManualAccount,updateManualDraft,runManualAccount } from '../frontend/src/screens/finance-manual-account.js';
const data=()=>({collectionActivities:[{row_id:'a',school:'בית ספר',authority:'עיריית רחובות',activity_name:'קורס',activity_no:'123'}],transactionContext:{billingRows:[{activityRowId:'a',fundingSourceId:'r',funding:'רשות',payerName:'עיריית רחובות',period:'2026-09-01',institutionSymbol:'123',unbilledCount:2,issuableAmount:7000,eligible:true}]}});
test('manual wizard selects existing activity/funder and edits document fields without touching source data',()=>{
  const d=data();const source=JSON.stringify(d.collectionActivities);prepareManualAccount(d,'a');
  assert.equal(d.manualDraft.amount,7000);assert.equal(d.manualDraft.quantity,2);assert.equal(d.manualFundingKey,'r|2026-09-01');
  updateManualDraft(d,'description','תיאור למסמך');updateManualDraft(d,'amount',6000);
  assert.equal(d.manualDraft.unit_price,3000);assert.equal(JSON.stringify(d.collectionActivities),source);
  const html=manualAccountViewHtml(d);assert.match(html,/בחירת פעילות קיימת/);assert.match(html,/תיאור למסמך/);assert.doesNotMatch(html,/data-finance-manual-confirm/);
});
test('editing invalidates preview; only a reviewed PDF can be confirmed with its server revision',async()=>{
  const d=data();prepareManualAccount(d,'a');await assert.rejects(runManualAccount(d,{}),/מקדימה/);
  d.manualQuote={revision:'server-version'};d.manualPdf='base64';updateManualDraft(d,'quantity',1);assert.equal(d.manualQuote,null);
  d.manualQuote={revision:'server-version'};let payload;
  await runManualAccount(d,{reserveFinanceManualAccount:async p=>{payload=p;return{id:'x'};},dispatchFinanceTransactionAccount:async()=>({})});
  assert.equal(payload.activity,'a');assert.equal(payload.funder,'r');assert.equal(payload.revision,'server-version');
});
test('manual search includes school activity authority and stable identifier; no new activity input exists',()=>{
  const d=data();d.manualSearch='רחובות';assert.match(manualAccountViewHtml(d),/value="a"/);
  d.manualSearch='אין פעילות כזו';assert.doesNotMatch(manualAccountViewHtml(d),/value="a"/);
});
test('full funding before performance uses the selected financier budget and retains a separate basis',()=>{
  const d=data();Object.assign(d.transactionContext.billingRows[0],{eligible:false,period:null,manualMonth:'2026-12-01',plannedCount:4,unbilledCount:0,issuableAmount:0,fullFundingAmount:7000,fullFundingBlockedReason:''});
  prepareManualAccount(d,'a');assert.equal(d.manualDraft.billing_basis,'full_funding');assert.equal(d.manualDraft.amount,7000);assert.equal(d.manualDraft.quantity,4);assert.equal(d.manualFundingKey,'r|2026-12-01');
  assert.match(manualAccountViewHtml(d),/מלוא חלק המממן/);
});
