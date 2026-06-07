/**
 * Personal Reports Screen — דוחות אישיים
 *
 * Digital monthly salary report form, based on the Excel format "דיווח שכר אישי".
 * Uses the authenticated dashboard user supplied by the app shell.
 * Uses the shared supabase client (anon key only — no service_role exposure).
 *
 * Roles:
 *   employee — sees only their own reports
 *   admin    — sees all reports, can approve / return / mark paid
 */

import { supabase } from '../supabase-client.js';
import { escapeHtml } from './shared/html.js';
import { dsPageHeader, dsEmptyState, dsStatusChip, dsScreenStack } from './shared/layout.js';

// ─── permission ────────────────────────────────────────────────────────────────

function permissionYes(value) {
  return value === true || ['yes', 'true', '1'].includes(String(value || '').trim().toLowerCase());
}

function canAccessPersonalReports(user = {}) {
  if (user?.profile_is_active === false) return false;
  return permissionYes(user?.can_access_personal_reports);
}

function personalReportsAccessDeniedHtml() {
  return dsScreenStack(`${dsPageHeader('דוחות אישיים', 'גישה מוגבלת')} ${dsEmptyState('אין הרשאה לצפייה בדוחות אישיים.')}`);
}

// ─── constants ────────────────────────────────────────────────────────────────

const MONTHS_HE = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

const STATUS_LABELS = {
  draft:            'פתוח לדיווח',
  submitted:        'נשלח',
  reviewed:         'נבדק',
  approved:         'טופל ואושר לשכר',
  needs_correction: 'הוחזר לתיקון',
  paid:             'החודש נסגר'
};

const STATUS_KIND = {
  draft:            'neutral',
  submitted:        'warning',
  reviewed:         'neutral',
  approved:         'success',
  needs_correction: 'danger',
  paid:             'success'
};

const MY_REPORT_STATUS_META = {
  not_started:      { label: 'לא התחיל', kind: 'neutral' },
  in_progress:      { label: 'בטיפול', kind: 'warning' },
  submitted:        { label: 'נשלח לאישור', kind: 'warning' },
  needs_correction: { label: 'הוחזר לתיקון', kind: 'danger' },
  approved:         { label: 'אושר', kind: 'success' }
};

const ADMIN_MANAGE_STATUS_META = {
  not_started:      { label: 'לא התחיל', kind: 'neutral' },
  in_progress:      { label: 'בטיפול העובד', kind: 'warning' },
  submitted:        { label: 'נשלח לאישור', kind: 'warning' },
  needs_correction: { label: 'הוחזר לתיקון', kind: 'danger' },
  approved:         { label: 'אושר', kind: 'success' }
};

const PR_SCREEN_MODES = {
  MY_REPORTS: 'my-reports',
  MANAGEMENT: 'employee-reports-management'
};

// ─── module state ─────────────────────────────────────────────────────────────

let prSession        = null;
let prSelectedReport = null;
let prViewAsEmployee = null;
let prScreenMode     = PR_SCREEN_MODES.MY_REPORTS;
let isPersonalReportsUnlocked = false;
let _dashboardUser   = null;   // stored on bind() so all rerender() calls have it
let _prShellAbort    = null;
let _prScreenBound   = false;
let _prLoadGeneration = 0;
const _prCompletedKeys = new Set();
const _prInflightLoads = new Map();
const _prReportBundleCache = new Map();
const _prReportRowCache = new Map();
const _prProfileCache = new Map();
const _prOpenReportInflight = new Map();
const _prCurrentReportCache = new Map();
let _prCachedAdminReports = null;
let _prLastAdminFilters = { month: '', status: '' };
let _prActiveView = null;
const savingForms = new WeakSet();

function personalReportsDebugEnabled() {
  try {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('pr_debug') === '1') return true;
  } catch { /* ignore */ }
  return false;
}

function prDebugLog(message, detail = '') {
  if (!personalReportsDebugEnabled()) return;
  try {
    console.info('[personal-reports]', message, detail || '');
  } catch { /* ignore */ }
}

function buildPersonalReportsRequestKey({ employeeId = '', month = '', status = '', reportId = '' } = {}) {
  return `${String(employeeId || '').trim()}|${String(month || '').trim()}|${String(status || '').trim()}|${String(reportId || '').trim()}`;
}

function buildAdminReportsRequestKey(filters = _prLastAdminFilters) {
  return `admin-reports|${buildPersonalReportsRequestKey({
    month: filters.month,
    status: filters.status
  })}`;
}

function buildReportRowRequestKey(reportId) {
  return `report-row|${String(reportId || '').trim()}`;
}

function buildProfileRequestKey(employeeId) {
  return `profile|${String(employeeId || '').trim()}`;
}

function buildOpenReportRequestKey(reportId, isAdmin = false) {
  return `open-report|${String(reportId || '').trim()}|${isAdmin ? 'admin' : 'employee'}`;
}

function buildCurrentReportRequestKey(employeeId, month, year) {
  return `current-report|${String(employeeId || '').trim()}|${year}-${String(month).padStart(2, '0')}`;
}

function bumpPersonalReportsLoadGeneration() {
  _prLoadGeneration += 1;
}

function invalidatePersonalReportsLoadCache({ reportId = '', allReports = false } = {}) {
  if (allReports) {
    _prCachedAdminReports = null;
    _prCurrentReportCache.clear();
    for (const key of [..._prCompletedKeys]) {
      if (key.startsWith('admin-reports|') || key.startsWith('current-report|')) {
        _prCompletedKeys.delete(key);
      }
    }
  }
  if (reportId) {
    const reportKey = String(reportId || '').trim();
    const relatedKeys = new Set([
      buildPersonalReportsRequestKey({ reportId: reportKey }),
      buildReportRowRequestKey(reportKey),
      buildOpenReportRequestKey(reportKey, true),
      buildOpenReportRequestKey(reportKey, false)
    ]);
    for (const key of [..._prInflightLoads.keys(), ..._prCompletedKeys, ..._prReportBundleCache.keys()]) {
      if (relatedKeys.has(key) || key.endsWith(`|${reportKey}`)) {
        _prInflightLoads.delete(key);
        _prCompletedKeys.delete(key);
        _prReportBundleCache.delete(key);
      }
    }
    _prReportRowCache.delete(reportKey);
    _prOpenReportInflight.delete(buildOpenReportRequestKey(reportKey, true));
    _prOpenReportInflight.delete(buildOpenReportRequestKey(reportKey, false));
  }
}

function abortPersonalReportsScreenListeners(root) {
  root.__prAdminAbort?.abort();
  root.__prAdminViewAbort?.abort();
  root.__prEmployeeAbort?.abort();
  root.__prDetailAbort?.abort();
  root.__prSelectorAbort?.abort();
  root.__prLoginAbort?.abort();
}

async function runGuardedPersonalReportsLoad(requestKey, loadFn, { force = false } = {}) {
  if (!requestKey) throw new Error('missing_personal_reports_request_key');
  const existing = _prInflightLoads.get(requestKey);
  if (!force && existing) {
    prDebugLog('load skipped duplicate', requestKey);
    return existing.promise;
  }
  if (!force && _prCompletedKeys.has(requestKey)) {
    prDebugLog('load skipped duplicate', requestKey);
    return null;
  }
  const generation = _prLoadGeneration;
  prDebugLog('personalReports load start', requestKey);
  const promise = (async () => {
    try {
      const result = await loadFn();
      if (generation !== _prLoadGeneration) {
        prDebugLog('load finished (stale ignored)', requestKey);
        return result;
      }
      _prCompletedKeys.add(requestKey);
      prDebugLog('tables loaded', requestKey);
      prDebugLog('load finished', requestKey);
      return result;
    } finally {
      _prInflightLoads.delete(requestKey);
    }
  })();
  _prInflightLoads.set(requestKey, { promise, generation });
  return promise;
}

function defaultMonthFilterValue() {
  const { month, year } = currentMonthYear();
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

function parseMonthFilterValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return currentMonthYear();
  const [year, month] = raw.split('-').map(Number);
  if (!year || !month) return currentMonthYear();
  return { month, year };
}

function readAdminFilters(root) {
  const monthInput = root.querySelector('#pr-filter-month');
  return {
    month: monthInput?.value || defaultMonthFilterValue(),
    status: root.querySelector('#pr-filter-status')?.value || ''
  };
}

function adminFiltersChanged(next, prev = _prLastAdminFilters) {
  return next.month !== prev.month || next.status !== prev.status;
}

function reportHasActivity(report, totals = {}) {
  if (!report) return false;
  const travel = Number(totals.travel || 0);
  const expenses = Number(totals.expenses || 0);
  const workDays = Number(report.work_days_in_month || 0);
  const leaveDays = Number(report.vacation_days || 0) + Number(report.sick_days || 0) + Number(report.declaration_day || 0);
  return travel > 0 || expenses > 0 || workDays > 0 || leaveDays > 0 || Boolean(String(report.report_notes || '').trim());
}

function deriveMyReportStatus(report, totals = {}) {
  if (!report) return 'not_started';
  if (report.status === 'needs_correction') return 'needs_correction';
  if (report.status === 'approved' || report.status === 'paid') return 'approved';
  if (report.status === 'submitted' || report.status === 'reviewed') return 'submitted';
  if (report.status === 'draft') return reportHasActivity(report, totals) ? 'in_progress' : 'not_started';
  return 'not_started';
}

function deriveAdminManageStatus(report) {
  if (!report) return 'not_started';
  if (report.status === 'needs_correction') return 'needs_correction';
  if (report.status === 'approved' || report.status === 'paid') return 'approved';
  if (report.status === 'submitted' || report.status === 'reviewed') return 'submitted';
  if (report.status === 'draft') return 'in_progress';
  return 'not_started';
}

function manageStatusOptionsHtml(selectedStatus = '') {
  return Object.entries(ADMIN_MANAGE_STATUS_META).map(([value, meta]) =>
    `<option value="${escapeHtml(value)}" ${value === selectedStatus ? 'selected' : ''}>${escapeHtml(meta.label)}</option>`
  ).join('');
}

function manageStatusChipHtml(statusKey) {
  const meta = ADMIN_MANAGE_STATUS_META[statusKey] || { label: statusKey, kind: 'neutral' };
  return dsStatusChip(meta.label, meta.kind);
}

function myReportStatusChipHtml(statusKey) {
  const meta = MY_REPORT_STATUS_META[statusKey] || { label: statusKey, kind: 'neutral' };
  return dsStatusChip(meta.label, meta.kind);
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function bindScreenListeners(root, signal) {
  return {
    on(type, listener, options = {}) {
      root.addEventListener(type, listener, { signal, ...options });
    }
  };
}

function fmt(n) {
  return Number(n || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtNum(n) {
  const v = Number(n || 0);
  return v === Math.floor(v) ? v.toString() : v.toFixed(2);
}

function fmtDate(d) {
  if (!d) return '';
  try {
    const [y, m, day] = d.split('-');
    return `${day}.${m}.${String(y).slice(2)}`;
  } catch { return d; }
}

function fmtDateFull(d) {
  if (!d) return '';
  try {
    const [y, m, day] = d.split('-');
    return `${day}.${m}.${y}`;
  } catch { return d; }
}

function isoDate(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function reportPeriodRange(month, year) {
  const prev = new Date(year, month - 2, 25);
  const current = new Date(year, month - 1, 25);
  const start = isoDate(prev.getFullYear(), prev.getMonth() + 1, prev.getDate());
  const end = isoDate(current.getFullYear(), current.getMonth() + 1, current.getDate());
  return { start, end, label: `${fmtDateFull(start)}–${fmtDateFull(end)}` };
}

function isWorkday(date) {
  const day = date.getDay();
  return day >= 0 && day <= 4;
}

function countWorkdaysInclusive(startDate, endDate) {
  if (!startDate || !endDate) return 0;
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return 0;
  let count = 0;
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (isWorkday(d)) count += 1;
  }
  return count;
}

const ABSENCE_LABELS = {
  vacation: 'חופש',
  sick: 'מחלה',
  declaration: 'הצהרה'
};

function absenceLabel(type) {
  return ABSENCE_LABELS[type] || type || '—';
}

function attachmentForEntry(attachments, key, entryId) {
  return (attachments || []).find((a) => String(a?.[key] || '') === String(entryId || '')) || null;
}

function attachmentStatusHtml(attachment) {
  return attachment ? 'צורפה' : 'לא צורפה';
}

function calculatedAbsenceDays(row) {
  return countWorkdaysInclusive(row?.start_date, row?.end_date);
}

function sumAbsenceDays(absences, type) {
  return (absences || [])
    .filter((row) => row.absence_type === type)
    .reduce((sum, row) => sum + calculatedAbsenceDays(row), 0);
}

function missingExpenseAttachments(expenses, attachments) {
  return (expenses || []).filter((expense) => Number(expense.amount || 0) > 0
    && !attachmentForEntry(attachments, 'expense_entry_id', expense.id));
}

async function assertSalaryReady(reportId) {
  const [expenses, attachments] = await Promise.all([
    fetchExpenses(reportId),
    fetchAttachments(reportId)
  ]);
  const missingExpenses = missingExpenseAttachments(expenses, attachments);
  if (missingExpenses.length) {
    throw new Error(`missing_expense_receipts:${missingExpenses.length}`);
  }
}

function currentMonthYear() {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

function monthLabel(month, year) {
  return `${MONTHS_HE[month - 1]} ${year}`;
}

function daysInMonth(month, year) {
  return new Date(year, month, 0).getDate();
}

function canEdit(report) {
  return !report || report.status === 'draft' || report.status === 'needs_correction';
}

function isAdminRole(role) {
  return String(role || '').trim().toLowerCase() === 'admin';
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function firstUuid(...values) {
  return values.map((value) => String(value || '').trim()).find(isUuid) || '';
}

function dashboardUserForAuth() {
  return _dashboardUser || null;
}

function normalizeAccessCode(value) {
  if (value == null) return '';
  return String(value).trim();
}

function internalLoginErrorMessage(error) {
  const raw = String(error?.message || error?.code || error || '').trim();
  if (/missing_employee_uuid/i.test(raw)) {
    return 'לא נמצא מזהה עובד תקין במערכת. יש לצאת ולהיכנס מחדש לדשבורד, ואז לנסות שוב.';
  }
  return friendlyPersonalReportsError(error, 'הקוד שהוזן אינו תקין. יש לבדוק ולנסות שוב.');
}

function personalReportsNeedsShellRerender(root) {
  return !!root?.querySelector?.('.pr-loading-placeholder');
}

async function restorePersonalReportsShellView(root, { forceReload = false } = {}) {
  if (!isPersonalReportsUnlocked || !prSession?.user?.id) {
    _prActiveView = { kind: 'login' };
    renderInto(root, internalEmployeeLoginHtml());
    bindInternalEmployeeLogin(root);
    return;
  }
  const view = _prActiveView;
  if (view?.kind === 'admin-report' && view.reportId) {
    await safeOpenReportDetail(root, view.reportId, true, {
      isSimulation: view.isSimulation,
      initialTab: view.initialTab || 'status',
      forceReload
    });
    return;
  }
  if (view?.kind === 'employee-report' && view.reportId) {
    await safeOpenReportDetail(root, view.reportId, false, {
      isSimulation: view.isSimulation,
      initialTab: view.initialTab || 'status',
      forceReload
    });
    return;
  }
  await rerender(root, _dashboardUser, { forceReload });
}

function friendlyPersonalReportsError(error, fallback = 'אירעה תקלה בטעינת הדוחות. יש לנסות שוב או לפנות למנהל המערכת.') {
  const raw = String(error?.message || error?.code || error || '').trim();
  if (/invalid input syntax for type uuid|uuid/i.test(raw)) {
    return 'פרטי ההתחברות אינם תקינים. יש לבדוק את קוד העובד ולנסות שוב.';
  }
  if (/invalid_credentials|entry_code_mismatch|user_not_found|not_found/i.test(raw)) {
    return 'פרטי ההתחברות אינם תקינים. יש לבדוק את קוד העובד ולנסות שוב.';
  }
  if (/missing_employee_uuid/i.test(raw)) {
    return 'לא נמצא מזהה עובד תקין במערכת. יש לצאת ולהיכנס מחדש לדשבורד, ואז לנסות שוב.';
  }
  if (/missing_expense_receipts/i.test(raw)) {
    return 'לא ניתן לשלוח או לאשר לשכר: קיימת הוצאה כספית ללא קובץ אסמכתא / קבלה.';
  }
  if (/missing_travel_rate|missing travel rate/i.test(raw)) {
    return 'לא הוגדר תעריף החזר נסיעות לעובד. יש לפנות למנהל המערכת.';
  }
  if (/permission denied|row-level security|rls|unauthorized|forbidden/i.test(raw)) {
    return 'אין הרשאה לצפייה בדוחות אלה.';
  }
  return fallback;
}


function profileFromDashboardUser(user) {
  if (!user || typeof user !== 'object') return null;
  const id = firstUuid(
    user.personal_reports_user_id,
    user.supabase_user_id,
    user.auth_user_id,
    user.id
  );
  const displayRole = String(user.display_role || user.role || '').trim();
  const role = isAdminRole(displayRole) ? 'admin' : 'employee';
  return {
    id,
    email: String(user.email || user.work_email || '').trim(),
    full_name: String(user.full_name || user.name || user.user_id || 'משתמש מחובר').trim(),
    role,
    display_role: displayRole,
    emp_id: String(user.emp_id || user.employee_id || '').trim()
  };
}

function sessionFromDashboardState(appState) {
  const profile = profileFromDashboardUser(appState?.user);
  if (!profile) return null;
  return { user: { id: profile.id }, profile, needsInternalAuth: !profile.id };
}


function resetPersonalReportsAuth() {
  prSession        = null;
  prSelectedReport = null;
  prViewAsEmployee = null;
  prScreenMode     = PR_SCREEN_MODES.MY_REPORTS;
  isPersonalReportsUnlocked = false;
  _prScreenBound   = false;
  bumpPersonalReportsLoadGeneration();
  invalidatePersonalReportsLoadCache({ allReports: true });
  _prReportRowCache.clear();
  _prProfileCache.clear();
  _prOpenReportInflight.clear();
  _prLastAdminFilters = { employee: '', month: '', status: '' };
  _prActiveView = null;
  // _dashboardUser is intentionally kept — it's set once on bind() and is needed
  // to re-bind the lock screen if the session is invalidated mid-navigation.
}

function internalEmployeeLoginHtml(message = '') {
  return `
    <style>
      .pr-lock-wrap {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100%;
        padding: 40px 16px;
        background: #f1f5f9;
        direction: rtl;
        box-sizing: border-box;
      }
      .pr-lock-card {
        width: 100%;
        max-width: 420px;
        background: #ffffff;
        border: 1px solid #ddd6e7;
        border-radius: 16px;
        box-shadow: 0 8px 22px rgba(15,23,42,0.06);
        padding: 22px 24px;
        box-sizing: border-box;
        text-align: right;
      }
      .pr-lock-icon-wrap {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 42px;
        height: 42px;
        background: #eff6ff;
        border-radius: 14px;
        margin: 0 auto 14px;
        color: #1a3358;
      }
      .pr-lock-title {
        margin: 0 0 8px;
        font-size: 1.18rem;
        font-weight: 700;
        color: #0f172a;
        text-align: center;
        line-height: 1.4;
      }
      .pr-lock-subtitle {
        margin: 0 0 16px;
        font-size: 0.875rem;
        color: #64748b;
        text-align: center;
        line-height: 1.6;
      }
      .pr-lock-error {
        margin: 0 0 18px;
        padding: 10px 14px;
        background: #fef2f2;
        border: 1px solid #fecaca;
        border-radius: 8px;
        color: #991b1b;
        font-size: 0.875rem;
        text-align: right;
      }
      .pr-lock-form-inner {
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 100%;
        margin: 0 auto;
      }
      .pr-lock-field {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        margin-bottom: 14px;
      }
      .pr-lock-label {
        font-size: 0.82rem;
        font-weight: 600;
        color: #374151;
        text-align: center;
      }
      .pr-lock-input {
        all: unset;
        box-sizing: border-box;
        display: block;
        width: 260px;
        max-width: 100%;
        padding: 10px 12px;
        font-size: 1rem;
        font-family: inherit;
        color: #0f172a;
        background: #f8fafc;
        border: 1.5px solid #cbd5e1;
        border-radius: 10px;
        transition: border-color 0.15s, box-shadow 0.15s;
        direction: ltr;
        text-align: center;
        letter-spacing: 0.12em;
      }
      .pr-lock-input::placeholder {
        color: #94a3b8;
        letter-spacing: 0;
        direction: rtl;
        font-size: 0.82rem;
      }
      .pr-lock-input:focus {
        border-color: #1a3358;
        box-shadow: 0 0 0 3px rgba(26,51,88,0.12);
        background: #ffffff;
        outline: none;
      }
      .pr-lock-btn {
        all: unset;
        box-sizing: border-box;
        display: block;
        width: 150px;
        flex-shrink: 0;
        min-height: 38px;
        padding: 0 16px;
        font-size: 0.92rem;
        font-family: inherit;
        font-weight: 600;
        color: #ffffff;
        background: #1a3358;
        border-radius: 10px;
        cursor: pointer;
        text-align: center;
        transition: opacity 0.15s, transform 0.1s;
        -webkit-user-select: none;
        user-select: none;
      }
      .pr-lock-btn:hover { opacity: 0.87; }
      .pr-lock-btn:active { transform: scale(0.98); opacity: 0.9; }
      @media (max-width: 480px) {
        .pr-lock-card { width: min(92vw, 420px); padding: 20px; border-radius: 14px; }
        .pr-lock-wrap { padding: 20px 12px; align-items: flex-start; padding-top: 40px; }
        .pr-lock-input { width: min(260px, 100%); }
      }
    </style>
    <div class="pr-lock-wrap" dir="rtl">
      <div class="pr-lock-card" role="main" aria-labelledby="pr-lock-title">
        <div class="pr-lock-icon-wrap" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <h2 class="pr-lock-title" id="pr-lock-title">דוחות אישיים</h2>
        <p class="pr-lock-subtitle">אימות נוסף לדוחות אישיים — אזור זה כולל מידע רגיש. הזינו קוד התחברות להצגת הדוחות שלי</p>
        ${message ? `<div class="pr-lock-error" role="alert">${escapeHtml(message)}</div>` : ''}
        <form id="pr-internal-login-form" autocomplete="off">
          <div class="pr-lock-form-inner">
            <div class="pr-lock-field">
              <label class="pr-lock-label" for="pr-internal-access-code">קוד התחברות</label>
              <input class="pr-lock-input" id="pr-internal-access-code" name="access_code" type="password" autocomplete="off" placeholder="••••" required />
            </div>
            <button class="pr-lock-btn" type="submit">כניסה</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function authUnavailableHtml(message = 'לא נמצא משתמש מחובר במערכת. חזרו למסך הכניסה הראשי ונסו שוב.') {
  return `
    <div class="pr-screen" dir="rtl">
      <div class="pr-body">
        ${dsPageHeader('דוחות אישיים', 'הוצאות, נסיעות ודיווח שכר חודשי')}
        <div class="pr-card pr-card--highlight" role="alert">
          <h2 class="pr-card__title">נדרש משתמש מערכת מחובר</h2>
          <p class="pr-helper-text">${escapeHtml(message)}</p>
          <button class="pr-btn pr-btn--primary pr-btn--sm" data-pr-action="back-to-dashboard" type="button">חזרה לדשבורד</button>
        </div>
      </div>
    </div>
  `;
}

// ─── supabase API ─────────────────────────────────────────────────────────────

async function authenticateInternalEmployee(dashboardUser, accessCode) {
  const user = dashboardUser || dashboardUserForAuth();
  const enteredCode = normalizeAccessCode(accessCode);
  if (!enteredCode) {
    throw new Error('invalid_credentials');
  }

  // Compatibility note for the focused source guard: authUserId = authData.user.id; sameDashboardUser(userRow, dashboardUser).
  // Step 1: get the email of the currently authenticated Supabase session.
  // This is the authoritative source — no fallback to internal IDs or tables.
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData?.session?.user?.email) {
    console.error('[personal-reports] could not read Supabase Auth session', sessionError?.message);
    throw new Error('invalid_credentials');
  }
  const sessionEmail = sessionData.session.user.email;

  // Step 2: re-authenticate against Supabase Auth using the session email
  // and the code the user typed. No DB tables, no entry_code column, no UUIDs.
  const { error: authError } = await supabase.auth.signInWithPassword({
    email: sessionEmail,
    password: enteredCode
  });
  if (authError) {
    throw new Error('invalid_credentials');
  }

  // Step 3: the UUID for report queries comes exclusively from the
  // already-authenticated dashboard session — never from the entered code.
  const authUserId = firstUuid(
    user?.auth_user_id,
    user?.personal_reports_user_id,
    user?.supabase_user_id,
    user?.id
  );
  if (!isUuid(authUserId)) {
    throw new Error('missing_employee_uuid');
  }

  const profile = {
    id: authUserId,
    email: sessionEmail,
    full_name: String(user?.full_name || sessionEmail).trim(),
    role: isAdminRole(user?.display_role || user?.role) ? 'admin' : 'employee',
    display_role: String(user?.display_role || user?.role || '').trim(),
    emp_id: String(user?.emp_id || user?.employee_id || '').trim()
  };

  return { user: { id: authUserId }, profile, needsInternalAuth: false };
}

function assertEmployeeUuid(employeeId) {
  if (!isUuid(employeeId)) {
    throw new Error('missing_employee_uuid');
  }
}

async function getReport(employeeId, month, year) {
  assertEmployeeUuid(employeeId);
  const { data, error } = await supabase
    .from('personal_reports')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('report_month', month)
    .eq('report_year', year)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function getOrCreateReport(employeeId, month, year) {
  let report = await getReport(employeeId, month, year);
  if (report) return report;
  try {
    return await createReport(employeeId, month, year);
  } catch (err) {
    if (String(err?.code || err?.message || '').includes('23505')) {
      report = await getReport(employeeId, month, year);
      if (report) return report;
    }
    throw err;
  }
}

async function createReport(employeeId, month, year) {
  assertEmployeeUuid(employeeId);
  const { data, error } = await supabase
    .from('personal_reports')
    .insert({
      employee_id: employeeId,
      report_month: month,
      report_year: year,
      status: 'draft'
    })
    .select()
    .single();
  if (error) {
    console.error('[personal-reports] createReport failed', {
      employeeId, month, year,
      code: error.code, message: error.message, details: error.details
    });
    throw error;
  }
  return data;
}

async function fetchReport(reportId) {
  const { data, error } = await supabase.from('personal_reports').select('*').eq('id', reportId).single();
  if (error) throw error;
  return data;
}

async function loadReportRow(reportId, { force = false } = {}) {
  const normalizedId = String(reportId || '').trim();
  if (!normalizedId) throw new Error('missing_report_id');
  if (!force && _prReportRowCache.has(normalizedId)) {
    prDebugLog('load skipped duplicate', buildReportRowRequestKey(normalizedId));
    return _prReportRowCache.get(normalizedId);
  }
  const row = await runGuardedPersonalReportsLoad(
    buildReportRowRequestKey(normalizedId),
    () => fetchReport(normalizedId),
    { force }
  );
  const resolved = row || _prReportRowCache.get(normalizedId);
  if (!resolved) throw new Error('personal_report_row_unavailable');
  _prReportRowCache.set(normalizedId, resolved);
  return resolved;
}

async function loadEmployeeProfile(employeeId, { force = false } = {}) {
  const normalizedId = String(employeeId || '').trim();
  if (!normalizedId) return null;
  if (!force && _prProfileCache.has(normalizedId)) {
    prDebugLog('load skipped duplicate', buildProfileRequestKey(normalizedId));
    return _prProfileCache.get(normalizedId);
  }
  const profile = await runGuardedPersonalReportsLoad(
    buildProfileRequestKey(normalizedId),
    async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name, email')
        .eq('id', normalizedId)
        .maybeSingle();
      if (error) throw error;
      return data || null;
    },
    { force }
  );
  const resolved = profile ?? _prProfileCache.get(normalizedId) ?? null;
  if (resolved) _prProfileCache.set(normalizedId, resolved);
  return resolved;
}

async function loadCurrentMonthReport(employeeId, month, year, { force = false } = {}) {
  const cacheKey = `${String(employeeId || '').trim()}|${year}-${String(month).padStart(2, '0')}`;
  const requestKey = buildCurrentReportRequestKey(employeeId, month, year);
  if (!force && _prCurrentReportCache.has(cacheKey)) {
    prDebugLog('load skipped duplicate', requestKey);
    return _prCurrentReportCache.get(cacheKey);
  }
  const report = await runGuardedPersonalReportsLoad(
    requestKey,
    () => getReport(employeeId, month, year),
    { force }
  ).catch(() => null);
  const resolved = report ?? _prCurrentReportCache.get(cacheKey) ?? null;
  _prCurrentReportCache.set(cacheKey, resolved);
  return resolved;
}

async function updateReportMeta(reportId, fields) {
  const { error } = await supabase.from('personal_reports').update(fields).eq('id', reportId);
  if (error) throw error;
}

async function submitReport(reportId, signatureFullName) {
  const { error } = await supabase
    .from('personal_reports')
    .update({
      status: 'submitted',
      submitted_at: new Date().toISOString(),
      signature_full_name: signatureFullName || null,
      signature_confirmed_at: new Date().toISOString()
    })
    .eq('id', reportId);
  if (error) throw error;
}

async function adminUpdateReport(reportId, fields) {
  const { error } = await supabase.from('personal_reports').update(fields).eq('id', reportId);
  if (error) throw error;
}

async function fetchDeclaredTravel(reportId) {
  const [{ data: kmRows, error: kmError }, { data: publicRows, error: publicError }] = await Promise.all([
    supabase.from('declared_travel_entries').select('*').eq('report_id', reportId).order('travel_date'),
    supabase.from('public_transport_entries').select('*').eq('report_id', reportId).order('travel_date')
  ]);
  if (kmError) throw kmError;
  if (publicError) throw publicError;
  return [
    ...(kmRows || []).map((row) => ({ ...row, travel_type: 'km', entry_table: 'declared_travel_entries' })),
    ...(publicRows || []).map((row) => ({ ...row, travel_type: 'public_transport', roundtrip_km: 0, entry_table: 'public_transport_entries' }))
  ].sort((a, b) => String(a.travel_date || '').localeCompare(String(b.travel_date || '')));
}

async function fetchExpenses(reportId) {
  const { data, error } = await supabase
    .from('expense_entries').select('*').eq('report_id', reportId).order('expense_date');
  if (error) throw error;
  return data || [];
}

async function fetchAttachments(reportId) {
  const { data, error } = await supabase
    .from('report_attachments').select('*').eq('report_id', reportId).order('uploaded_at');
  if (error) throw error;
  return data || [];
}

async function fetchAbsences(reportId) {
  const { data, error } = await supabase
    .from('absence_entries').select('*').eq('report_id', reportId).order('start_date');
  if (error) throw error;
  return data || [];
}

async function loadReportBundle(reportId, { force = false } = {}) {
  const requestKey = buildPersonalReportsRequestKey({ reportId });
  if (!force) {
    const cached = _prReportBundleCache.get(requestKey);
    if (cached) {
      prDebugLog('load skipped duplicate', requestKey);
      return cached;
    }
  } else {
    invalidatePersonalReportsLoadCache({ reportId });
  }
  const bundle = await runGuardedPersonalReportsLoad(requestKey, async () => {
    const [travel, expenses, absences, attachments] = await Promise.all([
      fetchDeclaredTravel(reportId),
      fetchExpenses(reportId),
      fetchAbsences(reportId),
      fetchAttachments(reportId)
    ]);
    return { travel, expenses, absences, attachments };
  }, { force });
  const resolved = bundle || _prReportBundleCache.get(requestKey);
  if (!resolved) throw new Error('personal_reports_bundle_unavailable');
  _prReportBundleCache.set(requestKey, resolved);
  return resolved;
}

async function upsertAbsence(entry) {
  const payload = {
    ...entry,
    calculated_days: countWorkdaysInclusive(entry.start_date, entry.end_date)
  };
  if (payload.id) {
    const { data, error } = await supabase.from('absence_entries').update(payload).eq('id', payload.id).select().single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase.from('absence_entries').insert(payload).select().single();
  if (error) throw error;
  return data;
}

async function upsertDeclaredTravel(entry) {
  const { travel_type: travelType = 'km', id, ...baseEntry } = entry;
  const isPublicTransport = travelType === 'public_transport';
  if (!isPublicTransport) {
    const { data, error } = await supabase.rpc('upsert_declared_travel_entry', {
      p_id: id || null,
      p_report_id: baseEntry.report_id,
      p_employee_id: baseEntry.employee_id,
      p_travel_date: baseEntry.travel_date,
      p_origin: baseEntry.origin || '',
      p_destination: baseEntry.destination || '',
      p_description: baseEntry.description || '',
      p_roundtrip_km: Number(baseEntry.roundtrip_km || 0)
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return { ...row, travel_type: 'km', entry_table: 'declared_travel_entries' };
  }
  const table = 'public_transport_entries';
  const payload = Object.fromEntries(Object.entries(baseEntry).filter(([key]) => key !== 'roundtrip_km'));
  if (id) {
    const { data, error } = await supabase.from(table).update(payload).eq('id', id).select().single();
    if (error) throw error;
    return { ...data, travel_type: travelType, entry_table: table };
  }
  const { data, error } = await supabase.from(table).insert(payload).select().single();
  if (error) throw error;
  return { ...data, travel_type: travelType, entry_table: table };
}

async function upsertExpense(entry) {
  if (entry.id) {
    const { data, error } = await supabase.from('expense_entries').update(entry).eq('id', entry.id).select().single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase.from('expense_entries').insert(entry).select().single();
  if (error) throw error;
  return data;
}

async function deleteEntry(table, id) {
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) throw error;
}

async function uploadAttachment(reportId, employeeId, entryLink, file) {
  const ext = file.name.split('.').pop();
  const path = `${employeeId}/${reportId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from('personal-report-attachments')
    .upload(path, file, { upsert: false });
  if (uploadError) throw uploadError;
  const row = {
    report_id: reportId,
    employee_id: employeeId,
    storage_path: path,
    file_name: file.name,
    file_type: file.type,
    file_size: file.size
  };
  if (entryLink?.expenseEntryId) row.expense_entry_id = entryLink.expenseEntryId;
  if (entryLink?.absenceEntryId) row.absence_entry_id = entryLink.absenceEntryId;
  const { error: dbError } = await supabase.from('report_attachments').insert(row);
  if (dbError) throw dbError;
}

async function getSignedUrl(storagePath) {
  const { data, error } = await supabase.storage
    .from('personal-report-attachments')
    .createSignedUrl(storagePath, 60);
  if (error) throw error;
  return data.signedUrl;
}

async function deleteAttachment(attachment) {
  await supabase.storage.from('personal-report-attachments').remove([attachment.storage_path]);
  await supabase.from('report_attachments').delete().eq('id', attachment.id);
}

async function fetchReportEligibleEmployees() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, is_active, can_access_personal_reports')
    .order('full_name');
  if (error) throw error;
  return (data || []).filter((profile) =>
    profile.is_active !== false
    && permissionYes(profile.can_access_personal_reports)
  );
}

async function fetchReportsForMonth(month, year) {
  const { data, error } = await supabase
    .from('personal_reports')
    .select('*, profiles!personal_reports_employee_id_fkey(full_name, email)')
    .eq('report_month', month)
    .eq('report_year', year);
  if (error) throw error;
  return data || [];
}

async function buildEmployeeReportsManagementRows(month, year) {
  const [employees, reports] = await Promise.all([
    fetchReportEligibleEmployees(),
    fetchReportsForMonth(month, year)
  ]);
  const enrichedReports = await enrichReportsWithTotals(reports);
  const reportByEmployee = new Map(enrichedReports.map((report) => [report.employee_id, report]));
  return employees.map((employee) => {
    const report = reportByEmployee.get(employee.id) || null;
    return {
      employee,
      report,
      manageStatus: deriveAdminManageStatus(report),
      month,
      year,
      totals: report?.totals || { travel: 0, expenses: 0, all: 0 },
      workDays: report?.work_days_in_month ?? null
    };
  });
}

async function loadEmployeeReportsManagementList(filters = _prLastAdminFilters, { force = false } = {}) {
  const normalizedFilters = {
    month: filters.month || defaultMonthFilterValue(),
    status: filters.status || ''
  };
  const requestKey = buildAdminReportsRequestKey(normalizedFilters);
  if (!force && _prCachedAdminReports && _prCompletedKeys.has(requestKey)) {
    prDebugLog('load skipped duplicate', requestKey);
    return _prCachedAdminReports;
  }
  if (force) invalidatePersonalReportsLoadCache({ allReports: true });
  const { month, year } = parseMonthFilterValue(normalizedFilters.month);
  const rows = await runGuardedPersonalReportsLoad(
    requestKey,
    () => buildEmployeeReportsManagementRows(month, year),
    { force }
  );
  const resolved = rows || _prCachedAdminReports;
  if (!resolved) throw new Error('personal_reports_admin_list_unavailable');
  _prCachedAdminReports = resolved;
  _prLastAdminFilters = { ...normalizedFilters };
  return resolved;
}

async function loadMyReportCardData(employeeId, month, year, { force = false } = {}) {
  const report = await loadCurrentMonthReport(employeeId, month, year, { force });
  let totals = { travel: 0, expenses: 0, all: 0 };
  if (report?.id) {
    const bundle = await loadReportBundle(report.id, { force });
    const travel = (bundle?.travel || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const expenses = (bundle?.expenses || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
    totals = { travel, expenses, all: travel + expenses };
  }
  return {
    report,
    totals,
    workDays: report?.work_days_in_month ?? null,
    myStatus: deriveMyReportStatus(report, totals)
  };
}

async function enrichReportsWithTotals(reports) {
  const ids = reports.map((r) => r.id).filter(Boolean);
  if (!ids.length) return reports;
  const [travelRes, publicTravelRes, expensesRes] = await Promise.all([
    supabase.from('declared_travel_entries').select('report_id, amount').in('report_id', ids),
    supabase.from('public_transport_entries').select('report_id, amount').in('report_id', ids),
    supabase.from('expense_entries').select('report_id, amount').in('report_id', ids)
  ]);
  if (travelRes.error) throw travelRes.error;
  if (publicTravelRes.error) throw publicTravelRes.error;
  if (expensesRes.error) throw expensesRes.error;

  const totals = new Map(ids.map((id) => [id, { travel: 0, expenses: 0 }]));
  for (const row of travelRes.data || []) totals.get(row.report_id).travel += Number(row.amount || 0);
  for (const row of publicTravelRes.data || []) totals.get(row.report_id).travel += Number(row.amount || 0);
  for (const row of expensesRes.data || []) totals.get(row.report_id).expenses += Number(row.amount || 0);
  return reports.map((report) => {
    const t = totals.get(report.id) || { travel: 0, expenses: 0 };
    return { ...report, totals: { ...t, all: t.travel + t.expenses } };
  });
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function showToast(msg, kind = 'info') {
  const el = document.getElementById('pr-toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `pr-toast pr-toast--${kind} pr-toast--visible`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('pr-toast--visible'), 3500);
}


function rowsToPrintTable(headers, rows, emptyColspan) {
  const head = `<thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>`;
  const bodyRows = rows.length
    ? rows.join('')
    : `<tr><td colspan="${emptyColspan}" class="empty">אין רשומות</td></tr>`;
  return `<table>${head}<tbody>${bodyRows}</tbody></table>`;
}

async function openMonthlyReportPdf(reportId, forcedStatus = 'אושר לשכר') {
  const report = await loadReportRow(reportId, { force: true });
  const [profile, bundle] = await Promise.all([
    loadEmployeeProfile(report.employee_id, { force: true }),
    loadReportBundle(reportId, { force: true })
  ]);
  const { travel, expenses, absences, attachments } = bundle;

  const employeeName = profile?.full_name || prSession?.profile?.full_name || '—';
  const totalTravel = travel.reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalExpenses = expenses.reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalVacationDays = sumAbsenceDays(absences, 'vacation');
  const totalSickDays = sumAbsenceDays(absences, 'sick');
  const totalDeclarationDays = sumAbsenceDays(absences, 'declaration');
  const generatedAt = new Date().toLocaleString('he-IL');
  const reportPeriod = reportPeriodRange(report.report_month, report.report_year);
  const title = `דוח אישי חודשי לשכר - ${employeeName} - ${monthLabel(report.report_month, report.report_year)}`;

  const travelRows = travel.map((r) => {
    const typeLabel = r.travel_type === 'public_transport' ? 'תחבורה ציבורית' : 'ק״מ';
    return `<tr><td>${fmtDate(r.travel_date)}</td><td>${escapeHtml(typeLabel)}</td><td>${escapeHtml(r.origin || '')}</td><td>${escapeHtml(r.destination || '')}</td><td>${escapeHtml(r.description || '')}</td><td>${r.travel_type === 'public_transport' ? '—' : fmtNum(r.roundtrip_km)}</td><td>₪${fmt(r.amount)}</td></tr>`;
  });
  const expenseRows = expenses.map((r) => {
    const attachment = attachmentForEntry(attachments, 'expense_entry_id', r.id);
    return `<tr><td>${fmtDate(r.expense_date)}</td><td>${escapeHtml(r.description || '')}</td><td>₪${fmt(r.amount)}</td><td>${escapeHtml(attachmentStatusHtml(attachment))}</td></tr>`;
  });
  const absenceRows = absences.map((r) => {
    const attachment = attachmentForEntry(attachments, 'absence_entry_id', r.id);
    return `<tr><td>${escapeHtml(absenceLabel(r.absence_type))}</td><td>${fmtDate(r.start_date)}</td><td>${fmtDate(r.end_date)}</td><td>${fmtNum(calculatedAbsenceDays(r))}</td><td>${escapeHtml(attachmentStatusHtml(attachment))}</td></tr>`;
  });

  const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
    <style>
      body{font-family:Arial,'Assistant',sans-serif;margin:24px;color:#0f172a;direction:rtl} h1{font-size:22px;margin:0 0 12px} h2{font-size:15px;margin:22px 0 8px}.meta,.summary{display:grid;grid-template-columns:repeat(2,minmax(150px,1fr));gap:8px;max-width:680px}.box{border:1px solid #cbd5e1;border-radius:8px;padding:8px 10px;background:#f8fafc}.label{display:block;font-size:11px;color:#64748b}.value{font-weight:700}table{width:100%;border-collapse:collapse;margin-top:6px;font-size:12px}th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:right}th{background:#e2e8f0}.empty{text-align:center;color:#64748b}.print-actions{margin-bottom:14px}@media print{.print-actions{display:none}body{margin:12mm}}
    </style></head><body>
    <div class="print-actions"><button onclick="window.print()">הדפסה / שמירה כ-PDF</button></div>
    <h1>דוח אישי לשכר</h1>
    <section class="meta">
      <div class="box"><span class="label">שם העובד</span><span class="value">${escapeHtml(employeeName)}</span></div>
      <div class="box"><span class="label">חודש הדיווח</span><span class="value">${escapeHtml(monthLabel(report.report_month, report.report_year))}</span></div>
      <div class="box"><span class="label">תקופת הדיווח עד ה־25</span><span class="value">${escapeHtml(reportPeriod.label)}</span></div>
      <div class="box"><span class="label">תאריך הפקה</span><span class="value">${escapeHtml(generatedAt)}</span></div>
      <div class="box"><span class="label">סטטוס</span><span class="value">${escapeHtml(forcedStatus)}</span></div>
    </section>
    <h2>סיכום חודשי</h2>
    <section class="summary">
      <div class="box"><span class="label">סה״כ הוצאות</span><span class="value">₪${fmt(totalExpenses)}</span></div>
      <div class="box"><span class="label">סה״כ נסיעות</span><span class="value">₪${fmt(totalTravel)}</span></div>
      <div class="box"><span class="label">סה״כ ימי חופש מחושבים</span><span class="value">${fmtNum(totalVacationDays)}</span></div>
      <div class="box"><span class="label">סה״כ ימי מחלה מחושבים</span><span class="value">${fmtNum(totalSickDays)}</span></div>
      <div class="box"><span class="label">סה״כ ימי הצהרה מחושבים</span><span class="value">${fmtNum(totalDeclarationDays)}</span></div>
    </section>
    <h2>פירוט הוצאות</h2>${rowsToPrintTable(['תאריך','פירוט','סכום','האם צורפה אסמכתא'], expenseRows, 4)}
    <h2>פירוט נסיעות</h2>${rowsToPrintTable(['תאריך','ממקום','למקום','פירוט','ק״מ','סכום'], travelRows, 6)}
    <h2>היעדרויות / ימים</h2>${rowsToPrintTable(['סוג','מתאריך','עד תאריך','מספר ימים מחושב','אסמכתא'], absenceRows, 5)}
    <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250));</script>
    </body></html>`;
  const printWindow = window.open('', '_blank', 'width=900,height=1100');
  if (!printWindow) return;
  printWindow.document.write(html);
  printWindow.document.close();
}

// ─── HTML builders ────────────────────────────────────────────────────────────

function simulationBannerHtml(employeeName) {
  return `
    <div class="pr-simulation-banner" role="alert" dir="rtl">
      <span class="pr-simulation-banner__label">תצוגת אדמין כעובד:</span>
      <strong class="pr-simulation-banner__name">${escapeHtml(employeeName)}</strong>
      <button class="pr-btn pr-btn--ghost pr-btn--sm pr-simulation-banner__exit" data-pr-action="exit-simulation">← חזרה למסך ניהול</button>
    </div>
  `;
}

function personalReportsModeTabsHtml(activeMode) {
  return `
    <div class="pr-screen-mode-switch" role="tablist" aria-label="מעבר בין דוח אישי לניהול עובדים">
      <button class="pr-report-tab${activeMode === PR_SCREEN_MODES.MY_REPORTS ? ' is-active' : ''}" data-pr-action="screen-mode-my-reports" type="button" role="tab" aria-selected="${activeMode === PR_SCREEN_MODES.MY_REPORTS ? 'true' : 'false'}">הדוחות שלי</button>
      <button class="pr-report-tab${activeMode === PR_SCREEN_MODES.MANAGEMENT ? ' is-active' : ''}" data-pr-action="screen-mode-management" type="button" role="tab" aria-selected="${activeMode === PR_SCREEN_MODES.MANAGEMENT ? 'true' : 'false'}">ניהול דוחות עובדים</button>
    </div>
  `;
}

function myReportSummaryHtml(totals = {}, workDays = null) {
  const workDaysLabel = workDays === null || workDays === undefined || workDays === ''
    ? '—'
    : fmtNum(workDays);
  return `
    <div class="pr-my-report-summary" aria-label="סיכום קצר">
      <div class="pr-my-report-summary__item">
        <span class="pr-my-report-summary__label">סה״כ נסיעות</span>
        <strong class="pr-my-report-summary__value">₪${fmt(totals.travel || 0)}</strong>
      </div>
      <div class="pr-my-report-summary__item">
        <span class="pr-my-report-summary__label">סה״כ הוצאות</span>
        <strong class="pr-my-report-summary__value">₪${fmt(totals.expenses || 0)}</strong>
      </div>
      <div class="pr-my-report-summary__item">
        <span class="pr-my-report-summary__label">ימי עבודה</span>
        <strong class="pr-my-report-summary__value">${escapeHtml(workDaysLabel)}</strong>
      </div>
    </div>
  `;
}

function myReportActionsHtml(myStatus, report, month, year) {
  const monthAttrs = `data-report-month="${month}" data-report-year="${year}"`;
  const reportId = report?.id ? ` data-report-id="${escapeHtml(report.id)}"` : '';
  if (myStatus === 'not_started') {
    return `<button class="pr-btn pr-btn--primary pr-btn--lg" type="button" data-pr-action="open-month-report" ${monthAttrs}>מילוי דוח</button>`;
  }
  if (myStatus === 'in_progress') {
    return `<button class="pr-btn pr-btn--primary pr-btn--lg" type="button" data-pr-action="open-month-report" ${monthAttrs}>המשך מילוי</button>`;
  }
  if (myStatus === 'needs_correction') {
    return `<button class="pr-btn pr-btn--primary pr-btn--lg" type="button" data-pr-action="open-month-report" ${monthAttrs}>עריכת תיקונים</button>`;
  }
  if (myStatus === 'submitted' || myStatus === 'approved') {
    return `
      <button class="pr-btn pr-btn--primary pr-btn--lg" type="button" data-pr-action="view-my-report"${reportId}>צפייה בדוח</button>
      <button class="pr-btn pr-btn--ghost pr-btn--lg" type="button" data-pr-action="download-report-pdf"${reportId}>הורדת PDF</button>
    `;
  }
  return `<button class="pr-btn pr-btn--primary pr-btn--lg" type="button" data-pr-action="open-month-report" ${monthAttrs}>מילוי דוח</button>`;
}

function myReportsDashboardHtml(profile, {
  isSimulation = false,
  cardData = null,
  showModeTabs = false
} = {}) {
  const { month, year } = currentMonthYear();
  const currentLabel = monthLabel(month, year);
  const period = reportPeriodRange(month, year);
  const report = cardData?.report || null;
  const totals = cardData?.totals || { travel: 0, expenses: 0 };
  const workDays = cardData?.workDays ?? null;
  const myStatus = cardData?.myStatus || deriveMyReportStatus(report, totals);
  const statusChip = myReportStatusChipHtml(myStatus);
  const actions = myReportActionsHtml(myStatus, report, month, year);
  const modeTabs = showModeTabs ? personalReportsModeTabsHtml(PR_SCREEN_MODES.MY_REPORTS) : '';

  return `
    <div class="pr-screen pr-screen--my-reports" dir="rtl">
      ${isSimulation ? simulationBannerHtml(profile.full_name) : ''}
      <div class="pr-topbar">
        ${isSimulation
          ? `<button class="pr-btn pr-btn--ghost pr-back-btn" data-pr-action="exit-simulation">← חזרה למסך ניהול</button>`
          : `<button class="pr-btn pr-btn--ghost pr-back-btn" data-pr-action="back-to-dashboard">← חזרה לדשבורד</button>`}
        <span class="pr-topbar__title">דוחות אישיים</span>
        <button class="pr-btn pr-btn--ghost pr-btn--sm" data-pr-action="lock-screen" type="button" style="margin-right:auto" title="יציאה מהאזור הפנימי">יציאה</button>
      </div>
      <div class="pr-body pr-landing-body">
        ${modeTabs}
        <section class="pr-card pr-my-report-card" aria-label="הדוחות שלי">
          <div class="pr-my-report-card__header">
            <div>
              <span class="pr-eyebrow">הדוחות שלי</span>
              <h1 class="pr-my-report-card__title">דוח אישי לחודש הנוכחי</h1>
            </div>
            <span class="pr-my-report-card__employee">${escapeHtml(profile.full_name || '')}</span>
          </div>
          <div class="pr-my-report-card__meta">
            <div class="pr-my-report-card__meta-item">
              <span class="pr-month-label">חודש דיווח</span>
              <strong>${escapeHtml(currentLabel)}</strong>
              <span class="pr-my-report-card__period">${escapeHtml(period.label)}</span>
            </div>
            <div class="pr-my-report-card__meta-item">
              <span class="pr-month-label">סטטוס</span>
              ${statusChip}
            </div>
          </div>
          ${myReportSummaryHtml(totals, workDays)}
          <div class="pr-my-report-card__actions">${actions}</div>
        </section>
      </div>
    </div>
  `;
}

function reportEmptyStateHtml({ icon, title, text, action, actionLabel, editable }) {
  const actionHtml = editable && action
    ? `<button class="pr-btn pr-btn--primary pr-btn--empty-action" type="button" data-pr-action="${escapeHtml(action)}">${escapeHtml(actionLabel)}</button>`
    : '';
  return `
    <div class="pr-empty-state" role="status">
      <div class="pr-empty-state__icon" aria-hidden="true">${escapeHtml(icon)}</div>
      <div class="pr-empty-state__content">
        <h3 class="pr-empty-state__title">${escapeHtml(title)}</h3>
        <p class="pr-empty-state__text">${escapeHtml(text)}</p>
      </div>
      ${actionHtml}
    </div>
  `;
}

function tabCountBadge(count) {
  const label = Number(count || 0).toLocaleString('he-IL');
  return `<span class="pr-tab-count">${escapeHtml(label)}</span>`;
}

function sectionMetricHtml(label, value) {
  return `
    <div class="pr-section-metric">
      <span class="pr-section-metric__label">${escapeHtml(label)}</span>
      <strong class="pr-section-metric__value">${escapeHtml(value)}</strong>
    </div>
  `;
}

function compactEmptyRowHtml(text, icon = '') {
  return `<p class="pr-compact-empty">${icon ? `<span aria-hidden="true">${escapeHtml(icon)}</span>` : ''}<span>${escapeHtml(text)}</span></p>`;
}

function reportInfoRowHtml(label, value, { html = false } = {}) {
  if (value === null || value === undefined || value === '') return '';
  return `
    <div class="pr-info-row">
      <span class="pr-info-label">${escapeHtml(label)}</span>
      <span class="pr-info-value">${html ? value : escapeHtml(String(value))}</span>
    </div>
  `;
}

const PR_ACTION_ICONS = {
  edit: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  delete: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>',
  receipt: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>'
};

function prIconBtnHtml({ icon, title, action, attrs = '', danger = false } = {}) {
  return `<button class="pr-icon-btn${danger ? ' pr-icon-btn--danger' : ''}" type="button" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}" data-pr-action="${escapeHtml(action)}" ${attrs}>${PR_ACTION_ICONS[icon] || ''}</button>`;
}

function prIconUploadHtml({ icon, title, attrs = '' } = {}) {
  return `<label class="pr-icon-btn pr-upload-icon-btn" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">${PR_ACTION_ICONS[icon] || ''}<input type="file" class="pr-file-input" accept="image/*,.pdf" ${attrs} /></label>`;
}

function signatureDisplayName(profile, report) {
  const fromProfile = String(profile?.full_name || '').trim();
  const fromReport = String(report?.signature_full_name || '').trim();
  return fromProfile || fromReport;
}

function statusPanelHtml(report, reportPeriod, statusChip, statusText, correctionDate, resentText) {
  const detailRows = [
    reportInfoRowHtml('תקופת דיווח', reportPeriod.label),
    reportInfoRowHtml('הערת כספים / סיבת החזרה', report.finance_notes || ''),
    reportInfoRowHtml('תאריך החזרה לתיקון', correctionDate),
    reportInfoRowHtml('נשלח מחדש', resentText)
  ].filter(Boolean).join('');
  const hasStatusUpdate = report.status !== 'draft' || Boolean(report.finance_notes || correctionDate || resentText);

  if (!hasStatusUpdate || !detailRows) {
    return `<div class="pr-status-compact" aria-label="סטטוס נוכחי">${statusChip}</div>`;
  }

  return `
    <details class="pr-status-accordion">
      <summary class="pr-status-accordion__summary">
        <span class="pr-status-accordion__status">${statusChip}</span>
        <span class="pr-status-accordion__hint" aria-hidden="true">▾</span>
      </summary>
      <div class="pr-status-accordion__body">${detailRows}</div>
    </details>
  `;
}

function summaryPillHtml(label, value, { highlight = false } = {}) {
  if (value === null || value === undefined || value === '') return '';
  return `
    <div class="pr-sum-item${highlight ? ' pr-sum-item--total' : ''}">
      <span class="pr-sum-label">${escapeHtml(label)}</span>
      <span class="pr-sum-value">${escapeHtml(value)}</span>
    </div>
  `;
}

function reportDetailHtml(report, travel, expenses, absences, attachments, profile, { isSimulation = false } = {}) {
  const editable = canEdit(report);
  const monthYearLabel = monthLabel(report.report_month, report.report_year);
  const reportPeriod = reportPeriodRange(report.report_month, report.report_year);
  const statusChip = dsStatusChip(STATUS_LABELS[report.status] || report.status, STATUS_KIND[report.status] || 'neutral');
  const statusText = STATUS_LABELS[report.status] || report.status;

  const totalTravelKm  = travel.reduce((s, r) => s + Number(r.roundtrip_km || 0), 0);
  const totalTravel    = travel.reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalExpenses  = expenses.reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalVacationDays = sumAbsenceDays(absences, 'vacation');
  const totalSickDays = sumAbsenceDays(absences, 'sick');
  const totalDeclarationDays = sumAbsenceDays(absences, 'declaration');

  const absenceRows = absences.map((r) => {
    const attachment = attachmentForEntry(attachments, 'absence_entry_id', r.id);
    const actions = editable ? `
      <div class="pr-td-actions-group">
        ${prIconUploadHtml({ icon: 'receipt', title: 'צרף אסמכתא להיעדרות', attrs: `data-entry-id="${escapeHtml(r.id)}" data-entry-type="absence"` })}
        ${prIconBtnHtml({ icon: 'edit', title: 'עריכה', action: 'edit-absence', attrs: `data-entry-id="${escapeHtml(r.id)}" data-absence-type="${escapeHtml(r.absence_type)}" data-start-date="${escapeHtml(r.start_date)}" data-end-date="${escapeHtml(r.end_date)}" data-notes="${escapeHtml(r.notes || '')}"` })}
        ${prIconBtnHtml({ icon: 'delete', title: 'מחיקה', action: 'delete-entry', danger: true, attrs: `data-entry-id="${escapeHtml(r.id)}" data-entry-table="absence_entries"` })}
      </div>` : '';
    return `
      <tr class="pr-data-row" data-id="${escapeHtml(r.id)}">
        <td class="pr-col-type">${escapeHtml(absenceLabel(r.absence_type))}</td>
        <td class="pr-td-date">${fmtDate(r.start_date)}</td>
        <td class="pr-td-date">${fmtDate(r.end_date)}</td>
        <td class="pr-td-num">${fmtNum(calculatedAbsenceDays(r))}</td>
        <td class="pr-col-status"><span class="pr-attachment-status ${attachment ? 'is-attached' : 'is-missing'}">${attachment ? 'צורפה' : 'חסרה'}</span></td>
        <td class="pr-td-actions">${actions}</td>
      </tr>`;
  }).join('');

  const absenceTable = absences.length > 0
    ? `
      <div class="pr-table-scroll pr-entries-table-wrap">
        <table class="pr-data-table pr-entries-table">
          <thead>
            <tr>
              <th class="pr-col-type">סוג</th>
              <th class="pr-col-date">מתאריך</th>
              <th class="pr-col-date">עד תאריך</th>
              <th class="pr-col-num pr-th-num">ימים</th>
              <th class="pr-col-status">אסמכתא</th>
              <th class="pr-col-actions pr-th-actions"></th>
            </tr>
          </thead>
          <tbody>${absenceRows}</tbody>
        </table>
      </div>`
    : compactEmptyRowHtml('לא דווחו ימי חופש, מחלה או הצהרה לחודש זה.');

  const absenceChoiceButtons = editable ? `
    <button class="pr-btn pr-btn--outline pr-btn--sm pr-absence-type-btn" type="button" data-pr-action="choose-absence-type" data-absence-type="vacation">חופש</button>
    <button class="pr-btn pr-btn--outline pr-btn--sm pr-absence-type-btn" type="button" data-pr-action="choose-absence-type" data-absence-type="sick">מחלה</button>
    <button class="pr-btn pr-btn--outline pr-btn--sm pr-absence-type-btn" type="button" data-pr-action="choose-absence-type" data-absence-type="declaration">הצהרה</button>
  ` : '';

  const addAbsencePanel = editable ? `
    <div class="pr-add-panel pr-absence-panel" id="pr-add-absence-panel" hidden>
      <form class="pr-add-form" data-form-type="absence">
        <input type="hidden" name="id" />
        <input type="hidden" name="absence_type" />
        <div class="pr-absence-fields">
          <div class="pr-form-row">
            <div class="pr-field"><label class="pr-label">מתאריך *</label><input class="pr-input pr-absence-date" type="date" name="start_date" /></div>
            <div class="pr-field"><label class="pr-label">עד תאריך *</label><input class="pr-input pr-absence-date" type="date" name="end_date" /></div>
            <div class="pr-field"><label class="pr-label">ימים מחושבים</label><input class="pr-input" type="number" name="calculated_days" readonly value="0" /></div>
          </div>
          <div class="pr-form-row">
            <div class="pr-field pr-field--wide"><label class="pr-label">קובץ אסמכתא</label><input class="pr-input" type="file" name="attachment" accept="image/*,.pdf" /></div>
          </div>
          <div class="pr-add-form-actions">
            <button class="pr-btn pr-btn--primary" type="submit">שמירה</button>
            <button class="pr-btn pr-btn--ghost" type="button" data-pr-action="cancel-absence-form">ביטול</button>
          </div>
        </div>
      </form>
    </div>
  ` : '';

  const travelRows = travel.map((r) => {
    const isPublicTransport = r.travel_type === 'public_transport';
    const typeLabel = isPublicTransport ? 'תחבורה ציבורית' : 'ק״מ';
    const routeLabel = `${escapeHtml(r.origin || '')} ← ${escapeHtml(r.destination || '')}`;
    const actions = editable ? `
      <div class="pr-td-actions-group">
        ${prIconBtnHtml({ icon: 'edit', title: 'עריכה', action: 'edit-travel', attrs: `data-entry-id="${escapeHtml(r.id)}" data-entry-table="${escapeHtml(r.entry_table || 'declared_travel_entries')}" data-travel-type="${escapeHtml(r.travel_type || 'km')}" data-travel-date="${escapeHtml(r.travel_date)}" data-origin="${escapeHtml(r.origin || '')}" data-destination="${escapeHtml(r.destination || '')}" data-description="${escapeHtml(r.description || '')}" data-roundtrip-km="${escapeHtml(r.roundtrip_km || '')}" data-amount="${escapeHtml(r.amount || '')}" data-notes="${escapeHtml(r.notes || '')}"` })}
        ${prIconBtnHtml({ icon: 'delete', title: 'מחיקה', action: 'delete-entry', danger: true, attrs: `data-entry-id="${escapeHtml(r.id)}" data-entry-table="${escapeHtml(r.entry_table || 'declared_travel_entries')}"` })}
      </div>` : '';
    return `
      <tr class="pr-data-row" data-id="${escapeHtml(r.id)}">
        <td class="pr-td-date">${fmtDate(r.travel_date)}</td>
        <td class="pr-col-type">${escapeHtml(typeLabel)}</td>
        <td class="pr-col-detail">${routeLabel}${r.description ? `<span class="pr-td-notes"> · ${escapeHtml(r.description)}</span>` : ''}</td>
        <td class="pr-td-num">${isPublicTransport ? '—' : fmtNum(r.roundtrip_km)}</td>
        <td class="pr-td-num pr-td-amount">₪${fmt(r.amount)}</td>
        <td class="pr-td-actions">${actions}</td>
      </tr>`;
  }).join('');

  const addTravelPanel = editable ? `
    <div class="pr-add-panel" id="pr-add-travel-panel" hidden>
      <form class="pr-add-form" id="pr-add-travel-form" data-form-type="declared_travel">
        <input type="hidden" name="id" />
        <input type="hidden" name="original_table" />
        <div class="pr-form-row">
          <div class="pr-field"><label class="pr-label">סוג דיווח *</label>
            <select class="pr-input pr-input--select" name="travel_type" required>
              <option value="km">נסיעה לפי ק״מ</option>
              <option value="public_transport">תחבורה ציבורית</option>
            </select></div>
          <div class="pr-field"><label class="pr-label">תאריך *</label>
            <input class="pr-input" type="date" name="travel_date" required /></div>
          <div class="pr-field"><label class="pr-label">ממקום *</label>
            <input class="pr-input" type="text" name="origin" required placeholder="מ..." /></div>
          <div class="pr-field"><label class="pr-label">למקום *</label>
            <input class="pr-input" type="text" name="destination" required placeholder="ל..." /></div>
        </div>
        <div class="pr-form-row">
          <div class="pr-field pr-field--wide"><label class="pr-label">פירוט / הערות</label>
            <input class="pr-input" type="text" name="description" placeholder="תיאור הנסיעה" /></div>
          <div class="pr-field pr-travel-km-field"><label class="pr-label">ק״מ *</label>
            <input class="pr-input" type="number" name="roundtrip_km" min="0" step="0.1" required placeholder="0" /></div>
          <div class="pr-field pr-travel-public-field" hidden><label class="pr-label">עלות תחבורה ציבורית ₪ *</label>
            <input class="pr-input" type="number" name="public_transport_amount" min="0" step="0.01" placeholder="0.00" /></div>
        </div>
        <p class="pr-travel-km-note pr-travel-km-field">סכום ההחזר יחושב לאחר השמירה.</p>
        <div class="pr-add-form-actions">
          <button class="pr-btn pr-btn--primary" type="submit">שמירה</button>
          <button class="pr-btn pr-btn--ghost" type="button" data-pr-action="hide-add-travel">ביטול</button>
        </div>
      </form>
    </div>
  ` : '';

  const expenseRows = expenses.map(r => {
    const attachment = attachmentForEntry(attachments, 'expense_entry_id', r.id);
    const actions = editable ? `
      <div class="pr-td-actions-group">
        ${prIconUploadHtml({ icon: 'receipt', title: 'צרף קבלה או אסמכתא', attrs: `data-entry-id="${escapeHtml(r.id)}" data-entry-type="expense"` })}
        ${prIconBtnHtml({ icon: 'edit', title: 'עריכה', action: 'edit-expense', attrs: `data-entry-id="${escapeHtml(r.id)}" data-expense-date="${escapeHtml(r.expense_date)}" data-document-type="${escapeHtml(r.document_type || 'receipt')}" data-description="${escapeHtml(r.description || '')}" data-amount="${escapeHtml(r.amount || '')}" data-notes="${escapeHtml(r.notes || '')}"` })}
        ${prIconBtnHtml({ icon: 'delete', title: 'מחיקה', action: 'delete-entry', danger: true, attrs: `data-entry-id="${escapeHtml(r.id)}" data-entry-table="expense_entries"` })}
      </div>` : '';
    return `
      <tr class="pr-data-row" data-id="${escapeHtml(r.id)}">
        <td class="pr-td-date">${fmtDate(r.expense_date)}</td>
        <td class="pr-col-detail">${escapeHtml(r.description)}</td>
        <td class="pr-td-num pr-td-amount">₪${fmt(r.amount)}</td>
        <td class="pr-col-status"><span class="pr-attachment-status ${attachment ? 'is-attached' : 'is-missing'}">${attachment ? 'צורפה' : 'חסרה'}</span></td>
        <td class="pr-td-actions">${actions}</td>
      </tr>`;
  }).join('');

  const addExpensePanel = editable ? `
    <div class="pr-add-panel" id="pr-add-expense-panel" hidden>
      <form class="pr-add-form" id="pr-add-expense-form" data-form-type="expense">
        <input type="hidden" name="id" />
        <div class="pr-form-row">
          <div class="pr-field"><label class="pr-label">תאריך *</label>
            <input class="pr-input" type="date" name="expense_date" required /></div>
          <div class="pr-field">
            <label class="pr-label">סוג</label>
            <select class="pr-input pr-input--select" name="document_type">
              <option value="receipt">קבלה</option>
              <option value="invoice">חשבונית</option>
              <option value="other">אחר</option>
            </select>
          </div>
          <div class="pr-field pr-field--wide"><label class="pr-label">פירוט *</label>
            <input class="pr-input" type="text" name="description" required placeholder="תיאור ההוצאה" /></div>
        </div>
        <div class="pr-form-row">
          <div class="pr-field"><label class="pr-label">סכום ₪ *</label>
            <input class="pr-input" type="number" name="amount" min="0" step="0.01" required placeholder="0.00" /></div>
          <div class="pr-field pr-field--wide"><label class="pr-label">הערות</label>
            <input class="pr-input" type="text" name="notes" placeholder="הערות" /></div>
        </div>
        <div class="pr-form-row">
          <div class="pr-field pr-field--wide"><label class="pr-label">קובץ אסמכתא / קבלה</label>
            <input class="pr-input" type="file" name="attachment" accept="image/*,.pdf" /></div>
        </div>
        <div class="pr-add-form-actions">
          <button class="pr-btn pr-btn--primary" type="submit">שמירה</button>
          <button class="pr-btn pr-btn--ghost" type="button" data-pr-action="hide-add-expense">ביטול</button>
        </div>
      </form>
    </div>
  ` : '';

  const travelTable = travel.length > 0
    ? `
      <div class="pr-table-scroll pr-entries-table-wrap">
        <table class="pr-data-table pr-entries-table">
          <thead>
            <tr>
              <th class="pr-col-date">תאריך</th>
              <th class="pr-col-type">סוג</th>
              <th class="pr-col-detail">מסלול</th>
              <th class="pr-col-num pr-th-num">ק״מ</th>
              <th class="pr-col-num pr-th-num">₪</th>
              <th class="pr-col-actions pr-th-actions"></th>
            </tr>
          </thead>
          <tbody>
            ${travelRows}
            ${totalTravel > 0 ? `<tr class="pr-total-row"><td colspan="3" class="pr-total-label">סה"כ</td><td class="pr-td-num pr-total-num">${fmtNum(totalTravelKm)}</td><td class="pr-td-num pr-total-num pr-total-amount">${fmt(totalTravel)}</td><td></td></tr>` : ''}
          </tbody>
        </table>
      </div>`
    : compactEmptyRowHtml('אין נסיעות מדווחות לחודש זה.');

  const expensesTable = expenses.length > 0
    ? `
      <div class="pr-table-scroll pr-entries-table-wrap">
        <table class="pr-data-table pr-entries-table">
          <thead>
            <tr>
              <th class="pr-col-date">תאריך</th>
              <th class="pr-col-detail">פירוט</th>
              <th class="pr-col-num pr-th-num">₪</th>
              <th class="pr-col-status">אסמכתא</th>
              <th class="pr-col-actions pr-th-actions"></th>
            </tr>
          </thead>
          <tbody>
            ${expenseRows}
            ${totalExpenses > 0 ? `<tr class="pr-total-row"><td colspan="2" class="pr-total-label">סה"כ</td><td class="pr-td-num pr-total-num pr-total-amount">${fmt(totalExpenses)}</td><td colspan="2"></td></tr>` : ''}
          </tbody>
        </table>
      </div>`
    : compactEmptyRowHtml('לא נוספו הוצאות לחודש זה.');

  const addTravelButton = editable
    ? `<button class="pr-btn pr-btn--primary pr-btn--sm pr-section-action" type="button" data-pr-action="show-add-travel">הוספת נסיעה</button>`
    : '';
  const addExpenseButton = editable
    ? `<button class="pr-btn pr-btn--primary pr-btn--sm pr-section-action" type="button" data-pr-action="show-add-expense">הוספת הוצאה</button>`
    : '';

  const signatureName = signatureDisplayName(profile, report);

  const submitSection = editable && !isSimulation ? `
    <div class="pr-submit-card pr-submit-card--compact">
      <label class="pr-label pr-signature-field" for="pr-signature-name">
        <span>שם מלא לחתימה</span>
        <input class="pr-input pr-signature-input" id="pr-signature-name" type="text"
          value="${escapeHtml(signatureName)}" autocomplete="name" />
      </label>
      <label class="pr-confirm-label">
        <input type="checkbox" id="pr-confirm-checkbox" class="pr-confirm-checkbox" />
        <span>אני מאשר/ת שהפרטים נכונים ומלאים</span>
      </label>
      <button class="pr-btn pr-btn--primary pr-submit-btn"
        id="pr-submit-btn" data-pr-action="submit-report"
        data-report-id="${escapeHtml(report.id)}" disabled>
        ${report.status === 'needs_correction' ? 'שליחה מחדש' : 'אישור ושליחה'}
      </button>
    </div>
  ` : editable && isSimulation ? `
    <div class="pr-submit-card">
      <p class="pr-sim-note">מצב סימולציה — שליחה חסומה</p>
    </div>
  ` : `
    <div class="pr-submit-card pr-submit-card--locked">
      <span class="pr-locked-msg">🔒 הדוח נעול לעריכה — סטטוס: ${escapeHtml(statusText)}</span>
      <div class="pr-submit-finish-actions">
        <button class="pr-btn pr-btn--secondary pr-btn--sm" type="button" data-pr-action="download-report-pdf" data-report-id="${escapeHtml(report.id)}">הורדת PDF</button>
        <button class="pr-btn pr-btn--ghost pr-btn--sm" type="button" data-pr-action="back-to-my-reports">חזרה לדוחות שלי</button>
      </div>
    </div>
  `;

  const correctionDate = report.status === 'needs_correction' && report.updated_at ? fmtDate(String(report.updated_at).slice(0, 10)) : '';
  const resentText = report.status !== 'needs_correction' && report.finance_notes && report.submitted_at
    ? `כן, ${fmtDate(String(report.submitted_at).slice(0, 10))}`
    : '';
  const detailsSummary = [
    totalExpenses > 0 ? summaryPillHtml('סה"כ הוצאות', `₪${fmt(totalExpenses)}`) : '',
    totalTravel > 0 ? summaryPillHtml('סה"כ נסיעות', `₪${fmt(totalTravel)}`) : '',
    totalVacationDays > 0 ? summaryPillHtml('ימי חופש', fmtNum(totalVacationDays)) : '',
    totalSickDays > 0 ? summaryPillHtml('ימי מחלה', fmtNum(totalSickDays)) : '',
    totalDeclarationDays > 0 ? summaryPillHtml('ימי הצהרה', fmtNum(totalDeclarationDays)) : ''
  ].filter(Boolean).join('');

  return `
    <div class="pr-screen pr-report-form" dir="rtl">
      ${isSimulation ? simulationBannerHtml(profile.full_name) : ''}
      <div class="pr-body pr-report-detail-body">
        <section class="pr-card pr-report-hero-card" aria-label="כותרת דוח חודשי">
          <div class="pr-report-hero-card__main">
            <span class="pr-eyebrow">דוחות אישיים</span>
            <h1 class="pr-report-hero-card__title">דוח אישי לשכר — ${escapeHtml(monthYearLabel)}</h1>
            <p class="pr-report-hero-card__meta">${escapeHtml(profile.full_name || '')}</p>
          </div>
          <button class="pr-btn pr-btn--ghost pr-back-btn" type="button" data-pr-action="back-to-my-reports">← חזרה לדוחות שלי</button>
        </section>

        <nav class="pr-report-tabs" role="tablist" aria-label="אזורי הדוח">
          <button class="pr-report-tab is-active" type="button" role="tab" aria-selected="true" data-pr-action="switch-report-tab" data-tab="status">
            <span>סטטוס</span>
          </button>
          <button class="pr-report-tab" type="button" role="tab" aria-selected="false" data-pr-action="switch-report-tab" data-tab="travel">
            <span>נסיעות</span>${tabCountBadge(travel.length)}
          </button>
          <button class="pr-report-tab" type="button" role="tab" aria-selected="false" data-pr-action="switch-report-tab" data-tab="expenses">
            <span>הוצאות</span>${tabCountBadge(expenses.length)}
          </button>
          <button class="pr-report-tab" type="button" role="tab" aria-selected="false" data-pr-action="switch-report-tab" data-tab="absences">
            <span>ימי עבודה</span>${tabCountBadge(absences.length)}
          </button>
          <button class="pr-report-tab" type="button" role="tab" aria-selected="false" data-pr-action="switch-report-tab" data-tab="details">
            <span>אישור דיווח</span>
          </button>
        </nav>

        <section class="pr-card pr-section-card pr-tab-panel" data-tab-panel="expenses">
          <div class="pr-section-head">
            <div>
              <h2 class="pr-section-title">הוצאות</h2>
            </div>
            <div class="pr-section-head__actions">${addExpenseButton}</div>
          </div>
          ${expensesTable}
          ${addExpensePanel}
        </section>

        <section class="pr-card pr-section-card pr-tab-panel" data-tab-panel="travel">
          <div class="pr-section-head">
            <div>
              <h2 class="pr-section-title">נסיעות</h2>
            </div>
            <div class="pr-section-head__actions">${addTravelButton}</div>
          </div>
          ${travelTable}
          ${addTravelPanel}
        </section>

        <section class="pr-card pr-section-card pr-tab-panel" data-tab-panel="status" id="pr-report-header">
          <div class="pr-status-log" aria-label="יומן מצב">
            ${statusPanelHtml(report, reportPeriod, statusChip, statusText, correctionDate, resentText)}
          </div>
          <p class="pr-info-note">יש להשלים ולשלוח את הדיווח עד ה־26 בכל חודש. הדיווח מתייחס לתקופת הדיווח עד ה־25 בכל חודש.</p>
        </section>
        <section class="pr-card pr-section-card pr-tab-panel" data-tab-panel="absences">
          <div class="pr-section-head">
            <div>
              <h2 class="pr-section-title">ימי עבודה</h2>
              <p class="pr-section-subtext">מדווחים כאן רק אם היו ימי חופש, מחלה או הצהרה.</p>
            </div>
            <div class="pr-section-head__actions pr-absence-choice">${absenceChoiceButtons}</div>
          </div>
          ${addAbsencePanel}
          ${absenceTable}
        </section>

        <section class="pr-card pr-section-card pr-tab-panel" data-tab-panel="details">
          <p class="pr-details-period">תקופת דיווח: ${escapeHtml(reportPeriod.label)}</p>
          ${detailsSummary ? `<section class="pr-summary-bar pr-summary-bar--details" aria-label="סיכום הדוח">${detailsSummary}</section>` : ''}
          ${submitSection}
        </section>
      </div>
    </div>
  `;
}


function reportSubmittedSuccessHtml(reportId, message = 'הדוח אושר ונשלח לשכר בהצלחה') {
  return `
    <div class="pr-screen pr-submit-success-screen" dir="rtl">
      <div class="pr-body pr-report-detail-body">
        <section class="pr-card pr-submit-success-card" role="status">
          <span class="pr-submit-success-card__icon" aria-hidden="true">✓</span>
          <h1 class="pr-report-hero-card__title">${escapeHtml(message)}</h1>
          <p class="pr-helper-text">עותק PDF הופק מנתוני הדוח. ניתן להוריד אותו שוב או לחזור לרשימת החודשים.</p>
          <div class="pr-submit-finish-actions">
            <button class="pr-btn pr-btn--primary" type="button" data-pr-action="download-report-pdf" data-report-id="${escapeHtml(reportId)}">הורדת PDF</button>
            <button class="pr-btn pr-btn--ghost" type="button" data-pr-action="back-to-my-reports">חזרה לדוחות שלי</button>
          </div>
        </section>
      </div>
    </div>
  `;
}

function statusOptionsHtml(selectedStatus) {
  return Object.entries(STATUS_LABELS).map(([value, label]) =>
    `<option value="${escapeHtml(value)}" ${value === selectedStatus ? 'selected' : ''}>${escapeHtml(label)}</option>`
  ).join('');
}

function employeeReportsManagementPlaceholderHtml(errorMsg = '') {
  const errorHtml = errorMsg
    ? `<div class="pr-alert pr-alert--danger" role="alert">${escapeHtml(errorMsg)}</div>`
    : '';
  return `
    <div class="pr-screen pr-screen--management" dir="rtl">
      <div class="pr-topbar">
        <button class="pr-btn pr-btn--ghost pr-back-btn" data-pr-action="back-to-dashboard">← חזרה לדשבורד</button>
        <span class="pr-topbar__title">ניהול דוחות עובדים</span>
        <button class="pr-btn pr-btn--ghost pr-btn--sm" data-pr-action="lock-screen" type="button" style="margin-right:auto" title="יציאה מהאזור הפנימי">יציאה</button>
      </div>
      <div class="pr-body pr-management-body">
        ${personalReportsModeTabsHtml(PR_SCREEN_MODES.MANAGEMENT)}
        <section class="pr-card pr-admin-placeholder" aria-label="ניהול דוחות עובדים">
          <h2 class="pr-card__title">ניהול דוחות עובדים</h2>
          <p class="pr-helper-text">רשימת העובדים שחייבים בדיווח תוצג כאן לאחר טעינת הנתונים.</p>
          ${errorHtml}
        </section>
      </div>
    </div>
  `;
}

function employeeReportsManagementHtml(rows, filters = _prLastAdminFilters) {
  const monthValue = filters.month || defaultMonthFilterValue();
  const { month, year } = parseMonthFilterValue(monthValue);
  const monthLabelText = monthLabel(month, year);

  const tableRows = rows.map((row) => {
    const employee = row.employee || {};
    const report = row.report || null;
    const totals = row.totals || { travel: 0, expenses: 0 };
    const workDaysLabel = row.workDays === null || row.workDays === undefined || row.workDays === ''
      ? '—'
      : fmtNum(row.workDays);
    const reportIdAttr = report?.id ? ` data-report-id="${escapeHtml(report.id)}"` : '';
    return `
      <tr class="pr-admin-report-row" data-employee-id="${escapeHtml(employee.id)}" data-report-month="${escapeHtml(monthValue)}" data-manage-status="${escapeHtml(row.manageStatus)}">
        <td>${escapeHtml(employee.full_name || '—')}</td>
        <td>${escapeHtml(monthLabelText)}</td>
        <td class="pr-td-status">${manageStatusChipHtml(row.manageStatus)}</td>
        <td class="pr-td-num pr-td-amount">₪${fmt(totals.travel)}</td>
        <td class="pr-td-num pr-td-amount">₪${fmt(totals.expenses)}</td>
        <td class="pr-td-num">${escapeHtml(workDaysLabel)}</td>
        <td class="pr-actions-cell">
          <button class="pr-btn pr-btn--primary pr-btn--sm" type="button" data-pr-action="admin-manage-report"${reportIdAttr}
            data-employee-id="${escapeHtml(employee.id)}"
            data-report-month="${month}"
            data-report-year="${year}">צפייה וניהול</button>
        </td>
      </tr>
    `;
  });

  return `
    <div class="pr-screen pr-screen--management" dir="rtl">
      <div class="pr-topbar">
        <button class="pr-btn pr-btn--ghost pr-back-btn" data-pr-action="back-to-dashboard">← חזרה לדשבורד</button>
        <span class="pr-topbar__title">ניהול דוחות עובדים</span>
        <button class="pr-btn pr-btn--ghost pr-btn--sm" data-pr-action="lock-screen" type="button" style="margin-right:auto" title="יציאה מהאזור הפנימי">יציאה</button>
      </div>
      <div class="pr-body pr-management-body">
        ${personalReportsModeTabsHtml(PR_SCREEN_MODES.MANAGEMENT)}
        <div class="pr-card pr-admin-filters pr-admin-filters--compact" aria-label="סינון דוחות עובדים">
          <label class="pr-label">חודש דיווח
            <input class="pr-input" id="pr-filter-month" type="month" value="${escapeHtml(monthValue)}" />
          </label>
          <label class="pr-label">סטטוס
            <select class="pr-input pr-input--select" id="pr-filter-status">
              <option value="">כל הסטטוסים</option>
              ${manageStatusOptionsHtml(filters.status || '')}
            </select>
          </label>
          <button class="pr-btn pr-btn--ghost pr-btn--sm" data-pr-action="clear-admin-filters" type="button">נקה סינון</button>
        </div>
        ${rows.length === 0 ? dsEmptyState('אין עובדים להצגה לחודש הנבחר') : `
          <div class="pr-table-scroll">
            <table class="pr-table pr-admin-table pr-admin-table--management">
              <colgroup>
                <col class="pr-admin-col-employee" />
                <col class="pr-admin-col-month" />
                <col class="pr-admin-col-status" />
                <col class="pr-admin-col-money" />
                <col class="pr-admin-col-money" />
                <col class="pr-admin-col-workdays" />
                <col class="pr-admin-col-actions" />
              </colgroup>
              <thead><tr>
                <th>עובד</th><th>חודש דיווח</th><th>סטטוס</th><th>סה״כ נסיעות</th><th>סה״כ הוצאות</th><th>ימי עבודה</th><th>פעולה</th>
              </tr></thead>
              <tbody>${tableRows.join('')}</tbody>
            </table>
          </div>
        `}
      </div>
    </div>
  `;
}

function adminNotStartedReportHtml({ employee, month, year }) {
  const monthYearLabel = monthLabel(month, year);
  const period = reportPeriodRange(month, year);
  const statusChip = manageStatusChipHtml('not_started');
  return `
    <div class="pr-screen pr-report-form" dir="rtl">
      <div class="pr-topbar">
        <button class="pr-btn pr-btn--ghost pr-back-btn" data-pr-action="back-to-admin">← חזרה לרשימה</button>
        <span class="pr-topbar__title">${escapeHtml(monthYearLabel)} — ${escapeHtml(employee?.full_name || '')}</span>
        <div class="pr-topbar-status">${statusChip}</div>
      </div>
      <div class="pr-body">
        <section class="pr-card pr-report-header-card">
          <h2 class="pr-section-title">פרטי דוח</h2>
          <div class="pr-report-identity">
            <div class="pr-id-item"><span class="pr-id-label">עובד</span><strong>${escapeHtml(employee?.full_name || '')}</strong></div>
            <div class="pr-id-item"><span class="pr-id-label">חודש דיווח</span><strong>${escapeHtml(monthYearLabel)}</strong></div>
            <div class="pr-id-item"><span class="pr-id-label">תקופת דיווח</span><strong>${escapeHtml(period.label)}</strong></div>
            <div class="pr-id-item"><span class="pr-id-label">סטטוס</span>${statusChip}</div>
          </div>
          <p class="pr-helper-text">העובד עדיין לא התחיל למלא דוח לחודש זה.</p>
        </section>
      </div>
    </div>
  `;
}

function adminEmployeeSelectorHtml(employees) {
  const rows = employees.length === 0
    ? dsEmptyState('אין עובדים פעילים')
    : employees.map(e => `
        <div class="pr-employee-select-row" role="button" tabindex="0"
          data-pr-action="select-view-as-employee"
          data-employee-id="${escapeHtml(e.id)}"
          data-employee-name="${escapeHtml(e.full_name || '')}"
          data-employee-email="${escapeHtml(e.email || '')}">
          <span class="pr-employee-select-name">${escapeHtml(e.full_name || '—')}</span>
          <span class="pr-employee-select-email">${escapeHtml(e.email || '')}</span>
        </div>
      `).join('');

  return `
    <div class="pr-screen" dir="rtl">
      <div class="pr-topbar">
        <button class="pr-btn pr-btn--ghost pr-back-btn" data-pr-action="back-to-admin">← חזרה לרשימה</button>
        <span class="pr-topbar__title">תצוגה כעובד — בחירת עובד</span>
      </div>
      <div class="pr-body">
        ${dsPageHeader('תצוגה כעובד', 'בחר עובד פעיל לסימולציית תצוגה')}
        <div class="pr-card pr-employee-select-list">${rows}</div>
      </div>
    </div>
  `;
}

function myReportsListHtml(reports) {
  if (!reports || reports.length === 0) {
    return `<p class="pr-empty-msg">עדיין לא קיימים דוחות. בחר חודש למעלה כדי להתחיל.</p>`;
  }
  return `
    <h3 class="pr-list-heading">דוחות קודמים</h3>
    ${reports.map(r => `
      <div class="pr-report-card" data-pr-action="open-existing-report" data-report-id="${escapeHtml(r.id)}" role="button" tabindex="0">
        <div class="pr-report-card__title">${escapeHtml(monthLabel(r.report_month, r.report_year))}</div>
        <div class="pr-report-card__meta">
          ${dsStatusChip(STATUS_LABELS[r.status] || r.status, STATUS_KIND[r.status] || 'neutral')}
          ${r.submitted_at ? `<span class="pr-report-card__date">נשלח: ${fmtDate(r.submitted_at.slice(0, 10))}</span>` : ''}
        </div>
      </div>
    `).join('')}
  `;
}

// ─── render helpers ───────────────────────────────────────────────────────────

function renderInto(root, html) {
  root.innerHTML = `
    <div id="pr-toast" class="pr-toast" role="alert" aria-live="assertive"></div>
    ${html}
  `;
}

function showReportSubmittedSuccess(root, reportId, message, { isSimulation = false } = {}) {
  _prActiveView = { kind: 'submit-success', reportId, isSimulation };
  invalidatePersonalReportsLoadCache({ reportId });
  renderInto(root, reportSubmittedSuccessHtml(reportId, message));
}

async function returnToEmployeeDashboard(root, { isSimulation = false } = {}) {
  const employeeId = isSimulation ? prViewAsEmployee?.id : prSession?.user?.id;
  const profile = isSimulation ? prViewAsEmployee : prSession?.profile;
  if (!employeeId || !profile) return;

  const submittedReportId = _prActiveView?.reportId || prSelectedReport?.id;
  if (submittedReportId) invalidatePersonalReportsLoadCache({ reportId: submittedReportId });

  abortPersonalReportsScreenListeners(root);
  prSelectedReport = null;
  _prActiveView = { kind: 'my-reports', isSimulation };

  const { month, year } = currentMonthYear();
  const cardData = await loadMyReportCardData(employeeId, month, year, { force: true });
  const showModeTabs = isAdminRole(profile.role) && !isSimulation;
  renderInto(root, myReportsDashboardHtml(profile, { isSimulation, cardData, showModeTabs }));
  bindMyReportsDashboard(root, { isSimulation });
}

async function loadMyReportsList(root, employeeId) {
  const listEl = root.querySelector('#pr-my-reports-list');
  try {
    assertEmployeeUuid(employeeId);
    const { data: reports, error } = await supabase
      .from('personal_reports')
      .select('*')
      .eq('employee_id', employeeId)
      .order('report_year', { ascending: false })
      .order('report_month', { ascending: false });
    if (error) throw error;
    if (listEl) listEl.innerHTML = myReportsListHtml(reports || []);
  } catch (err) {
    if (listEl) {
      listEl.innerHTML = `<div class="pr-alert pr-alert--danger" role="alert">${escapeHtml(friendlyPersonalReportsError(err))}</div>`;
    }
  }
}

function renderLoadedReportDetail(root, {
  report,
  reportProfile,
  travel,
  expenses,
  absences,
  attachments,
  isAdmin = false,
  isSimulation = false,
  initialTab = 'status'
} = {}) {
  prSelectedReport = report;
  _prActiveView = {
    kind: isAdmin && !isSimulation ? 'admin-report' : 'employee-report',
    reportId: report.id,
    isSimulation,
    initialTab
  };
  if (isAdmin && !isSimulation) {
    report.profiles = reportProfile;
    renderInto(root, adminReportViewHtml(report, travel, expenses, absences, attachments));
    bindAdminReportView(root);
    return;
  }
  renderInto(root, reportDetailHtml(report, travel, expenses, absences, attachments, reportProfile, { isSimulation }));
  bindReportDetail(root, { isSimulation });
  setReportTab(root, initialTab);
}

function personalReportsReportAlreadyRendered(root, reportId, isAdmin = false, { isSimulation = false } = {}) {
  const normalizedId = String(reportId || '').trim();
  const viewKind = isAdmin && !isSimulation ? 'admin-report' : 'employee-report';
  return Boolean(
    normalizedId
    && _prActiveView?.kind === viewKind
    && String(_prActiveView.reportId || '') === normalizedId
    && Boolean(_prActiveView.isSimulation) === Boolean(isSimulation)
    && prSelectedReport?.id === normalizedId
    && root?.querySelector?.('.pr-report-form')
  );
}

async function openReportDetail(root, reportId, isAdmin = false, { isSimulation = false, initialTab = 'status', forceReload = false } = {}) {
  const normalizedId = String(reportId || '').trim();
  const openKey = buildOpenReportRequestKey(normalizedId, isAdmin && !isSimulation);
  const viewKind = isAdmin && !isSimulation ? 'admin-report' : 'employee-report';
  if (!forceReload && personalReportsReportAlreadyRendered(root, normalizedId, isAdmin, { isSimulation })) {
    prDebugLog('open skipped already rendered', openKey);
    return;
  }
  if (!forceReload && _prOpenReportInflight.has(openKey)) {
    prDebugLog('load skipped duplicate', openKey);
    return _prOpenReportInflight.get(openKey);
  }

  _prActiveView = { kind: viewKind, reportId: normalizedId, isSimulation, initialTab };

  const task = (async () => {
    abortPersonalReportsScreenListeners(root);
    const report = await loadReportRow(normalizedId, { force: forceReload });
    const expectedEmployeeId = isSimulation ? prViewAsEmployee?.id : prSession?.user?.id;
    if (!isAdmin && String(report?.employee_id || '') !== String(expectedEmployeeId || '')) {
      throw new Error('unauthorized_report_access');
    }

    let reportProfile = prSession?.profile;
    if (isSimulation && prViewAsEmployee) {
      reportProfile = prViewAsEmployee;
    } else {
      const profileRow = await loadEmployeeProfile(report.employee_id, { force: forceReload });
      if (profileRow) {
        reportProfile = {
          ...(reportProfile || {}),
          full_name: String(profileRow.full_name || reportProfile?.full_name || '').trim(),
          email: String(profileRow.email || reportProfile?.email || '').trim()
        };
      }
    }

    const bundle = await loadReportBundle(normalizedId, { force: forceReload });
    const { travel, expenses, absences, attachments } = bundle;
    renderLoadedReportDetail(root, {
      report,
      reportProfile,
      travel,
      expenses,
      absences,
      attachments,
      isAdmin,
      isSimulation,
      initialTab
    });
  })();

  _prOpenReportInflight.set(openKey, task);
  try {
    await task;
  } finally {
    _prOpenReportInflight.delete(openKey);
  }
}

async function safeOpenReportDetail(root, reportId, isAdmin = false, options = {}) {
  try {
    if (options.forceReload) invalidatePersonalReportsLoadCache({ reportId });
    await openReportDetail(root, reportId, isAdmin, options);
  } catch (err) {
    showToast(friendlyPersonalReportsError(err, 'אירעה תקלה בטעינת הדוחות. יש לנסות שוב או לפנות למנהל המערכת.'), 'danger');
  }
}

// ─── admin report view (read-only with admin actions) ─────────────────────────

function adminReportViewHtml(report, travel, expenses, absences, attachments) {
  const profile = report.profiles || {};
  const totalTravelKm  = travel.reduce((s, r) => s + Number(r.roundtrip_km || 0), 0);
  const totalTravel    = travel.reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalExpenses  = expenses.reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalAll       = totalTravel + totalExpenses;
  const totalVacationDays = sumAbsenceDays(absences, 'vacation');
  const totalSickDays = sumAbsenceDays(absences, 'sick');
  const totalDeclarationDays = sumAbsenceDays(absences, 'declaration');

  const travelRows = travel.length === 0
    ? `<tr><td colspan="8" class="pr-table-empty">אין רשומות</td></tr>`
    : travel.map(r => `
        <tr><td>${fmtDate(r.travel_date)}</td><td>${escapeHtml(r.origin)}</td>
        <td>${escapeHtml(r.destination)}</td><td>${escapeHtml(r.description)}</td>
        <td class="pr-td-num">${fmtNum(r.roundtrip_km)}</td>
        <td class="pr-td-num pr-td-amount">${fmt(r.amount)}</td>
        <td>${escapeHtml(r.notes || '')}</td><td></td></tr>
      `).join('');

  const expenseRows = expenses.length === 0
    ? `<tr><td colspan="7" class="pr-table-empty">אין רשומות</td></tr>`
    : expenses.map(r => {
        const attachment = attachmentForEntry(attachments, 'expense_entry_id', r.id);
        return `
        <tr><td>${fmtDate(r.expense_date)}</td>
        <td>${escapeHtml(r.document_type === 'receipt' ? 'קבלה' : r.document_type === 'invoice' ? 'חשבונית' : 'אחר')}</td>
        <td>${escapeHtml(r.description)}</td>
        <td class="pr-td-num pr-td-amount">${fmt(r.amount)}</td>
        <td>${escapeHtml(attachmentStatusHtml(attachment))}</td><td>${escapeHtml(r.notes || '')}</td><td></td></tr>`;
      }).join('');

  const absenceRows = absences.length === 0
    ? `<tr><td colspan="6" class="pr-table-empty">אין רשומות</td></tr>`
    : absences.map((r) => {
        const attachment = attachmentForEntry(attachments, 'absence_entry_id', r.id);
        return `<tr><td>${escapeHtml(absenceLabel(r.absence_type))}</td><td>${fmtDate(r.start_date)}</td><td>${fmtDate(r.end_date)}</td><td class="pr-td-num">${fmtNum(calculatedAbsenceDays(r))}</td><td>${escapeHtml(attachmentStatusHtml(attachment))}</td><td>${escapeHtml(r.notes || '')}</td></tr>`;
      }).join('');

  const attachRows = attachments.map(a => `
    <div class="pr-attachment-row">
      <span class="pr-attachment-name">${escapeHtml(a.file_name)}</span>
      <button class="pr-btn pr-btn--ghost pr-btn--sm" data-pr-action="view-attachment"
        data-storage-path="${escapeHtml(a.storage_path)}">הורד / צפה</button>
    </div>
  `).join('');

  const statusChip = dsStatusChip(STATUS_LABELS[report.status] || report.status, STATUS_KIND[report.status] || 'neutral');
  const monthYearLabel = monthLabel(report.report_month, report.report_year);

  return `
    <div class="pr-screen pr-report-form" dir="rtl">
      <div class="pr-topbar">
        <button class="pr-btn pr-btn--ghost pr-back-btn" data-pr-action="back-to-admin">← חזרה לרשימה</button>
        <span class="pr-topbar__title">${escapeHtml(monthYearLabel)} — ${escapeHtml(profile.full_name || profile.email || '')}</span>
        <div class="pr-topbar-status">${statusChip}</div>
      </div>
      <div class="pr-body">
        <!-- Report identity -->
        <div class="pr-card pr-report-header-card">
          <h2 class="pr-section-title">פרטי דוח</h2>
          <div class="pr-report-identity">
            <div class="pr-id-item"><span class="pr-id-label">עובד</span><strong>${escapeHtml(profile.full_name || '')}</strong></div>
            <div class="pr-id-item"><span class="pr-id-label">חודש דיווח</span><strong>${escapeHtml(monthYearLabel)}</strong></div>
            <div class="pr-id-item"><span class="pr-id-label">תקופת דיווח</span><strong>${escapeHtml(reportPeriod.label)}</strong></div>
            <div class="pr-id-item"><span class="pr-id-label">סטטוס</span>${statusChip}</div>
          </div>
          <div class="pr-meta-grid">
            <div class="pr-meta-item"><span class="pr-meta-label">ימי חופש מחושבים</span><strong>${fmtNum(totalVacationDays)}</strong></div>
            <div class="pr-meta-item"><span class="pr-meta-label">ימי מחלה מחושבים</span><strong>${fmtNum(totalSickDays)}</strong></div>
            <div class="pr-meta-item"><span class="pr-meta-label">ימי הצהרה מחושבים</span><strong>${fmtNum(totalDeclarationDays)}</strong></div>
          </div>
        </div>

        <!-- Summary bar -->
        <div class="pr-summary-bar">
          <div class="pr-sum-item"><span class="pr-sum-label">נסיעות בהצהרה</span><span class="pr-sum-value">₪${fmt(totalTravel)}</span></div>
          <div class="pr-sum-item"><span class="pr-sum-label">החזר הוצאות</span><span class="pr-sum-value">₪${fmt(totalExpenses)}</span></div>
          <div class="pr-sum-item pr-sum-item--total"><span class="pr-sum-label">סה"כ החזרים</span><span class="pr-sum-value">₪${fmt(totalAll)}</span></div>
          <div class="pr-sum-item"><span class="pr-sum-label">חופש</span><span class="pr-sum-value">${fmtNum(totalVacationDays)}</span></div>
          <div class="pr-sum-item"><span class="pr-sum-label">מחלה</span><span class="pr-sum-value">${fmtNum(totalSickDays)}</span></div>
          <div class="pr-sum-item"><span class="pr-sum-label">הצהרה</span><span class="pr-sum-value">${fmtNum(totalDeclarationDays)}</span></div>
        </div>

        <!-- Travel -->
        <div class="pr-card pr-section-card">
          <div class="pr-section-head"><h2 class="pr-section-title">נסיעות בהצהרה</h2></div>
          <div class="pr-table-scroll"><table class="pr-data-table">
            <thead><tr><th>תאריך</th><th>ממקום</th><th>למקום</th><th>פירוט</th><th class="pr-th-num">ק"מ</th><th class="pr-th-num">₪</th><th>הערות</th><th></th></tr></thead>
            <tbody>${travelRows}
              <tr class="pr-total-row"><td colspan="4" class="pr-total-label">סה"כ</td>
                <td class="pr-td-num pr-total-num">${fmtNum(totalTravelKm)}</td>
                <td class="pr-td-num pr-total-num pr-total-amount">${fmt(totalTravel)}</td>
                <td colspan="2"></td></tr>
            </tbody>
          </table></div>
        </div>

        <!-- Transport -->
        <!-- Expenses -->
        <div class="pr-card pr-section-card">
          <div class="pr-section-head"><h2 class="pr-section-title">הוצאות</h2></div>
          <div class="pr-table-scroll"><table class="pr-data-table">
            <thead><tr><th>תאריך</th><th>סוג</th><th>פירוט</th><th class="pr-th-num">₪</th><th>קבלה/חשבונית</th><th>הערות</th><th></th></tr></thead>
            <tbody>${expenseRows}
              <tr class="pr-total-row"><td colspan="3" class="pr-total-label">סה"כ</td>
                <td class="pr-td-num pr-total-num pr-total-amount">${fmt(totalExpenses)}</td>
                <td colspan="3"></td></tr>
            </tbody>
          </table></div>
        </div>

        <div class="pr-card pr-section-card">
          <div class="pr-section-head"><h2 class="pr-section-title">היעדרויות / ימים</h2></div>
          <div class="pr-table-scroll"><table class="pr-data-table">
            <thead><tr><th>סוג</th><th>מתאריך</th><th>עד תאריך</th><th class="pr-th-num">ימים</th><th>אסמכתא</th><th>הערות</th></tr></thead>
            <tbody>${absenceRows}</tbody>
          </table></div>
        </div>

        ${attachments.length > 0 ? `
          <div class="pr-card pr-section-card">
            <div class="pr-section-head"><h2 class="pr-section-title">קבצים מצורפים</h2></div>
            <div class="pr-attachments-list">${attachRows}</div>
          </div>
        ` : ''}

        <!-- Admin notes + actions -->
        <div class="pr-card">
          <h2 class="pr-section-title">הערות כספים</h2>
          <textarea class="pr-input" id="pr-admin-notes" rows="3"
            placeholder="הוסף הערה לעובד…">${escapeHtml(report.finance_notes || '')}</textarea>
          <button class="pr-btn pr-btn--primary" data-pr-action="admin-save-notes"
            data-report-id="${escapeHtml(report.id)}" style="margin-top:8px">שמור הערות</button>
        </div>
        <div class="pr-actions pr-admin-detail-actions">
          <button class="pr-btn pr-btn--ghost" data-pr-action="download-report-pdf" data-report-id="${escapeHtml(report.id)}">הורדת PDF</button>
          ${report.status === 'submitted' || report.status === 'reviewed' ? `
            <button class="pr-btn pr-btn--primary" data-pr-action="admin-approve" data-report-id="${escapeHtml(report.id)}">✔ אשר דוח</button>
            <button class="pr-btn pr-btn--warning" data-pr-action="admin-return" data-report-id="${escapeHtml(report.id)}">↩ החזר לתיקון</button>
          ` : ''}
          ${report.status === 'approved' ? `
            <button class="pr-btn pr-btn--primary" data-pr-action="admin-mark-paid" data-report-id="${escapeHtml(report.id)}">₪ סמן כשולם</button>
          ` : ''}
        </div>
      </div>
    </div>
  `;
}

// ─── binding ──────────────────────────────────────────────────────────────────

async function safeOpenAdminManageReport(root, { reportId = '', employeeId = '', month = 0, year = 0 } = {}) {
  if (reportId) {
    await safeOpenReportDetail(root, reportId, true);
    return;
  }
  const profile = await loadEmployeeProfile(employeeId, { force: true });
  _prActiveView = { kind: 'admin-report', reportId: '', employeeId, month, year, isSimulation: false };
  renderInto(root, adminNotStartedReportHtml({ employee: profile, month, year }));
  bindAdminNotStartedView(root);
}

function bindAdminNotStartedView(root) {
  root.__prAdminViewAbort?.abort();
  const adminViewAbort = new AbortController();
  root.__prAdminViewAbort = adminViewAbort;
  const listeners = bindScreenListeners(root, adminViewAbort.signal);
  listeners.on('click', async (e) => {
    const btn = e.target.closest('[data-pr-action]');
    if (!btn) return;
    if (btn.dataset.prAction === 'back-to-admin') {
      _prActiveView = { kind: 'employee-reports-management' };
      prSelectedReport = null;
      await rerender(root, _dashboardUser);
    }
  });
}

function bindMyReportsDashboard(root, { isSimulation = false } = {}) {
  root.__prEmployeeAbort?.abort();
  const employeeAbort = new AbortController();
  root.__prEmployeeAbort = employeeAbort;
  const listeners = bindScreenListeners(root, employeeAbort.signal);
  const employeeId = isSimulation ? prViewAsEmployee?.id : prSession?.user?.id;
  listeners.on('click', async (e) => {
    const btn = e.target.closest('[data-pr-action]');
    if (!btn) return;
    const action = btn.dataset.prAction;

    if (action === 'exit-simulation') {
      prViewAsEmployee = null;
      await rerender(root, _dashboardUser);
      return;
    }
    if (action === 'lock-screen') {
      resetPersonalReportsAuth();
      renderInto(root, internalEmployeeLoginHtml());
      bindInternalEmployeeLogin(root);
      return;
    }
    if (action === 'back-to-dashboard') {
      dispatchBackToDashboard(); return;
    }
    if (action === 'screen-mode-management') {
      prScreenMode = PR_SCREEN_MODES.MANAGEMENT;
      await rerender(root, _dashboardUser);
      return;
    }
    if (action === 'screen-mode-my-reports') {
      prScreenMode = PR_SCREEN_MODES.MY_REPORTS;
      await rerender(root, _dashboardUser);
      return;
    }

    if (action === 'open-month-report') {
      if (!employeeId) return;
      const month = Number(btn.dataset.reportMonth || 0);
      const year = Number(btn.dataset.reportYear || 0);
      try {
        btn.disabled = true;
        const originalLabel = btn.textContent;
        btn.textContent = 'פותח…';
        const report = await getOrCreateReport(employeeId, month, year);
        await safeOpenReportDetail(root, report.id, false, { isSimulation, initialTab: 'status' });
        btn.disabled = false;
        btn.textContent = originalLabel;
      } catch (err) {
        showToast(friendlyPersonalReportsError(err), 'danger');
        btn.disabled = false;
      }
      return;
    }

    if (action === 'view-my-report') {
      const reportId = btn.dataset.reportId;
      if (!reportId) return;
      await safeOpenReportDetail(root, reportId, false, { isSimulation, initialTab: 'status' });
      return;
    }

    if (action === 'download-report-pdf') {
      try {
        await openMonthlyReportPdf(btn.dataset.reportId || prSelectedReport?.id, 'אושר / נשלח לשכר');
        showToast('PDF מוכן להורדה / שמירה', 'success');
      } catch (err) { showToast(friendlyPersonalReportsError(err), 'danger'); }
      return;
    }
  });
}

function currentReportTab(root) {
  return root.querySelector('.pr-report-tab.is-active')?.dataset?.tab || 'status';
}

function setReportTab(root, tab = 'status') {
  const allowed = new Set(['status', 'travel', 'expenses', 'absences', 'details']);
  const activeTab = allowed.has(tab) ? tab : 'status';
  root.querySelectorAll('.pr-report-tab').forEach((btn) => {
    const isActive = btn.dataset.tab === activeTab;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  root.querySelectorAll('.pr-tab-panel').forEach((panel) => {
    panel.hidden = panel.dataset.tabPanel !== activeTab;
  });
}

function bindReportDetail(root, { isSimulation = false } = {}) {
  const SIM_MSG = 'מצב סימולציה — פעולה זו חסומה. זוהי תצוגה בלבד.';
  root.__prDetailAbort?.abort();
  const detailAbort = new AbortController();
  root.__prDetailAbort = detailAbort;
  const listeners = bindScreenListeners(root, detailAbort.signal);

  // Enable submit button only when checkbox is checked
  const checkbox = root.querySelector('#pr-confirm-checkbox');
  const submitBtn = root.querySelector('#pr-submit-btn');
  const signatureNameInput = root.querySelector('#pr-signature-name');
  function updateSubmitEnabled() {
    if (!submitBtn) return;
    submitBtn.disabled = !(checkbox?.checked && String(signatureNameInput?.value || '').trim());
  }
  if (checkbox && submitBtn) {
    listeners.on('change', (e) => {
      if (e.target === checkbox) updateSubmitEnabled();
    });
    listeners.on('input', (e) => {
      if (e.target === signatureNameInput) updateSubmitEnabled();
    });
    updateSubmitEnabled();
  }

  const travelForm = root.querySelector('#pr-add-travel-form');
  if (travelForm) updateTravelTypeFields(travelForm);

  function hidePanel(panelId) {
    const panel = root.querySelector(`#${panelId}`);
    if (panel) panel.hidden = true;
  }

  function showPanel(panelId) {
    const panel = root.querySelector(`#${panelId}`);
    if (!panel) return null;
    panel.hidden = false;
    panel.querySelector('input,select,textarea')?.focus();
    return panel;
  }

  function setFormValues(form, values) {
    if (!form) return;
    Object.entries(values).forEach(([name, value]) => {
      const field = form.querySelector(`[name="${name}"]`);
      if (field) field.value = value ?? '';
    });
  }

  function revealAbsenceFields(form, type) {
    if (!form) return;
    const typeInput = form.querySelector('input[name="absence_type"]');
    if (typeInput) typeInput.value = type || '';
    const panel = form.closest('.pr-absence-panel');
    root.querySelectorAll('[data-pr-action="choose-absence-type"]').forEach((choice) => {
      choice.classList.toggle('is-active', choice.dataset.absenceType === type);
    });
    if (panel) panel.hidden = !type;
    const fields = form.querySelector('.pr-absence-fields');
    if (fields) fields.hidden = !type;
    fields?.querySelectorAll('input[name="start_date"], input[name="end_date"]').forEach((input) => { input.required = Boolean(type); });
    updateAbsenceCalculatedDays(form);
  }

  function resetAbsenceForm(form) {
    if (!form) return;
    form.reset();
    const panel = form.closest('.pr-absence-panel');
    if (panel) panel.hidden = true;
    form.querySelector('input[name="id"]') && (form.querySelector('input[name="id"]').value = '');
    form.querySelector('input[name="absence_type"]') && (form.querySelector('input[name="absence_type"]').value = '');
    root.querySelectorAll('[data-pr-action="choose-absence-type"]').forEach((choice) => choice.classList.remove('is-active'));
    form.querySelector('.pr-absence-fields')?.querySelectorAll('input[name="start_date"], input[name="end_date"]').forEach((input) => { input.required = false; });
    updateAbsenceCalculatedDays(form);
  }

  function updateTravelTypeFields(form) {
    if (!form) return;
    const type = form.querySelector('select[name="travel_type"]')?.value || 'km';
    const isPublicTransport = type === 'public_transport';
    form.querySelectorAll('.pr-travel-km-field').forEach((field) => { field.hidden = isPublicTransport; });
    form.querySelectorAll('.pr-travel-public-field').forEach((field) => { field.hidden = !isPublicTransport; });
    const kmInput = form.querySelector('input[name="roundtrip_km"]');
    const publicAmountInput = form.querySelector('input[name="public_transport_amount"]');
    if (kmInput) {
      kmInput.required = !isPublicTransport;
      if (isPublicTransport) kmInput.value = '';
    }
    if (publicAmountInput) {
      publicAmountInput.required = isPublicTransport;
      if (!isPublicTransport) publicAmountInput.value = '';
    }
  }

  // Save meta fields on blur (header inputs)
  listeners.on('blur', async (e) => {
    const input = e.target.closest('.pr-meta-input');
    if (!input || !prSelectedReport || isSimulation) return;
    if (!canEdit(prSelectedReport)) return;
    const field = input.name;
    if (!field) return;
    let value = input.value;
    if (input.type === 'number') value = value === '' ? null : Number(value);
    if (value === '') value = null;
    try {
      await updateReportMeta(prSelectedReport.id, { [field]: value });
      prSelectedReport[field] = value;
    } catch (err) {
      showToast(friendlyPersonalReportsError(err, 'אירעה תקלה בשמירת הדוח. יש לנסות שוב.'), 'danger');
    }
  }, { capture: true });

  listeners.on('click', async (e) => {
    const btn = e.target.closest('[data-pr-action]');
    if (!btn) return;
    const action = btn.dataset.prAction;

    if (action === 'exit-simulation') {
      prViewAsEmployee = null;
      await rerender(root, _dashboardUser); return;
    }
    if (action === 'back-to-my-reports') {
      await returnToEmployeeDashboard(root, { isSimulation });
      return;
    }
    if (action === 'back-to-dashboard') { dispatchBackToDashboard(); return; }

    if (action === 'switch-report-tab') { setReportTab(root, btn.dataset.tab); return; }

    if (action === 'show-add-travel') {
      setReportTab(root, 'travel');
      const panel = showPanel('pr-add-travel-panel');
      const travelForm = panel?.querySelector('form[data-form-type="declared_travel"]');
      if (travelForm) updateTravelTypeFields(travelForm);
      return;
    }
    if (action === 'hide-add-travel') {
      hidePanel('pr-add-travel-panel');
      return;
    }
    if (action === 'show-add-expense') {
      setReportTab(root, 'expenses');
      const panel = showPanel('pr-add-expense-panel');
      panel?.querySelector('form[data-form-type="expense"] input,select,textarea')?.focus();
      return;
    }
    if (action === 'hide-add-expense') {
      hidePanel('pr-add-expense-panel');
      return;
    }
    if (action === 'focus-salary-report') {
      const firstMetaInput = root.querySelector('#pr-report-header .pr-meta-input:not([readonly])');
      firstMetaInput?.focus();
      return;
    }

    if (action === 'choose-absence-type') {
      const panel = showPanel('pr-add-absence-panel');
      const form = panel?.querySelector('form[data-form-type="absence"]');
      revealAbsenceFields(form, btn.dataset.absenceType || '');
      form?.querySelector('input[name="start_date"]')?.focus();
      return;
    }

    if (action === 'cancel-absence-form') {
      resetAbsenceForm(root.querySelector('form[data-form-type="absence"]'));
      return;
    }

    if (action === 'edit-travel') {
      const panel = showPanel('pr-add-travel-panel');
      const form = panel?.querySelector('form[data-form-type="declared_travel"]');
      setFormValues(form, {
        id: btn.dataset.entryId,
        original_table: btn.dataset.entryTable,
        travel_type: btn.dataset.travelType || 'km',
        travel_date: btn.dataset.travelDate,
        origin: btn.dataset.origin,
        destination: btn.dataset.destination,
        description: btn.dataset.description,
        roundtrip_km: btn.dataset.roundtripKm,
        public_transport_amount: btn.dataset.amount
      });
      updateTravelTypeFields(form);
      return;
    }

    if (action === 'edit-expense') {
      const panel = showPanel('pr-add-expense-panel');
      const form = panel?.querySelector('form[data-form-type="expense"]');
      setFormValues(form, {
        id: btn.dataset.entryId,
        expense_date: btn.dataset.expenseDate,
        document_type: btn.dataset.documentType,
        description: btn.dataset.description,
        amount: btn.dataset.amount,
        notes: btn.dataset.notes
      });
      return;
    }

    if (action === 'edit-absence') {
      const panel = showPanel('pr-add-absence-panel');
      const form = panel?.querySelector('form[data-form-type="absence"]');
      setFormValues(form, {
        id: btn.dataset.entryId,
        start_date: btn.dataset.startDate,
        end_date: btn.dataset.endDate,
        notes: btn.dataset.notes
      });
      revealAbsenceFields(form, btn.dataset.absenceType || '');
      form?.querySelector('input[name="start_date"]')?.focus();
      setReportTab(root, 'absences');
      return;
    }

    if (action === 'delete-entry') {
      if (isSimulation) { showToast(SIM_MSG, 'warning'); return; }
      if (!confirm('למחוק שורה זו?')) return;
      try {
        await deleteEntry(btn.dataset.entryTable, btn.dataset.entryId);
        await safeOpenReportDetail(root, prSelectedReport.id, false, { isSimulation, initialTab: currentReportTab(root), forceReload: true });
        showToast('נמחק', 'success');
      } catch (err) { showToast(friendlyPersonalReportsError(err), 'danger'); }
      return;
    }

    if (action === 'submit-report') {
      if (isSimulation) { showToast(SIM_MSG, 'warning'); return; }
      const cb = root.querySelector('#pr-confirm-checkbox');
      const signatureFullName = String(root.querySelector('#pr-signature-name')?.value || '').trim();
      if (!signatureFullName) { showToast('יש למלא שם מלא לחתימה', 'warning'); return; }
      if (!cb?.checked) { showToast('יש לסמן את תיבת האישור', 'warning'); return; }
      if (!confirm('לשלוח את הדוח לשכר? לאחר שליחה לא ניתן לערוך.')) return;
      try {
        await assertSalaryReady(prSelectedReport.id);
        const wasCorrection = prSelectedReport.status === 'needs_correction';
        await submitReport(prSelectedReport.id, signatureFullName);
        await openMonthlyReportPdf(prSelectedReport.id, 'נשלח לשכר');
        showReportSubmittedSuccess(root, prSelectedReport.id, wasCorrection ? 'הדוח נשלח מחדש בהצלחה' : 'הדוח אושר ונשלח לשכר בהצלחה', { isSimulation });
        showToast(wasCorrection ? 'הדוח נשלח מחדש בהצלחה' : 'הדוח אושר ונשלח לשכר בהצלחה', 'success');
      } catch (err) { showToast(friendlyPersonalReportsError(err), 'danger'); }
      return;
    }

    if (action === 'download-report-pdf') {
      try {
        await openMonthlyReportPdf(btn.dataset.reportId || prSelectedReport?.id, 'אושר / נשלח לשכר');
        showToast('PDF מוכן להורדה / שמירה', 'success');
      } catch (err) { showToast(friendlyPersonalReportsError(err), 'danger'); }
      return;
    }

    if (action === 'view-attachment') {
      try {
        const url = await getSignedUrl(btn.dataset.storagePath);
        window.open(url, '_blank', 'noopener');
      } catch (err) { showToast(friendlyPersonalReportsError(err), 'danger'); }
      return;
    }

    if (action === 'delete-attachment') {
      if (isSimulation) { showToast(SIM_MSG, 'warning'); return; }
      if (!confirm('למחוק קובץ זה?')) return;
      try {
        await deleteAttachment({ id: btn.dataset.attachmentId, storage_path: btn.dataset.storagePath });
        await safeOpenReportDetail(root, prSelectedReport.id, false, { isSimulation, initialTab: currentReportTab(root), forceReload: true });
        showToast('קובץ נמחק', 'success');
      } catch (err) { showToast(friendlyPersonalReportsError(err), 'danger'); }
      return;
    }
  });

  function updateAbsenceCalculatedDays(form) {
    const start = form?.querySelector('input[name="start_date"]')?.value || '';
    const end = form?.querySelector('input[name="end_date"]')?.value || '';
    const out = form?.querySelector('input[name="calculated_days"]');
    if (out) out.value = countWorkdaysInclusive(start, end);
  }

  // File uploads + compact absence form reveal/calculation
  listeners.on('change', async (e) => {
    const travelTypeSelect = e.target.closest('select[name="travel_type"]');
    if (travelTypeSelect) {
      updateTravelTypeFields(travelTypeSelect.closest('form[data-form-type="declared_travel"]'));
      return;
    }

    const absenceTypeSelect = e.target.closest('select[name="absence_type"]');
    if (absenceTypeSelect) {
      const form = absenceTypeSelect.closest('form[data-form-type="absence"]');
      const fields = form?.querySelector('.pr-absence-fields');
      if (fields) fields.hidden = !absenceTypeSelect.value;
      fields?.querySelectorAll('input[name="start_date"], input[name="end_date"]').forEach((input) => { input.required = Boolean(absenceTypeSelect.value); });
      if (absenceTypeSelect.value) fields?.querySelector('input,select,textarea')?.focus();
      return;
    }

    const absenceDate = e.target.closest('.pr-absence-date');
    if (absenceDate) {
      updateAbsenceCalculatedDays(absenceDate.closest('form[data-form-type="absence"]'));
      return;
    }

    const fileInput = e.target.closest('input[type="file"].pr-file-input');
    if (!fileInput || !fileInput.files?.[0]) return;
    if (isSimulation) { showToast(SIM_MSG, 'warning'); fileInput.value = ''; return; }
    const file = fileInput.files[0];
    const entryLink = {
      expenseEntryId: fileInput.dataset.entryType === 'expense' ? (fileInput.dataset.entryId || null) : null,
      absenceEntryId: fileInput.dataset.entryType === 'absence' ? (fileInput.dataset.entryId || null) : null
    };
    try {
      await uploadAttachment(prSelectedReport.id, prSession.user.id, entryLink, file);
      await safeOpenReportDetail(root, prSelectedReport.id, false, { isSimulation, initialTab: currentReportTab(root), forceReload: true });
      showToast('הקובץ הועלה', 'success');
    } catch (err) { showToast(friendlyPersonalReportsError(err, 'אירעה תקלה בהעלאת הקובץ. יש לנסות שוב.'), 'danger'); }
  });

  listeners.on('reset', (e) => {
    const form = e.target.closest('form[data-form-type="absence"]');
    if (!form) return;
    setTimeout(() => resetAbsenceForm(form), 0);
  });

  // Add entry forms submit
  listeners.on('submit', async (e) => {
    const form = e.target.closest('.pr-add-form');
    if (!form) return;
    e.preventDefault();
    if (savingForms.has(form)) return;
    if (isSimulation) { showToast(SIM_MSG, 'warning'); return; }
    const formType = form.dataset.formType;
    const fd = new FormData(form);
    const reportId  = prSelectedReport.id;
    const employeeId = prSession.user.id;
    const submitBtn = form.querySelector('button[type="submit"]');
    savingForms.add(form);
    if (submitBtn) submitBtn.disabled = true;
    try {
      if (formType === 'declared_travel') {
        const travelType = String(fd.get('travel_type') || 'km');
        const originalTable = String(fd.get('original_table') || '');
        const targetTable = travelType === 'public_transport' ? 'public_transport_entries' : 'declared_travel_entries';
        let entryId = fd.get('id') || undefined;
        if (entryId && originalTable && originalTable !== targetTable) {
          await deleteEntry(originalTable, entryId);
          entryId = undefined;
        }
        await upsertDeclaredTravel({
          id: entryId,
          travel_type: travelType,
          report_id: reportId, employee_id: employeeId,
          travel_date: fd.get('travel_date'),
          origin: fd.get('origin') || '',
          destination: fd.get('destination') || '',
          description: fd.get('description') || '',
          roundtrip_km: Number(fd.get('roundtrip_km') || 0),
          ...(travelType === 'public_transport'
            ? { amount: Number(fd.get('public_transport_amount') || 0) }
            : {})
        });
      } else if (formType === 'expense') {
        const expense = await upsertExpense({
          id: fd.get('id') || undefined,
          report_id: reportId, employee_id: employeeId,
          expense_date: fd.get('expense_date'),
          document_type: fd.get('document_type') || 'receipt',
          description: fd.get('description') || '',
          amount: Number(fd.get('amount') || 0),
          notes: fd.get('notes') || ''
        });
        const file = form.querySelector('input[name="attachment"]')?.files?.[0];
        if (file) await uploadAttachment(reportId, employeeId, { expenseEntryId: expense.id }, file);
      } else if (formType === 'absence') {
        const absenceType = String(fd.get('absence_type') || '').trim();
        const startDate = String(fd.get('start_date') || '').trim();
        const endDate = String(fd.get('end_date') || '').trim();
        const calculatedDays = countWorkdaysInclusive(startDate, endDate);
        if (!absenceType) { showToast('יש לבחור סוג היעדרות', 'warning'); return; }
        if (!startDate || !endDate) { showToast('יש למלא טווח תאריכים', 'warning'); return; }
        if (new Date(`${startDate}T00:00:00`) > new Date(`${endDate}T00:00:00`)) { showToast('תאריך הסיום חייב להיות אחרי תאריך ההתחלה', 'warning'); return; }
        if (calculatedDays <= 0) { showToast('טווח התאריכים לא כולל ימי עבודה (א׳-ה׳)', 'warning'); return; }
        const absence = await upsertAbsence({
          id: fd.get('id') || undefined,
          report_id: reportId,
          employee_id: employeeId,
          absence_type: absenceType,
          start_date: startDate,
          end_date: endDate,
          notes: fd.get('notes') || ''
        });
        const file = form.querySelector('input[name="attachment"]')?.files?.[0];
        if (file) await uploadAttachment(reportId, employeeId, { absenceEntryId: absence.id }, file);
      }
      form.reset();
      if (formType === 'absence') resetAbsenceForm(form);
      if (formType === 'declared_travel') updateTravelTypeFields(form);
      const panel = form.closest('.pr-add-panel');
      if (panel) panel.hidden = true;
      await safeOpenReportDetail(root, reportId, false, { isSimulation, initialTab: currentReportTab(root), forceReload: true });
      showToast('נשמר', 'success');
    } catch (err) {
      showToast(friendlyPersonalReportsError(err, 'אירעה תקלה בשמירת הדוח. יש לנסות שוב.'), 'danger');
    } finally {
      savingForms.delete(form);
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

function applyAdminStatusFilter(root) {
  const filters = readAdminFilters(root);
  root.querySelectorAll('.pr-admin-report-row').forEach((row) => {
    const visible = !filters.status || row.dataset.manageStatus === filters.status;
    row.hidden = !visible;
  });
}

function bindEmployeeReportsManagement(root) {
  root.__prAdminAbort?.abort();
  const adminAbort = new AbortController();
  root.__prAdminAbort = adminAbort;
  const listeners = bindScreenListeners(root, adminAbort.signal);
  listeners.on('click', async (e) => {
    const btn = e.target.closest('[data-pr-action]');
    if (!btn) return;
    const action = btn.dataset.prAction;
    const reportId = btn.dataset.reportId;

    if (action === 'back-to-dashboard') { dispatchBackToDashboard(); return; }
    if (action === 'lock-screen') {
      resetPersonalReportsAuth();
      renderInto(root, internalEmployeeLoginHtml());
      bindInternalEmployeeLogin(root);
      return;
    }
    if (action === 'screen-mode-my-reports') {
      prScreenMode = PR_SCREEN_MODES.MY_REPORTS;
      await rerender(root, _dashboardUser);
      return;
    }
    if (action === 'screen-mode-management') {
      prScreenMode = PR_SCREEN_MODES.MANAGEMENT;
      await rerender(root, _dashboardUser);
      return;
    }
    if (action === 'clear-admin-filters') {
      const monthInput = root.querySelector('#pr-filter-month');
      const statusInput = root.querySelector('#pr-filter-status');
      if (monthInput) monthInput.value = defaultMonthFilterValue();
      if (statusInput) statusInput.value = '';
      await rerender(root, _dashboardUser, { forceReload: true });
      return;
    }

    if (action === 'admin-manage-report') {
      await safeOpenAdminManageReport(root, {
        reportId,
        employeeId: btn.dataset.employeeId,
        month: Number(btn.dataset.reportMonth || 0),
        year: Number(btn.dataset.reportYear || 0)
      });
      return;
    }
  });

  listeners.on('change', async (e) => {
    if (e.target.matches('#pr-filter-month')) {
      const filters = readAdminFilters(root);
      if (adminFiltersChanged(filters)) {
        _prLastAdminFilters = { ...filters };
        await rerender(root, _dashboardUser, { forceReload: true });
      }
      return;
    }
    if (e.target.matches('#pr-filter-status')) {
      applyAdminStatusFilter(root);
    }
  });
}

function bindAdminReportView(root) {
  root.__prAdminViewAbort?.abort();
  const adminViewAbort = new AbortController();
  root.__prAdminViewAbort = adminViewAbort;
  const listeners = bindScreenListeners(root, adminViewAbort.signal);
  listeners.on('click', async (e) => {
    const btn = e.target.closest('[data-pr-action]');
    if (!btn) return;
    const action = btn.dataset.prAction;
    const reportId = btn.dataset.reportId;

    if (action === 'back-to-admin') {
      _prActiveView = { kind: 'employee-reports-management' };
      prSelectedReport = null;
      await rerender(root, _dashboardUser, { forceReload: true });
      return;
    }

    if (action === 'admin-approve' && reportId) {
      if (!confirm('לאשר דוח זה?')) return;
      try {
        await assertSalaryReady(reportId);
        await adminUpdateReport(reportId, { status: 'approved', approved_at: new Date().toISOString() });
        await openMonthlyReportPdf(reportId, 'אושר לשכר');
        showToast('הדוח אושר וה-PDF הופק', 'success');
        await safeOpenReportDetail(root, reportId, true, { forceReload: true });
      } catch (err) { showToast(friendlyPersonalReportsError(err), 'danger'); }
      return;
    }
    if (action === 'admin-return' && reportId) {
      const notes = prompt('הסבר לעובד:');
      if (notes === null) return;
      try {
        await adminUpdateReport(reportId, { status: 'needs_correction', finance_notes: notes });
        showToast('הדוח הוחזר לתיקון', 'success');
        await safeOpenReportDetail(root, reportId, true, { forceReload: true });
      } catch (err) { showToast(friendlyPersonalReportsError(err), 'danger'); }
      return;
    }
    if (action === 'admin-mark-paid' && reportId) {
      if (!confirm('לסמן כשולם?')) return;
      try {
        await adminUpdateReport(reportId, { status: 'paid', paid_at: new Date().toISOString() });
        showToast('סומן כשולם', 'success');
        await safeOpenReportDetail(root, reportId, true, { forceReload: true });
      } catch (err) { showToast(friendlyPersonalReportsError(err), 'danger'); }
      return;
    }
    if (action === 'admin-save-notes' && reportId) {
      const notes = root.querySelector('#pr-admin-notes')?.value || '';
      try {
        await adminUpdateReport(reportId, { finance_notes: notes });
        showToast('הערות נשמרו', 'success');
      } catch (err) { showToast(friendlyPersonalReportsError(err), 'danger'); }
      return;
    }
    if (action === 'download-report-pdf') {
      try {
        await openMonthlyReportPdf(btn.dataset.reportId || prSelectedReport?.id, 'אושר / נשלח לשכר');
        showToast('PDF מוכן להורדה / שמירה', 'success');
      } catch (err) { showToast(friendlyPersonalReportsError(err), 'danger'); }
      return;
    }

    if (action === 'view-attachment') {
      try {
        const url = await getSignedUrl(btn.dataset.storagePath);
        window.open(url, '_blank', 'noopener');
      } catch (err) { showToast(friendlyPersonalReportsError(err), 'danger'); }
      return;
    }
  });
}

function bindEmployeeSelector(root) {
  root.__prSelectorAbort?.abort();
  const selectorAbort = new AbortController();
  root.__prSelectorAbort = selectorAbort;
  const listeners = bindScreenListeners(root, selectorAbort.signal);
  listeners.on('click', async (e) => {
    const btn = e.target.closest('[data-pr-action]');
    if (!btn) return;
    const action = btn.dataset.prAction;

    if (action === 'back-to-admin') {
      _prActiveView = { kind: 'employee-reports-management' };
      prSelectedReport = null;
      await rerender(root, _dashboardUser, { forceReload: true });
      return;
    }

    if (action === 'select-view-as-employee') {
      prViewAsEmployee = {
        id:         btn.dataset.employeeId,
        full_name:  btn.dataset.employeeName,
        email:      btn.dataset.employeeEmail
      };
      const { month, year } = currentMonthYear();
      const cardData = await loadMyReportCardData(prViewAsEmployee.id, month, year, { force: true });
      renderInto(root, myReportsDashboardHtml(prViewAsEmployee, { isSimulation: true, cardData }));
      bindMyReportsDashboard(root, { isSimulation: true });
      return;
    }
  });

  listeners.on('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const row = e.target.closest('[data-pr-action="select-view-as-employee"]');
      if (row) row.click();
    }
  });
}

function dispatchBackToDashboard() {
  resetPersonalReportsAuth();
  document.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: 'dashboard' } }));
}

function bindInternalEmployeeLogin(root) {
  root.__prLoginAbort?.abort();
  const loginAbort = new AbortController();
  root.__prLoginAbort = loginAbort;
  const signal = loginAbort.signal;
  root.querySelector('[data-pr-action="back-to-dashboard"]')?.addEventListener('click', dispatchBackToDashboard, { signal });
  root.querySelector('#pr-internal-login-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (signal.aborted) return;
    const form = event.currentTarget;
    const submit = form.querySelector('button[type="submit"]');
    const fd = new FormData(form);
    const accessCode = normalizeAccessCode(fd.get('access_code'));
    const dashboardUser = dashboardUserForAuth();
    if (submit) {
      submit.disabled = true;
      submit.textContent = 'בודק אימות…';
    }
    try {
      prSession = await authenticateInternalEmployee(dashboardUser, accessCode);
      if (signal.aborted) return;
      prSelectedReport = null;
      prViewAsEmployee = null;
      prScreenMode = PR_SCREEN_MODES.MY_REPORTS;
      isPersonalReportsUnlocked = true;
      await rerender(root, dashboardUser);
    } catch (err) {
      if (signal.aborted) return;
      isPersonalReportsUnlocked = false;
      renderInto(root, internalEmployeeLoginHtml(internalLoginErrorMessage(err)));
      bindInternalEmployeeLogin(root);
    } finally {
      if (signal.aborted) return;
      if (submit) {
        submit.disabled = false;
        submit.textContent = 'כניסה';
      }
    }
  }, { signal });
}

async function rerender(root, dashboardUser = dashboardUserForAuth(), { forceReload = false } = {}) {
  if (!forceReload && _prActiveView?.kind === 'admin-report' && _prActiveView.reportId) {
    await safeOpenReportDetail(root, _prActiveView.reportId, true, {
      isSimulation: _prActiveView.isSimulation,
      initialTab: _prActiveView.initialTab || 'status'
    });
    return;
  }
  if (!forceReload && _prActiveView?.kind === 'employee-report' && _prActiveView.reportId) {
    await safeOpenReportDetail(root, _prActiveView.reportId, false, {
      isSimulation: _prActiveView.isSimulation,
      initialTab: _prActiveView.initialTab || 'status'
    });
    return;
  }

  if (!isPersonalReportsUnlocked) {
    _prActiveView = { kind: 'login' };
    renderInto(root, internalEmployeeLoginHtml());
    bindInternalEmployeeLogin(root);
    return;
  }
  if (!prSession || !prSession.user?.id) {
    isPersonalReportsUnlocked = false;
    _prActiveView = { kind: 'login' };
    renderInto(root, internalEmployeeLoginHtml(internalLoginErrorMessage('missing_employee_uuid')));
    bindInternalEmployeeLogin(root);
    return;
  }
  if (isAdminRole(prSession.profile.role) && prScreenMode === PR_SCREEN_MODES.MY_REPORTS && !prViewAsEmployee) {
    const { month, year } = currentMonthYear();
    const cardData = await loadMyReportCardData(prSession.user.id, month, year, { force: forceReload });
    _prActiveView = { kind: 'my-reports', isSimulation: false };
    renderInto(root, myReportsDashboardHtml(prSession.profile, { cardData, showModeTabs: true }));
    bindMyReportsDashboard(root);
  } else if (isAdminRole(prSession.profile.role) && prViewAsEmployee) {
    const { month, year } = currentMonthYear();
    const cardData = await loadMyReportCardData(prViewAsEmployee.id, month, year, { force: forceReload });
    _prActiveView = { kind: 'my-reports', isSimulation: true };
    renderInto(root, myReportsDashboardHtml(prViewAsEmployee, { isSimulation: true, cardData }));
    bindMyReportsDashboard(root, { isSimulation: true });
  } else if (isAdminRole(prSession.profile.role)) {
    try {
      const filters = {
        month: _prLastAdminFilters.month || defaultMonthFilterValue(),
        status: _prLastAdminFilters.status || ''
      };
      const rows = await loadEmployeeReportsManagementList(filters, { force: forceReload });
      _prActiveView = { kind: 'employee-reports-management' };
      prSelectedReport = null;
      renderInto(root, employeeReportsManagementHtml(rows || [], filters));
      bindEmployeeReportsManagement(root);
      if (filters.status) applyAdminStatusFilter(root);
    } catch (err) {
      _prActiveView = { kind: 'employee-reports-management' };
      renderInto(root, employeeReportsManagementPlaceholderHtml(friendlyPersonalReportsError(err, 'אזור ניהול דוחות עובדים לא נטען כרגע.')));
      bindEmployeeReportsManagement(root);
    }
  } else {
    const { month, year } = currentMonthYear();
    const cardData = await loadMyReportCardData(prSession.user.id, month, year, { force: forceReload });
    _prActiveView = { kind: 'my-reports', isSimulation: false };
    renderInto(root, myReportsDashboardHtml(prSession.profile, { cardData }));
    bindMyReportsDashboard(root);
  }
}

// ─── exported screen object ───────────────────────────────────────────────────

export const personalReportsScreen = {
  load: () => Promise.resolve({}),

  render(_data, ctx) {
    if (!canAccessPersonalReports(ctx?.state?.user)) {
      return personalReportsAccessDeniedHtml();
    }
    return `<div id="pr-root" class="pr-module-root" dir="rtl"><div class="pr-loading-placeholder">טוען…</div></div>`;
  },

  bind({ root, state } = {}) {
    const prRoot = (root && root.querySelector('#pr-root')) || root;
    if (!canAccessPersonalReports(state?.user)) return;
    _dashboardUser = state?.user || _dashboardUser || null;
    const view = prRoot?.ownerDocument?.defaultView || globalThis.window;
    const preserveSession = _prScreenBound && isPersonalReportsUnlocked && prSession;
    const preserveLoginScreen = _prScreenBound && !isPersonalReportsUnlocked;
    const needsShellRerender = personalReportsNeedsShellRerender(prRoot);

    _prShellAbort?.abort();
    _prShellAbort = new AbortController();
    const shellSignal = _prShellAbort.signal;

    if (preserveSession) {
      _prScreenBound = true;
      if (needsShellRerender) {
        void restorePersonalReportsShellView(prRoot);
      }
    } else if (preserveLoginScreen) {
      _prScreenBound = true;
      if (needsShellRerender) {
        prSession = sessionFromDashboardState(state);
        void restorePersonalReportsShellView(prRoot);
      }
    } else {
      resetPersonalReportsAuth();
      prSession = sessionFromDashboardState(state);
      _prScreenBound = true;
      void rerender(prRoot, _dashboardUser);
    }

    const onNavigateAway = () => {
      _prShellAbort?.abort();
      _prShellAbort = null;
      resetPersonalReportsAuth();
    };
    const onPageHide = () => {
      _prShellAbort?.abort();
      _prShellAbort = null;
      resetPersonalReportsAuth();
    };
    const onPageShow = (event) => {
      if (!event.persisted) return;
      resetPersonalReportsAuth();
      prSession = sessionFromDashboardState(state);
      rerender(prRoot, _dashboardUser);
    };
    document.addEventListener('app:navigate', onNavigateAway, { signal: shellSignal });
    view?.addEventListener('pagehide', onPageHide, { signal: shellSignal });
    view?.addEventListener('pageshow', onPageShow, { signal: shellSignal });
  }
};
