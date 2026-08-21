import { escapeHtml } from './shared/html.js';
import { dsEmptyState, dsScreenStack, dsTableWrap } from './shared/layout.js';
import { activityRowId, money } from './finance-collection.js';
import {
  TRANSACTION_MODE_AUTOMATIC,
  TRANSACTION_MODE_MANUAL,
  buildTransactionPreview,
  financeCycleCutoff,
  financeToday,
  transactionActivitySummary
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

function contextMaps(data) {
  const accounts = data.transactionContext?.accounts || [];
  const cancelledByActivity = {};
  for (const row of data.transactionContext?.cancelled || []) {
    const key = text(row.activity_id);
    if (!key) continue;
    (cancelledByActivity[key] ||= []).push(row.meeting_date);
  }
  const billedSlotsByActivity = {};
  const billedAmountByActivity = {};
  for (const account of accounts) {
    if (account.document_status === 'cancelled') continue;
    for (const line of account.finance_transaction_account_lines || []) {
      const key = text(line.activity_row_id);
      if (!key) continue;
      billedAmountByActivity[key] = (billedAmountByActivity[key] || 0) + Number(line.amount || 0);
      for (const meeting of line.finance_transaction_account_meetings || []) {
        (billedSlotsByActivity[key] ||= []).push(Number(meeting.meeting_slot));
      }
    }
  }
  return { cancelledByActivity, billedSlotsByActivity, billedAmountByActivity };
}

export function transactionIssuanceActivities(data, { mode = TRANSACTION_MODE_AUTOMATIC, cutoff } = {}) {
  const schoolMap = new Map((data.transactionContext?.schools || []).map((row) => [String(row.id), row]));
  const maps = contextMaps(data);
  const effectiveCutoff = cutoff || (mode === TRANSACTION_MODE_MANUAL ? financeToday() : financeCycleCutoff());
  return (data.collectionActivities || []).map((activity) => {
    const school = schoolMap.get(String(activity.school_id));
    const enriched = { ...activity, semel_mosad: school?.semel_mosad || '' };
    return {
      ...enriched,
      transaction_summary: transactionActivitySummary(enriched, {
        cutoff: effectiveCutoff,
        cancelledDates: maps.cancelledByActivity[activityRowId(activity)] || [],
        billedSlots: maps.billedSlotsByActivity[activityRowId(activity)] || [],
        billedAmount: maps.billedAmountByActivity[activityRowId(activity)] || 0,
        mode
      })
    };
  });
}

export function transactionPreviewForVisit(data, mode = TRANSACTION_MODE_AUTOMATIC) {
  const effectiveMode = mode === TRANSACTION_MODE_MANUAL ? TRANSACTION_MODE_MANUAL : TRANSACTION_MODE_AUTOMATIC;
  const cutoff = effectiveMode === TRANSACTION_MODE_MANUAL ? financeToday() : financeCycleCutoff();
  const maps = contextMaps(data);
  const schoolMap = new Map((data.transactionContext?.schools || []).map((row) => [String(row.id), row]));
  const activities = (data.collectionActivities || []).map((activity) => ({
    ...activity,
    semel_mosad: schoolMap.get(String(activity.school_id))?.semel_mosad || ''
  }));
  const activityIds = effectiveMode === TRANSACTION_MODE_MANUAL
    ? Object.entries(data.transactionManualSelected || {}).filter(([, checked]) => checked).map(([id]) => id)
    : [];
  return buildTransactionPreview(activities, {
    mode: effectiveMode,
    cutoff,
    activityIds,
    ...maps
  });
}

function summaryCards(preview) {
  const cards = [
    ['בתי ספר', preview.totals.schools],
    ['פעילויות', preview.totals.activities],
    ['מפגשים לחיוב', preview.totals.meetings],
    ['שעות לחיוב', preview.totals.hours],
    ['סכום להפקה', formatAmount(preview.totals.amount)]
  ];
  return `<div class="ds-fin-collect-summary" dir="rtl">${cards.map(([label, value]) => `
    <article class="ds-fin-collect-summary-card"><span class="ds-fin-collect-summary-card__label">${escapeHtml(label)}</span><strong class="ds-fin-collect-summary-card__value">${escapeHtml(String(value))}</strong></article>
  `).join('')}</div>`;
}

function accountPreviewHtml(account) {
  const emails = account.customerEmails?.length ? account.customerEmails.join(', ') : 'חסר נמען';
  const rows = account.lines.map((line) => `<tr>
    <td>${escapeHtml(line.customerName || account.customerName || '—')}</td>
    <td>${escapeHtml(line.funding || '—')}</td>
    <td>${escapeHtml(line.activityRowId || '—')}</td>
    <td>${escapeHtml(`${line.unbilledCount} מפגשים`)}</td>
    <td>${escapeHtml(`${line.unbilledHours} שעות`)}</td>
    <td>${escapeHtml(formatAmount(line.issuableAmount))}</td>
  </tr>`).join('');
  return `<details class="ds-fin-payer" open>
    <summary><span class="ds-fin-payer__title">${escapeHtml(account.customerName || 'בית ספר')}</span><span class="ds-fin-payer__meta">${escapeHtml(`${account.institutionSymbol} · ${formatAmount(account.totalAmount)}`)}</span></summary>
    <div style="padding:10px 12px"><strong>נמען:</strong> ${escapeHtml(emails)}</div>
    ${dsTableWrap(`<table class="ds-table" dir="rtl"><thead><tr><th>בית ספר</th><th>גורם מימון</th><th>פעילות</th><th>מפגשים</th><th>שעות</th><th>סכום</th></tr></thead><tbody>${rows}</tbody></table>`)}
  </details>`;
}

function automaticView(data) {
  const preview = transactionPreviewForVisit(data, TRANSACTION_MODE_AUTOMATIC);
  const body = preview.accounts.length
    ? preview.accounts.map(accountPreviewHtml).join('')
    : dsEmptyState('אין כרגע חשבונות גפן הזכאים להפקה בסבב החודשי.');
  return `
    <div class="ds-fin-collect-toolbar" dir="rtl">
      <div><strong>סבב גפן אוטומטי</strong><br><small>נקודת חיתוך: ${escapeHtml(formatDate(preview.cutoff))}. נכללים גפן וכל שילוב הכולל גפן בלבד.</small></div>
      <button type="button" class="ds-btn ds-btn--primary" data-finance-transaction-run="automatic"${preview.accounts.length ? '' : ' disabled'}>הפק את סבב חשבונות העסקה</button>
    </div>
    ${summaryCards(preview)}
    ${body}`;
}

function manualView(data) {
  const rows = transactionIssuanceActivities(data, { mode: TRANSACTION_MODE_MANUAL, cutoff: financeToday() })
    .filter((row) => row.transaction_summary.manualEligible || row.transaction_summary.blockedReason)
    .map((row) => {
      const tx = row.transaction_summary;
      const checked = data.transactionManualSelected?.[activityRowId(row)] === true;
      const disabled = tx.blockedReason || !tx.manualEligible;
      return `<tr>
        <td><input type="checkbox" data-finance-transaction-select="${escapeHtml(activityRowId(row))}"${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}></td>
        <td>${escapeHtml(row.school || '—')}</td>
        <td>${escapeHtml(row.activity_name || '—')}</td>
        <td>${escapeHtml(row.funding || '—')}</td>
        <td>${escapeHtml(row.semel_mosad || '—')}</td>
        <td>${escapeHtml(row.contact_email || 'חסר')}</td>
        <td>${escapeHtml(`${tx.unbilledCount} | ${tx.unbilledHours} | ${money(tx.unbilledAmount)}`)}</td>
        <td>${escapeHtml(tx.blockedReason || 'מוכן להפקה ידנית')}</td>
      </tr>`;
    }).join('');
  const preview = transactionPreviewForVisit(data, TRANSACTION_MODE_MANUAL);
  return `
    <div class="ds-fin-collect-toolbar" dir="rtl">
      <div><strong>הפקה ידנית</strong><br><small>זמינה לכל גורמי המימון. החשבון כולל את כל המפגשים שבוצעו וטרם חויבו עד היום.</small></div>
      <button type="button" class="ds-btn ds-btn--primary" data-finance-transaction-run="manual"${preview.accounts.length ? '' : ' disabled'}>הפק חשבונות מסומנים</button>
    </div>
    ${summaryCards(preview)}
    ${rows ? dsTableWrap(`<table class="ds-table" dir="rtl"><thead><tr><th></th><th>בית ספר</th><th>פעילות</th><th>גורם מימון</th><th>סמל מוסד</th><th>נמען</th><th>בוצע וטרם חויב</th><th>מצב</th></tr></thead><tbody>${rows}</tbody></table>`) : dsEmptyState('אין פעילויות עם ביצוע שטרם חויב.')} `;
}

function historyView(data) {
  const accounts = (data.transactionContext?.accounts || []).slice().sort((a, b) => Number(b.transaction_account_number || 0) - Number(a.transaction_account_number || 0));
  if (!accounts.length) return dsEmptyState('טרם הופקו חשבונות עסקה.');
  return accounts.map((account) => {
    const lines = (account.finance_transaction_account_lines || []).map((line) => `<tr>
      <td>${escapeHtml(line.activity_name_snapshot || '—')}</td>
      <td>${escapeHtml(line.funding_snapshot || '—')}</td>
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
        <span>גבייה: <strong>${escapeHtml(statusLabel(account.collection_status))}</strong></span>
        ${pdf}
      </div>
      ${dsTableWrap(`<table class="ds-table" dir="rtl"><thead><tr><th>פעילות</th><th>גורם מימון</th><th>שעות</th><th>סכום</th></tr></thead><tbody>${lines}</tbody></table>`)}
    </details>`;
  }).join('');
}

export function transactionAccountsViewHtml(data, backBarHtml) {
  const tab = ['manual', 'history'].includes(data.transactionTab) ? data.transactionTab : 'automatic';
  const action = data.transactionActionMessage
    ? `<div class="ds-empty-state" style="margin-bottom:12px">${escapeHtml(data.transactionActionMessage)}</div>`
    : '';
  const body = tab === 'manual' ? manualView(data) : tab === 'history' ? historyView(data) : automaticView(data);
  return dsScreenStack(`
    ${backBarHtml('חשבונות עסקה')}
    <div class="ds-fin-collect-shell" dir="rtl">
      ${action}
      <div class="ds-fin-tabs" role="tablist" style="margin-bottom:14px">
        <button type="button" class="ds-fin-tab${tab === 'automatic' ? ' is-active' : ''}" data-finance-transaction-tab="automatic">סבב גפן</button>
        <button type="button" class="ds-fin-tab${tab === 'manual' ? ' is-active' : ''}" data-finance-transaction-tab="manual">הפקה ידנית</button>
        <button type="button" class="ds-fin-tab${tab === 'history' ? ' is-active' : ''}" data-finance-transaction-tab="history">היסטוריה</button>
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

export async function runTransactionIssuance(data, api, mode) {
  const preview = transactionPreviewForVisit(data, mode);
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
        meeting_slots: line.unbilledSlots.map((slot) => slot.slot),
        issue_mode: mode
      }))
    });
    const dispatched = await api.dispatchFinanceTransactionAccount({ accountId: reserved.id });
    results.push({ reserved, dispatched });
  }
  return results;
}

export function handleTransactionSelection(data, rowId, checked) {
  data.transactionManualSelected = { ...(data.transactionManualSelected || {}), [text(rowId)]: checked === true };
}
