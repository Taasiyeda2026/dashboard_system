import { escapeHtml as e } from './shared/html.js';
import { financeToday, financePaymentDueDate, TRANSACTION_MEETING_HOURS } from './finance-transaction-accounts.js';
const text=v=>String(v??'').trim();
function manualService(data) {
  const source=(data.collectionActivities||[]).find(a=>a.row_id===data.manualActivityId);
  const row=manualFundingRows(data).find(r=>`${r.fundingSourceId}|${r.period||r.manualMonth}`===data.manualFundingKey);
  return ['workshop','tour'].includes(text(row?.activityType||source?.activity_type).toLowerCase());
}
export function manualHourlyRate(draft={}) {
  const hours=Number(draft.planned_hours ?? draft.hours),price=Number(draft.activity_price ?? draft.amount);
  return hours>0 ? price/hours : null;
}
function performanceSelection(row,quantity) {
  const slots=(row.unbilledSlots||[]).slice().sort((a,b)=>a.slot-b.slot).slice(0,quantity);
  if(slots.length)return {amount:Math.round(slots.reduce((n,s)=>n+Number(s.remainingAmount),0)*100)/100,hours:slots.reduce((n,s)=>n+Number(s.remainingHours ?? TRANSACTION_MEETING_HOURS),0)};
  return {amount:Number(row.issuableAmount)*quantity/Number(row.unbilledCount),hours:quantity*TRANSACTION_MEETING_HOURS};
}
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

// Payer identity comes from the server; Gefen is never a shared payer.
const normalizedFunder = value => text(value).replace(/[״׳"']/g,'').replace(/\s+/g,' ').trim().toLocaleLowerCase('he');
export function manualRowPayer(row, activity = {}) {
  const name=normalizedFunder(row.funding);
  const school=row.gefenFunding===true || name==='גפן' || name==='חוזה עצמאי';
  const authority=/^(רשות|רשויות|authority)$/.test(name);
  const key=text(row.payerKey) || (school ? 'school:'+text(activity.school_id || row.financeSchoolId || activity.school || row.customerName)
    : authority ? 'authority:'+text(activity.authority_id || row.authorityId || activity.authority || row.payerName)
    : 'funding:'+text(row.fundingSourceId));
  return {key,label:text(row.payerName) || (key.startsWith('school:')?text(activity.school || row.customerName):authority?text(activity.authority):text(row.funding))};
}
export function manualActivityFunders(data, activity) {
  const rows=(data.transactionContext?.billingRows||[]).filter(row=>row.activityRowId===activity.row_id && row.fundingSourceId);
  return [...new Map(rows.map(row=>{const payer=manualRowPayer(row,activity);return[payer.key,payer];})).values()];
}
const fullAllowed = row => !row.fullFundingBlockedReason && Number(row.fullFundingAmount)>0;
const performanceAllowed = row => row.eligible && !row.blockedReason && Number(row.issuableAmount)>0;
export function manualActivityBalance(data, activityId) {
  const scoped={...data,manualActivityId:activityId};
  const rows=manualFundingRowsForSelection(scoped);
  const amounts=new Map();
  for(const row of rows)amounts.set(row.fundingSourceId,Math.max(amounts.get(row.fundingSourceId)||0,Number(row.fullFundingAmount ?? row.issuableAmount ?? 0)));
  return [...amounts.values()].reduce((sum,amount)=>sum+amount,0);
}
export function manualActivityBillable(data, activityId) {
  return manualFundingRowsForSelection({...data,manualActivityId:activityId}).some(row=>data.manualScope==='partial'?performanceAllowed(row):fullAllowed(row)||performanceAllowed(row));
}
// Funding route is selected before the actual payer. Gefen is a route, never a shared payer.
function manualFundingRoute(row) {
  const normalized=normalizedFunder(row.funding);
  if (row.gefenFunding || normalized==='גפן') return { key:'gefen', label:'גפ״ן', payerLabel:'בית ספר' };
  if (/^(רשות|רשויות|authority)$/.test(normalized)) return { key:'authority', label:'רשות', payerLabel:'רשות' };
  const label=text(row.funding)||'גורם מימון אחר';
  return { key:'source:'+normalized, label, payerLabel:'גורם משלם' };
}
export function manualFundingRouteOptions(data) {
  const routes=new Map();
  for (const row of data.transactionContext?.billingRows||[]) {
    if (!row.fundingSourceId || !(data.collectionActivities||[]).some(a=>a.row_id===row.activityRowId)) continue;
    const route=manualFundingRoute(row);
    routes.set(route.key,route);
  }
  return [...routes.values()].sort((a,b)=>a.label.localeCompare(b.label,'he'));
}
export function manualSelectedFundingRoute(data) {
  if (data.manualFundingCategory) return data.manualFundingCategory;
  if (text(data.manualFunderFilter).startsWith('route:')) return text(data.manualFunderFilter).slice(6);
  if (!data.manualFunderFilter) return '';
  const first=(data.transactionContext?.billingRows||[]).find(row=>{
    const activity=(data.collectionActivities||[]).find(a=>a.row_id===row.activityRowId);
    return activity && manualRowPayer(row,activity).key===data.manualFunderFilter;
  });
  return first ? manualFundingRoute(first).key : '';
}
export function manualFundingFilterOptions(data) {
  const funders = new Map();
  const selectedRoute=manualSelectedFundingRoute(data);
  const rowsByActivity=new Map();
  for (const row of data.transactionContext?.billingRows||[]) {
    if (!row.fundingSourceId) continue;
    if (!rowsByActivity.has(row.activityRowId)) rowsByActivity.set(row.activityRowId,[]);
    rowsByActivity.get(row.activityRowId).push(row);
  }
  for (const activity of data.collectionActivities || []) {
    for (const row of rowsByActivity.get(activity.row_id)||[]) {
      if (selectedRoute && manualFundingRoute(row).key!==selectedRoute) continue;
      const funder=manualRowPayer(row,activity);
      if (!funders.has(funder.key)) funders.set(funder.key,{...funder,authorities:new Set()});
      const authority=text(activity.authority || row.authorityName);
      if (authority) funders.get(funder.key).authorities.add(authority);
    }
  }
  return [...funders.values()].map(({authorities,...payer})=>{
    const names=[...authorities].sort((a,b)=>a.localeCompare(b,'he'));
    // Keep the payer's server-defined identity unchanged; authority is context only.
    const authorityLabel=names.length ? names.join(', ') : 'לא משויכת';
    const ownAuthority=names.length===1 && normalizedFunder(payer.label)===normalizedFunder(names[0]);
    return {...payer,authorityNames:names,displayLabel:ownAuthority
      ? `${payer.label} · רשות` : `${payer.label} · רשות: ${authorityLabel}`};
  }).sort((a,b)=>a.label.localeCompare(b.label,'he'));
}
function matchesManualSelection(row, activity, data) {
  const key=text(data.manualFunderFilter);
  if (!key) return false;
  if (key.startsWith('route:')) return manualFundingRoute(row).key === key.slice(6);
  return manualRowPayer(row,activity).key===key;
}
export function manualFilteredActivities(data) {
  const query = text(data.manualSearch).toLocaleLowerCase();
  if (!data.manualFunderFilter) return [];
  return (data.collectionActivities || [])
    .filter(activity => (data.transactionContext?.billingRows||[]).some(row=>
      row.activityRowId===activity.row_id && row.fundingSourceId && matchesManualSelection(row,activity,data)))
    .filter(activity => [activity.row_id, activity.school, activity.activity_name, activity.authority].join(' ').toLocaleLowerCase().includes(query))
    .sort((a,b) => [a.school,a.authority,a.activity_name].join(' ').localeCompare([b.school,b.authority,b.activity_name].join(' '),'he'));
}
export function manualFundingRowsForSelection(data) {
  const rows = manualFundingRows(data);
  if (!data.manualFunderFilter) return rows;
  const source = (data.collectionActivities || []).find(a => a.row_id === data.manualActivityId);
  if (!source) return [];
  return rows.filter(row => matchesManualSelection(row,source,data));
}
export function prepareManualAccount(data,activityId,fundingKey,basis) {
  data.manualActivityId=activityId;const rows=manualFundingRows(data);
  const source=(data.collectionActivities||[]).find(a=>a.row_id===activityId)||{};
  const filteredRows=manualFundingRowsForSelection(data);
  const row=filteredRows.find(r=>`${r.fundingSourceId}|${r.period||r.manualMonth}`===fundingKey)||filteredRows.find(r=>fullAllowed(r)||performanceAllowed(r))||filteredRows[0];
  data.manualFundingKey=row?`${row.fundingSourceId}|${row.period||row.manualMonth}`:'';
  const full=(basis||(data.manualScope==='partial'&&performanceAllowed(row||{})?'performance':fullAllowed(row||{})?'full_funding':'performance'))==='full_funding';
  const quantity=Number((full?row?.plannedCount:row?.unbilledCount)||0),amount=Number((full?row?.fullFundingAmount:row?.issuableAmount)||0);
  const days=/^(רשות|רשויות|authority|ויצו|wizo)$/i.test(text(row?.funding).replace(/["׳״\s]/g,''))?45:30;
  if (!data.manualFunderRecipientEmail) data.manualFunderRecipientEmail=normalizeManualRecipientEmails(row?.customerEmail);
  data.manualDraft={billing_basis:full?'full_funding':'performance',customer_name:row?.payerName||'',school_name:source.school||'',institution_symbol:row && manualRowPayer(row,source).key.startsWith('school:')?(row.institutionSymbol||''):'',program_number:source.activity_no||'',
    description:source.activity_name||'',quantity,hours:manualService(data)?0:Number(full?(row?.plannedHours ?? quantity*TRANSACTION_MEETING_HOURS):(row?.unbilledHours ?? quantity*TRANSACTION_MEETING_HOURS)),unit_price:quantity?amount/quantity:0,amount,
    activity_price:Number(row?.activityPrice ?? source.price ?? row?.fundingAmount ?? amount),planned_count:Number(row?.plannedCount || quantity),planned_hours:Number(row?.plannedHours ?? (row?.plannedCount || quantity)*TRANSACTION_MEETING_HOURS),
    issue_date:financeToday(),payment_due_date:financePaymentDueDate(financeToday(),days),customer_email:normalizeManualRecipientEmails(data.manualFunderRecipientEmail || row?.customerEmail),override_reason:''};
  data.manualQuote=null;data.manualPdf='';data.manualConsolidatedPreview=null;
}
// Each selected activity keeps its own edited invoice; multi-select never combines unrelated payers.
export function selectedManualActivityIds(data) {
  // An explicit checkbox selection is authoritative; a focused editor must never
  // silently re-select an activity after the user deselects everything.
  if (Array.isArray(data.manualSelectedActivityIds)) return [...new Set(data.manualSelectedActivityIds)];
  return data.manualActivityId ? [data.manualActivityId] : [];
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
      if (data.manualFunderFilter && !text(data.manualFunderFilter).startsWith('route:') && fundingRow && !fundingRow.gefenFunding) {
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
  const ids = manualFilteredActivities(data).filter(activity=>manualActivityBillable(data,activity.row_id)).map(activity => activity.row_id);
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
  if (!ids.length) {
    // Deselecting the last checkbox also clears the editor and preview state.
    data.manualActivityId = ''; data.manualDraft = null; data.manualFundingKey = '';
    data.manualActivityDrafts = {};
    data.manualQuote = null; data.manualPdf = '';
    data.manualBatchPreviews = null; data.manualConsolidatedPreview = null;
  }
}
// Shared account fields are deliberately edited separately from an individual
// school's course fields. Distribute shared values to every selected draft so
// the consolidated quote receives identical payer details for all activities.
export function setManualBillingScope(data, scope) {
  saveActiveManualDraft(data);
  const ids=selectedManualActivityIds(data),active=data.manualActivityId;
  data.manualScope=scope==='partial'?'partial':'full';
  for(const id of ids){
    const key=data.manualActivityDrafts?.[id]?.fundingKey;
    const row=manualFundingRowsForSelection({...data,manualActivityId:id}).find(r=>`${r.fundingSourceId}|${r.period||r.manualMonth}`===key);
    prepareManualAccount(data,id,key,data.manualScope==='partial'&&performanceAllowed(row||{})?'performance':undefined);
    saveActiveManualDraft(data);
  }
  if(active)focusManualActivity(data,active);
}
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
  if (data.manualFunderFilter && !text(data.manualFunderFilter).startsWith('route:') && fundingRow && !fundingRow.gefenFunding) {
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
  const requests=ids.map(id=>({id,request:manualSelectionSnapshot(data,id)}));
  const groups=new Map();
  for(const entry of requests){
    const row=(data.transactionContext?.billingRows||[]).find(r=>r.activityRowId===entry.id && r.fundingSourceId===entry.request.funder);
    const gefen=row?.gefenFunding || normalizedFunder(row?.funding)==='גפן';
    const key=gefen?'gefen:'+entry.id:entry.request.funder;
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(entry);
  }
  if (ids.length > 1 && groups.size===1 && [...groups.values()][0].length>1) {
    const items=requests.map(entry=>entry.request);
    const output=await api.previewFinanceFunderBatchAccount(items);
    if(!output?.quote?.revision || !output?.pdfBase64)throw new Error('לא התקבלה תצוגה מקדימה תקינה לחשבון המרוכז');
    data.manualConsolidatedPreview={items,quote:output.quote,pdfBase64:output.pdfBase64,idempotencyKey:crypto.randomUUID()};
    data.manualBatchPreviews=null;data.manualQuote=null;data.manualPdf='';
    return [data.manualConsolidatedPreview];
  }
  data.manualConsolidatedPreview = null;
  const previews = [];
  for (const entries of groups.values()) {
    const items=entries.map(entry=>entry.request);
    const request=items[0];
    const output=items.length>1?await api.previewFinanceFunderBatchAccount(items):await api.previewFinanceManualAccount(request);
    if(!output?.quote?.revision || !output?.pdfBase64)throw new Error('לא התקבלה תצוגה מקדימה תקינה');
    previews.push({activityId:entries[0].id,request,...(items.length>1?{items}:{}),quote:output.quote,pdfBase64:output.pdfBase64,idempotencyKey:crypto.randomUUID()});
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
  if (previews.reduce((n,p)=>n+(p.items?.length||1),0) !== selectedManualActivityIds(data).length) throw new Error('יש לחדש תצוגה מקדימה');
  data.manualBatchIssued ||= {};
  const issued = [];
  for (const p of previews) {
    if (data.manualBatchIssued[p.idempotencyKey]) { issued.push(data.manualBatchIssued[p.idempotencyKey]); continue; }
    try {
      const reserved = p.items ? await api.reserveFinanceFunderBatchAccount({items:p.items,revision:p.quote.revision,idempotencyKey:p.idempotencyKey})
        : await api.reserveFinanceManualAccount({...p.request, revision:p.quote.revision,idempotencyKey:p.idempotencyKey});
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
  const service=manualService(data);
  if(!service && (['unit_price','hours','amount'].includes(key) || (key==='quantity'&&data.manualDraft.billing_basis==='full_funding')))return false;
  data.manualDraft={...data.manualDraft,[key]:safeValue};const d=data.manualDraft;
  if (key === 'customer_email' && data.manualFunderFilter) {
    const fundingId = text(data.manualFundingKey).split('|')[0];
    const row = manualFundingRows(data).find(row => row.fundingSourceId === fundingId);
    if (row && !row.gefenFunding) data.manualFunderRecipientEmail = safeValue;
  }
  if(key==='quantity'){
    if(service){d.hours=0;d.amount=Math.round(Number(value)*Number(d.unit_price)*100)/100;}
    else {
      const row=manualFundingRows(data).find(r=>`${r.fundingSourceId}|${r.period||r.manualMonth}`===data.manualFundingKey);
      const selected=performanceSelection(row||{},Number(value));
      d.hours=selected.hours;d.amount=selected.amount;d.unit_price=selected.amount/Number(value);
    }
  }
  if(key==='unit_price'&&service)d.amount=Math.round(Number(d.quantity)*Number(safeValue)*100)/100;
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
    const inputs = [...head.querySelectorAll('[data-finance-manual-select-activity]')].filter(input=>!input.disabled);
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

// Some PDF browser extensions replace embedded iframes with an empty grey panel.
// Keep a named Blob and open it only on an explicit user click.
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
      cache.set(key, {url, base64: descriptor.base64, name: descriptor.name});
    }
    cache.get(key).name = descriptor.name;
  }
}

// These actions run from a direct click so popup blocking is not bypassed.
// A named download always uses the actual generated PDF bytes, never a screenshot.
export function activateManualPdfPreview(root, key, action, scope = globalThis) {
  const preview = root?._financeManualPdfPreviewUrls?.get(String(key));
  if (!preview?.url) return false;
  if (action === 'open') {
    const open = scope.open || root.ownerDocument.defaultView?.open;
    if (typeof open !== 'function') return false;
    open.call(scope, preview.url, '_blank', 'noopener');
    return true;
  }
  if (action !== 'download') return false;
  const link = root.ownerDocument.createElement('a');
  link.href = preview.url;
  link.download = preview.name;
  link.hidden = true;
  root.appendChild(link);
  link.click();
  link.remove();
  return true;
}

// One compact review surface; no empty Acrobat extension and no stacked buttons.
export function manualPdfReviewHtml({key, title, detail, confirmLabel = ''}) {
  return `<section class="ds-fin-manual__review" aria-label="${e(title)}">
    <div class="ds-fin-manual__review-document">
      <span class="ds-fin-manual__review-file" aria-hidden="true">PDF</span>
      <div class="ds-fin-manual__review-info">
        <strong>${e(title)}</strong>
        <span>${e(detail)}</span>
        <small>טיוטה לבדיקה בלבד · טרם הופק חשבון עסקה</small>
      </div>
    </div>
    <div class="ds-fin-manual__review-actions">
      <button type="button" class="ds-btn" data-finance-manual-pdf-open="${e(key)}">צפייה בטיוטה</button>
      <button type="button" class="ds-btn" data-finance-manual-pdf-download="${e(key)}">הורדת PDF</button>
      ${confirmLabel ? `<button type="button" class="ds-btn ds-btn--primary" data-finance-manual-confirm>${e(confirmLabel)}</button>` : ''}
    </div>
  </section>`;
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
  const activities=manualFilteredActivities(data),routes=manualFundingRouteOptions(data);
  const routeKey=manualSelectedFundingRoute(data),route=routes.find(r=>r.key===routeKey);
  const options=routeKey?manualFundingFilterOptions({...data,manualFundingCategory:routeKey}):[];
  const payer=routeKey.startsWith('source:')
    ? (route ? {key:'route:'+routeKey,label:route.label,displayLabel:route.label} : null)
    : options.find(p=>p.key===data.manualFunderFilter);
  const ids=selectedManualActivityIds(data).filter(id =>
    (data.collectionActivities||[]).some(activity=>activity.row_id===id) &&
    (data.transactionContext?.billingRows||[]).some(row=>row.activityRowId===id &&
      row.fundingSourceId && (data.collectionActivities||[]).some(activity=>
        activity.row_id===id && matchesManualSelection(row,activity,data))));
  const summary=manualSelectedFundingSummary({...data,manualSelectedActivityIds:ids});
  const d=data.manualDraft||{},rows=manualFundingRowsForSelection(data);
  const source=ids.includes(data.manualActivityId)
    ? (data.collectionActivities||[]).find(a=>a.row_id===data.manualActivityId) : null;
  const showHourly=routeKey==='gefen';
  const selectedRows=manualConsolidatedActivityRows(data);
  const reviewed=Boolean(data.manualConsolidatedPreview||data.manualBatchPreviews?.length||data.manualPdf);
  const field=(label,key,type='text')=>`<label class="ds-fin-manual__field">${label}<input class="ds-input" type="${type}"${type==='email'?' multiple dir="ltr"':type==='number'?` min="${key==='quantity'?1:0}" step="${key==='quantity'?1:'0.01'}"`:''} data-finance-manual-field="${key}" value="${e(key==='customer_email'?normalizeManualRecipientEmails(d[key]):['amount','unit_price'].includes(key)?formatManualMoney(d[key],{unitPrice:key==='unit_price'}):d[key]??'')}"></label>`;
  const partial= data.manualScope==='partial';
  return `<div class="ds-fin-manual" dir="rtl">
    <section class="ds-fin-manual__section">
      <h3 data-finance-manual-heading>הפקה לפי גורם מימון</h3>
      <div class="ds-fin-manual__selectors">
      <label class="ds-fin-manual__payer-picker">גורם מימון<select class="ds-input" data-finance-manual-funding-category><option value="">בחירת גורם מימון</option>
        ${routes.map(r=>`<option value="${e(r.key)}"${r.key===routeKey?' selected':''}>${e(r.label)}</option>`).join('')}
      </select></label>
      ${route && (routeKey==='gefen'||routeKey==='authority')?`<label class="ds-fin-manual__payer-picker">${e(route.payerLabel)}<select class="ds-input" data-finance-manual-funder-filter><option value="">בחירת ${e(route.payerLabel)}</option>
        ${options.map(p=>`<option value="${e(p.key)}"${p.key===data.manualFunderFilter?' selected':''}>${e(p.displayLabel)}</option>`).join('')}
      </select></label>`:''}
      </div>
      ${payer && data.manualFunderFilter?`<label class="ds-fin-manual__search-picker">חיפוש פעילות<input class="ds-input" data-finance-manual-search value="${e(data.manualSearch)}" placeholder="שם פעילות, בית ספר או רשות"></label>
      <details class="ds-fin-manual__selection ds-fin-payer" data-finance-manual-selection>
        <summary data-finance-manual-selection-summary>${e(payer.displayLabel)} · ${activities.length} פעילויות · ${formatManualMoney(activities.reduce((n,a)=>n+manualActivityBalance(data,a.row_id),0))} ₪</summary>
        <div class="ds-fin-manual__selection-toolbar"><label class="ds-fin-manual__select-all"><input type="checkbox" data-finance-manual-select-all> סמן הכל</label>
          <span data-finance-manual-selection-count>${ids.length} פעילויות נבחרו</span></div>
        <div class="ds-fin-manual__activity-list" role="region" aria-label="פעילויות לבחירה" tabindex="0">
          <table class="ds-fin-manual__activity-table">
            <thead><tr><th scope="col" class="ds-fin-manual__activity-select-col">בחירה</th><th scope="col">בית ספר</th><th scope="col">רשות</th><th scope="col">פעילות</th><th scope="col">מספר גפ״ן</th><th scope="col">סכום לחיוב</th></tr></thead>
            <tbody>${activities.map(activity=>`<tr class="ds-fin-manual__activity-row">
              <td class="ds-fin-manual__activity-select-col"><input type="checkbox" data-finance-manual-select-activity aria-label="בחירת ${e(activity.activity_name)} · ${e(activity.school)}" value="${e(activity.row_id)}"${ids.includes(activity.row_id)?' checked':''}${manualActivityBillable(data,activity.row_id)?'':' disabled'}></td>
              <td class="ds-fin-manual__activity-school">${e(activity.school || '—')}</td>
              <td class="ds-fin-manual__activity-authority">${e(activity.authority || '—')}</td>
              <td class="ds-fin-manual__activity-title">${e(activity.activity_name)}${manualActivityBillable(data,activity.row_id)?'':'<small>אינה זמינה להפקה כעת</small>'}</td>
              <td class="ds-fin-manual__activity-gefen" dir="ltr">${e(activity.activity_no || '—')}</td>
              <td class="ds-fin-manual__activity-price">${formatManualMoney(manualActivityBalance(data,activity.row_id))} ₪</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      </details>`:''}
    </section>
    ${ids.length&&source?`<section class="ds-fin-manual__section">
      <h3>בדיקה והפקה</h3>
      <div class="ds-fin-manual__batch-total" data-finance-manual-batch-total><strong>${e(payer?.label||d.customer_name)} · ${summary.count} פעילויות · ${formatManualMoney(summary.amount)} ₪</strong></div>
      <form data-finance-manual-form class="ds-fin-manual__form">
        <label class="ds-fin-manual__control">היקף החיוב<select class="ds-input" data-finance-manual-scope>
          <option value="full"${partial?'':' selected'}>מלוא היתרה המותרת להפקה</option>
          <option value="partial"${partial?' selected':''}>חיוב חלקי לפי ביצוע</option>
        </select></label>
        ${ids.length>1?`<details class="ds-fin-manual__optional-edit"><summary>עריכת פעילות (לפי הצורך)</summary>
          <label class="ds-fin-manual__control">בחירת פעילות לעריכה<select class="ds-input" data-finance-manual-activity>${selectedRows.map(row=>`<option value="${e(row.id)}"${row.id===data.manualActivityId?' selected':''}>${e(row.activity)} · ${e(row.school)}</option>`).join('')}</select></label>
        </details>`:''}
        <fieldset class="ds-fin-manual__billing"><legend>פרטי חיוב</legend><div class="ds-fin-manual__billing-row${showHourly?' ds-fin-manual__billing-row--with-hourly':''}">
          ${manualService(data)?`${field('כמות','quantity','number')}${field('מחיר ליחידה','unit_price')}${field('סכום לחיוב','amount')}`:`
          <label class="ds-fin-manual__field">מפגשים לחיוב | סה״כ מפגשים
            <span class="ds-fin-manual__ratio" dir="ltr"><input class="ds-input" aria-label="מפגשים לחיוב" type="number" min="1" max="${Number(rows.find(r=>`${r.fundingSourceId}|${r.period||r.manualMonth}`===data.manualFundingKey)?.unbilledCount||d.planned_count)}" step="1" data-finance-manual-field="quantity"${d.billing_basis==='full_funding'?' readonly':''} value="${e(d.quantity)}"><span aria-hidden="true" class="ds-fin-manual__ratio-divider">|</span><output aria-label="סה״כ מפגשים">${e(d.planned_count)}</output></span>
          </label>
          <label class="ds-fin-manual__field">שעות לחיוב | סה״כ שעות
            <span class="ds-fin-manual__ratio" dir="ltr"><input class="ds-input" aria-label="שעות לחיוב" readonly value="${e(Number(Number(d.hours).toFixed(6)))}"><span aria-hidden="true" class="ds-fin-manual__ratio-divider">|</span><output aria-label="סה״כ שעות">${e(d.planned_hours)}</output></span>
          </label>
          <label class="ds-fin-manual__field">מחיר הפעילות<input class="ds-input" readonly value="${e(formatManualMoney(d.activity_price))}"></label>
          ${showHourly?`<label class="ds-fin-manual__field">מחיר שעתי מחושב<input class="ds-input" data-finance-manual-hourly-rate readonly value="${e(manualHourlyRate(d)===null?'—':formatManualMoney(manualHourlyRate(d)))}"></label>`:''}
          <label class="ds-fin-manual__field">סכום לחיוב<input class="ds-input" readonly value="${e(formatManualMoney(d.amount))}"></label>`}
        </div></fieldset>
        <details class="ds-fin-manual__selected-schools ds-fin-payer"><summary>הפעילויות בחשבון (${ids.length})</summary>
          <table class="ds-table"><thead><tr><th>פעילות</th><th>בית ספר</th><th>רשות</th><th>סכום לחיוב</th></tr></thead><tbody>
          ${selectedRows.map(row=>`<tr><td>${e(row.activity)}</td><td>${e(row.school)}</td><td>${e((data.collectionActivities||[]).find(a=>a.row_id===row.id)?.authority||'—')}</td><td>${partial&&['workshop','tour'].includes((data.collectionActivities||[]).find(a=>a.row_id===row.id)?.activity_type)&&data.manualActivityDrafts?.[row.id]?.draft.billing_basis==='performance'
            ?`<input class="ds-input" type="text" inputmode="decimal" data-finance-manual-line-amount="${e(row.id)}" value="${e(formatManualMoney(row.amount))}">`
            :`${formatManualMoney(row.amount)} ₪`}</td></tr>`).join('')}</tbody></table>
        </details>
        <div class="ds-fin-manual__contact-summary"><span>לקוח: ${e(d.customer_name)}</span><span dir="ltr">${e(d.customer_email)}</span></div>
        ${new Set(rows.map(r=>r.fundingSourceId)).size>1 || (d.billing_basis==='performance'&&rows.length>1)?`<label class="ds-fin-manual__control">חלק המימון<select class="ds-input" data-finance-manual-funding>${rows.map(r=>`<option value="${e(r.fundingSourceId+'|'+(r.period||r.manualMonth))}"${data.manualFundingKey===r.fundingSourceId+'|'+(r.period||r.manualMonth)?' selected':''}>${e(r.funding)}${d.billing_basis==='performance'?' · '+e((r.period||r.manualMonth)?.slice(0,7)||''):''}</option>`).join('')}</select></label>`:''}
        <details class="ds-fin-manual__extra ds-fin-payer"><summary>עריכת פרטי החשבון</summary>
          <div class="ds-fin-manual__grid">${field('שם הלקוח','customer_name')}${field('נמענים','customer_email','email')}${field(rows.some(r=>r.gefenFunding)?'סמל מוסד':'מספר לקוח (אם קיים)','institution_symbol')}
          ${ids.length===1?field('תיאור הפעילות','description'):''}${field('תאריך הפקה','issue_date','date')}${field('מועד תשלום','payment_due_date','date')}${field('סיבת חריגה','override_reason')}</div>
        </details>
        ${reviewed?'':'<div class="ds-fin-manual__actions"><button class="ds-btn ds-btn--primary" type="button" data-finance-manual-preview>הצגת החשבון לבדיקה (PDF)</button></div>'}
      </form>
    </section>`:''}
    ${data.manualActivityId ? `${data.manualConsolidatedPreview
      ? manualPdfReviewHtml({
          key:'consolidated',
          title:'טיוטת חשבון עסקה מרוכז',
          detail:`${data.manualConsolidatedPreview.quote.customer_name_snapshot || d.customer_name || ''} · ${data.manualConsolidatedPreview.items.length} פעילויות · ${formatManualMoney(data.manualConsolidatedPreview.quote.total_amount)} ₪`,
          confirmLabel:'אישור והפקת חשבון מרוכז'
        })
      : data.manualBatchPreviews?.length > 1
        ? `<div class="ds-fin-manual__batch-previews">
            <p>טיוטות נפרדות לבדיקה לפני ההפקה.</p>
            ${data.manualBatchPreviews.map((p,i)=>manualPdfReviewHtml({
              key:String(i), title:`טיוטת חשבון ${i+1}`,
              detail:(data.collectionActivities||[]).find(a=>a.row_id===p.activityId)?.school || p.activityId
            })).join('')}
            <div class="ds-fin-manual__review-actions">
              <button type="button" class="ds-btn ds-btn--primary" data-finance-manual-confirm>אישור והפקת ${data.manualBatchPreviews.length} חשבונות</button>
            </div>
          </div>`
        : data.manualPdf
          ? manualPdfReviewHtml({
              key:'single',
              title:'טיוטת חשבון עסקה',
              detail:data.manualQuote?.customer_name_snapshot || d.customer_name || '',
              confirmLabel:'אישור והפקת חשבון'
            })
          : ''}` : ''}</div>`;
}
export async function runManualAccount(data,api) {
  if(!data.manualQuote?.revision)throw Error('יש לפתוח תצוגה מקדימה עדכנית');
  data.manualRequestId ||= crypto.randomUUID();
  const account=await api.reserveFinanceManualAccount({...manualRequest(data),revision:data.manualQuote.revision,idempotencyKey:data.manualRequestId});
  try{return await api.dispatchFinanceTransactionAccount({accountId:account.id});}
  catch(error){
    if(api.cancelFinanceTransactionReservation) {
      try { await api.cancelFinanceTransactionReservation(account.id);data.manualRequestId=crypto.randomUUID(); }
      catch { /* keep the original identity if issuance succeeded or is still running */ }
    }
    throw error;
  }
}
