import {gefenBillingRequest} from './finance-gefen-billing-overrides.js';
import { completionPayload, syncCompletionForm, syncCompletionSearch } from './finance-billing-completion.js';
import {bindInvoiceRevisions} from './finance-invoice-revisions.js';
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
import { setManualBillingScope, prepareManualAccount, updateManualDraft, manualFilteredActivities, selectedManualActivityIds, toggleManualActivity, toggleAllVisibleManualActivities, syncManualActivitySelectionUi, normalizeManualRecipientEmails, updateManualConsolidatedField, focusManualActivity, saveActiveManualDraft, manualDraftPayload, openSavedManualDraft, previewSelectedManualAccounts, runSelectedManualAccounts, syncManualPdfPreviewDom, clearManualPdfPreviewUrls, activateManualPdfPreview } from './finance-manual-account.js';
import { financeToday, financeCycleCutoff } from './finance-transaction-accounts.js';
import {
  handleTransactionSelection,
  handleTransactionGroupSelection,
  syncTransactionSelectionUi,
  syncGefenBillingInput,
  runTransactionIssuance,
  previewTransactionAccountGroup,
  automaticMixedFundingProgramReview,
  transactionIssuanceResultMessage,
  transactionPreviewForVisit,
  transactionMaxMonth,
  transactionAccountPreviewKey,
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
  'contact_email', 'end_time', 'start_date', 'end_date', 'course_hourly_rate', ...FINANCE_COLLECTION_MEETING_DATE_COLUMNS
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
    billingCompletionSearch: '',
    manualFunderFilter: '',
    manualSelectedActivityIds: [],
    manualActivityDrafts: {},
    manualBatchPreviews: null,
    manualConsolidatedPreview: null,
    manualBulkEditingActivityId: '',
    manualFunderRecipientEmail: '',
    manualSelectionExpanded: false,
    transactionManualSelected: {},
    transactionActionMessage: '',
    transactionRunning: false,
    pendingTransactionApproval: null
  };
}


const FINANCE_VIEW_PERMISSIONS = Object.freeze({
  attendance: 'view_finance_payroll',
  collection: 'view_finance_collection',
  transactions: 'manage_finance_transactions'
});

function canOpenFinanceView(user, view) {
  return view === 'hub' || hasPermission(user, FINANCE_VIEW_PERMISSIONS[view])
    || (view === 'transactions' && hasPermission(user, 'view_finance_collection'));
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
    <div class="ds-fin-collect-toolbar"><label>חיפוש<input class="ds-input" type="search" data-finance-collection-search value="${escapeHtml(data.collectionSearch || '')}" placeholder="מספר חשבון או גורם משלם"></label>
      <div class="ds-fin-tabs" role="tablist">${[['open','פתוחים'],['closed','ארכיון חשבונות ששולמו']].map(([tab,label])=>`<button class="ds-fin-tab${data.collectionTab===tab?' is-active':''}" data-finance-collection-tab="${tab}">${label}</button>`).join('')}</div></div>
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
      .filter((allocation) => visibleAccountIds.has(allocation.account_id)
        || (allocation.released_at && visibleActivityIds.has(String(allocation.activity_row_id))))
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
    // Finance email recipients are resolved from the selected activity contact
    // and the separate school administrator, not from a stale activity email.
    // The reservation RPC persists the combined list on each new invoice.
    const activityById = new Map(currentActivities.map(activity => [String(activityRowId(activity)), activity]));
    const recipientList = (values) => [...new Map(values
      .flatMap(value => String(value || '').split(/[;,]/))
      .map(value => value.trim()).filter(value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
      .map(value => [value.toLowerCase(), value])).values()].join(';');
    data.transactionContext = {
      ...transactionContext,
      accounts: visibleAccounts,
      cancelled: (transactionContext.cancelled || []).filter((row) => visibleActivityIds.has(String(row.activity_id))),
      billingRows: (billingRows || []).filter((row) => visibleActivityIds.has(String(row.activityRowId))).map(row => {
        const activity = activityById.get(String(row.activityRowId));
        return {
          ...row,
          financeSchoolId: activity?.school_id ?? null,
          customerEmail: typeof row.customerEmail==='string' ? row.customerEmail
            : row.payerKey?.startsWith('school:') && activity
              ? recipientList([activity.resolved_contact_email || activity.contact_email,activity.finance_administrator_email]) : ''
        };
      })
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
    data.financeCanComplete = data.financeAdmin || hasPermission(state?.user,'manage_finance_transactions');
    data.financeTransactionsReadOnly = !data.financeCanComplete;
    data.financeAuthUserId = state?.user?.auth_user_id || '';
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
    const refresh = () => { rerender?.(); syncManualPdfPreviewDom(root, visit); syncCompletionForm(root.querySelector('[data-finance-completion-form]')); syncCompletionSearch(root, visit.billingCompletionSearch); };
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
    const loadPendingPdfUploads = async () => {
      if (!visit.financeTransactionsReadOnly && api.financePendingPdfUploads) {
        visit.pendingPdfUploads = await api.financePendingPdfUploads();
      }
    };
    const executeTransactionRun = async (mode, month, accountKey = null) => {
      if (visit.financeBusy || visit.transactionRunning) return;
      visit.transactionRunning = true;
      visit.transactionActionMessage = 'מפיק חשבונות עסקה…';
      refresh();
      try {
        const results = await runTransactionIssuance(visit, api, mode, month, accountKey);
        const issued = results.some(result => !result.error || result.dispatched?.documentPreserved);
        visit.transactionActionMessage = transactionIssuanceResultMessage(results);
        if (mode === 'manual' && issued) visit.transactionManualSelected = {};
        try { await ensureCollectionLoaded(visit, api, { force: true }); }
        catch (loadError) { visit.transactionActionMessage += ' רענון רשימת החשבונות נכשל; יש לבדוק בהיסטוריה לפני ניסיון נוסף.'; }
        // Do not hide errors by navigating to an empty history when every account failed.
        if (issued) visit.transactionTab = 'history';
        if (visit.transactionTab === 'history') await loadPendingPdfUploads().catch(() => {});
      } catch (error) {
        await ensureCollectionLoaded(visit, api, { force: true }).catch(() => {});
        visit.transactionActionMessage = financeError(error);
      } finally {
        visit.transactionRunning = false;
        refresh();
      }
    };
    const onClick = async (ev) => {
      const selectAllButton=ev.target.closest('[data-finance-manual-select-all-button]');
      if(selectAllButton){ev.preventDefault();const master=root.querySelector('[data-finance-manual-select-all]');toggleAllVisibleManualActivities(visit,!master?.checked);syncManualActivitySelectionUi(root,visit);return;}
      const completionOpen=ev.target.closest('[data-finance-complete-open]');
      if(completionOpen){
        if(visit.financeBusy||visit.transactionRunning||!visit.financeCanComplete||visit.billingCompletion)return;
        visit.financeBusy=true;
        try{visit.billingCompletion=await api.financeBillingCompletionContext(completionOpen.dataset.financeCompleteOpen);// Keep the originating tab and selected billing month; render the same editor in place.
          visit.pendingTransactionApproval=null;visit.transactionIssuancePreview=null;visit.transactionActionMessage='';}
        catch(error){visit.transactionActionMessage=financeError(error);}
        finally{visit.financeBusy=false;refresh();root.querySelector('[data-finance-completion-editor]')?.scrollIntoView?.({block:'nearest'});}
        return;
      }
      if(ev.target.closest('[data-finance-complete-cancel]')){visit.billingCompletion=null;refresh();return;}
      if(ev.target.closest('[data-finance-completion-calculate]')){syncCompletionForm(ev.target.closest('form'),true);return;}
      const completionSave=ev.target.closest('[data-finance-complete-save]');
      if(completionSave){
        if(visit.financeBusy||visit.transactionRunning||!visit.financeCanComplete||!visit.billingCompletion)return;
        const form=completionSave.closest('form');if(!form.reportValidity())return;
        const editor=visit.billingCompletion,payload=completionPayload(form,editor);
        const sum=payload.allocations.reduce((n,f)=>n+Number(f.amount||0),0);
        if(!payload.allocations.length||payload.allocations.some(f=>!(Number(f.amount)>0))||Math.abs(sum-Number(payload.price))>0.001){visit.transactionActionMessage='יש להשלים סכומי מימון חיוביים שסכומם שווה למחיר הכולל.';const alertEl=root.querySelector('[data-finance-completion-editor]');if(alertEl){let msg=alertEl.querySelector('[data-completion-error]');if(!msg){msg=document.createElement('p');msg.dataset.completionError='';msg.setAttribute('role','alert');alertEl.append(msg);}msg.textContent=visit.transactionActionMessage;}return;}
        visit.financeBusy=true;completionSave.disabled=true;
        try{await api.financeCompleteBillingData(editor.row_id,payload);visit.billingCompletion=null;visit.manualQuote=null;visit.manualBatchPreviews=null;visit.manualConsolidatedPreview=null;visit.transactionIssuancePreview=null;visit.transactionManualSelected={};visit.pendingTransactionApproval=null;await ensureCollectionLoaded(visit,api,{force:true});visit.transactionActionMessage='נתוני הפעילות נשמרו והזכאות חושבה מחדש.';}
        catch(error){const msg=document.createElement('p');msg.setAttribute('role','alert');msg.textContent=financeError(error);form.append(msg);}
        finally{visit.financeBusy=false;completionSave.disabled=false;if(!visit.billingCompletion)refresh();}
        return;
      }
      if (ev.target.closest('[data-finance-microsoft-connect]')) {
        try {
          const { delegatedMailToken } = await import('../microsoft/graph-mail.js');
          await delegatedMailToken(state?.user?.auth_email || state?.user?.email || '');
          visit.transactionActionMessage = 'Microsoft מחובר. הטיוטות של המפיק המקורי יושלמו אוטומטית.';
        } catch { visit.transactionActionMessage = 'החיבור ל־Microsoft לא הושלם. החשבונות והמסמכים נשמרו.'; }
        refresh(); return;
      }
      const resumePdf = ev.target.closest('[data-finance-resume-pdf]');
      if (resumePdf) {
        const accountId = resumePdf.dataset.financeResumePdf;
        if (!visit.pendingPdfUploads?.some(account => account.id === accountId)) return;
        await financeAction(resumePdf, async () => {
          await api.dispatchFinanceTransactionAccount({ accountId });
          await loadPendingPdfUploads();
          visit.transactionActionMessage = 'הפקת חשבון העסקה הושלמה.';
        });
        return;
      }
      const accountDraft = ev.target.closest('[data-finance-account-draft]');
      if (accountDraft) {
        if (visit.financeBusy || visit.transactionRunning) return;
        const accountId = accountDraft.dataset.financeAccountDraft;
        const account = visit.transactionContext?.accounts?.find(row => row.id === accountId);
        if (!account || !['issued', 'mail_draft_ready'].includes(account.document_status)) return;
        visit.financeBusy = true; accountDraft.disabled = true;
        visit.transactionActionMessage = 'יוצר טיוטת מייל…'; refresh();
        try {
          const result = await api.dispatchFinanceTransactionAccount({ accountId });
          if (result.outlookStatus === 'draft_ready') visit.transactionActionMessage = 'טיוטת המייל נוצרה עם חשבון העסקה המצורף.';
          else if (result.outlookStatus === 'waiting_connection') visit.transactionActionMessage = 'החשבון נשמר. הטיוטה ממתינה לחיבור Microsoft של המפיק המקורי.';
          else if (result.outlookStatus === 'missing_recipient') visit.transactionActionMessage = 'לא נוצרה טיוטה: חסרה כתובת מייל של איש הקשר בחשבון.';
          else if (result.outlookStatus==='already_sent') visit.transactionActionMessage='ההודעה כבר נשלחה ב-Outlook; לא נוצרה טיוטה נוספת.';
          else if (result.outlookStatus==='needs_review') visit.transactionActionMessage='תוצאת ניסיון קודם אינה ודאית. נדרשת בדיקת הטיוטה הקיימת לפני יצירה נוספת.';
          else visit.transactionActionMessage = 'יצירת טיוטת המייל נכשלה. החשבון נשמר וניתן לנסות להשלים את הטיוטה.';
        } catch (error) { visit.transactionActionMessage = financeError(error); }
        finally {
          await ensureCollectionLoaded(visit, api, { force: true }).catch(() => {});
          visit.financeBusy = false; refresh();
        }
        return;
      }
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
      const deleteAccount = ev.target.closest('[data-finance-account-delete]');
      if (deleteAccount) {
        if (!visit.financeAdmin || visit.financeBusy) return;
        const id = deleteAccount.dataset.financeAccountDelete;
        const account = visit.transactionContext?.accounts?.find(item => item.id === id);
        const allocations = (visit.paymentContext?.allocations || []).filter(item => item.account_id === id && !item.released_at);
        const allocated = allocations.reduce((sum,item) => sum + Number(item.amount),0);
        const warning = `למחוק את חשבון ${account?.transaction_account_number || ''} ואת ה־PDF המשויך מ־SharePoint? יתרת החיוב תשוחרר. עותקים שכבר הועברו ללקוח יישארו אצלו.`;
        const receipts = new Map((visit.paymentContext?.receipts || []).map(item => [item.id,item]));
        const receiptLines = allocations.map(item => {
          const receipt = receipts.get(item.receipt_id);
          const label = [receipt?.reference,receipt?.received_date].filter(Boolean).join(' · ');
          return `${label || 'תקבול'} · ${Number(item.amount).toLocaleString('he-IL')} ₪`;
        });
        const receiptDetails = allocations.length
          ? `\nתקבולים משויכים בסך ${allocated.toLocaleString('he-IL')} ₪:\n${receiptLines.join('\n')}\nהתקבולים יישמרו והשיוך לחשבון יוסר.`
          : '';
        if (window.confirm(warning + receiptDetails)) await financeAction(deleteAccount, async () => {
          await api.deleteFinanceTransactionAccount(id);
          visit.invoiceRevisionContext = null;
          visit.invoiceRevisionDraft = null;
          visit.transactionActionMessage = 'החשבון נמחק.';
        });
        return;
      }
      const cancelAccount = ev.target.closest('[data-finance-account-cancel]');
      if (cancelAccount) { const reason = window.prompt('סיבת ביטול החשבון'); if (reason?.trim()) await financeAction(cancelAccount, () => api.cancelIssuedFinanceAccount(cancelAccount.dataset.financeAccountCancel, reason)); return; }
      const pdfOpen = ev.target.closest('[data-finance-manual-pdf-open]');
      if (pdfOpen) {
        if (!activateManualPdfPreview(root, pdfOpen.dataset.financeManualPdfOpen, 'open', window)) {
          window.alert('התצוגה אינה זמינה. יש להציג את הטיוטה מחדש.');
        }
        return;
      }
      const pdfDownload = ev.target.closest('[data-finance-manual-pdf-download]');
      if (pdfDownload) {
        if (!activateManualPdfPreview(root, pdfDownload.dataset.financeManualPdfDownload, 'download', window)) {
          window.alert('ההורדה אינה זמינה. יש להציג את הטיוטה מחדש.');
        }
        return;
      }
      const saveDraft = ev.target.closest('[data-finance-manual-save-draft]');
      if (saveDraft) {
        if (visit.financeBusy) return;
        visit.financeBusy = true;
        try {
          visit.manualDraftKey ||= crypto.randomUUID();
          const saved = await api.saveFinanceTransactionDraft(
            visit.manualDraftKey, visit.manualSavedDraft?.version || 0, manualDraftPayload(visit)
          );
          visit.manualSavedDraft = saved;
          visit.manualSavedDrafts = [saved, ...(visit.manualSavedDrafts || []).filter(item => item.id !== saved.id)];
          visit.transactionActionMessage = 'הטיוטה נשמרה.';
        } catch (error) { visit.transactionActionMessage = financeError(error); }
        finally { visit.financeBusy = false; refresh(); }
        return;
      }
      const openDraft = ev.target.closest('[data-finance-manual-open-draft]');
      if (openDraft) {
        if (visit.financeBusy) return;
        const saved = visit.manualSavedDrafts?.find(item => item.id === openDraft.dataset.financeManualOpenDraft);
        if (saved) openSavedManualDraft(visit, saved);
        visit.transactionActionMessage = '';
        refresh();
        return;
      }
      if (ev.target.closest('[data-finance-manual-new-draft]')) {
        if (visit.financeBusy) return;
        openSavedManualDraft(visit, { payload: { manualSelectedActivityIds: [], manualActivityDrafts: {}, manualScope: 'full' } });
        visit.manualSavedDraft = null;
        visit.transactionActionMessage = '';
        refresh();
        return;
      }
      const deleteDraft = ev.target.closest('[data-finance-manual-delete-draft]');
      if (deleteDraft) {
        const saved = visit.manualSavedDrafts?.find(item => item.id === deleteDraft.dataset.financeManualDeleteDraft);
        if (!saved || !visit.financeAdmin || visit.financeBusy || !window.confirm('למחוק את טיוטת חשבון העסקה?')) return;
        visit.financeBusy = true;
        try {
          await api.deleteFinanceTransactionDraft(saved.id, saved.version);
          visit.manualSavedDrafts = visit.manualSavedDrafts.filter(item => item.id !== saved.id);
          if (visit.manualSavedDraft?.id === saved.id) {
            visit.manualSavedDraft = null;
            visit.manualDraftKey = '';
          }
          visit.transactionActionMessage = 'הטיוטה נמחקה.';
        } catch (error) { visit.transactionActionMessage = financeError(error); }
        finally { visit.financeBusy = false; refresh(); }
        return;
      }
      const manualPreview = ev.target.closest('[data-finance-manual-preview]');
      if (manualPreview) {
        const form = root.querySelector('[data-finance-manual-form]');
        if (form && !form.checkValidity()) { form.reportValidity(); return; }
        if (visit.financeBusy) return; visit.financeBusy = true; manualPreview.disabled = true;
        try { await previewSelectedManualAccounts(visit, api); visit.transactionActionMessage = ''; }
        catch (error) { visit.transactionActionMessage = financeError(error); }
        finally { visit.financeBusy = false; refresh(); } return;
      }
      const manualConfirm = ev.target.closest('[data-finance-manual-confirm]');
      if (manualConfirm) {
        await financeAction(manualConfirm, async () => {
          const { delegatedMailToken } = await import('../microsoft/graph-mail.js');
          await delegatedMailToken(state?.user?.auth_email || state?.user?.email || '', { interactive: true });
          const results = await runSelectedManualAccounts(visit, api);
          visit.transactionActionMessage = transactionIssuanceResultMessage(results.map(result=>
            result.reserved ? {reserved:result.reserved,dispatched:result.sent} : {dispatched:result}));
          visit.manualQuote = null; visit.manualPdf = ''; visit.manualBatchPreviews = null; visit.manualConsolidatedPreview = null;
          visit.manualSelectedActivityIds = []; visit.manualActivityDrafts = {};
          visit.manualBulkEditingActivityId = '';
          visit.manualActivityId = ''; visit.manualFundingKey = ''; visit.manualDraft = null;
          visit.transactionTab = 'history';
          await loadPendingPdfUploads().catch(() => {});
        }); return;
      }

      if (ev.target.closest('[data-finance-clear-notification-filter]')) {
        visit.notificationEmployeeId = ''; refresh(); return;
      }
      const openBtn = ev.target.closest('[data-finance-open]');
      if (openBtn) {
        const nextView = String(openBtn.dataset.financeOpen || 'hub');
        if (!canOpenFinanceView(state?.user, nextView)) return;
        visit.view = nextView;
        if (nextView === 'transactions') {
          const currentMonth = financeCycleCutoff().slice(0, 7);
          visit.transactionMonths = { automatic: transactionMaxMonth(visit, 'automatic'), manual: currentMonth };
          visit.transactionManualSelected = {};
        }
        if (nextView === 'attendance') {
          refresh();
          try { await ensureAttendanceLoaded(visit, api, visit.attendanceMonth); }
          catch { /* shown via visit.attendanceError */ }
          refresh();
          return;
        }
        if (nextView === 'collection' || nextView === 'transactions') {
          refresh();
          try {
            await ensureCollectionLoaded(visit, api, { force: true });
            if (nextView === 'transactions') visit.transactionMonths.automatic = transactionMaxMonth(visit, 'automatic');
          }
          catch { /* shown via visit.collectionError */ }
          refresh();
          return;
        }
        refresh();
        return;
      }

      const transactionTab = ev.target.closest('[data-finance-transaction-tab]');
      if (transactionTab) {
        const nextTransactionTab = String(transactionTab.dataset.financeTransactionTab || 'automatic');
        if (visit.financeTransactionsReadOnly && nextTransactionTab !== 'history') return;
        if(nextTransactionTab==='completion'&&!visit.financeCanComplete)return;
        if (nextTransactionTab === 'editable' && visit.transactionTab !== 'editable') {
          // A new manual issuing session starts without any preselected activity.
          // Keep the selected funding category but never carry stale invoice details.
          visit.manualSavedDraft = null;
          visit.manualDraftKey = '';
          visit.manualSelectedActivityIds = [];
          visit.manualActivityId = '';
          visit.manualDraft = null;
          visit.manualFundingKey = '';
          visit.manualActivityDrafts = {};
          visit.manualQuote = null;
          visit.manualPdf = '';
          visit.manualBatchPreviews = null;
          visit.manualConsolidatedPreview = null;
          visit.manualBatchIssued = {};
          visit.manualBulkEditingActivityId = '';
          visit.manualScope = 'full';
        }
        visit.pendingTransactionApproval = null;
        visit.billingCompletion = null;
        visit.transactionTab = nextTransactionTab;
        if (nextTransactionTab === 'editable') {
          visit.transactionActionMessage = '';
          refresh();
          try { visit.manualSavedDrafts = await api.financeTransactionDrafts(); }
          catch (error) { visit.transactionActionMessage = financeError(error); }
          refresh();
          return;
        }
        if (visit.transactionTab === 'automatic' || visit.transactionTab === 'manual') {
          visit.transactionMonths = { ...visit.transactionMonths, [visit.transactionTab]: transactionMaxMonth(visit, visit.transactionTab) };
          visit.transactionManualSelected = {};
        }
        visit.transactionActionMessage = '';
        if (visit.transactionTab === 'history') {
          try {
            await loadPendingPdfUploads();
            if (visit.financeAdmin && api.financeInvoiceRevisionContext) {
              const result = await api.financeInvoiceRevisionContext(null);
              visit.invoiceRevisionAdminRequests = result.requests || [];
              visit.invoiceRevisionAdminLoaded = true;
            }
          } catch (error) { visit.transactionActionMessage = financeError(error); }
        }
        refresh();
        return;
      }

      const issuancePdf = ev.target.closest('[data-finance-transaction-issuance-pdf-open],[data-finance-transaction-issuance-pdf-download]');
      if (issuancePdf) {
        syncManualPdfPreviewDom(root, visit);
        if(!activateManualPdfPreview(root, 'issuance', issuancePdf.hasAttribute('data-finance-transaction-issuance-pdf-open') ? 'open' : 'download',window)){
          visit.transactionActionMessage='קובץ ה־PDF אינו זמין. יש ללחוץ שוב על תצוגת PDF.';
          refresh();
        }
        return;
      }

      const transactionPreview = ev.target.closest('[data-finance-transaction-preview]');
      if (transactionPreview) {
        if (visit.financeBusy || visit.transactionRunning || visit.billingCompletion) return;
        // Reserve a tab during the explicit click, before the async RPC. This
        // preserves the browser's user gesture without issuing any account.
        let previewWindow=null;
        try { previewWindow=window.open('about:blank','_blank');
          if(previewWindow){previewWindow.opener=null;previewWindow.document.title='מכין תצוגת PDF';previewWindow.document.body.textContent='מכין תצוגת PDF…';}
        }catch{previewWindow?.close?.();previewWindow=null;}
        visit.transactionIssuancePreview=null;
        visit.financeBusy = true;
        visit.transactionActionMessage = 'מכין תצוגת PDF…';
        refresh();
        try {
          await previewTransactionAccountGroup(visit, api, transactionPreview.dataset.financeTransactionPreview, transactionPreview.dataset.financeTransactionPreviewKey);
          visit.transactionActionMessage = previewWindow&&!previewWindow.closed ? 'תצוגת PDF מוכנה ונפתחה בחלון נפרד.' : 'תצוגת PDF מוכנה. אם הדפדפן חסם חלון חדש, לחצו על פתיחת PDF או הורדת PDF.';
        } catch (error) {
          previewWindow?.close?.();
          visit.transactionIssuancePreview = null;
          visit.transactionActionMessage = financeError(error);
        } finally {
          visit.financeBusy = false;
          refresh();
          if (visit.transactionIssuancePreview) {
            syncManualPdfPreviewDom(root, visit);
            const previewUrl=root._financeManualPdfPreviewUrls?.get('issuance')?.url;
            if(previewWindow&&!previewWindow.closed&&previewUrl){
              try{previewWindow.location.replace(previewUrl);}catch{previewWindow.close?.();}
            }
            const pane=root.querySelector('.ds-fin-transaction-preview-pane');
            pane?.scrollIntoView?.({block:'nearest',behavior:'smooth'});
            pane?.focus?.({preventScroll:true});
          }
        }
        return;
      }

      const cancelTransactionApproval = ev.target.closest('[data-finance-transaction-cancel]');
      if (cancelTransactionApproval) {
        visit.pendingTransactionApproval = null;
        visit.transactionActionMessage = 'ההפקה בוטלה לבקשת המשתמש. לא נוצרו חשבונות עסקה.';
        refresh();
        return;
      }
      const approveTransaction = ev.target.closest('[data-finance-transaction-approve]');
      if (approveTransaction) {
        if (visit.financeBusy || visit.transactionRunning || !visit.pendingTransactionApproval) return;
        const approved = visit.pendingTransactionApproval;
        const scoped = { ...visit, transactionMonths: { ...visit.transactionMonths, automatic: approved.month } };
        const currentPreview = transactionPreviewForVisit(scoped, 'automatic');
        if(approved.accountKey)currentPreview.accounts=currentPreview.accounts.filter(a=>transactionAccountPreviewKey(a)===approved.accountKey);
        visit.pendingTransactionApproval = null;
        if (JSON.stringify(currentPreview.accounts.map(a=>gefenBillingRequest(visit,a,currentPreview.cutoff)))!==approved.billingSnapshot || JSON.stringify(currentPreview.accounts)!==approved.snapshot || currentPreview.accounts.length !== approved.accountCount
          || Math.abs(currentPreview.accounts.reduce((n,a)=>n+a.totalAmount,0) - approved.amount) > 0.005) {
          visit.transactionActionMessage = 'נתוני החיוב השתנו מאז האישור. יש לרענן את הרשימה ולבדוק מחדש לפני הפקה.';
          refresh();
          return;
        }
        await executeTransactionRun('automatic', approved.month, approved.accountKey);
        return;
      }

      const transactionRun = ev.target.closest('[data-finance-transaction-run]');
      if (transactionRun) {
        if (visit.transactionRunning || visit.financeBusy || visit.pendingTransactionApproval || visit.billingCompletion) return;
        const mode = String(transactionRun.dataset.financeTransactionRun || 'automatic');
        const month = transactionRun.dataset.financeTransactionPeriod
          || visit.transactionMonths?.[mode] || transactionMaxMonth(visit, mode);
        if (mode === 'automatic') {
          const accountKey=transactionRun.dataset.financeTransactionAccount||null;
          const mixed = automaticMixedFundingProgramReview(visit, month, accountKey);
          const invalid = mixed.filter(row => !row.valid);
          if (invalid.length) {
            visit.transactionActionMessage = 'הפקת גפ״ן נחסמה: מספר גפ״ן חסר או אינו תואם לרשומת הפעילות. יש לתקן את כל הפעילויות לפני ההפקה.';
            refresh();
            return;
          }
          const scoped = { ...visit, transactionMonths: { ...visit.transactionMonths, automatic: month } };
          const preview = transactionPreviewForVisit(scoped, 'automatic');
          if(accountKey)preview.accounts=preview.accounts.filter(a=>transactionAccountPreviewKey(a)===accountKey);
          try{for(const a of preview.accounts)gefenBillingRequest(visit,a,preview.cutoff);}catch(error){visit.transactionActionMessage=error.message;refresh();return;}
          if (!preview.accounts.length) {
            visit.transactionActionMessage = 'אין חשבונות גפ״ן מוכנים להפקה לחודש זה.';
            refresh();
            return;
          }
          visit.pendingTransactionApproval = {
            mode: 'automatic',
            accountKey, snapshot:JSON.stringify(preview.accounts), billingSnapshot:JSON.stringify(preview.accounts.map(a=>gefenBillingRequest(visit,a,preview.cutoff))),
            month,
            accountCount: preview.accounts.length,
            amount: preview.accounts.reduce((n,a)=>n+a.totalAmount,0),
            mixed: mixed.map(({school,course,code}) => ({school,course,code}))
          };
          visit.transactionActionMessage = '';
          refresh();
          root.querySelector('[data-finance-transaction-approve]')?.focus();
          return;
        }
        if (!window.confirm('להפיק עכשיו את החשבונות המסומנים? לאחר ההפקה מספרי החשבונות והמפגשים יחויבו ולא ישתנו אוטומטית.')) return;
        await executeTransactionRun(mode, transactionRun.dataset.financeTransactionPeriod);
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
      if (ev.target.matches('[data-finance-history-month], [data-finance-history-status]')) {
        const key = ev.target.matches('[data-finance-history-month]') ? 'transactionHistoryMonth' : 'transactionHistoryStatus';
        visit[key] = ev.target.value;
        refresh();
        return;
      }
      const completionForm=ev.target.closest('[data-finance-completion-form]');if(completionForm){syncCompletionForm(completionForm);return;}
      const fundingCategory = ev.target.closest('[data-finance-manual-funding-category]');
      if (fundingCategory) {
        // Switching routes resets the payer and any edited draft from another payer.
        visit.manualFundingCategory = fundingCategory.value || '';
        visit.manualSelectionExpanded = false;
        // For named sponsors the chosen funding source is already the payer.
        // Only Gefen schools and municipal authorities require a second selector.
        visit.manualFunderFilter = visit.manualFundingCategory &&
          !['gefen','authority'].includes(visit.manualFundingCategory)
            ? 'route:' + visit.manualFundingCategory : '';
        visit.manualSelectedActivityIds = [];
        visit.manualActivityDrafts = {};
        visit.manualFunderRecipientEmail = '';
        visit.manualScope = 'full';
        visit.manualBulkEditingActivityId = '';
        visit.manualActivityId = '';
        visit.manualFundingKey = '';
        visit.manualDraft = null;
        visit.manualQuote = null; visit.manualPdf = '';
        visit.manualBatchPreviews = null; visit.manualConsolidatedPreview = null; visit.manualBatchIssued = {};
        refresh(); return;
      }
      const funderFilter = ev.target.closest('[data-finance-manual-funder-filter]');
      if (funderFilter) {
        visit.manualSelectionExpanded = false;
        // A payer change starts a new selection; never carry invoices for the previous payer.
        visit.manualFunderFilter = funderFilter.value || '';
        visit.manualSelectedActivityIds = [];
        visit.manualActivityDrafts = {};
        visit.manualFunderRecipientEmail = '';
        visit.manualScope = 'full';
        visit.manualBulkEditingActivityId = '';
        visit.manualActivityId = '';
        visit.manualFundingKey = '';
        visit.manualDraft = null;
        visit.manualQuote = null; visit.manualPdf = '';
        visit.manualBatchPreviews = null; visit.manualConsolidatedPreview = null; visit.manualBatchIssued = {};
        refresh(); return;
      }
      const selectAll = ev.target.closest('[data-finance-manual-select-all]');
      if (selectAll) {
        toggleAllVisibleManualActivities(visit, selectAll.checked);
        syncManualActivitySelectionUi(root, visit);
        return;
      }
      const multiActivity = ev.target.closest('[data-finance-manual-select-activity]');
      if (multiActivity) {
        toggleManualActivity(visit, multiActivity.value, multiActivity.checked);
        syncManualActivitySelectionUi(root, visit);
        return;
      }
      const manualActivity = ev.target.closest('[data-finance-manual-activity]');
      if (manualActivity) {
        if (manualActivity.value) {
          if (selectedManualActivityIds(visit).includes(manualActivity.value)) focusManualActivity(visit, manualActivity.value);
          else toggleManualActivity(visit, manualActivity.value, true);
          visit.manualBulkEditingActivityId = manualActivity.value;
        } else if (selectedManualActivityIds(visit).length > 1) {
          visit.manualBulkEditingActivityId = '';
        } else {
          toggleManualActivity(visit, visit.manualActivityId, false);
        }
        syncManualActivitySelectionUi(root, visit); return;
      }
      const bulkField = ev.target.closest('[data-finance-manual-bulk-field]');
      if (bulkField) {
        if (bulkField.dataset.financeManualBulkField === 'customer_email') {
          bulkField.value = normalizeManualRecipientEmails(bulkField.value);
        }
        if (!bulkField.checkValidity()) { bulkField.reportValidity(); return; }
        updateManualConsolidatedField(visit, bulkField.dataset.financeManualBulkField, bulkField.value);
        syncManualActivitySelectionUi(root, visit);
        return;
      }
      const manualFunding = ev.target.closest('[data-finance-manual-funding]');
      if (manualFunding) { prepareManualAccount(visit, visit.manualActivityId, manualFunding.value); saveActiveManualDraft(visit); visit.manualBatchPreviews = null; syncManualActivitySelectionUi(root, visit); return; }
      const scope=ev.target.closest('[data-finance-manual-scope]');
      if(scope){setManualBillingScope(visit,scope.value);syncManualActivitySelectionUi(root,visit);return;}
      const lineAmount=ev.target.closest('[data-finance-manual-line-amount]');
      if(lineAmount){
        focusManualActivity(visit,lineAmount.dataset.financeManualLineAmount);
        if(updateManualDraft(visit,'amount',lineAmount.value)===false){lineAmount.setCustomValidity('יש להזין סכום תקין');lineAmount.reportValidity();return;}
        saveActiveManualDraft(visit);syncManualActivitySelectionUi(root,visit);return;
      }
      const manualField = ev.target.closest('[data-finance-manual-field]');
      if (manualField) {
        // Normalize pasted semicolon-separated addresses before native HTML validation.
        // An email input with "multiple" accepts commas, not semicolons.
        if (manualField.dataset.financeManualField === 'customer_email') {
          manualField.value = normalizeManualRecipientEmails(manualField.value);
        }
        if (!manualField.checkValidity()) { manualField.reportValidity(); return; }
        const fieldKey = manualField.dataset.financeManualField;
        const sharedPayerField = selectedManualActivityIds(visit).length > 1
          && ['customer_name','customer_email','institution_symbol','issue_date','payment_due_date','override_reason'].includes(fieldKey);
        const updated = sharedPayerField
          ? updateManualConsolidatedField(visit, fieldKey, manualField.value)
          : updateManualDraft(visit, fieldKey, manualField.value);
        if (updated === false) {
          manualField.setCustomValidity('יש להזין סכום תקין; פסיק משמש להפרדת אלפים.');
          manualField.reportValidity();
          return;
        }
        manualField.setCustomValidity('');
        saveActiveManualDraft(visit); syncManualActivitySelectionUi(root, visit); return;
      }
      const accountField = ev.target.closest('[data-finance-account-field]');
      if (accountField) {
        const account = financeAccountBalances(visit).find(a => a.id === accountField.dataset.accountId); if (!account) return;
        const next = { ...account, [accountField.dataset.financeAccountField]: accountField.value };
        await financeAction(accountField, () => api.updateFinanceAccountTracking(account.id, next.expected_collection_date, next.finance_note)); return;
      }

      const monthPicker = ev.target.closest('[data-finance-transaction-month]');
      if (monthPicker) {
        const mode = monthPicker.dataset.financeTransactionMonth;
        if(mode==='automatic')return;
        const month = String(monthPicker.value || '');
        if (/^\d{4}-\d{2}$/.test(month) && month <= transactionMaxMonth(visit, mode)) {
          visit.transactionMonths = { ...visit.transactionMonths, [mode]: month };
          visit.transactionManualSelected = {};
        }
        refresh();
        return;
      }
      const selectGroup = ev.target.closest('[data-finance-transaction-select-all]');
      if (selectGroup) {
        const group = selectGroup.closest('[data-finance-transaction-group]');
        const keys = [...(group?.querySelectorAll('[data-finance-transaction-select]') || [])]
          .map((checkbox) => checkbox.dataset.financeTransactionSelect);
        handleTransactionGroupSelection(visit, keys, selectGroup.checked);
        syncTransactionSelectionUi(root, visit);
        return;
      }
      const transactionSelect = ev.target.closest('[data-finance-transaction-select]');
      if (transactionSelect) {
        handleTransactionSelection(visit, transactionSelect.dataset.financeTransactionSelect, transactionSelect.checked);
        // The checkboxes and action buttons can update without rebuilding the expanded table.
        syncTransactionSelectionUi(root, visit);
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
      if(ev.target.matches('[data-gefen-billing-field]')){if(visit.financeBusy||visit.transactionRunning)return;syncGefenBillingInput(root,visit,ev.target);return;}
      if (ev.target.matches('[data-finance-history-search]')) {
        clearTimeout(root._financeHistorySearchTimer);
        const value = ev.target.value;
        const caret = ev.target.selectionStart;
        root._financeHistorySearchTimer = setTimeout(() => {
          visit.transactionHistorySearch = value;
          if (visit.transactionTab !== 'history' && !visit.financeTransactionsReadOnly) return;
          refresh();
          const search = root.querySelector('[data-finance-history-search]');
          search?.focus();
          search?.setSelectionRange(caret, caret);
        }, 180);
        return;
      }
      if(ev.target.matches('[data-finance-completion-search]')){visit.billingCompletionSearch=ev.target.value||'';syncCompletionSearch(root,visit.billingCompletionSearch);return;}
      const completionForm=ev.target.closest('[data-finance-completion-form]');if(completionForm){syncCompletionForm(completionForm);return;}
      if (ev.target.matches('[data-finance-manual-search]')) {
        clearTimeout(root._financeManualSearchTimer);
        const searchValue = ev.target.value;
        root._financeManualSearchTimer = setTimeout(() => {
          visit.manualSelectionExpanded = Boolean(root.querySelector('[data-finance-manual-selection]')?.open);
          visit.manualSearch = searchValue;
          refresh();
          const input = root.querySelector('[data-finance-manual-search]');
          input?.focus();
          input?.setSelectionRange(visit.manualSearch.length, visit.manualSearch.length);
        }, 200);
      }

      if (ev.target.matches('[data-finance-collection-search]')) {
        clearTimeout(root._financeCollectionSearchTimer);
        root._financeCollectionSearchTimer = setTimeout(() => {
          visit.collectionSearch = ev.target.value || '';
          updateFinanceCollectionBody(root, visit);
        }, 250);
      }
    };

    syncTransactionSelectionUi(root, visit);
    syncManualPdfPreviewDom(root, visit);
    syncCompletionForm(root.querySelector('[data-finance-completion-form]'));
    syncCompletionSearch(root, visit.billingCompletionSearch);
    bindInvoiceRevisions({root,data:visit,api,refresh,reload:()=>ensureCollectionLoaded(visit,api,{force:true})});
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('input', onInput);
    const onDraftsChanged = () => {
      if (visit.view!=='transactions' || visit.financeBusy || visit.transactionRunning) return;
      void ensureCollectionLoaded(visit, api, { force: true }).then(refresh).catch(() => {});
    };
    window.addEventListener('finance-invoice-drafts-changed', onDraftsChanged);
    root._financeUnbind = () => {
      root.removeEventListener('click', onClick);
      root.removeEventListener('change', onChange);
      root.removeEventListener('input', onInput);
      window.removeEventListener('finance-invoice-drafts-changed', onDraftsChanged);
      root._invoiceRevisionUnbind?.();
      clearTimeout(root._financeCollectionSearchTimer);
      clearTimeout(root._financeHistorySearchTimer);
      clearTimeout(root._financeManualSearchTimer);
      clearManualPdfPreviewUrls(root);
    };
  }
};
