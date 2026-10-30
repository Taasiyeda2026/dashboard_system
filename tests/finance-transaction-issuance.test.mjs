import test from 'node:test';
import assert from 'node:assert/strict';
import { transactionAccountsViewHtml, transactionPreviewForVisit, transactionSelectionKey, runTransactionIssuance, transactionMonth, transactionBacklog } from '../frontend/src/screens/finance-transaction-issuance.js';
import { financeToday } from '../frontend/src/screens/finance-transaction-accounts.js';
const row=(extra={})=>({activityRowId:'a',activityName:'קורס א',fundingSourceId:'g',funding:'גפ״ן',gefenFunding:true,
  period:'2026-09-01',customerName:'בית ספר א',institutionSymbol:'123',payerName:'בית ספר א',customerEmail:'school@example.test',
  plannedCount:4,completedCount:2,billedCount:0,unbilledCount:2,unbilledHours:3,unbilledSlots:[{slot:1,date:'2026-09-01'},{slot:2,date:'2026-09-02'}],
  fundingAmount:5000,issuableAmount:2500,unbilledAmount:2500,eligible:true,blockedReason:'',...extra});
const data=(rows,extra={})=>({transactionContext:{billingRows:rows,accounts:[]},transactionMonths:{automatic:'2026-09',manual:'2026-09'},...extra});
const html=d=>transactionAccountsViewHtml(d,x=>`<h1>${x}</h1>`);
test('Gefen groups multiple courses by school and selected performance month only',()=>{
  const d=data([row(),row({activityRowId:'b',activityName:'קורס ב'}),row({activityRowId:'old',period:'2026-08-01'}),row({activityRowId:'other',fundingSourceId:'r',gefenFunding:false,funding:'רשות'})]);
  const p=transactionPreviewForVisit(d);assert.equal(p.accounts.length,1);assert.equal(p.accounts[0].lines.length,2);assert.equal(p.totals.amount,5000);
  const view=html(d);assert.match(view,/חשבונות עסקה - גפן/);assert.match(view,/חשבונות עסקה - פתוח/);assert.match(view,/type="month"/);
  assert.match(view,/קורס ב/);assert.match(view,/בית ספר א · 123/);assert.match(view,/פירוט מפגשים/);assert.match(view,/ממתינים להפקה מחודשים קודמים/);assert.match(view,/2026-08/);
  assert.equal(transactionBacklog(d,'automatic').length,1);
  d.transactionMonths.automatic='2026-08';assert.equal(transactionPreviewForVisit(d).totals.amount,2500);
});
test('open accounts uses completion month and funder grouping; mixed shares remain separate',()=>{
  const other=row({fundingSourceId:'r',funding:'רשות',gefenFunding:false,issuableAmount:7000});
  const d=data([row(),other,row({activityRowId:'future',gefenFunding:false,eligible:false,period:'2026-11-01'})],{transactionTab:'manual',transactionManualSelected:{[transactionSelectionKey(other)]:true}});
  assert.equal(transactionPreviewForVisit(d,'manual').totals.amount,7000);
  const view=html(d);assert.match(view,/חודש סיום הפעילות/);assert.match(view,/בית ספר א/);assert.doesNotMatch(view,/future/);
  assert.equal(transactionPreviewForVisit(d,'automatic').totals.amount,2500);
});
test('default is current month; future month is rejected and blocked rows cannot issue',()=>{
  assert.equal(transactionMonth({},'automatic'),financeToday().slice(0,7));
  assert.equal(transactionMonth({transactionMonths:{automatic:'2099-01'}},'automatic'),financeToday().slice(0,7));
  assert.equal(transactionMonth({},'manual'),financeToday().slice(0,7));
  const d=data([row({blockedReason:'חסרה חלוקת מימון תקינה',eligible:false})]);
  assert.equal(transactionPreviewForVisit(d).accounts.length,0);assert.doesNotMatch(html(d),/חסרה חלוקת מימון תקינה|פעילויות חסומות|חשבונות חסומים/);
  assert.equal(transactionPreviewForVisit(data([row()],{collectionError:'לא נטען'})).accounts.length,0);
});
test('issuance sends funder, exact month, slots and displayed amount to server and then dispatches',async()=>{
  const d=data([row()]);const calls=[];
  await runTransactionIssuance(d,{reserveFinanceTransactionAccount:async p=>{calls.push(p);return{id:'reserved'};},dispatchFinanceTransactionAccount:async p=>{assert.equal(p.accountId,'reserved');return{};}},'automatic');
  assert.deepEqual(calls[0].lines,[{activity_row_id:'a',funding_source_id:'g',performance_month:'2026-09-01',expected_amount:2500,meeting_slots:[1,2],issue_mode:'automatic'}]);
});
test('history retains existing document statuses and URLs independently of month selector',()=>{
  const d=data([],{transactionTab:'history'});d.transactionContext.accounts=[{transaction_account_number:8525,issue_date:'2026-07-01',total_amount:500,document_status:'issued',sharepoint_web_url:'https://example.test/pdf',finance_transaction_account_lines:[]}];
  const view=html(d);assert.match(view,/8525/);assert.match(view,/פתח PDF/);assert.doesNotMatch(view,/type="month"/);
});
test('backlog survives month/year selection without duplicate totals and can issue original month',async()=>{
  const d=data([row({period:'2025-12-01'}),row({activityRowId:'next',period:'2026-01-01'}),row({activityRowId:'selected',period:'2026-09-01'})]);
  assert.equal(transactionBacklog(d,'automatic').length,2);assert.equal(transactionPreviewForVisit(d).totals.amount,2500);
  d.transactionMonths.automatic='2025-12';
  assert.equal(transactionBacklog(d,'automatic').length,2);assert.equal(transactionPreviewForVisit(d).totals.amount,2500);
  let sent;
  await runTransactionIssuance(d,{reserveFinanceTransactionAccount:async p=>{sent=p;return{id:'x'};},dispatchFinanceTransactionAccount:async()=>({})},'automatic','2026-01');
  assert.equal(sent.lines[0].performance_month,'2026-01-01');assert.equal(sent.lines[0].activity_row_id,'next');
});
test('dispatch failure releases own reservation through guarded cancellation',async()=>{
  let cancelled;
  await assert.rejects(runTransactionIssuance(data([row()]),{reserveFinanceTransactionAccount:async()=>({id:'x'}),
    dispatchFinanceTransactionAccount:async()=>{throw Error('test failed');},cancelFinanceTransactionReservation:async id=>{cancelled=id;}},'automatic'),/test failed/);
  assert.equal(cancelled,'x');
});

test('empty months show only a concise empty state without internal diagnostics or zero-value cards',()=>{
  const d=data([]);const view=html(d);
  assert.match(view,/אין חשבונות להפקה בחודש שנבחר/);
  assert.doesNotMatch(view,/אין יתרות מחודשים אחרים|ממתינים להפקה מחודשים קודמים|פעילויות חסומות|חשבונות חסומים/);
  assert.doesNotMatch(view,/ds-fin-transaction-summary|data-finance-transaction-run=/);
});
test('technical reasons remain excluded from the visible list, but valid backlog stays visible',()=>{
  const d=data([row({activityRowId:'aug',period:'2026-08-01'}),row({activityRowId:'blocked',blockedReason:'חסר מימון',eligible:false})]);
  const view=html(d);
  assert.match(view,/ממתינים להפקה מחודשים קודמים/);
  assert.match(view,/2026-08/);
  assert.doesNotMatch(view,/חסר מימון|חסומות להפקה|אין יתרות מחודשים אחרים/);
});
