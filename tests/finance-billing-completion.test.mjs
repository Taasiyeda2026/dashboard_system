import test from 'node:test';
import assert from 'node:assert/strict';
import { financeIncompleteBillingActivities, financeBillingCompletionHtml, financeBillingMissingReasons, financeBillingCompletionEditorHtml, accountEditPayloads, financeGefenAccountEditModalHtml } from '../frontend/src/screens/finance-billing-completion.js';
import { JSDOM } from 'jsdom';
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
  assert.deepEqual(financeIncompleteBillingActivities(data,'automatic').map(a=>a.row_id),['a','d']);
  assert.deepEqual(financeIncompleteBillingActivities(data,'manual').map(a=>a.row_id),['d']);
  assert.deepEqual(financeIncompleteBillingActivities(data,'editable').map(a=>a.row_id),['a','d']);
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
  assert.equal((html.match(/data-finance-completion-row /g)||[]).length,2);
  assert.match(html,/מה חסר \/ נדרש בירור/);
  assert.match(html,/מחיר לשעה/);
  assert.match(html,/data-finance-completion-search/);
  assert.match(html,/9,000/);
  assert.doesNotMatch(html,/data-finance-complete-open="c"/);
  assert.deepEqual(financeBillingMissingReasons(rows[0],data.transactionContext.billingRows),['מחיר שעתי לגפ״ן']);
  assert.deepEqual(financeBillingMissingReasons({...rows[0],sessions:null,price:null},data.transactionContext.billingRows),['מחיר שעתי לגפ״ן','מספר מפגשים','מחיר כולל']);
});
test('editor opens in the selected list row without repeating the list',()=>{
  const editor={...rows[0],name:rows[0].activity_name,rate:600,allocations:[],funding_options:[]};
  const html=financeBillingCompletionHtml({...data,billingCompletion:editor});
  assert.match(html,/data-finance-completion-inline/);
  assert.match(html,/data-completion-selected="true"/);
  assert.equal((html.match(/data-finance-completion-form /g)||[]).length,1);
  assert.match(html,/data-finance-complete-save/);
});

test('approved order rate is independent of the course contract and other payers',()=>{
  const a={row_id:'approved',activity_type:'course',activity_name:'פורצות דרך',funding:'גפן',sessions:14,price:10500,course_hourly_rate:null};
  const gefen={activityRowId:'approved',gefenFunding:true,fundingSourceId:'g',approvedGefenRate:500,fundingAmount:10500,plannedHours:21,eligible:true};
  const view={financeCanComplete:true,collectionActivities:[a],transactionContext:{billingRows:[gefen]}};
  assert.deepEqual(financeIncompleteBillingActivities(view,'editable'),[]);
  assert.deepEqual(financeBillingMissingReasons(a,[gefen]),[]);
  const gap={...gefen,fundingAmount:12000};
  assert.deepEqual(financeIncompleteBillingActivities({...view,transactionContext:{billingRows:[gap]}},'editable'),[]);
  const other={activityRowId:'approved',gefenFunding:false,fundingSourceId:'r',blockedReason:'חסר מחיר שעתי'};
  assert.deepEqual(financeIncompleteBillingActivities({...view,transactionContext:{billingRows:[gefen,other]}},'automatic'),[]);
  assert.deepEqual(financeIncompleteBillingActivities({...view,transactionContext:{billingRows:[gefen,other]}},'editable').map(x=>x.row_id),[]);
});
test('non-Gefen missing hourly price is not a completion task even with stale server data',()=>{
 assert.deepEqual(financeBillingMissingReasons(rows[1],data.transactionContext.billingRows),[]);
 assert.ok(!financeIncompleteBillingActivities(data,'editable').some(a=>a.row_id==='b'));
});

test('completion shows school symbol and authority as separate columns and includes both in search',()=>{
 const view={...data,collectionActivities:[{...rows[0],school_id:42,school:'מוסד א',authority:'נהרייה'}],transactionContext:{...data.transactionContext,schools:[{id:42,semel_mosad:214098}]}};
 const result=financeBillingCompletionHtml(view);
 assert.match(result,/<th>מוסד<\/th><th>סמל מוסד<\/th><th>רשות<\/th>/);
 assert.match(result,/<td>214098<\/td><td>נהרייה<\/td>/);
 assert.match(result,/data-completion-search-text="[^"]*214098 נהרייה/);
});

test('approved order rate stays documentary while the contract rate remains editable',()=>{
  const editor={row_id:'a',activity_type:'course',name:'ביומימיקרי',school:'בית ספר',sessions:10,price:9000,rate:520,approved_order_rate:575,order_rate:575,allocations:[{id:'g',name:'גפן',amount:9000}],funding_options:[{id:'g',name:'גפן'}],updated_at:'2026-11-26T00:00:00Z'};
  const html=financeBillingCompletionEditorHtml(editor);
  assert.match(html,/name="rate" type="number" value="520"/);
  assert.doesNotMatch(html,/name="rate"[^>]*readonly/);
  assert.match(html,/תעריף מקורי בהזמנת גפ״ן: 575/);
  const modal=financeGefenAccountEditModalHtml({accountKey:'k',title:'רחובות · בכור לוי · 413351',activities:[editor,{...editor,row_id:'b',name:'קבוצה ב',grade:'ח',class_group:'2',rate:600,approved_order_rate:null}]});
  const dom=new JSDOM(modal);const form=dom.window.document.querySelector('[data-finance-account-edit-form]');
  form.querySelector('[data-account-edit-row="a"] [name="rate"]').value='610';
  form.querySelector('[data-account-edit-row="b"] [name="rate"]').value='620';
  const payloads=accountEditPayloads(form,[{...editor},{...editor,row_id:'b',name:'קבוצה ב',grade:'ח',class_group:'2',rate:600,approved_order_rate:null}]);
  assert.equal(payloads.length,2);
  assert.equal(payloads[0].data.rate,'610');
  assert.equal(payloads[1].data.rate,'620');
  assert.equal(payloads[0].data.allocations[0].amount,'9000');
  dom.window.close();
});

test('operational dates, deleted records, fully billed payers and internal price gaps do not create finance tasks',()=>{
 const base={row_id:'a',activity_type:'course',funding:'גפן + רמי שני',price:10000,sessions:10,course_hourly_rate:null};
 const paid={activityRowId:'a',gefenFunding:false,fundingSourceId:'r',fundingAmount:5000,billedAmount:5000,blockedReason:'חסרים מועדי מפגשים מתוכננים'};
 const gefen={activityRowId:'a',gefenFunding:true,fundingSourceId:'g',fundingAmount:5000,billedAmount:0,blockedReason:'חסר מחיר שעתי'};
 assert.deepEqual(financeBillingMissingReasons(base,[paid,gefen]),['מחיר שעתי לגפ״ן']);
 assert.deepEqual(financeBillingMissingReasons(base,[paid,gefen],'manual'),[]);
 assert.deepEqual(financeBillingMissingReasons({...base,status:'נמחק'},[gefen]),[]);
 assert.deepEqual(financeBillingMissingReasons(base,[paid,{...gefen,billedAmount:5000}]),[]);
 assert.deepEqual(financeBillingMissingReasons(base,[paid,{...gefen,approvedGefenRate:300,blockedReason:'',plannedHours:15}]),[]);
 assert.deepEqual(financeBillingMissingReasons({...base,course_hourly_rate:400},[{...gefen,blockedReason:'חסרים מועדי מפגשים מתוכננים'}]),[]);
 assert.deepEqual(financeBillingMissingReasons(base,[{...paid,blockedReason:'הפרש לאחר חיוב מלא — נדרשת בדיקת כספים',financialAdjustment:200}]),['הפרש לאחר חיוב מלא — נדרשת בדיקת כספים']);
 assert.deepEqual(financeBillingMissingReasons({row_id:'tour',activity_type:'tour',price:null},[]),[]);
});
