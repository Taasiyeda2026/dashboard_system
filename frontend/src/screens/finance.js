import { hubIcon } from './shared/process-icons.js';
import { consumeNotificationTarget } from '../notifications/target.js';
import { escapeHtml } from './shared/html.js';
import {
  dsPageHeader,
  dsScreenStack,
  dsEmptyState,
  dsTableWrap
} from './shared/layout.js';
import { attendanceMonthLabel } from './attendance-control.js';
import { hasPermission } from '../permission-policy.js';
import {
  FINANCE_ATTENDANCE_EXPORT_OPTIONS,
  FINANCE_HOUR_CATEGORIES,
  currentFinanceMonthKey,
  downloadFinanceAttendanceExcel,
  normalizeFinanceAttendanceExportType,
  summarizeFinanceAttendance
} from './finance-attendance-summary.js';
import { activityRowId, normalizeFinanceCollectionTab } from './finance-collection.js';
import { financeError } from './finance-errors.js';
import { financeAccountBalances, paymentsBodyHtml, receiptsHtml, accountPaymentAllocation } from './finance-payments.js';
import { prepareManualAccount, updateManualDraft, manualRequest, runManualAccount } from './finance-manual-account.js';
import { financeToday } from './finance-transaction-accounts.js';
import {
  handleTransactionSelection,
  runTransactionIssuance,
  transactionAccountsViewHtml
} from './finance-transaction-issuance.js';

export const FINANCE_COLLECTION_ACTIVITY_PERIOD = 'school_2027';

export {
  FINANCE_ATTENDANCE_COLUMNS,
  FINANCE_ATTENDANCE_EMPLOYMENT_SHEETS,
  FINANCE_ATTENDANCE_EXPORT_FULL,
  FINANCE_ATTENDANCE_EXPORT_MAOF,
  FINANCE_ATTENDANCE_EXPORT_OPTIONS,
  FINANCE_ATTENDANCE_EXPORT_TAASIYEDA,
  FINANCE_ATTENDANCE_GENERAL_SHEET,
  FINANCE_HOUR_CATEGORIES,
  FINANCE_MAOF_DAILY_COLUMNS,
  FINANCE_MAOF_SHEET,
  buildEmployeeTeamMap,
  buildFinanceAttendanceExcelRows,
  buildFinanceAttendanceWorkbook,
  buildMaofDailyExcelRows,
  currentFinanceMonthKey,
  financeAttendanceDisplayRow,
  financeAttendanceExportFilename,
  financeEmploymentSheetName,
  financeHourCategory,
  formatFinanceReportedHourRanges,
  isFinalPayrollApproval,
  mergeFinanceReportedTimeRanges,
  normalizeFinanceAttendanceExportType,
  normalizeFinanceEmploymentType,
  summarizeFinanceAttendance,
  unmappedFinanceActivityTypes
} from './finance-attendance-summary.js';

export {
  FINANCE_UNFUNDED_PAYER_LABEL,
  FINANCE_COLLECTION_TAB_ALL,
  FINANCE_COLLECTION_TAB_CLOSED,
  FINANCE_COLLECTION_TAB_OPEN,
  FINANCE_NO_END_DATE_MONTH_KEY,
  FINANCE_NO_END_DATE_MONTH_LABEL,
  activityRowId,
  attachCollectionTracking,
  filterFinanceCollectionActivities,
  financeActivityEndDate,
  financeActivityEndMonthKey,
  financeCollectionSearchHaystack,
  financePayerKey,
  groupFinanceCollectionByEndMonth,
  groupFinanceCollectionPayers,
  isAuthorityFunding,
  isGefenFunding,
  mapLegacyPaymentCollected,
  normalizeCollectionStatus,
  normalizeFinanceCollectionTab,
  summarizeFinanceCollectionTotals
} from './finance-collection.js';

const FINANCE_COLLECTION_MEETING_DATE_COLUMNS = Array.from({ length: 35 }, (_, index) => `date_${index + 1}`);

export const FINANCE_COLLECTION_ACTIVITY_COLUMNS = [
  'id', 'row_id', 'activity_name', 'activity_type', 'authority', 'school',
  'school_id', 'authority_id', 'funding', 'price', 'status', 'activity_season', 'activity_no', 'sessions',
  'contact_email', 'end_time', 'start_date', 'end_date', ...FINANCE_COLLECTION_MEETING_DATE_COLUMNS
].join(',');

function permissionYes(value) {
  return value === true || ['yes', 'true', '1'].includes(String(value || '').trim().toLowerCase());
}

export function canAccessFinance(user = {}) {
  return hasPermission(user, 'finance_access');
}

export function createFinanceVisitState(now = new Date()) {
  return {
    view: 'hub',
    attendanceMonth: currentFinanceMonthKey(now),
    attendanceExportType: 'full',
    attendanceByMonth: {},
    attendanceLoading: false,
    attendanceError: '',
    employees: null,
    collectionPeriod: '',
    collectionActivities: null,
    collectionTracking: null,
    collectionTab: 'open',
    collectionSearch: '',
    collectionLoading: false,
    collectionError: '',
    collectionSaveState: {},
    transactionTab: 'automatic',
    transactionManualSelected: {},
    transactionActionMessage: '',
    transactionRunning: false
  };
}


const FINANCE_VIEW_PERMISSIONS = Object.freeze({
  attendance: 'view_finance_payroll',
  collection: 'view_finance_collection',
  transactions: 'manage_finance_transactions'
});

function canOpenFinanceView(user, view) {
  return view === 'hub' || hasPermission(user, FINANCE_VIEW_PERMISSIONS[view]);
}

function hubCardsHtml(user) {
  const cards = [
    {
      view: 'attendance',
      icon: 'attendance',
      title: 'דיווח נוכחות',
      description: 'ריכוז נתוני נוכחות ושכר לאחר אישור סופי'
    },
    {
      view: 'collection',
      icon: 'collection',
      title: 'מעקב גבייה',
      description: 'מעקב גבייה מרוכז לפי הגורם המשלם'
    },
    {
      view: 'transactions',
      icon: 'transaction',
      title: 'חשבונות עסקה',
      description: 'חשבונות גפ״ן, חשבונות פתוחים להפקה והיסטוריה'
    }
  ];
  return `<div class="ds-fin-hub" dir="rtl">
    ${cards.filter((card) => canOpenFinanceView(user, card.view)).map((card) => `
      <button type="button" class="ds-fin-hub-card" data-finance-open="${card.view}">
        <span class="ds-fin-hub-card__icon">${hubIcon(card.icon)}</span>
        <span class="ds-fin-hub-card__body">
          <strong>${escapeHtml(card.title)}</strong>
          <small>${escapeHtml(card.description)}</small>
        </span>
      </button>
    `).join('')}
  </div>`;
}

function backBarHtml(title) {
  return `<div class="ds-fin-backbar" dir="rtl">
    <button type="button" class="ds-btn ds-btn--ghost ds-btn--sm" data-finance-open="hub">חזרה לכספים</button>
    <strong>${escapeHtml(title)}</strong>
  </div>`;
}

function formatHours(value) {
  const n = Number(value) || 0;
  if (!(n > 0)) return '';
  const totalMinutes = Math.max(0, Math.round(n * 60));
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
}

function formatExpenseMoney(value) {
  const amount = Number(value) || 0;
  return `₪${amount.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function expenseDialogHtml(entry = {}) {
  if (!(entry.expenses > 0)) return '';
  const items = (entry.expenseItems || []).map((item) => {
    const files = (item.attachments || []).map((attachment, index) => {
      const fileName = attachment.fileName || `אסמכתא ${index + 1}`;
      if (!attachment.storagePath) {
        return `<span class="ds-fin-expense-dialog__file is-missing" title="הקובץ מופיע באישור אך נתיב הצפייה אינו זמין">${hubIcon('receipt')}<span>${escapeHtml(fileName)}</span></span>`;
      }
      return `<button type="button" class="ds-fin-expense-dialog__file" data-finance-expense-attachment="${escapeHtml(attachment.storagePath)}" title="פתיחת ${escapeHtml(fileName)}">${hubIcon('receipt')}<span>${escapeHtml(fileName)}</span></button>`;
    }).join('') || '<span class="ds-fin-expense-dialog__empty">לא צורפה אסמכתא להוצאה זו</span>';
    return `<div class="ds-fin-expense-dialog__item">
      <div class="ds-fin-expense-dialog__meta">
        <strong>${escapeHtml(formatExpenseMoney(item.amount))}</strong>
        <span>${escapeHtml(item.date || '')}</span>
        ${item.details ? `<span>${escapeHtml(item.details)}</span>` : ''}
      </div>
      <div class="ds-fin-expense-dialog__files">${files}</div>
    </div>`;
  }).join('');
  return `<dialog class="ds-fin-expense-dialog" data-finance-expenses-dialog="${escapeHtml(entry.employeeId)}" dir="rtl">
    <div class="ds-fin-expense-dialog__head">
      <div><strong>הוצאות ואסמכתאות</strong><span>${escapeHtml(entry.employeeName || entry.employeeId || '')} · ${escapeHtml(formatExpenseMoney(entry.expenses))}</span></div>
      <button type="button" class="ds-fin-expense-dialog__close" data-finance-expenses-close aria-label="סגירה">×</button>
    </div>
    <div class="ds-fin-expense-dialog__body">${items || '<span class="ds-fin-expense-dialog__empty">לא נמצאו פרטי הוצאה</span>'}</div>
  </dialog>`;
}

function attendanceTableHtml(entries = []) {
  if (!entries.length) return dsEmptyState('אין דיווחי נוכחות מאושרים להעברה לשכר בחודש זה.');
  // The unclassified category is a safety net, but a zero-only column distracts
  // from the approved payroll totals. Keep it available when any hours need review.
  const visibleHourCategories = FINANCE_HOUR_CATEGORIES.filter((item) =>
    item.key !== 'uncategorized' || entries.some((entry) => Number(entry.hours?.uncategorized) > 0)
  );
  const hourHeaders = visibleHourCategories.map((item) => `<th class="ds-fin-num">${escapeHtml(item.label)}</th>`).join('');
  const dialogs = entries.map(expenseDialogHtml).join('');
  const body = entries.map((entry) => {
    const hourCells = visibleHourCategories.map((item) => `<td class="ds-fin-num">${escapeHtml(formatHours(entry.hours?.[item.key]))}</td>`).join('');
    const fileCell = entry.hasFile
      ? `<button type="button" class="ds-fin-file" data-finance-file="${escapeHtml(entry.employeeId)}" title="פתיחת קובץ" aria-label="פתיחת קובץ">${hubIcon('file')}</button>`
      : '';
    const receiptCount = (entry.expenseItems || []).reduce((sum, item) => sum + (item.attachments || []).filter((attachment) => attachment.storagePath).length, 0);
    const expenseCell = entry.expenses > 0
      ? `<div class="ds-fin-expense-cell"><strong>${escapeHtml(formatExpenseMoney(entry.expenses))}</strong><button type="button" class="ds-fin-expense-open" data-finance-expenses="${escapeHtml(entry.employeeId)}" title="צפייה בהוצאות ובאסמכתאות" aria-label="צפייה בהוצאות ובאסמכתאות">${hubIcon('receipt')}${receiptCount ? `<span>${receiptCount}</span>` : ''}</button></div>`
      : '<span class="ds-fin-expense-zero">—</span>';
    return `<tr>
      <td class="ds-fin-att-team">${escapeHtml(entry.team || '—')}</td>
      <td>${escapeHtml(entry.employeeName || '—')}</td>
      <td>${escapeHtml(entry.employmentType || '—')}</td>
      <td class="ds-fin-num">${entry.workDays || 0}</td>
      ${hourCells}
      <td class="ds-fin-num">${escapeHtml(formatHours(entry.totalHours))}</td>
      <td class="ds-fin-num">${escapeHtml(String(Number(entry.kilometers) || 0))}</td>
      <td class="ds-fin-num">${escapeHtml(formatExpenseMoney(entry.publicTransportCost || 0))}</td>
      <td class="ds-fin-expense-cell-wrap">${expenseCell}</td>
      <td class="ds-fin-file-cell">${fileCell}</td>
      <td class="ds-fin-att-notes"><span title="${escapeHtml(entry.notes || '')}">${escapeHtml(entry.notes || '')}</span></td>
    </tr>`;
  }).join('');
  return `${dsTableWrap(`<table class="ds-table ds-fin-att-table" dir="rtl">
    <colgroup>
      <col class="ds-fin-col-team"><col class="ds-fin-col-employee"><col class="ds-fin-col-employment"><col class="ds-fin-col-days">
      ${visibleHourCategories.map(() => '<col class="ds-fin-col-hour">').join('')}
      <col class="ds-fin-col-hour"><col class="ds-fin-col-km">
      <col class="ds-fin-col-expenses"><col class="ds-fin-col-expenses">
      <col class="ds-fin-col-file"><col class="ds-fin-col-notes">
    </colgroup>
    <thead>
      <tr>
        <th rowspan="2">מנהל צוות</th>
        <th rowspan="2">שם העובד</th>
        <th rowspan="2">סוג העסקה</th>
        <th rowspan="2" class="ds-fin-num">ימי עבודה</th>
        <th colspan="${visibleHourCategories.length}">שעות לפי סוג פעילות</th>
        <th rowspan="2" class="ds-fin-num">סה״כ שעות</th>
        <th rowspan="2" class="ds-fin-num">סה״כ ק״מ</th>
        <th rowspan="2">תחבורה ציבורית (₪)</th>
        <th rowspan="2">הוצאות (₪)</th>
        <th rowspan="2">קובץ</th>
        <th rowspan="2">הערות</th>
      </tr>
      <tr>${hourHeaders}</tr>
    </thead>
    <tbody>${body}</tbody>
  </table>`)}${dialogs}`;
}

function attendanceViewHtml(data, { state } = {}) {
  const month = data.attendanceMonth || currentFinanceMonthKey();
  const monthCache = data.attendanceByMonth?.[month];
  const exportType = normalizeFinanceAttendanceExportType(data.attendanceExportType);
  const summarized = summarizeFinanceAttendance(monthCache?.approvals || [], {
    employees: data.employees || [],
    attendanceRecords: monthCache?.attendanceRecords || []
  });
  const loading = data.attendanceLoading;
  const error = data.attendanceError;
  const body = error
    ? dsEmptyState(error)
    : loading && !monthCache
      ? dsEmptyState('טוען נתוני נוכחות…')
      : attendanceTableHtml(data.notificationEmployeeId ? summarized.rows.filter(row => String(row.employeeId) === String(data.notificationEmployeeId)) : summarized.rows);
  const exportOptions = FINANCE_ATTENDANCE_EXPORT_OPTIONS.map((option) => `
    <option value="${escapeHtml(option.value)}"${exportType === option.value ? ' selected' : ''}>${escapeHtml(option.label)}</option>
  `).join('');
  return dsScreenStack(`
    ${backBarHtml('דיווח נוכחות')}
    <div class="ds-fin-att-shell" dir="rtl">
      <div class="ds-fin-att-toolbar">
        <label class="ds-fin-att-field">חודש שכר
          <input class="ds-input" type="month" data-finance-month value="${escapeHtml(month)}">
        </label>
        <label class="ds-fin-att-field">סוג קובץ
          <select class="ds-input" data-finance-attendance-export-type>${exportOptions}</select>
        </label>
        <button type="button" class="ds-btn ds-btn--primary" data-finance-attendance-export>ייצוא לאקסל</button>
      </div>
      ${data.notificationEmployeeId ? '<button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-finance-clear-notification-filter>הצג את כל העובדים</button>' : ''}
      ${monthCache?.evidenceError ? `<div class="ds-fin-att-evidence-warning" role="status">הנתונים המאושרים נטענו, אך לא ניתן היה לטעון קישורים לאסמכתאות ההוצאות.</div>` : ''}
      ${summarized.unmappedActivityTypes.length ? `<p class="ds-fin-att-evidence-warning" role="alert">קיימות שעות בסיווג ״לא מסווג – לבדיקה״: ${escapeHtml(summarized.unmappedActivityTypes.join(', '))}. השעות נכללות בסיכום ואין לקבוע להן תעריף ללא בדיקת הסיווג.</p>` : ''}
      ${body}
    </div>
  `);
}

/** Collection-screen money display only: numeric 0 → ₪0; missing/invalid → — (do not change shared money()). */
function collectionMoney(value) {
  if (value == null || typeof value === 'boolean') return '—';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '—';
    if (value === 0) return '₪0';
    return `₪${value.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  const raw = String(value).trim();
  if (!raw) return '—';
  const cleaned = raw.replace(/[₪,\s]/g, '');
  if (!cleaned) return '—';
  const amount = Number(cleaned);
  if (!Number.isFinite(amount)) return '—';
  if (amount === 0) return '₪0';
  return `₪${amount.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function collectionSummaryCardsHtml(totals = {}) {
  const cards = [
    { label: 'סכום חשבונות שהופקו', value: collectionMoney(totals.totalAmount) },
    { label: 'חשבונות פתוחים למעקב', value: collectionMoney(totals.openAmount) },
    { label: 'תקבולים שתועדו', value: collectionMoney(totals.closedAmount) },
    { label: 'מועד גבייה חלף', value: String(totals.overdueCount || 0) }
  ];
  return `<div class="ds-fin-collect-summary" dir="rtl">
    ${cards.map((card) => `
      <article class="ds-fin-collect-summary-card">
        <span class="ds-fin-collect-summary-card__label">${escapeHtml(card.label)}</span>
        <strong class="ds-fin-collect-summary-card__value">${escapeHtml(card.value)}</strong>
      </article>
    `).join('')}
  </div>`;
}

export function buildFinanceCollectionBodyHtml(data) {
  return paymentsBodyHtml(data);
}

function syncFinanceCollectionTabs(root, tab) {
  root.querySelectorAll('[data-finance-collection-tab]').forEach((btn) => {
    const active = normalizeFinanceCollectionTab(btn.dataset.financeCollectionTab) === tab;
    btn.classList.toggle('is-active', active);
  });
}

function updateFinanceCollectionBody(root, visit) {
  const body = root.querySelector('[data-finance-collection-body]');
  if (!body) return;
  body.innerHTML = buildFinanceCollectionBodyHtml(visit);
}

function collectionViewHtml(data) {
  const accounts = financeAccountBalances(data);
  const totals = { totalAmount: accounts.reduce((sum,a)=>sum+Number(a.total_amount),0), openAmount: accounts.reduce((sum,a)=>sum+a.balance,0),
    closedAmount: accounts.reduce((sum,a)=>sum+a.paidAmount,0), overdueCount: accounts.filter(a=>a.balance>0&&a.payment_due_date<financeToday()).length };
  return dsScreenStack(`<div class="ds-fin-collect-shell" data-finance-account-collection dir="rtl">${backBarHtml('מעקב גבייה')}
    ${data.paymentMessage ? `<p role="status">${escapeHtml(data.paymentMessage)}</p>` : ''}
    ${collectionSummaryCardsHtml(totals)}
    <div class="ds-fin-collect-toolbar"><label>חיפוש<input class="ds-input" type="search" data-finance-collection-search value="${escapeHtml(data.collectionSearch || '')}" placeholder="מספר חשבון, גורם משלם או בית ספר"></label>
      <div class="ds-fin-tabs" role="tablist">${[['open','פתוח'],['closed','ארכיון חשבונות ששולמו'],['all','הכול']].map(([tab,label])=>`<button class="ds-fin-tab${data.collectionTab===tab?' is-active':''}" data-finance-collection-tab="${tab}">${label}</button>`).join('')}</div></div>
    <div data-finance-collection-body>${buildFinanceCollectionBodyHtml(data)}</div>
    ${receiptsHtml(data)}

  </div>`);
}

function hubViewHtml(user) {
  return dsScreenStack(`${dsPageHeader('כספים')}${hubCardsHtml(user)}`);
}

function isFinanceCollectionActivity(row = {}) {
  return !!activityRowId(row);
}

async function ensureAttendanceLoaded(data, api, monthKey) {
  const month = String(monthKey || data.attendanceMonth || currentFinanceMonthKey()).trim();
  data.attendanceMonth = month;
  if (data.attendanceByMonth?.[month]) return data.attendanceByMonth[month];
  data.attendanceLoading = true;
  data.attendanceError = '';
  const employeesPromise = data.employees
    ? Promise.resolve(data.employees)
    : (typeof api?.attendanceControlTeams === 'function'
      ? api.attendanceControlTeams().catch(() => [])
      : Promise.resolve([]));
  try {
    const [approvals, employees] = await Promise.all([
      api.listPayrollControlApprovals({ monthKey: month, statuses: ['approved_for_payroll'] }),
      employeesPromise
    ]);
    if (!data.employees) data.employees = Array.isArray(employees) ? employees : [];
    const normalizedApprovals = Array.isArray(approvals) ? approvals : [];
    const employeeIds = [...new Set(normalizedApprovals.map((row) => String(row.employee_id || '').trim()).filter(Boolean))];
    let attendanceRecords = [];
    let evidenceError = '';
    if (employeeIds.length && typeof api?.attendanceControlRecords === 'function') {
      const match = month.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
      if (match) {
        const year = Number(match[1]);
        const monthNumber = Number(match[2]);
        const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
        try {
          attendanceRecords = await api.attendanceControlRecords({
            employeeIds,
            fromDate: `${month}-01`,
            toDate: `${month}-${String(lastDay).padStart(2, '0')}`
          });
        } catch (error) {
          evidenceError = error?.message || 'attendance_evidence_load_failed';
        }
      }
    }
    const payload = {
      approvals: normalizedApprovals,
      attendanceRecords: Array.isArray(attendanceRecords) ? attendanceRecords : [],
      evidenceError
    };
    data.attendanceByMonth = { ...(data.attendanceByMonth || {}), [month]: payload };
    return payload;
  } catch (error) {
    data.attendanceError = error?.message || 'טעינת נתוני הנוכחות נכשלה.';
    throw error;
  } finally {
    data.attendanceLoading = false;
  }
}

async function ensureCollectionLoaded(data, api, { force = false } = {}) {
  if (!force && data.collectionActivities && data.collectionPeriod === FINANCE_COLLECTION_ACTIVITY_PERIOD) return;
  data.collectionLoading = true;
  data.collectionError = '';
  try {
    const transactionPromise = typeof api.financeTransactionContext === 'function'
      ? api.financeTransactionContext()
      : Promise.reject(new Error('נתוני חשבונות העסקה אינם זמינים; ההפקה חסומה.'));
    const [activities, transactionContext] = await Promise.all([
      api.listFinanceActivities({ select: FINANCE_COLLECTION_ACTIVITY_COLUMNS }),
      transactionPromise
    ]);
    // Finance is scoped to the current school year, NOT the calendar year.
    // Autumn 2026 meetings of school_2027 remain visible; school_2026 never enters billing.
    const currentActivities = (Array.isArray(activities?.rows) ? activities.rows : [])
      .filter((activity) => activity.activity_season === FINANCE_COLLECTION_ACTIVITY_PERIOD && isFinanceCollectionActivity(activity));
    const visibleActivityIds = new Set(currentActivities.map((activity) => String(activityRowId(activity))));
    const [billingRows, paymentContext] = await Promise.all([
      api.financeBillingPreview([...visibleActivityIds]),
      api.financePaymentContext()
    ]);
    if (!paymentContext || !Array.isArray(paymentContext.balances) || !Array.isArray(paymentContext.receipts) || !Array.isArray(paymentContext.allocations)) {
      throw new Error('נתוני התשלומים אינם זמינים');
    }
    // An invoice belongs to this year only if all of its lines reference this year's activities.
    // Exclude old orphaned/cancelled test invoices without activity lines as well.
    const visibleAccounts = (transactionContext.accounts || []).filter((account) => {
      const lines = account.finance_transaction_account_lines;
      return Array.isArray(lines) && lines.length > 0
        && lines.every((line) => visibleActivityIds.has(String(line.activity_row_id)));
    });
    const visibleAccountIds = new Set(visibleAccounts.map((account) => account.id));
    const allocatedReceiptIds = new Set(paymentContext.allocations
      .filter((allocation) => visibleAccountIds.has(allocation.account_id))
      .map((allocation) => allocation.receipt_id));
    const visibleReceipts = paymentContext.receipts.filter((receipt) =>
      visibleActivityIds.has(String(receipt.activity_row_id)) || allocatedReceiptIds.has(receipt.id));
    const visibleReceiptIds = new Set(visibleReceipts.map((receipt) => receipt.id));
    data.collectionPeriod = FINANCE_COLLECTION_ACTIVITY_PERIOD;
    data.collectionActivities = currentActivities;
    data.paymentContext = {
      ...paymentContext,
      balances: paymentContext.balances.filter((balance) => visibleAccountIds.has(balance.accountId)),
      receipts: visibleReceipts,
      // Keep allocations across years for included receipts so their unallocated balance is accurate.
      allocations: paymentContext.allocations.filter((allocation) => visibleReceiptIds.has(allocation.receipt_id))
    };
    data.transactionContext = {
      ...transactionContext,
      accounts: visibleAccounts,
      cancelled: (transactionContext.cancelled || []).filter((row) => visibleActivityIds.has(String(row.activity_id))),
      billingRows: (billingRows || []).filter((row) => visibleActivityIds.has(String(row.activityRowId)))
    };
  } catch (error) {
    data.transactionContext = null;
    data.paymentContext = null;
    data.collectionError = financeError(error);
    throw error;
  } finally {
    data.collectionLoading = false;
  }
}

export const financeScreen = {
  load: async () => createFinanceVisitState(),

  render(data, { state } = {}) {
    if (!canAccessFinance(state?.user)) {
      return dsScreenStack(`${dsPageHeader('כספים', 'גישה מוגבלת')} ${dsEmptyState('אין הרשאה לצפייה בעמוד כספים.')}`);
    }
    data.financeAdmin = state?.user?.role === 'admin';
    const requestedView = data?.view || 'hub';
    const view = canOpenFinanceView(state?.user, requestedView) ? requestedView : 'hub';
    if (view === 'attendance') return attendanceViewHtml(data, { state });
    if (view === 'collection') return collectionViewHtml(data);
    if (view === 'transactions') return transactionAccountsViewHtml(data, backBarHtml);
    return hubViewHtml(state?.user);
  },

  bind({ root, data, state, api, rerender }) {
    if (!canAccessFinance(state?.user) || !root) return;
    const visit = data || {};
    if (typeof root._financeUnbind === 'function') root._financeUnbind();

    const target = consumeNotificationTarget(state, 'finance');
    const refresh = () => rerender?.();
    if (target && canOpenFinanceView(state?.user, 'attendance')) {
      visit.view = 'attendance'; visit.attendanceMonth = target.monthKey;
      visit.notificationEmployeeId = target.employeeId;
      void ensureAttendanceLoaded(visit, api, target.monthKey).then(() => {
        if (state.user?.auth_user_id === target.authUserId) refresh();
      }).catch(() => { visit.attendanceError = 'לא ניתן לטעון את חודש הנוכחות.'; refresh(); });
    }

    const formValues = (form) => Object.fromEntries([...form.querySelectorAll('[name]')].map(field => [field.name, field.value]));
    const financeAction = async (button, action) => {
      if (visit.financeBusy) return;
      visit.financeBusy = true; button.disabled = true;
      try { await action(); await ensureCollectionLoaded(visit, api, { force: true }); visit.paymentMessage = 'נשמר'; }
      catch (error) { await ensureCollectionLoaded(visit, api, { force: true }).catch(() => {}); visit.paymentMessage = financeError(error); visit.transactionActionMessage = visit.paymentMessage; }
      finally { visit.financeBusy = false; button.disabled = false; refresh(); }
    };
    const onClick = async (ev) => {
      const paymentOpen = ev.target.closest('[data-finance-payment-open]');
      if (paymentOpen) { visit.paymentAccountId = paymentOpen.dataset.financePaymentOpen; refresh(); return; }
      const receiptSave = ev.target.closest('[data-finance-receipt-save]');
      if (receiptSave) {
        const form = receiptSave.closest('form'); if (!form.checkValidity()) { form.reportValidity(); return; }
        const payload = formValues(form); const accountId = payload.account_id; delete payload.account_id;
        await financeAction(receiptSave, async () => { const allocations = accountId ? accountPaymentAllocation(visit, accountId, payload.amount) : []; await api.recordFinanceReceipt(payload, allocations, crypto.randomUUID()); visit.paymentAccountId = ''; }); return;
      }
      const allocation = ev.target.closest('[data-finance-allocate]');
      if (allocation) {
        const form = allocation.closest('form'); const values = formValues(form); const [accountId,activity] = String(values.account_activity || '').split('|');
        const key = [form.dataset.receiptId, accountId, activity, values.amount].join('|');
        visit.receiptAllocationKeys ||= {};
        visit.receiptAllocationKeys[key] ||= crypto.randomUUID();
        await financeAction(allocation, async () => { await api.allocateFinanceReceipt(form.dataset.receiptId, [{ account_id:accountId, activity_row_id:activity, amount:Number(values.amount) }], visit.receiptAllocationKeys[key]); delete visit.receiptAllocationKeys[key]; }); return;
      }
      const correction = ev.target.closest('[data-finance-receipt-correct]');
      if (correction) { const reason = window.prompt('סיבת תיקון התקבול'); if (reason?.trim()) await financeAction(correction, () => api.voidFinanceReceipt(correction.dataset.financeReceiptCorrect, reason)); return; }
      const cancelAccount = ev.target.closest('[data-finance-account-cancel]');
      if (cancelAccount) { const reason = window.prompt('סיבת ביטול החשבון'); if (reason?.trim()) await financeAction(cancelAccount, () => api.cancelIssuedFinanceAccount(cancelAccount.dataset.financeAccountCancel, reason)); return; }
      const manualPreview = ev.target.closest('[data-finance-manual-preview]');
      if (manualPreview) {
        if (visit.financeBusy) return; visit.financeBusy = true; manualPreview.disabled = true;
        try { const result = await api.previewFinanceManualAccount(manualRequest(visit)); visit.manualQuote = result.quote; visit.manualPdf = result.pdfBase64; visit.manualRequestId = crypto.randomUUID(); visit.transactionActionMessage = ''; }
        catch (error) { visit.transactionActionMessage = financeError(error); }
        finally { visit.financeBusy = false; refresh(); } return;
      }
      const manualConfirm = ev.target.closest('[data-finance-manual-confirm]');
      if (manualConfirm) { await financeAction(manualConfirm, async () => { await runManualAccount(visit, api); visit.manualQuote = null; visit.manualPdf = ''; visit.transactionTab = 'history'; }); return; }

      if (ev.target.closest('[data-finance-clear-notification-filter]')) {
        visit.notificationEmployeeId = ''; refresh(); return;
      }
      const openBtn = ev.target.closest('[data-finance-open]');
      if (openBtn) {
        const nextView = String(openBtn.dataset.financeOpen || 'hub');
        if (!canOpenFinanceView(state?.user, nextView)) return;
        visit.view = nextView;
        if (nextView === 'attendance') {
          refresh();
          try { await ensureAttendanceLoaded(visit, api, visit.attendanceMonth); }
          catch { /* shown via visit.attendanceError */ }
          refresh();
          return;
        }
        if (nextView === 'collection' || nextView === 'transactions') {
          refresh();
          try { await ensureCollectionLoaded(visit, api, { force: true }); }
          catch { /* shown via visit.collectionError */ }
          refresh();
          return;
        }
        refresh();
        return;
      }

      const transactionTab = ev.target.closest('[data-finance-transaction-tab]');
      if (transactionTab) {
        visit.transactionTab = String(transactionTab.dataset.financeTransactionTab || 'automatic');
        visit.transactionActionMessage = '';
        refresh();
        return;
      }

      const transactionRun = ev.target.closest('[data-finance-transaction-run]');
      if (transactionRun) {
        if (visit.transactionRunning || visit.financeBusy) return;
        const mode = String(transactionRun.dataset.financeTransactionRun || 'automatic');
        const label = mode === 'manual' ? 'החשבונות המסומנים' : 'סבב גפן';
        if (!window.confirm(`להפיק עכשיו את ${label}? לאחר ההפקה מספרי החשבונות והמפגשים יחויבו ולא ישתנו אוטומטית.`)) return;
        visit.transactionRunning = true;
        visit.transactionActionMessage = 'מפיק חשבונות עסקה…';
        refresh();
        try {
          const results = await runTransactionIssuance(visit, api, mode, transactionRun.dataset.financeTransactionPeriod);
          visit.transactionActionMessage = `הופקו ${results.length} חשבונות עסקה.${results.some(result => result.dispatched?.outlookStatus === 'failed') ? ' יצירת טיוטת המייל נכשלה.' : ''}`;
          if (mode === 'manual') visit.transactionManualSelected = {};
          await ensureCollectionLoaded(visit, api, { force: true });
          visit.transactionTab = 'history';
        } catch (error) {
          await ensureCollectionLoaded(visit, api, { force: true }).catch(() => {});
          visit.transactionActionMessage = financeError(error);
        } finally {
          visit.transactionRunning = false;
          refresh();
        }
        return;
      }

      const tabBtn = ev.target.closest('[data-finance-collection-tab]');
      if (tabBtn) {
        visit.collectionTab = normalizeFinanceCollectionTab(tabBtn.dataset.financeCollectionTab);
        syncFinanceCollectionTabs(root, visit.collectionTab);
        updateFinanceCollectionBody(root, visit);
        return;
      }

      const exportBtn = ev.target.closest('[data-finance-attendance-export]');
      if (exportBtn) {
        const month = visit.attendanceMonth || currentFinanceMonthKey();
        const monthCache = visit.attendanceByMonth?.[month];
        const summarized = summarizeFinanceAttendance(monthCache?.approvals || [], {
          employees: visit.employees || [],
          attendanceRecords: monthCache?.attendanceRecords || []
        });
        try {
          downloadFinanceAttendanceExcel(summarized.rows, month, {
            approvals: monthCache?.approvals || [],
            exportType: normalizeFinanceAttendanceExportType(visit.attendanceExportType)
          });
        }
        catch (error) { window.alert(error?.message || 'ייצוא Excel נכשל.'); }
        return;
      }

      const fileBtn = ev.target.closest('[data-finance-file]');
      if (fileBtn) {
        const month = visit.attendanceMonth || currentFinanceMonthKey();
        const summarized = summarizeFinanceAttendance(visit.attendanceByMonth?.[month]?.approvals || [], {
          employees: visit.employees || []
        });
        const entry = summarized.rows.find((row) => row.employeeId === String(fileBtn.dataset.financeFile || ''));
        if (!entry?.hasFile) return;
        let url = entry.fileUrl;
        if (!url) {
          const approval = (visit.attendanceByMonth?.[month]?.approvals || []).find((row) => String(row.employee_id || '') === entry.employeeId);
          if (approval?.pdf_path && api?.payrollControlApprovalSignedUrl && !/^https?:\/\//i.test(String(approval.pdf_path))) {
            try { url = (await api.payrollControlApprovalSignedUrl(approval.pdf_path)).signedUrl || ''; } catch { url = ''; }
          }
        }
        if (url) window.open(url, '_blank', 'noopener');
        return;
      }

      const expensesBtn = ev.target.closest('[data-finance-expenses]');
      if (expensesBtn) {
        const employeeId = String(expensesBtn.dataset.financeExpenses || '');
        const dialog = [...root.querySelectorAll('[data-finance-expenses-dialog]')]
          .find((item) => String(item.dataset.financeExpensesDialog || '') === employeeId);
        if (!dialog) return;
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
        return;
      }

      const closeExpensesBtn = ev.target.closest('[data-finance-expenses-close]');
      if (closeExpensesBtn) {
        const dialog = closeExpensesBtn.closest('[data-finance-expenses-dialog]');
        if (typeof dialog?.close === 'function') dialog.close();
        else dialog?.removeAttribute('open');
        return;
      }

      const expenseAttachmentBtn = ev.target.closest('[data-finance-expense-attachment]');
      if (expenseAttachmentBtn) {
        const path = String(expenseAttachmentBtn.dataset.financeExpenseAttachment || '').trim();
        if (!path || typeof api?.attendanceControlAttachmentSignedUrl !== 'function') return;
        expenseAttachmentBtn.disabled = true;
        try {
          const signed = await api.attendanceControlAttachmentSignedUrl(path);
          const url = String(signed?.signedUrl || '').trim();
          if (!url) throw new Error('לא התקבל קישור לצפייה באסמכתא.');
          window.open(url, '_blank', 'noopener');
        } catch (error) {
          window.alert(error?.message || 'פתיחת אסמכתת ההוצאה נכשלה.');
        } finally {
          expenseAttachmentBtn.disabled = false;
        }
      }
    };

    const onChange = async (ev) => {
      const manualActivity = ev.target.closest('[data-finance-manual-activity]');
      if (manualActivity) { prepareManualAccount(visit, manualActivity.value); refresh(); return; }
      const manualFunding = ev.target.closest('[data-finance-manual-funding]');
      if (manualFunding) { prepareManualAccount(visit, visit.manualActivityId, manualFunding.value); refresh(); return; }
      const manualField = ev.target.closest('[data-finance-manual-field]');
      if (manualField) { updateManualDraft(visit, manualField.dataset.financeManualField, manualField.value); refresh(); return; }
      const accountField = ev.target.closest('[data-finance-account-field]');
      if (accountField) {
        const account = financeAccountBalances(visit).find(a => a.id === accountField.dataset.accountId); if (!account) return;
        const next = { ...account, [accountField.dataset.financeAccountField]: accountField.value };
        await financeAction(accountField, () => api.updateFinanceAccountTracking(account.id, next.expected_collection_date, next.finance_note)); return;
      }

      const monthPicker = ev.target.closest('[data-finance-transaction-month]');
      if (monthPicker) {
        const mode = monthPicker.dataset.financeTransactionMonth;
        const month = String(monthPicker.value || '');
        if (/^\d{4}-\d{2}$/.test(month) && month <= financeToday().slice(0, 7)) {
          visit.transactionMonths = { ...visit.transactionMonths, [mode]: month };
          visit.transactionManualSelected = {};
        }
        refresh();
        return;
      }
      const transactionSelect = ev.target.closest('[data-finance-transaction-select]');
      if (transactionSelect) {
        handleTransactionSelection(visit, transactionSelect.dataset.financeTransactionSelect, transactionSelect.checked);
        refresh();
        return;
      }

      const exportTypeSelect = ev.target.closest('[data-finance-attendance-export-type]');
      if (exportTypeSelect) {
        visit.attendanceExportType = normalizeFinanceAttendanceExportType(exportTypeSelect.value);
        return;
      }

      const monthInput = ev.target.closest('[data-finance-month]');
      if (monthInput) {
        visit.attendanceMonth = String(monthInput.value || '').trim() || currentFinanceMonthKey();
        refresh();
        try { await ensureAttendanceLoaded(visit, api, visit.attendanceMonth); }
        catch { /* shown via visit.attendanceError */ }
        refresh();
        return;
      }


    };

    const onInput = (ev) => {
      if (ev.target.matches('[data-finance-manual-search]')) {
        clearTimeout(root._financeManualSearchTimer);
        root._financeManualSearchTimer = setTimeout(() => { visit.manualSearch = ev.target.value; refresh(); const input = root.querySelector('[data-finance-manual-search]'); input?.focus(); input?.setSelectionRange(visit.manualSearch.length, visit.manualSearch.length); }, 200);
      }

      if (ev.target.matches('[data-finance-collection-search]')) {
        clearTimeout(root._financeCollectionSearchTimer);
        root._financeCollectionSearchTimer = setTimeout(() => {
          visit.collectionSearch = ev.target.value || '';
          updateFinanceCollectionBody(root, visit);
        }, 250);
      }
    };

    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('input', onInput);
    root._financeUnbind = () => {
      root.removeEventListener('click', onClick);
      root.removeEventListener('change', onChange);
      root.removeEventListener('input', onInput);
      clearTimeout(root._financeCollectionSearchTimer);
      clearTimeout(root._financeManualSearchTimer);
    };
  }
};
