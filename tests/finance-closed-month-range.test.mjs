import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {transactionMonth,transactionBacklog,transactionPreviewForVisit,transactionAccountsViewHtml,runTransactionIssuance} from '../frontend/src/screens/finance-transaction-issuance.js';
const row=(mode,id,period,extra={})=>({activityRowId:id,activityName:id,activityType:'course',fundingSourceId:mode==='automatic'?'g':'s',funding:mode==='automatic'?'גפן':'מממן',gefenFunding:mode==='automatic',payerKey:mode==='automatic'?'school:1':'funding:s',payerName:'לקוח',customerName:'בית ספר',institutionSymbol:'123',period,plannedCount:10,plannedHours:15,activityPrice:8000,unbilledCount:3,unbilledHours:4.5,issuableAmount:2400,fundingAmount:8000,eligible:true,blockedReason:'',unbilledSlots:[{slot:1,date:period,remainingAmount:800,remainingHours:1.5},{slot:2,date:period,remainingAmount:800,remainingHours:1.5},{slot:3,date:period,remainingAmount:800,remainingHours:1.5}],...extra});
const visit=(rows,mode='automatic',month)=>({transactionTab:mode,collectionPeriod:'school_2027',transactionMonths:month?{[mode]:month}:{},transactionContext:{billingRows:rows,accounts:[]}});
const fixed=t=>t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-04T10:00:00Z')});
test('both tabs default to previous closed Israel month in November January and Israel midnight rollover',()=>{
  for(const [now,expected] of [['2026-11-04T10:00:00Z','2026-10'],['2027-01-10T10:00:00Z','2026-12'],['2027-02-01T10:00:00Z','2027-01'],['2026-10-31T22:30:00Z','2026-10']])for(const mode of ['automatic','manual'])assert.equal(transactionMonth({},mode,new Date(now)),expected);
});
test('both tabs include eligible unissued September through October only, with one total and closed groups',t=>{
  fixed(t);
  for(const mode of ['automatic','manual']){
    const sep=row(mode,'sep','2026-09-01'),oct=row(mode,'oct','2026-10-01');
    const d=visit([sep,oct,sep,row(mode,'old-year','2025-12-01'),row(mode,'august','2026-08-01'),row(mode,'current','2026-11-01'),row(mode,'billed','2026-10-01',{eligible:false,issuableAmount:0,unbilledSlots:[],unbilledCount:0}),row(mode,'waiting','2026-10-01',{eligible:false,blockedReason:'ממתין',eligibilityStatus:'waiting_three_meetings',issuableAmount:0})],mode);
    const p=transactionPreviewForVisit(d,mode);assert.equal(p.accounts.length,2);assert.equal(p.totals.amount,4800);assert.equal(transactionBacklog(d,mode).length,2,'raw duplicate is deduplicated in the issuance preview');
    const doc=new JSDOM(transactionAccountsViewHtml(d,x=>x)).window.document;
    assert.equal(doc.querySelector('[data-finance-transaction-month]').value,'2026-10');assert.equal(doc.querySelector('[data-finance-transaction-month]').max,'2026-10');
    assert.ok([...doc.querySelectorAll('details')].every(x=>!x.open));assert.equal(doc.querySelectorAll('[data-finance-transaction-run]').length,1);assert.match(doc.querySelector('[data-finance-transaction-run]').textContent,/הפקת כל חשבונות העסקה/);
    assert.match(doc.body.textContent,/3 מתוך 10 מפגשים.*4.5 מתוך 15 שעות.*8,000.00.*2,400.00/);
    const group=doc.querySelector('[data-finance-transaction-group]');group.querySelector('summary').click();assert.ok(group.open);group.querySelector('summary').click();assert.equal(group.open,false);
    assert.doesNotMatch(doc.body.textContent,/old-year|august|current|billed/);
  }
});
test('January ranges cross the year boundary and changing the upper month rebuilds closed groups',t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date('2027-01-10T10:00:00Z')});
  for(const mode of ['automatic','manual']){
    const d=visit(['2026-09','2026-10','2026-11','2026-12','2027-01'].map(p=>row(mode,p,p+'-01')),mode);
    assert.equal(transactionPreviewForVisit(d,mode).totals.amount,9600);
    d.transactionMonths[mode]='2026-10';assert.equal(transactionPreviewForVisit(d,mode).totals.amount,4800);
    const doc=new JSDOM(transactionAccountsViewHtml(d,x=>x)).window.document;assert.ok([...doc.querySelectorAll('details')].every(x=>!x.open));
  }
});
test('one action in each tab issues every closed eligible period in order with stable retry identity and separate payers',async t=>{
  fixed(t);
  for(const mode of ['automatic','manual']){
    const d=visit([row(mode,'oct','2026-10-01'),row(mode,'sep','2026-09-01'),row(mode,'other','2026-10-01',{payerKey:'school:2',payerName:'בית ספר ב',institutionSymbol:'222'}),row(mode,'current','2026-11-01')],mode);
    d.transactionManualSelected={};const sent=[],api={reserveFinanceTransactionAccount:async p=>{sent.push(p);return{id:p.idempotencyKey};},dispatchFinanceTransactionAccount:async()=>({outlookStatus:'draft_ready'})};
    assert.equal((await runTransactionIssuance(d,api,mode)).length,3);assert.equal(sent[0].lines[0].performance_month,'2026-09-01');
    assert.ok(sent.every(p=>p.lines.every(l=>l.performance_month<'2026-11-01')));const first=sent.map(p=>p.idempotencyKey);
    await runTransactionIssuance(d,api,mode);assert.deepEqual(sent.slice(3).map(p=>p.idempotencyKey),first);
    d.transactionContext.billingRows=[];await assert.rejects(runTransactionIssuance(d,api,mode),/אין חשבונות/);
  }
});
test('empty closed ranges and current-month selections create no empty accounts',t=>{
  fixed(t);
  for(const mode of ['automatic','manual']){
    const d=visit([row(mode,'current','2026-11-01')],mode,'2026-11');assert.equal(transactionMonth(d,mode),'2026-10');assert.equal(transactionPreviewForVisit(d,mode).accounts.length,0);
    const doc=new JSDOM(transactionAccountsViewHtml(d,x=>x)).window.document;assert.equal(doc.querySelectorAll('[data-finance-transaction-group],[data-finance-transaction-run]').length,0);
  }
});
