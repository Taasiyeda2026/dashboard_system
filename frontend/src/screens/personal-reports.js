/**
 * Personal Reports Screen — דוחות אישיים
 *
 * Digital monthly salary report form, based on the Excel format "דיווח שכר אישי".
 * Handles its own Supabase Auth session (separate from the main dashboard session).
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
  submitted:        'נשלח לכספים',
  needs_correction: 'הוחזר לתיקון',
  approved:         'אושר',
  paid:             'שולם'
};

const STATUS_KIND = {
  draft:            'neutral',
  submitted:        'warning',
  needs_correction: 'danger',
  approved:         'success',
  paid:             'success'
};

// ─── module state ─────────────────────────────────────────────────────────────

let prSession        = null;
let prSelectedReport = null;
let prViewAsEmployee = null;

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

// ─── supabase API ─────────────────────────────────────────────────────────────

async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signOut() {
  await supabase.auth.signOut();
}

async function resetPassword(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  if (error) throw error;
}

async function getProfile(userId) {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
  if (error) throw error;
  return data;
}

async function getReport(employeeId, month, year) {
  const { data } = await supabase
    .from('personal_reports')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('report_month', month)
    .eq('report_year', year)
    .single();
  return data || null;
}

async function createReport(employeeId, month, year) {
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

async function submitReport(reportId) {
  const { error } = await supabase
    .from('personal_reports')
    .update({ status: 'submitted', submitted_at: new Date().toISOString() })
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
  return data || [];
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

function loginHtml(errorMsg = '') {
  return `
    <div class="pr-auth-wrap" dir="rtl">
      <div class="pr-auth-card">
        <h1 class="pr-auth-title">דוחות אישיים</h1>
        <p class="pr-auth-sub">הוצאות, נסיעות וקבלות</p>
        ${errorMsg ? `<div class="pr-alert pr-alert--danger" role="alert">${escapeHtml(errorMsg)}</div>` : ''}
        <form id="pr-login-form" class="pr-form" novalidate>
          <div class="pr-field">
            <label class="pr-label" for="pr-email">מייל עבודה</label>
            <input class="pr-input" id="pr-email" type="email" autocomplete="email" required placeholder="your@email.com" />
          </div>
          <div class="pr-field">
            <label class="pr-label" for="pr-pass">סיסמה</label>
            <input class="pr-input" id="pr-pass" type="password" autocomplete="current-password" required placeholder="••••••••" />
          </div>
          <button class="pr-btn pr-btn--primary pr-btn--full" type="submit" id="pr-login-btn">התחברות</button>
          <button class="pr-btn pr-btn--link" type="button" id="pr-forgot-btn">שכחתי סיסמה</button>
        </form>
      </div>
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
        ${isSimulation ? '' : `<button class="pr-btn pr-btn--ghost pr-btn--sm" data-pr-action="sign-out">יציאה</button>`}
      </div>
      <div class="pr-body">
        ${dsPageHeader('הדוחות האישיים שלי', `${isSimulation ? 'סימולציה עבור: ' : 'שלום, '}${escapeHtml(profile.full_name)}`)}

        <div class="pr-card pr-month-selector-card">
          <label class="pr-label" for="pr-month-select">בחר חודש דיווח</label>
          <div class="pr-month-row">
            <select class="pr-input pr-input--select" id="pr-month-select">${monthOptions}</select>
            <button class="pr-btn pr-btn--primary" id="pr-check-report-btn" data-pr-action="check-report">בדוק חודש</button>
          </div>
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
          <td class="pr-td-notes">${escapeHtml(r.notes || '')}</td>
          <td class="pr-td-actions">
            ${editable ? `<button class="pr-del-btn" data-pr-action="delete-entry"
              data-entry-id="${escapeHtml(r.id)}" data-entry-table="declared_travel_entries"
              aria-label="מחק שורה" title="מחק">✕</button>` : ''}
          </td>
        </tr>
      `).join('');

  const travelTotalRow = `
    <tr class="pr-total-row">
      <td colspan="4" class="pr-total-label">סה"כ</td>
      <td class="pr-td-num pr-total-num">${fmtNum(totalTravelKm)}</td>
      <td class="pr-td-num pr-total-num pr-total-amount">${fmt(totalTravel)}</td>
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
          <div class="pr-field"><label class="pr-label">סכום ₪ *</label>
            <input class="pr-input" type="number" name="amount" min="0" step="0.01" required placeholder="0.00" /></div>
          <div class="pr-field pr-field--wide"><label class="pr-label">הערות</label>
            <input class="pr-input" type="text" name="notes" placeholder="הערות / קובץ נדרש" /></div>
        </div>
        <div class="pr-add-form-actions">
          <button class="pr-btn pr-btn--primary" type="submit">הוסף</button>
          <button class="pr-btn pr-btn--ghost" type="button" data-pr-action="toggle-add-travel">ביטול</button>
        </div>
      </form>
    </div>
    <button class="pr-btn pr-btn--add-row" data-pr-action="toggle-add-travel">+ הוספת נסיעה בהצהרה</button>
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
    <button class="pr-btn pr-btn--add-row" data-pr-action="toggle-add-transport">+ הוספת תחבורה ציבורית</button>
  ` : '';

  // ── Section 5: Expenses table ────────────────────────────────────────────
  const expenseRows = expenses.length === 0
    ? `<tr><td colspan="7" class="pr-table-empty">אין רשומות</td></tr>`
    : expenses.map(r => `
        <tr class="pr-data-row" data-id="${escapeHtml(r.id)}">
          <td class="pr-td-date">${fmtDate(r.expense_date)}</td>
          <td>${escapeHtml(r.document_type === 'receipt' ? 'קבלה' : r.document_type === 'invoice' ? 'חשבונית' : 'אחר')}</td>
          <td>${escapeHtml(r.description)}</td>
          <td class="pr-td-num pr-td-amount">${fmt(r.amount)}</td>
          <td class="pr-td-notes">
            ${editable ? `<label class="pr-attach-inline-btn" title="צרף קבלה/חשבונית">
              📎<input type="file" class="pr-file-input" accept="image/*,.pdf"
                data-entry-id="${escapeHtml(r.id)}" data-entry-type="expense" /></label>` : ''}
          </td>
          <td class="pr-td-notes">${escapeHtml(r.notes || '')}</td>
          <td class="pr-td-actions">
            ${editable ? `<button class="pr-del-btn" data-pr-action="delete-entry"
              data-entry-id="${escapeHtml(r.id)}" data-entry-table="expense_entries"
              aria-label="מחק שורה">✕</button>` : ''}
          </td>
        </tr>
      `).join('');

  const expensesTotalRow = `
    <tr class="pr-total-row">
      <td colspan="3" class="pr-total-label">סה"כ</td>
      <td class="pr-td-num pr-total-num pr-total-amount">${fmt(totalExpenses)}</td>
      <td colspan="3"></td>
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
    <button class="pr-btn pr-btn--add-row" data-pr-action="toggle-add-expense">+ הוספת הוצאה</button>
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
      <label class="pr-confirm-label">
        <input type="checkbox" id="pr-confirm-checkbox" class="pr-confirm-checkbox" />
        <span>אני מאשר/ת שהנתונים שמילאתי נכונים ומלאים לפי ידיעתי.</span>
      </label>
      <button class="pr-btn pr-btn--primary pr-btn--large pr-submit-btn"
        id="pr-submit-btn" data-pr-action="submit-report"
        data-report-id="${escapeHtml(report.id)}" disabled>
        שליחה לכספים
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

        <!-- 1. Report Header -->
        <div class="pr-card pr-report-header-card" id="pr-report-header">
          <h2 class="pr-section-title">פרטי דוח</h2>
          <div class="pr-report-identity">
            <div class="pr-id-item"><span class="pr-id-label">עובד</span><strong>${escapeHtml(profile.full_name || '')}</strong></div>
            <div class="pr-id-item"><span class="pr-id-label">חודש דיווח</span><strong>${escapeHtml(monthYearLabel)}</strong></div>
            <div class="pr-id-item"><span class="pr-id-label">סטטוס</span>${statusChip}</div>
          </div>
          ${leaveSection}
        </div>

        <!-- 2. Summary Bar -->
        <div class="pr-summary-bar">
          <div class="pr-sum-item">
            <span class="pr-sum-label">תחבורה ציבורית</span>
            <span class="pr-sum-value">₪${fmt(totalTransport)}</span>
          </div>
          <div class="pr-sum-item">
            <span class="pr-sum-label">נסיעות בהצהרה</span>
            <span class="pr-sum-value">₪${fmt(totalTravel)}</span>
          </div>
          <div class="pr-sum-item">
            <span class="pr-sum-label">החזר הוצאות</span>
            <span class="pr-sum-value">₪${fmt(totalExpenses)}</span>
          </div>
          <div class="pr-sum-item pr-sum-item--total">
            <span class="pr-sum-label">סה"כ החזרים</span>
            <span class="pr-sum-value">₪${fmt(totalAll)}</span>
          </div>
        </div>

        <!-- 3. Declared Travel -->
        <div class="pr-card pr-section-card">
          <div class="pr-section-head">
            <h2 class="pr-section-title">נסיעות בהצהרה</h2>
          </div>
          <div class="pr-table-scroll">
            <table class="pr-data-table">
              <thead>
                <tr>
                  <th>תאריך</th><th>ממקום</th><th>למקום</th><th>פירוט</th>
                  <th class="pr-th-num">ק"מ</th><th class="pr-th-num">₪</th>
                  <th>הערות</th><th class="pr-th-del"></th>
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
        <div class="pr-card pr-section-card">
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
        <div class="pr-card pr-section-card">
          <div class="pr-section-head">
            <h2 class="pr-section-title">הוצאות</h2>
          </div>
          <div class="pr-table-scroll">
            <table class="pr-data-table">
              <thead>
                <tr>
                  <th>תאריך</th><th>סוג</th><th>פירוט</th>
                  <th class="pr-th-num">₪</th><th>קבלה/חשבונית</th><th>הערות</th><th class="pr-th-del"></th>
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
        <div class="pr-card pr-section-card">
          <div class="pr-section-head">
            <h2 class="pr-section-title">קבצים מצורפים</h2>
          </div>
          <div class="pr-attachments-list">${attachRows}</div>
          ${uploadBtn}
        </div>

        <!-- 8. Submit -->
        ${submitSection}
      </div>
    </div>
  `;
}

function adminDashboardHtml(reports) {
  const rows = reports.map(r => {
    const p = r.profiles || {};
    return `
      <tr>
        <td>${escapeHtml(p.full_name || '—')}</td>
        <td>${escapeHtml(p.email || '—')}</td>
        <td>${escapeHtml(monthLabel(r.report_month, r.report_year))}</td>
        <td>${dsStatusChip(STATUS_LABELS[r.status] || r.status, STATUS_KIND[r.status] || 'neutral')}</td>
        <td>${r.submitted_at ? fmtDate(r.submitted_at.slice(0, 10)) : '—'}</td>
        <td>${r.finance_notes ? escapeHtml(r.finance_notes.slice(0, 40)) : '—'}</td>
        <td class="pr-actions-cell">
          <button class="pr-btn pr-btn--ghost pr-btn--sm" data-pr-action="admin-view-report" data-report-id="${escapeHtml(r.id)}">צפה</button>
          ${r.status === 'submitted' ? `
            <button class="pr-btn pr-btn--ghost pr-btn--sm pr-btn--success" data-pr-action="admin-approve" data-report-id="${escapeHtml(r.id)}">אשר</button>
            <button class="pr-btn pr-btn--ghost pr-btn--sm pr-btn--warning" data-pr-action="admin-return" data-report-id="${escapeHtml(r.id)}">החזר לתיקון</button>
          ` : ''}
          ${r.status === 'approved' ? `
            <button class="pr-btn pr-btn--ghost pr-btn--sm pr-btn--success" data-pr-action="admin-mark-paid" data-report-id="${escapeHtml(r.id)}">סמן כשולם</button>
          ` : ''}
        </td>
      </tr>
    `;
  });

  return `
    <div class="pr-screen" dir="rtl">
      <div class="pr-topbar">
        <button class="pr-btn pr-btn--ghost pr-back-btn" data-pr-action="back-to-dashboard">← חזרה לדשבורד</button>
        <span class="pr-topbar__title">דוחות אישיים — ניהול</span>
        <button class="pr-btn pr-btn--ghost pr-btn--sm" data-pr-action="sign-out">יציאה</button>
      </div>
      <div class="pr-body">
        ${dsPageHeader('ניהול דוחות אישיים', 'כל הדוחות של כל העובדים')}
        <div class="pr-admin-actions-bar">
          <button class="pr-btn pr-btn--secondary" data-pr-action="view-as-employee">👁 תצוגה כעובד</button>
        </div>
        ${reports.length === 0 ? dsEmptyState('אין דוחות להצגה') : `
          <div class="pr-table-scroll">
            <table class="pr-table">
              <thead><tr>
                <th>שם עובד</th><th>מייל</th><th>חודש</th><th>סטטוס</th>
                <th>תאריך שליחה</th><th>הערות כספים</th><th>פעולות</th>
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
  const { data: reports } = await supabase
    .from('personal_reports')
    .select('*')
    .eq('employee_id', employeeId)
    .order('report_year', { ascending: false })
    .order('report_month', { ascending: false });
  const listEl = root.querySelector('#pr-my-reports-list');
  if (listEl) listEl.innerHTML = myReportsListHtml(reports || []);
}

async function openReportDetail(root, reportId, isAdmin = false, { isSimulation = false } = {}) {
  const report = await fetchReport(reportId);

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

function bindLoginForm(root) {
  const form = root.querySelector('#pr-login-form');
  const forgotBtn = root.querySelector('#pr-forgot-btn');

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = root.querySelector('#pr-email')?.value?.trim();
    const pass  = root.querySelector('#pr-pass')?.value;
    if (!email || !pass) return;
    const btn = root.querySelector('#pr-login-btn');
    btn.disabled = true;
    btn.textContent = 'מתחבר…';
    try {
      const { user } = await signIn(email, pass);
      const profile = await getProfile(user.id);
      prSession = { user, profile };
      await rerender(root);
    } catch (err) {
      renderInto(root, loginHtml(err.message || 'שגיאה בהתחברות. בדוק פרטים ונסה שוב.'));
      bindLoginForm(root);
    }
  });

  forgotBtn?.addEventListener('click', async () => {
    const email = root.querySelector('#pr-email')?.value?.trim();
    if (!email) { showToast('הכנס מייל עבודה תחילה', 'warning'); return; }
    try {
      await resetPassword(email);
      showToast('קישור לאיפוס סיסמה נשלח למייל', 'success');
    } catch (err) {
      showToast(err.message || 'שגיאה בשליחת האיפוס', 'danger');
    }
  });
}

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
      statusEl.innerHTML = `<span class="pr-checking" style="color:#991b1b">${escapeHtml(err.message)}</span>`;
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
    if (action === 'sign-out') {
      await handleSignOut(root); return;
    }

    if (action === 'open-report') {
      const rid = btn.dataset.reportId;
      if (rid) await openReportDetail(root, rid, false, { isSimulation });
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
        await openReportDetail(root, report.id, false, { isSimulation: false });
        showToast('טיוטה נוצרה', 'success');
      } catch (err) {
        showToast(err.message || 'שגיאה ביצירת הדוח', 'danger');
        btn.disabled = false;
        btn.textContent = 'פתיחת דוח לחודש זה';
      }
      return;
    }

    if (action === 'open-existing-report') {
      const rid = btn.dataset.reportId;
      if (rid) await openReportDetail(root, rid, false, { isSimulation });
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

function bindReportDetail(root, { isSimulation = false } = {}) {
  const SIM_MSG = 'מצב סימולציה — פעולה זו חסומה. זוהי תצוגה בלבד.';

  // Enable submit button only when checkbox is checked
  const checkbox = root.querySelector('#pr-confirm-checkbox');
  const submitBtn = root.querySelector('#pr-submit-btn');
  if (checkbox && submitBtn) {
    checkbox.addEventListener('change', () => {
      submitBtn.disabled = !checkbox.checked;
    });
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
      showToast(`שגיאה בשמירת ${field}: ${err.message}`, 'danger');
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
    if (action === 'sign-out') { await handleSignOut(root); return; }

    if (action === 'toggle-add-travel')     { togglePanel('pr-add-travel-panel'); return; }
    if (action === 'toggle-add-transport')  { togglePanel('pr-add-transport-panel'); return; }
    if (action === 'toggle-add-expense')    { togglePanel('pr-add-expense-panel'); return; }

    if (action === 'delete-entry') {
      if (isSimulation) { showToast(SIM_MSG, 'warning'); return; }
      if (!confirm('למחוק שורה זו?')) return;
      try {
        await deleteEntry(btn.dataset.entryTable, btn.dataset.entryId);
        await openReportDetail(root, prSelectedReport.id, false);
        showToast('נמחק', 'success');
      } catch (err) { showToast(err.message, 'danger'); }
      return;
    }

    if (action === 'submit-report') {
      if (isSimulation) { showToast(SIM_MSG, 'warning'); return; }
      const cb = root.querySelector('#pr-confirm-checkbox');
      if (!cb?.checked) { showToast('יש לסמן את תיבת האישור', 'warning'); return; }
      if (!confirm('לשלוח את הדוח לכספים? לאחר שליחה לא ניתן לערוך.')) return;
      try {
        await submitReport(prSelectedReport.id);
        await openReportDetail(root, prSelectedReport.id, false);
        showToast('הדוח נשלח לכספים', 'success');
      } catch (err) { showToast(err.message, 'danger'); }
      return;
    }

    if (action === 'view-attachment') {
      try {
        const url = await getSignedUrl(btn.dataset.storagePath);
        window.open(url, '_blank', 'noopener');
      } catch (err) { showToast(err.message, 'danger'); }
      return;
    }

    if (action === 'delete-attachment') {
      if (isSimulation) { showToast(SIM_MSG, 'warning'); return; }
      if (!confirm('למחוק קובץ זה?')) return;
      try {
        await deleteAttachment({ id: btn.dataset.attachmentId, storage_path: btn.dataset.storagePath });
        await openReportDetail(root, prSelectedReport.id, false);
        showToast('קובץ נמחק', 'success');
      } catch (err) { showToast(err.message, 'danger'); }
      return;
    }
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
      await openReportDetail(root, prSelectedReport.id, false);
      showToast('הקובץ הועלה', 'success');
    } catch (err) { showToast(err.message || 'שגיאה בהעלאה', 'danger'); }
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
          amount: Number(fd.get('amount') || 0),
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
      await openReportDetail(root, reportId, false);
      showToast('נשמר', 'success');
    } catch (err) {
      showToast(err.message || 'שגיאה בשמירה', 'danger');
    }
  });
}

function bindAdminDashboard(root) {
  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-pr-action]');
    if (!btn) return;
    const action = btn.dataset.prAction;
    const reportId = btn.dataset.reportId;

    if (action === 'back-to-dashboard') { dispatchBackToDashboard(); return; }
    if (action === 'sign-out') { await handleSignOut(root); return; }

    if (action === 'view-as-employee') {
      try {
        const employees = await fetchActiveEmployees();
        renderInto(root, adminEmployeeSelectorHtml(employees));
        bindEmployeeSelector(root);
      } catch (err) { showToast(err.message || 'שגיאה', 'danger'); }
      return;
    }

    if (action === 'admin-view-report' && reportId) {
      await openReportDetail(root, reportId, true); return;
    }
    if (action === 'admin-approve' && reportId) {
      if (!confirm('לאשר דוח זה?')) return;
      try {
        await adminUpdateReport(reportId, { status: 'approved', approved_at: new Date().toISOString() });
        showToast('הדוח אושר', 'success');
        await rerender(root);
      } catch (err) { showToast(err.message, 'danger'); }
      return;
    }
    if (action === 'admin-return' && reportId) {
      const notes = prompt('הסבר לעובד:');
      if (notes === null) return;
      try {
        await adminUpdateReport(reportId, { status: 'needs_correction', finance_notes: notes });
        showToast('הדוח הוחזר לתיקון', 'success');
        await rerender(root);
      } catch (err) { showToast(err.message, 'danger'); }
      return;
    }
    if (action === 'admin-mark-paid' && reportId) {
      if (!confirm('לסמן כשולם?')) return;
      try {
        await adminUpdateReport(reportId, { status: 'paid', paid_at: new Date().toISOString() });
        showToast('סומן כשולם', 'success');
        await rerender(root);
      } catch (err) { showToast(err.message, 'danger'); }
      return;
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
        await openReportDetail(root, reportId, true);
      } catch (err) { showToast(err.message, 'danger'); }
      return;
    }
    if (action === 'admin-return' && reportId) {
      const notes = prompt('הסבר לעובד:');
      if (notes === null) return;
      try {
        await adminUpdateReport(reportId, { status: 'needs_correction', finance_notes: notes });
        showToast('הדוח הוחזר לתיקון', 'success');
        await openReportDetail(root, reportId, true);
      } catch (err) { showToast(err.message, 'danger'); }
      return;
    }
    if (action === 'admin-mark-paid' && reportId) {
      if (!confirm('לסמן כשולם?')) return;
      try {
        await adminUpdateReport(reportId, { status: 'paid', paid_at: new Date().toISOString() });
        showToast('סומן כשולם', 'success');
        await openReportDetail(root, reportId, true);
      } catch (err) { showToast(err.message, 'danger'); }
      return;
    }
    if (action === 'admin-save-notes' && reportId) {
      const notes = root.querySelector('#pr-admin-notes')?.value || '';
      try {
        await adminUpdateReport(reportId, { finance_notes: notes });
        showToast('הערות נשמרו', 'success');
      } catch (err) { showToast(err.message, 'danger'); }
      return;
    }
    if (action === 'view-attachment') {
      try {
        const url = await getSignedUrl(btn.dataset.storagePath);
        window.open(url, '_blank', 'noopener');
      } catch (err) { showToast(err.message, 'danger'); }
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
  document.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: 'dashboard' } }));
}

async function handleSignOut(root) {
  await signOut();
  prSession        = null;
  prSelectedReport = null;
  prViewAsEmployee = null;
  renderInto(root, loginHtml());
  bindLoginForm(root);
}

async function rerender(root) {
  if (!prSession) {
    renderInto(root, loginHtml());
    bindLoginForm(root);
    return;
  }
  if (prSession.profile.role === 'admin' && prViewAsEmployee) {
    renderInto(root, employeeDashboardHtml(prViewAsEmployee, { isSimulation: true }));
    bindEmployeeDashboard(root, { isSimulation: true });
    loadMyReportsList(root, prViewAsEmployee.id);
  } else if (prSession.profile.role === 'admin') {
    try {
      const reports = await fetchAllReports();
      renderInto(root, adminDashboardHtml(reports));
      bindAdminDashboard(root);
    } catch (err) {
      renderInto(root, loginHtml(err.message));
      bindLoginForm(root);
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

  bind({ root } = {}) {
    const prRoot = (root && root.querySelector('#pr-root')) || root;

    prSession        = null;
    prSelectedReport = null;
    prViewAsEmployee = null;

    renderInto(prRoot, loginHtml());
    bindLoginForm(prRoot);

    const onNavigateAway = () => {
      prSession        = null;
      prSelectedReport = null;
      prViewAsEmployee = null;
      document.removeEventListener('app:navigate', onNavigateAway);
    };
    document.addEventListener('app:navigate', onNavigateAway);
  }
};
