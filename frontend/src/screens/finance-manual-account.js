import { escapeHtml as e } from './shared/html.js';
import { financeToday, financePaymentDueDate } from './finance-transaction-accounts.js';
const text=v=>String(v??'').trim();
export function manualFundingRows(data) {
  return (data.transactionContext?.billingRows||[]).filter(r=>r.activityRowId===data.manualActivityId&&r.fundingSourceId);
}
export function prepareManualAccount(data,activityId,fundingKey,basis) {
  data.manualActivityId=activityId;const rows=manualFundingRows(data);
  const row=rows.find(r=>`${r.fundingSourceId}|${r.period||r.manualMonth}`===fundingKey)||rows.find(r=>r.eligible||(!r.fullFundingBlockedReason&&Number(r.fullFundingAmount)>0))||rows[0];
  data.manualFundingKey=row?`${row.fundingSourceId}|${row.period||row.manualMonth}`:'';
  const source=(data.collectionActivities||[]).find(a=>a.row_id===activityId)||{};
  const full=(basis||(row?.eligible?'performance':'full_funding'))==='full_funding';
  const quantity=Number((full?row?.plannedCount:row?.unbilledCount)||0),amount=Number((full?row?.fullFundingAmount:row?.issuableAmount)||0);
  const days=/^(רשות|רשויות|authority|ויצו|wizo)$/i.test(text(row?.funding).replace(/["׳״\s]/g,''))?45:30;
  data.manualDraft={billing_basis:full?'full_funding':'performance',customer_name:row?.payerName||'',school_name:source.school||'',institution_symbol:row?.institutionSymbol||'',program_number:source.activity_no||'',
    description:source.activity_name||'',quantity,hours:quantity*1.5,unit_price:quantity?amount/quantity:0,amount,
    issue_date:financeToday(),payment_due_date:financePaymentDueDate(financeToday(),days),customer_email:row?.customerEmail||'',override_reason:''};
  data.manualQuote=null;data.manualPdf='';
}
export function updateManualDraft(data,key,value) {
  if(key==='billing_basis'){prepareManualAccount(data,data.manualActivityId,data.manualFundingKey,value);return;}
  data.manualDraft={...data.manualDraft,[key]:value};const d=data.manualDraft;
  if(key==='quantity'){d.hours=Number(value)*1.5;d.amount=Math.round(Number(value)*Number(d.unit_price)*100)/100;}
  if(key==='unit_price')d.amount=Math.round(Number(d.quantity)*Number(value)*100)/100;
  if(key==='amount'&&Number(d.quantity)>0)d.unit_price=Number(value)/Number(d.quantity);
  if(key==='issue_date'){
    const row=manualFundingRows(data).find(r=>`${r.fundingSourceId}|${r.period||r.manualMonth}`===data.manualFundingKey);
    const days=/^(רשות|רשויות|authority|ויצו|wizo)$/i.test(text(row?.funding).replace(/["׳״\s]/g,''))?45:30;
    d.payment_due_date=financePaymentDueDate(value,days);
  }
  data.manualQuote=null;data.manualPdf='';
}
export function manualRequest(data) {
  const [funder,month]=text(data.manualFundingKey).split('|');
  if(!data.manualActivityId||!funder||!month)throw Error('יש לבחור פעילות וגורם מימון');
  return{activity:data.manualActivityId,funder,month,draft:data.manualDraft};
}
export function manualAccountViewHtml(data) {
  const query=text(data.manualSearch).toLocaleLowerCase();
  const activities=(data.collectionActivities||[]).filter(a=>[a.row_id,a.school,a.activity_name,a.authority].join(' ').toLocaleLowerCase().includes(query));
  const source=(data.collectionActivities||[]).find(a=>a.row_id===data.manualActivityId);const d=data.manualDraft||{};const rows=manualFundingRows(data);
  const field=(label,key,type='text')=>`<label>${label}<input class="ds-input" type="${type}"${type==='number'?' min="0" step="0.01"':''} data-finance-manual-field="${key}" value="${e(d[key])}"></label>`;
  return `<div class="ds-fin-collect-toolbar"><label>חיפוש פעילות<input class="ds-input" data-finance-manual-search value="${e(data.manualSearch)}" placeholder="בית ספר, פעילות, רשות או מזהה"></label>
    <label>פעילות<select class="ds-input" data-finance-manual-activity><option value="">בחירת פעילות קיימת</option>${activities.map(a=>`<option value="${e(a.row_id)}"${a.row_id===data.manualActivityId?' selected':''}>${e(a.school)} · ${e(a.activity_name)} · ${e(a.row_id)}</option>`).join('')}</select></label></div>
    ${source?`<p>${e(source.school)} · ${e(source.activity_name)} · ${e(source.row_id)}</p>
    <label>גורם מימון וחודש<select class="ds-input" data-finance-manual-funding>${rows.map(r=>`<option value="${e(r.fundingSourceId+'|'+(r.period||r.manualMonth))}"${data.manualFundingKey===r.fundingSourceId+'|'+(r.period||r.manualMonth)?' selected':''}>${e(r.funding)} · ${e((r.period||r.manualMonth)?.slice(0,7)||'ללא חודש')} · ${Number((r.eligible?r.issuableAmount:r.fullFundingAmount)||0).toFixed(2)} ₪${r.fullFundingBlockedReason?' · '+e(r.fullFundingBlockedReason):''}</option>`).join('')}</select></label>
    <label>בסיס החיוב<select class="ds-input" data-finance-manual-field="billing_basis"><option value="performance"${d.billing_basis==='performance'?' selected':''}>מפגשים שבוצעו</option><option value="full_funding"${d.billing_basis==='full_funding'?' selected':''}>מלוא חלק המממן</option></select></label><form data-finance-manual-form><div class="ds-fin-collect-toolbar">${field('גורם משלם','customer_name')}${field('בית ספר','school_name')}${field('סמל מוסד / מספר לקוח','institution_symbol')}${field('מספר תוכנית','program_number')}
    ${field('תיאור השירות','description')}${field('מפגשים לחיוב','quantity','number')}${field('שעות לחיוב','hours','number')}${field('מחיר למפגש','unit_price','number')}${field('סכום החשבון','amount','number')}
    ${field('תאריך הפקה','issue_date','date')}${field('מועד תשלום','payment_due_date','date')}${field('דוא״ל נמען','customer_email','email')}${field('סיבת חריגה','override_reason')}
    <button class="ds-btn ds-btn--primary" type="button" data-finance-manual-preview>תצוגה מקדימה</button></div></form>
    ${data.manualPdf?`<iframe title="תצוגה מקדימה של חשבון העסקה" src="data:application/pdf;base64,${e(data.manualPdf)}" style="width:100%;height:650px;border:0"></iframe>
      <button class="ds-btn ds-btn--primary" data-finance-manual-confirm>אישור והפקת חשבון</button>`:''}`:''}`;
}
export async function runManualAccount(data,api) {
  if(!data.manualQuote?.revision)throw Error('יש לפתוח תצוגה מקדימה עדכנית');
  const account=await api.reserveFinanceManualAccount({...manualRequest(data),revision:data.manualQuote.revision,idempotencyKey:data.manualRequestId||crypto.randomUUID()});
  try{return await api.dispatchFinanceTransactionAccount({accountId:account.id});}
  catch(error){await api.cancelFinanceTransactionReservation?.(account.id).catch(()=>{});data.manualRequestId=crypto.randomUUID();throw error;}
}
