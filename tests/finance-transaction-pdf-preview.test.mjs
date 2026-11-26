import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {financeScreen,createFinanceVisitState} from '../frontend/src/screens/finance.js';
const flush=()=>new Promise(r=>setTimeout(r,0));
const flushAll=async()=>{for(let i=0;i<5;i++)await flush();};
function mount(t,{blocked=false,fail=false,asyncRerender=false}={}){
 const dom=new JSDOM('<div id="root"></div>',{url:'https://example.test/'});
 const previous={window:globalThis.window,document:globalThis.document};
 globalThis.window=dom.window;globalThis.document=dom.window.document;
 const root=dom.window.document.getElementById('root'),calls=[],opened=[],downloads=[],revoked=[];
 let resolve;
 const pending=new Promise(r=>resolve=r);
 let blobCount=0;
 t.mock.method(URL,'createObjectURL',()=>`blob:preview-${++blobCount}`);
 t.mock.method(URL,'revokeObjectURL',url=>revoked.push(url));
 dom.window.open=(...args)=>{calls.push({open:args});if(blocked)return null;const tab={document:{body:{},title:''},opener:{},closed:false,location:{href:'about:blank',replace(url){this.href=url;opened.push(url);}},close(){this.closed=true;}};return tab;};
 t.mock.method(dom.window.HTMLAnchorElement.prototype,'click',function(){downloads.push({url:this.href,name:this.download});});
 const visit={...createFinanceVisitState(),view:'transactions',collectionLoaded:true,collectionPeriod:'school_2027',transactionMonths:{automatic:'2026-11'},transactionContext:{billingRows:[{
 activityRowId:'a',fundingSourceId:'g',gefenFunding:true,eligible:true,period:'2026-11-01',institutionSymbol:'123',customerName:'בית הספר',payerName:'בית הספר',payerKey:'school:1',customerEmail:'a@example.test',activityName:'ביומימיקרי',unbilledCount:5,unbilledHours:7.5,issuableAmount:3562.5,unbilledSlots:[{slot:1}],billingSourceRevision:'v1',billingCutoff:'2026-11-14',nextBillingUpdate:'2026-12-01'}]}};
 const state={user:{role:'admin'}};
 const api={previewFinanceGefenBillingAccount:async request=>{calls.push({request});await pending;if(fail)throw Error('network failure');return{pdfBase64:Buffer.from('%PDF-preview').toString('base64'),quote:{customer_name_snapshot:'בית הספר',total_amount:3562.5}};}};
 const paint=()=>{root.innerHTML=financeScreen.render(visit,{state});financeScreen.bind({root,data:visit,state,api,rerender:asyncRerender?async()=>{await flush();paint();}:paint});};paint();
 t.after(()=>{root._financeUnbind?.();dom.window.close();globalThis.window=previous.window;globalThis.document=previous.document;});
 return{root,visit,calls,opened,downloads,revoked,resolve,paint};
}
test('issuance PDF click opens a tab before the RPC, then navigates to the actual PDF without reserving an account',async t=>{
 const h=mount(t);h.visit.transactionIssuancePreview={pdfBase64:Buffer.from('%PDF-old').toString('base64'),quote:{}};h.paint();h.root.querySelector('[data-finance-transaction-preview]').click();
 assert.equal(h.visit.transactionIssuancePreview,null,'old school preview is cleared while the new PDF loads');
 assert.equal(h.calls[0].open[0],'about:blank');assert.ok(h.calls[1].request);
 assert.equal(h.opened.length,0);h.resolve();await flush();
 assert.match(h.opened[0],/^blob:preview/);assert.ok(h.root.querySelector('[data-finance-transaction-issuance-pdf-open]'));
 assert.match(h.visit.transactionActionMessage,/נפתחה בחלון נפרד/);
 // Rebinding/repainting must preserve the issuance PDF through the normal cache synchronizer.
 h.paint();h.root.querySelector('[data-finance-transaction-issuance-pdf-download]').click();
 assert.match(h.downloads[0].url,/^blob:preview/);assert.match(h.downloads[0].name,/בית הספר/);
 assert.equal(h.calls.filter(c=>c.request).length,1);
});
test('async screen rebind must not revoke the blob URL already handed to the reserved PDF tab',async t=>{
 const h=mount(t,{asyncRerender:true});
 h.root.querySelector('[data-finance-transaction-preview]').click();
 h.resolve();await flushAll();
 assert.match(h.opened[0],/^blob:preview/);
 assert.equal(h.revoked.includes(h.opened[0]),false,'reserved preview URL must stay alive after async rebind');
 assert.equal(h.root._financeManualPdfPreviewUrls.get('issuance').url,h.opened[0]);
 assert.match(h.visit.transactionActionMessage,/נפתחה בחלון נפרד/);
});
test('blocked popup exposes working explicit PDF open and download after re-render',async t=>{
 const h=mount(t,{blocked:true});h.root.querySelector('[data-finance-transaction-preview]').click();h.resolve();await flush();
 assert.match(h.visit.transactionActionMessage,/חסם חלון חדש/);
 assert.equal(h.root.ownerDocument.activeElement.className,'ds-fin-transaction-preview-pane');
 h.paint();h.root.querySelector('[data-finance-transaction-issuance-pdf-download]').click();assert.equal(h.downloads.length,1);
 h.root.querySelector('[data-finance-transaction-issuance-pdf-open]').click();assert.ok(h.calls.at(-1).open[0].startsWith('blob:'));
});
test('failed PDF request closes the placeholder and reports the error without a stale preview',async t=>{
 const h=mount(t,{fail:true});let closed=false;
 const original=window.open;window.open=(...args)=>{const tab=original(...args);tab.close=()=>{closed=true;};return tab;};
 h.root.querySelector('[data-finance-transaction-preview]').click();h.resolve();await flush();
 assert.equal(closed,true);assert.equal(h.visit.financeBusy,false);assert.equal(h.visit.transactionIssuancePreview,null);
 assert.equal(h.root.querySelector('[data-finance-transaction-issuance-pdf-open]'),null);assert.match(h.visit.transactionActionMessage,/לא ניתן להשלים את הפעולה/);
});
