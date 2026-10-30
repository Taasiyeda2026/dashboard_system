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
const fixture=()=>({id:'account',document_status:'generating',outlook_status:'pending',transaction_account_number:8525,
  customer_name_snapshot:'בית ספר א',institution_symbol:'123',customer_email_snapshot:'test@example.test',issue_date:'2026-10-01',payment_due_date:'2026-11-30',total_amount:2500,
  finance_transaction_account_lines:[{activity_name_snapshot:'תוכנית חלל',funding_snapshot:'גפ״ן',performance_month:'2026-09-01',billed_hours:3,hourly_rate_snapshot:833.333,amount:2500,
    finance_transaction_account_meetings:[{meeting_date:'2026-09-01'},{meeting_date:'2026-09-02'}]}]});
async function harness(options={}) {
  const account=fixture();Object.assign(account,options.account);const calls=[];let handler;let pdf;
  const rpc=async(name,args)=>{
    calls.push({type:'rpc',name,args});
    if(name==='finance_manual_account_quote')return{data:options.quote||fixture()};
    if(name==='finance_transaction_can_issue')return{data:options.allowed!==false};
    if(name==='cancel_finance_dispatch'&&options.cancelFails)return{error:{message:'not_owned'}};
    if(name===options.rpcError)return{error:{message:'test_'+name}};
    if(name==='finalize_finance_billing') {Object.assign(account,{document_status:'issued',pdf_sha256:args.p_pdf_sha256});return{data:{...account}};}
    return{data:null};
  };
  const client={rpc,from:(table)=>table==='activities'
    ? {select:()=>({in:async(_key,ids)=>({data:ids.map(id=>({
      row_id:id,activity_type:options.activityTypes?.[id]||'course',activity_season:'school_2027'
    }))})})}
    : ({select:()=>({eq:()=>({single:async()=>({data:account})})})})};

  const fetch=async(url,opts={})=>{
    calls.push({type:'fetch',url,method:opts.method||'GET'});
    if(url.startsWith('https://raw.githubusercontent.com/')) {
      const asset=url.split('/main/')[1];return new Response(await readFile(new URL('../'+asset,import.meta.url)));
    }
    if(url.includes('login.microsoftonline.com'))return Response.json({access_token:'mock'});
    if(url.includes('?$select=id,name,folder'))return Response.json({id:'01LT7GPE6FW7O7REM6WJBIXX6II2IDYTXM',folder:{}});
    if(opts.method==='PUT') {pdf=opts.body;if(options.uploadFails)return new Response('test',{status:500});return Response.json({id:'item',webUrl:'https://example.test/pdf'});}
    if(opts.method==='DELETE')return new Response(null,{status:204});
    if(url.endsWith('/content'))return new Response(options.storedPdf);
    if(url.includes('/messages?$filter='))return Response.json({value:options.previousDraft?[{id:'old-draft'}]:[]});
    if(url.endsWith('/messages') && opts.method==='POST') {
      if(options.mailFails)return new Response('test',{status:500});
      const payload=JSON.parse(opts.body);assert.equal(payload.attachments.length,1);assert.ok(payload.singleValueExtendedProperties[0].value);
      if(options.fullyPaid)assert.doesNotMatch(payload.body.content,/נשמח להסדרת/);
      assert.equal(Buffer.from(payload.attachments[0].contentBytes,'base64').subarray(0,4).toString(),'%PDF');
      return Response.json({id:'draft'});
    }
    throw new Error('Unexpected outbound call: '+url);
  };
  globalThis.__financeTestDeps = {PDFDocument,rgb,fontkit,bidiFactory,createClient:()=>client,fetch,Response,Request,URLSearchParams,Uint8Array,crypto,TextEncoder,btoa,console,
    Deno:{env:{get:k=>({SUPABASE_URL:'https://supabase.test',SUPABASE_ANON_KEY:'test',SUPABASE_SERVICE_ROLE_KEY:'test',MS_TENANT_ID:'test',MS_CLIENT_ID:'test',MS_CLIENT_SECRET:'test',MS_MAIL_SENDER:'test@example.test'})[k]},serve:fn=>{handler=fn;}}};
  const injected = 'const { PDFDocument, rgb, fontkit, bidiFactory, createClient, fetch, Deno } = globalThis.__financeTestDeps;\n' + script;
  await import('data:text/javascript;base64,'+Buffer.from(injected).toString('base64')+'#'+crypto.randomUUID());
  delete globalThis.__financeTestDeps;
  const request = options.preflight
    ? new Request('https://function.test', { method:'OPTIONS', headers: {
      origin:'https://taasiyeda2026.github.io',
      'access-control-request-method':'POST',
      'access-control-request-headers':'authorization, x-client-info, apikey, content-type'
    } })
    : new Request('https://function.test',{method:'POST',headers:{authorization:'Bearer mock'},body:JSON.stringify(options.preview?{preview:true,manual:{activity:'a',funder:'g',month:'2026-09-01',draft:{}}}:{accountId:'account'})});
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
  const failed=await harness({mailFails:true});assert.equal(failed.body.outlookStatus,'failed');
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
  assert.equal((glyphs.match(/435\.00/g)||[]).length,1,'identical workshops must be consolidated to a single unit-price cell');
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
      {activity_row_id:'C',activity_name_snapshot:'תוכנית חלל',gefen_number_snapshot:'57646',quantity_snapshot:2,billed_hours:3,amount:300},
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
  assert.ok(rendering.includes('"טלפון: 055-4548890"'),'invoice phone must be 055-4548890');
  assert.doesNotMatch(rendering,/03-5370368|סניף 611|בנק הפועלים 12, סניף/);
  assert.doesNotMatch(rendering,/\(ע"ר\)/);
  assert.match(rendering,/מחיר לשעה/);
  assert.match(rendering,/מחיר ליחידה/);
});

test('generated PDF contains updated invoice contact and both bank separators',async()=>{
  const r=await harness();
  assert.equal(r.response.status,200,JSON.stringify(r.body));
  const pdf=await getDocument({data:new Uint8Array(r.pdf),useSystemFonts:false}).promise;
  const glyphs=(await (await pdf.getPage(1)).getTextContent()).items.map(i=>i.str||'').join(' ');
  assert.match(glyphs,/055-4548890/);
  assert.match(glyphs,/300120/);
  assert.match(glyphs,/500/);
  assert.ok((glyphs.match(/\\|/g)||[]).length>=2,'both bank separators should remain selectable text');
  assert.doesNotMatch(glyphs,/03-5370368/);
});
