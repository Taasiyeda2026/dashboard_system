import {invoiceRevisionEditorHtml,invoiceRevisionAdminHtml} from './finance-invoice-revisions.js';
import '../finance-transaction-page-data-hotfix.js';
import { manualAccountViewHtml } from './finance-manual-account.js';
import { financeError } from './finance-errors.js';
import { escapeHtml } from './shared/html.js';
import { dsEmptyState, dsScreenStack, dsTableWrap } from './shared/layout.js';
import {
  TRANSACTION_MODE_AUTOMATIC,
  TRANSACTION_MEETING_HOURS,
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
    pending: 'ממתין ליצירת טיוטה', waiting_connection: 'ממתין לחיבור Microsoft', draft_ready: 'טיוטה מוכנה', failed: 'שגיאה הדורשת טיפול', missing_recipient: 'חסר נמען',
    needs_review:'נדרשת בדיקה לפני ניסיון נוסף', already_sent:'ההודעה כבר נשלחה מתיבת Outlook',
    awaiting_payment: 'ממתין לתשלום', partially_paid: 'שולם חלקית', paid: 'שולם'
  })[value] || value || '—';
}

export function transactionYearStart(data) {
  const year=Number(/school_(\d{4})/.exec(data.collectionPeriod || 'school_2027')?.[1]);
  return `${year-1}-09`;
}
export function transactionMonth(data, mode, now = new Date()) {
  const lastClosed=financeCycleCutoff(now).slice(0,7);
  const month=data.transactionMonths?.[mode];
  return /^\d{4}-\d{2}$/.test(month||'') && month<=lastClosed && month>=transactionYearStart(data) ? month : lastClosed;
}
function monthPicker(data, mode) {
  return `<label class="ds-fin-collect-search"><span>חודש ביצוע</span>
    <input class="ds-input" type="month" data-finance-transaction-month="${mode}" value="${transactionMonth(data,mode)}" min="${transactionYearStart(data)}" max="${financeCycleCutoff().slice(0,7)}"></label>`;
}

export const transactionSelectionKey = (row) => [row.activityRowId, row.fundingSourceId, row.period || 'completion'].join(':');
const serviceActivity = (row) => ['tour','workshop'].includes(text(row.activityType || row.activity_type).toLowerCase());
const invoiceQuantity = (row) => Number(row.unbilledCount || 0);
function progressHeading(lines) {
  const units = lines.some(serviceActivity);
  const courses = lines.some(row => !serviceActivity(row));
  return units ? (courses ? 'מפגשים / כמות' : 'כמות') : 'מפגשים';
}
function compactNumber(value) {
  return Number(Number(value || 0).toFixed(6)).toLocaleString('he-IL', { maximumFractionDigits: 6 });
}
function activityMeetings(row) {
  return serviceActivity(row) ? `כמות ${compactNumber(invoiceQuantity(row))}` : `${compactNumber(row.unbilledCount)}/${compactNumber(row.plannedCount)}`;
}
function activityHours(row) {
  return serviceActivity(row) ? '—' : `${compactNumber(row.unbilledHours)}/${compactNumber(row.plannedHours ?? row.plannedCount * TRANSACTION_MEETING_HOURS)}`;
}

function groupProgress(lines) {
  const courses = lines.filter(row => !serviceActivity(row));
  const services = lines.filter(serviceActivity);
  return [
    `${new Set(lines.map(row => row.activityRowId)).size} פעילויות`,
    ...(courses.length ? [`${courses.reduce((sum,row)=>sum+Number(row.unbilledCount||0),0)} מפגשים`,
      `${courses.reduce((sum,row)=>sum+Number(row.unbilledHours||0),0)} שעות`] : []),
    ...(services.length ? [`${services.reduce((sum,row)=>sum+invoiceQuantity(row),0)} סדנאות/סיורים`] : [])
  ].join(' · ');
}


export function transactionBacklog(data, mode) {
  const selected = transactionMonth(data, mode);
  return (data.transactionContext?.billingRows || []).filter((row) => row.gefenFunding === (mode === TRANSACTION_MODE_AUTOMATIC)
    && row.eligible && !row.blockedReason && row.period
    && row.period.slice(0,7)>=transactionYearStart(data) && row.period.slice(0,7)<selected);
}

export function transactionIssuanceActivities(data, { mode = TRANSACTION_MODE_AUTOMATIC } = {}) {
  return (data.transactionContext?.billingRows || [])
    .filter((row) => row.gefenFunding === (mode === TRANSACTION_MODE_AUTOMATIC) || (!row.fundingSourceId && row.blockedReason))
    .filter((row) => row.period?.slice(0,7)>=transactionYearStart(data) && row.period?.slice(0, 7) === transactionMonth(data, mode) || (!row.period && row.blockedReason))
    .map((row) => ({ row_id: row.activityRowId, transaction_summary: row }));
}

// An automatic Gefen batch must expose every mixed-funded activity and its
// actual program number before it can reserve invoice numbers. The review is
// drawn from the same billing snapshot as the invoice, not a course-name map.
export function automaticMixedFundingProgramReview(data, month) {
  const scoped = { ...data, transactionMonths: { ...data.transactionMonths, automatic: month } };
  const preview = transactionPreviewForVisit(scoped, TRANSACTION_MODE_AUTOMATIC);
  const allRows = data.transactionContext?.billingRows || [];
  const activities = data.collectionActivities || [];
  const seen = new Set();
  const result = [];
  for (const account of preview.accounts) for (const line of account.lines) {
    const activityId = String(line.activityRowId || '');
    if (!activityId || seen.has(activityId)) continue;
    const hasOtherFunding = allRows.some(row => row.activityRowId === activityId
      && row.fundingSourceId && row.fundingSourceId !== line.fundingSourceId
      && row.gefenFunding === false);
    if (!hasOtherFunding) continue;
    seen.add(activityId);
    const activity = activities.find(row => String(row.row_id) === activityId);
    const code = String(line.gefenNumber || '').trim();
    const sourceCode = String(activity?.gefen_number || activity?.activity_no || '').trim();
    result.push({
      activityId,
      school: String(activity?.school || line.customerName || account.schoolName || ''),
      course: String(line.activityName || ''),
      code,
      sourceCode,
      valid: /^\d+$/.test(code) && (!sourceCode || sourceCode === code)
    });
  }
  return result;
}

export function transactionPreviewForVisit(data, mode = TRANSACTION_MODE_AUTOMATIC) {
  const selected = transactionIssuanceActivities(data, { mode }).map((row) => row.transaction_summary);
  const candidates=[...selected,...transactionBacklog(data,mode)];
  const rows=[...new Map(candidates.map(row=>[JSON.stringify([transactionSelectionKey(row),row.institutionSymbol,row.payerKey || row.payerName]),row])).values()];
  const accounts = new Map();
  if (!data.collectionError) for (const row of rows.filter((row) => row.eligible && !row.blockedReason)) {
    // Gefen remains per school. Every other payer gets one account across schools.
    const key = mode === TRANSACTION_MODE_AUTOMATIC
      ? [row.institutionSymbol, row.fundingSourceId, row.payerKey || row.payerName, row.period || 'completion'].join(':')
      : [row.fundingSourceId, row.payerKey || row.payerName, row.period || 'completion'].join(':');
    if (!accounts.has(key)) accounts.set(key, { institutionSymbol: mode === TRANSACTION_MODE_AUTOMATIC ? row.institutionSymbol : '', customerName: row.payerName,
      schoolName: row.customerName, funding: row.funding, period: row.period, customerEmails: [], lines: [], totalAmount: 0 });
    const account = accounts.get(key);
    account.lines.push(row);
    account.totalAmount += Number(row.issuableAmount);
    if (row.customerEmail && !account.customerEmails.includes(row.customerEmail)) account.customerEmails.push(row.customerEmail);
  }
  const result = [...accounts.values()];
  for (const account of result) {
    const schools = new Set(account.lines.map(row => String(row.financeSchoolId || row.institutionSymbol || row.customerName || '')).filter(Boolean));
    // A consolidated sponsor/authority invoice covering different schools
    // must not be addressed to contacts of the other schools.
    if (schools.size > 1) account.customerEmails = [];
    else account.customerEmails = [...new Map(account.customerEmails
      .flatMap(email => String(email).split(/[;,]/))
      .map(email => email.trim()).filter(Boolean)
      .map(email => [email.toLowerCase(), email])).values()];
  }
  return { mode, cutoff: mode === TRANSACTION_MODE_MANUAL ? financeToday() : financeCycleCutoff(), accounts: result,
    blocked: rows.filter((row) => row.blockedReason), deferred: rows.filter((row) => !row.eligible && !row.blockedReason),
    totals: { schools: new Set(result.map((row) => row.institutionSymbol)).size,
      activities: new Set(result.flatMap((account) => account.lines.map((line) => line.activityRowId))).size,
      meetings: result.reduce((sum, a) => sum + a.lines.filter(l => !serviceActivity(l)).reduce((n, l) => n + Number(l.unbilledCount || 0), 0), 0),
      hours: result.reduce((sum, a) => sum + a.lines.filter(l => !serviceActivity(l)).reduce((n, l) => n + Number(l.unbilledHours || 0), 0), 0),
      units: result.reduce((sum, a) => sum + a.lines.filter(serviceActivity).reduce((n, l) => n + invoiceQuantity(l), 0), 0),
      containsCourses: result.some(a => a.lines.some(l => !serviceActivity(l))),
      containsUnits: result.some(a => a.lines.some(serviceActivity)),
      amount: result.reduce((sum, a) => sum + a.totalAmount, 0) } };
}

function summaryCards(preview) {
  const cards = [
    ['חשבונות עסקה',preview.accounts.length],
    ['בתי ספר', preview.totals.schools],
    ['פעילויות', preview.totals.activities],
    ...(preview.totals.containsCourses !== false ? [['מפגשים לחיוב', preview.totals.meetings], ['שעות לחיוב', preview.totals.hours]] : []),
    ...(preview.totals.containsUnits ? [['כמות סדנאות/סיורים', preview.totals.units]] : []),
    ['סכום להפקה', formatAmount(preview.totals.amount)]
  ];
  return `<div class="ds-fin-transaction-summary" dir="rtl" style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;width:fit-content;max-width:100%;margin:12px auto 16px;">
    ${cards.map(([label, value]) => `
      <article class="ds-fin-collect-summary-card" style="box-sizing:border-box;width:140px;min-height:62px;padding:9px 10px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;">
        <span class="ds-fin-collect-summary-card__label" style="font-size:12px;line-height:1.25;white-space:nowrap;">${escapeHtml(label)}</span>
        <strong class="ds-fin-collect-summary-card__value" style="font-size:20px;line-height:1.2;margin-top:4px;white-space:nowrap;">${escapeHtml(String(value))}</strong>
      </article>
    `).join('')}
  </div>`;
}

function groupSelectAllHtml(lines, data, mode) {
  if (mode !== TRANSACTION_MODE_MANUAL) return '';
  const keys = [...new Set(lines.map(transactionSelectionKey))];
  const selected = keys.filter((key) => data.transactionManualSelected?.[key]).length;
  return `<label class="ds-fin-transaction-all"><input type="checkbox" data-finance-transaction-select-all aria-label="סימון כל החשבונות בקבוצה"${selected===keys.length ? ' checked' : ''}${selected>0 && selected<keys.length?' data-indeterminate="true"':''}> סמן הכל</label>`;
}

function billingLineHtml(line, data, mode) {
  const slots = Array.isArray(line.unbilledSlots) ? line.unbilledSlots : [];
  const school = mode === TRANSACTION_MODE_MANUAL && line.customerName
    ? `<small class="ds-fin-transaction-school" style="display:block;color:var(--ds-text-muted,#64748b)">${escapeHtml(line.customerName)}</small>` : '';
  const meetingDetails = slots.length
    ? `<details class="ds-fin-transaction-meetings"><summary>${serviceActivity(line) ? 'פירוט מועדי פעילות' : 'פירוט מפגשים'}</summary>
      <div>${slots.map(slot => `<div>${serviceActivity(line) ? 'מועד פעילות' : `מפגש ${escapeHtml(slot.slot)}`} · ${escapeHtml(formatDate(slot.date))}${serviceActivity(line) ? '' : ` · ${compactNumber(slot.remainingHours ?? TRANSACTION_MEETING_HOURS)} שעות`}</div>`).join('')}</div>
    </details>` : '';
  return `<tr>
    <td><strong>${escapeHtml(line.activityName || line.activityRowId)}</strong>${line.gefenFunding ? `<small class="ds-fin-transaction-program" style="display:block;color:var(--ds-text-muted,#64748b)">מספר גפ״ן: ${escapeHtml(line.gefenNumber || 'לא הוגדר')}</small>` : ''}${school}${meetingDetails}</td>
    <td>${escapeHtml(formatAmount(line.activityPrice ?? line.fundingAmount))}</td>
    <td>${escapeHtml(activityMeetings(line))}</td>
    <td>${escapeHtml(activityHours(line))}</td>
    <td><strong>${escapeHtml(formatAmount(line.issuableAmount))}</strong></td>
  </tr>`;
}
function billingTableHtml(lines, data, mode) {
  return dsTableWrap(`<table class="ds-table" dir="rtl"><thead><tr>
    <th>פעילות ${groupSelectAllHtml(lines,data,mode)}</th><th>מחיר הפעילות</th><th>${escapeHtml(progressHeading(lines))}</th><th>שעות</th><th>סכום לחיוב</th>
  </tr></thead><tbody>${lines.map(line => billingLineHtml(line,data,mode)).join('')}</tbody></table>`);
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
    return `<details class="ds-fin-payer" data-finance-transaction-group><summary>${escapeHtml(row.period.slice(0,7))} · ${escapeHtml(mode === TRANSACTION_MODE_AUTOMATIC ? `${row.customerName} · ${row.institutionSymbol}` : row.payerName)} · ${lines.length} חיובים · ${escapeHtml(formatAmount(lines.reduce((sum,line) => sum + Number(line.issuableAmount),0)))}</summary>
      ${billingTableHtml(lines,data,mode)}
      <button type="button" class="ds-btn ds-btn--primary" data-finance-transaction-run="${mode}" data-finance-transaction-period="${row.period.slice(0,7)}"${mode === TRANSACTION_MODE_MANUAL && !transactionBacklog(data, mode).some((line) => line.period.slice(0,7) === row.period.slice(0,7) && data.transactionManualSelected?.[transactionSelectionKey(line)]) ? ' disabled' : ''}>${mode === TRANSACTION_MODE_AUTOMATIC ? 'הפק חשבונות לחודש זה' : 'הפק חשבונות מסומנים לחודש זה'}</button></details>`;
  }).join('');
}

function billingView(data, mode) {
  const preview = transactionPreviewForVisit(data, mode);
  const backlog = transactionBacklog(data, mode);
  const rows = transactionIssuanceActivities(data, { mode }).map((row) => row.transaction_summary);
  const ready = rows.filter((row) => row.eligible && !row.blockedReason);
  const waiting = [...new Map(rows.filter((row) => row.eligibilityStatus === 'waiting_three_meetings')
    .map(row=>[row.activityRowId,row])).values()];
  const waitingHtml = waiting.length ? `<details class="ds-fin-payer" data-finance-waiting-courses>
    <summary>${mode === TRANSACTION_MODE_AUTOMATIC ? '<span class="ds-fin-gefen-arrow" aria-hidden="true">▸</span>' : ''}<span>קורסים הממתינים להשלמת שלושה מפגשים (${waiting.length})</span></summary>
    ${dsTableWrap(`<table class="ds-table" dir="rtl"><thead><tr><th>מוסד</th><th>קורס</th><th>מפגשים</th></tr></thead>
    <tbody>${waiting.map(row=>`<tr><td>${escapeHtml(row.customerName || '—')}</td><td>${escapeHtml(row.activityName)}</td><td>${Number(row.completedCount || 0)} מתוך 3</td></tr>`).join('')}</tbody></table>`)}
  </details>` : '';
  {
    const selectedMonth = transactionMonth(data, mode);
    const current = preview.accounts.filter(account => account.period?.slice(0,7) === selectedMonth);
    const previous = preview.accounts.filter(account => account.period?.slice(0,7) < selectedMonth);
    const groupsHtml = (accounts, older = false) => accounts.map(account => `<details class="ds-fin-payer" data-finance-transaction-group>
      <summary><span class="ds-fin-gefen-arrow" aria-hidden="true">▸</span><span class="ds-fin-payer__title">${escapeHtml(mode===TRANSACTION_MODE_AUTOMATIC ? `${account.schoolName} · ${account.institutionSymbol}` : account.customerName)}${older ? ` · ${escapeHtml(account.period.slice(0,7))}` : ''}</span>
      <span class="ds-fin-payer__meta">${account.lines.length} חיובים · ${escapeHtml(formatAmount(account.totalAmount))}</span></summary>
      ${billingTableHtml(account.lines,data,mode)}</details>`).join('');
    return `<div class="ds-fin-gefen" dir="rtl">
      ${monthPicker(data,mode)}
      ${preview.accounts.length ? summaryCards(preview) : ''}
      <section data-finance-gefen-current><h3>חשבונות החודש הנבחר</h3>
        ${groupsHtml(current) || dsEmptyState('אין חשבונות להפקה בחודש שנבחר.')}</section>
      ${previous.length ? `<section class="ds-fin-gefen-backlog" data-finance-gefen-backlog><h3>חיובים זכאים מחודשים קודמים</h3>${groupsHtml(previous,true)}</section>` : ''}
      ${preview.accounts.length ? `<div class="ds-fin-gefen-issue"><button type="button" class="ds-btn ds-btn--primary" data-finance-transaction-run="${mode}">הפקת כל חשבונות העסקה</button></div>` : ''}
      ${waitingHtml}
    </div>`;
  }
}

function historyView(data) {
  const accounts = (data.transactionContext?.accounts || []).slice().sort((a, b) => String(b.transaction_account_number || '').localeCompare(String(a.transaction_account_number || ''), 'en', { numeric: true }));
  if (!accounts.length) return invoiceRevisionAdminHtml(data)+dsEmptyState('טרם הופקו חשבונות עסקה.');
  return invoiceRevisionAdminHtml(data)+invoiceRevisionEditorHtml(data)+accounts.map((account) => {
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
        ${account.outlook_owner_mailbox ? `<span>תיבת המפיק: ${escapeHtml(account.outlook_owner_mailbox)}</span>` : ''}
        ${account.outlook_error ? `<span role="status">${escapeHtml(financeError(new Error(account.outlook_error)))}</span>` : ''}
        ${(account.outlook_status==='waiting_connection' || account.outlook_error==='invoice_microsoft_account_mismatch') && account.outlook_owner_id===data.financeAuthUserId ? '<button type="button" class="ds-btn ds-btn--ghost ds-btn--sm" data-finance-microsoft-connect>חיבור Microsoft</button>' : ''}
        <span>גבייה: <strong>${escapeHtml(statusLabel(actualCollectionStatus))}</strong></span>
        ${balance ? `<span>שולם: ${escapeHtml(formatAmount(balance.paidAmount))} · יתרה: ${escapeHtml(formatAmount(balance.balance))}</span>` : ''}
        ${pdf}
        <button class="ds-btn ds-btn--ghost" data-invoice-revision-open="${escapeHtml(account.id)}">${['issued','mail_draft_ready','sent'].includes(account.document_status)?'עריכה והפקה מחדש':'גרסאות ופרטי התיקון'}</button>
        ${account.replaces_account_id?`<button class="ds-btn ds-btn--ghost" data-invoice-revision-open="${escapeHtml(account.replaces_account_id)}">חשבון מקורי שבוטל</button>`:''}
        ${account.replaced_by_account_id?`<button class="ds-btn ds-btn--ghost" data-invoice-revision-open="${escapeHtml(account.replaced_by_account_id)}">חשבון חלופי</button>`:''}
        ${['issued','mail_draft_ready'].includes(account.document_status) && ['pending','failed','missing_recipient','needs_review'].includes(account.outlook_status) ? `<button type="button" class="ds-btn ds-btn--ghost ds-btn--sm" data-finance-account-draft="${escapeHtml(account.id)}"${data.financeBusy ? ' disabled' : ''}>נסה להשלים את טיוטת הדוא״ל</button>` : ''}
        ${data.financeAdmin && account.document_status !== 'cancelled' ? `<button class="ds-btn ds-btn--ghost" data-finance-account-cancel="${escapeHtml(account.id)}">ביטול חשבון</button>` : ''}
        ${account.cancellation_reason ? `<span>${escapeHtml(account.cancellation_reason)}</span>` : ''}
      </div>
      ${dsTableWrap(`<table class="ds-table" dir="rtl"><thead><tr><th>פעילות</th><th>גורם מימון</th><th>שעות</th><th>סכום</th></tr></thead><tbody>${lines}</tbody></table>`)}
    </details>`;
  }).join('');
}

export const FINANCE_TRANSACTION_SHAREPOINT_FOLDER_URL = 'https://think365orgil.sharepoint.com/Site9/Shared%20Documents/%D7%A2%D7%99%D7%93%D7%9F%20-%20%D7%98%D7%95%D7%A0%D7%99/%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%95%D7%AA%20%D7%A2%D7%A1%D7%A7%D7%94%20-%20%D7%AA%D7%A9%D7%A4%D7%96';

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
      <div class="ds-fin-transaction-nav">
        <div class="ds-fin-tabs" role="tablist">
          <button type="button" class="ds-fin-tab${tab === 'automatic' ? ' is-active' : ''}" data-finance-transaction-tab="automatic">חשבונות עסקה - גפן</button>
          <button type="button" class="ds-fin-tab${tab === 'manual' ? ' is-active' : ''}" data-finance-transaction-tab="manual">חשבונות עסקה - פתוח</button>
          <button type="button" class="ds-fin-tab${tab === 'history' ? ' is-active' : ''}" data-finance-transaction-tab="history">היסטוריה</button>
          <button type="button" class="ds-fin-tab${tab === 'editable' ? ' is-active' : ''}" data-finance-transaction-tab="editable">הפקה ידנית</button>
        </div>
        <a class="ds-fin-transaction-folder-link"
           href="${FINANCE_TRANSACTION_SHAREPOINT_FOLDER_URL}" target="_blank" rel="noopener noreferrer"
           title="תיקיית חשבונות עסקה ב-SharePoint"
           aria-label="פתיחת תיקיית חשבונות עסקה ב-SharePoint">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><path d="M3.5 6.75A1.75 1.75 0 0 1 5.25 5h4.1c.46 0 .9.18 1.22.5l1.18 1.18c.33.33.77.52 1.24.52h5.76a1.75 1.75 0 0 1 1.75 1.75v7.8a2.25 2.25 0 0 1-2.25 2.25H5.75a2.25 2.25 0 0 1-2.25-2.25v-10Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M3.75 10h16.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </a>
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
  data.transactionRequestIds ||= {};
  // The server caps each period against cumulative billing. Complete older
  // periods first so a later charge cannot make an earlier snapshot stale.
  const accounts=[...preview.accounts].sort((a,b)=>String(a.period||'').localeCompare(String(b.period||'')));
  for (const account of accounts) {
    const requestKey=JSON.stringify([mode,account.period?.slice(0,7) || month,account.institutionSymbol,account.lines.map(line=>[line.activityRowId,line.fundingSourceId,line.period,line.issuableAmount,line.unbilledSlots])]);
    data.transactionRequestIds[requestKey] ||= uuid();
    let reserved;
    try {
    reserved = await api.reserveFinanceTransactionAccount({
      idempotencyKey: data.transactionRequestIds[requestKey],
      cutoffDate: preview.cutoff,
      institutionSymbol: account.institutionSymbol,
      customerName: account.customerName,
      customerEmail: (account.customerEmails || []).join(';'),
      lines: account.lines.map((line) => ({
        activity_row_id: line.activityRowId,
        funding_source_id: line.fundingSourceId,
        performance_month: line.period,
        billing_range_end: transactionMonth(scoped,mode)+'-01',
        expected_amount: line.issuableAmount,
        meeting_slots: line.unbilledSlots.map((slot) => slot.slot),
        issue_mode: mode
      }))
    });
    const dispatched = await api.dispatchFinanceTransactionAccount({ accountId: reserved.id });
    results.push({ reserved, dispatched });
    } catch (error) {
      if (reserved && api.cancelFinanceTransactionReservation) {
        try { await api.cancelFinanceTransactionReservation(reserved.id); delete data.transactionRequestIds[requestKey]; }
        catch { /* an issued account or active worker must remain intact */ }
      }
      results.push({reserved,error:String(error?.message || 'ההפקה לא הושלמה')});
    }
  }
  return results;
}

export function transactionIssuanceResultMessage(results) {
  const issued=results.filter(r=>!r.error || r.dispatched?.documentPreserved).length;
  const ready=results.filter(r=>r.dispatched?.outlookStatus==='draft_ready').length;
  const missing=results.filter(r=>r.dispatched?.outlookStatus==='missing_recipient').length;
  const waiting=results.filter(r=>r.dispatched?.outlookStatus==='waiting_connection').length;
  const failed=results.filter(r=>r.error || ['failed','needs_review'].includes(r.dispatched?.outlookStatus)).length;
  return `נשמרו ${issued} חשבונות עסקה. נוצרו ${ready} טיוטות דוא״ל.${waiting ? ` ${waiting} טיוטות ממתינות לחיבור Microsoft של המפיק המקורי ויושלמו אוטומטית לאחר החיבור.` : ''}${missing ? ` חסרים נמענים ל-${missing} חשבונות.` : ''}${failed ? ` ${failed} פעולות לא הושלמו; הפרטים בהיסטוריה.` : ''}`;
}

export function handleTransactionSelection(data, rowId, checked) {
  data.transactionManualSelected = { ...(data.transactionManualSelected || {}), [text(rowId)]: checked === true };
}

export function handleTransactionGroupSelection(data, keys, checked) {
  const selection = { ...(data.transactionManualSelected || {}) };
  for (const key of new Set(keys)) selection[text(key)] = checked === true;
  data.transactionManualSelected = selection;
}

// Update checkbox state in-place. Re-rendering the entire screen on each click
// destroys <details> nodes, which collapses the user's expanded billing period.
export function syncTransactionSelectionUi(root, data) {
  if (!root) return;
  const selection = data.transactionManualSelected || {};
  root.querySelectorAll('[data-finance-transaction-select]').forEach((checkbox) => {
    checkbox.checked = selection[checkbox.dataset.financeTransactionSelect] === true;
  });
  root.querySelectorAll('[data-finance-transaction-group]').forEach((group) => {
    const all = group.querySelector('[data-finance-transaction-select-all]');
    if (!all) return;
    const entries = [...group.querySelectorAll('[data-finance-transaction-select]')];
    const checked = entries.filter((checkbox) => checkbox.checked).length;
    all.checked = entries.length > 0 && checked === entries.length;
    all.indeterminate = checked > 0 && checked < entries.length;
  });
  const main = root.querySelector('[data-finance-transaction-main-run]');
  if (main) {
    const canIssue = transactionPreviewForVisit(data, TRANSACTION_MODE_MANUAL).accounts.length > 0;
    main.disabled = !canIssue;
    main.style.display = canIssue ? '' : 'none';
  }
  const selectedBacklogMonths = new Set(transactionBacklog(data, TRANSACTION_MODE_MANUAL)
    .filter((row) => selection[transactionSelectionKey(row)] === true)
    .map((row) => row.period.slice(0,7)));
  root.querySelectorAll('[data-finance-transaction-run="manual"][data-finance-transaction-period]').forEach((button) => {
    button.disabled = !selectedBacklogMonths.has(button.dataset.financeTransactionPeriod);
  });
}
