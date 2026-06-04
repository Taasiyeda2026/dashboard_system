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
import { dsPageHeader, dsEmptyState, dsStatusChip } from './shared/layout.js';

// ─── constants ────────────────────────────────────────────────────────────────

const MONTHS_HE = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

const STATUS_LABELS = {
  draft:            'טיוטה',
  submitted:        'נשלח',
  reviewed:         'נבדק',
  approved:         'אושר',
  needs_correction: 'הוחזר לתיקון',
  paid:             'שולם'
};

const STATUS_KIND = {
  draft:            'neutral',
  submitted:        'warning',
  reviewed:         'neutral',
  approved:         'success',
  needs_correction: 'danger',
  paid:             'success'
};

// ─── module state ─────────────────────────────────────────────────────────────

let prSession        = null;
let prSelectedReport = null;
let prViewAsEmployee = null;
let prAdminMode      = 'my';
let isPersonalReportsUnlocked = false;

// ─── helpers ──────────────────────────────────────────────────────────────────

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

function friendlyPersonalReportsError(error, fallback = 'אירעה תקלה בטעינת הדוחות. יש לנסות שוב או לפנות למנהל המערכת.') {
  const raw = String(error?.message || error?.code || error || '').trim();
  if (/invalid input syntax for type uuid|uuid/i.test(raw)) {
    return 'פרטי ההתחברות אינם תקינים. יש לבדוק את קוד העובד ולנסות שוב.';
  }
  if (/invalid_credentials|entry_code_mismatch|user_not_found|not_found|missing/i.test(raw)) {
    return 'פרטי ההתחברות אינם תקינים. יש לבדוק את קוד העובד ולנסות שוב.';
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

function dashboardUserEmail(user) {
  // Returns the email of the currently logged-in dashboard user.
  // We accept only a real email (contains @) — internal IDs (user_id, emp_id)
  // must NOT be used as a lookup key for the second-factor verification.
  const raw = String(user?.email || user?.work_email || '').trim();
  return raw.includes('@') ? raw.toLowerCase() : '';
}

function resetPersonalReportsAuth() {
  prSession        = null;
  prSelectedReport = null;
  prViewAsEmployee = null;
  prAdminMode      = 'my';
  isPersonalReportsUnlocked = false;
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
        border: 1px solid #e2e8f0;
        border-radius: 18px;
        box-shadow: 0 2px 8px rgba(15,23,42,0.06), 0 12px 32px rgba(15,23,42,0.10);
        padding: 40px 36px 36px;
        box-sizing: border-box;
        text-align: right;
      }
      .pr-lock-icon-wrap {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 52px;
        height: 52px;
        background: #eff6ff;
        border-radius: 14px;
        margin: 0 auto 22px;
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
        margin: 0 0 24px;
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
        width: 60%;
        min-width: 160px;
        max-width: 220px;
        margin: 0 auto;
      }
      .pr-lock-field {
        display: flex;
        flex-direction: column;
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
        width: 100%;
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
        width: 100%;
        padding: 10px 16px;
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
        .pr-lock-card { padding: 28px 20px 24px; border-radius: 14px; }
        .pr-lock-wrap { padding: 20px 12px; align-items: flex-start; padding-top: 40px; }
        .pr-lock-form-inner { width: 80%; max-width: 240px; }
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
        <p class="pr-lock-subtitle">נדרש אימות נוסף כדי להיכנס לאזור זה</p>
        ${message ? `<div class="pr-lock-error" role="alert">${escapeHtml(message)}</div>` : ''}
        <form id="pr-internal-login-form" autocomplete="off">
          <div class="pr-lock-form-inner">
            <div class="pr-lock-field">
              <label class="pr-lock-label" for="pr-internal-access-code">קוד התחברות</label>
              <input class="pr-lock-input" id="pr-internal-access-code" name="access_code" type="password" autocomplete="off" placeholder="••••" required />
            </div>
            <button class="pr-lock-btn" type="submit">כניסה לדוחות</button>
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
  // Step 1: resolve the email of the already-authenticated user.
  // We refuse to fall back to internal IDs — only a real email is accepted.
  const userEmail = dashboardUserEmail(dashboardUser);
  const enteredCode = String(accessCode || '').trim();
  if (!userEmail || !enteredCode) {
    throw new Error('invalid_credentials');
  }

  // Step 2: verify the entered code against that specific user's record.
  // The RPC looks up by email only and compares entry_code — it never
  // treats the code as a user_id, emp_id, or UUID.
  const { data, error } = await supabase.rpc('verify_personal_reports_entry_code', {
    p_email: userEmail,
    p_entry_code: enteredCode
  });
  if (error) {
    console.error('[personal-reports] RPC verify_personal_reports_entry_code error:', error.message);
    throw new Error('invalid_credentials');
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || row.verify_status !== 'ok') {
    throw new Error(row?.verify_status || 'invalid_credentials');
  }

  // Step 3: confirm the email returned by the DB matches the logged-in user.
  // This guards against any unexpected row mismatch.
  const returnedEmail = String(row.email || '').trim().toLowerCase();
  if (!returnedEmail || returnedEmail !== userEmail) {
    console.error('[personal-reports] email mismatch after verify RPC');
    throw new Error('invalid_credentials');
  }

  // Step 4: the UUID for report queries comes exclusively from the
  // already-authenticated dashboard session — never from the code.
  const authUserId = String(
    dashboardUser?.auth_user_id ||
    dashboardUser?.personal_reports_user_id ||
    ''
  ).trim();
  if (!isUuid(authUserId)) {
    throw new Error('missing_employee_uuid');
  }

  const profile = {
    id: authUserId,
    email: returnedEmail,
    full_name: String(row.name || returnedEmail).trim(),
    role: isAdminRole(row.role) ? 'admin' : 'employee',
    display_role: String(row.role || '').trim(),
    emp_id: String(row.emp_id || '').trim()
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

async function createReport(employeeId, month, year) {
  assertEmployeeUuid(employeeId);
  const { data, error } = await supabase
    .from('personal_reports')
    .insert({
      employee_id: employeeId,
      report_month: month,
      report_year: year,
      status: 'draft',
      work_days_in_month: daysInMonth(month, year)
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function fetchReport(reportId) {
  const { data, error } = await supabase.from('personal_reports').select('*').eq('id', reportId).single();
  if (error) throw error;
  return data;
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
  const { data, error } = await supabase
    .from('declared_travel_entries').select('*').eq('report_id', reportId).order('travel_date');
  if (error) throw error;
  return data || [];
}

async function fetchPublicTransport(reportId) {
  const { data, error } = await supabase
    .from('public_transport_entries').select('*').eq('report_id', reportId).order('travel_date');
  if (error) throw error;
  return data || [];
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

async function upsertDeclaredTravel(entry) {
  if (entry.id) {
    const { error } = await supabase.from('declared_travel_entries').update(entry).eq('id', entry.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('declared_travel_entries').insert(entry);
    if (error) throw error;
  }
}

async function upsertPublicTransport(entry) {
  if (entry.id) {
    const { error } = await supabase.from('public_transport_entries').update(entry).eq('id', entry.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('public_transport_entries').insert(entry);
    if (error) throw error;
  }
}

async function upsertExpense(entry) {
  if (entry.id) {
    const { error } = await supabase.from('expense_entries').update(entry).eq('id', entry.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('expense_entries').insert(entry);
    if (error) throw error;
  }
}

async function deleteEntry(table, id) {
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) throw error;
}

async function uploadAttachment(reportId, employeeId, expenseEntryId, file) {
  const ext = file.name.split('.').pop();
  const path = `${employeeId}/${reportId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from('personal-report-attachments')
    .upload(path, file, { upsert: false });
  if (uploadError) throw uploadError;
  const { error: dbError } = await supabase.from('report_attachments').insert({
    report_id: reportId,
    employee_id: employeeId,
    expense_entry_id: expenseEntryId || null,
    storage_path: path,
    file_name: file.name,
    file_type: file.type,
    file_size: file.size
  });
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

async function fetchActiveEmployees() {
  const { data, error } = await supabase
    .from('profiles').select('id, full_name, email, role, is_active').order('full_name');
  if (error) throw error;
  return (data || []).filter(p => p.role !== 'admin' && p.is_active !== false);
}

async function fetchAllReports() {
  const { data, error } = await supabase
    .from('personal_reports')
    .select('*, profiles!personal_reports_employee_id_fkey(full_name, email)')
    .order('report_year', { ascending: false })
    .order('report_month', { ascending: false });
  if (error) throw error;
  return enrichReportsWithTotals(data || []);
}

async function enrichReportsWithTotals(reports) {
  const ids = reports.map((r) => r.id).filter(Boolean);
  if (!ids.length) return reports;
  const [travelRes, transportRes, expensesRes] = await Promise.all([
    supabase.from('declared_travel_entries').select('report_id, amount').in('report_id', ids),
    supabase.from('public_transport_entries').select('report_id, amount').in('report_id', ids),
    supabase.from('expense_entries').select('report_id, amount').in('report_id', ids)
  ]);
  if (travelRes.error) throw travelRes.error;
  if (transportRes.error) throw transportRes.error;
  if (expensesRes.error) throw expensesRes.error;

  const totals = new Map(ids.map((id) => [id, { travel: 0, expenses: 0 }]));
  for (const row of travelRes.data || []) totals.get(row.report_id).travel += Number(row.amount || 0);
  for (const row of transportRes.data || []) totals.get(row.report_id).travel += Number(row.amount || 0);
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

function employeeDashboardHtml(profile, { isSimulation = false } = {}) {
  const { month, year } = currentMonthYear();
  let monthOptions = '';
  for (let i = 0; i < 12; i++) {
    const m = month - i <= 0 ? month - i + 12 : month - i;
    const y = month - i <= 0 ? year - 1 : year;
    monthOptions += `<option value="${m}-${y}" ${i === 0 ? 'selected' : ''}>${monthLabel(m, y)}</option>`;
  }

  return `
    <div class="pr-screen" dir="rtl">
      ${isSimulation ? simulationBannerHtml(profile.full_name) : ''}
      <div class="pr-topbar">
        ${isSimulation
          ? `<button class="pr-btn pr-btn--ghost pr-back-btn" data-pr-action="exit-simulation">← חזרה למסך ניהול</button>`
          : `<button class="pr-btn pr-btn--ghost pr-back-btn" data-pr-action="back-to-dashboard">← חזרה לדשבורד</button>`}
        <span class="pr-topbar__title">דוחות אישיים</span>

      </div>
      <div class="pr-body">
        ${dsPageHeader('דוחות אישיים', 'הוצאות, נסיעות ודיווח שכר חודשי')}
        ${isAdminRole(profile.role) && !isSimulation ? `
          <div class="pr-admin-mode-switch" role="tablist" aria-label="מצבי אדמין">
            <button class="pr-report-tab is-active" data-pr-action="admin-mode-my" type="button">הדוחות שלי</button>
            <button class="pr-report-tab" data-pr-action="admin-mode-manage" type="button">ניהול דוחות עובדים</button>
          </div>
        ` : ''}

        <div class="pr-card pr-month-selector-card">
          <label class="pr-label" for="pr-month-select">בחר חודש דיווח</label>
          <div class="pr-month-row">
            <select class="pr-input pr-input--select" id="pr-month-select">${monthOptions}</select>
            <button class="pr-btn pr-btn--primary" id="pr-check-report-btn" data-pr-action="check-report">בדוק חודש</button>
          </div>
          <div class="pr-quick-tabs" role="tablist" aria-label="סוגי דוחות אישיים">
            <button class="pr-report-tab is-active" data-pr-action="open-month-tab" data-tab="expenses" type="button">הוצאות</button>
            <button class="pr-report-tab" data-pr-action="open-month-tab" data-tab="travel" type="button">נסיעות</button>
            <button class="pr-report-tab" data-pr-action="open-month-tab" data-tab="salary" type="button">דיווח שכר</button>
          </div>
          <p class="pr-helper-text">הכפתורים פותחים את אזורי הדוח בתוך אותו ממשק עבור החודש שנבחר.</p>
          <div id="pr-month-status" class="pr-month-status"></div>
        </div>

        <div id="pr-my-reports-list" class="pr-reports-list">
          <div class="pr-loading-placeholder">טוען דוחות…</div>
        </div>
      </div>
    </div>
  `;
}

function noReportStateHtml(month, year, isSimulation) {
  const label = monthLabel(month, year);
  if (isSimulation) {
    return `
      <div class="pr-no-report-state">
        <div class="pr-no-report-icon">📄</div>
        <p class="pr-no-report-msg">אין דוח עבור <strong>${escapeHtml(label)}</strong></p>
        <p class="pr-no-report-sub">בתצוגת סימולציה לא ניתן ליצור דוח בשם עובד.<br>יש לבקש מהעובד לפתוח את הדוח בעצמו.</p>
      </div>
    `;
  }
  return `
    <div class="pr-no-report-state">
      <div class="pr-no-report-icon">📄</div>
      <p class="pr-no-report-msg">אין דוח עבור <strong>${escapeHtml(label)}</strong></p>
      <button class="pr-btn pr-btn--primary pr-btn--large" data-pr-action="create-report"
        data-month="${month}" data-year="${year}">
        פתיחת דוח לחודש זה
      </button>
    </div>
  `;
}

function reportDetailHtml(report, travel, transport, expenses, attachments, profile, { isSimulation = false } = {}) {
  const editable = canEdit(report);
  const monthYearLabel = monthLabel(report.report_month, report.report_year);
  const statusChip = dsStatusChip(STATUS_LABELS[report.status] || report.status, STATUS_KIND[report.status] || 'neutral');

  const totalTravelKm  = travel.reduce((s, r) => s + Number(r.roundtrip_km || 0), 0);
  const totalTravel    = travel.reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalTransport = transport.reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalExpenses  = expenses.reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalAll       = totalTravel + totalTransport + totalExpenses;

  // ── Section 1: Report header ─────────────────────────────────────────────
  const hasLeaveColumns = 'vacation_days' in report;

  const leaveSection = hasLeaveColumns
    ? `
      <div class="pr-meta-grid">
        <div class="pr-meta-item">
          <label class="pr-meta-label" for="pr-meta-work-days">ימים בחודש</label>
          <input class="pr-meta-input" id="pr-meta-work-days" type="number" min="1" max="31"
            name="work_days_in_month" value="${report.work_days_in_month ?? ''}"
            ${editable ? '' : 'readonly'} placeholder="${daysInMonth(report.report_month, report.report_year)}" />
        </div>
        <div class="pr-meta-item">
          <label class="pr-meta-label" for="pr-meta-vacation">ימי חופשה</label>
          <input class="pr-meta-input" id="pr-meta-vacation" type="number" min="0" step="0.5"
            name="vacation_days" value="${report.vacation_days ?? 0}"
            ${editable ? '' : 'readonly'} />
        </div>
        <div class="pr-meta-item">
          <label class="pr-meta-label" for="pr-meta-sick">ימי מחלה</label>
          <input class="pr-meta-input" id="pr-meta-sick" type="number" min="0" step="0.5"
            name="sick_days" value="${report.sick_days ?? 0}"
            ${editable ? '' : 'readonly'} />
        </div>
        <div class="pr-meta-item">
          <label class="pr-meta-label" for="pr-meta-decl-day">יום הצהרה</label>
          <input class="pr-meta-input" id="pr-meta-decl-day" type="date"
            name="declaration_day" value="${report.declaration_day ?? ''}"
            ${editable ? '' : 'readonly'} />
        </div>
        <div class="pr-meta-item pr-meta-item--wide">
          <label class="pr-meta-label" for="pr-meta-notes">הערות</label>
          <input class="pr-meta-input" id="pr-meta-notes" type="text"
            name="report_notes" value="${escapeHtml(report.report_notes ?? '')}"
            ${editable ? '' : 'readonly'} placeholder="הערות כלליות לדוח…" />
        </div>
      </div>
    `
    : `
      <div class="pr-sql-notice" role="alert">
        <strong>⚠️ נדרש SQL</strong> — עמודות חופשה / מחלה / יום הצהרה לא קיימות ב-DB.<br>
        יש להריץ: <code>supabase/migrations/20260603b_personal_reports_add_leave_columns.sql</code>
      </div>
    `;

  const financeNotice = report.finance_notes
    ? `<div class="pr-finance-notes"><strong>💬 הערות כספים:</strong> ${escapeHtml(report.finance_notes)}</div>`
    : '';

  // ── Section 3: Declared travel table ────────────────────────────────────
  const travelRows = travel.length === 0
    ? `<tr><td colspan="8" class="pr-table-empty">אין רשומות</td></tr>`
    : travel.map(r => `
        <tr class="pr-data-row" data-id="${escapeHtml(r.id)}">
          <td class="pr-td-date">${fmtDate(r.travel_date)}</td>
          <td>${escapeHtml(r.origin)}</td>
          <td>${escapeHtml(r.destination)}</td>
          <td>${escapeHtml(r.description)}</td>
          <td class="pr-td-num">${fmtNum(r.roundtrip_km)}</td>
          <td class="pr-td-num pr-td-amount">${fmt(r.amount)}</td>
          <td class="pr-td-notes">
            ${editable ? `<label class="pr-attach-inline-btn" title="צרף אסמכתא">
              📎<input type="file" class="pr-file-input" accept="image/*,.pdf"
                data-entry-id="${escapeHtml(r.id)}" data-entry-type="travel" /></label>` : ''}
          </td>
          <td class="pr-td-actions">
            ${editable ? `<button class="pr-del-btn" data-pr-action="delete-entry"
              data-entry-id="${escapeHtml(r.id)}" data-entry-table="declared_travel_entries"
              aria-label="מחק שורה" title="מחק">✕</button>` : ''}
          </td>
        </tr>
      `).join('');

  const travelTotalRow = `
    <tr class="pr-total-row">
      <td colspan="4" class="pr-total-label">סה"כ החזר נסיעות</td>
      <td class="pr-td-num pr-total-num">${fmtNum(totalTravelKm)}</td>
      <td class="pr-td-num pr-total-num pr-total-amount">${fmt(totalTravel + totalTransport)}</td>
      <td colspan="2"></td>
    </tr>`;

  const addTravelForm = editable ? `
    <div class="pr-add-panel" id="pr-add-travel-panel" hidden>
      <form class="pr-add-form" id="pr-add-travel-form" data-form-type="declared_travel">
        <div class="pr-form-row">
          <div class="pr-field"><label class="pr-label">תאריך *</label>
            <input class="pr-input" type="date" name="travel_date" required /></div>
          <div class="pr-field"><label class="pr-label">ממקום *</label>
            <input class="pr-input" type="text" name="origin" required placeholder="מ..." /></div>
          <div class="pr-field"><label class="pr-label">למקום *</label>
            <input class="pr-input" type="text" name="destination" required placeholder="ל..." /></div>
          <div class="pr-field pr-field--wide"><label class="pr-label">פירוט</label>
            <input class="pr-input" type="text" name="description" placeholder="תיאור הנסיעה" /></div>
        </div>
        <div class="pr-form-row">
          <div class="pr-field"><label class="pr-label">ק"מ *</label>
            <input class="pr-input" type="number" name="roundtrip_km" min="0" step="0.1" required placeholder="0" /></div>
          <div class="pr-field"><label class="pr-label">סה"כ החזר</label>
            <input class="pr-input" type="number" name="amount" min="0" step="0.01" readonly placeholder="מחושב אוטומטית" /></div>
          <div class="pr-field pr-field--wide"><label class="pr-label">הערות</label>
            <input class="pr-input" type="text" name="notes" placeholder="הערות / קובץ נדרש" /></div>
        </div>
        <div class="pr-add-form-actions">
          <button class="pr-btn pr-btn--primary" type="submit">הוסף</button>
          <button class="pr-btn pr-btn--ghost" type="button" data-pr-action="toggle-add-travel">ביטול</button>
        </div>
      </form>
    </div>
    <button class="pr-btn pr-btn--add-row" data-pr-action="toggle-add-travel">+ הוסף שורת נסיעה</button>
  ` : '';

  // ── Section 4: Public transport table ───────────────────────────────────
  const transportRows = transport.length === 0
    ? `<tr><td colspan="8" class="pr-table-empty">אין רשומות</td></tr>`
    : transport.map(r => `
        <tr class="pr-data-row" data-id="${escapeHtml(r.id)}">
          <td class="pr-td-date">${fmtDate(r.travel_date)}</td>
          <td>${escapeHtml(r.origin)}</td>
          <td>${escapeHtml(r.destination)}</td>
          <td>${escapeHtml(r.description)}</td>
          <td class="pr-td-num pr-td-amount">${fmt(r.amount)}</td>
          <td class="pr-td-notes">
            ${editable ? `<label class="pr-attach-inline-btn" title="צרף קבלה">
              📎<input type="file" class="pr-file-input" accept="image/*,.pdf"
                data-entry-id="${escapeHtml(r.id)}" data-entry-type="transport" /></label>` : ''}
          </td>
          <td class="pr-td-notes">${escapeHtml(r.notes || '')}</td>
          <td class="pr-td-actions">
            ${editable ? `<button class="pr-del-btn" data-pr-action="delete-entry"
              data-entry-id="${escapeHtml(r.id)}" data-entry-table="public_transport_entries"
              aria-label="מחק שורה">✕</button>` : ''}
          </td>
        </tr>
      `).join('');

  const transportTotalRow = `
    <tr class="pr-total-row">
      <td colspan="4" class="pr-total-label">סה"כ</td>
      <td class="pr-td-num pr-total-num pr-total-amount">${fmt(totalTransport)}</td>
      <td colspan="3"></td>
    </tr>`;

  const addTransportForm = editable ? `
    <div class="pr-add-panel" id="pr-add-transport-panel" hidden>
      <form class="pr-add-form" id="pr-add-transport-form" data-form-type="public_transport">
        <div class="pr-form-row">
          <div class="pr-field"><label class="pr-label">תאריך *</label>
            <input class="pr-input" type="date" name="travel_date" required /></div>
          <div class="pr-field"><label class="pr-label">ממקום *</label>
            <input class="pr-input" type="text" name="origin" required placeholder="מ..." /></div>
          <div class="pr-field"><label class="pr-label">למקום *</label>
            <input class="pr-input" type="text" name="destination" required placeholder="ל..." /></div>
          <div class="pr-field pr-field--wide"><label class="pr-label">פירוט</label>
            <input class="pr-input" type="text" name="description" placeholder="תיאור" /></div>
        </div>
        <div class="pr-form-row">
          <div class="pr-field"><label class="pr-label">סכום ₪ *</label>
            <input class="pr-input" type="number" name="amount" min="0" step="0.01" required placeholder="0.00" /></div>
          <div class="pr-field pr-field--wide"><label class="pr-label">הערות</label>
            <input class="pr-input" type="text" name="notes" placeholder="הערות" /></div>
        </div>
        <div class="pr-add-form-actions">
          <button class="pr-btn pr-btn--primary" type="submit">הוסף</button>
          <button class="pr-btn pr-btn--ghost" type="button" data-pr-action="toggle-add-transport">ביטול</button>
        </div>
      </form>
    </div>
    <button class="pr-btn pr-btn--add-row" data-pr-action="toggle-add-transport">+ הוסף תחבורה ציבורית</button>
  ` : '';

  // ── Section 5: Expenses table ────────────────────────────────────────────
  const expenseRows = expenses.length === 0
    ? `<tr><td colspan="5" class="pr-table-empty">אין רשומות</td></tr>`
    : expenses.map(r => `
        <tr class="pr-data-row" data-id="${escapeHtml(r.id)}">
          <td class="pr-td-date">${fmtDate(r.expense_date)}</td>
          <td>${escapeHtml(r.description)}</td>
          <td class="pr-td-num pr-td-amount">${fmt(r.amount)}</td>
          <td class="pr-td-notes">
            ${editable ? `<label class="pr-attach-inline-btn" title="צרף קבלה/חשבונית">
              📎<input type="file" class="pr-file-input" accept="image/*,.pdf"
                data-entry-id="${escapeHtml(r.id)}" data-entry-type="expense" /></label>` : ''}
          </td>
          <td class="pr-td-actions">
            ${editable ? `<button class="pr-del-btn" data-pr-action="delete-entry"
              data-entry-id="${escapeHtml(r.id)}" data-entry-table="expense_entries"
              aria-label="מחק שורה">✕</button>` : ''}
          </td>
        </tr>
      `).join('');

  const expensesTotalRow = `
    <tr class="pr-total-row">
      <td colspan="2" class="pr-total-label">סה"כ כולל הוצאות</td>
      <td class="pr-td-num pr-total-num pr-total-amount">${fmt(totalExpenses)}</td>
      <td colspan="2"></td>
    </tr>`;

  const addExpenseForm = editable ? `
    <div class="pr-add-panel" id="pr-add-expense-panel" hidden>
      <form class="pr-add-form" id="pr-add-expense-form" data-form-type="expense">
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
        <div class="pr-add-form-actions">
          <button class="pr-btn pr-btn--primary" type="submit">הוסף</button>
          <button class="pr-btn pr-btn--ghost" type="button" data-pr-action="toggle-add-expense">ביטול</button>
        </div>
      </form>
    </div>
    <button class="pr-btn pr-btn--add-row" data-pr-action="toggle-add-expense">+ הוסף שורה</button>
  ` : '';

  // ── Attachments ──────────────────────────────────────────────────────────
  const attachRows = attachments.length === 0
    ? `<p class="pr-empty-msg">אין קבצים מצורפים</p>`
    : attachments.map(a => `
        <div class="pr-attachment-row">
          <span class="pr-attachment-name">${escapeHtml(a.file_name)}</span>
          <button class="pr-btn pr-btn--ghost pr-btn--sm" data-pr-action="view-attachment"
            data-storage-path="${escapeHtml(a.storage_path)}">צפה / הורד</button>
          ${editable ? `<button class="pr-btn pr-btn--ghost pr-btn--sm pr-btn--danger"
            data-pr-action="delete-attachment"
            data-attachment-id="${escapeHtml(a.id)}"
            data-storage-path="${escapeHtml(a.storage_path)}">מחק</button>` : ''}
        </div>
      `).join('');

  const uploadBtn = editable ? `
    <label class="pr-btn pr-btn--secondary pr-btn--sm pr-upload-label" style="margin-top:8px">
      📎 צרף קובץ לדוח
      <input type="file" class="pr-file-input pr-report-file" accept="image/*,.pdf" />
    </label>
  ` : '';

  // ── Submit section ───────────────────────────────────────────────────────
  const submitSection = editable && !isSimulation ? `
    <div class="pr-card pr-submit-card">
      <p class="pr-signature-text">אני מאשר/ת כי הפרטים בדוח זה נכונים ומלאים עבור חודש השכר הנוכחי.</p>
      <label class="pr-label" for="pr-signature-name">שם מלא לחתימה דיגיטלית</label>
      <input class="pr-input pr-signature-input" id="pr-signature-name" type="text"
        value="${escapeHtml(profile.full_name || '')}" autocomplete="name" />
      <label class="pr-confirm-label">
        <input type="checkbox" id="pr-confirm-checkbox" class="pr-confirm-checkbox" />
        <span>אני מאשר/ת כי החתימה הדיגיטלית והשעה הנוכחית יישמרו בדוח.</span>
      </label>
      <button class="pr-btn pr-btn--primary pr-btn--large pr-submit-btn"
        id="pr-submit-btn" data-pr-action="submit-report"
        data-report-id="${escapeHtml(report.id)}" disabled>
        שליחה לשכר
      </button>
    </div>
  ` : editable && isSimulation ? `
    <div class="pr-card pr-submit-card">
      <p class="pr-sim-note">מצב סימולציה — שליחה חסומה</p>
    </div>
  ` : `
    <div class="pr-card pr-submit-card pr-submit-card--locked">
      <span class="pr-locked-msg">🔒 הדוח נעול לעריכה — סטטוס: ${escapeHtml(STATUS_LABELS[report.status] || report.status)}</span>
    </div>
  `;

  return `
    <div class="pr-screen pr-report-form" dir="rtl">
      ${isSimulation ? simulationBannerHtml(profile.full_name) : ''}
      <div class="pr-topbar">
        <button class="pr-btn pr-btn--ghost pr-back-btn" data-pr-action="back-to-my-reports">← חזרה לדוחות שלי</button>
        <span class="pr-topbar__title">דוח ${escapeHtml(monthYearLabel)} — ${escapeHtml(profile.full_name || '')}</span>
        <div class="pr-topbar-status">${statusChip}</div>
      </div>

      <div class="pr-body">
        ${financeNotice}
        <div class="pr-report-tabs" role="tablist" aria-label="אזורי הדוח">
          <button class="pr-report-tab is-active" type="button" role="tab" aria-selected="true" data-pr-action="switch-report-tab" data-tab="expenses">הוצאות</button>
          <button class="pr-report-tab" type="button" role="tab" aria-selected="false" data-pr-action="switch-report-tab" data-tab="travel">נסיעות</button>
          <button class="pr-report-tab" type="button" role="tab" aria-selected="false" data-pr-action="switch-report-tab" data-tab="salary">דיווח שכר</button>
        </div>

        <!-- 1. Report Header -->
        <div class="pr-card pr-report-header-card pr-tab-panel" data-tab-panel="salary" id="pr-report-header">
          <h2 class="pr-section-title">דיווח שכר חודשי</h2>
          <div class="pr-report-identity">
            <div class="pr-id-item"><span class="pr-id-label">עובד</span><strong>${escapeHtml(profile.full_name || '')}</strong></div>
            <div class="pr-id-item"><span class="pr-id-label">חודש דיווח</span><strong>${escapeHtml(monthYearLabel)}</strong></div>
            <div class="pr-id-item"><span class="pr-id-label">סטטוס</span>${statusChip}</div>
          </div>
          ${leaveSection}
        </div>

        <!-- 2. Summary Bar -->
        <div class="pr-summary-bar pr-tab-panel" data-tab-panel="salary">
          <div class="pr-sum-item">
            <span class="pr-sum-label">סה"כ החזר נסיעות</span>
            <span class="pr-sum-value">₪${fmt(totalTravel + totalTransport)}</span>
          </div>
          <div class="pr-sum-item">
            <span class="pr-sum-label">סה"כ הוצאות</span>
            <span class="pr-sum-value">₪${fmt(totalExpenses)}</span>
          </div>
          <div class="pr-sum-item pr-sum-item--total">
            <span class="pr-sum-label">סה"כ להחזר</span>
            <span class="pr-sum-value">₪${fmt(totalAll)}</span>
          </div>
        </div>

        <!-- 3. Travel -->
        <div class="pr-card pr-section-card pr-tab-panel" data-tab-panel="travel">
          <div class="pr-section-head">
            <h2 class="pr-section-title">דוח החזר הוצאות נסיעה</h2>
          </div>
          <div class="pr-table-scroll">
            <table class="pr-data-table">
              <thead>
                <tr>
                  <th class="pr-col-date">תאריך</th><th class="pr-col-mid">נק׳ התחלה</th><th class="pr-col-mid">נק׳ יעד</th><th class="pr-col-detail">פרטים</th>
                  <th class="pr-th-num pr-col-compact">ק"מ הלוך וחזור</th><th class="pr-th-num pr-col-compact">סה"כ החזר</th>
                  <th class="pr-col-compact">אסמכתא</th><th class="pr-th-del">פעולות</th>
                </tr>
              </thead>
              <tbody>
                ${travelRows}
                ${travelTotalRow}
              </tbody>
            </table>
          </div>
          ${addTravelForm}
        </div>

        <!-- 4. Public Transport -->
        <div class="pr-card pr-section-card pr-tab-panel" data-tab-panel="travel">
          <div class="pr-section-head">
            <h2 class="pr-section-title">תחבורה ציבורית</h2>
          </div>
          <div class="pr-table-scroll">
            <table class="pr-data-table">
              <thead>
                <tr>
                  <th>תאריך</th><th>ממקום</th><th>למקום</th><th>פירוט</th>
                  <th class="pr-th-num">₪</th><th>קבלה</th><th>הערות</th><th class="pr-th-del"></th>
                </tr>
              </thead>
              <tbody>
                ${transportRows}
                ${transportTotalRow}
              </tbody>
            </table>
          </div>
          ${addTransportForm}
        </div>

        <!-- 5. Expenses -->
        <div class="pr-card pr-section-card pr-tab-panel" data-tab-panel="expenses">
          <div class="pr-section-head">
            <h2 class="pr-section-title">דוח החזר הוצאות</h2>
          </div>
          <div class="pr-table-scroll">
            <table class="pr-data-table">
              <thead>
                <tr>
                  <th class="pr-col-date">תאריך</th><th class="pr-col-detail">פירוט</th>
                  <th class="pr-th-num pr-col-compact">סה"כ בש"ח</th><th class="pr-col-compact">קבלה</th><th class="pr-th-del">פעולות</th>
                </tr>
              </thead>
              <tbody>
                ${expenseRows}
                ${expensesTotalRow}
              </tbody>
            </table>
          </div>
          ${addExpenseForm}
        </div>

        <!-- 7. Attachments -->
        <div class="pr-card pr-section-card pr-tab-panel" data-tab-panel="salary">
          <div class="pr-section-head">
            <h2 class="pr-section-title">קבצים מצורפים</h2>
          </div>
          <div class="pr-attachments-list">${attachRows}</div>
          ${uploadBtn}
        </div>

        <!-- 8. Submit -->
        <div class="pr-tab-panel" data-tab-panel="salary">${submitSection}</div>
      </div>
    </div>
  `;
}

function statusOptionsHtml(selectedStatus) {
  return Object.entries(STATUS_LABELS).map(([value, label]) =>
    `<option value="${escapeHtml(value)}" ${value === selectedStatus ? 'selected' : ''}>${escapeHtml(label)}</option>`
  ).join('');
}

function adminManagePlaceholderHtml(errorMsg = '') {
  const errorHtml = errorMsg
    ? `<div class="pr-alert pr-alert--danger" role="alert">${escapeHtml(errorMsg)}</div>`
    : '';
  return `
    <div class="pr-screen" dir="rtl">
      <div class="pr-topbar">
        <button class="pr-btn pr-btn--ghost pr-back-btn" data-pr-action="back-to-dashboard">← חזרה לדשבורד</button>
        <span class="pr-topbar__title">דוחות אישיים</span>
      </div>
      <div class="pr-body pr-admin-body">
        ${dsPageHeader('דוחות אישיים', 'הוצאות, נסיעות ודיווח שכר חודשי')}
        <div class="pr-admin-mode-switch" role="tablist" aria-label="מצבי אדמין">
          <button class="pr-report-tab" data-pr-action="admin-mode-my" type="button">הדוחות שלי</button>
          <button class="pr-report-tab is-active" data-pr-action="admin-mode-manage" type="button">ניהול דוחות עובדים</button>
        </div>
        <section class="pr-card pr-admin-placeholder" aria-label="ניהול דוחות עובדים">
          <h2 class="pr-card__title">ניהול דוחות עובדים</h2>
          <p class="pr-helper-text">כאן יוצג אזור ניהול דוחות העובדים: סינון, צפייה, אישור והחזרה לתיקון.</p>
          ${errorHtml}
        </section>
      </div>
    </div>
  `;
}

function adminDashboardHtml(reports) {
  const employeeOptions = [...new Map(reports.map((r) => {
    const p = r.profiles || {};
    return [r.employee_id, p.full_name || p.email || '—'];
  }))].map(([id, name]) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`).join('');

  const rows = reports.map(r => {
    const p = r.profiles || {};
    const totals = r.totals || { expenses: 0, travel: 0, all: 0 };
    const monthValue = `${String(r.report_year).padStart(4, '0')}-${String(r.report_month).padStart(2, '0')}`;
    return `
      <tr class="pr-admin-report-row" data-employee-id="${escapeHtml(r.employee_id)}" data-report-month="${escapeHtml(monthValue)}" data-status="${escapeHtml(r.status)}">
        <td>${escapeHtml(p.full_name || '—')}</td>
        <td>${escapeHtml(monthLabel(r.report_month, r.report_year))}</td>
        <td class="pr-td-num pr-td-amount">₪${fmt(totals.expenses)}</td>
        <td class="pr-td-num pr-td-amount">₪${fmt(totals.travel)}</td>
        <td class="pr-td-num pr-td-amount">₪${fmt(totals.all)}</td>
        <td>
          <select class="pr-input pr-input--select pr-admin-status-select" data-report-id="${escapeHtml(r.id)}">
            ${statusOptionsHtml(r.status)}
          </select>
        </td>
        <td class="pr-actions-cell">
          <button class="pr-btn pr-btn--ghost pr-btn--sm" data-pr-action="admin-view-report" data-report-id="${escapeHtml(r.id)}">צפייה בדוח וקבצים</button>
          ${r.status === 'submitted' ? `
            <button class="pr-btn pr-btn--ghost pr-btn--sm pr-btn--success" data-pr-action="admin-approve" data-report-id="${escapeHtml(r.id)}">אשר</button>
            <button class="pr-btn pr-btn--ghost pr-btn--sm pr-btn--warning" data-pr-action="admin-return" data-report-id="${escapeHtml(r.id)}">החזר לתיקון</button>
          ` : ''}
        </td>
      </tr>
    `;
  });

  return `
    <div class="pr-screen" dir="rtl">
      <div class="pr-topbar">
        <button class="pr-btn pr-btn--ghost pr-back-btn" data-pr-action="back-to-dashboard">← חזרה לדשבורד</button>
        <span class="pr-topbar__title">דוחות אישיים</span>
      </div>
      <div class="pr-body pr-admin-body">
        ${dsPageHeader('דוחות אישיים', 'בחר מצב עבודה: דוח אישי שלך או ניהול דוחות עובדים')}
        <div class="pr-admin-mode-switch" role="tablist" aria-label="מצבי אדמין">
          <button class="pr-report-tab" data-pr-action="admin-mode-my" type="button">הדוחות שלי</button>
          <button class="pr-report-tab is-active" data-pr-action="admin-mode-manage" type="button">ניהול דוחות עובדים</button>
        </div>
        <div class="pr-card pr-admin-filters" aria-label="סינון דוחות עובדים">
          <label class="pr-label">עובד
            <select class="pr-input pr-input--select" id="pr-filter-employee"><option value="">כל העובדים</option>${employeeOptions}</select>
          </label>
          <label class="pr-label">חודש
            <input class="pr-input" id="pr-filter-month" type="month" />
          </label>
          <label class="pr-label">סטטוס
            <select class="pr-input pr-input--select" id="pr-filter-status"><option value="">כל הסטטוסים</option>${statusOptionsHtml('')}</select>
          </label>
          <button class="pr-btn pr-btn--ghost pr-btn--sm" data-pr-action="clear-admin-filters">נקה סינון</button>
        </div>
        ${reports.length === 0 ? dsEmptyState('אין דוחות להצגה') : `
          <div class="pr-table-scroll">
            <table class="pr-table pr-admin-table">
              <thead><tr>
                <th>עובד</th><th>חודש דיווח</th><th>סה"כ הוצאות</th><th>סה"כ נסיעות</th><th>סה"כ להחזר</th><th>סטטוס</th><th>פעולות</th>
              </tr></thead>
              <tbody>${rows.join('')}</tbody>
            </table>
          </div>
        `}
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

async function openReportDetail(root, reportId, isAdmin = false, { isSimulation = false, initialTab = 'expenses' } = {}) {
  const report = await fetchReport(reportId);
  const expectedEmployeeId = isSimulation ? prViewAsEmployee?.id : prSession?.user?.id;
  if (!isAdmin && String(report?.employee_id || '') !== String(expectedEmployeeId || '')) {
    throw new Error('unauthorized_report_access');
  }

  let reportProfile = prSession?.profile;
  if (isSimulation && prViewAsEmployee) {
    reportProfile = prViewAsEmployee;
  } else if (isAdmin || isSimulation) {
    const { data } = await supabase.from('profiles').select('full_name, email').eq('id', report.employee_id).single();
    reportProfile = data || prSession?.profile;
  }

  const [travel, transport, expenses, attachments] = await Promise.all([
    fetchDeclaredTravel(reportId),
    fetchPublicTransport(reportId),
    fetchExpenses(reportId),
    fetchAttachments(reportId)
  ]);
  prSelectedReport = report;

  if (isAdmin && !isSimulation) {
    report.profiles = reportProfile;
    renderInto(root, adminReportViewHtml(report, travel, transport, expenses, attachments));
    bindAdminReportView(root);
  } else {
    renderInto(root, reportDetailHtml(report, travel, transport, expenses, attachments, reportProfile, { isSimulation }));
    bindReportDetail(root, { isSimulation });
    setReportTab(root, initialTab);
  }
}

async function safeOpenReportDetail(root, reportId, isAdmin = false, options = {}) {
  try {
    await openReportDetail(root, reportId, isAdmin, options);
  } catch (err) {
    showToast(friendlyPersonalReportsError(err, 'אירעה תקלה בטעינת הדוחות. יש לנסות שוב או לפנות למנהל המערכת.'), 'danger');
  }
}

// ─── admin report view (read-only with admin actions) ─────────────────────────

function adminReportViewHtml(report, travel, transport, expenses, attachments) {
  const profile = report.profiles || {};
  const totalTravelKm  = travel.reduce((s, r) => s + Number(r.roundtrip_km || 0), 0);
  const totalTravel    = travel.reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalTransport = transport.reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalExpenses  = expenses.reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalAll       = totalTravel + totalTransport + totalExpenses;

  const travelRows = travel.length === 0
    ? `<tr><td colspan="8" class="pr-table-empty">אין רשומות</td></tr>`
    : travel.map(r => `
        <tr><td>${fmtDate(r.travel_date)}</td><td>${escapeHtml(r.origin)}</td>
        <td>${escapeHtml(r.destination)}</td><td>${escapeHtml(r.description)}</td>
        <td class="pr-td-num">${fmtNum(r.roundtrip_km)}</td>
        <td class="pr-td-num pr-td-amount">${fmt(r.amount)}</td>
        <td>${escapeHtml(r.notes || '')}</td><td></td></tr>
      `).join('');

  const transportRows = transport.length === 0
    ? `<tr><td colspan="8" class="pr-table-empty">אין רשומות</td></tr>`
    : transport.map(r => `
        <tr><td>${fmtDate(r.travel_date)}</td><td>${escapeHtml(r.origin)}</td>
        <td>${escapeHtml(r.destination)}</td><td>${escapeHtml(r.description)}</td>
        <td class="pr-td-num pr-td-amount">${fmt(r.amount)}</td>
        <td></td><td>${escapeHtml(r.notes || '')}</td><td></td></tr>
      `).join('');

  const expenseRows = expenses.length === 0
    ? `<tr><td colspan="7" class="pr-table-empty">אין רשומות</td></tr>`
    : expenses.map(r => `
        <tr><td>${fmtDate(r.expense_date)}</td>
        <td>${escapeHtml(r.document_type === 'receipt' ? 'קבלה' : r.document_type === 'invoice' ? 'חשבונית' : 'אחר')}</td>
        <td>${escapeHtml(r.description)}</td>
        <td class="pr-td-num pr-td-amount">${fmt(r.amount)}</td>
        <td></td><td>${escapeHtml(r.notes || '')}</td><td></td></tr>
      `).join('');

  const attachRows = attachments.map(a => `
    <div class="pr-attachment-row">
      <span class="pr-attachment-name">${escapeHtml(a.file_name)}</span>
      <button class="pr-btn pr-btn--ghost pr-btn--sm" data-pr-action="view-attachment"
        data-storage-path="${escapeHtml(a.storage_path)}">הורד / צפה</button>
    </div>
  `).join('');

  const statusChip = dsStatusChip(STATUS_LABELS[report.status] || report.status, STATUS_KIND[report.status] || 'neutral');
  const monthYearLabel = monthLabel(report.report_month, report.report_year);

  const hasLeave = 'vacation_days' in report;

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
            <div class="pr-id-item"><span class="pr-id-label">סטטוס</span>${statusChip}</div>
          </div>
          ${hasLeave ? `
            <div class="pr-meta-grid">
              <div class="pr-meta-item"><span class="pr-meta-label">ימים בחודש</span><strong>${report.work_days_in_month ?? '—'}</strong></div>
              <div class="pr-meta-item"><span class="pr-meta-label">ימי חופשה</span><strong>${report.vacation_days ?? 0}</strong></div>
              <div class="pr-meta-item"><span class="pr-meta-label">ימי מחלה</span><strong>${report.sick_days ?? 0}</strong></div>
              <div class="pr-meta-item"><span class="pr-meta-label">יום הצהרה</span><strong>${report.declaration_day ? fmtDate(report.declaration_day) : '—'}</strong></div>
              ${report.report_notes ? `<div class="pr-meta-item pr-meta-item--wide"><span class="pr-meta-label">הערות</span><span>${escapeHtml(report.report_notes)}</span></div>` : ''}
            </div>
          ` : ''}
        </div>

        <!-- Summary bar -->
        <div class="pr-summary-bar">
          <div class="pr-sum-item"><span class="pr-sum-label">תחבורה ציבורית</span><span class="pr-sum-value">₪${fmt(totalTransport)}</span></div>
          <div class="pr-sum-item"><span class="pr-sum-label">נסיעות בהצהרה</span><span class="pr-sum-value">₪${fmt(totalTravel)}</span></div>
          <div class="pr-sum-item"><span class="pr-sum-label">החזר הוצאות</span><span class="pr-sum-value">₪${fmt(totalExpenses)}</span></div>
          <div class="pr-sum-item pr-sum-item--total"><span class="pr-sum-label">סה"כ החזרים</span><span class="pr-sum-value">₪${fmt(totalAll)}</span></div>
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
        <div class="pr-card pr-section-card">
          <div class="pr-section-head"><h2 class="pr-section-title">תחבורה ציבורית</h2></div>
          <div class="pr-table-scroll"><table class="pr-data-table">
            <thead><tr><th>תאריך</th><th>ממקום</th><th>למקום</th><th>פירוט</th><th class="pr-th-num">₪</th><th>קבלה</th><th>הערות</th><th></th></tr></thead>
            <tbody>${transportRows}
              <tr class="pr-total-row"><td colspan="4" class="pr-total-label">סה"כ</td>
                <td class="pr-td-num pr-total-num pr-total-amount">${fmt(totalTransport)}</td>
                <td colspan="3"></td></tr>
            </tbody>
          </table></div>
        </div>

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
        <div class="pr-actions">
          ${report.status === 'submitted' ? `
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

function bindEmployeeDashboard(root, { isSimulation = false } = {}) {
  const employeeId = isSimulation ? prViewAsEmployee?.id : prSession?.user?.id;

  // Check month → show status or "no report" button
  async function checkMonth() {
    const sel = root.querySelector('#pr-month-select');
    const [month, year] = (sel?.value || '').split('-').map(Number);
    if (!month || !year) return;

    const statusEl = root.querySelector('#pr-month-status');
    if (!statusEl) return;

    statusEl.innerHTML = '<span class="pr-checking">בודק…</span>';
    try {
      const report = await getReport(employeeId, month, year);
      if (report) {
        const chip = dsStatusChip(STATUS_LABELS[report.status] || report.status, STATUS_KIND[report.status] || 'neutral');
        statusEl.innerHTML = `
          <div class="pr-month-exists">
            <span>דוח קיים — ${chip}</span>
            <button class="pr-btn pr-btn--primary" data-pr-action="open-report"
              data-report-id="${escapeHtml(report.id)}">פתח דוח</button>
          </div>
        `;
      } else {
        statusEl.innerHTML = noReportStateHtml(month, year, isSimulation);
      }
    } catch (err) {
      statusEl.innerHTML = `<span class="pr-checking" style="color:#991b1b">${escapeHtml(friendlyPersonalReportsError(err))}</span>`;
    }
  }

  async function openSelectedMonthTab(tab) {
    const sel = root.querySelector('#pr-month-select');
    const [month, year] = (sel?.value || '').split('-').map(Number);
    if (!month || !year) return;
    try {
      let report = await getReport(employeeId, month, year);
      if (!report) {
        if (isSimulation) { showToast('אין דוח קיים לחודש זה', 'warning'); return; }
        report = await createReport(employeeId, month, year);
        showToast('טיוטה נוצרה', 'success');
      }
      await safeOpenReportDetail(root, report.id, false, { isSimulation, initialTab: tab });
    } catch (err) {
      showToast(friendlyPersonalReportsError(err), 'danger');
    }
  }

  root.querySelector('#pr-check-report-btn')?.addEventListener('click', checkMonth);
  root.querySelector('#pr-month-select')?.addEventListener('change', () => {
    const statusEl = root.querySelector('#pr-month-status');
    if (statusEl) statusEl.innerHTML = '';
  });

  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-pr-action]');
    if (!btn) return;
    const action = btn.dataset.prAction;

    if (action === 'exit-simulation') {
      prViewAsEmployee = null;
      await rerender(root);
      return;
    }
    if (action === 'back-to-dashboard') {
      dispatchBackToDashboard(); return;
    }
    if (action === 'admin-mode-manage') { prAdminMode = 'manage'; await rerender(root); return; }

    if (action === 'open-month-tab') {
      await openSelectedMonthTab(btn.dataset.tab || 'expenses');
      return;
    }

    if (action === 'open-report') {
      const rid = btn.dataset.reportId;
      if (rid) await safeOpenReportDetail(root, rid, false, { isSimulation });
      return;
    }

    if (action === 'create-report') {
      const month = Number(btn.dataset.month);
      const year  = Number(btn.dataset.year);
      if (!month || !year) return;
      btn.disabled = true;
      btn.textContent = 'יוצר דוח…';
      try {
        const report = await createReport(employeeId, month, year);
        prSelectedReport = report;
        await safeOpenReportDetail(root, report.id, false, { isSimulation: false });
        showToast('טיוטה נוצרה', 'success');
      } catch (err) {
        showToast(friendlyPersonalReportsError(err, 'אירעה תקלה ביצירת הדוח. יש לנסות שוב.'), 'danger');
        btn.disabled = false;
        btn.textContent = 'פתיחת דוח לחודש זה';
      }
      return;
    }

    if (action === 'open-existing-report') {
      const rid = btn.dataset.reportId;
      if (rid) await safeOpenReportDetail(root, rid, false, { isSimulation });
      return;
    }
  });

  // keyboard for report cards
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const card = e.target.closest('[data-pr-action="open-existing-report"]');
      if (card) card.click();
    }
  });

  if (employeeId) loadMyReportsList(root, employeeId);
}

function setReportTab(root, tab = 'expenses') {
  const allowed = new Set(['expenses', 'travel', 'salary']);
  const activeTab = allowed.has(tab) ? tab : 'expenses';
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

  // Enable submit button only when checkbox is checked
  const checkbox = root.querySelector('#pr-confirm-checkbox');
  const submitBtn = root.querySelector('#pr-submit-btn');
  const signatureNameInput = root.querySelector('#pr-signature-name');
  function updateSubmitEnabled() {
    if (!submitBtn) return;
    submitBtn.disabled = !(checkbox?.checked && String(signatureNameInput?.value || '').trim());
  }
  if (checkbox && submitBtn) {
    checkbox.addEventListener('change', updateSubmitEnabled);
    signatureNameInput?.addEventListener('input', updateSubmitEnabled);
    updateSubmitEnabled();
  }

  // Toggle add-entry panels
  function togglePanel(panelId) {
    const panel = root.querySelector(`#${panelId}`);
    if (panel) {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) panel.querySelector('input,select,textarea')?.focus();
    }
  }

  // Save meta fields on blur (header inputs)
  root.addEventListener('blur', async (e) => {
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
  }, true);

  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-pr-action]');
    if (!btn) return;
    const action = btn.dataset.prAction;

    if (action === 'exit-simulation') {
      prViewAsEmployee = null;
      await rerender(root); return;
    }
    if (action === 'back-to-my-reports') {
      if (isSimulation) {
        renderInto(root, employeeDashboardHtml(prViewAsEmployee, { isSimulation: true }));
        bindEmployeeDashboard(root, { isSimulation: true });
        loadMyReportsList(root, prViewAsEmployee.id);
      } else {
        await rerender(root);
      }
      return;
    }
    if (action === 'back-to-dashboard') { dispatchBackToDashboard(); return; }

    if (action === 'switch-report-tab') { setReportTab(root, btn.dataset.tab); return; }

    if (action === 'toggle-add-travel')     { togglePanel('pr-add-travel-panel'); return; }
    if (action === 'toggle-add-transport')  { togglePanel('pr-add-transport-panel'); return; }
    if (action === 'toggle-add-expense')    { togglePanel('pr-add-expense-panel'); return; }

    if (action === 'delete-entry') {
      if (isSimulation) { showToast(SIM_MSG, 'warning'); return; }
      if (!confirm('למחוק שורה זו?')) return;
      try {
        await deleteEntry(btn.dataset.entryTable, btn.dataset.entryId);
        await safeOpenReportDetail(root, prSelectedReport.id, false);
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
        await submitReport(prSelectedReport.id, signatureFullName);
        await safeOpenReportDetail(root, prSelectedReport.id, false);
        showToast('הדוח נשלח לשכר', 'success');
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
        await safeOpenReportDetail(root, prSelectedReport.id, false);
        showToast('קובץ נמחק', 'success');
      } catch (err) { showToast(friendlyPersonalReportsError(err), 'danger'); }
      return;
    }
  });

  root.addEventListener('input', (e) => {
    const kmInput = e.target.closest('input[name="roundtrip_km"]');
    if (!kmInput) return;
    const form = kmInput.closest('form[data-form-type="declared_travel"]');
    const amountInput = form?.querySelector('input[name="amount"]');
    if (amountInput) amountInput.value = (Number(kmInput.value || 0) * 1.6).toFixed(2);
  });

  // File uploads
  root.addEventListener('change', async (e) => {
    const fileInput = e.target.closest('input[type="file"].pr-file-input');
    if (!fileInput || !fileInput.files?.[0]) return;
    if (isSimulation) { showToast(SIM_MSG, 'warning'); fileInput.value = ''; return; }
    const file = fileInput.files[0];
    const expenseEntryId = fileInput.dataset.entryType === 'expense' ? (fileInput.dataset.entryId || null) : null;
    try {
      await uploadAttachment(prSelectedReport.id, prSession.user.id, expenseEntryId, file);
      await safeOpenReportDetail(root, prSelectedReport.id, false);
      showToast('הקובץ הועלה', 'success');
    } catch (err) { showToast(friendlyPersonalReportsError(err, 'אירעה תקלה בהעלאת הקובץ. יש לנסות שוב.'), 'danger'); }
  });

  // Add entry forms submit
  root.addEventListener('submit', async (e) => {
    const form = e.target.closest('.pr-add-form');
    if (!form) return;
    e.preventDefault();
    if (isSimulation) { showToast(SIM_MSG, 'warning'); return; }
    const formType = form.dataset.formType;
    const fd = new FormData(form);
    const reportId  = prSelectedReport.id;
    const employeeId = prSession.user.id;
    try {
      if (formType === 'declared_travel') {
        await upsertDeclaredTravel({
          report_id: reportId, employee_id: employeeId,
          travel_date: fd.get('travel_date'),
          origin: fd.get('origin') || '',
          destination: fd.get('destination') || '',
          description: fd.get('description') || '',
          roundtrip_km: Number(fd.get('roundtrip_km') || 0),
          amount: Number((Number(fd.get('roundtrip_km') || 0) * 1.6).toFixed(2)),
          notes: fd.get('notes') || ''
        });
      } else if (formType === 'public_transport') {
        await upsertPublicTransport({
          report_id: reportId, employee_id: employeeId,
          travel_date: fd.get('travel_date'),
          origin: fd.get('origin') || '',
          destination: fd.get('destination') || '',
          description: fd.get('description') || '',
          amount: Number(fd.get('amount') || 0),
          notes: fd.get('notes') || ''
        });
      } else if (formType === 'expense') {
        await upsertExpense({
          report_id: reportId, employee_id: employeeId,
          expense_date: fd.get('expense_date'),
          document_type: fd.get('document_type') || 'receipt',
          description: fd.get('description') || '',
          amount: Number(fd.get('amount') || 0),
          notes: fd.get('notes') || ''
        });
      }
      await safeOpenReportDetail(root, reportId, false);
      showToast('נשמר', 'success');
    } catch (err) {
      showToast(friendlyPersonalReportsError(err, 'אירעה תקלה בשמירת הדוח. יש לנסות שוב.'), 'danger');
    }
  });
}

function applyAdminFilters(root) {
  const employee = root.querySelector('#pr-filter-employee')?.value || '';
  const month = root.querySelector('#pr-filter-month')?.value || '';
  const status = root.querySelector('#pr-filter-status')?.value || '';
  root.querySelectorAll('.pr-admin-report-row').forEach((row) => {
    const visible = (!employee || row.dataset.employeeId === employee)
      && (!month || row.dataset.reportMonth === month)
      && (!status || row.dataset.status === status);
    row.hidden = !visible;
  });
}

function bindAdminDashboard(root) {
  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-pr-action]');
    if (!btn) return;
    const action = btn.dataset.prAction;
    const reportId = btn.dataset.reportId;

    if (action === 'back-to-dashboard') { dispatchBackToDashboard(); return; }
    if (action === 'admin-mode-my') {
      prAdminMode = 'my';
      renderInto(root, employeeDashboardHtml(prSession.profile));
      bindEmployeeDashboard(root);
      loadMyReportsList(root, prSession.user.id);
      return;
    }
    if (action === 'admin-mode-manage') { prAdminMode = 'manage'; await rerender(root); return; }
    if (action === 'clear-admin-filters') {
      root.querySelector('#pr-filter-employee').value = '';
      root.querySelector('#pr-filter-month').value = '';
      root.querySelector('#pr-filter-status').value = '';
      applyAdminFilters(root);
      return;
    }

    if (action === 'view-as-employee') {
      try {
        const employees = await fetchActiveEmployees();
        renderInto(root, adminEmployeeSelectorHtml(employees));
        bindEmployeeSelector(root);
      } catch (err) { showToast(friendlyPersonalReportsError(err), 'danger'); }
      return;
    }

    if (action === 'admin-view-report' && reportId) {
      await safeOpenReportDetail(root, reportId, true); return;
    }
    if (action === 'admin-approve' && reportId) {
      if (!confirm('לאשר דוח זה?')) return;
      try {
        await adminUpdateReport(reportId, { status: 'approved', approved_at: new Date().toISOString() });
        showToast('הדוח אושר', 'success');
        await rerender(root);
      } catch (err) { showToast(friendlyPersonalReportsError(err), 'danger'); }
      return;
    }
    if (action === 'admin-return' && reportId) {
      const notes = prompt('הסבר לעובד:');
      if (notes === null) return;
      try {
        await adminUpdateReport(reportId, { status: 'needs_correction', finance_notes: notes });
        showToast('הדוח הוחזר לתיקון', 'success');
        await rerender(root);
      } catch (err) { showToast(friendlyPersonalReportsError(err), 'danger'); }
      return;
    }
    if (action === 'admin-mark-paid' && reportId) {
      if (!confirm('לסמן כשולם?')) return;
      try {
        await adminUpdateReport(reportId, { status: 'paid', paid_at: new Date().toISOString() });
        showToast('סומן כשולם', 'success');
        await rerender(root);
      } catch (err) { showToast(friendlyPersonalReportsError(err), 'danger'); }
      return;
    }
  });

  root.addEventListener('change', async (e) => {
    if (e.target.matches('#pr-filter-employee, #pr-filter-month, #pr-filter-status')) {
      applyAdminFilters(root);
      return;
    }
    const statusSelect = e.target.closest('.pr-admin-status-select');
    if (!statusSelect) return;
    const reportId = statusSelect.dataset.reportId;
    const status = statusSelect.value;
    try {
      await adminUpdateReport(reportId, { status });
      statusSelect.closest('.pr-admin-report-row')?.setAttribute('data-status', status);
      showToast('סטטוס עודכן', 'success');
    } catch (err) {
      showToast(friendlyPersonalReportsError(err, 'אירעה תקלה בעדכון הסטטוס. יש לנסות שוב.'), 'danger');
      await rerender(root);
    }
  });
}

function bindAdminReportView(root) {
  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-pr-action]');
    if (!btn) return;
    const action = btn.dataset.prAction;
    const reportId = btn.dataset.reportId;

    if (action === 'back-to-admin') { await rerender(root); return; }

    if (action === 'admin-approve' && reportId) {
      if (!confirm('לאשר דוח זה?')) return;
      try {
        await adminUpdateReport(reportId, { status: 'approved', approved_at: new Date().toISOString() });
        showToast('הדוח אושר', 'success');
        await safeOpenReportDetail(root, reportId, true);
      } catch (err) { showToast(friendlyPersonalReportsError(err), 'danger'); }
      return;
    }
    if (action === 'admin-return' && reportId) {
      const notes = prompt('הסבר לעובד:');
      if (notes === null) return;
      try {
        await adminUpdateReport(reportId, { status: 'needs_correction', finance_notes: notes });
        showToast('הדוח הוחזר לתיקון', 'success');
        await safeOpenReportDetail(root, reportId, true);
      } catch (err) { showToast(friendlyPersonalReportsError(err), 'danger'); }
      return;
    }
    if (action === 'admin-mark-paid' && reportId) {
      if (!confirm('לסמן כשולם?')) return;
      try {
        await adminUpdateReport(reportId, { status: 'paid', paid_at: new Date().toISOString() });
        showToast('סומן כשולם', 'success');
        await safeOpenReportDetail(root, reportId, true);
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
  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-pr-action]');
    if (!btn) return;
    const action = btn.dataset.prAction;

    if (action === 'back-to-admin') { await rerender(root); return; }

    if (action === 'select-view-as-employee') {
      prViewAsEmployee = {
        id:         btn.dataset.employeeId,
        full_name:  btn.dataset.employeeName,
        email:      btn.dataset.employeeEmail
      };
      renderInto(root, employeeDashboardHtml(prViewAsEmployee, { isSimulation: true }));
      bindEmployeeDashboard(root, { isSimulation: true });
      loadMyReportsList(root, prViewAsEmployee.id);
      return;
    }
  });

  root.addEventListener('keydown', (e) => {
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

function bindInternalEmployeeLogin(root, dashboardUser) {
  root.querySelector('[data-pr-action="back-to-dashboard"]')?.addEventListener('click', dispatchBackToDashboard);
  root.querySelector('#pr-internal-login-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('button[type="submit"]');
    const fd = new FormData(form);
    const accessCode = fd.get('access_code');
    if (submit) {
      submit.disabled = true;
      submit.textContent = 'בודק אימות…';
    }
    try {
      prSession = await authenticateInternalEmployee(dashboardUser, accessCode);
      prSelectedReport = null;
      prViewAsEmployee = null;
      prAdminMode = 'my';
      isPersonalReportsUnlocked = true;
      await rerender(root, dashboardUser);
    } catch (err) {
      isPersonalReportsUnlocked = false;
      renderInto(root, internalEmployeeLoginHtml('הקוד שהוזן אינו תקין. יש לבדוק ולנסות שוב.'));
      bindInternalEmployeeLogin(root, dashboardUser);
    }
  });
}

async function rerender(root, dashboardUser) {
  if (!isPersonalReportsUnlocked) {
    renderInto(root, internalEmployeeLoginHtml());
    bindInternalEmployeeLogin(root, dashboardUser);
    return;
  }
  if (!prSession || !prSession.user?.id) {
    isPersonalReportsUnlocked = false;
    renderInto(root, internalEmployeeLoginHtml('הקוד שהוזן אינו תקין. יש לבדוק ולנסות שוב.'));
    bindInternalEmployeeLogin(root, dashboardUser);
    return;
  }
  if (isAdminRole(prSession.profile.role) && prAdminMode === 'my' && !prViewAsEmployee) {
    renderInto(root, employeeDashboardHtml(prSession.profile));
    bindEmployeeDashboard(root);
    loadMyReportsList(root, prSession.user.id);
  } else if (isAdminRole(prSession.profile.role) && prViewAsEmployee) {
    renderInto(root, employeeDashboardHtml(prViewAsEmployee, { isSimulation: true }));
    bindEmployeeDashboard(root, { isSimulation: true });
    loadMyReportsList(root, prViewAsEmployee.id);
  } else if (isAdminRole(prSession.profile.role)) {
    try {
      const reports = await fetchAllReports();
      renderInto(root, adminDashboardHtml(reports));
      bindAdminDashboard(root);
    } catch (err) {
      renderInto(root, adminManagePlaceholderHtml(friendlyPersonalReportsError(err, 'אזור ניהול דוחות עובדים לא נטען כרגע.')));
      bindAdminDashboard(root);
    }
  } else {
    renderInto(root, employeeDashboardHtml(prSession.profile));
    bindEmployeeDashboard(root);
  }
}

// ─── exported screen object ───────────────────────────────────────────────────

export const personalReportsScreen = {
  load: () => Promise.resolve({}),

  render(_data, _ctx) {
    return `<div id="pr-root" class="pr-module-root" dir="rtl"><div class="pr-loading-placeholder">טוען…</div></div>`;
  },

  bind({ root, state } = {}) {
    const prRoot = (root && root.querySelector('#pr-root')) || root;
    const dashboardUser = state?.user || null;
    const view = prRoot?.ownerDocument?.defaultView || globalThis.window;

    resetPersonalReportsAuth();
    prSession = sessionFromDashboardState(state);

    rerender(prRoot, dashboardUser);

    const onNavigateAway = () => {
      resetPersonalReportsAuth();
      document.removeEventListener('app:navigate', onNavigateAway);
      view?.removeEventListener('pagehide', onPageHide);
      view?.removeEventListener('pageshow', onPageShow);
    };
    const onPageHide = () => {
      resetPersonalReportsAuth();
    };
    const onPageShow = (event) => {
      if (!event.persisted) return;
      resetPersonalReportsAuth();
      prSession = sessionFromDashboardState(state);
      rerender(prRoot, dashboardUser);
    };
    document.addEventListener('app:navigate', onNavigateAway);
    view?.addEventListener('pagehide', onPageHide);
    view?.addEventListener('pageshow', onPageShow);
  }
};
