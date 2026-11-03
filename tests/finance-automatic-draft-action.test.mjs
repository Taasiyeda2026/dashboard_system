import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
const source=await readFile(new URL('../supabase/functions/finance-transaction-accounts/index.ts',import.meta.url),'utf8');
const bytes=new TextEncoder().encode('%PDF-original-invoice');
async function harness(options={}) {
  const calls=[];let handler,leased=false;
  const account={id:'account',document_status:options.generating?'generating':'issued',outlook_status:'pending',outlook_owner_id:'original-user',outlook_owner_mailbox:options.ownerMailbox||'idann@think.org.il',customer_name_snapshot:'מוסד',
    customer_email_snapshot:'stale@example.test',transaction_account_number:'Pl26000170',issue_date:'2026-12-02',generated_filename:'original.pdf',
    sharepoint_drive_id:'drive',sharepoint_item_id:'item',finance_transaction_account_lines:[{performance_month:'2026-11-01'}],
    pdf_sha256:Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex')};
  const state={account,message:null,recipients:['contact@example.test','admin@example.test']};
  const client={from:()=>({select:()=>({eq:()=>({single:async()=>({data:{...account}})})})}),rpc:async(name,args)=>{
    calls.push({name,args});
    if(name==='finance_delegated_account_owner')return {data:options.ownerAllowed!==false};
    if(name==='finance_transaction_can_issue')return {data:options.authorized!==false};
    if(name==='finance_authorize_outlook_job')return {data:options.workerAuthorized===true};
    if(name==='acquire_finance_dispatch'){if(leased||options.leaseBusy)return {error:Error('dispatch_in_progress')};leased=true;}
    if(name==='release_finance_dispatch')leased=false;
    if(name==='resolve_finance_outlook_mailbox')return options.mailboxError?{error:Error(options.mailboxError)}:{data:options.emptyMailbox?'':account.outlook_owner_mailbox};
    if(name==='finance_transaction_recipients')return {data:{recipients:state.recipients,invalidCount:1}};
    if(name==='begin_finance_outlook_creation'){if(account.outlook_creation_started_at)return {data:false};account.outlook_creation_started_at='now';account.outlook_mailbox=args.p_mailbox;return {data:true};}
    if(name==='mark_finance_transaction_outlook'){
      if(options.persistFails)return {error:Error('db_unavailable')};
      account.outlook_status=args.p_status;account.outlook_error=args.p_error;if(args.p_mailbox)account.outlook_mailbox=args.p_mailbox;account.outlook_message_id=args.p_message_id||account.outlook_message_id;
      if(args.p_creation_rejected)account.outlook_creation_started_at=null;
      if(args.p_status==='draft_ready')account.document_status='mail_draft_ready';
      if(args.p_status==='already_sent')account.document_status='sent';
    }
    if(name==='finalize_finance_billing'){Object.assign(account,{document_status:'issued',pdf_sha256:args.p_pdf_sha256,generated_filename:args.p_filename});return {data:{...account}};}
    return {data:null};
  }};
  const fetch=async(url,opts={})=>{
    calls.push({url,opts});assert.ok(!/\/send(?:Mail)?(?:$|\?)/i.test(url),'sending forbidden');
    if(url.includes('/mailFolders/drafts?'))return options.delegate401?new Response('expired',{status:401}):Response.json({id:options.accountMismatch&&url.includes('/me/')?'other-folder':'owner-folder'});
    if(url.includes('login.microsoftonline.com'))return options.authFails?new Response('denied',{status:401}):Response.json({access_token:'token'});
    if(url.includes('?$select=id,name,folder'))return Response.json({id:'01LT7GPE6FW7O7REM6WJBIXX6II2IDYTXM',folder:{}});
    if(opts.method==='PUT')return Response.json({id:'item',webUrl:'https://test/pdf'});
    if(url.endsWith('/content'))return new Response(options.badHash?'changed':bytes);
    if(url.includes('/messages?$filter=')){
      if(options.readDenied)return new Response('denied',{status:403});
      return Response.json({value:options.duplicates?[{id:'one'},{id:'two'}]:state.message&&!options.delayedIndex?[{id:state.message.id,isDraft:state.message.isDraft}]:[]});
    }
    if(url.endsWith('/messages')&&opts.method==='POST'){
      if(options.postDenied)return new Response('denied',{status:403});
      state.message={...JSON.parse(opts.body),id:'draft',isDraft:true};
      if(options.networkAfterPost)throw Error('network_lost');
      return Response.json({id:'draft'});
    }
    if(url.endsWith('/attachments'))return Response.json({value:options.badAttachment?[]:state.message.attachments});
    if(url.includes('/messages/')){
      if(!state.message)return new Response('missing',{status:404});
      if(opts.method==='PATCH'){Object.assign(state.message,JSON.parse(opts.body));return new Response(null,{status:204});}
      return Response.json(state.message);
    }
    throw Error('Unexpected request '+url);
  };
  const script=stripTypeScriptTypes(source.slice(0,source.indexOf('// pdf-lib/fontkit')).replace(/^import .*;\n/gm,'')+'\n'+source.slice(source.indexOf('Deno.serve(')),{mode:'transform'});
  const Deno={env:{get:k=>k==='MS_MAIL_SENDER'?'office@think.org.il':'configured'},serve:fn=>handler=fn};
  await new (Object.getPrototypeOf(async function(){}).constructor)('createClient','fetch','Deno','buildPdf','attachActivityTypes',script)(()=>client,fetch,Deno,async()=>bytes,async()=>{});
  return {state,calls,options,invoke:async(body={})=>{const response=await handler(new Request('https://test',{method:'POST',headers:options.noToken?{}:{'x-microsoft-mail-token':'delegated-token'},body:JSON.stringify({accountId:'account',...body})}));return {response,body:await response.json()};}};
}
const posts=h=>h.calls.filter(c=>c.url?.endsWith('/messages')&&c.opts.method==='POST');
test('issuance automatically saves PDF and creates a verified draft without a second action',async()=>{
  const h=await harness({generating:true});assert.equal((await h.invoke()).body.outlookStatus,'draft_ready');
  assert.ok(h.calls.some(c=>c.name==='finalize_finance_billing'));assert.equal(posts(h).length,1);assert.ok(h.calls.some(c=>c.url?.endsWith('/attachments')));
});
test('draft uses current multiple recipients, original PDF, selected month and professional text',async()=>{
  const h=await harness();await h.invoke();const p=JSON.parse(posts(h)[0].opts.body);
  assert.deepEqual(p.toRecipients.map(r=>r.emailAddress.address),h.state.recipients);assert.ok(!JSON.stringify(p).includes('stale@example.test'));
  assert.equal(p.subject,'תעשיידע | חשבון עסקה – מוסד – נובמבר 2026');assert.match(p.body.content,/שלום רב/);assert.match(p.body.content,/בברכה,\nתעשיידע/);
  assert.deepEqual(Buffer.from(p.attachments[0].contentBytes,'base64'),Buffer.from(bytes));assert.ok(!h.calls.some(c=>c.opts?.method==='PUT'));
});
test('repeated dispatch verifies the same message and refreshes changed recipients in place',async()=>{
  const h=await harness();const first=await h.invoke();h.state.recipients=['updated@example.test'];const second=await h.invoke();
  assert.equal(first.body.messageId,second.body.messageId);assert.equal(posts(h).length,1);assert.deepEqual(h.state.message.toRecipients,[{emailAddress:{address:'updated@example.test'}}]);
});
test('missing recipients preserve invoice and can be completed after contact correction',async()=>{
  const h=await harness();h.state.recipients=[];assert.equal((await h.invoke()).body.outlookStatus,'missing_recipient');assert.equal(posts(h).length,0);
  assert.equal(h.state.account.document_status,'issued');h.state.recipients=['fixed@example.test'];assert.equal((await h.invoke()).body.outlookStatus,'draft_ready');
});
test('OAuth failure is persisted independently of document success',async()=>{
  const h=await harness({authFails:true});assert.equal((await h.invoke()).body.outlookStatus,'failed');assert.equal(h.state.account.outlook_status,'failed');
  assert.ok(!h.calls.some(c=>c.name==='cancel_finance_dispatch'));
});
test('Graph read 403 is retryable without creating a message or premature intent',async()=>{
  const h=await harness({readDenied:true});assert.equal((await h.invoke()).body.outlookStatus,'waiting_connection');assert.equal(posts(h).length,0);assert.ok(!h.state.account.outlook_creation_started_at);
  h.options.readDenied=false;assert.equal((await h.invoke()).body.outlookStatus,'draft_ready');
});
test('definitive POST denial clears its intent for a safe permissions-corrected retry',async()=>{
  const h=await harness({postDenied:true});assert.equal((await h.invoke()).body.outlookStatus,'waiting_connection');assert.equal(h.state.account.outlook_creation_started_at,null);
  h.options.postDenied=false;assert.equal((await h.invoke()).body.outlookStatus,'draft_ready');assert.equal(posts(h).length,2);
});
test('lost POST response reconciles the account property without a second creation',async()=>{
  const h=await harness({networkAfterPost:true});assert.equal((await h.invoke()).body.outlookStatus,'needs_review');h.options.networkAfterPost=false;
  assert.equal((await h.invoke()).body.outlookStatus,'draft_ready');assert.equal(posts(h).length,1);
});
test('uncertain creation plus delayed indexing requires review instead of another POST',async()=>{
  const h=await harness({networkAfterPost:true});await h.invoke();h.options.delayedIndex=true;assert.equal((await h.invoke()).body.outlookStatus,'needs_review');assert.equal(posts(h).length,1);
});
test('multiple matches require review and sent messages are never recreated',async()=>{
  const h=await harness({duplicates:true});assert.equal((await h.invoke()).body.outlookStatus,'needs_review');assert.equal(posts(h).length,0);
  const sent=await harness();await sent.invoke();sent.state.message.isDraft=false;assert.equal((await sent.invoke()).body.outlookStatus,'already_sent');await sent.invoke();assert.equal(posts(sent).length,1);
});
test('PDF verification failure preserves the message ID and cannot report success',async()=>{
  const h=await harness({badAttachment:true});assert.equal((await h.invoke()).body.outlookStatus,'failed');assert.equal(h.state.account.outlook_message_id,'draft');
  h.options.badAttachment=false;assert.equal((await h.invoke()).body.outlookStatus,'draft_ready');assert.equal(posts(h).length,1);
});
test('database status failure cannot return a false success or cancel the document',async()=>{
  const h=await harness({persistFails:true});const r=await h.invoke();assert.equal(r.response.status,500);assert.equal(r.body.documentPreserved,true);assert.equal(posts(h).length,1);
});
test('lease contention and unauthorized worker tokens have no Graph side effects',async()=>{
  const busy=await harness({leaseBusy:true});assert.equal((await busy.invoke()).response.status,400);assert.equal(posts(busy).length,0);
  const denied=await harness();assert.equal((await denied.invoke({outlookJobToken:'wrong'})).response.status,400);assert.equal(denied.calls.filter(c=>c.url).length,0);
  const valid=await harness({workerAuthorized:true,authorized:false});assert.equal((await valid.invoke({outlookJobToken:'valid'})).response.status,400);
});
test('changed stored PDF never reaches Outlook or regenerates the invoice',async()=>{
  const h=await harness({badHash:true});assert.equal((await h.invoke()).body.outlookStatus,'failed');assert.equal(posts(h).length,0);
  assert.ok(!h.calls.some(c=>c.opts?.method==='PUT'||c.name==='cancel_finance_dispatch'));
});
test('an absent draft-state flag cannot be reported as sent or ready',async()=>{
  const h=await harness();await h.invoke();delete h.state.message.isDraft;
  assert.equal((await h.invoke()).body.outlookStatus,'failed');assert.equal(posts(h).length,1);
});
test('each issuer uses their own server-resolved mailbox despite a poisoned default and browser override',async()=>{
  for(const mailbox of ['idann@think.org.il','toni@think.org.il']) {
    const h=await harness({generating:true,ownerMailbox:mailbox});
    const r=await h.invoke({mailbox:'office@think.org.il',userEmail:'attacker@think.org.il'});
    assert.equal(r.body.outlookStatus,'draft_ready');assert.equal(posts(h).length,1);
    assert.ok(h.calls.filter(c=>c.url?.includes('/users/')).every(c=>c.url.includes(encodeURIComponent(mailbox))));
    assert.equal(h.state.account.outlook_mailbox,mailbox);assert.equal(h.state.account.outlook_message_id,'draft');
    assert.deepEqual(h.state.message.toRecipients.map(r=>r.emailAddress.address),h.state.recipients);
  }
  assert.doesNotMatch(source,/MS_MAIL_SENDER/);
});
test('retries stay in the original mailbox and retired background capabilities cannot dispatch',async()=>{
  const h=await harness({ownerMailbox:'toni@think.org.il',postDenied:true,workerAuthorized:true});
  assert.equal((await h.invoke()).body.outlookStatus,'waiting_connection');h.options.postDenied=false;
  await h.invoke({userEmail:'idann@think.org.il'});
  assert.equal((await h.invoke({outlookJobToken:'valid',userEmail:'office@think.org.il'})).response.status,400);
  await h.invoke();
  assert.equal(h.state.account.outlook_mailbox,'toni@think.org.il');assert.equal(posts(h).length,2,'one rejected POST and one successful creation');
  assert.ok(h.calls.filter(c=>c.url?.includes('/users/')).every(c=>c.url.includes('toni%40think.org.il')));
});
test('a missing Microsoft session preserves PDF and waits without any Outlook request',async()=>{
  const h=await harness({generating:true,noToken:true});const r=await h.invoke();
  assert.equal(r.body.outlookStatus,'waiting_connection');assert.equal(r.body.documentPreserved,true);
  assert.equal(h.state.account.document_status,'issued');assert.equal(posts(h).length,0);
  assert.ok(!h.calls.some(c=>c.url?.includes('/me/')||c.url?.includes('/users/')));
  assert.ok(h.calls.some(c=>c.name==='finalize_finance_billing'));
  h.options.noToken=false;assert.equal((await h.invoke()).body.outlookStatus,'draft_ready');assert.equal(posts(h).length,1);
});
test('Graph proves mailbox identity even if a different Microsoft account has shared access to the target',async()=>{
  const h=await harness({accountMismatch:true});const r=await h.invoke();
  assert.equal(r.body.outlookStatus,'failed');assert.equal(r.body.outlookError,'invoice_microsoft_account_mismatch');
  assert.equal(posts(h).length,0);assert.ok(!h.calls.some(c=>c.name==='begin_finance_outlook_creation'));
  assert.ok(h.calls.some(c=>c.url?.includes('/me/mailFolders/drafts')));
  assert.ok(h.calls.some(c=>c.url?.includes('/users/idann%40think.org.il/mailFolders/drafts')));
});
test('another dashboard user cannot use even a valid original-owner Microsoft token',async()=>{
  const h=await harness({ownerAllowed:false});const r=await h.invoke();
  assert.equal(r.body.outlookStatus,'waiting_connection');assert.equal(h.state.account.outlook_error,'invoice_original_issuer_required');
  assert.ok(!h.calls.some(c=>c.url?.includes('/me/')||c.url?.includes('/users/')));
});
test('an expired Microsoft token waits for reconnect and never falls back to application credentials',async()=>{
  const h=await harness({delegate401:true});assert.equal((await h.invoke()).body.outlookStatus,'waiting_connection');
  assert.equal(posts(h).length,0);h.options.delegate401=false;assert.equal((await h.invoke()).body.outlookStatus,'draft_ready');
  const mailCalls=h.calls.filter(c=>c.url?.includes('/me/')||c.url?.includes('/users/'));
  assert.ok(mailCalls.every(c=>c.opts.headers.Authorization==='Bearer delegated-token'));
  assert.ok(posts(h).every(c=>c.url.endsWith('/me/messages')));
});
test('unresolved or unauthorized owner preserves the issued PDF without accessing another mailbox',async()=>{
  for(const options of [{emptyMailbox:true},{mailboxError:'invoice_mailbox_not_authorized'},{mailboxError:'invoice_mailbox_identity_changed'},{mailboxError:'invoice_mailbox_existing_draft_mismatch'}]) {
    const h=await harness({generating:true,...options});const r=await h.invoke({mailbox:'idann@think.org.il'});
    assert.equal(r.body.documentPreserved,true);assert.ok(['failed','needs_review'].includes(r.body.outlookStatus));
    assert.match(r.body.outlookError,/^invoice_mailbox_/);assert.match(r.body.warning,/לא נעשה שימוש בתיבה חלופית/);
    assert.equal(h.calls.filter(c=>c.url?.includes('/users/')).length,0);assert.equal(h.state.account.document_status,'issued');
    assert.ok(!h.calls.some(c=>c.name==='cancel_finance_dispatch'));
  }
});
test('Microsoft mailbox denial reports a concrete error and never falls back to the fixed mailbox',async()=>{
  const h=await harness({readDenied:true});const r=await h.invoke();
  assert.equal(r.body.outlookError,'invoice_mailbox_access_denied');assert.equal(h.state.account.outlook_error,'invoice_mailbox_access_denied');
  assert.equal(posts(h).length,0);assert.ok(h.calls.filter(c=>c.url?.includes('/users/')).every(c=>c.url.includes('idann%40think.org.il')));
});
test('recovery click retries the existing account and reloads persisted state without an opt-in flag',async()=>{
  const finance=await readFile(new URL('../frontend/src/screens/finance.js',import.meta.url),'utf8');
  const body=finance.slice(finance.indexOf("      const accountDraft = ev.target.closest('[data-finance-account-draft]');"),finance.indexOf("      const paymentOpen = ev.target.closest('[data-finance-payment-open]');"));
  const run=new (Object.getPrototypeOf(async function(){}).constructor)('ev','visit','api','refresh','ensureCollectionLoaded','financeError',body);
  const visit={transactionContext:{accounts:[{id:'existing',document_status:'issued'}]}};let request,reloads=0;
  await run({target:{closest:()=>({dataset:{financeAccountDraft:'existing'}})}},visit,{dispatchFinanceTransactionAccount:async p=>{request=p;return{outlookStatus:'draft_ready'};}},()=>{},async()=>{reloads++;},e=>e.message);
  assert.deepEqual(request,{accountId:'existing'});assert.equal(reloads,1);assert.equal(visit.financeBusy,false);
});
