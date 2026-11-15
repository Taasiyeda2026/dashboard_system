import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {financeGefenCycle} from '../frontend/src/screens/finance-transaction-accounts.js';
import {transactionMonth, transactionPreviewForVisit, transactionAccountsViewHtml, runTransactionIssuance} from '../frontend/src/screens/finance-transaction-issuance.js';
import {financeScreen} from '../frontend/src/screens/finance.js';

const row=(period,extra={})=>({activityRowId:'a',activityName:'קורס',fundingSourceId:'g',funding:'גפן',gefenFunding:true,
  payerKey:'school:1',payerName:'בית ספר',customerName:'בית ספר',institutionSymbol:'123',period,
  plannedCount:6,unbilledCount:3,unbilledHours:4.5,unbilledSlots:[{slot:1,date:period}],
  issuableAmount:3000,eligible:true,blockedReason:'',...extra});
const visit=rows=>({view:'transactions',transactionTab:'automatic',collectionPeriod:'school_2027',transactionContext:{billingRows:rows,accounts:[]}});

test('Gefen cutoff and next opening stay fixed across Israel midnight, month and year boundaries',()=>{
  for(const [time,cutoff,nextUpdate] of [
    ['2026-11-14T21:59:59Z','2026-10-31','2026-11-15'],
    ['2026-11-14T22:00:00Z','2026-11-14','2026-12-01'],
    ['2026-11-30T21:59:59Z','2026-11-14','2026-12-01'],
    ['2026-11-30T22:00:00Z','2026-11-30','2026-12-15'],
    ['2026-12-31T22:00:00Z','2026-12-31','2027-01-15'],
    ['2027-01-14T22:00:00Z','2027-01-14','2027-02-01'],
    ['2028-03-01T00:00:00+02:00','2028-02-29','2028-03-15']]) {
    assert.deepEqual(financeGefenCycle(new Date(time)),{cutoff,nextUpdate});
  }
});
test('only Gefen opens the current month from the 15th; no free date picker; cutoff is visible even when empty',t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-15T00:00:00+02:00')});
  const d=visit([row('2026-10-01'),row('2026-11-01'),row('2026-11-01',{gefenFunding:false,fundingSourceId:'s'})]);
  assert.equal(transactionMonth(d,'automatic'),'2026-11');assert.equal(transactionMonth(d,'manual'),'2026-10');
  assert.equal(transactionPreviewForVisit(d,'automatic').accounts.length,2);
  assert.equal(transactionPreviewForVisit(d,'manual').accounts.length,0);
  const doc=new JSDOM(transactionAccountsViewHtml(d,x=>x)).window.document;
  assert.equal(doc.querySelector('[data-finance-transaction-month]').max,'2026-11');
  assert.match(doc.querySelector('[data-finance-gefen-cycle]').textContent,/14\.11\.2026.*01\.12\.2026/);
  assert.equal(doc.querySelectorAll('input[type=date]').length,0);
  assert.match(transactionAccountsViewHtml(visit([]),x=>x),/14\.11\.2026/);
});
test('server cutoff drives the displayed month and payload when a loaded tab crosses the next opening',async t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-12-01T00:00:01+02:00')});
  const d=visit([row('2026-11-01',{billingCutoff:'2026-11-14',nextBillingUpdate:'2026-12-01'})]);
  const payloads=[];
  await runTransactionIssuance(d,{
    reserveFinanceTransactionAccount:async p=>{payloads.push(p);return{id:'synthetic'};},
    dispatchFinanceTransactionAccount:async()=>({outlookStatus:'draft_ready'})
  },'automatic');
  assert.equal(payloads[0].cutoffDate,'2026-11-14');
  assert.equal(payloads[0].lines[0].billing_range_end,'2026-11-01');
  assert.match(transactionAccountsViewHtml(d,x=>x),/14\.11\.2026/);
});
test('UI month changes and tab entry accept the midmonth Gefen range but keep other funding closed',t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-15T10:00:00Z')});
  const previousWindow=globalThis.window;
  const dom=new JSDOM('<div id="app"></div>');globalThis.window=dom.window;
  t.after(()=>{root._financeUnbind();globalThis.window=previousWindow;dom.window.close();});
  const d=visit([]),root=dom.window.document.querySelector('#app'),state={user:{role:'admin'}};
  const paint=()=>{root.innerHTML=financeScreen.render(d,{state});};paint();
  financeScreen.bind({root,data:d,state,api:{},rerender:paint});
  const picker=root.querySelector('[data-finance-transaction-month]');
  picker.value='2026-11';picker.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  assert.equal(d.transactionMonths.automatic,'2026-11');
  root.querySelector('[data-finance-transaction-tab="manual"]').click();assert.equal(d.transactionMonths.manual,'2026-10');
  root.querySelector('[data-finance-transaction-tab="automatic"]').click();assert.equal(d.transactionMonths.automatic,'2026-11');
});
test('backlog and mixed funding retain existing school, payer and monthly grouping at the new cutoff',t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date('2027-01-15T10:00:00Z')});
  const d=visit([row('2026-10-01'),row('2026-12-01'),row('2027-01-01'),
    row('2027-01-01',{activityRowId:'b',institutionSymbol:'456',payerKey:'school:2'}),
    row('2026-12-01',{gefenFunding:false,fundingSourceId:'r',payerKey:'authority:1'}),
    row('2026-12-01',{gefenFunding:false,fundingSourceId:'r',payerKey:'authority:1',activityRowId:'b',institutionSymbol:'456'})]);
  const gefen=transactionPreviewForVisit(d,'automatic');assert.equal(gefen.accounts.length,4);assert.equal(gefen.totals.amount,12000);
  const other=transactionPreviewForVisit(d,'manual');assert.equal(other.accounts.length,1);assert.equal(other.accounts[0].lines.length,2);
});
