import { escapeHtml as e } from './shared/html.js';
import { financeToday, financePaymentDueDate } from './finance-transaction-accounts.js';
const text=v=>String(v??'').trim();
// Display grouped amounts without changing the values sent to the billing RPC.
export function formatManualMoney(value, { unitPrice = false } = {}) {
  if (value === '' || value == null) return '';
  const amount = Number(String(value).replace(/,/g, ''));
  if (!Number.isFinite(amount)) return text(value);
  return amount.toLocaleString('en-US', {
    useGrouping: true,
    minimumFractionDigits: 2,
    maximumFractionDigits: unitPrice ? 14 : 2
  });
}
export function parseManualMoney(value) {
  const raw = text(value);
  if (!/^(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:[.][0-9]+)?$/.test(raw)) return NaN;
  return Number(raw.replace(/,/g, ''));
}
export function manualFundingRows(data) {
  return (data.transactionContext?.billingRows||[]).filter(r=>r.activityRowId===data.manualActivityId&&r.fundingSourceId);
}

// Filter by the *actual funder*, not by the school. Each local authority remains distinct.
const normalizedFunder = (value) => text(value).replace(/[״׳"']/g, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('he');
const isGenericAuthority = (value) => /^(?:רשות|רשויות|authority)$/i.test(normalizedFunder(value));
export function manualActivityFunders(data, activity) {
  const rows = (data.transactionContext?.billingRows || []).filter(row => row.activityRowId === activity.row_id);
  const assigned = rows.filter(row => row.fundingSourceId);
  const names = (assigned.length ? assigned.map(row => row.funding) : text(activity.funding).split(/\s*\+\s*/))
    .map(text).filter(Boolean);
  if (!names.length) return [{ key: 'unassigned', label: 'ללא גורם מימון' }];
  const funders = new Map();
  for (const name of names) {
    const row = rows.find(item => normalizedFunder(item.funding) === normalizedFunder(name));
    const authority = text(activity.authority || row?.payerName);
    const key = isGenericAuthority(name)
      ? 'authority:' + (text(activity.authority_id || row?.authorityId) || 'name:' + normalizedFunder(authority))
      : 'funder:' + normalizedFunder(name);
    const label = isGenericAuthority(name) ? (authority ? 'רשות - ' + authority : 'רשות לא מזוהה') : name;
    if (!funders.has(key)) funders.set(key, { key, label });
  }
  return [...funders.values()];
}
export function manualFundingFilterOptions(data) {
  const funders = new Map();
  for (const activity of data.collectionActivities || []) {
    for (const funder of manualActivityFunders(data, activity)) {
      if (!funders.has(funder.key)) funders.set(funder.key, funder);
    }
  }
  return [...funders.values()].sort((a,b) => a.label.localeCompare(b.label, 'he'));
}
export function manualFilteredActivities(data) {
  const query = text(data.manualSearch).toLocaleLowerCase();
  const fundingKey = text(data.manualFunderFilter);
  return (data.collectionActivities || [])
    .filter(activity => !fundingKey || manualActivityFunders(data, activity).some(funder => funder.key === fundingKey))
    .filter(activity => [activity.row_id, activity.school, activity.activity_name, activity.authority].join(' ').toLocaleLowerCase().includes(query))
    .sort((a,b) => [a.school,a.authority,a.activity_name].join(' ').localeCompare([b.school,b.authority,b.activity_name].join(' '),'he'));
}
export function manualFundingRowsForSelection(data) {
  const rows = manualFundingRows(data);
  if (!data.manualFunderFilter) return rows;
  const source = (data.collectionActivities || []).find(a => a.row_id === data.manualActivityId);
  if (!source) return [];
  return rows.filter(row =>
    manualActivityFunders({ transactionContext: { billingRows: [row] } }, source)
      .some(funder => funder.key === data.manualFunderFilter));
}
export function prepareManualAccount(data,activityId,fundingKey,basis) {
  data.manualActivityId=activityId;const rows=manualFundingRows(data);
  const source=(data.collectionActivities||[]).find(a=>a.row_id===activityId)||{};
  const filteredRows=manualFundingRowsForSelection(data);
  const row=filteredRows.find(r=>`${r.fundingSourceId}|${r.period||r.manualMonth}`===fundingKey)||filteredRows.find(r=>r.eligible||(!r.fullFundingBlockedReason&&Number(r.fullFundingAmount)>0))||filteredRows[0];
  data.manualFundingKey=row?`${row.fundingSourceId}|${row.period||row.manualMonth}`:'';
  const full=(basis||(row?.eligible?'performance':'full_funding'))==='full_funding';
  const quantity=Number((full?row?.plannedCount:row?.unbilledCount)||0),amount=Number((full?row?.fullFundingAmount:row?.issuableAmount)||0);
  const days=/^(רשות|רשויות|authority|ויצו|wizo)$/i.test(text(row?.funding).replace(/["׳״\s]/g,''))?45:30;
  data.manualDraft={billing_basis:full?'full_funding':'performance',customer_name:row?.payerName||'',school_name:source.school||'',institution_symbol:row?.gefenFunding?(row?.institutionSymbol||''):'',program_number:source.activity_no||'',
    description:source.activity_name||'',quantity,hours:quantity*1.5,unit_price:quantity?amount/quantity:0,amount,
    issue_date:financeToday(),payment_due_date:financePaymentDueDate(financeToday(),days),customer_email:row?.customerEmail||'',override_reason:''};
  data.manualQuote=null;data.manualPdf='';data.manualConsolidatedPreview=null;
}
// Each selected activity keeps its own edited invoice; multi-select never combines unrelated payers.
export function selectedManualActivityIds(data) {
  const ids = Array.isArray(data.manualSelectedActivityIds) ? data.manualSelectedActivityIds : [];
  return [...new Set([...ids, ...(data.manualActivityId ? [data.manualActivityId] : [])])];
}
export function saveActiveManualDraft(data) {
  if (!data.manualActivityId || !data.manualDraft) return;
  data.manualActivityDrafts ||= {};
  data.manualActivityDrafts[data.manualActivityId] = {
    draft: { ...data.manualDraft }, fundingKey: data.manualFundingKey
  };
}
export function focusManualActivity(data, activityId) {
  saveActiveManualDraft(data);
  if (!activityId) {
    data.manualActivityId = ''; data.manualDraft = null; data.manualFundingKey = '';
  } else {
    const cached = data.manualActivityDrafts?.[activityId];
    if (cached) {
      data.manualActivityId = activityId;
      data.manualDraft = { ...cached.draft };
      data.manualFundingKey = cached.fundingKey;
    } else {
      prepareManualAccount(data, activityId);
      saveActiveManualDraft(data);
    }
  }
  data.manualQuote = null; data.manualPdf = ''; data.manualBatchPreviews = null; data.manualConsolidatedPreview = null;
}
export function toggleManualActivity(data, activityId, checked) {
  const ids = selectedManualActivityIds(data).filter(id => id !== activityId);
  if (checked) ids.push(activityId);
  data.manualSelectedActivityIds = ids;
  if (!checked && data.manualActivityDrafts) delete data.manualActivityDrafts[activityId];
  if (checked || !ids.includes(data.manualActivityId)) focusManualActivity(data, checked ? activityId : ids[0] || '');
  else { data.manualBatchPreviews = null; data.manualConsolidatedPreview = null; data.manualQuote = null; data.manualPdf = ''; }
}
export function manualSelectionSnapshot(data, activityId) {
  const item = data.manualActivityDrafts?.[activityId];
  if (!item) throw new Error('יש לבחור פרטי חיוב לכל פעילות שנבחרה');
  const scoped = { ...data, manualActivityId: activityId, manualFundingKey: item.fundingKey, manualDraft: { ...item.draft } };
  const allowed = manualFundingRowsForSelection(scoped).some(r =>
    `${r.fundingSourceId}|${r.period || r.manualMonth}` === item.fundingKey);
  if (!allowed) throw new Error('גורם המימון שנבחר אינו מתאים לאחת הפעילויות');
  return manualRequest(scoped);
}
export async function previewSelectedManualAccounts(data, api) {
  saveActiveManualDraft(data);
  const ids = selectedManualActivityIds(data);
  if (!ids.length) throw new Error('יש לבחור פעילות');
  if (ids.length > 1 && !data.manualFunderFilter) throw new Error('להפקה של כמה פעילויות יש לבחור גורם מימון');
  if (ids.length > 1) {
    // One financer, one document, regardless of the number of funded schools.
    // The backend checks the payer identity and each individual funding allocation.
    const items = ids.map(id => manualSelectionSnapshot(data, id));
    const output = await api.previewFinanceFunderBatchAccount(items);
    if (!output?.quote?.revision || !output?.pdfBase64)
      throw new Error('לא התקבלה תצוגה מקדימה תקינה לחשבון המרוכז');
    data.manualConsolidatedPreview = {
      items, quote: output.quote, pdfBase64: output.pdfBase64,
      idempotencyKey: crypto.randomUUID()
    };
    data.manualBatchPreviews = null;
    data.manualQuote = null;
    data.manualPdf = '';
    return [data.manualConsolidatedPreview];
  }
  data.manualConsolidatedPreview = null;
  const previews = [];
  for (const id of ids) {
    const request = manualSelectionSnapshot(data,id);
    const output = await api.previewFinanceManualAccount(request);
    if (!output?.quote?.revision || !output?.pdfBase64) throw new Error('לא התקבלה תצוגה מקדימה תקינה');
    previews.push({ activityId:id, request, quote:output.quote, pdfBase64:output.pdfBase64,
      idempotencyKey:crypto.randomUUID() });
  }
  data.manualBatchPreviews = previews.length > 1 ? previews : null;
  if (previews.length === 1) {
    data.manualQuote=previews[0].quote;data.manualPdf=previews[0].pdfBase64;
    data.manualRequestId=previews[0].idempotencyKey;
  }
  return previews;
}
export async function runSelectedManualAccounts(data, api) {
  const consolidated = data.manualConsolidatedPreview;
  if (consolidated) {
    if (consolidated.items.length !== selectedManualActivityIds(data).length)
      throw new Error('יש לחדש את התצוגה המקדימה של החשבון המרוכז');
    const reserved = await api.reserveFinanceFunderBatchAccount({
      items: consolidated.items,
      revision: consolidated.quote.revision,
      idempotencyKey: consolidated.idempotencyKey
    });
    let sent;
    try {
      sent = await api.dispatchFinanceTransactionAccount({ accountId: reserved.id });
    } catch (error) {
      await api.cancelFinanceTransactionReservation?.(reserved.id).catch(() => {});
      throw error;
    }
    return [{ reserved, sent }];
  }
  const previews = data.manualBatchPreviews;
  if (!Array.isArray(previews) || previews.length < 2) return [await runManualAccount(data,api)];
  if (previews.length !== selectedManualActivityIds(data).length) throw new Error('יש לחדש תצוגה מקדימה');
  data.manualBatchIssued ||= {};
  const issued = [];
  for (const p of previews) {
    if (data.manualBatchIssued[p.idempotencyKey]) { issued.push(data.manualBatchIssued[p.idempotencyKey]); continue; }
    try {
      const reserved = await api.reserveFinanceManualAccount({
        ...p.request, revision:p.quote.revision,idempotencyKey:p.idempotencyKey
      });
      let sent;
      try { sent = await api.dispatchFinanceTransactionAccount({ accountId:reserved.id }); }
      catch(error) { await api.cancelFinanceTransactionReservation?.(reserved.id).catch(()=>{});throw error; }
      const result = { reserved, sent };
      data.manualBatchIssued[p.idempotencyKey] = result;
      issued.push(result);
    } catch(error) {
      throw new Error(`הופקו ${issued.length} מתוך ${previews.length} חשבונות. ${error.message || 'ההפקה נעצרה'}`);
    }
  }
  return issued;
}
export function updateManualDraft(data,key,value) {
  if(key==='billing_basis'){prepareManualAccount(data,data.manualActivityId,data.manualFundingKey,value);return;}
  const safeValue = key === 'amount' || key === 'unit_price' ? parseManualMoney(value) : value;
  if ((key === 'amount' || key === 'unit_price') && !Number.isFinite(safeValue)) return false;
  data.manualDraft={...data.manualDraft,[key]:safeValue};const d=data.manualDraft;
  if(key==='quantity'){d.hours=Number(value)*1.5;d.amount=Math.round(Number(value)*Number(d.unit_price)*100)/100;}
  if(key==='unit_price')d.amount=Math.round(Number(d.quantity)*Number(safeValue)*100)/100;
  if(key==='amount'&&Number(d.quantity)>0)d.unit_price=Number(safeValue)/Number(d.quantity);
  if(key==='issue_date'){
    const row=manualFundingRows(data).find(r=>`${r.fundingSourceId}|${r.period||r.manualMonth}`===data.manualFundingKey);
    const days=/^(רשות|רשויות|authority|ויצו|wizo)$/i.test(text(row?.funding).replace(/["׳״\s]/g,''))?45:30;
    d.payment_due_date=financePaymentDueDate(value,days);
  }
  data.manualQuote=null;data.manualPdf='';data.manualBatchPreviews=null;data.manualConsolidatedPreview=null;
}
export function manualRequest(data) {
  const [funder,month]=text(data.manualFundingKey).split('|');
  if(!data.manualActivityId||!funder||!month)throw Error('יש לבחור פעילות וגורם מימון');
  return{activity:data.manualActivityId,funder,month,draft:data.manualDraft};
}
export function manualAccountViewHtml(data) {
  const activities=manualFilteredActivities(data);
  const funderOptions=manualFundingFilterOptions(data);
  const source=(data.collectionActivities||[]).find(a=>a.row_id===data.manualActivityId);const d=data.manualDraft||{};const rows=manualFundingRowsForSelection(data);
  const field=(label,key,type='text')=>{
    const money = key === 'amount' || key === 'unit_price';
    const display = money ? formatManualMoney(d[key], { unitPrice: key === 'unit_price' }) : d[key];
    const attributes = money
      ? ' inputmode="decimal" dir="ltr" pattern="[0-9]{1,3}(?:,[0-9]{3})*(?:[.][0-9]+)?|[0-9]+(?:[.][0-9]+)?" required'
      : type === 'number' ? ' min="0" step="0.01"' : '';
    return `<label class="ds-fin-manual__field">${label}<input class="ds-input" type="${money ? 'text' : type}"${attributes} data-finance-manual-field="${key}" value="${e(display)}"></label>`;
  };
  return `<div class="ds-fin-manual" dir="rtl"><section class="ds-fin-manual__section"><h3>${selectedManualActivityIds(data).length>1?'חשבון מרוכז לגורם מימון':'בחירת פעילות'}</h3><div class="ds-fin-manual__activity-grid">
    <label>גורם מימון<select class="ds-input" data-finance-manual-funder-filter>
      <option value="">כל גורמי המימון</option>
      ${funderOptions.map(f=>`<option value="${e(f.key)}"${data.manualFunderFilter===f.key?' selected':''}>${e(f.label)}</option>`).join('')}
    </select></label>
    <label>חיפוש פעילות<input class="ds-input" data-finance-manual-search value="${e(data.manualSearch)}" placeholder="בית ספר, רשות או פעילות"></label>
    <label>${selectedManualActivityIds(data).length>1?'פעילות לעריכה':'פעילות'}<select class="ds-input" data-finance-manual-activity><option value="">בחירת פעילות קיימת</option>${activities.map(a=>`<option value="${e(a.row_id)}"${a.row_id===data.manualActivityId?' selected':''}>${e(a.school)} | ${e(a.authority)} | ${e(a.activity_name)}</option>`).join('')}</select></label></div>
    <details class="ds-fin-manual__selection">
      <summary>${selectedManualActivityIds(data).length>1?`${selectedManualActivityIds(data).length} פעילויות נבחרו · שינוי הבחירה`:'בחירת פעילויות נוספות'}</summary>
      <div class="ds-fin-manual__choices" role="group" aria-label="בחירה מרובה של פעילויות">
        ${activities.map(a=>`<label class="ds-fin-manual__choice"><input type="checkbox" value="${e(a.row_id)}" data-finance-manual-select-activity${selectedManualActivityIds(data).includes(a.row_id)?' checked':''}><span>${e(a.school)} | ${e(a.authority)} | ${e(a.activity_name)}</span></label>`).join('')}
      </div>
    </details></section>
    ${source?`<div class="ds-fin-manual__funding-grid"><label>גורם מימון וחודש<select class="ds-input" data-finance-manual-funding>${rows.map(r=>`<option value="${e(r.fundingSourceId+'|'+(r.period||r.manualMonth))}"${data.manualFundingKey===r.fundingSourceId+'|'+(r.period||r.manualMonth)?' selected':''}>${e(r.funding)} · ${e((r.period||r.manualMonth)?.slice(0,7)||'ללא חודש')} · ${formatManualMoney((r.eligible?r.issuableAmount:r.fullFundingAmount)||0)} ₪</option>`).join('')}</select></label>
    <label>בסיס החיוב<select class="ds-input" data-finance-manual-field="billing_basis"><option value="performance"${d.billing_basis==='performance'?' selected':''}>מפגשים שבוצעו</option><option value="full_funding"${d.billing_basis==='full_funding'?' selected':''}>מלוא חלק המממן</option></select></label></div>
    <form data-finance-manual-form class="ds-fin-manual__form"><section class="ds-fin-manual__section"><h3>פרטי חשבון</h3><div class="ds-fin-manual__grid">${field('גורם משלם','customer_name')}${field('בית ספר','school_name')}${field(rows.find(r=>`${r.fundingSourceId}|${r.period||r.manualMonth}`===data.manualFundingKey)?.gefenFunding?'סמל מוסד':'מספר לקוח (אם קיים)','institution_symbol')}${field('מספר תוכנית','program_number')}
    ${field('תיאור השירות','description')}${field('דוא״ל נמען','customer_email','email')}</div></section>
    <section class="ds-fin-manual__section"><h3>פרטי חיוב</h3><div class="ds-fin-manual__grid">${field('מפגשים לחיוב','quantity','number')}${field('שעות לחיוב','hours','number')}${field('מחיר למפגש','unit_price','number')}${field('סכום החשבון','amount','number')}
    </div></section>
    <section class="ds-fin-manual__section"><h3>מועדים</h3><div class="ds-fin-manual__grid">${field('תאריך הפקה','issue_date','date')}${field('מועד תשלום','payment_due_date','date')}</div></section><details class="ds-fin-manual__extra"><summary>פרטים נוספים</summary><div class="ds-fin-manual__grid">${field('סיבת חריגה','override_reason')}</div></details>
    <div class="ds-fin-manual__actions"><button class="ds-btn ds-btn--primary" type="button" data-finance-manual-preview>הצגת ${selectedManualActivityIds(data).length>1?'החשבונות':'החשבון'} לבדיקה (PDF)</button></div></form>
    ${data.manualConsolidatedPreview?`<div class="ds-fin-manual__preview">
      <p>חשבון עסקה מרוכז אחד עבור ${data.manualConsolidatedPreview.items.length} פעילויות. כל פעילות וסכומה מוצגים במסמך.</p>
      <iframe title="תצוגה מקדימה של חשבון מרוכז" src="data:application/pdf;base64,${e(data.manualConsolidatedPreview.pdfBase64)}"></iframe>
      <div class="ds-fin-manual__actions"><button class="ds-btn ds-btn--primary" data-finance-manual-confirm>אישור והפקת חשבון מרוכז אחד</button></div>
    </div>`:data.manualBatchPreviews?.length>1?`<div class="ds-fin-manual__batch-previews">
      <p>כל פעילות תופק כחשבון נפרד. יש לעיין בחשבונות לפני אישור ההפקה.</p>
      ${data.manualBatchPreviews.map((p,i)=>`<details class="ds-fin-manual__section"${i===0?' open':''}><summary>${e((data.collectionActivities||[]).find(a=>a.row_id===p.activityId)?.school||p.activityId)} · חשבון ${i+1}</summary>
        <iframe title="תצוגה מקדימה של חשבון ${i+1}" src="data:application/pdf;base64,${e(p.pdfBase64)}"></iframe>
      </details>`).join('')}
      <div class="ds-fin-manual__actions"><button class="ds-btn ds-btn--primary" data-finance-manual-confirm>אישור והפקת ${data.manualBatchPreviews.length} חשבונות</button></div>
    </div>`:data.manualPdf?`<div class="ds-fin-manual__preview"><iframe title="תצוגה מקדימה של חשבון העסקה" src="data:application/pdf;base64,${e(data.manualPdf)}"></iframe>
      <div class="ds-fin-manual__actions"><button class="ds-btn ds-btn--primary" data-finance-manual-confirm>אישור והפקת חשבון</button></div></div>`:''}`:''}</div>`;
}
export async function runManualAccount(data,api) {
  if(!data.manualQuote?.revision)throw Error('יש לפתוח תצוגה מקדימה עדכנית');
  const account=await api.reserveFinanceManualAccount({...manualRequest(data),revision:data.manualQuote.revision,idempotencyKey:data.manualRequestId||crypto.randomUUID()});
  try{return await api.dispatchFinanceTransactionAccount({accountId:account.id});}
  catch(error){await api.cancelFinanceTransactionReservation?.(account.id).catch(()=>{});data.manualRequestId=crypto.randomUUID();throw error;}
}
