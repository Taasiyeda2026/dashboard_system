import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {gefenBillingGroups,gefenBillingValues,gefenBillingRequest,updateGefenBillingValue} from '../frontend/src/screens/finance-gefen-billing-overrides.js';
import {transactionAccountsViewHtml,transactionPreviewForVisit,syncGefenBillingInput,runTransactionIssuance,previewTransactionAccountGroup,transactionAccountPreviewKey} from '../frontend/src/screens/finance-transaction-issuance.js';
const row=(x={})=>({activityRowId:'a',fundingSourceId:'g',activityName:'ביומימיקרי',gefenFunding:true,eligible:true,period:'2026-10-01',institutionSymbol:'123',customerName:'בית הספר',payerName:'בית הספר',payerKey:'school:1',customerEmail:'test@example.test',unbilledCount:3,unbilledHours:4.5,issuableAmount:2137.5,hourlyRate:475,unbilledSlots:[{slot:1},{slot:2},{slot:3}],billingCutoff:'2026-11-14',nextBillingUpdate:'2026-12-01',billingSourceRevision:'revision-1',...x});
const data=()=>({collectionPeriod:'school_2027',transactionMonths:{automatic:'2026-11'},transactionContext:{billingRows:[row(),row({period:'2026-11-01',billingSourceRevision:'revision-2',unbilledCount:2,unbilledHours:3,issuableAmount:1425,unbilledSlots:[{slot:4},{slot:5}]})]},financeCanComplete:true,billingCompletion:{row_id:'a'},collectionActivities:[{row_id:'a',class_group:'קבוצה 1'}]});
test('Gefen edits are independent, account-scoped, immediate, and leave source immutable',()=>{
 const d=data(),source=structuredClone(d.transactionContext);const group=gefenBillingGroups(source.billingRows)[0];
 updateGefenBillingValue(d,source.billingRows,group.key,'meetings','11');
 assert.equal(gefenBillingValues(d,group).hours,7.5);
 updateGefenBillingValue(d,source.billingRows,group.key,'hours','4.25');
 updateGefenBillingValue(d,source.billingRows,group.key,'rate','500');
 const p=transactionPreviewForVisit(d);assert.equal(p.totals.meetings,11);assert.equal(p.totals.hours,4.25);assert.equal(p.totals.amount,2125);
 assert.deepEqual(d.transactionContext,source);
 const dom=new JSDOM(transactionAccountsViewHtml(d,()=>''));const doc=dom.window.document;
 assert.equal(doc.querySelectorAll('[data-gefen-billing-row]').length,1);assert.equal(doc.querySelectorAll('[data-gefen-billing-field]').length,3);
 assert.equal(doc.querySelector('[data-finance-completion-form]'),null);assert.equal(doc.querySelector('[data-finance-complete-open]'),null);
 const input=doc.querySelector('[data-gefen-billing-field="hours"]');input.closest('details').open=true;input.value='8.5';syncGefenBillingInput(doc,d,input);
 assert.equal(input.closest('details').open,true);assert.match(doc.querySelector('[data-gefen-billing-amount]').textContent,/4,250/);
 assert.match(doc.querySelector('[data-gefen-billing-summary]').textContent,/4,250/);assert.equal(doc.querySelector('[data-gefen-billing-field="meetings"]').value,'11');
 dom.window.close();
});
test('changed source revisions discard stale edits and invalid values cannot be issued',()=>{
 const d=data(),g=gefenBillingGroups(d.transactionContext.billingRows)[0];updateGefenBillingValue(d,g.rows,g.key,'hours','-2');
 assert.throws(()=>gefenBillingRequest(d,transactionPreviewForVisit(d).accounts[0],'2026-11-14'),/יש להזין/);
 d.transactionContext.billingRows[0].billingSourceRevision='changed';assert.equal(gefenBillingValues(d,gefenBillingGroups(d.transactionContext.billingRows)[0]).hours,7.5);
});
test('single and bulk issuance plus PDF preview use the same edited groups and preserve retry IDs',async()=>{
 const d=data();d.transactionContext.billingRows.push(row({activityRowId:'b',institutionSymbol:'456',payerKey:'school:2'}));
 const first=transactionPreviewForVisit(d).accounts[0],key=transactionAccountPreviewKey(first);const g=gefenBillingGroups(first.lines)[0];
 updateGefenBillingValue(d,first.lines,g.key,'meetings','11');updateGefenBillingValue(d,first.lines,g.key,'hours','4.25');
 const requests=[],ids=[];const api={quoteFinanceGefenBillingAccount:async p=>{requests.push(p);return{revision:'q'};},reserveFinanceGefenBillingAccount:async p=>{ids.push(p.idempotencyKey);assert.equal(p.revision,'q');return{id:'account'};},dispatchFinanceTransactionAccount:async()=>({outlookStatus:'draft_ready'}),previewFinanceGefenBillingAccount:async p=>{requests.push(p);return{pdfBase64:'pdf'};}};
 await previewTransactionAccountGroup(d,api,'automatic',key);
 assert.equal((await runTransactionIssuance(d,api,'automatic','2026-11',key)).length,1);
 assert.deepEqual(requests[0],requests[1]);assert.equal(requests[1].groups[0].meetings,11);assert.equal(requests[1].groups[0].hours,4.25);
 await runTransactionIssuance(d,api,'automatic','2026-11',key);assert.equal(ids[0],ids[1]);
 assert.equal((await runTransactionIssuance(d,api,'automatic')).length,2);
});
test('non-Gefen payer issuance remains on the original reservation API',async()=>{
 const d=data();d.transactionContext.billingRows=[row({gefenFunding:false})];d.transactionMonths.manual='2026-10';let called=false;
 const result=await runTransactionIssuance(d,{reserveFinanceTransactionAccount:async()=>{called=true;return{id:'m'};},dispatchFinanceTransactionAccount:async()=>({outlookStatus:'draft_ready'})},'manual');
 assert.equal(called,true);assert.equal(result[0].error,undefined);
});
