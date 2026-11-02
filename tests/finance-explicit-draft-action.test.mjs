import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const edge = await readFile(new URL('../supabase/functions/finance-transaction-accounts/index.ts',import.meta.url),'utf8');
const issuance = await readFile(new URL('../frontend/src/screens/finance-transaction-issuance.js',import.meta.url),'utf8');
const finance = await readFile(new URL('../frontend/src/screens/finance.js',import.meta.url),'utf8');
const originalPdf = new TextEncoder().encode('%PDF-original-invoice');
async function dispatch({createDraft, status='issued', email='contact@example.test', existing=false, mailFails=false}={}) {
  const calls=[]; let handler;
  const account={id:'account',transaction_account_number:'Pl26000170',document_status:status,outlook_status:existing?'draft_ready':'pending',
    outlook_message_id:existing?'draft-existing':null,customer_email_snapshot:email,customer_name_snapshot:'Customer',
    generated_filename:'Pl26000170.pdf',sharepoint_drive_id:'drive',sharepoint_item_id:'item',issue_date:'2026-11-02',
    pdf_sha256:Buffer.from(await crypto.subtle.digest('SHA-256',originalPdf)).toString('hex')};
  const client={from:()=>({select:()=>({eq:()=>({single:async()=>({data:account})})})}),
    rpc:async(name,args)=>{calls.push({name,args});if(name==='finance_transaction_can_issue')return {data:true};
      if(name==='finalize_finance_billing')return {data:{...account,document_status:'issued'}};
      return {data:null};}};
  const fetch=async(url,options={})=>{
    calls.push({url,options});
    if(url.includes('login.microsoftonline.com'))return Response.json({access_token:'token'});
    if(url.includes('?$select=id,name,folder'))return Response.json({id:'01LT7GPE6FW7O7REM6WJBIXX6II2IDYTXM',folder:{}});
    if(options.method==='PUT')return Response.json({id:'item',webUrl:'https://test/pdf'});
    if(url.endsWith('/content'))return new Response(originalPdf);
    if(url.includes('/messages?$filter='))return Response.json({value:[]});
    if(url.endsWith('/messages'))return mailFails?new Response('failed',{status:500}):Response.json({id:'draft-new'});
    throw Error('Unexpected request '+url);
  };
  const prefix=edge.slice(0,edge.indexOf('// pdf-lib/fontkit')).replace(/^import .*;\n/gm,'');
  const script=stripTypeScriptTypes(prefix+'\n'+edge.slice(edge.indexOf('Deno.serve(')),{mode:'transform'});
  const Deno={env:{get:k=>k==='SUPABASE_URL'?'https://test':k==='MS_MAIL_SENDER'?'sender@example.test':'configured'},serve:fn=>{handler=fn;}};
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  await new AsyncFunction('createClient','fetch','Deno','buildPdf','attachActivityTypes',script)(()=>client,fetch,Deno,async()=>originalPdf,async()=>{});
  const response=await handler(new Request('https://test',{method:'POST',body:JSON.stringify({accountId:account.id,...(createDraft===undefined?{}:{createDraft})})}));
  return {response,body:await response.json(),calls};
}
test('issuance saves the invoice without creating an Outlook draft by default',async()=>{
  const r=await dispatch({status:'generating'});
  assert.equal(r.response.status,200);assert.equal(r.body.outlookStatus,'pending');
  assert.ok(r.calls.some(c=>c.name==='finalize_finance_billing'));
  assert.ok(!r.calls.some(c=>c.url?.includes('/messages')));
});
test('explicit draft action attaches the original PDF to the saved contact',async()=>{
  const r=await dispatch({createDraft:true});
  assert.equal(r.body.outlookStatus,'draft_ready');
  const payload=JSON.parse(r.calls.find(c=>c.url?.endsWith('/messages')).options.body);
  assert.deepEqual(payload.toRecipients,[{emailAddress:{address:'contact@example.test'}}]);
  assert.match(payload.subject,/Pl26000170/);
  assert.equal(payload.attachments[0].name,'Pl26000170.pdf');
  assert.deepEqual(Buffer.from(payload.attachments[0].contentBytes,'base64'),Buffer.from(originalPdf));
  assert.ok(!r.calls.some(c=>c.options?.method==='PUT'||/\/send(?:$|\?)/.test(c.url||'')));
});
test('repeated draft action reuses the recorded draft',async()=>{
  const r=await dispatch({createDraft:true,existing:true});
  assert.equal(r.body.messageId,'draft-existing');
  assert.ok(!r.calls.some(c=>c.url));
});
test('missing contact email returns a clear result without an Outlook request',async()=>{
  const r=await dispatch({createDraft:true,email:''});
  assert.equal(r.body.outlookStatus,'missing_recipient');
  assert.ok(!r.calls.some(c=>c.url?.includes('/messages')));
});
test('mail failure preserves the issued invoice and reports failure',async()=>{
  const r=await dispatch({createDraft:true,mailFails:true});
  assert.equal(r.body.outlookStatus,'failed');
  assert.ok(!r.calls.some(c=>c.name==='cancel_finance_dispatch'));
});
test('history renders the action only for issued accounts and sorts prefixed numbers',()=>{
  const source=issuance.slice(issuance.indexOf('function historyView('),issuance.indexOf('export const FINANCE_TRANSACTION_SHAREPOINT_FOLDER_URL'));
  const render=new Function('escapeHtml','statusLabel','formatDate','formatAmount','dsTableWrap','dsEmptyState',source+';return historyView;')(
    v=>String(v??''),v=>v,v=>v,v=>v,v=>v,v=>v);
  const account=(id,status='issued')=>({id,transaction_account_number:'Pl260001'+id,document_status:status,customer_name_snapshot:'Customer'});
  const html=render({transactionContext:{accounts:[account('69'),account('70'),account('71','cancelled'),account('72','generating')]}});
  assert.ok(html.indexOf('Pl26000170')<html.indexOf('Pl26000169'));
  assert.match(html,/data-finance-account-draft="70"/);
  assert.doesNotMatch(html,/data-finance-account-draft="7[12]"/);
});
test('draft click requests an explicit draft and refreshes server state',async()=>{
  const handler=finance.slice(finance.indexOf("      const accountDraft = ev.target.closest('[data-finance-account-draft]');"),finance.indexOf("      const paymentOpen = ev.target.closest('[data-finance-payment-open]');"));
  const run=new (Object.getPrototypeOf(async function(){}).constructor)('ev','visit','api','refresh','ensureCollectionLoaded','financeError',handler);
  const visit={transactionContext:{accounts:[{id:'account',document_status:'issued'}]}};
  let request;let reloads=0;
  await run({target:{closest:()=>({dataset:{financeAccountDraft:'account'}})}},visit,
    {dispatchFinanceTransactionAccount:async p=>{request=p;return {outlookStatus:'draft_ready'};}},()=>{},async()=>{reloads++;},e=>e.message);
  assert.deepEqual(request,{accountId:'account',createDraft:true});
  assert.equal(reloads,1);assert.equal(visit.financeBusy,false);assert.match(visit.transactionActionMessage,/טיוטת המייל נוצרה/);
});
