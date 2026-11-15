import test from 'node:test';
import assert from 'node:assert/strict';
import { financeIncompleteBillingActivities, financeBillingCompletionHtml, financeBillingMissingReasons } from '../frontend/src/screens/finance-billing-completion.js';
const rows=[
  {row_id:'a',activity_type:'course',activity_name:'ביומימיקרי',funding:'גפן',price:9000,sessions:10,course_hourly_rate:null},
  {row_id:'b',activity_type:'course',activity_name:'קורס אחר',funding:'רשות',price:9000,sessions:10,course_hourly_rate:null},
  {row_id:'c',activity_type:'course',activity_name:'קורס תקין',funding:'גפן',price:9000,sessions:10,course_hourly_rate:600},
  {row_id:'d',activity_type:'course',activity_name:'חסר מימון',price:null,sessions:10,course_hourly_rate:null},
  {row_id:'e',activity_type:'course',activity_name:'חסר תאריכים',funding:'גפן',price:9000,sessions:10,course_hourly_rate:600}
];
const data={financeCanComplete:true,collectionActivities:rows,transactionContext:{billingRows:[
  {activityRowId:'a',gefenFunding:true,fundingSourceId:'g',blockedReason:'חסר מחיר שעתי'},
  {activityRowId:'b',gefenFunding:false,fundingSourceId:'r',blockedReason:'חסר מחיר שעתי'},
  {activityRowId:'c',gefenFunding:true,fundingSourceId:'g',eligible:true},
  {activityRowId:'d',fundingSourceId:null,blockedReason:'חסר מימון'},
  {activityRowId:'e',gefenFunding:true,fundingSourceId:'g',blockedReason:'חסרים מועדי מפגשים מתוכננים'}
]}};
test('missing billing fields stay visible in the relevant tab, independent of eligibility',()=>{
  assert.deepEqual(financeIncompleteBillingActivities(data,'automatic').map(a=>a.row_id),['a','d','e']);
  assert.deepEqual(financeIncompleteBillingActivities(data,'manual').map(a=>a.row_id),['b','d']);
  assert.deepEqual(financeIncompleteBillingActivities(data,'editable').map(a=>a.row_id),['a','b','d','e']);
});
test('completion can be opened directly without granting view-only users write access',()=>{
  const html=financeBillingCompletionHtml(data,'automatic');
  assert.match(html,/data-finance-complete-open="a"/);
  assert.match(html,/מחיר שעתי/);
  assert.equal(financeBillingCompletionHtml({...data,financeCanComplete:false},'automatic'),'');
});
test('quoted price is preserved, catalog default applies only to Gefen funding',()=>{
  const editor={row_id:'a',activity_type:'course',name:'ביומימיקרי',activity_no:'6089',price:9000,sessions:10,proposal_rate:633.3333,allocations:[{id:'g',name:'גפן',amount:9000}],funding_options:[{id:'g',name:'גפן'}]};
  const quoted=financeBillingCompletionHtml({...data,billingCompletion:editor},'automatic');
  assert.match(quoted,/name="rate" type="number" value="633\.3333"/);
  assert.match(quoted,/name="price" type="number" value="9000"/);
  const catalog=financeBillingCompletionHtml({...data,billingCompletion:{...editor,proposal_rate:null}},'automatic');
  assert.match(catalog,/name="rate" type="number" value="600"/);
  const nonGefen=financeBillingCompletionHtml({...data,billingCompletion:{...editor,proposal_rate:null,allocations:[{id:'r',name:'רשות',amount:9000}]}},'manual');
  assert.match(nonGefen,/name="rate" type="number" value=""/);
});
test('completion list uses one row per activity with existing values and separate missing fields',()=>{
  const html=financeBillingCompletionHtml(data);
  assert.equal((html.match(/data-finance-completion-row /g)||[]).length,4);
  assert.match(html,/מה חסר \/ נדרש בירור/);
  assert.match(html,/מחיר לשעה/);
  assert.match(html,/data-finance-completion-search/);
  assert.match(html,/9,000/);
  assert.doesNotMatch(html,/data-finance-complete-open="c"/);
  assert.deepEqual(financeBillingMissingReasons(rows[0],data.transactionContext.billingRows),['מחיר שעתי']);
  assert.deepEqual(financeBillingMissingReasons({...rows[0],sessions:null,price:null},data.transactionContext.billingRows),['מחיר שעתי','מספר מפגשים','מחיר כולל']);
});
test('editor opens in the selected list row without repeating the list',()=>{
  const editor={...rows[0],name:rows[0].activity_name,rate:600,allocations:[],funding_options:[]};
  const html=financeBillingCompletionHtml({...data,billingCompletion:editor});
  assert.match(html,/data-finance-completion-inline/);
  assert.match(html,/data-completion-selected="true"/);
  assert.equal((html.match(/data-finance-completion-form /g)||[]).length,1);
  assert.match(html,/data-finance-complete-save/);
});
