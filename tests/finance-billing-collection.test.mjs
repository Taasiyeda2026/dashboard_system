import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { financeActivityEndDate } from '../frontend/src/screens/finance-collection.js';
import { financeScreen, createFinanceVisitState } from '../frontend/src/screens/finance.js';
import { financeToday, financePaymentDueDate } from '../frontend/src/screens/finance-transaction-accounts.js';
import { financeAccountBalances, paymentsBodyHtml, accountPaymentAllocation } from '../frontend/src/screens/finance-payments.js';
const user={role:'admin'};
const base={row_id:'a',school_id:1,authority_id:1,school:'בית ספר',funding:'גפן + רשות',activity_name:'פעילות',sessions:'2',price:12000,activity_season:'school_2027',date_1:'2026-08-01',date_2:'2026-09-01'};
const account=(extra={})=>({id:'x',document_status:'issued',transaction_account_number:8525,customer_name_snapshot:'עיריית רחובות',payer_identity_snapshot:'עיריית רחובות',payer_key_snapshot:'authority:1',funding_source_id_snapshot:'r',issue_date:'2026-09-01',payment_due_date:'2026-10-01',total_amount:2500,sharepoint_web_url:'https://example.test/pdf',
  finance_transaction_account_lines:[{activity_row_id:'a',activity_name_snapshot:'פעילות',school_name_snapshot:'בית ספר',funding_source_id:'r',funding_snapshot:'רשות',amount:2500}],...extra});
const data=()=>({...createFinanceVisitState(),view:'collection',collectionActivities:[base],paymentContext:{receipts:[],allocations:[],balances:[{accountId:'x',paidAmount:1000,balance:1500}]},transactionContext:{schools:[],cancelled:[],billingRows:[],accounts:[account()]}});
test('collection tracks invoice identity, actual recorded payments and remaining balance without activity closure',()=>{
  const d=data();assert.equal(financeAccountBalances(d)[0].balance,1500);
  const view=financeScreen.render(d,{state:{user}});assert.match(view,/תקבולים שתועדו/);assert.match(view,/באיחור/);assert.match(view,/8525/);assert.match(view,/1,500.00/);assert.doesNotMatch(view,/data-finance-account-field="finance_note"/);
  assert.doesNotMatch(view,/data-fin-collect-field="collection_status"/);
  assert.equal(financeActivityEndDate({...base,end_date:'2026-07-01'}),'2026-09-01');
});
test('paid archive and reopening affect only the relevant invoice; cancelled documents are not debts',()=>{
  const d=data();d.transactionContext.accounts.push(account({id:'y',transaction_account_number:8526}),account({id:'cancelled',document_status:'cancelled',transaction_account_number:9999}));
  d.paymentContext.balances.push({accountId:'y',paidAmount:2500,balance:0});
  assert.match(paymentsBodyHtml(d),/8525/);assert.doesNotMatch(paymentsBodyHtml(d),/8526|9999/);
  d.collectionTab='closed';assert.match(paymentsBodyHtml(d),/8526/);assert.doesNotMatch(paymentsBodyHtml(d),/8525/);
  d.paymentContext.balances.find(x=>x.accountId==='y').balance=500;assert.doesNotMatch(paymentsBodyHtml(d),/8526/);
});
test('receipt allocation splits invoice lines and prevents paying beyond the remaining balance',()=>{
  const d=data();d.paymentContext.allocations=[{account_id:'x',activity_row_id:'a',amount:1000}];
  assert.deepEqual(accountPaymentAllocation(d,'x',1500),[{account_id:'x',activity_row_id:'a',amount:1500}]);
  assert.throws(()=>accountPaymentAllocation(d,'x',1501),/חורג/);
});
test('stable authority grouping combines spelling variants and never combines different authority IDs',()=>{
  const d=data();d.collectionTab='all';d.transactionContext.accounts.push(account({id:'same',customer_name_snapshot:'רחובות'}),account({id:'other',payer_key_snapshot:'authority:2',payer_identity_snapshot:'עיריית נהרייה',customer_name_snapshot:'נהריה'}));
  const dom=new JSDOM(paymentsBodyHtml(d));const summaries=[...dom.window.document.querySelectorAll('details.ds-fin-payer > summary')].map(n=>n.textContent);
  assert.equal(summaries.length,2);assert.match(summaries[0],/רחובות · 2 חשבונות/);assert.match(summaries[1],/נהרייה/);dom.window.close();
});
test('month selection and context loading fail closed; only school_2027 reaches billing preview',async()=>{
  const d=data();d.view='transactions';const dom=new JSDOM('<div id="app"></div>');const root=dom.window.document.querySelector('#app');const state={user};
  const paint=()=>{root.innerHTML=financeScreen.render(d,{state});};paint();financeScreen.bind({root,data:d,state,api:{},rerender:paint});
  const picker=root.querySelector('[data-finance-transaction-month]');picker.value='2025-12';picker.dispatchEvent(new dom.window.Event('change',{bubbles:true}));assert.equal(d.transactionMonths.automatic,'2025-12');root._financeUnbind();
  d.view='hub';paint();let ids;const api={listFinanceActivities:async()=>({rows:[base,{...base,row_id:'old',activity_season:'school_2026'}]}),financeTransactionContext:async()=>({accounts:[],schools:[],cancelled:[]}),listFinanceCollectionTracking:async()=>[],financePaymentContext:async()=>({balances:[],receipts:[],allocations:[]}),financeBillingPreview:async values=>{ids=values;return[];}};
  financeScreen.bind({root,data:d,state,api,rerender:paint});root.querySelector('[data-finance-open="transactions"]').dispatchEvent(new dom.window.Event('click',{bubbles:true}));await new Promise(r=>setTimeout(r,0));assert.deepEqual(ids,['a']); assert.deepEqual(d.collectionActivities.map(a=>a.row_id),['a']);root._financeUnbind();
  d.view='hub';paint();api.financePaymentContext=async()=>{throw Error('context unavailable');};financeScreen.bind({root,data:d,state,api,rerender:paint});root.querySelector('[data-finance-open="transactions"]').dispatchEvent(new dom.window.Event('click',{bubbles:true}));await new Promise(r=>setTimeout(r,0));assert.equal(d.transactionContext,null);assert.ok(d.collectionError);root._financeUnbind();dom.window.close();
});
test('recording full payment from an account row moves that account into archive and keeps history',async()=>{
  const d=data();const dom=new JSDOM('<div id="app"></div>');const root=dom.window.document.querySelector('#app');const state={user};
  const paint=()=>{root.innerHTML=financeScreen.render(d,{state});};paint();let recorded;
  const context=d.transactionContext;const payments=d.paymentContext;
  const api={listFinanceActivities:async()=>({rows:[base]}),financeTransactionContext:async()=>context,financeBillingPreview:async()=>[],financePaymentContext:async()=>payments,
    recordFinanceReceipt:async(receipt,allocations)=>{recorded={receipt,allocations};payments.balances=[{accountId:'x',paidAmount:2500,balance:0}];}};
  financeScreen.bind({root,data:d,state,api,rerender:paint});
  root.querySelector('[data-finance-payment-open]').dispatchEvent(new dom.window.Event('click',{bubbles:true}));
  const form=root.querySelector('[data-finance-payment-form]');form.querySelector('[name="amount"]').value='1500';form.querySelector('[name="reference"]').value='bank-ref';
  root.querySelector('[data-finance-receipt-save]').dispatchEvent(new dom.window.Event('click',{bubbles:true}));await new Promise(r=>setTimeout(r,0));
  assert.equal(recorded.allocations[0].account_id,'x');assert.equal(recorded.allocations[0].amount,1500);
  assert.doesNotMatch(root.querySelector('[data-finance-collection-body]').textContent,/8525/);
  root.querySelector('[data-finance-collection-tab="closed"]').dispatchEvent(new dom.window.Event('click',{bubbles:true}));assert.match(root.querySelector('[data-finance-collection-body]').textContent,/8525/);
  assert.equal(d.transactionContext.accounts[0].id,'x');root._financeUnbind();dom.window.close();
});

test('school_2026 invoices, receipts and orphaned test documents never appear in school_2027 finance',async()=>{
  const oldActivity={...base,row_id:'school26',activity_season:'school_2026'};
  const oldAccount=account({id:'old',transaction_account_number:8626,finance_transaction_account_lines:[{activity_row_id:'school26',funding_source_id:'r',amount:2500}]});
  const currentAccount=account({id:'current',transaction_account_number:8627});
  const orphanAccount=account({id:'orphan',transaction_account_number:8525,document_status:'cancelled',finance_transaction_account_lines:[]});
  const d=data();d.view='hub';
  const dom=new JSDOM('<div id="app"></div>');const root=dom.window.document.querySelector('#app');const state={user};
  const paint=()=>{root.innerHTML=financeScreen.render(d,{state});};paint();
  const api={
    listFinanceActivities:async()=>({rows:[base,oldActivity]}),
    financeTransactionContext:async()=>({accounts:[oldAccount,currentAccount,orphanAccount],schools:[],cancelled:[{activity_id:'school26',meeting_date:'2026-03-01'},{activity_id:'a',meeting_date:'2026-09-01'}]}),
    financeBillingPreview:async()=>[],
    financePaymentContext:async()=>({
      balances:[{accountId:'old',paidAmount:0,balance:2500},{accountId:'current',paidAmount:0,balance:2500}],
      receipts:[{id:'old-receipt',activity_row_id:'school26',amount:100},{id:'current-receipt',activity_row_id:'a',amount:150}],
      allocations:[{receipt_id:'old-receipt',account_id:'old',amount:100},{receipt_id:'current-receipt',account_id:'current',amount:150}]
    })
  };
  financeScreen.bind({root,data:d,state,api,rerender:paint});
  root.querySelector('[data-finance-open="collection"]').dispatchEvent(new dom.window.Event('click',{bubbles:true}));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.deepEqual(d.collectionActivities.map(a=>a.row_id),['a']);
  assert.deepEqual(d.transactionContext.accounts.map(a=>a.id),['current']);
  assert.deepEqual(d.paymentContext.receipts.map(r=>r.id),['current-receipt']);
  assert.deepEqual(d.paymentContext.balances.map(b=>b.accountId),['current']);
  assert.deepEqual(d.transactionContext.cancelled.map(c=>c.activity_id),['a']);
  assert.doesNotMatch(root.textContent,/8626|8525/);
  root._financeUnbind();dom.window.close();
});

test('manual issuance funder selector filters activities before the invoice is edited',()=>{
  const d=createFinanceVisitState();d.view='transactions';d.transactionTab='editable';
  d.collectionActivities=[
    {row_id:'mixed',school:'אוסישקין',authority:'נהרייה',authority_id:11,activity_name:'ביומימיקרי',funding:'גפן + רשות'},
    {row_id:'industry',school:'הרצל',authority:'עכו',authority_id:22,activity_name:'חלל',funding:'רמי שני'}
  ];
  d.transactionContext={accounts:[],cancelled:[],schools:[],billingRows:[
    {activityRowId:'mixed',fundingSourceId:'gefen',funding:'גפן',period:'2026-10-01',eligible:true,unbilledCount:1,issuableAmount:1000},
    {activityRowId:'mixed',fundingSourceId:'authority',funding:'רשות',period:'2027-02-01',eligible:true,unbilledCount:1,issuableAmount:2000},
    {activityRowId:'industry',fundingSourceId:'industry',funding:'רמי שני',period:'2027-02-01',eligible:true,unbilledCount:1,issuableAmount:5000}
  ]};
  const dom=new JSDOM('<div id="app"></div>'),root=dom.window.document.querySelector('#app'),state={user:{role:'admin'}};
  const refresh=()=>{root.innerHTML=financeScreen.render(d,{state});};refresh();
  financeScreen.bind({root,data:d,state,api:{},rerender:refresh});
  const filter=root.querySelector('[data-finance-manual-funder-filter]');
  filter.value='funder:רמי שני';
  filter.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  assert.equal(d.manualFunderFilter,'funder:רמי שני');
  const choices=[...root.querySelectorAll('[data-finance-manual-activity] option')].map(o=>o.value).filter(Boolean);
  assert.deepEqual(choices,['industry']);
  const activitySelect=root.querySelector('[data-finance-manual-activity]');
  activitySelect.value='industry';activitySelect.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  assert.equal(d.manualActivityId,'industry');
  assert.equal(d.manualFundingKey,'industry|2027-02-01');
  const filter2=root.querySelector('[data-finance-manual-funder-filter]');filter2.value='funder:גפן';
  filter2.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  assert.equal(d.manualActivityId,'');
  assert.deepEqual([...root.querySelectorAll('[data-finance-manual-activity] option')].map(o=>o.value).filter(Boolean),['mixed']);
  root._financeUnbind();dom.window.close();
});

test('entering either billing tab defaults to the current month, even after an old month was chosen',()=>{
  const d=data();d.view='transactions';
  const dom=new JSDOM('<div id="app"></div>'),root=dom.window.document.querySelector('#app'),state={user};
  const paint=()=>{root.innerHTML=financeScreen.render(d,{state});};paint();
  financeScreen.bind({root,data:d,state,api:{},rerender:paint});
  const earlier=root.querySelector('[data-finance-transaction-month="automatic"]');
  earlier.value='2026-09';earlier.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  assert.equal(d.transactionMonths.automatic,'2026-09');
  root.querySelector('[data-finance-transaction-tab="manual"]').click();
  assert.equal(d.transactionMonths.manual,financeToday().slice(0,7));
  root.querySelector('[data-finance-transaction-tab="automatic"]').click();
  assert.equal(d.transactionMonths.automatic,financeToday().slice(0,7));
  root._financeUnbind();dom.window.close();
});


test('collection displays exactly five accounting columns without unnecessary fields or statuses',()=>{
  const d=data();
  const dom=new JSDOM(paymentsBodyHtml(d));
  const doc=dom.window.document;
  const headers=[...doc.querySelectorAll('.ds-fin-collect-accounts thead th')].map(th=>th.textContent.trim());
  assert.deepEqual(headers,['מספר חשבון','גורם משלם','סכום החשבון','מועד תשלום','יתרה לתשלום']);
  assert.equal(doc.querySelectorAll('.ds-fin-collect-accounts tbody tr').length,1);
  const cells=[...doc.querySelectorAll('.ds-fin-collect-accounts tbody tr td')];
  assert.equal(cells.length,5);
  assert.match(cells[0].textContent,/8525/);
  assert.ok(cells[0].querySelector('a[href="https://example.test/pdf"]'),'PDF is accessible through the invoice number');
  assert.match(cells[2].textContent,/2,500.00/);
  assert.match(cells[3].textContent,/2026-10-01/);
  assert.match(cells[4].textContent,/1,500.00/);
  assert.ok(cells[4].querySelector('[data-finance-payment-open="x"]'),'payment is still recordable without extra column');
  assert.equal(doc.querySelector('[data-finance-account-field]'),null);
  dom.window.close();
});

test('November-issued September activity is tracked and ordered by December/January due dates',()=>{
  const d=data();
  d.transactionContext.accounts=[
    account({id:'second',transaction_account_number:8602,issue_date:'2026-11-10',payment_due_date:'2027-01-14',total_amount:3000}),
    account({id:'first',transaction_account_number:8601,issue_date:'2026-11-10',payment_due_date:'2026-12-30',total_amount:2500})
  ];
  d.paymentContext.balances=[{accountId:'second',paidAmount:0,balance:3000},{accountId:'first',paidAmount:0,balance:2500}];
  const dom=new JSDOM(paymentsBodyHtml(d));
  const numbers=[...dom.window.document.querySelectorAll('.ds-fin-collect-accounts tbody tr td:first-child')].map(td=>td.textContent.trim());
  assert.deepEqual(numbers,['8601','8602'],'due dates determine order rather than invoice issue date or activity date');
  assert.match(dom.window.document.body.textContent,/2026-12-30/);
  assert.match(dom.window.document.body.textContent,/2027-01-14/);
  assert.doesNotMatch(dom.window.document.querySelector('.ds-fin-collect-accounts').textContent,/2026-09-01/);
  dom.window.close();
});

test('linked payment form uses account payer automatically and does not require repeated funding selection',()=>{
  const d=data();
  d.paymentAccountId='x';
  const dom=new JSDOM(paymentsBodyHtml(d));
  const form=dom.window.document.querySelector('[data-finance-payment-form]');
  assert.ok(form);
  assert.equal(form.querySelector('[name="payer_name"]').value,'עיריית רחובות');
  assert.equal(form.querySelector('[name="payer_key"]').value,'authority:1');
  assert.equal(form.querySelector('[name="funding_source_id"]').value,'r');
  assert.deepEqual([...form.querySelectorAll('input:not([type="hidden"])')].map(input=>input.name),[
    'amount','received_date','reference','document_reference'
  ]);
  assert.equal(form.querySelector('[name="amount"]').value,'1500.00');
  assert.equal(form.querySelector('[name="amount"]').max,'1500');
  assert.match(form.textContent,/שמירת תקבול/);
  dom.window.close();
});

test('paid invoices appear in archive with no payment action and remain accessible by PDF',()=>{
  const d=data();
  d.paymentContext.balances=[{accountId:'x',paidAmount:2500,balance:0}];
  assert.doesNotMatch(paymentsBodyHtml(d),/8525/);
  d.collectionTab='closed';
  const dom=new JSDOM(paymentsBodyHtml(d));
  const row=dom.window.document.querySelector('.ds-fin-collect-accounts tbody tr');
  assert.ok(row);
  assert.equal(row.querySelectorAll('td').length,5);
  assert.match(row.textContent,/8525/);
  assert.match(row.textContent,/0.00/);
  assert.equal(row.querySelector('[data-finance-payment-open]'),null);
  assert.ok(row.querySelector('a[href="https://example.test/pdf"]'));
  dom.window.close();
});

test('due date is calculated from the end of invoice issue month, never the activity month',()=>{
  assert.equal(financePaymentDueDate('2026-11-10',30),'2026-12-30');
  assert.equal(financePaymentDueDate('2026-11-10',45),'2027-01-14');
  assert.equal(financePaymentDueDate('2026-11-10',60),'2027-01-29');
});
