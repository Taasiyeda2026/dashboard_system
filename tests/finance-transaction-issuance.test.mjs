import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { transactionAccountsViewHtml, FINANCE_TRANSACTION_SHAREPOINT_FOLDER_URL, transactionPreviewForVisit, transactionSelectionKey, runTransactionIssuance, transactionIssuanceResultMessage, transactionMonth, transactionBacklog } from '../frontend/src/screens/finance-transaction-issuance.js';
import { financeCycleCutoff, financeToday } from '../frontend/src/screens/finance-transaction-accounts.js';
const row=(extra={})=>({activityRowId:'a',activityName:'קורס א',fundingSourceId:'g',funding:'גפ״ן',gefenFunding:true,
  period:'2026-10-01',customerName:'בית ספר א',institutionSymbol:'123',payerName:'בית ספר א',customerEmail:'school@example.test',
  plannedCount:4,completedCount:2,billedCount:0,unbilledCount:2,unbilledHours:3,unbilledSlots:[{slot:1,date:'2026-10-01'},{slot:2,date:'2026-10-02'}],
  fundingAmount:5000,issuableAmount:2500,unbilledAmount:2500,eligible:true,blockedReason:'',...extra});
const data=(rows,extra={})=>({transactionContext:{billingRows:rows,accounts:[]},transactionMonths:{automatic:'2026-10',manual:'2026-10'},...extra});
const html=d=>transactionAccountsViewHtml(d,x=>`<h1>${x}</h1>`);
test('unified issuance processes original periods chronologically under cumulative server billing caps',async()=>{
  const d=data([row({period:'2026-10-01',unbilledSlots:[{slot:3,date:'2026-10-01'},{slot:4,date:'2026-10-02'}]}),
    row({period:'2026-09-01'})]);
  let billed=0;const periods=[];
  const results=await runTransactionIssuance(d,{
    reserveFinanceTransactionAccount:async p=>{
      const line=p.lines[0],target=line.performance_month==='2026-09-01'?2500:5000;
      if(line.expected_amount>target-billed)throw Error('stale_billing_preview');
      periods.push(line.performance_month);billed+=line.expected_amount;return{id:p.idempotencyKey};
    },dispatchFinanceTransactionAccount:async()=>({outlookStatus:'draft_ready'})
  },'automatic');
  assert.ok(results.every(r=>!r.error));assert.equal(billed,5000);assert.deepEqual(periods,['2026-09-01','2026-10-01']);
});
test('unified Gefen layout orders month summary current backlog single action and waiting; every group starts closed',()=>{
  const d=data([row(),row({activityRowId:'older',period:'2026-09-01'}),
    row({activityRowId:'waiting',eligible:false,blockedReason:'minimum',eligibilityStatus:'waiting_three_meetings',issuableAmount:0})]);
  const view=html(d);const dom=new JSDOM(view);const doc=dom.window.document;
  const ordered=['data-finance-transaction-month','ds-fin-transaction-summary','data-finance-gefen-current','data-finance-gefen-backlog','data-finance-transaction-run="automatic"','data-finance-waiting-courses'];
  assert.deepEqual(ordered.map(x=>view.indexOf(x)),ordered.map(x=>view.indexOf(x)).sort((a,b)=>a-b));
  assert.equal(doc.querySelectorAll('[data-finance-transaction-run]').length,1);
  assert.equal(doc.querySelector('[data-finance-transaction-run]').textContent,'הפקת כל חשבונות העסקה');
  assert.ok([...doc.querySelectorAll('details')].every(x=>!x.open));
  assert.equal(doc.querySelectorAll('[data-finance-transaction-group]').length,2);
  assert.equal(doc.querySelectorAll('[data-finance-transaction-group] .ds-fin-gefen-arrow[aria-hidden=true]').length,2);
  const cards=[...doc.querySelectorAll('.ds-fin-collect-summary-card')];
  assert.match(cards.find(x=>x.textContent.includes('חשבונות עסקה')).textContent,/2/);
  assert.match(cards.find(x=>x.textContent.includes('סכום להפקה')).textContent,/5,000/);
  const group=doc.querySelector('[data-finance-transaction-group]');group.querySelector('summary').click();assert.equal(group.open,true);
  group.querySelector('summary').click();assert.equal(group.open,false);
  group.open=true;
  for(const month of ['2026-09','2026-10']) {
    d.transactionMonths.automatic=month;doc.body.innerHTML=html(d);assert.ok([...doc.querySelectorAll('details')].every(x=>!x.open));
  }
  doc.body.innerHTML=html(d);assert.ok([...doc.querySelectorAll('details')].every(x=>!x.open),'data refresh rerenders collapsed groups');
  dom.window.close();
});
test('one click issues all collapsed eligible groups exactly once with separate schools funders and periods',async()=>{
  const lines=[row(),row({activityRowId:'older',period:'2026-09-01'}),row({activityRowId:'school2',institutionSymbol:'222',payerKey:'school:2'}),
    row({activityRowId:'fund2',fundingSourceId:'g2'}),row({activityRowId:'future',period:'2026-11-01'}),
    row({activityRowId:'waiting',eligible:false,blockedReason:'minimum',eligibilityStatus:'waiting_three_meetings',issuableAmount:0})];
  const d=data([...lines,lines[1]]);const dom=new JSDOM(html(d));
  assert.ok([...dom.window.document.querySelectorAll('details')].every(x=>!x.open));
  const requests=[],dispatches=[];
  const api={reserveFinanceTransactionAccount:async p=>{requests.push(p);return{id:p.idempotencyKey};},dispatchFinanceTransactionAccount:async p=>{dispatches.push(p);return{outlookStatus:'draft_ready'};}};
  const result=await runTransactionIssuance(d,api,'automatic');
  assert.equal(result.length,4);assert.equal(requests.length,4);assert.equal(dispatches.length,4);
  assert.deepEqual(requests.flatMap(x=>x.lines.map(l=>l.activity_row_id)).sort(),['a','fund2','older','school2']);
  const earlier=requests.find(x=>x.lines[0].activity_row_id==='older');assert.equal(earlier.lines[0].performance_month,'2026-09-01');
  assert.ok(requests.every(x=>new Set(x.lines.map(l=>l.funding_source_id)).size===1));
  d.transactionMonths.automatic='2026-09';await runTransactionIssuance(d,api,'automatic');
  assert.equal(requests.at(-1).idempotencyKey,earlier.idempotencyKey,'same account keeps its idempotency key across month selection and retry');
  d.transactionContext.billingRows=[];assert.equal(transactionPreviewForVisit(d).accounts.length,0,'billed rows removed by authoritative refresh cannot be issued again');
  d.transactionTab='history';d.transactionContext.accounts=[{id:'issued',transaction_account_number:8525,document_status:'issued',finance_transaction_account_lines:[]}];
  dom.window.document.body.innerHTML=html(d);
  assert.ok([...dom.window.document.querySelectorAll('details')].every(x=>!x.open),'issuance history is collapsed after production and refresh');
  dom.window.close();
});
test('waiting Microsoft status offers connection only to the original issuer and reports preserved invoices',()=>{
  const d=data([],{transactionTab:'history',financeAuthUserId:'issuer'});
  d.transactionContext.accounts=[{id:'a',document_status:'issued',outlook_status:'waiting_connection',outlook_owner_id:'issuer',
    outlook_owner_mailbox:'toni@think.org.il',transaction_account_number:8525,finance_transaction_account_lines:[]}];
  assert.match(html(d),/ממתין לחיבור Microsoft/);assert.match(html(d),/data-finance-microsoft-connect/);
  assert.doesNotMatch(html({...d,financeAuthUserId:'other'}),/data-finance-microsoft-connect/);
  const message=transactionIssuanceResultMessage([{dispatched:{outlookStatus:'waiting_connection',documentPreserved:true}}]);
  assert.match(message,/נשמרו 1 חשבונות/);assert.match(message,/יושלמו אוטומטית לאחר החיבור/);
});
test('history displays original issuer mailbox and a clear authorization error without technical codes',()=>{
  const d=data([],{transactionTab:'history'});
  d.transactionContext.accounts=[{id:'issued',transaction_account_number:'8525',customer_name_snapshot:'מוסד',
    document_status:'issued',outlook_status:'failed',outlook_owner_mailbox:'toni@think.org.il',
    outlook_error:'invoice_mailbox_access_denied',finance_transaction_account_lines:[]}];
  const view=html(d);assert.match(view,/toni@think.org.il/);assert.match(view,/החיבור ל־Microsoft פג או שאינו מאפשר גישה לתיבת המפיק המקורי/);
  assert.doesNotMatch(view,/invoice_mailbox_access_denied/);
});
test('Gefen groups schools and original months while including eligible previous months',()=>{
  const d=data([row(),row({activityRowId:'b',activityName:'קורס ב'}),row({activityRowId:'old',period:'2026-09-01'}),row({activityRowId:'other',fundingSourceId:'r',gefenFunding:false,funding:'רשות'})]);
  const p=transactionPreviewForVisit(d);assert.equal(p.accounts.length,2);assert.equal(p.accounts.find(a=>a.period==='2026-10-01').lines.length,2);assert.equal(p.totals.amount,7500);
  const view=html(d);assert.match(view,/חשבונות עסקה - גפן/);assert.match(view,/חשבונות עסקה - פתוח/);assert.match(view,/type="month"/);
  assert.match(view,/קורס ב/);assert.match(view,/בית ספר א · 123/);assert.match(view,/פירוט מפגשים/);assert.match(view,/חיובים זכאים מחודשים קודמים/);assert.match(view,/2026-09/);
  assert.equal(transactionBacklog(d,'automatic').length,1);
  d.transactionMonths.automatic='2026-09';assert.equal(transactionPreviewForVisit(d).totals.amount,2500);
});
test('open accounts uses completion month and funder grouping; mixed shares remain separate',()=>{
  const other=row({fundingSourceId:'r',funding:'רשות',gefenFunding:false,issuableAmount:7000});
  const d=data([row(),other,row({activityRowId:'future',gefenFunding:false,eligible:false,period:'2026-11-01'})],{transactionTab:'manual',transactionManualSelected:{[transactionSelectionKey(other)]:true}});
  assert.equal(transactionPreviewForVisit(d,'manual').totals.amount,7000);
  const view=html(d);assert.match(view,/חודש ביצוע/);assert.match(view,/בית ספר א/);assert.doesNotMatch(view,/future/);
  assert.equal(transactionPreviewForVisit(d,'automatic').totals.amount,2500);
});
test('default is previous closed month; future month is rejected and blocked rows cannot issue',()=>{
  assert.equal(transactionMonth({},'automatic'),financeCycleCutoff().slice(0,7));
  assert.equal(transactionMonth({transactionMonths:{automatic:'2099-01'}},'automatic'),financeCycleCutoff().slice(0,7));
  assert.equal(transactionMonth({},'manual'),financeCycleCutoff().slice(0,7));
  const d=data([row({blockedReason:'חסרה חלוקת מימון תקינה',eligible:false})]);
  assert.equal(transactionPreviewForVisit(d).accounts.length,0);assert.doesNotMatch(html(d),/חסרה חלוקת מימון תקינה|פעילויות חסומות|חשבונות חסומים/);
  assert.equal(transactionPreviewForVisit(data([row()],{collectionError:'לא נטען'})).accounts.length,0);
});

test('calendar minimum shows waiting courses with selected-month cumulative count and no issuance action',()=>{
  const waiting = row({activityType:'course',period:'2026-10-01',completedCount:2,
    eligible:false,issuableAmount:0,blockedReason:'ממתין להשלמת שלושה מפגשים',eligibilityStatus:'waiting_three_meetings'});
  const d=data([waiting],{transactionMonths:{automatic:'2026-10'}});
  const view=html(d);
  assert.match(view,/קורסים הממתינים להשלמת שלושה מפגשים/);
  assert.match(view,/2 מתוך 3/);
  const dom=new JSDOM(view);
  const details=dom.window.document.querySelector('[data-finance-waiting-courses]');
  assert.equal(details.open,false);assert.equal(details.querySelectorAll('tbody tr').length,1);
  assert.equal(details.querySelectorAll('ul,li').length,0);dom.window.close();
  assert.doesNotMatch(view,/data-finance-transaction-run=/);
  assert.equal(transactionPreviewForVisit(d).accounts.length,0);
});

test('calendar carryover issues in November while October remains blocked',t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-12-04T10:00:00Z')});
  const d=data([
    row({period:'2026-10-01',eligible:false,issuableAmount:0,completedCount:2,
      blockedReason:'ממתין להשלמת שלושה מפגשים',eligibilityStatus:'waiting_three_meetings'}),
    row({period:'2026-11-01',completedCount:3,unbilledCount:3,unbilledSlots:[
      {slot:1,date:'2026-10-01'},{slot:2,date:'2026-10-20'},{slot:3,date:'2026-11-01'}]})
  ],{transactionMonths:{automatic:'2026-10'}});
  assert.equal(transactionPreviewForVisit(d).accounts.length,0);
  d.transactionMonths.automatic='2026-11';
  const preview=transactionPreviewForVisit(d);
  assert.equal(preview.accounts.length,1);
  assert.deepEqual(preview.accounts[0].lines[0].unbilledSlots.map(s=>s.slot),[1,2,3]);
  assert.doesNotMatch(html(d),/ממתין להשלמת שלושה מפגשים/);
});
test('issuance sends funder, exact month, slots and displayed amount to server and then dispatches',async()=>{
  const d=data([row()]);const calls=[];
  await runTransactionIssuance(d,{reserveFinanceTransactionAccount:async p=>{calls.push(p);return{id:'reserved'};},dispatchFinanceTransactionAccount:async p=>{assert.equal(p.accountId,'reserved');return{};}},'automatic');
  assert.deepEqual(calls[0].lines,[{activity_row_id:'a',funding_source_id:'g',performance_month:'2026-10-01',billing_range_end:'2026-10-01',expected_amount:2500,meeting_slots:[1,2],issue_mode:'automatic'}]);
});
test('history retains existing document statuses and URLs independently of month selector',()=>{
  const d=data([],{transactionTab:'history'});d.transactionContext.accounts=[{transaction_account_number:8525,issue_date:'2026-07-01',total_amount:500,document_status:'issued',sharepoint_web_url:'https://example.test/pdf',finance_transaction_account_lines:[]}];
  const view=html(d);assert.match(view,/8525/);assert.match(view,/פתח PDF/);assert.doesNotMatch(view,/type="month"/);
});
test('backlog includes only the selected school year and can issue original closed months',async t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date('2027-01-10T10:00:00Z')});
  const d=data([row({period:'2026-09-01'}),row({activityRowId:'next',period:'2026-10-01'}),row({activityRowId:'selected',period:'2026-12-01'}),row({activityRowId:'old-year',period:'2025-12-01'})],{transactionMonths:{automatic:'2026-12'}});
  assert.equal(transactionBacklog(d,'automatic').length,2);assert.equal(transactionPreviewForVisit(d).totals.amount,7500);
  d.transactionMonths.automatic='2026-09';assert.equal(transactionBacklog(d,'automatic').length,0);assert.equal(transactionPreviewForVisit(d).totals.amount,2500);
  const sent=[];await runTransactionIssuance(d,{reserveFinanceTransactionAccount:async p=>{sent.push(p);return{id:'x'};},dispatchFinanceTransactionAccount:async()=>({})},'automatic','2026-10');
  assert.deepEqual(sent.map(p=>p.lines[0].performance_month),['2026-09-01','2026-10-01']);
});
test('dispatch failure records partial outcome and releases only its own generating reservation',async()=>{
  let cancelled;
  const results=await runTransactionIssuance(data([row()]),{reserveFinanceTransactionAccount:async()=>({id:'x'}),
    dispatchFinanceTransactionAccount:async()=>{throw Error('test failed');},cancelFinanceTransactionReservation:async id=>{cancelled=id;}},'automatic');
  assert.equal(results[0].error,'test failed');
  assert.equal(cancelled,'x');
});

test('monthly batch continues after one account fails and reports missing recipients separately',async()=>{
  const d=data([row({institutionSymbol:'1'}),row({activityRowId:'b',institutionSymbol:'2'}),row({activityRowId:'c',institutionSymbol:'3'})]);
  let count=0;
  const results=await runTransactionIssuance(d,{reserveFinanceTransactionAccount:async()=>({id:String(++count)}),
    dispatchFinanceTransactionAccount:async p=>{if(p.accountId==='1')throw Error('failed');return {outlookStatus:p.accountId==='2'?'draft_ready':'missing_recipient'};}},'automatic');
  assert.equal(results.length,3);assert.equal(results[1].dispatched.outlookStatus,'draft_ready');
  assert.match(transactionIssuanceResultMessage(results),/נשמרו 2 חשבונות/);assert.match(transactionIssuanceResultMessage(results),/חסרים נמענים ל-1/);
});

test('lost dispatch response retains request identity when cancellation refuses an issued account',async()=>{
  const d=data([row()]);const keys=[];
  const api={reserveFinanceTransactionAccount:async p=>{keys.push(p.idempotencyKey);return{id:'same'};},
    dispatchFinanceTransactionAccount:async()=>{throw Error('response lost');},cancelFinanceTransactionReservation:async()=>{throw Error('account_not_cancellable');}};
  await runTransactionIssuance(d,api,'automatic');await runTransactionIssuance(d,api,'automatic');
  assert.equal(keys[0],keys[1]);
});

test('history shows recovery for failed drafts but no mandatory transfer button for ready drafts',()=>{
  const d=data([],{transactionTab:'history'});
  d.transactionContext.accounts=[{id:'failed',transaction_account_number:'Pl1',document_status:'issued',outlook_status:'failed'},
    {id:'ready',transaction_account_number:'Pl2',document_status:'mail_draft_ready',outlook_status:'draft_ready'}];
  const view=html(d);assert.match(view,/data-finance-account-draft="failed"/);assert.doesNotMatch(view,/data-finance-account-draft="ready"|שליחה לאיש הקשר/);
});

test('empty months show only a concise empty state without internal diagnostics or zero-value cards',()=>{
  const d=data([]);const view=html(d);
  assert.match(view,/אין חשבונות להפקה בחודש שנבחר/);
  assert.doesNotMatch(view,/אין יתרות מחודשים אחרים|חיובים זכאים מחודשים קודמים|פעילויות חסומות|חשבונות חסומים/);
  assert.doesNotMatch(view,/ds-fin-transaction-summary|data-finance-transaction-run=/);
});
test('technical reasons remain excluded from the visible list, but valid backlog stays visible',()=>{
  const d=data([row({activityRowId:'aug',period:'2026-09-01'}),row({activityRowId:'blocked',blockedReason:'חסר מימון',eligible:false})]);
  const view=html(d);
  assert.match(view,/חיובים זכאים מחודשים קודמים/);
  assert.match(view,/2026-09/);
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
  ],{transactionMonths:{manual:'2026-10'}}),'manual');
  assert.equal(preview.accounts.length,1,'monthly open invoices include all eligible rows without selecting or expanding them');
  assert.deepEqual(preview.accounts[0].customerEmails,[]);
  const selected=data([
    row({gefenFunding:false,activityRowId:'w1',financeSchoolId:11,payerKey:'funding:sponsor',customerEmail:'one@example.test'}),
    row({gefenFunding:false,activityRowId:'w2',financeSchoolId:22,payerKey:'funding:sponsor',customerEmail:'two@example.test'})
  ],{transactionMonths:{manual:'2026-10'},transactionManualSelected:{'w1:g:2026-10-01':true,'w2:g:2026-10-01':true}});
  const groups=transactionPreviewForVisit(selected,'manual').accounts;
  assert.equal(groups.length,1);
  assert.equal(groups[0].institutionSymbol,'','a sponsor invoice must not inherit any school symbol');
  assert.equal(groups[0].lines.length,2);
  assert.deepEqual(groups[0].customerEmails,[]);
});
test('Gefen continues issuing separate accounts for each school, even across a shared billing month',()=>{
  const preview=transactionPreviewForVisit(data([
    row({activityRowId:'a',institutionSymbol:'111',payerKey:'school:a'}),
    row({activityRowId:'b',institutionSymbol:'222',payerKey:'school:b'})
  ]),'automatic');
  assert.equal(preview.accounts.length,2);
  assert.deepEqual(preview.accounts.map(x=>x.institutionSymbol).sort(),['111','222']);
});
test('one sponsor with two completed activities across different schools creates one account for issuance',async()=>{
  const lines=[
    row({gefenFunding:false,activityRowId:'s1',fundingSourceId:'sponsor',institutionSymbol:'111',
      payerKey:'funding:sponsor',payerName:'חברת תעשייה',customerName:'בית ספר א',issuableAmount:1250}),
    row({gefenFunding:false,activityRowId:'s2',fundingSourceId:'sponsor',institutionSymbol:'222',
      payerKey:'funding:sponsor',payerName:'חברת תעשייה',customerName:'בית ספר ב',issuableAmount:1500})
  ];
  const selected=Object.fromEntries(lines.map(line=>[transactionSelectionKey(line),true]));
  const d=data(lines,{transactionMonths:{manual:'2026-10'},transactionManualSelected:selected});
  const preview=transactionPreviewForVisit(d,'manual');
  assert.equal(preview.accounts.length,1);
  assert.equal(preview.accounts[0].totalAmount,2750);
  const requests=[];
  await runTransactionIssuance(d,{
    reserveFinanceTransactionAccount:async p=>{requests.push(p);return{id:'one'};},
    dispatchFinanceTransactionAccount:async()=>({})
  },'manual');
  assert.equal(requests.length,1);
  assert.equal(requests[0].lines.length,2);
  assert.equal(requests[0].institutionSymbol,'');
});

test('a tour is one quantity, not a course meeting or 1.5 billing hours',()=>{
  const trip=row({activityRowId:'trip',activityName:'התנסות בתעשייה',activityType:'tour',
    plannedCount:1,scheduledCount:1,completedCount:1,unbilledCount:1,unbilledHours:0,
    unbilledSlots:[{slot:1,date:'2026-10-10'}],issuableAmount:3000,fundingAmount:3000});
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
    unbilledCount:1,unbilledHours:0,unbilledSlots:[{slot:1,date:'2026-10-12'}],
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
  // Verify the database migration treats tours as quantity-based services.
  const sql=readFileSync(new URL('../supabase/migrations/20261030190000_finance_tour_quantity_without_meetings.sql',import.meta.url),'utf8');
  assert.match(sql,/activity_type,''\)\)\)='tour' then 1/);
  assert.match(sql,/scheduled<planned and lower\(btrim\(coalesce\(p_activity\.activity_type,''\)\)\)<>'tour'/);
  assert.match(sql,/'activityType',p_activity\.activity_type/);
  assert.match(sql,/'unbilledHours',case when lower/);
  assert.match(sql,/p_activity\.price is null or p_activity\.price<=0/);
});
