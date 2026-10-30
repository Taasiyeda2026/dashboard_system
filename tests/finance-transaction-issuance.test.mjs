import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { transactionAccountsViewHtml, FINANCE_TRANSACTION_SHAREPOINT_FOLDER_URL, transactionPreviewForVisit, transactionSelectionKey, runTransactionIssuance, transactionMonth, transactionBacklog } from '../frontend/src/screens/finance-transaction-issuance.js';
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

test('invoice tabs include a single orange SharePoint folder shortcut for all modes',()=>{
  assert.equal(FINANCE_TRANSACTION_SHAREPOINT_FOLDER_URL,
    'https://think365orgil.sharepoint.com/Site9/Shared%20Documents/%D7%A2%D7%99%D7%93%D7%9F%20-%20%D7%98%D7%95%D7%A0%D7%99/%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%95%D7%AA%20%D7%A2%D7%A1%D7%A7%D7%94%20-%20%D7%AA%D7%A9%D7%A4%D7%96');
  for (const tab of ['automatic','manual','history','editable']) {
    const dom=new JSDOM(html(data([], {transactionTab:tab})));
    const {document}=dom.window;
    const anchors=document.querySelectorAll('.ds-fin-transaction-folder-link');
    assert.equal(anchors.length,1,tab);
    const folder=anchors[0];
    assert.equal(folder.getAttribute('href'), FINANCE_TRANSACTION_SHAREPOINT_FOLDER_URL);
    assert.equal(folder.getAttribute('target'), '_blank');
    assert.match(folder.getAttribute('rel')||'', /noopener/);
    assert.match(folder.getAttribute('aria-label')||'', /פתיחת תיקיית חשבונות עסקה/);
    assert.ok(folder.querySelector('svg[aria-hidden="true"]'),'folder icon is graphical, not an extra text button');
    assert.equal(document.querySelectorAll('.ds-fin-transaction-nav [data-finance-transaction-tab]').length,4,'original four invoice tabs remain unchanged');
    assert.equal(document.querySelectorAll('.ds-fin-transaction-nav [role="tablist"] > a').length,0,'folder must not become a selectable tab');
    dom.window.close();
  }
});


test('invoice recipient list deduplicates contact and administrator for one school',()=>{
  const preview=transactionPreviewForVisit(data([
    row({activityRowId:'a',financeSchoolId:101,customerEmail:'teacher@example.test;ADMIN@example.test'}),
    row({activityRowId:'b',financeSchoolId:101,customerEmail:'admin@example.test;teacher@example.test'})
  ]));
  assert.deepEqual(preview.accounts[0].customerEmails,['teacher@example.test','admin@example.test']);
});

test('a sponsor invoice spanning two schools never receives unrelated school contacts',()=>{
  const preview=transactionPreviewForVisit(data([
    row({gefenFunding:false,activityRowId:'w1',financeSchoolId:11,payerKey:'funding:sponsor',customerEmail:'one@example.test'}),
    row({gefenFunding:false,activityRowId:'w2',financeSchoolId:22,payerKey:'funding:sponsor',customerEmail:'two@example.test'})
  ],{transactionMonths:{manual:'2026-09'}}),'manual');
  assert.equal(preview.accounts.length,0,'manual invoices require selection before an account is drafted');
  const selected=data([
    row({gefenFunding:false,activityRowId:'w1',financeSchoolId:11,payerKey:'funding:sponsor',customerEmail:'one@example.test'}),
    row({gefenFunding:false,activityRowId:'w2',financeSchoolId:22,payerKey:'funding:sponsor',customerEmail:'two@example.test'})
  ],{transactionMonths:{manual:'2026-09'},transactionManualSelected:{'w1:g:2026-09-01':true,'w2:g:2026-09-01':true}});
  const groups=transactionPreviewForVisit(selected,'manual').accounts;
  assert.equal(groups.length,1);
  assert.deepEqual(groups[0].customerEmails,[]);
});

test('a tour is one quantity, not a course meeting or 1.5 billing hours',()=>{
  const trip=row({activityRowId:'trip',activityName:'התנסות בתעשייה',activityType:'tour',
    plannedCount:1,scheduledCount:1,completedCount:1,unbilledCount:1,unbilledHours:0,
    unbilledSlots:[{slot:1,date:'2026-09-10'}],issuableAmount:3000,fundingAmount:3000});
  const d=data([trip]);
  const preview=transactionPreviewForVisit(d);
  assert.equal(preview.totals.units,1);
  assert.equal(preview.totals.meetings,0);
  assert.equal(preview.totals.hours,0);
  assert.equal(preview.totals.amount,3000);
  const view=html(d);
  assert.match(view,/כמות סדנאות\/סיורים/);
  assert.match(view,/כמות 1/);
  assert.match(view,/<th>כמות<\/th>/);
  assert.match(view,/פירוט מועדי פעילות/);
  assert.doesNotMatch(view,/פירוט מפגשים|1\.5 שעות|שעות לחיוב|מפגשים לחיוב/);
});

test('course and tour on the same invoice retain separate quantity and hours',()=>{
  const trip=row({activityRowId:'trip',activityName:'סיור',activityType:'tour',
    unbilledCount:1,unbilledHours:0,unbilledSlots:[{slot:1,date:'2026-09-12'}],
    fundingAmount:3000,issuableAmount:3000});
  const d=data([row(),trip]);
  const p=transactionPreviewForVisit(d);
  assert.equal(p.totals.meetings,2);
  assert.equal(p.totals.hours,3);
  assert.equal(p.totals.units,1);
  assert.equal(p.totals.amount,5500);
  const view=html(d);
  assert.match(view,/<th>מפגשים \/ כמות<\/th>/);
  assert.match(view,/פירוט מפגשים/);
  assert.match(view,/פירוט מועדי פעילות/);
});

test('tour database billing migration derives a single unit independent of sessions',()=>{
  const {readFileSync}=await import('node:fs');
  const sql=readFileSync(new URL('../supabase/migrations/20261030190000_finance_tour_quantity_without_meetings.sql',import.meta.url),'utf8');
  assert.match(sql,/activity_type,''\)\)\)='tour' then 1/);
  assert.match(sql,/scheduled<planned and lower\(btrim\(coalesce\(p_activity\.activity_type,''\)\)\)<>'tour'/);
  assert.match(sql,/'activityType',p_activity\.activity_type/);
  assert.match(sql,/'unbilledHours',case when lower/);
});
