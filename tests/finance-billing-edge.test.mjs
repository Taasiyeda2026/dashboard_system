import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import bidiFactory from 'bidi-js';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
const source=await readFile(new URL('../supabase/functions/finance-transaction-accounts/index.ts',import.meta.url),'utf8');
const script=stripTypeScriptTypes(source.replace(/^import .*;\n/gm,''),{mode:'transform'});
const revisionScript=stripTypeScriptTypes(await readFile(new URL('../supabase/functions/finance-transaction-accounts/revision-dispatch.ts',import.meta.url),'utf8'),{mode:'transform'});
const {handleInvoiceRevision,updateInvoiceDraft}=new Function(revisionScript.replace(/export /g,'')+';return {handleInvoiceRevision,updateInvoiceDraft};')();
const fixture=()=>({id:'account',document_status:'generating',outlook_status:'pending',transaction_account_number:8525,
  customer_name_snapshot:'בית ספר א',institution_symbol:'123',customer_email_snapshot:'test@example.test',issue_date:'2026-10-01',payment_due_date:'2026-11-30',total_amount:2500,
  finance_transaction_account_lines:[{activity_name_snapshot:'תוכנית חלל',funding_snapshot:'גפ״ן',performance_month:'2026-09-01',billed_hours:3,hourly_rate_snapshot:833.333,amount:2500,
    finance_transaction_account_meetings:[{meeting_date:'2026-09-01'},{meeting_date:'2026-09-02'}]}]});
test('Google AI course PDF preserves the 8000 activity price and derives 533.33 per hour for fifteen hours',async()=>{
  const quote={...fixture(),customer_name_snapshot:'המשיח האנגליקאני',institution_symbol:'248724',total_amount:8000,
    finance_transaction_account_lines:[{activity_row_id:'ai',activity_type_snapshot:'course',activity_name_snapshot:'יישומי AI בשיתוף GOOGLE',school_name_snapshot:'המשיח האנגליקאני',quantity_snapshot:10,billed_hours:15,hourly_rate_snapshot:8000/15,unit_price_snapshot:800,amount:8000,billing_coverage:'full_funding',billing_rule:'monthly',funding_snapshot:'גפ״ן',finance_transaction_account_meetings:[]}]};
  const r=await harness({preview:true,quote,activityTypes:{ai:'course'}});
  assert.equal(r.response.status,200);assert.equal(r.body.quote.total_amount,8000);
  const pdf=await getDocument({data:new Uint8Array(Buffer.from(r.body.pdfBase64,'base64')),useSystemFonts:false}).promise;
  const text=(await(await pdf.getPage(1)).getTextContent()).items.map(x=>x.str||'').join(' ');
  assert.match(text,/8,000\.00/);assert.match(text,/533\.33/);assert.match(text,/248724/);assert.match(text,/15/);assert.match(text,/10/);
  assert.ok(!r.calls.some(c=>c.name==='finalize_finance_billing'||c.method==='PUT'));
});
async function harness(options={}) {
  const account=fixture();Object.assign(account,options.account);const calls=[];let handler;let pdf;let draftPayload;
  const rpc=async(name,args)=>{
    calls.push({type:'rpc',name,args});
    if(name==='finance_manual_account_quote')return{data:options.quote||fixture()};
    if(name==='finance_invoice_revision_quote')return options.revisionNotApproved?{error:Error('revision_not_approved')}:{data:options.quote||fixture()};
    if(name==='finance_delegated_account_owner')return {data:options.ownerAllowed!==false};
    if(name==='finance_transaction_can_issue')return{data:options.allowed!==false};
    if(name==='resolve_finance_outlook_mailbox')return{data:'idann@think.org.il'};
    if(name==='finance_transaction_recipients')return{data:{recipients:['test@example.test'],invalidCount:0}};
    if(name==='begin_finance_outlook_creation')return{data:true};
    if(name==='cancel_finance_dispatch'&&options.cancelFails)return{error:{message:'not_owned'}};
    if(name===options.rpcError)return{error:{message:'test_'+name}};
    if(name==='finalize_finance_billing') {Object.assign(account,{document_status:'issued',pdf_sha256:args.p_pdf_sha256});return{data:{...account}};}
    return{data:null};
  };
  const client={rpc,from:(table)=>table==='activities'
    ? {select:()=>({in:async(_key,ids)=>({data:ids.map(id=>({
      row_id:id,activity_type:options.activityTypes?.[id]||'course',activity_season:'school_2027',authority_id:options.authorityIds?.[id]||null,
      price:options.activityPrices?.[id]??null,sessions:options.activitySessions?.[id]??null,
      activity_no:options.activityNumbers?.[id]??null
    }))})})}
    : table==='authorities'
      ? {select:()=>({in:async(_key,ids)=>({data:ids.map(id=>({id,authority_name:options.authorityNames?.[id]||'רשות בדיקה'}))})})}
      : ({select:()=>({eq:()=>({single:async()=>({data:account})})})})};

  const fetch=async(url,opts={})=>{
    calls.push({type:'fetch',url,method:opts.method||'GET'});
    if(url.includes('/mailFolders/drafts?'))return Response.json({id:'owner-folder'});
    if(url.startsWith('https://raw.githubusercontent.com/')) {
      // Resolve pinned Assistant font URLs to local Hebrew TTF fixtures in
      // hermetic tests; production still embeds real Assistant fonts.
      const assistant=/\/TypeNetwork\/Assistant\/[a-f0-9]{40}\/fonts\/ttf\/Assistant-(Regular|Bold)\.ttf$/.exec(url);
      if(assistant) {
        const bytes=await readFile(new URL('../frontend/assets/fonts/Alef-'+assistant[1]+'.ttf',import.meta.url));
        return new Response(bytes,{headers:{'Content-Type':'font/ttf'}});
      }
      const asset=url.split('/main/')[1];
      if(!asset)throw new Error('Unexpected GitHub raw asset in PDF test: '+url);
      return new Response(await readFile(new URL('../'+asset,import.meta.url)));
    }
    if(url.includes('login.microsoftonline.com'))return Response.json({access_token:'mock'});
    if(url.includes('?$select=id,name,folder'))return Response.json({id:'01LT7GPE6FW7O7REM6WJBIXX6II2IDYTXM',folder:{}});
    if(opts.method==='PUT') {pdf=opts.body;if(options.uploadFails)return new Response('test',{status:500});return Response.json({id:'item',webUrl:'https://example.test/pdf'});}
    if(opts.method==='DELETE')return new Response(null,{status:204});
    if(url.endsWith('/content'))return new Response(options.storedPdf);
    if(url.includes('/messages?$filter='))return Response.json({value:options.previousDraft?[{id:'old-draft'}]:[]});
    if(url.includes('/messages/')&&url.endsWith('/attachments'))return Response.json({value:draftPayload?.attachments||[{
      '@odata.type':'#microsoft.graph.fileAttachment',name:account.generated_filename||calls.find(c=>c.name==='finalize_finance_billing')?.args.p_filename,
      contentType:'application/pdf',contentBytes:Buffer.from(pdf||options.storedPdf).toString('base64')
    }]});
    if(url.includes('/messages/'))return Response.json({id:options.previousDraft?'old-draft':'draft',isDraft:true,toRecipients:[{emailAddress:{address:'test@example.test'}}]});
    if(url.endsWith('/messages') && opts.method==='POST') {
      if(options.mailFails)return new Response('test',{status:500});
      const payload=JSON.parse(opts.body);draftPayload=payload;assert.equal(payload.attachments.length,1);assert.ok(payload.singleValueExtendedProperties[0].value);
      if(options.fullyPaid)assert.doesNotMatch(payload.body.content,/נשמח להסדרת/);
      assert.equal(Buffer.from(payload.attachments[0].contentBytes,'base64').subarray(0,4).toString(),'%PDF');
      return Response.json({id:'draft'});
    }
    throw new Error('Unexpected outbound call: '+url);
  };
  globalThis.__financeTestDeps = {PDFDocument,rgb,fontkit,bidiFactory,createClient:()=>client,fetch,Response,Request,URLSearchParams,Uint8Array,crypto,TextEncoder,btoa,console,
    handleInvoiceRevision,updateInvoiceDraft,Deno:{env:{get:k=>({SUPABASE_URL:'https://supabase.test',SUPABASE_ANON_KEY:'test',SUPABASE_SERVICE_ROLE_KEY:'test',MS_TENANT_ID:'test',MS_CLIENT_ID:'test',MS_CLIENT_SECRET:'test',MS_MAIL_SENDER:'test@example.test'})[k]},serve:fn=>{handler=fn;}}};
  const injected = 'const { PDFDocument, rgb, fontkit, bidiFactory, createClient, fetch, Deno, handleInvoiceRevision, updateInvoiceDraft } = globalThis.__financeTestDeps;\n' + script;
  await import('data:text/javascript;base64,'+Buffer.from(injected).toString('base64')+'#'+crypto.randomUUID());
  delete globalThis.__financeTestDeps;
  const request = options.preflight
    ? new Request('https://function.test', { method:'OPTIONS', headers: {
      origin:'https://taasiyeda2026.github.io',
      'access-control-request-method':'POST',
      'access-control-request-headers':'authorization, x-client-info, apikey, content-type'
    } })
    : new Request('https://function.test',{method:'POST',headers:{authorization:'Bearer mock','x-microsoft-mail-token':'delegated-token'},body:JSON.stringify(options.revisionPreview?{revisionId:'revision',revisionPreview:true}:options.preview?{preview:true,manual:{activity:'a',funder:'g',month:'2026-09-01',draft:{}}} :{accountId:'account',createDraft:true})});
  const response=await handler(request);
  return{response,body:options.preflight?await response.text():await response.json(),calls,pdf,account};
}
test('full mocked pipeline renders actual PDF, validates SharePoint, finalizes and creates draft only',async()=>{
  const r=await harness();assert.equal(r.response.status,200,JSON.stringify(r.body));assert.equal(r.body.outlookStatus,'draft_ready');
  const doc=await PDFDocument.load(r.pdf);assert.ok(doc.getPageCount()>0);
  const names=r.calls.filter(c=>c.type==='rpc').map(c=>c.name);
  assert.ok(names.indexOf('validate_finance_dispatch')<names.indexOf('finalize_finance_billing'));
  assert.equal(names.at(-1),'release_finance_dispatch');
  assert.ok(r.calls.filter(c=>c.type==='fetch').every(c=>!c.url.includes('/send')));
});
test('workshop and course issuance both finish with a real PDF attached to a verified Outlook draft',async()=>{
  for(const type of ['workshop','course']) {
    const r=await harness({activityTypes:{a:type},account:{total_amount:900,finance_transaction_account_lines:[{
      activity_row_id:'a',activity_name_snapshot:'פעילות',school_name_snapshot:'מוסד',quantity_snapshot:3,unit_price_snapshot:300,
      billed_hours:type==='course'?4.5:0,hourly_rate_snapshot:type==='course'?200:null,amount:900,performance_month:'2026-09-01',
      finance_transaction_account_meetings:[{meeting_date:'2026-09-01'},{meeting_date:'2026-09-02'},{meeting_date:'2026-09-03'}]
    }]}});
    assert.equal(r.body.outlookStatus,'draft_ready',type);assert.ok((await PDFDocument.load(r.pdf)).getPageCount()>0);
    assert.ok(r.calls.some(c=>c.url?.endsWith('/attachments')),type);
  }
});
test('server rejects stale reservation before any PDF, SharePoint or Outlook request',async()=>{
  const r=await harness({rpcError:'validate_finance_dispatch'});assert.equal(r.response.status,400);
  assert.equal(r.calls.filter(c=>c.type==='fetch').length,0);
  assert.ok(r.calls.some(c=>c.name==='cancel_finance_dispatch'));
});
test('overlapping dispatch lease does not cancel another in-flight reservation',async()=>{
  const r=await harness({rpcError:'acquire_finance_dispatch'});assert.equal(r.response.status,400);
  assert.ok(!r.calls.some(c=>c.name==='cancel_finance_dispatch'));
});
test('unauthorized caller cannot trigger document or Graph access',async()=>{
  const r=await harness({allowed:false});assert.equal(r.response.status,400);
  assert.equal(r.calls.filter(c=>c.type==='fetch').length,0);
});
test('upload failure cancels temporary claims; finalization failure removes uploaded orphan',async()=>{
  const upload=await harness({uploadFails:true});assert.equal(upload.response.status,400);
  assert.ok(!upload.calls.some(c=>c.name==='finalize_finance_billing'));
  const final=await harness({rpcError:'finalize_finance_billing'});assert.equal(final.response.status,400);
  assert.ok(final.calls.some(c=>c.method==='DELETE'));
});
test('Outlook failure preserves issued document; crash retry recovers existing draft',async()=>{
  const failed=await harness({mailFails:true});assert.equal(failed.body.outlookStatus,'needs_review');
  assert.ok(!failed.calls.some(c=>c.name==='cancel_finance_dispatch'));
  const recovered=await harness({previousDraft:true});assert.equal(recovered.body.outlookStatus,'draft_ready');
  assert.ok(!recovered.calls.some(c=>c.url?.endsWith('/messages')&&c.method==='POST'));
});
test('issued retry attaches original stored PDF and never regenerates or alters the snapshot',async()=>{
  const doc=await PDFDocument.create();doc.addPage();const bytes=await doc.save();
  const hash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
  const r=await harness({storedPdf:bytes,account:{document_status:'issued',pdf_sha256:hash,sharepoint_drive_id:'drive',sharepoint_item_id:'item',generated_filename:'original.pdf'}});
  assert.equal(r.body.outlookStatus,'draft_ready');assert.ok(!r.calls.some(c=>c.method==='PUT'||c.name==='finalize_finance_billing'||c.url?.includes('raw.githubusercontent.com')));
});

test('manual PDF preview validates through server quote and has no reservation or Graph side effects',async()=>{
  const r=await harness({preview:true});assert.equal(r.response.status,200);assert.ok(r.body.pdfBase64);assert.ok(r.body.quote);
  assert.ok(!r.calls.some(c=>c.name==='acquire_finance_dispatch'||c.url?.includes('graph.microsoft.com')||c.name==='finalize_finance_billing'));
});
test('paid account draft requests no additional payment',async()=>{
  const r=await harness({fullyPaid:true,account:{collection_status:'paid'}});assert.equal(r.body.outlookStatus,'draft_ready');
});
test('lost finalize response never deletes a document whose cancellation was not confirmed',async()=>{
  const r=await harness({rpcError:'finalize_finance_billing',cancelFails:true});assert.ok(!r.calls.some(c=>c.method==='DELETE'));
});
test('full-funding manual preview renders a contract invoice without claiming future meetings',async()=>{
  const quote=fixture();Object.assign(quote.finance_transaction_account_lines[0],{billing_coverage:'full_funding',quantity_snapshot:4,finance_transaction_account_meetings:[],school_name_snapshot:'בית ספר א'});
  const r=await harness({preview:true,quote});assert.equal(r.response.status,200);assert.ok((await PDFDocument.load(Buffer.from(r.body.pdfBase64,'base64'))).getPageCount()>0);
  assert.ok(!r.calls.some(c=>c.name==='acquire_finance_dispatch'||c.url?.includes('graph.microsoft.com')));
});

test('Chrome preflight permits Supabase request headers before the actual PDF POST',async()=>{
  const r=await harness({preflight:true});
  assert.equal(r.response.status,200);
  assert.match(r.response.headers.get('Access-Control-Allow-Headers')||'',/x-client-info/);
  assert.match(r.response.headers.get('Access-Control-Allow-Methods')||'',/POST/);
  assert.equal(r.calls.length,0,'preflight must not reserve, dispatch or create a document');
});


test('realistic three-line Hebrew invoice renders on one page with selectable glyphs and intact dates',async()=>{
  const line={
    activity_name_snapshot:'תמיר - המחזור מתחיל בבית',gefen_number_snapshot:'60025',
    school_name_snapshot:'מרחבים',funding_snapshot:'תמיר',billing_rule:'completion',
    performance_month:'2026-09-01',billed_hours:1.5,quantity_snapshot:1,
    unit_price_snapshot:435,amount:435,
    finance_transaction_account_meetings:[{meeting_date:'2026-09-30'}]
  };
  const account={
    transaction_account_number:8529,customer_name_snapshot:'תמיר',institution_symbol:'563113',
    issue_date:'2026-10-30',payment_due_date:'2026-11-30',total_amount:1305,
    finance_transaction_account_lines:[
      {...structuredClone(line), activity_row_id:'ACT-8529-1'},
      {...structuredClone(line), activity_row_id:'ACT-8529-2'},
      {...structuredClone(line), activity_row_id:'ACT-8529-3'}
    ]
  };
  const r=await harness({account,activityTypes:{
    'ACT-8529-1':'workshop','ACT-8529-2':'workshop','ACT-8529-3':'workshop'
  }});
  assert.equal(r.response.status,200,JSON.stringify(r.body));
  const document=await PDFDocument.load(r.pdf);
  assert.equal(document.getPageCount(),1,'a short three-line invoice must not create an orphaned payment page');
  const pdf=await getDocument({data:new Uint8Array(r.pdf),useSystemFonts:false}).promise;
  assert.equal(pdf.numPages,1);
  const p=await pdf.getPage(1);
  const content=await p.getTextContent();
  const glyphs=content.items.map(item=>item.str||'').join(' ');
  assert.match(glyphs,/8529/);
  assert.match(glyphs,/1305|1,305/);
  assert.match(glyphs,/30.10.2026/);
  assert.match(glyphs,/30.11.2026/);
  assert.ok((glyphs.match(/[א-ת]/g)||[]).length>50,'Hebrew must remain vector, selectable PDF text');
  assert.doesNotMatch(glyphs,/60025/,'workshops must not show Gefen number');
  assert.ok((glyphs.match(/1,305\.00/g)||[]).length>=1,'compact invoice keeps the amount without quantity pricing');
  assert.match(glyphs,/500/);
  assert.match(glyphs,/300120/);
  assert.doesNotMatch(glyphs,/611/,'former bank branch must not be printed');
  // pdfjs loaded document can be collected after the test; no destroy method on this proxy.
});

test('full Hebrew fonts and logical-order drawing prevent the former stripped-glyph regression',async()=>{
  const edgeSource=await readFile(new URL('../supabase/functions/finance-transaction-accounts/index.ts',import.meta.url),'utf8');
  assert.match(edgeSource,/embedFont\(regularBytes, \{ subset: false \}\)/);
  assert.match(edgeSource,/embedFont\(boldBytes, \{ subset: false \}\)/);
  assert.match(edgeSource,/function drawLogicalRight\(/);
  assert.doesNotMatch(edgeSource,/font\.widthOfTextAtSize\(rtl\(/);
});


test('course invoices summarize each actual course with hours, meetings and hourly rate; do not merge different course IDs',async()=>{
  const base={
    activity_name_snapshot:'יישומי AI',gefen_number_snapshot:'53819',
    school_name_snapshot:'מרחבים',billing_rule:'monthly',
    quantity_snapshot:2,billed_hours:3,amount:900,hourly_rate_snapshot:300,
    unit_price_snapshot:450,finance_transaction_account_meetings:[]
  };
  const r=await harness({account:{
    total_amount:1950,finance_transaction_account_lines:[
      {...base,activity_row_id:'COURSE-1',amount:900},
      {...base,activity_row_id:'COURSE-1',amount:900},
      {...base,activity_row_id:'COURSE-2',quantity_snapshot:1,billed_hours:1.5,amount:150,hourly_rate_snapshot:100}
    ]
  },activityTypes:{'COURSE-1':'course','COURSE-2':'course'}});
  assert.equal(r.response.status,200,JSON.stringify(r.body));
  const pdf=await getDocument({data:new Uint8Array(r.pdf),useSystemFonts:false}).promise;
  const items=(await (await pdf.getPage(1)).getTextContent()).items;
  const txt=items.map(i=>i.str||'').join(' ');
  assert.equal(pdf.numPages,1);
  assert.equal((txt.match(/53819/g)||[]).length,2,'one course row for COURSE-1 and another for COURSE-2');
  assert.match(txt,/1950|1,950/);
  assert.match(txt,/300\.00/);
  assert.match(txt,/900|1,800/);
});

test('mixed payer invoice uses workshop and course layouts in the same document',async()=>{
  const r=await harness({account:{
    total_amount:735,finance_transaction_account_lines:[
      {activity_row_id:'C',activity_name_snapshot:'תוכנית חלל',gefen_number_snapshot:'57646',billing_rule:'monthly',funding_snapshot:'גפ״ן',quantity_snapshot:2,billed_hours:3,amount:300},
      {activity_row_id:'W',activity_name_snapshot:'סדנת מייקרים',gefen_number_snapshot:'99999',quantity_snapshot:1,billed_hours:1.5,amount:435,unit_price_snapshot:435}
    ]
  },activityTypes:{C:'course',W:'tour'}});
  assert.equal(r.response.status,200,JSON.stringify(r.body));
  const doc=await getDocument({data:new Uint8Array(r.pdf),useSystemFonts:false}).promise;
  const glyphs=(await (await doc.getPage(1)).getTextContent()).items.map(i=>i.str||'').join(' ');
  assert.match(glyphs,/57646/);
  assert.doesNotMatch(glyphs,/99999/,'tour Gefen number is excluded');
  assert.match(glyphs,/735\.00/);
});

test('the PDF source never prints billing internals and bank details are exact',async()=>{
  const edge=await readFile(new URL('../supabase/functions/finance-transaction-accounts/index.ts',import.meta.url),'utf8');
  const rendering=edge.slice(edge.indexOf('async function buildPdf('),edge.indexOf('\nDeno.serve('));
  assert.doesNotMatch(rendering,/מממן:|חודש סיום|חודש ביצוע|מפגש לחיוב|פירוט ביצוע לחיוב/, 'no internal billing details or Gefen in service columns');
  assert.ok(rendering.includes("'בנק הפועלים 12  |  סניף 500 הרימון  |  חשבון 300120'"),'bank number 12 and separators are printed exactly');
  assert.match(rendering,/טלפון: 055-4548890/,'invoice phone must be 055-4548890 in the shared letterhead');
  assert.match(rendering,/דניאל פריש 3, תל אביב \| טלפון: 055-4548890/,'invoice address and phone share the workshop-style header line');
  assert.doesNotMatch(rendering,/03-5370368|סניף 611|בנק הפועלים 12, סניף/);
  assert.doesNotMatch(rendering,/\(ע"ר\)/);
  assert.match(rendering,/מחיר לשעה/);
  assert.match(rendering,/\['שם בית הספר', 'תוכנית \/ קורס', 'רשות', 'סה״כ'\]/);
});

test('generated PDF contains updated invoice contact and both bank separators',async()=>{
  const r=await harness();
  assert.equal(r.response.status,200,JSON.stringify(r.body));
  const pdf=await getDocument({data:new Uint8Array(r.pdf),useSystemFonts:false}).promise;
  const glyphs=(await (await pdf.getPage(1)).getTextContent()).items.map(i=>i.str||'').join(' ');
  assert.match(glyphs,/055-4548890/);
  assert.match(glyphs,/300120/);
  assert.match(glyphs,/500/);
  assert.ok((glyphs.match(/\|/g)||[]).length>=2,'both bank separators should remain selectable text');
  assert.doesNotMatch(glyphs,/03-5370368/);
});

test('multi-page course invoice keeps payment section together without repeating addressee',async()=>{
  const lines=Array.from({length:29},(_,i)=>({
    activity_row_id:'COURSE-29-'+i,
    activity_name_snapshot:'בינה מלאכותית וחדשנות',
    school_name_snapshot:'בית ספר '+(i+1),
    gefen_number_snapshot:'9545',
    billing_rule:'completion',quantity_snapshot:8,billed_hours:12,
    amount:10000,unit_price_snapshot:1250,
    finance_transaction_account_meetings:[]
  }));
  const result=await harness({account:{
    customer_name_snapshot:'רמי שני',
    institution_symbol:'',
    total_amount:290000,
    finance_transaction_account_lines:lines
  }});
  assert.equal(result.response.status,200,JSON.stringify(result.body));
  const doc=await getDocument({data:new Uint8Array(result.pdf),useSystemFonts:false}).promise;
  assert.ok(doc.numPages>=2,'a 29-activity invoice should span multiple pages');
  const last=(await (await doc.getPage(doc.numPages)).getTextContent()).items
    .map(item=>item.str||'').join('');
  assert.match(last,/300120/,'the final page must include the bank transfer account');
  assert.doesNotMatch(last,/ל\s*כ\s*ב\s*ו\s*ד/,'the last page must not reprint the customer greeting');
});

test('billed dates in course workshop tour and deferred preview PDFs use only attached meeting snapshots',async()=>{
  for(const type of ['course','workshop','tour']) {
    const meetings=[{meeting_date:'2026-11-03'},{meeting_date:'2026-10-05'},{meeting_date:'2026-10-12'}];
    const line={activity_row_id:'a',activity_type_snapshot:type,activity_name_snapshot:'פעילות',school_name_snapshot:'מוסד',quantity_snapshot:3,
      billed_hours:type==='course'?4.5:0,hourly_rate_snapshot:type==='course'?200:null,unit_price_snapshot:300,amount:900,
      billing_rule:type==='course'?'monthly':'completion',funding_snapshot:type==='course'?'גפ״ן':'מממן אחר',
      performance_month:'2026-11-01',finance_transaction_account_meetings:meetings};
    for(const preview of [false,true]) {
      const account={...fixture(),total_amount:900,finance_transaction_account_lines:[line]};
      const r=await harness({preview,quote:account,account,activityTypes:{a:type}});
      const bytes=preview?Buffer.from(r.body.pdfBase64,'base64'):r.pdf;
      const pdf=await getDocument({data:new Uint8Array(bytes),useSystemFonts:false}).promise;
      const text=(await (await pdf.getPage(1)).getTextContent()).items.map(i=>i.str||'').join(' ');
      for(const value of ['05.10.2026','12.10.2026','03.11.2026']) {
        if(type==='course') assert.ok(text.includes(value),`${type} preview=${preview}: ${value}`);
        else assert.ok(!text.includes(value),`non-Gefen ${type} has no extended meeting list`);
      }
      if(type==='course') {
        assert.ok(text.indexOf('05.10.2026')<text.indexOf('12.10.2026'));
        assert.ok(text.indexOf('12.10.2026')<text.indexOf('03.11.2026'));
      }
      assert.ok(!text.includes('01.09.2026'),'unrelated planned dates are not added');
    }
  }
});
test('all 35 billed dates wrap without clipping and totals remain visible',async()=>{
  const line={activity_row_id:'a',activity_name_snapshot:'קורס',billing_rule:'monthly',funding_snapshot:'גפ״ן',quantity_snapshot:35,billed_hours:52.5,amount:3500,hourly_rate_snapshot:3500/52.5,
    finance_transaction_account_meetings:Array.from({length:35},(_,i)=>({meeting_date:new Date(Date.UTC(2026,8,i+1)).toISOString().slice(0,10)}))};
  const r=await harness({account:{total_amount:3500,finance_transaction_account_lines:[line]}});
  const pdf=await getDocument({data:new Uint8Array(r.pdf),useSystemFonts:false}).promise;
  let text='';for(let n=1;n<=pdf.numPages;n++){
    const items=(await (await pdf.getPage(n)).getTextContent()).items;
    text+=items.map(i=>i.str||'').join(' ');
    assert.ok(items.filter(i=>i.str?.trim()).every(i=>i.transform[5]>=20&&i.transform[5]<=810));
  }
  for(const m of line.finance_transaction_account_meetings){const [y,mo,d]=m.meeting_date.split('-');assert.ok(text.includes(`${d}.${mo}.${y}`),m.meeting_date);}
  assert.match(text,/3,500/);
});


test('Google performance PDF shows three 90-minute meetings and rate based on full activity price',async()=>{
  const quote=process.env.FINANCE_ACCEPTANCE_QUOTE_PATH ? JSON.parse(await readFile(process.env.FINANCE_ACCEPTANCE_QUOTE_PATH,'utf8')) : {...fixture(),total_amount:2400,finance_transaction_account_lines:[{activity_row_id:'google',activity_name_snapshot:'יישומי AI בשיתוף GOOGLE',activity_price_snapshot:8000,billing_rule:'monthly',funding_snapshot:'גפ״ן',quantity_snapshot:3,billed_hours:4.5,hourly_rate_snapshot:8000/15,amount:2400,billing_coverage:'performance',finance_transaction_account_meetings:[1,2,3].map(n=>({meeting_date:`2026-10-0${n}`,hours:1.5}))}]};
  assert.equal(Number(quote.total_amount),2400);assert.equal(Number(quote.finance_transaction_account_lines[0].activity_price_snapshot),8000);
  const r=await harness({preview:true,quote,activityTypes:{google:'course'},activityPrices:{google:8000},activitySessions:{google:'10'}});assert.equal(r.response.status,200);
  const pdf=await getDocument({data:new Uint8Array(Buffer.from(r.body.pdfBase64,'base64')),useSystemFonts:false}).promise;
  const text=(await(await pdf.getPage(1)).getTextContent()).items.map(x=>x.str||'').join(' ');
  assert.match(text,/2,400\.00/);assert.match(text,/533\.33/);assert.match(text,/4\.5/);
  assert.ok(!r.calls.some(c=>c.name==='finalize_finance_billing'||c.method==='PUT'));
});
test('full remaining course PDF keeps original full-activity hourly rate even with reduced billed total',async()=>{
  const quote={...fixture(),total_amount:5000,finance_transaction_account_lines:[{activity_row_id:'ai',activity_name_snapshot:'AI',billing_rule:'monthly',funding_snapshot:'גפ״ן',quantity_snapshot:10,billed_hours:15,hourly_rate_snapshot:8000/15,amount:5000,billing_coverage:'full_funding',finance_transaction_account_meetings:[]}]};
  const r=await harness({preview:true,quote,activityTypes:{ai:'course'}});assert.equal(r.response.status,200);
  const pdf=await getDocument({data:new Uint8Array(Buffer.from(r.body.pdfBase64,'base64')),useSystemFonts:false}).promise;
  const text=(await(await pdf.getPage(1)).getTextContent()).items.map(x=>x.str||'').join(' ');
  assert.match(text,/5,000\.00/);assert.match(text,/533\.33/);assert.doesNotMatch(text,/333\.33/);
});


test('approved document revision uses the real shared PDF renderer and preserves its original number and amount',async()=>{
  const quote=process.env.FINANCE_REVISION_DOC_QUOTE?JSON.parse(await readFile(process.env.FINANCE_REVISION_DOC_QUOTE,'utf8')):{...fixture(),transaction_account_number:'Pl26000170',customer_name_snapshot:'Corrected customer',total_amount:3000,finance_transaction_account_lines:[{activity_row_id:'a',service_description_snapshot:'Corrected description',billed_hours:4.5,quantity_snapshot:3,hourly_rate_snapshot:3000/4.5,amount:3000}]};
  const r=await harness({revisionPreview:true,quote});assert.equal(r.response.status,200,JSON.stringify(r.body));assert.equal(String(r.body.quote.transaction_account_number),String(quote.transaction_account_number));
  const pdf=await getDocument({data:new Uint8Array(Buffer.from(r.body.pdfBase64,'base64')),useSystemFonts:false}).promise;
  const text=(await(await pdf.getPage(1)).getTextContent()).items.map(x=>x.str||'').join(' ');assert.match(text,/3,000\.00/);assert.ok(text.includes(String(quote.transaction_account_number)));
  assert.ok(!r.calls.some(c=>c.method==='PUT'||c.name==='finalize_finance_billing'||c.url?.includes('/messages')));
});
test('approved replacement PDF reflects the server-approved changed price and recalculated hourly rate',async()=>{
  const quote=process.env.FINANCE_REVISION_PRICE_QUOTE?JSON.parse(await readFile(process.env.FINANCE_REVISION_PRICE_QUOTE,'utf8')):{...fixture(),transaction_account_number:'טיוטה חלופית',total_amount:2500,finance_transaction_account_lines:[{activity_row_id:'a',activity_price_snapshot:2500,billing_rule:'monthly',funding_snapshot:'גפ״ן',billed_hours:4.5,quantity_snapshot:3,hourly_rate_snapshot:2500/4.5,amount:2500}]};
  const r=await harness({revisionPreview:true,quote});assert.equal(r.response.status,200,JSON.stringify(r.body));const pdf=await getDocument({data:new Uint8Array(Buffer.from(r.body.pdfBase64,'base64')),useSystemFonts:false}).promise;
  const text=(await(await pdf.getPage(1)).getTextContent()).items.map(x=>x.str||'').join(' ');assert.match(text,/2,500\.00/);assert.match(text,/555\.56/);
});
test('a pending revision cannot reach PDF rendering through the actual Edge entrypoint',async()=>{
  const r=await harness({revisionPreview:true,revisionNotApproved:true});assert.equal(r.response.status,400);assert.equal(r.body.error,'revision_not_approved');assert.ok(!r.body.pdfBase64);assert.ok(!r.calls.some(c=>c.type==='fetch'));
});
test('an already sent account with no message ID never creates a replacement message automatically',async()=>{
  const r=await harness({account:{document_status:'issued',outlook_status:'already_sent',outlook_message_id:null}});assert.equal(r.response.status,200);assert.equal(r.body.outlookStatus,'already_sent');assert.ok(!r.calls.some(c=>c.type==='fetch'));
});
test('revision PDF output is deterministic for safe reconciliation after an uncertain SharePoint upload',async()=>{
  const quote={...fixture(),revision_created_at:'2026-11-04T00:00:00Z'};
  const first=await harness({preview:true,quote:structuredClone(quote)}),second=await harness({preview:true,quote:structuredClone(quote)});assert.equal(first.response.status,200);assert.equal(second.response.status,200);assert.equal(Buffer.compare(Buffer.from(first.body.pdfBase64,'base64'),Buffer.from(second.body.pdfBase64,'base64')),0);
});

test('non-Gefen sponsor PDF shows school authority course and total only',async()=>{
  const account={...fixture(),customer_name_snapshot:'רמי שני',total_amount:18000,
    finance_transaction_account_lines:[
      {activity_row_id:'SCHOOL-A',activity_name_snapshot:'ביומימיקרי',school_name_snapshot:'אבן שמואל',
        gefen_number_snapshot:'6089',billing_rule:'completion',funding_snapshot:'רמי שני',
        quantity_snapshot:11,billed_hours:16.5,hourly_rate_snapshot:606.06,amount:10000,
        finance_transaction_account_meetings:[{meeting_date:'2026-10-17'}]},
      {activity_row_id:'SCHOOL-B',activity_name_snapshot:'יישומי AI',school_name_snapshot:'הרצל',
        gefen_number_snapshot:'53819',billing_rule:'completion',funding_snapshot:'רמי שני',
        quantity_snapshot:10,billed_hours:15,hourly_rate_snapshot:533.33,amount:8000,
        finance_transaction_account_meetings:[]}
    ]};
  const r=await harness({preview:true,quote:account,activityTypes:{'SCHOOL-A':'course','SCHOOL-B':'course'},
    authorityIds:{'SCHOOL-A':20,'SCHOOL-B':25},authorityNames:{20:'שפיר',25:'רחובות'}});
  assert.equal(r.response.status,200,JSON.stringify(r.body));
  const pdf=await getDocument({data:new Uint8Array(Buffer.from(r.body.pdfBase64,'base64')),useSystemFonts:false}).promise;
  const text=(await(await pdf.getPage(1)).getTextContent()).items.map(x=>x.str||'').join(' ');
  // Hebrew glyph runs may be returned one character at a time by pdfjs.
  const normalizedText=text.replace(/\s+/g,'');
  for(const word of ['אבן שמואל','שפיר','ביומימיקרי','הרצל','רחובות','יישומי AI','10,000.00','8,000.00'])
    assert.ok(normalizedText.includes(word.replace(/\s+/g,'')),word);
  for(const value of ['606.06','533.33','16.5','6089','53819','17.10.2026'])
    assert.ok(!text.includes(value),'non-Gefen invoice must not expose hourly/meeting detail: '+value);
  assert.ok(!r.calls.some(c=>c.name==='finalize_finance_billing'||c.method==='PUT'));
});

test('monthly Gefen PDF keeps meetings, hours, hourly price and Gefen program number',async()=>{
  const quote={...fixture(),total_amount:8000,finance_transaction_account_lines:[{
    activity_row_id:'GEFEN-A',activity_name_snapshot:'יישומי AI',school_name_snapshot:'ביאליק',
    gefen_number_snapshot:'53819',billing_rule:'monthly',funding_snapshot:'גפ״ן',billed_hours:15,
    quantity_snapshot:10,hourly_rate_snapshot:8000/15,amount:8000,
    finance_transaction_account_meetings:[{meeting_date:'2026-10-01'}]}]};
  const r=await harness({preview:true,quote,activityTypes:{'GEFEN-A':'course'},
    authorityIds:{'GEFEN-A':4},authorityNames:{4:'יבנה'}});
  assert.equal(r.response.status,200,JSON.stringify(r.body));
  const pdf=await getDocument({data:new Uint8Array(Buffer.from(r.body.pdfBase64,'base64')),useSystemFonts:false}).promise;
  const text=(await(await pdf.getPage(1)).getTextContent()).items.map(x=>x.str||'').join(' ');
  for(const val of ['53819','533.33','15','10','01.10.2026'])assert.ok(text.includes(val),val);
});


test('Gefen invoice PDF mirrors the proposal alias for original 3604 only',async()=>{
  const makeQuote=(code,name='פורצות דרך',funding='גפ״ן',type='course')=>({
    ...fixture(),customer_name_snapshot:'מקיף דתי אמית קנדי',total_amount:1285.71,
    finance_transaction_account_lines:[{
      activity_row_id:'path',activity_type_snapshot:type,activity_name_snapshot:name,
      service_description_snapshot:name,gefen_number_snapshot:code,school_name_snapshot:'מקיף דתי אמית קנדי',
      billing_rule:funding==='גפ״ן'?'monthly':'completion',funding_snapshot:funding,
      quantity_snapshot:3,billed_hours:4.5,planned_meeting_count_snapshot:14,
      activity_price_snapshot:12000,hourly_rate_snapshot:571.43,amount:1285.71,
      finance_transaction_account_meetings:[]
    }]
  });
  for(const scenario of [
    {code:'3604',source:'3604',name:'פורצות דרך',funding:'גפ״ן',type:'course',alias:true},
    {code:'52279',source:'52279',name:'אופק פרימיום',funding:'גפ״ן',type:'course',alias:false},
    {code:'3604',source:'3604',name:'פורצות דרך',funding:'רמי שני',type:'course',alias:false},
    {code:'3604',source:'3604',name:'פורצות דרך',funding:'גפ״ן',type:'workshop',alias:false},
    {code:'3604',source:'9545',name:'פורצות דרך',funding:'גפ״ן',type:'course',alias:false}
  ]){
    const quote=makeQuote(scenario.code,scenario.name,scenario.funding,scenario.type);
    const result=await harness({preview:true,quote,activityTypes:{path:scenario.type},activityNumbers:{path:scenario.source},activityPrices:{path:12000},activitySessions:{path:14}});
    assert.equal(result.response.status,200,scenario.name);
    assert.equal(result.body.quote.finance_transaction_account_lines[0].gefen_number_snapshot,scenario.code,'source snapshots unchanged');
    const pdf=await getDocument({data:new Uint8Array(Buffer.from(result.body.pdfBase64,'base64')),useSystemFonts:false}).promise;
    const content=(await(await pdf.getPage(1)).getTextContent()).items.map(x=>x.str||'').join(' ');
    if(scenario.alias){
      assert.match(content,/אופק פרימיום \(פורצות דרך\)/);
      assert.match(content,/52279/);
      assert.doesNotMatch(content,/3604/);
    } else {
      assert.doesNotMatch(content,/אופק פרימיום \(פורצות דרך\)/);
      assert.match(content,new RegExp(scenario.name));
    }
    assert.match(content,/1,285\.71/);
  }
});
