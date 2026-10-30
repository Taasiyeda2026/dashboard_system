import test from 'node:test';
import assert from 'node:assert/strict';
import { manualAccountViewHtml,prepareManualAccount,updateManualDraft,runManualAccount,manualFundingFilterOptions,manualFilteredActivities,toggleManualActivity,saveActiveManualDraft,previewSelectedManualAccounts,runSelectedManualAccounts,formatManualMoney,parseManualMoney } from '../frontend/src/screens/finance-manual-account.js';
const data=()=>({collectionActivities:[{row_id:'a',school:'בית ספר',authority:'עיריית רחובות',activity_name:'קורס',activity_no:'123'}],transactionContext:{billingRows:[{activityRowId:'a',fundingSourceId:'r',funding:'רשות',payerName:'עיריית רחובות',period:'2026-09-01',institutionSymbol:'123',unbilledCount:2,issuableAmount:7000,eligible:true}]}});
test('manual wizard selects existing activity/funder and edits document fields without touching source data',()=>{
  const d=data();const source=JSON.stringify(d.collectionActivities);prepareManualAccount(d,'a');
  assert.equal(d.manualDraft.amount,7000);assert.equal(d.manualDraft.quantity,2);assert.equal(d.manualFundingKey,'r|2026-09-01');
  updateManualDraft(d,'description','תיאור למסמך');updateManualDraft(d,'amount',6000);
  assert.equal(d.manualDraft.unit_price,3000);assert.equal(JSON.stringify(d.collectionActivities),source);
  const html=manualAccountViewHtml(d);assert.match(html,/בחירת פעילות קיימת/);assert.match(html,/תיאור למסמך/);assert.doesNotMatch(html,/data-finance-manual-confirm/);
  assert.match(html,/<option value="a" selected>בית ספר \| עיריית רחובות \| קורס<\/option>/);
  assert.doesNotMatch(html,/בית ספר · קורס · a|ds-fin-manual__selected/);
  assert.match(html,/ds-fin-manual__activity-grid|ds-fin-manual__grid/);
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

test('manual issuance filters by actual funder, not school; mixed funding selects the right share',()=>{
  const d={
    collectionActivities:[
      {row_id:'a',school:'אוסישקין',authority:'נהרייה',authority_id:11,activity_name:'ביומימיקרי',funding:'גפן + רשות'},
      {row_id:'b',school:'הרצל',authority:'עכו',authority_id:22,activity_name:'ביומימיקרי',funding:'רשות'},
      {row_id:'c',school:'אוסישקין',authority:'נהרייה',authority_id:11,activity_name:'חלל',funding:'גפן'},
      {row_id:'d',school:'גולדה',authority:'חיפה',authority_id:33,activity_name:'חלל',funding:'רמי שני'}
    ],
    transactionContext:{billingRows:[
      {activityRowId:'a',fundingSourceId:'g',funding:'גפ״ן',period:'2026-10-01',eligible:true,unbilledCount:2,issuableAmount:2000},
      {activityRowId:'a',fundingSourceId:'r',funding:'רשות',payerName:'נהרייה',period:'2027-02-01',eligible:true,unbilledCount:2,issuableAmount:3000},
      {activityRowId:'b',fundingSourceId:'r',funding:'רשות',payerName:'עכו',period:'2027-02-01',eligible:true,unbilledCount:2,issuableAmount:3000},
      {activityRowId:'c',fundingSourceId:'g',funding:'גפן',period:'2026-10-01',eligible:true,unbilledCount:2,issuableAmount:2000},
      {activityRowId:'d',fundingSourceId:'s',funding:'רמי שני',period:'2027-02-01',eligible:true,unbilledCount:2,issuableAmount:3000}
    ]}
  };
  const options=manualFundingFilterOptions(d);
  assert.ok(options.some(f=>f.label==='רמי שני'));
  assert.equal(options.filter(f=>f.key.startsWith('authority:')).length,2);
  const gefen=options.find(f=>f.label==='גפ״ן'||f.label==='גפן');
  d.manualFunderFilter=gefen.key;
  assert.deepEqual(manualFilteredActivities(d).map(a=>a.row_id),['a','c']);
  prepareManualAccount(d,'a');
  assert.equal(d.manualFundingKey,'g|2026-10-01');
  const authority=options.find(f=>f.label==='רשות - נהרייה');
  d.manualFunderFilter=authority.key;
  assert.deepEqual(manualFilteredActivities(d).map(a=>a.row_id),['a']);
  prepareManualAccount(d,'a');
  assert.equal(d.manualFundingKey,'r|2027-02-01');
  const html=manualAccountViewHtml(d);
  assert.match(html,/data-finance-manual-funder-filter/);
  assert.match(html,/value="r\|2027-02-01"/);
  assert.doesNotMatch(html,/value="g\|2026-10-01"/);
  assert.match(html,/אוסישקין \| נהרייה \| ביומימיקרי/);
  assert.doesNotMatch(html,/הרצל \| עכו \| ביומימיקרי/);
});
test('funder filter includes old single-funder records even if allocation details are missing',()=>{
  const d={collectionActivities:[
    {row_id:'missing',school:'שקמה',authority:'אשדוד',funding:'גפן',activity_name:'בינה מלאכותית'},
    {row_id:'unassigned',school:'דקל',authority:'רחובות',funding:'',activity_name:'חלל'}],
  transactionContext:{billingRows:[{activityRowId:'missing',fundingSourceId:null,funding:'גפן',blockedReason:'חסרה חלוקת מימון'}]}};
  const options=manualFundingFilterOptions(d);
  assert.ok(options.some(f=>f.key==='funder:גפן'));
  assert.ok(options.some(f=>f.key==='unassigned'));
  d.manualFunderFilter='funder:גפן';
  assert.deepEqual(manualFilteredActivities(d).map(a=>a.row_id),['missing']);
});

test('multiple activities for one financer issue exactly one account with all lines', async () => {
  const d=data();
  d.collectionActivities.push({...d.collectionActivities[0],row_id:'b',school:'בית ספר שני'});
  d.transactionContext.billingRows.push({...d.transactionContext.billingRows[0],activityRowId:'b',issuableAmount:4300});
  d.manualFunderFilter='authority:name:עיריית רחובות';
  toggleManualActivity(d,'a',true);
  toggleManualActivity(d,'b',true);
  updateManualDraft(d,'amount',4000);
  saveActiveManualDraft(d);
  const requests=[];
  const api={
    previewFinanceFunderBatchAccount:async items=>{
      requests.push(items);
      return {quote:{revision:'combined-rev',total_amount:11000,finance_transaction_account_lines:[{},{}]},pdfBase64:'COMBINEDPDF'};
    },
    reserveFinanceFunderBatchAccount:async request=>({id:'one-account',total_amount:11000,request}),
    dispatchFinanceTransactionAccount:async payload=>({document:'issued',id:payload.accountId})
  };
  const previews=await previewSelectedManualAccounts(d,api);
  assert.equal(previews.length,1);
  assert.equal(requests.length,1);
  assert.deepEqual(requests[0].map(item=>item.activity),['a','b']);
  assert.equal(requests[0][0].draft.amount,7000);
  assert.equal(requests[0][1].draft.amount,4000);
  const view=manualAccountViewHtml(d);
  assert.match(view,/אישור והפקת חשבון מרוכז אחד/);
  assert.match(view,/COMBINEDPDF/);
  assert.doesNotMatch(view,/אישור והפקת 2 חשבונות/);
  const issued=await runSelectedManualAccounts(d,api);
  assert.equal(issued.length,1);
  assert.equal(issued[0].reserved.id,'one-account');
  assert.equal(issued[0].reserved.request.revision,'combined-rev');
});
test('multi-activity preview requires a financer, invalidates on edit, and cancels failed dispatch',async()=>{
  const d=data();
  d.collectionActivities.push({...d.collectionActivities[0],row_id:'b'});
  d.transactionContext.billingRows.push({...d.transactionContext.billingRows[0],activityRowId:'b'});
  toggleManualActivity(d,'a',true);
  toggleManualActivity(d,'b',true);
  await assert.rejects(previewSelectedManualAccounts(d,{}),/גורם מימון/);
  d.manualFunderFilter='authority:name:עיריית רחובות';
  const api={previewFinanceFunderBatchAccount:async()=>({quote:{revision:'r1'},pdfBase64:'pdf'})};
  await previewSelectedManualAccounts(d,api);
  updateManualDraft(d,'description','edited');
  assert.equal(d.manualConsolidatedPreview,null);
  await previewSelectedManualAccounts(d,api);
  let cancelled='';
  await assert.rejects(runSelectedManualAccounts(d,{
    reserveFinanceFunderBatchAccount:async()=>({id:'one'}),
    dispatchFinanceTransactionAccount:async()=>{throw Error('dispatch failed');},
    cancelFinanceTransactionReservation:async id=>{cancelled=id}
  }),/dispatch failed/);
  assert.equal(cancelled,'one');
});
test('non-school payer does not inherit a school semel or invent a customer number',()=>{
  const d=data();d.transactionContext.billingRows[0].gefenFunding=false;
  d.transactionContext.billingRows[0].institutionSymbol='211466';
  prepareManualAccount(d,'a');
  assert.equal(d.manualDraft.institution_symbol,'');
  const html=manualAccountViewHtml(d);
  assert.match(html,/מספר לקוח \(אם קיים\)/);
  assert.match(html,/הצגת החשבון לבדיקה \(PDF\)/);
  assert.doesNotMatch(html,/סמל מוסד \/ מספר לקוח/);
});
test('Gefen payer retains school institution symbol',()=>{
  const d=data();d.transactionContext.billingRows[0].gefenFunding=true;
  d.transactionContext.billingRows[0].institutionSymbol='211466';
  prepareManualAccount(d,'a');
  assert.equal(d.manualDraft.institution_symbol,'211466');
  assert.match(manualAccountViewHtml(d),/סמל מוסד/);
});

test('manual invoice displays grouped payer amounts and keeps numeric values in the draft',()=>{
  assert.equal(formatManualMoney(17500),'17,500.00');
  assert.equal(formatManualMoney(4500),'4,500.00');
  assert.equal(parseManualMoney('17,500.00'),17500);
  assert.equal(parseManualMoney('1,250.75'),1250.75);
  assert.equal(parseManualMoney('1250.75'),1250.75);
  assert.ok(Number.isNaN(parseManualMoney('1,25.00')));
  const d=data();prepareManualAccount(d,'a');
  const html=manualAccountViewHtml(d);
  assert.match(html,/7,000\.00 ₪/);
  assert.match(html,/data-finance-manual-field="amount" value="7,000\.00"/);
  assert.match(html,/data-finance-manual-field="unit_price" value="3,500\.00"/);
  updateManualDraft(d,'amount','6,500.50');
  assert.equal(d.manualDraft.amount,6500.5);
  assert.equal(d.manualDraft.unit_price,3250.25);
  updateManualDraft(d,'unit_price','1,250.00');
  assert.equal(d.manualDraft.unit_price,1250);
  assert.equal(d.manualDraft.amount,2500);
  assert.ok(Number.isFinite(d.manualDraft.amount));
});
test('money input formatting retains enough unit-price precision for server amount validation',()=>{
  const d=data();d.transactionContext.billingRows[0].unbilledCount=11;d.transactionContext.billingRows[0].issuableAmount=2500;
  prepareManualAccount(d,'a');
  const shown=formatManualMoney(d.manualDraft.unit_price,{unitPrice:true});
  const parsed=parseManualMoney(shown);
  assert.equal(Math.round(parsed*11*100)/100,2500);
  assert.match(shown,/^227\.2727/);
});
