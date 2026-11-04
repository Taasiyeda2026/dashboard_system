// Reuses the invoice renderer, SharePoint folder, existing lease, and delegated
// mailbox proof. This module never creates a new message or sends mail.
const clean=(v:any)=>String(v??'').trim();
const propertyId='String {fe840b5e-3427-421b-a522-224fbb1c2c65} Name FinanceAccountId';
export async function updateInvoiceDraft(d:any,token:string,account:any,bytes:Uint8Array,filename:string,recipients:string[],previous:any[]) {
 const path=`/me/messages/${encodeURIComponent(account.outlook_message_id)}`;
 const current=await d.graph(token,`${path}?$select=id,isDraft`);
 if(current.isDraft===false)return {isDraft:false,id:current.id};
 if(current.isDraft!==true)throw Error('draft_state_verification_failed');
 await d.graph(token,path,{method:'PATCH',body:JSON.stringify({...d.draftContent(account),toRecipients:recipients.map(address=>({emailAddress:{address}})),singleValueExtendedProperties:[{id:propertyId,value:account.id}]})});
 let attachments=await d.graph(token,`${path}/attachments`);
 const targetHash=await d.pdfHash(bytes);
 let present=false;
 for(const a of attachments.value||[])if(a['@odata.type']==='#microsoft.graph.fileAttachment'&&a.name===filename&&a.contentBytes&&await d.pdfHash(Uint8Array.from(atob(a.contentBytes),c=>c.charCodeAt(0)))===targetHash)present=true;
 if(!present){
  if((await d.graph(token,`${path}?$select=isDraft`)).isDraft!==true)return {isDraft:false,id:current.id};
  await d.graph(token,`${path}/attachments`,{method:'POST',body:JSON.stringify({'@odata.type':'#microsoft.graph.fileAttachment',name:filename,contentType:'application/pdf',contentBytes:d.base64(bytes)})});
 }
 // Verify the replacement before removing any historical invoice attachment.
 const verified=await d.verifyDraft(token,account.outlook_owner_mailbox,current.id,filename,targetHash,recipients);
 if(!verified.isDraft)return verified;
 attachments=await d.graph(token,`${path}/attachments`);
 for(const a of attachments.value||[]){
  if(a.name===filename||a['@odata.type']!=='#microsoft.graph.fileAttachment'||!a.contentBytes)continue;
  const hash=await d.pdfHash(Uint8Array.from(atob(a.contentBytes),c=>c.charCodeAt(0)));
  if(!previous.some(p=>p.name===a.name&&p.hash===hash))continue;
  if((await d.graph(token,`${path}?$select=isDraft`)).isDraft!==true)return {isDraft:false,id:current.id};
  await d.graph(token,`${path}/attachments/${encodeURIComponent(a.id)}`,{method:'DELETE'});
 }
 return verified;
}

export async function handleInvoiceRevision(d:any,user:any,admin:any,body:any,headers:Headers) {
 const id=clean(body.revisionId),token=crypto.randomUUID();let oldId='';
 try {
  const {data:quote,error}=await user.rpc('finance_invoice_revision_quote',{p_id:id});
  if(error)throw error;
  if(quote.applied)return quote;
  if(body.revisionPreview===true){
   await d.attachActivityTypes(quote,admin);const bytes=await d.buildPdf(quote);
   return {quote,pdfBase64:d.base64(bytes)};
  }
  const begun=await admin.rpc('begin_finance_invoice_revision',{p_id:id,p_token:token,p_expected_revision:body.revision,p_actor:quote.revision_actor});
  if(begun.error)throw begun.error;
  const stage=begun.data;if(stage.applied)return stage;
  oldId=stage.originalAccountId;
  const q=stage.quote,mailToken=clean(headers.get('x-microsoft-mail-token'));
  let mailState='unknown';
  if(stage.financial&&stage.originalMessageId){
   if(!mailToken||!stage.originalMailbox||quote.revision_actor!==stage.originalOwnerId)throw Error('invoice_original_issuer_required');
   const own=await d.graph(mailToken,'/me/mailFolders/drafts?$select=id');
   const expected=await d.graph(mailToken,`/users/${encodeURIComponent(stage.originalMailbox)}/mailFolders/drafts?$select=id`);
   if(!own.id||own.id!==expected.id)throw Error('invoice_microsoft_account_mismatch');
   const message=await d.graph(mailToken,`/me/messages/${encodeURIComponent(stage.originalMessageId)}?$select=isDraft`);
   if(message.isDraft!==true){await admin.rpc('mark_finance_revision_sent',{p_id:id,p_token:token});throw Error('finance_decision_required');}
   mailState='draft';
  }
  const graphToken=await d.graphToken();await d.validateTransactionFolder(graphToken);
  await d.attachActivityTypes(q,admin);const bytes=await d.buildPdf(q),hash=await d.pdfHash(bytes);
  const filename=`חשבון עסקה ${q.transaction_account_number} - תיקון ${id}-${clean(body.revision).slice(0,12)}.pdf`;
  const itemPath=`/drives/${encodeURIComponent(d.drive)}/items/${encodeURIComponent(d.folder)}:/${encodeURIComponent(filename)}`;
  let item:any;
  const upload=await d.fetch(`https://graph.microsoft.com/v1.0${itemPath}:/content?@microsoft.graph.conflictBehavior=fail`,{method:'PUT',headers:{Authorization:`Bearer ${graphToken}`,'Content-Type':'application/pdf'},body:bytes});
  if(upload.ok)item=await upload.json();
  else if(upload.status===409){
   item=await d.graph(graphToken,itemPath);
   const stored=await d.fetch(`https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(d.drive)}/items/${encodeURIComponent(item.id)}/content`,{headers:{Authorization:`Bearer ${graphToken}`}});
   if(!stored.ok||await d.pdfHash(new Uint8Array(await stored.arrayBuffer()))!==hash)throw Error('revision_pdf_conflict');
  }else throw Error(`sharepoint_upload_failed:${upload.status}`);
  if(stage.financial&&stage.originalMessageId){
   const latest=await d.graph(mailToken,`/me/messages/${encodeURIComponent(stage.originalMessageId)}?$select=isDraft`);
   if(latest.isDraft!==true){await admin.rpc('mark_finance_revision_sent',{p_id:id,p_token:token});throw Error('finance_decision_required');}
  }
  const result=await admin.rpc('finish_finance_invoice_revision',{p_id:id,p_token:token,p_expected_revision:body.revision,p_filename:filename,p_hash:hash,p_drive:d.drive,p_folder:d.folder,p_item:item.id,p_url:item.webUrl,p_mail_state:mailState});
  if(result.error)throw result.error;
  return {...result.data,documentPreserved:true};
 }catch(error){
  if(clean((error as any)?.message).startsWith('finance_decision_required'))await user.rpc('finance_revision_require_review',{p_id:id}).catch(()=>{});
  throw error;
 }finally{
  if(oldId)await admin.rpc('release_finance_dispatch',{p_account_id:oldId,p_token:token}).catch(()=>{});
 }
}
