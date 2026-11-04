import {escapeHtml as e} from './shared/html.js';
import {formatManualMoney,normalizeManualRecipientEmails,manualPdfReviewHtml,syncManualPdfPreviewDom,activateManualPdfPreview} from './finance-manual-account.js';
const text=v=>String(v??'').trim();
const labels={customer_name_snapshot:'שם הלקוח',customer_email_snapshot:'נמענים',school_name_snapshot:'בית הספר',service_description_snapshot:'תיאור הפעילות',issue_date:'תאריך הפקה',payment_due_date:'מועד תשלום',activity_price_snapshot:'מחיר הפעילות',quantity_snapshot:'מספר מפגשים / כמות',billed_hours:'שעות',amount:'סכום לחיוב'};
const status=s=>({pending_admin:'ממתין לאישור אדמין',approved:'מוכן לתצוגה מקדימה',rendering:'ממתין להשלמת ההפקה',applied:'התיקון נשמר',rejected:'הבקשה נדחתה או בוטלה',finance_review_required:'אושר באדמין · נדרשת החלטת כספים נפרדת'})[s]||s;
const active=r=>['pending_admin','approved','rendering','finance_review_required'].includes(r.status);
export function invoiceRevisionDraft(account){return {customer_name_snapshot:account.customer_name_snapshot,customer_email_snapshot:normalizeManualRecipientEmails(account.customer_email_snapshot),issue_date:account.issue_date,payment_due_date:account.payment_due_date,
 lines:(account.finance_transaction_account_lines||[]).map(l=>({id:l.id,school_name_snapshot:l.school_name_snapshot||'',service_description_snapshot:l.service_description_snapshot||l.activity_name_snapshot,
 activity_price_snapshot:Number(l.activity_price_snapshot),quantity_snapshot:Number(l.quantity_snapshot??l.finance_transaction_account_meetings?.length??0),billed_hours:Number(l.billed_hours),amount:Number(l.amount)}))};}
export function revisionIsFinancial(original,draft){const old=invoiceRevisionDraft(original);return draft.lines.some(l=>{const prior=old.lines.find(x=>x.id===l.id);return !prior||['activity_price_snapshot','quantity_snapshot','billed_hours','amount'].some(k=>Number(l[k])!==Number(prior[k]));});}
export function editInvoiceRevision(data,key,value,lineId){
 const d=data.invoiceRevisionDraft;if(!d)return;
 if(lineId){const l=d.lines.find(x=>x.id===lineId);if(!l)return;
  l[key]=['activity_price_snapshot','quantity_snapshot','billed_hours','amount'].includes(key)?Number(value):value;
  const old=data.invoiceRevisionContext.account.finance_transaction_account_lines.find(x=>x.id===lineId);
  const service=Number(old.billed_hours)===0;
  if(!service&&key==='quantity_snapshot')l.billed_hours=l.quantity_snapshot*1.5;
  if(!service&&key==='billed_hours'&&Number.isInteger(l.billed_hours/1.5))l.quantity_snapshot=l.billed_hours/1.5;
  if(['activity_price_snapshot','quantity_snapshot','billed_hours'].includes(key)){
   const factor=l.activity_price_snapshot/Number(old.activity_price_snapshot);
   l.amount=Math.round((old.billing_coverage==='full_funding'?Number(old.amount)*factor:service?Number(old.unit_price_snapshot)*l.quantity_snapshot*factor:Number(old.funding_amount_snapshot)*factor*l.billed_hours/(Number(old.planned_meeting_count_snapshot)*1.5))*100)/100;
  }
 }else d[key]=key==='customer_email_snapshot'?normalizeManualRecipientEmails(value):value;
 data.invoiceRevisionPreview=null;
}
export function invoiceRevisionAdminHtml(data){
 if(!data.financeAdmin)return '';
 const requests=data.invoiceRevisionAdminRequests||[];
 return `<details class="ds-fin-payer"><summary>בקשות לתיקון כספי (${requests.length})</summary>${requests.length?requests.map(r=>`<details class="ds-fin-payer"><summary>חשבון ${e(r.before_snapshot?.transaction_account_number)} · ${e(r.requested_name)} · ${e(status(r.status))}</summary>
 <table class="ds-table"><thead><tr><th>שדה</th><th>לפני</th><th>אחרי</th></tr></thead><tbody>${(r.changes||[]).map(c=>`<tr><td>${e(labels[c.field]||c.field)}${c.line?` · ${e(r.before_snapshot?.finance_transaction_account_lines?.find(l=>l.id===c.line)?.activity_name_snapshot||'')}`:''}</td><td>${e(c.before)}</td><td>${e(c.after)}</td></tr>`).join('')}</tbody></table>
 ${r.status==='pending_admin'?`<label>הערה להחלטה<input class="ds-input" data-invoice-revision-reason="${e(r.id)}"></label><button class="ds-btn ds-btn--primary" data-invoice-revision-approve="${e(r.id)}">אישור</button> <button class="ds-btn" data-invoice-revision-reject="${e(r.id)}">דחייה</button>`:'<p>אין לבצע ביטול או שינוי אוטומטי. נדרשת החלטת כספים נפרדת.</p>'}
 <button class="ds-btn ds-btn--ghost" data-invoice-revision-open="${e(r.account_id)}">פתיחת החשבון</button></details>`).join(''):'<p>אין בקשות ממתינות.</p>'}</details>`;
}
export function invoiceRevisionApprovalHtml(data){
 if(!data.financeAdmin||!data.invoiceRevisionContext||!data.invoiceRevisionDraft||active(data.invoiceRevisionRequest||{})||!revisionIsFinancial(data.invoiceRevisionContext.account,data.invoiceRevisionDraft))return '';
 const before=invoiceRevisionDraft(data.invoiceRevisionContext.account),after=data.invoiceRevisionDraft,changes=[];
 for(const k of ['customer_name_snapshot','customer_email_snapshot','issue_date','payment_due_date'])if(text(before[k])!==text(after[k]))changes.push({key:k,old:before[k],next:after[k]});
 for(const l of after.lines){const old=before.lines.find(x=>x.id===l.id);for(const k of Object.keys(labels).filter(k=>k in l))if(text(old[k])!==text(l[k]))changes.push({key:k,old:old[k],next:l[k]});}
 return `<table class="ds-table"><thead><tr><th>שינוי לאישור</th><th>לפני</th><th>אחרי</th></tr></thead><tbody>${changes.map(c=>`<tr><td>${e(labels[c.key])}</td><td>${e(c.old)}</td><td>${e(c.next)}</td></tr>`).join('')}</tbody></table><p>לאחר האישור ושמירת המסמך יופק חשבון חלופי המקושר לחשבון המקורי שיבוטל.</p>`;
}
export function invoiceRevisionEditorHtml(data){
 const c=data.invoiceRevisionContext,d=data.invoiceRevisionDraft;if(!c||!d)return data.invoiceRevisionMessage?`<p role="status">${e(data.invoiceRevisionMessage)}</p>`:'';
 const r=data.invoiceRevisionRequest,locked=Boolean(r&&active(r)),cancelled=c.account.document_status==='cancelled',financial=revisionIsFinancial(c.account,d),preview=data.invoiceRevisionPreview;
 const field=(key,value,lineId='',type='text')=>`<label>${e(labels[key])}<input class="ds-input" type="${type}"${key==='customer_email_snapshot'?' multiple dir="ltr"':''}${locked||cancelled||(['issue_date','payment_due_date'].includes(key)&&!data.financeAdmin)?' readonly':''} data-invoice-revision-field="${key}"${lineId?` data-line-id="${e(lineId)}"`:''} value="${e(value)}"${type==='number'?' min="0" step="any"':''}></label>`;
 return `<section class="ds-fin-manual" dir="rtl" data-invoice-revision-editor><h3>עריכה והפקה מחדש · חשבון ${e(c.account.transaction_account_number)}</h3>
 <p>משלם: ${e(c.account.payer_identity_snapshot||c.account.customer_name_snapshot)} · מוסד ${e(c.account.institution_symbol||'—')}</p>
 ${data.invoiceRevisionMessage?`<p role="status">${e(data.invoiceRevisionMessage)}</p>`:''}
 ${r?`<p role="status">${e(status(r.status))}</p>`:''}
 ${financial&&!locked&&!cancelled?'<p>תיקון כספי יוביל לחשבון חלופי המקושר לחשבון המקורי שיבוטל, לאחר אישור ושמירת המסמך.</p>':''}
 <form data-invoice-revision-form><div class="ds-fin-manual__grid">${field('customer_name_snapshot',d.customer_name_snapshot)}${field('customer_email_snapshot',d.customer_email_snapshot,'','email')}${field('issue_date',d.issue_date,'','date')}${field('payment_due_date',d.payment_due_date,'','date')}</div>
 ${d.lines.map(l=>{const old=c.account.finance_transaction_account_lines.find(x=>x.id===l.id);return `<details class="ds-fin-payer"><summary data-invoice-revision-line-summary="${e(l.id)}">${e(old.activity_name_snapshot)} · ${formatManualMoney(l.amount)} ₪</summary><div class="ds-fin-manual__grid">${field('school_name_snapshot',l.school_name_snapshot,l.id)}${field('service_description_snapshot',l.service_description_snapshot,l.id)}</div>
 <div class="ds-fin-manual__grid">${field('activity_price_snapshot',l.activity_price_snapshot,l.id,'number')}${field('quantity_snapshot',l.quantity_snapshot,l.id,'number')}${Number(old.billed_hours)>0?field('billed_hours',l.billed_hours,l.id,'number'):''}${field('amount',l.amount,l.id,'number')}</div>
 ${Number(l.billed_hours)>0?`<small data-invoice-revision-hourly="${e(l.id)}">מחיר שעתי מחושב: ${formatManualMoney(Number(old.funding_amount_snapshot)/Number(old.activity_price_snapshot)*l.activity_price_snapshot/(Number(old.planned_meeting_count_snapshot)*1.5))} ₪</small>`:''}</details>`;}).join('')}
 <div data-invoice-revision-approval-summary>${invoiceRevisionApprovalHtml(data)}</div>
 ${!cancelled&&(!locked||['approved','rendering'].includes(r?.status))?`<button class="ds-btn ds-btn--primary" type="button" data-invoice-revision-preview>${!locked&&financial?(data.financeAdmin?'אישור השינוי הכספי ותצוגה מקדימה':'בקשת אישור אדמין'):'תצוגה מקדימה'}</button>`:''}
 ${locked?'<button class="ds-btn" type="button" data-invoice-revision-withdraw>ביטול הבקשה</button>':''}
 <button class="ds-btn ds-btn--ghost" type="button" data-invoice-revision-close>סגירה</button></form>
 ${preview?manualPdfReviewHtml({key:'single',title:preview.quote.revision_financial?'תצוגה מקדימה של החשבון החלופי':'תצוגה מקדימה של החשבון המתוקן',detail:`${formatManualMoney(preview.quote.total_amount)} ₪`,confirmLabel:preview.quote.revision_financial?'אישור ושמירת החשבון החלופי':'אישור ושמירת המסמך המתוקן'}).replaceAll('data-finance-manual-','data-invoice-revision-'):''}
 <details class="ds-fin-payer"><summary>גרסאות ובקשות קודמות</summary>${(c.versions||[]).map(v=>`<p>גרסה ${e(v.version)} · ${e(v.actor_name||'')} · ${e(new Date(v.created_at).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'}))} · <a href="${e(v.snapshot.sharepoint_web_url)}" target="_blank" rel="noopener">פתיחת PDF</a>${!locked&&!cancelled&&v.version<Number(c.account.document_revision||0)?` · <button class="ds-btn ds-btn--ghost" type="button" data-invoice-revision-restore="${e(v.version)}">שחזור פרטי הגרסה</button>`:''}</p>`).join('')}
 ${(c.requests||[]).map(x=>`<p>${e(status(x.status))} · ${e(x.requested_name)} · ${e(new Date(x.requested_at).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'}))}${x.decided_name?' · החלטת אדמין: '+e(x.decided_name):''}</p>`).join('')}
 ${(c.events||[]).map(x=>`<p>${e(({invoice_revision_requested:'נפתח תיקון',invoice_revision_approved:'אושר שינוי כספי',invoice_revision_rejected:'נדחתה בקשת תיקון',invoice_revision_applied:'נשמר חשבון מתוקן',invoice_revision_withdrawn:'בוטלה בקשת תיקון'})[x.type]||'עודכן התיקון')} · ${e(x.actor)} · ${e(new Date(x.at).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'}))}</p>`).join('')}</details></section>`;
}
const friendly=error=>{const s=text(error?.message||error);return s.includes('invoice_revision_one_open')?'לחשבון כבר קיימת בקשת תיקון פתוחה. יש לפתוח אותו מחדש להמשך הטיפול.':s.includes('invoice_revision_no_changes')?'לא נמצאו שינויים לשמירה.':s.includes('finance_decision_required')?'נדרשת החלטת כספים נפרדת. החשבון המקורי נשאר ללא שינוי.':s.includes('invoice_revision_stale')?'נתוני החשבון השתנו. יש לפתוח אותו מחדש ולבדוק את התיקון.':s.includes('revision_price_exceeds_contract')?'המחיר המבוקש חורג ממסגרת ההתקשרות.':s.includes('revision_contract_change')?'שינוי המחיר מחייב עדכון מבוקר של ההתקשרות וחלוקת המימון.':s.includes('revision_payer_identity_changed')?'זהות המשלם או פרטי המוסד השתנו במערכת. נדרשת בדיקת כספים.':s.includes('revision_billing_')?'הסכום, השעות או המפגשים אינם תואמים ליתרה ולכללי החיוב.':s.includes('invoice_original_issuer_required')?'להשלמת התיקון נדרש חיבור Microsoft של המפיק המקורי.':s.includes('revision_not_approved')?'התיקון ממתין לאישור אדמין.':s.includes('dispatch_')?'החשבון נמצא כעת בהפקה. יש לנסות שוב לאחר סיום הפעולה.':'לא ניתן להשלים את התיקון כרגע. החשבון והמסמכים הקיימים נשמרו.';};
export function bindInvoiceRevisions({root,data,api,refresh,reload}){
 root._invoiceRevisionUnbind?.();
 const paint=()=>{refresh();if(data.invoiceRevisionPreview)syncManualPdfPreviewDom(root,{manualPdf:data.invoiceRevisionPreview.pdfBase64,manualQuote:data.invoiceRevisionPreview.quote});};
 const loadAdmin=async()=>{if(data.financeAdmin&&api.financeInvoiceRevisionContext){const result=await api.financeInvoiceRevisionContext(null);data.invoiceRevisionAdminRequests=result.requests||[];}};
 const open=async id=>{const c=await api.financeInvoiceRevisionContext(id);data.invoiceRevisionContext=c;data.invoiceRevisionRequest=(c.requests||[]).find(active)||null;data.invoiceRevisionDraft=data.invoiceRevisionRequest?structuredClone(data.invoiceRevisionRequest.proposed):invoiceRevisionDraft(c.account);data.invoiceRevisionPreview=null;data.invoiceRevisionMessage='';};
 const click=async ev=>{
  const target=ev.target.closest('[data-invoice-revision-open],[data-invoice-revision-restore],[data-invoice-revision-preview],[data-invoice-revision-approve],[data-invoice-revision-reject],[data-invoice-revision-close],[data-invoice-revision-withdraw],[data-invoice-revision-confirm],[data-invoice-revision-pdf-open],[data-invoice-revision-pdf-download]');if(!target)return;
  ev.preventDefault();if(data.invoiceRevisionBusy)return;
  if(target.hasAttribute('data-invoice-revision-pdf-open')||target.hasAttribute('data-invoice-revision-pdf-download')){activateManualPdfPreview(root,'single',target.hasAttribute('data-invoice-revision-pdf-open')?'open':'download');return;}
  data.invoiceRevisionBusy=true;target.disabled=true;root.querySelector('[data-invoice-revision-form]')?.setAttribute('inert','');
  try{
   if(target.dataset.invoiceRevisionOpen)await open(target.dataset.invoiceRevisionOpen);
   else if(target.hasAttribute('data-invoice-revision-restore')){const v=data.invoiceRevisionContext.versions.find(x=>x.version===Number(target.dataset.invoiceRevisionRestore));if(!v||active(data.invoiceRevisionRequest||{}))throw Error('invoice_version_not_found');data.invoiceRevisionDraft=invoiceRevisionDraft(v.snapshot);if(!data.financeAdmin){data.invoiceRevisionDraft.issue_date=data.invoiceRevisionContext.account.issue_date;data.invoiceRevisionDraft.payment_due_date=data.invoiceRevisionContext.account.payment_due_date;}data.invoiceRevisionPreview=null;data.invoiceRevisionMessage='פרטי הגרסה נטענו. יש לבדוק בתצוגה מקדימה לפני השמירה.';}
   else if(target.hasAttribute('data-invoice-revision-close')){data.invoiceRevisionContext=null;data.invoiceRevisionDraft=null;data.invoiceRevisionPreview=null;data.invoiceRevisionMessage='';}
   else if(target.dataset.invoiceRevisionApprove||target.dataset.invoiceRevisionReject){const id=target.dataset.invoiceRevisionApprove||target.dataset.invoiceRevisionReject,reason=root.querySelector(`[data-invoice-revision-reason="${id}"]`)?.value||'';await api.decideFinanceInvoiceRevision(id,Boolean(target.dataset.invoiceRevisionApprove),reason);await loadAdmin();if(data.invoiceRevisionContext)await open(data.invoiceRevisionContext.account.id);}
   else if(target.hasAttribute('data-invoice-revision-withdraw')){await api.withdrawFinanceInvoiceRevision(data.invoiceRevisionRequest.id);await open(data.invoiceRevisionContext.account.id);await loadAdmin();}
   else if(target.hasAttribute('data-invoice-revision-preview')){
    if(!root.querySelector('[data-invoice-revision-form]')?.reportValidity())return;
    if(!data.invoiceRevisionRequest){data.invoiceRevisionRequest=await api.requestFinanceInvoiceRevision({accountId:data.invoiceRevisionContext.account.id,key:crypto.randomUUID(),baseHash:data.invoiceRevisionContext.baseHash,proposed:data.invoiceRevisionDraft,adminApproveFinancial:data.financeAdmin&&revisionIsFinancial(data.invoiceRevisionContext.account,data.invoiceRevisionDraft)});}
    if(data.invoiceRevisionRequest.status==='pending_admin'){data.invoiceRevisionMessage='הבקשה נשמרה וממתינה לאישור אדמין. החשבון המקורי לא השתנה.';await loadAdmin();}
    else if(data.invoiceRevisionRequest.status==='finance_review_required'){data.invoiceRevisionMessage='השינוי אושר באדמין, אך החשבון מחייב החלטת כספים נפרדת לפני ביטול והפקת חשבון חלופי.';await loadAdmin();}
    else data.invoiceRevisionPreview=await api.previewFinanceInvoiceRevision(data.invoiceRevisionRequest.id);
   }else if(target.hasAttribute('data-invoice-revision-confirm')){
    const r=await api.applyFinanceInvoiceRevision(data.invoiceRevisionRequest.id,data.invoiceRevisionPreview.quote.revision);data.invoiceRevisionPreview=null;
    await reload();await open(r.accountId);data.invoiceRevisionMessage=r.outlookStatus==='already_sent'?'המסמך תוקן. ההודעה כבר נשלחה ונדרשת החלטה על שליחה מחדש.':r.outlookStatus==='draft_ready'?'התיקון נשמר וטיוטת Outlook עודכנה.':r.outlookStatus==='missing_recipient'?'התיקון נשמר. יש לתקן את הנמענים לפני עדכון טיוטת Outlook.':['needs_review','failed'].includes(r.outlookStatus)?'התיקון נשמר. עדכון טיוטת Outlook דורש בדיקה.':'התיקון נשמר. עדכון טיוטת Outlook יושלם בחיבור המפיק המקורי.';await loadAdmin();
   }
  }catch(error){
   if(text(error?.message).includes('finance_decision_required')&&data.invoiceRevisionContext){const id=data.invoiceRevisionContext.account.id;await open(id).catch(()=>{});await loadAdmin().catch(()=>{});}
   data.invoiceRevisionMessage=friendly(error);
  }
  finally{data.invoiceRevisionBusy=false;paint();}
 };
 const change=ev=>{
  const f=ev.target.closest('[data-invoice-revision-field]');if(!f||f.readOnly||data.invoiceRevisionBusy)return;
  editInvoiceRevision(data,f.dataset.invoiceRevisionField,f.value,f.dataset.lineId);
  for(const input of root.querySelectorAll('[data-invoice-revision-field]')){
   const item=input.dataset.lineId?data.invoiceRevisionDraft.lines.find(l=>l.id===input.dataset.lineId):data.invoiceRevisionDraft;
   input.value=item[input.dataset.invoiceRevisionField];
  }
  const comparison=root.querySelector('[data-invoice-revision-approval-summary]');if(comparison)comparison.innerHTML=invoiceRevisionApprovalHtml(data);
  const submit=root.querySelector('[data-invoice-revision-preview]');
  if(submit)submit.textContent=revisionIsFinancial(data.invoiceRevisionContext.account,data.invoiceRevisionDraft)?(data.financeAdmin?'אישור השינוי הכספי ותצוגה מקדימה':'בקשת אישור אדמין'):'תצוגה מקדימה';
  for(const line of data.invoiceRevisionDraft.lines){
   const old=data.invoiceRevisionContext.account.finance_transaction_account_lines.find(x=>x.id===line.id);
   const summary=root.querySelector(`[data-invoice-revision-line-summary="${line.id}"]`);if(summary)summary.textContent=`${old.activity_name_snapshot} · ${formatManualMoney(line.amount)} ₪`;
   const hourly=root.querySelector(`[data-invoice-revision-hourly="${line.id}"]`);if(hourly)hourly.textContent=`מחיר שעתי מחושב: ${formatManualMoney(Number(old.funding_amount_snapshot)/Number(old.activity_price_snapshot)*line.activity_price_snapshot/(Number(old.planned_meeting_count_snapshot)*1.5))} ₪`;
  }
 };
 root.addEventListener('click',click);root.addEventListener('change',change);root._invoiceRevisionUnbind=()=>{root.removeEventListener('click',click);root.removeEventListener('change',change);};
 if(data.financeAdmin&&data.transactionTab==='history'&&!data.invoiceRevisionAdminLoaded&&api.financeInvoiceRevisionContext){data.invoiceRevisionAdminLoaded=true;void loadAdmin().then(paint).catch(()=>{data.invoiceRevisionAdminLoaded=false;});}
 if(data.invoiceRevisionPreview)syncManualPdfPreviewDom(root,{manualPdf:data.invoiceRevisionPreview.pdfBase64,manualQuote:data.invoiceRevisionPreview.quote});
}
