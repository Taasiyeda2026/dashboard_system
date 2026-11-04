import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {invoiceRevisionDraft,revisionIsFinancial,invoiceRevisionEditorHtml,invoiceRevisionAdminHtml,bindInvoiceRevisions} from '../frontend/src/screens/finance-invoice-revisions.js';
const account=()=>({id:'account',transaction_account_number:'Pl26000170',document_status:'issued',customer_name_snapshot:'בית ספר',customer_email_snapshot:'old@example.test',payer_key_snapshot:'school:652',institution_symbol:'248724',issue_date:'2026-11-04',payment_due_date:'2026-12-30',total_amount:2400,
 finance_transaction_account_lines:[{id:'line',activity_row_id:'activity',funding_source_id:'gefen',activity_name_snapshot:'יישומי AI',school_name_snapshot:'בית ספר',service_description_snapshot:'יישומי AI',activity_price_snapshot:8000,planned_meeting_count_snapshot:10,funding_amount_snapshot:8000,quantity_snapshot:3,billed_hours:4.5,amount:2400,billing_coverage:'performance',finance_transaction_account_meetings:[{meeting_slot:1},{meeting_slot:2},{meeting_slot:3}]}]});
const data=()=>{const a=account();return {view:'transactions',transactionTab:'history',financeAdmin:false,invoiceRevisionContext:{account:a,baseHash:'base',versions:[{version:0,created_at:'2026-11-04T10:00:00Z',snapshot:{sharepoint_web_url:'https://example.test/original.pdf'}}],requests:[]},invoiceRevisionDraft:invoiceRevisionDraft(a)};};
const tick=()=>new Promise(r=>setTimeout(r,0));
function mount(d,api){const dom=new JSDOM('<div id="root"></div>'),root=dom.window.document.querySelector('#root');const paint=()=>root.innerHTML=invoiceRevisionAdminHtml(d)+invoiceRevisionEditorHtml(d);paint();bindInvoiceRevisions({root,data:d,api,refresh:paint,reload:async()=>{}});return {dom,root};}
test('history edit is prefilled, keeps payer identities fixed, and retains previous version links',()=>{
 const d=data(),doc=new JSDOM(invoiceRevisionEditorHtml(d)).window.document;
 assert.equal(doc.querySelector('[data-invoice-revision-field="customer_name_snapshot"]').value,'בית ספר');assert.equal(doc.querySelector('[data-invoice-revision-field="amount"]').value,'2400');
 assert.equal(doc.querySelector('[data-invoice-revision-field="issue_date"]').readOnly,true);assert.equal(doc.querySelector('[data-invoice-revision-field="funding_source_id"]'),null);assert.equal(doc.querySelector('[data-invoice-revision-field="activity_row_id"]'),null);
 assert.ok([...doc.querySelectorAll('details')].every(x=>!x.open));assert.equal(doc.querySelector('a').href,'https://example.test/original.pdf');assert.match(doc.body.textContent,/533.33/);assert.equal(revisionIsFinancial(d.invoiceRevisionContext.account,d.invoiceRevisionDraft),false);
});
test('financial field changes calculate hours and amount without rebuilding the open editor; they request approval rather than PDF',async()=>{
 const d=data(),calls=[];const {root,dom}=mount(d,{requestFinanceInvoiceRevision:async p=>{calls.push(p);return {id:'r',status:'pending_admin',financial:true};},previewFinanceInvoiceRevision:async()=>{throw Error('must not preview before approval');}});
 const details=root.querySelector('details');details.open=true;const quantity=root.querySelector('[data-invoice-revision-field="quantity_snapshot"]');quantity.value='2';quantity.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
 assert.strictEqual(root.querySelector('details'),details);assert.equal(details.open,true);assert.strictEqual(root.querySelector('[data-invoice-revision-field="quantity_snapshot"]'),quantity);
 assert.equal(d.invoiceRevisionDraft.lines[0].billed_hours,3);assert.equal(d.invoiceRevisionDraft.lines[0].amount,1600);assert.equal(root.querySelector('[data-invoice-revision-preview]').textContent,'בקשת אישור אדמין');
 root.querySelector('[data-invoice-revision-preview]').click();await tick();assert.equal(calls.length,1);assert.equal(calls[0].accountId,'account');assert.match(root.textContent,/ממתין לאישור אדמין/);assert.equal(d.invoiceRevisionPreview,null);
 assert.equal(d.invoiceRevisionContext.account.total_amount,2400);root._invoiceRevisionUnbind();dom.window.close();
});
test('text-only correction follows existing PDF review and requires an explicit confirmation before applying',async()=>{
 const d=data(),calls=[];const {root,dom}=mount(d,{requestFinanceInvoiceRevision:async p=>{calls.push('request');return {id:'r',status:'approved',financial:false};},previewFinanceInvoiceRevision:async()=>{calls.push('preview');return {quote:{revision:'q',total_amount:2400},pdfBase64:'JVBERg=='};}});
 const name=root.querySelector('[data-invoice-revision-field="customer_name_snapshot"]');name.value='שם מתוקן';name.dispatchEvent(new dom.window.Event('change',{bubbles:true}));root.querySelector('[data-invoice-revision-preview]').click();await tick();
 assert.deepEqual(calls,['request','preview']);assert.ok(root.querySelector('[data-invoice-revision-confirm]'));assert.ok(root.querySelector('[data-invoice-revision-pdf-open]'));assert.equal(d.invoiceRevisionContext.account.customer_name_snapshot,'בית ספר');root._invoiceRevisionUnbind();dom.window.close();
});
test('admin queue displays before and after values and separate explicit approve/reject buttons',()=>{
 const d={financeAdmin:true,invoiceRevisionAdminRequests:[{id:'r',account_id:'account',status:'pending_admin',requested_name:'טוני',before_snapshot:account(),changes:[{line:'line',field:'amount',before:2400,after:1600}]}]};const doc=new JSDOM(invoiceRevisionAdminHtml(d)).window.document;
 assert.match(doc.body.textContent,/טוני/);assert.match(doc.body.textContent,/2400/);assert.match(doc.body.textContent,/1600/);assert.equal(doc.querySelector('[data-invoice-revision-approve]').textContent,'אישור');assert.equal(doc.querySelector('[data-invoice-revision-reject]').textContent,'דחייה');
 assert.equal(invoiceRevisionAdminHtml({...d,financeAdmin:false}),'');
});
test('finance review states cannot generate a replacement and cancelled history remains read-only',()=>{
 const d=data();d.invoiceRevisionRequest={id:'r',status:'finance_review_required'};let doc=new JSDOM(invoiceRevisionEditorHtml(d)).window.document;assert.equal(doc.querySelector('[data-invoice-revision-preview]'),null);assert.match(doc.body.textContent,/החלטת כספים/);
 d.invoiceRevisionRequest=null;d.invoiceRevisionContext.account.document_status='cancelled';doc=new JSDOM(invoiceRevisionEditorHtml(d)).window.document;assert.equal(doc.querySelector('[data-invoice-revision-preview]'),null);assert.ok([...doc.querySelectorAll('[data-invoice-revision-field]')].every(x=>x.readOnly));
});

test('admin approves their financial edit explicitly and goes straight to PDF review, without a self-approval waiting step',async()=>{
 const d=data();d.financeAdmin=true;d.invoiceRevisionAdminLoaded=true;const calls=[];
 const {root,dom}=mount(d,{requestFinanceInvoiceRevision:async p=>{calls.push(p);assert.equal(p.adminApproveFinancial,true);return {id:'r',status:'approved',financial:true};},previewFinanceInvoiceRevision:async()=>({quote:{revision:'q',total_amount:1600,revision_financial:true},pdfBase64:'JVBERg=='})});
 const quantity=root.querySelector('[data-invoice-revision-field="quantity_snapshot"]');quantity.value='2';quantity.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
 assert.equal(root.querySelector('[data-invoice-revision-preview]').textContent,'אישור השינוי הכספי ותצוגה מקדימה');assert.match(root.querySelector('[data-invoice-revision-approval-summary]').textContent,/לפני.*אחרי/);
 root.querySelector('[data-invoice-revision-preview]').click();await tick();assert.equal(calls.length,1);assert.ok(root.querySelector('[data-invoice-revision-confirm]'));assert.doesNotMatch(root.textContent,/ממתין לאישור אדמין/);assert.equal(d.invoiceRevisionContext.account.total_amount,2400);
 root._invoiceRevisionUnbind();dom.window.close();
});

test('admin queue approval and rejection are explicit actions and never apply changes automatically',async()=>{
 for(const approve of [true,false]){
  const d=data();d.financeAdmin=true;d.invoiceRevisionAdminLoaded=true;const proposed=invoiceRevisionDraft(d.invoiceRevisionContext.account);Object.assign(proposed.lines[0],{quantity_snapshot:2,billed_hours:3,amount:1600});
  let request={id:'r',account_id:'account',status:'pending_admin',requested_name:'טוני',before_snapshot:d.invoiceRevisionContext.account,proposed,changes:[{line:'line',field:'amount',before:2400,after:1600}]};d.invoiceRevisionAdminRequests=[request];d.invoiceRevisionRequest=request;d.invoiceRevisionDraft=structuredClone(proposed);const calls=[];
  const {root,dom}=mount(d,{decideFinanceInvoiceRevision:async(id,value)=>{calls.push({id,value});request={...request,status:value?'approved':'rejected'};},financeInvoiceRevisionContext:async id=>id?{...d.invoiceRevisionContext,requests:[request]}:{requests:[]}});
  root.querySelector(approve?'[data-invoice-revision-approve]':'[data-invoice-revision-reject]').click();await tick();assert.deepEqual(calls,[{id:'r',value:approve}]);assert.equal(d.invoiceRevisionContext.account.total_amount,2400);assert.equal(d.invoiceRevisionPreview,null);
  assert.equal(d.invoiceRevisionRequest?.status,approve?'approved':undefined);root._invoiceRevisionUnbind();dom.window.close();
 }
});
test('reviewing a nonfinancial PDF applies only on confirmation and reopens the corrected history record',async()=>{
 const d=data();d.invoiceRevisionRequest={id:'r',status:'approved',financial:false};d.invoiceRevisionPreview={quote:{revision:'reviewed',total_amount:2400},pdfBase64:'JVBERg=='};const calls=[];
 const {root,dom}=mount(d,{applyFinanceInvoiceRevision:async(id,revision)=>{calls.push({id,revision});return {accountId:'account',outlookStatus:'draft_ready'};},financeInvoiceRevisionContext:async()=>({...d.invoiceRevisionContext,account:{...account(),document_revision:1,customer_name_snapshot:'מתוקן'},requests:[{id:'r',status:'applied'}]})});
 assert.equal(calls.length,0);root.querySelector('[data-invoice-revision-confirm]').click();await tick();assert.deepEqual(calls,[{id:'r',revision:'reviewed'}]);assert.equal(d.invoiceRevisionContext.account.document_revision,1);assert.match(root.textContent,/טיוטת Outlook עודכנה/);root._invoiceRevisionUnbind();dom.window.close();
});

test('restoring a prior document version only prefills the same-account editor and requires review and confirmation',async()=>{
 const d=data(),old=structuredClone(d.invoiceRevisionContext.account);old.customer_name_snapshot='שם מקורי';d.invoiceRevisionContext.account.document_revision=1;d.invoiceRevisionContext.versions=[{version:0,created_at:'2026-11-04T10:00:00Z',snapshot:{...old,sharepoint_web_url:'https://example.test/original.pdf'}}];let calls=0;
 const {root,dom}=mount(d,{requestFinanceInvoiceRevision:async()=>{calls++;}});root.querySelector('[data-invoice-revision-restore]').click();await tick();assert.equal(d.invoiceRevisionDraft.customer_name_snapshot,'שם מקורי');assert.equal(d.invoiceRevisionContext.account.customer_name_snapshot,'בית ספר');assert.equal(calls,0);assert.ok(root.querySelector('[data-invoice-revision-preview]'));assert.equal(d.invoiceRevisionContext.account.transaction_account_number,old.transaction_account_number);root._invoiceRevisionUnbind();dom.window.close();
});
