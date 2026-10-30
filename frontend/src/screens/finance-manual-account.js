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
// HTML email[multiple] accepts comma-separated recipients, not semicolons.
export function normalizeManualRecipientEmails(value) {
  return text(value).replace(/[;\r\n]+/g, ',').split(',').map(text).filter(Boolean).join(', ');
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
    issue_date:financeToday(),payment_due_date:financePaymentDueDate(financeToday(),days),customer_email:normalizeManualRecipientEmails(row?.gefenFunding ? row?.customerEmail : data.manualFunderRecipientEmail),override_reason:''};
  data.manualQuote=null;data.manualPdf='';data.manualConsolidatedPreview=null;
}
// Each selected activity keeps its own edited invoice; multi-select never combines unrelated payers.
export function selectedManualActivityIds(data) {
  const ids = Array.isArray(data.manualSelectedActivityIds) ? data.manualSelectedActivityIds : [];
  return [...new Set([...ids, ...(data.manualActivityId ? [data.manualActivityId] : [])])];
}
// Sum the edited amounts for all selected activities; the server validates the final total.
export function manualSelectedFundingSummary(data) {
  const selected = selectedManualActivityIds(data);
  const amount = selected.reduce((sum, id) => {
    const draft = id === data.manualActivityId ? data.manualDraft : data.manualActivityDrafts?.[id]?.draft;
    const value = Number(draft?.amount);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
  return { count: selected.length, amount: Math.round(amount * 100) / 100 };
}
export function saveActiveManualDraft(data) {
  if (!data.manualActivityId || !data.manualDraft) return;
  data.manualDraft.customer_email = normalizeManualRecipientEmails(data.manualDraft.customer_email);
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
      const fundingId = text(cached.fundingKey).split('|')[0];
      const fundingRow = (data.transactionContext?.billingRows || []).find(row =>
        row.activityRowId === activityId && row.fundingSourceId === fundingId);
      if (data.manualFunderFilter && fundingRow && !fundingRow.gefenFunding) {
        data.manualDraft.customer_email = normalizeManualRecipientEmails(data.manualFunderRecipientEmail);
      }
    } else {
      prepareManualAccount(data, activityId);
      saveActiveManualDraft(data);
    }
  }
  data.manualQuote = null; data.manualPdf = ''; data.manualBatchPreviews = null; data.manualConsolidatedPreview = null;
}
// Batch selection applies only to the currently shown activities of a selected payer.
// Keep the same per-activity draft initialization and invoice safeguards as individual selection.
export function toggleAllVisibleManualActivities(data, checked) {
  if (!data.manualFunderFilter) return;
  const ids = manualFilteredActivities(data).map(activity => activity.row_id);
  for (const id of ids) {
    if (selectedManualActivityIds(data).includes(id) !== checked) toggleManualActivity(data, id, checked);
  }
  // Bulk selection must not focus and display an arbitrary school.
  data.manualBulkEditingActivityId = '';
}

export function toggleManualActivity(data, activityId, checked) {
  const ids = selectedManualActivityIds(data).filter(id => id !== activityId);
  if (checked) ids.push(activityId);
  data.manualSelectedActivityIds = ids;
  if (ids.length > 1) data.manualBulkEditingActivityId = '';
  if (!checked && data.manualActivityDrafts) delete data.manualActivityDrafts[activityId];
  if (checked || !ids.includes(data.manualActivityId)) focusManualActivity(data, checked ? activityId : ids[0] || '');
  else { data.manualBatchPreviews = null; data.manualConsolidatedPreview = null; data.manualQuote = null; data.manualPdf = ''; }
}
// Shared account fields are deliberately edited separately from an individual
// school's course fields. Distribute shared values to every selected draft so
// the consolidated quote receives identical payer details for all activities.
export function updateManualConsolidatedField(data, key, value) {
  if (!['customer_name','customer_email','institution_symbol','issue_date','payment_due_date','override_reason'].includes(key)) return false;
  const normalized = key === 'customer_email' ? normalizeManualRecipientEmails(value) : value;
  saveActiveManualDraft(data);
  const ids = selectedManualActivityIds(data);
  for (const id of ids) {
    const cached = data.manualActivityDrafts?.[id];
    if (!cached) throw new Error('חסרים פרטי חיוב לפעילות שנבחרה');
    const scoped = { ...data, manualActivityId:id, manualFundingKey:cached.fundingKey, manualDraft:{...cached.draft} };
    updateManualDraft(scoped,key,normalized);
    cached.draft = scoped.manualDraft;
  }
  if (key === 'customer_email') data.manualFunderRecipientEmail = normalized;
  if (data.manualActivityId && data.manualActivityDrafts?.[data.manualActivityId]) {
    data.manualDraft = {...data.manualActivityDrafts[data.manualActivityId].draft};
  }
  data.manualConsolidatedPreview = null;
  data.manualBatchPreviews = null;
  data.manualQuote = null;
  data.manualPdf = '';
  return true;
}

export function manualSelectionSnapshot(data, activityId) {
  const item = data.manualActivityDrafts?.[activityId];
  if (!item) throw new Error('יש לבחור פרטי חיוב לכל פעילות שנבחרה');
  const scoped = { ...data, manualActivityId: activityId, manualFundingKey: item.fundingKey, manualDraft: { ...item.draft } };
  const allowed = manualFundingRowsForSelection(scoped).some(r =>
    `${r.fundingSourceId}|${r.period || r.manualMonth}` === item.fundingKey);
  if (!allowed) throw new Error('גורם המימון שנבחר אינו מתאים לאחת הפעילויות');
  const fundingId = text(item.fundingKey).split('|')[0];
  const fundingRow = (data.transactionContext?.billingRows || []).find(row =>
    row.activityRowId === activityId && row.fundingSourceId === fundingId);
  if (data.manualFunderFilter && fundingRow && !fundingRow.gefenFunding) {
    // Sponsor invoices have a single payer recipient. Never inherit contacts
    // from the schools where its activities happen.
    scoped.manualDraft.customer_email = normalizeManualRecipientEmails(data.manualFunderRecipientEmail);
  }
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
  const safeValue = key === 'amount' || key === 'unit_price' ? parseManualMoney(value)
    : key === 'customer_email' ? normalizeManualRecipientEmails(value) : value;
  if ((key === 'amount' || key === 'unit_price') && !Number.isFinite(safeValue)) return false;
  data.manualDraft={...data.manualDraft,[key]:safeValue};const d=data.manualDraft;
  if (key === 'customer_email' && data.manualFunderFilter) {
    const fundingId = text(data.manualFundingKey).split('|')[0];
    const row = manualFundingRows(data).find(row => row.fundingSourceId === fundingId);
    if (row && !row.gefenFunding) data.manualFunderRecipientEmail = safeValue;
  }
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
// Update only the manual invoice editor and selection indicators in place.
// The original <details> and its checkbox nodes are retained, so the list
// stays expanded and scrolling does not jump on every checked activity.
export function syncManualActivitySelectionUi(root, data) {
  const manual = root?.querySelector('.ds-fin-manual');
  if (!manual) return;
  const frame = root.ownerDocument.createElement('div');
  frame.innerHTML = manualAccountViewHtml(data);
  const next = frame.firstElementChild;
  const head = manual.firstElementChild;
  const nextHead = next.firstElementChild;
  const heading = head.querySelector('[data-finance-manual-heading]');
  if (heading) heading.textContent = nextHead.querySelector('[data-finance-manual-heading]').textContent;
  const currentActivity = head.querySelector('[data-finance-manual-activity]');
  const updatedActivity = nextHead.querySelector('[data-finance-manual-activity]');
  if (currentActivity && updatedActivity) {
    currentActivity.parentElement.replaceWith(updatedActivity.parentElement);
  }
  const selected = new Set(selectedManualActivityIds(data));
  head.querySelectorAll('[data-finance-manual-select-activity]').forEach(input => {
    input.checked = selected.has(input.value);
  });
  const summary = head.querySelector('[data-finance-manual-selection-summary]');
  if (summary) summary.textContent = nextHead.querySelector('[data-finance-manual-selection-summary]').textContent;
  const master = head.querySelector('[data-finance-manual-select-all]');
  if (master) {
    const inputs = [...head.querySelectorAll('[data-finance-manual-select-activity]')];
    const checkedCount = inputs.filter(input => input.checked).length;
    master.checked = inputs.length > 0 && checkedCount === inputs.length;
    master.indeterminate = checkedCount > 0 && checkedCount < inputs.length;
  }
  const count = head.querySelector('[data-finance-manual-selection-count]');
  if (count) count.textContent = nextHead.querySelector('[data-finance-manual-selection-count]').textContent;
  // Replace only the editor (which may change its active activity), not its disclosure.
  [...manual.children].slice(1).forEach(element => element.remove());
  [...next.children].slice(1).forEach(element => manual.appendChild(element));
}

// Object URLs (rather than data: URLs) prevent the browser/Acrobat extension
// from rendering a large Base64 string instead of the PDF preview.
export function manualPdfPreviewFilename(quote = {}, { count = 0 } = {}) {
  const payer = text(quote.customer_name_snapshot || 'לקוח').replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim();
  const issueDate = text(quote.issue_date).match(/^(\d{4})-(\d{2})-(\d{2})/);
  const displayDate = issueDate ? `${issueDate[3]}.${issueDate[2]}.${issueDate[1]}` : '';
  return ['טיוטת חשבון עסקה', payer, count > 1 ? `${count} פעילויות` : '', displayDate]
    .filter(Boolean).join(' - ') + '.pdf';
}

export function clearManualPdfPreviewUrls(root, urlApi = URL) {
  for (const cached of root?._financeManualPdfPreviewUrls?.values() || []) {
    urlApi.revokeObjectURL?.(cached.url);
  }
  if (root) root._financeManualPdfPreviewUrls = new Map();
}

export function syncManualPdfPreviewDom(root, data, scope = globalThis) {
  if (!root) return;
  const urlApi = scope.URL;
  if (typeof urlApi?.createObjectURL !== 'function' || typeof scope.atob !== 'function') return;
  const previews = new Map();
  if (data.manualConsolidatedPreview) {
    const value = data.manualConsolidatedPreview;
    previews.set('consolidated', { base64: value.pdfBase64,
      name: manualPdfPreviewFilename(value.quote, {count: value.items.length}) });
  } else if (Array.isArray(data.manualBatchPreviews) && data.manualBatchPreviews.length > 1) {
    data.manualBatchPreviews.forEach((value, i) => {
      previews.set(String(i), { base64: value.pdfBase64,
        name: manualPdfPreviewFilename(value.quote) });
    });
  } else if (data.manualPdf) {
    previews.set('single', { base64: data.manualPdf,
      name: manualPdfPreviewFilename(data.manualQuote || data.manualDraft) });
  }
  root._financeManualPdfPreviewUrls ||= new Map();
  const cache = root._financeManualPdfPreviewUrls;
  for (const [key, previous] of cache) {
    const current = previews.get(key);
    if (!current || current.base64 !== previous.base64) {
      urlApi.revokeObjectURL(previous.url);
      cache.delete(key);
    }
  }
  for (const [key, descriptor] of previews) {
    if (!cache.has(key)) {
      const binary = scope.atob(descriptor.base64);
      const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
      const url = urlApi.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      cache.set(key, {url, base64: descriptor.base64});
    }
    const url = cache.get(key).url;
    const frame = [...root.querySelectorAll('[data-finance-manual-pdf-frame]')]
      .find(node => node.dataset.financeManualPdfFrame === key);
    if (frame && frame.getAttribute('src') !== url + '#toolbar=0') {
      frame.setAttribute('src', url + '#toolbar=0');
    }
    const download = [...root.querySelectorAll('[data-finance-manual-pdf-download]')]
      .find(node => node.dataset.financeManualPdfDownload === key);
    if (download) {
      download.setAttribute('href', url);
      download.setAttribute('download', descriptor.name);
    }
  }
}

// The editor targets one selected activity, but the payer invoice contains all
// selected schools. List every line and its share to prevent a single school
// appearing to represent a consolidated invoice.
export function manualConsolidatedActivityRows(data) {
  const activities = new Map((data.collectionActivities || []).map(activity => [activity.row_id, activity]));
  return selectedManualActivityIds(data).map(id => {
    const activity = activities.get(id) || {};
    const draft = id === data.manualActivityId ? data.manualDraft : data.manualActivityDrafts?.[id]?.draft;
    return {
      id, school: text(activity.school) || 'ללא בית ספר',
      activity: text(activity.activity_name) || 'פעילות',
      amount: Number(draft?.amount) || 0
    };
  }).sort((a,b) =>
    [a.school,a.activity].join(' ').localeCompare([b.school,b.activity].join(' '),'he'));
}

export function manualAccountViewHtml(data) {
  const activities=manualFilteredActivities(data);
  const funderOptions=manualFundingFilterOptions(data);
  const source=(data.collectionActivities||[]).find(a=>a.row_id===data.manualActivityId);const d=data.manualDraft||{};const rows=manualFundingRowsForSelection(data);
  const selectedSummary = manualSelectedFundingSummary(data);
  const consolidated = selectedSummary.count > 1;
  const selectedRows = consolidated ? manualConsolidatedActivityRows(data) : [];
  const schoolCount = new Set(selectedRows.map(row => row.school)).size;
  const displayedTotal = data.manualConsolidatedPreview?.quote?.total_amount ?? selectedSummary.amount;
  const bulkEditing = consolidated && Boolean(data.manualBulkEditingActivityId);
  const bulkValue = (key) => key === 'customer_email' ? normalizeManualRecipientEmails(data.manualFunderRecipientEmail) : text(d[key]);
  const batchField = (label,key,type='text') => `<label class="ds-fin-manual__field">${label}<input class="ds-input" type="${type}"${key==='customer_email'?' multiple dir="ltr" autocomplete="off"':''}${key==='customer_name'?' required':''} data-finance-manual-bulk-field="${key}" value="${e(bulkValue(key))}"></label>`;
  const field=(label,key,type='text')=>{
    const money = key === 'amount' || key === 'unit_price';
    const display = money ? formatManualMoney(d[key], { unitPrice: key === 'unit_price' })
      : key === 'customer_email' ? normalizeManualRecipientEmails(d[key]) : d[key];
    const attributes = money
      ? ' inputmode="decimal" dir="ltr" pattern="[0-9]{1,3}(?:,[0-9]{3})*(?:[.][0-9]+)?|[0-9]+(?:[.][0-9]+)?" required'
      : type === 'number' ? ' min="0" step="0.01"'
      : key === 'customer_email' ? ' multiple autocomplete="off" dir="ltr" placeholder="email@example.com, email2@example.com"' : '';
    return `<label class="ds-fin-manual__field">${label}<input class="ds-input" type="${money ? 'text' : type}"${attributes} data-finance-manual-field="${key}" value="${e(display)}"></label>`;
  };
  return `<div class="ds-fin-manual" dir="rtl"><section class="ds-fin-manual__section"><h3 data-finance-manual-heading>${selectedManualActivityIds(data).length>1?'חשבון מרוכז לגורם מימון':'בחירת פעילות'}</h3><div class="ds-fin-manual__activity-grid">
    <label>גורם מימון<select class="ds-input" data-finance-manual-funder-filter>
      <option value="">כל גורמי המימון</option>
      ${funderOptions.map(f=>`<option value="${e(f.key)}"${data.manualFunderFilter===f.key?' selected':''}>${e(f.label)}</option>`).join('')}
    </select></label>
    <label>חיפוש פעילות<input class="ds-input" data-finance-manual-search value="${e(data.manualSearch)}" placeholder="בית ספר, רשות או פעילות"></label>
    <label data-finance-manual-active-label>${consolidated?'עריכת פעילות בודדת (רשות)':'פעילות'}<select class="ds-input" data-finance-manual-activity><option value="">${consolidated?'חשבון מרוכז — ללא בית ספר יחיד':'בחירת פעילות קיימת'}</option>${activities.map(a=>`<option value="${e(a.row_id)}"${a.row_id===(consolidated?data.manualBulkEditingActivityId:data.manualActivityId)?' selected':''}>${e(a.school)} | ${e(a.authority)} | ${e(a.activity_name)}</option>`).join('')}</select></label></div>
    <details class="ds-fin-manual__selection" data-finance-manual-selection${data.manualSelectionExpanded?' open':''}>
      <summary data-finance-manual-selection-summary>${selectedManualActivityIds(data).length>1?`${selectedManualActivityIds(data).length} פעילויות נבחרו · שינוי הבחירה`:'בחירת פעילויות נוספות'}</summary>
      <div class="ds-fin-manual__selection-toolbar" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:8px 0;">
        <label><input type="checkbox" data-finance-manual-select-all${activities.length && activities.every(a=>selectedManualActivityIds(data).includes(a.row_id))?' checked':''}${data.manualFunderFilter?'':' disabled title="יש לבחור גורם מימון תחילה"'}> סמן הכל</label>
        <span data-finance-manual-selection-count>${activities.filter(a=>selectedManualActivityIds(data).includes(a.row_id)).length} מתוך ${activities.length} פעילויות מוצגות</span>
      </div>
      <div class="ds-fin-manual__choices" role="group" aria-label="בחירה מרובה של פעילויות">
        ${activities.map(a=>`<label class="ds-fin-manual__choice"><input type="checkbox" value="${e(a.row_id)}" data-finance-manual-select-activity${selectedManualActivityIds(data).includes(a.row_id)?' checked':''}><span>${e(a.school)} | ${e(a.authority)} | ${e(a.activity_name)}</span></label>`).join('')}
      </div>
    </details></section>
    ${consolidated?`<div class="ds-fin-manual__batch-total" data-finance-manual-batch-total style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;padding:8px 0 4px;">
      <strong>חשבון מרוכז · ${selectedSummary.count} פעילויות · ${schoolCount} בתי ספר</strong>
      <strong>סכום כולל: ${formatManualMoney(displayedTotal)} ₪</strong>
      <span style="flex-basis:100%;font-size:12px">זהו חשבון של גורם המימון עבור כל הפעילויות שנבחרו. אין בית ספר יחיד לחשבון.</span>
    </div>
    <details class="ds-fin-manual__selected-schools" open>
      <summary>פירוט כל בתי הספר והפעילויות בחשבון (${selectedRows.length})</summary>
      <div style="max-height:250px;overflow:auto;margin-top:8px">
        <table class="ds-table" style="width:100%;font-size:13px">
          <thead><tr><th>בית ספר</th><th>פעילות</th><th>חלק המממן (₪)</th></tr></thead>
          <tbody>${selectedRows.map(row=>`<tr><td>${e(row.school)}</td><td>${e(row.activity)}</td><td dir="ltr" style="text-align:right">${formatManualMoney(row.amount)}</td></tr>`).join('')}</tbody>
        </table>
      </div>
    </details>`:''}
    ${source && consolidated && !bulkEditing ? `<form data-finance-manual-form class="ds-fin-manual__form">
      <section class="ds-fin-manual__section"><h3>פרטי החשבון המרוכז</h3>
        <div class="ds-fin-manual__grid">
          ${batchField('גורם משלם','customer_name')}
          ${batchField('דוא״ל המממן (להפריד בפסיק)','customer_email','email')}
          ${batchField('מספר לקוח (אם קיים)','institution_symbol')}
          ${batchField('תאריך הפקה','issue_date','date')}
          ${batchField('מועד תשלום','payment_due_date','date')}
        </div>
        <details class="ds-fin-manual__extra"><summary>פרטים נוספים</summary>
          <div class="ds-fin-manual__grid">${batchField('סיבת חריגה','override_reason')}</div>
        </details>
      </section>
      <div class="ds-fin-manual__actions"><button class="ds-btn ds-btn--primary" type="button" data-finance-manual-preview>הצגת החשבון המרוכז לבדיקה (PDF)</button></div>
    </form>` : ''}
    ${source && (!consolidated || bulkEditing)?`<div class="ds-fin-manual__funding-grid"><label>גורם מימון וחודש<select class="ds-input" data-finance-manual-funding>${rows.map(r=>`<option value="${e(r.fundingSourceId+'|'+(r.period||r.manualMonth))}"${data.manualFundingKey===r.fundingSourceId+'|'+(r.period||r.manualMonth)?' selected':''}>${e(r.funding)} · ${e((r.period||r.manualMonth)?.slice(0,7)||'ללא חודש')} · ${formatManualMoney((r.eligible?r.issuableAmount:r.fullFundingAmount)||0)} ₪</option>`).join('')}</select></label>
    <label>בסיס החיוב<select class="ds-input" data-finance-manual-field="billing_basis"><option value="performance"${d.billing_basis==='performance'?' selected':''}>מפגשים שבוצעו</option><option value="full_funding"${d.billing_basis==='full_funding'?' selected':''}>מלוא חלק המממן</option></select></label></div>
    <form data-finance-manual-form class="ds-fin-manual__form"><section class="ds-fin-manual__section"><h3>${consolidated?'פרטי הפעילות לעריכה':'פרטי חשבון'}</h3><div class="ds-fin-manual__grid">${field('גורם משלם','customer_name')}${field(consolidated?'בית ספר בפעילות הנערכת':'בית ספר','school_name')}${field(rows.find(r=>`${r.fundingSourceId}|${r.period||r.manualMonth}`===data.manualFundingKey)?.gefenFunding?'סמל מוסד':'מספר לקוח (אם קיים)','institution_symbol')}${field('מספר תוכנית','program_number')}
    ${field('תיאור השירות','description')}${field(consolidated?'דוא״ל המממן לכל החשבון (להפריד בפסיק)':'דוא״ל נמען (להפריד בפסיק)','customer_email','email')}</div></section>
    <section class="ds-fin-manual__section"><h3>פרטי חיוב</h3><div class="ds-fin-manual__grid">${field('מפגשים לחיוב','quantity','number')}${field('שעות לחיוב','hours','number')}${field('מחיר למפגש','unit_price','number')}${field(consolidated?'סכום פעילות זו':'סכום החשבון','amount','number')}
    </div></section>
    <section class="ds-fin-manual__section"><h3>מועדים</h3><div class="ds-fin-manual__grid">${field('תאריך הפקה','issue_date','date')}${field('מועד תשלום','payment_due_date','date')}</div></section><details class="ds-fin-manual__extra"><summary>פרטים נוספים</summary><div class="ds-fin-manual__grid">${field('סיבת חריגה','override_reason')}</div></details>
    <div class="ds-fin-manual__actions"><button class="ds-btn ds-btn--primary" type="button" data-finance-manual-preview>הצגת ${selectedManualActivityIds(data).length>1?'החשבון המרוכז':'החשבון'} לבדיקה (PDF)</button></div></form>`:''}
    ${source ? `${data.manualConsolidatedPreview?`<div class="ds-fin-manual__preview">
      <p>חשבון עסקה מרוכז אחד עבור ${data.manualConsolidatedPreview.items.length} פעילויות. כל פעילות וסכומה מוצגים במסמך.</p>
      <iframe title="תצוגה מקדימה של חשבון מרוכז" data-finance-manual-pdf-frame="consolidated"></iframe>
      <div class="ds-fin-manual__actions"><a class="ds-btn" data-finance-manual-pdf-download="consolidated">הורדת PDF עם שם החשבון</a></div>
      <div class="ds-fin-manual__actions"><button class="ds-btn ds-btn--primary" data-finance-manual-confirm>אישור והפקת חשבון מרוכז אחד</button></div>
    </div>`:data.manualBatchPreviews?.length>1?`<div class="ds-fin-manual__batch-previews">
      <p>כל פעילות תופק כחשבון נפרד. יש לעיין בחשבונות לפני אישור ההפקה.</p>
      ${data.manualBatchPreviews.map((p,i)=>`<details class="ds-fin-manual__section"${i===0?' open':''}><summary>${e((data.collectionActivities||[]).find(a=>a.row_id===p.activityId)?.school||p.activityId)} · חשבון ${i+1}</summary>
        <iframe title="תצוגה מקדימה של חשבון ${i+1}" data-finance-manual-pdf-frame="${i}"></iframe>
        <a class="ds-btn" data-finance-manual-pdf-download="${i}">הורדת PDF עם שם החשבון</a>
      </details>`).join('')}
      <div class="ds-fin-manual__actions"><button class="ds-btn ds-btn--primary" data-finance-manual-confirm>אישור והפקת ${data.manualBatchPreviews.length} חשבונות</button></div>
    </div>`:data.manualPdf?`<div class="ds-fin-manual__preview"><iframe title="תצוגה מקדימה של חשבון העסקה" data-finance-manual-pdf-frame="single"></iframe>
      <div class="ds-fin-manual__actions"><a class="ds-btn" data-finance-manual-pdf-download="single">הורדת PDF עם שם החשבון</a></div>
      <div class="ds-fin-manual__actions"><button class="ds-btn ds-btn--primary" data-finance-manual-confirm>אישור והפקת חשבון</button></div></div>`:''}`:''}</div>`;
}
export async function runManualAccount(data,api) {
  if(!data.manualQuote?.revision)throw Error('יש לפתוח תצוגה מקדימה עדכנית');
  const account=await api.reserveFinanceManualAccount({...manualRequest(data),revision:data.manualQuote.revision,idempotencyKey:data.manualRequestId||crypto.randomUUID()});
  try{return await api.dispatchFinanceTransactionAccount({accountId:account.id});}
  catch(error){await api.cancelFinanceTransactionReservation?.(account.id).catch(()=>{});data.manualRequestId=crypto.randomUUID();throw error;}
}
