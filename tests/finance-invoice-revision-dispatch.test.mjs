import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {createHash} from 'node:crypto';
const source=stripTypeScriptTypes(await readFile(new URL('../supabase/functions/finance-transaction-accounts/revision-dispatch.ts',import.meta.url),'utf8'),{mode:'transform'});
const {updateInvoiceDraft,handleInvoiceRevision}=new Function(source.replace(/export /g,'')+';return {updateInvoiceDraft,handleInvoiceRevision};')();
const bytes=s=>new Uint8Array(Buffer.from(s));
const hash=async b=>createHash('sha256').update(b).digest('hex');
const b64=b=>Buffer.from(b).toString('base64');
function draftHarness({sent=false,lost=false}={}){
 const calls=[],attachments=[{id:'old','@odata.type':'#microsoft.graph.fileAttachment',name:'old.pdf',contentBytes:b64(bytes('old'))},{id:'other','@odata.type':'#microsoft.graph.fileAttachment',name:'other.pdf',contentBytes:b64(bytes('other'))}];let lostOnce=lost;
 const d={base64:b64,pdfHash:hash,draftContent:()=>({subject:'corrected',body:{contentType:'Text',content:'body'}}),
 graph:async(_token,path,options={})=>{calls.push({path,method:options.method||'GET',body:options.body&&JSON.parse(options.body)});
  if(path.includes('?$select='))return {id:'draft',isDraft:!sent};
  if(options.method==='PATCH')return {};
  if(options.method==='POST'){assert.ok(path.endsWith('/attachments'),'never create a new message');const value=JSON.parse(options.body);attachments.push({id:'new',...value});if(lostOnce){lostOnce=false;throw Error('response lost');}return {id:'new'};}
  if(options.method==='DELETE'){assert.ok(attachments.some(a=>a.id==='new'),'new PDF must exist before old PDF removal');const id=path.split('/').at(-1);attachments.splice(attachments.findIndex(a=>a.id===id),1);return;}
  return {value:structuredClone(attachments)};
 },verifyDraft:async()=>{assert.ok(attachments.some(a=>a.name==='new.pdf'&&a.contentBytes===b64(bytes('new'))));return {id:'draft',isDraft:true};}};
 return {d,calls,attachments};
}
test('existing Outlook draft gets revised recipients and PDF in place, preserves unrelated files and never sends',async()=>{
 const {d,calls,attachments}=draftHarness();
 await updateInvoiceDraft(d,'delegated',{id:'invoice',outlook_message_id:'draft',outlook_owner_mailbox:'idann@think.org.il'},bytes('new'),'new.pdf',['corrected@example.test'],[{name:'old.pdf',hash:await hash(bytes('old'))}]);
 assert.deepEqual(attachments.map(a=>a.id).sort(),['new','other']);
 const patch=calls.find(c=>c.method==='PATCH').body;assert.equal(patch.toRecipients[0].emailAddress.address,'corrected@example.test');assert.equal(patch.singleValueExtendedProperties[0].value,'invoice');
 assert.match(patch.singleValueExtendedProperties[0].id,/fe840b5e/);assert.ok(!calls.some(c=>c.path.includes('/send')));
});
test('lost attachment response reconciles the same draft and cannot duplicate the attachment or message',async()=>{
 const {d,calls,attachments}=draftHarness({lost:true}),args=[d,'delegated',{id:'invoice',outlook_message_id:'draft'},bytes('new'),'new.pdf',['a@example.test'],[{name:'old.pdf',hash:await hash(bytes('old'))}]];
 await assert.rejects(updateInvoiceDraft(...args),/response lost/);await updateInvoiceDraft(...args);
 assert.equal(calls.filter(c=>c.method==='POST').length,1);assert.equal(attachments.filter(a=>a.name==='new.pdf').length,1);
});
test('a sent Outlook message is not patched and no new message or attachment is created',async()=>{
 const {d,calls}=draftHarness({sent:true});const result=await updateInvoiceDraft(d,'delegated',{outlook_message_id:'sent'},bytes('new'),'new.pdf',[],[]);
 assert.equal(result.isDraft,false);assert.ok(calls.every(c=>c.method==='GET'));
});
function revisionHarness({pending=false,financial=false,sent=false,uploadFails=false}={}){
 const calls=[];let originalActive=true;
 const quote={revision:'reviewed',revision_actor:'owner',revision_financial:financial};
 const stage={quote:{...quote,transaction_account_number:financial?'new-number':'old-number'},originalAccountId:'old',accountId:financial?'new':'old',financial,originalMessageId:financial?'draft':null,originalMailbox:'idann@think.org.il',originalOwnerId:'owner'};
 const user={rpc:async(name)=>{calls.push({name});return name==='finance_invoice_revision_quote'?(pending?{error:Error('revision_not_approved')}:{data:quote}):{data:true};}};
 const admin={rpc:async(name,args)=>{calls.push({name,args});if(name==='begin_finance_invoice_revision')return {data:stage};if(name==='finish_finance_invoice_revision'){originalActive=false;return {data:{accountId:stage.accountId,applied:true}};}return {data:true};}};
 const d={base64:b64,pdfHash:hash,attachActivityTypes:async()=>{},buildPdf:async()=>bytes('pdf'),graphToken:async()=> 'sharepoint-only',validateTransactionFolder:async()=>{},drive:'drive',folder:'folder',
  graph:async(_token,path)=>{calls.push({graph:path});return path.includes('/messages/')?{isDraft:!sent}:{id:'folder'};},
  fetch:async()=>{assert.ok(originalActive,'original remains active while storing the revised PDF');calls.push({upload:true});return uploadFails?new Response('',{status:503}):Response.json({id:'new-file',webUrl:'https://example.test/new.pdf'});}};
 return {calls,user,admin,d,isActive:()=>originalActive};
}
test('unapproved financial revision cannot render PDF, upload or reach Graph',async()=>{
 const h=revisionHarness({pending:true});await assert.rejects(handleInvoiceRevision(h.d,h.user,h.admin,{revisionId:'r',revisionPreview:true},new Headers()),/revision_not_approved/);assert.deepEqual(h.calls.map(c=>c.name),['finance_invoice_revision_quote']);assert.ok(h.isActive());
});
test('failed PDF storage preserves the original account and releases the existing dispatch lease',async()=>{
 const h=revisionHarness({uploadFails:true});await assert.rejects(handleInvoiceRevision(h.d,h.user,h.admin,{revisionId:'r',revision:'reviewed'},new Headers()),/sharepoint_upload_failed/);assert.ok(h.isActive());assert.ok(!h.calls.some(c=>c.name==='finish_finance_invoice_revision'));assert.equal(h.calls.at(-1).name,'release_finance_dispatch');
});
test('financial replacement rejects an already sent draft before uploading or cancelling the original',async()=>{
 const h=revisionHarness({financial:true,sent:true});await assert.rejects(handleInvoiceRevision(h.d,h.user,h.admin,{revisionId:'r',revision:'reviewed'},new Headers({'x-microsoft-mail-token':'delegated'})),/finance_decision_required/);assert.ok(h.isActive());assert.ok(!h.calls.some(c=>c.upload||c.name==='finish_finance_invoice_revision'));assert.ok(h.calls.some(c=>c.name==='mark_finance_revision_sent'));
});
test('approved financial revision checks draft twice and applies only after storage; no mail is sent',async()=>{
 const h=revisionHarness({financial:true});const result=await handleInvoiceRevision(h.d,h.user,h.admin,{revisionId:'r',revision:'reviewed'},new Headers({'x-microsoft-mail-token':'delegated'}));assert.equal(result.accountId,'new');assert.equal(h.calls.filter(c=>c.graph?.includes('/messages/')).length,2);assert.ok(h.calls.findIndex(c=>c.upload)<h.calls.findIndex(c=>c.name==='finish_finance_invoice_revision'));assert.ok(!h.calls.some(c=>c.graph?.includes('/send')));
});

test('an uncertain SharePoint upload reconciles the same PDF without cancelling or overwriting the original',async()=>{
 const h=revisionHarness();let calls=0;h.d.fetch=async()=>{calls++;return calls===1?new Response('',{status:409}):new Response(bytes('pdf'));};h.d.graph=async()=>({id:'stored-item',webUrl:'https://example.test/stored.pdf'});
 const result=await handleInvoiceRevision(h.d,h.user,h.admin,{revisionId:'r',revision:'reviewed'},new Headers());assert.equal(result.accountId,'old');assert.equal(calls,2);assert.ok(h.calls.some(c=>c.name==='finish_finance_invoice_revision'));
 const conflict=revisionHarness();let attempts=0;conflict.d.fetch=async()=>++attempts===1?new Response('',{status:409}):new Response(bytes('different pdf'));conflict.d.graph=async()=>({id:'stored-item',webUrl:'https://example.test/stored.pdf'});
 await assert.rejects(handleInvoiceRevision(conflict.d,conflict.user,conflict.admin,{revisionId:'r',revision:'reviewed'},new Headers()),/revision_pdf_conflict/);assert.ok(conflict.isActive());assert.ok(!conflict.calls.some(c=>c.name==='finish_finance_invoice_revision'));
});
