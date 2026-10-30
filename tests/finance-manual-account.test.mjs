import test from 'node:test';
import assert from 'node:assert/strict';
import { manualAccountViewHtml,prepareManualAccount,updateManualDraft,runManualAccount,manualFundingFilterOptions,manualFilteredActivities } from '../frontend/src/screens/finance-manual-account.js';
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
