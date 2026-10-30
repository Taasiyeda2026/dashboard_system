import '../finance-transaction-page-data-hotfix.js';
import { manualAccountViewHtml } from './finance-manual-account.js';
import { escapeHtml } from './shared/html.js';
import { dsEmptyState, dsScreenStack, dsTableWrap } from './shared/layout.js';
import {
  TRANSACTION_MODE_AUTOMATIC,
  TRANSACTION_MODE_MANUAL,
  financeCycleCutoff,
  financeToday
} from './finance-transaction-accounts.js';

const text = (value) => String(value ?? '').trim();
const formatDate = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text(value));
  return match ? `${match[3]}.${match[2]}.${match[1]}` : text(value) || '—';
};
const formatAmount = (value) => {
  const amount = Number(value || 0);
  return `${amount.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₪`;
};

function statusLabel(status) {
  const value = text(status);
  return ({
    generating: 'בהפקה', issued: 'הופק', mail_draft_ready: 'טיוטת מייל הוכנה', sent: 'נשלח', cancelled: 'בוטל',
    pending: 'ממתין', draft_ready: 'טיוטה מוכנה', failed: 'נכשל', missing_recipient: 'חסר נמען',
    awaiting_payment: 'ממתין לתשלום', partially_paid: 'שולם חלקית', paid: 'שולם'
  })[value] || value || '—';
}

export function transactionMonth(data, mode) {
  const currentMonth = financeToday().slice(0, 7);
  const month = data.transactionMonths?.[mode] || currentMonth;
  return /^\d{4}-\d{2}$/.test(month) && month <= currentMonth ? month : currentMonth;
}

function monthPicker(data, mode) {
  return `<label class="ds-fin-collect-search"><span>${mode === TRANSACTION_MODE_AUTOMATIC ? 'חודש ביצוע' : 'חודש סיום הפעילות'}</span>
    <input class="ds-input" type="month" data-finance-transaction-month="${mode}" value="${transactionMonth(data, mode)}" max="${financeToday().slice(0, 7)}"></label>`;
}

export const transactionSelectionKey = (row) => [row.activityRowId, row.fundingSourceId, row.period || 'completion'].join(':');

export function transactionBacklog(data, mode) {
  const selected = transactionMonth(data, mode);
  return (data.transactionContext?.billingRows || []).filter((row) => row.gefenFunding === (mode === TRANSACTION_MODE_AUTOMATIC)
    && row.eligible && !row.blockedReason && row.period && row.period.slice(0, 7) < financeToday().slice(0, 7)
    && row.period.slice(0, 7) !== selected);
}

export function transactionIssuanceActivities(data, { mode = TRANSACTION_MODE_AUTOMATIC } = {}) {
  return (data.transactionContext?.billingRows || [])
    .filter((row) => row.gefenFunding === (mode === TRANSACTION_MODE_AUTOMATIC) || (!row.fundingSourceId && row.blockedReason))
    .filter((row) => row.period?.slice(0, 7) === transactionMonth(data, mode) || (!row.period && row.blockedReason))
    .map((row) => ({ row_id: row.activityRowId, transaction_summary: row }));
}

export function transactionPreviewForVisit(data, mode = TRANSACTION_MODE_AUTOMATIC) {
  const rows = transactionIssuanceActivities(data, { mode }).map((row) => row.transaction_summary);
  const accounts = new Map();
  if (!data.collectionError) for (const row of rows.filter((row) => row.eligible && !row.blockedReason)) {
    if (mode === TRANSACTION_MODE_MANUAL && !data.transactionManualSelected?.[transactionSelectionKey(row)]) continue;
    const key = [row.institutionSymbol, row.fundingSourceId, row.payerKey || row.payerName, row.period || 'completion'].join(':');
    if (!accounts.has(key)) accounts.set(key, { institutionSymbol: row.institutionSymbol, customerName: row.payerName,
      schoolName: row.customerName, funding: row.funding, period: row.period, customerEmails: [], lines: [], totalAmount: 0 });
    const account = accounts.get(key);
    account.lines.push(row);
    account.totalAmount += Number(row.issuableAmount);
    if (row.customerEmail && !account.customerEmails.includes(row.customerEmail)) account.customerEmails.push(row.customerEmail);
  }
  const result = [...accounts.values()];
  return { mode, cutoff: mode === TRANSACTION_MODE_MANUAL ? financeToday() : financeCycleCutoff(), accounts: result,
    blocked: rows.filter((row) => row.blockedReason), deferred: rows.filter((row) => !row.eligible && !row.blockedReason),
    totals: { schools: new Set(result.map((row) => row.institutionSymbol)).size,
      activities: new Set(result.flatMap((account) => account.lines.map((line) => line.activityRowId))).size,
      meetings: result.reduce((sum, a) => sum + a.lines.reduce((n, l) => n + l.unbilledCount, 0), 0),
      hours: result.reduce((sum, a) => sum + a.lines.reduce((n, l) => n + l.unbilledHours, 0), 0),
      amount: result.reduce((sum, a) => sum + a.totalAmount, 0) } };
}

function summaryCards(preview) {
  const cards = [
    ['בתי ספר', preview.totals.schools],
    ['פעילויות', preview.totals.activities],
    ['מפגשים לחיוב', preview.totals.meetings],
    ['שעות לחיוב', preview.totals.hours],
    ['סכום להפקה', formatAmount(preview.totals.amount)]
  ];
  return `<div class="ds-fin-transaction-summary" dir="rtl" style="display:grid;grid-template-columns:repeat(5,140px);gap:8px;justify-content:center;width:fit-content;max-width:100%;margin:12px auto 16px;">
    ${cards.map(([label, value]) => `
      <article class="ds-fin-collect-summary-card" style="box-sizing:border-box;width:140px;min-height:62px;padding:9px 10px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;">
        <span class="ds-fin-collect-summary-card__label" style="font-size:12px;line-height:1.25;white-space:nowrap;">${escapeHtml(label)}</span>
        <strong class="ds-fin-collect-summary-card__value" style="font-size:20px;line-height:1.2;margin-top:4px;white-space:nowrap;">${escapeHtml(String(value))}</strong>
      </article>
    `).join('')}
  </div>`;
}

function billingLineHtml(line, data, mode) {
  const select = mode === TRANSACTION_MODE_MANUAL
    ? `<input type="checkbox" aria-label="בחירת ${escapeHtml(line.activityName)}" data-finance-transaction-select="${escapeHtml(transactionSelectionKey(line))}"${data.transactionManualSelected?.[transactionSelectionKey(line)] ? ' checked' : ''}>` : '';
  return `<tr><td>${select}${escapeHtml(line.activityName || line.activityRowId)}</td>
    <td>${escapeHtml(line.customerName || '—')}</td><td>${escapeHtml(line.period?.slice(0, 7) || 'סיום פעילות')}</td>
    <td>${escapeHtml(`מתוכנן ${line.plannedCount} · בוצע ${line.completedCount} · חויב ${line.billedCount} · יתרה ${line.unbilledCount}`)}</td>
    <td>${escapeHtml(formatAmount(line.fundingAmount))}</td><td>${escapeHtml(formatAmount(line.issuableAmount))}<details><summary>פירוט מפגשים</summary>${line.unbilledSlots.map((slot) => `<div>מפגש ${slot.slot} · ${escapeHtml(formatDate(slot.date))} · 1.5 שעות</div>`).join('')}</details></td></tr>`;
}

function pendingGroupHtml(rows, data, mode) {
  const groups = new Map();
  for (const row of rows) {
    const key = [row.period, mode === TRANSACTION_MODE_AUTOMATIC ? row.institutionSymbol : (row.payerKey || row.fundingSourceId)].join(':');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()].sort((a,b) => a[0].period.localeCompare(b[0].period)).map((lines) => {
    const row = lines[0];
    return `<details class="ds-fin-payer"><summary>${escapeHtml(row.period.slice(0,7))} · ${escapeHtml(mode === TRANSACTION_MODE_AUTOMATIC ? `${row.customerName} · ${row.institutionSymbol}` : row.payerName)} · ${lines.length} חיובים · ${escapeHtml(formatAmount(lines.reduce((sum,line) => sum + Number(line.issuableAmount),0)))}</summary>
      ${dsTableWrap(`<table class="ds-table" dir="rtl"><thead><tr><th>פעילות</th><th>מוסד</th><th>${mode === TRANSACTION_MODE_AUTOMATIC ? 'חודש ביצוע' : 'חודש סיום'}</th><th>מפגשים</th><th>חלק המממן</th><th>להפקה</th></tr></thead><tbody>${lines.map((line) => billingLineHtml(line,data,mode)).join('')}</tbody></table>`)}
      <button type="button" class="ds-btn ds-btn--primary" data-finance-transaction-run="${mode}" data-finance-transaction-period="${row.period.slice(0,7)}">${mode === TRANSACTION_MODE_AUTOMATIC ? 'הפק חשבונות לחודש זה' : 'הפק חשבונות מסומנים לחודש זה'}</button></details>`;
  }).join('');
}

function billingView(data, mode) {
  const preview = transactionPreviewForVisit(data, mode);
  const backlog = transactionBacklog(data, mode);
  const rows = transactionIssuanceActivities(data, { mode }).map((row) => row.transaction_summary);
  const ready = rows.filter((row) => row.eligible && !row.blockedReason);
  const groups = new Map();
  for (const row of ready) {
    const key = mode === TRANSACTION_MODE_AUTOMATIC ? row.institutionSymbol : (row.payerKey || row.fundingSourceId);
    if (!groups.has(key)) groups.set(key, { payer: mode === TRANSACTION_MODE_AUTOMATIC ? `${row.customerName} · ${row.institutionSymbol}` : row.payerName, funding: row.funding, lines: [] });
    groups.get(key).lines.push(row);
  }
  const body = [...groups.values()].map((group) => `<details class="ds-fin-payer" open>
    <summary><span class="ds-fin-payer__title">${escapeHtml(group.payer)}</span>
    <span class="ds-fin-payer__meta">${escapeHtml(`${new Set(group.lines.map((line) => line.activityRowId)).size} פעילויות · ${group.lines.reduce((sum, line) => sum + line.unbilledCount, 0)} מפגשים · ${group.lines.reduce((sum, line) => sum + line.unbilledHours, 0)} שעות · ${formatAmount(group.lines.reduce((sum, line) => sum + Number(line.issuableAmount), 0))}`)}</span></summary>
    ${dsTableWrap(`<table class="ds-table" dir="rtl"><thead><tr><th>פעילות</th><th>מוסד</th><th>${mode === TRANSACTION_MODE_AUTOMATIC ? 'חודש ביצוע' : 'חודש סיום'}</th><th>מפגשים</th><th>חלק המממן</th><th>להפקה</th></tr></thead>
    <tbody>${group.lines.map((line) => billingLineHtml(line, data, mode)).join('')}</tbody></table>`)}</details>`).join('');
  // Keep eligibility reasons in server-side validation; they are not accounting documents.
  // The issuance screen shows only issuable accounts, not technical diagnostics.
  const total = { ...preview, totals: { schools: new Set(ready.map((row) => row.institutionSymbol)).size,
    activities: new Set(ready.map((row) => row.activityRowId)).size,
    meetings: ready.reduce((sum, row) => sum + row.unbilledCount, 0), hours: ready.reduce((sum, row) => sum + row.unbilledHours, 0),
    amount: ready.reduce((sum, row) => sum + Number(row.issuableAmount), 0) } };
  const backlogHtml = backlog.length
    ? `<details class="ds-fin-payer" open><summary>ממתינים להפקה מחודשים קודמים · ${backlog.length} חיובים · ${escapeHtml(formatAmount(backlog.reduce((sum,row) => sum + Number(row.issuableAmount),0)))}</summary>
      ${pendingGroupHtml(backlog,data,mode)}</details>`
    : '';
  return `<div class="ds-fin-collect-toolbar" dir="rtl">
    <strong>${mode === TRANSACTION_MODE_AUTOMATIC ? 'חשבונות עסקה - גפן' : 'חשבונות עסקה - פתוח'}</strong>
    ${preview.accounts.length ? `<button type="button" class="ds-btn ds-btn--primary" data-finance-transaction-run="${mode}">${mode === TRANSACTION_MODE_AUTOMATIC ? 'הפק את סבב חשבונות העסקה' : 'הפק חשבונות מסומנים'}</button>` : ''}</div>
    ${backlogHtml}
    ${monthPicker(data, mode)}
    ${ready.length ? summaryCards(total) : ''}
    ${body || dsEmptyState('אין חשבונות להפקה בחודש שנבחר.')}`;
}

function historyView(data) {
  const accounts = (data.transactionContext?.accounts || []).slice().sort((a, b) => Number(b.transaction_account_number || 0) - Number(a.transaction_account_number || 0));
  if (!accounts.length) return dsEmptyState('טרם הופקו חשבונות עסקה.');
  return accounts.map((account) => {
    const balance = data.paymentContext?.balances?.find(row => row.accountId === account.id);
    const actualCollectionStatus = balance ? Number(balance.balance) <= 0 ? 'paid' : Number(balance.paidAmount) > 0 ? 'partially_paid' : 'awaiting_payment' : account.collection_status;
    const lines = (account.finance_transaction_account_lines || []).map((line) => `<tr>
      <td>${escapeHtml(line.activity_name_snapshot || '—')}</td>
      <td>${escapeHtml(line.funding_snapshot || '—')} · ${escapeHtml(line.school_name_snapshot || '')}</td>
      <td>${escapeHtml(String(line.billed_hours || 0))}</td>
      <td>${escapeHtml(formatAmount(line.amount))}</td>
    </tr>`).join('');
    const pdf = account.sharepoint_web_url
      ? `<a class="ds-btn ds-btn--ghost ds-btn--sm" href="${escapeHtml(account.sharepoint_web_url)}" target="_blank" rel="noopener">פתח PDF</a>`
      : '';
    return `<details class="ds-fin-payer">
      <summary><span class="ds-fin-payer__title">חשבון ${escapeHtml(String(account.transaction_account_number))} · ${escapeHtml(account.customer_name_snapshot || '')}</span><span class="ds-fin-payer__meta">${escapeHtml(`${formatDate(account.issue_date)} · ${formatAmount(account.total_amount)}`)}</span></summary>
      <div style="padding:10px 12px;display:flex;gap:16px;flex-wrap:wrap">
        <span>לתשלום עד: <strong>${escapeHtml(formatDate(account.payment_due_date))}</strong></span>
        <span>מסמך: <strong>${escapeHtml(statusLabel(account.document_status))}</strong></span>
        <span>Outlook: <strong>${escapeHtml(statusLabel(account.outlook_status))}</strong></span>
        <span>גבייה: <strong>${escapeHtml(statusLabel(actualCollectionStatus))}</strong></span>
        ${balance ? `<span>שולם: ${escapeHtml(formatAmount(balance.paidAmount))} · יתרה: ${escapeHtml(formatAmount(balance.balance))}</span>` : ''}
        ${pdf}
        ${data.financeAdmin && account.document_status !== 'cancelled' ? `<button class="ds-btn ds-btn--ghost" data-finance-account-cancel="${escapeHtml(account.id)}">ביטול חשבון</button>` : ''}
        ${account.cancellation_reason ? `<span>${escapeHtml(account.cancellation_reason)}</span>` : ''}
      </div>
      ${dsTableWrap(`<table class="ds-table" dir="rtl"><thead><tr><th>פעילות</th><th>גורם מימון</th><th>שעות</th><th>סכום</th></tr></thead><tbody>${lines}</tbody></table>`)}
    </details>`;
  }).join('');
}

export function transactionAccountsViewHtml(data, backBarHtml) {
  const tab = ['manual', 'history', 'editable'].includes(data.transactionTab) ? data.transactionTab : 'automatic';
  const action = data.transactionActionMessage
    ? `<div class="ds-empty-state" style="margin-bottom:12px">${escapeHtml(data.transactionActionMessage)}</div>`
    : '';
  const body = data.collectionError ? dsEmptyState(data.collectionError) : tab === 'history' ? historyView(data) : tab === 'editable' ? manualAccountViewHtml(data) : billingView(data, tab);
  return dsScreenStack(`
    ${backBarHtml('חשבונות עסקה')}
    <div class="ds-fin-collect-shell" dir="rtl">
      ${action}
      <div class="ds-fin-tabs" role="tablist" style="margin-bottom:14px">
        <button type="button" class="ds-fin-tab${tab === 'automatic' ? ' is-active' : ''}" data-finance-transaction-tab="automatic">חשבונות עסקה - גפן</button>
        <button type="button" class="ds-fin-tab${tab === 'manual' ? ' is-active' : ''}" data-finance-transaction-tab="manual">חשבונות עסקה - פתוח</button>
        <button type="button" class="ds-fin-tab${tab === 'history' ? ' is-active' : ''}" data-finance-transaction-tab="history">היסטוריה</button>
        <button type="button" class="ds-fin-tab${tab === 'editable' ? ' is-active' : ''}" data-finance-transaction-tab="editable">הפקה ידנית</button>
      </div>
      ${body}
    </div>
  `);
}

function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

export async function runTransactionIssuance(data, api, mode, month = transactionMonth(data, mode)) {
  const scoped = { ...data, transactionMonths: { ...data.transactionMonths, [mode]: month } };
  const preview = transactionPreviewForVisit(scoped, mode);
  if (!preview.accounts.length) throw new Error('אין חשבונות מוכנים להפקה.');
  const results = [];
  for (const account of preview.accounts) {
    const reserved = await api.reserveFinanceTransactionAccount({
      idempotencyKey: uuid(),
      cutoffDate: preview.cutoff,
      institutionSymbol: account.institutionSymbol,
      customerName: account.customerName,
      customerEmail: (account.customerEmails || []).join(';'),
      lines: account.lines.map((line) => ({
        activity_row_id: line.activityRowId,
        funding_source_id: line.fundingSourceId,
        performance_month: line.period,
        expected_amount: line.issuableAmount,
        meeting_slots: line.unbilledSlots.map((slot) => slot.slot),
        issue_mode: mode
      }))
    });
    let dispatched;
    try { dispatched = await api.dispatchFinanceTransactionAccount({ accountId: reserved.id }); }
    catch (error) {
      // Safe server cancellation refuses issued accounts and active dispatch leases.
      await api.cancelFinanceTransactionReservation?.(reserved.id).catch(() => {});
      throw error;
    }
    results.push({ reserved, dispatched });
  }
  return results;
}

export function handleTransactionSelection(data, rowId, checked) {
  data.transactionManualSelected = { ...(data.transactionManualSelected || {}), [text(rowId)]: checked === true };
}
