/**
 * Personal Reports Screen — דוחות אישיים
 *
 * Handles its own Supabase Auth session (separate from the main dashboard session).
 * Uses the shared supabase client (anon key only — no service_role exposure).
 *
 * Roles:
 *   employee — sees only their own reports
 *   admin    — sees all reports, can approve / return / mark paid
 */

import { supabase } from '../supabase-client.js';
import { escapeHtml } from './shared/html.js';
import { dsPageHeader, dsCard, dsScreenStack, dsEmptyState, dsStatusChip } from './shared/layout.js';

// ─── constants ────────────────────────────────────────────────────────────────

const MONTHS_HE = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

const STATUS_LABELS = {
  draft:            'טיוטה',
  submitted:        'נשלח לכספים',
  needs_correction: 'נדרש תיקון',
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

const DOC_TYPE_LABELS = { receipt: 'קבלה', invoice: 'חשבונית', other: 'אחר' };

// ─── module state ─────────────────────────────────────────────────────────────

let prSession = null;   // { user, profile }
let prView = 'login';   // login | employee | admin | report-detail | employee-report
let prSelectedReport = null;
let prSelectedMonth = null;  // { month, year }

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmt(n) { return Number(n || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function fmtDate(d) {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString('he-IL'); } catch { return d; }
}

function currentMonthYear() {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

function monthLabel(month, year) {
  return `${MONTHS_HE[month - 1]} ${year}`;
}

function canEditReport(report) {
  return !report || report.status === 'draft' || report.status === 'needs_correction';
}

// ─── supabase API calls ───────────────────────────────────────────────────────

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
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

async function getOrCreateReport(employeeId, month, year) {
  const { data: existing } = await supabase
    .from('personal_reports')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('report_month', month)
    .eq('report_year', year)
    .single();
  if (existing) return existing;

  const { data: created, error } = await supabase
    .from('personal_reports')
    .insert({ employee_id: employeeId, report_month: month, report_year: year, status: 'draft' })
    .select()
    .single();
  if (error) throw error;
  return created;
}

async function fetchReport(reportId) {
  const { data, error } = await supabase
    .from('personal_reports')
    .select('*')
    .eq('id', reportId)
    .single();
  if (error) throw error;
  return data;
}

async function fetchAllReports() {
  const { data, error } = await supabase
    .from('personal_reports')
    .select(`
      *,
      profiles!personal_reports_employee_id_fkey(full_name, email)
    `)
    .order('report_year', { ascending: false })
    .order('report_month', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function fetchDeclaredTravel(reportId) {
  const { data, error } = await supabase
    .from('declared_travel_entries')
    .select('*')
    .eq('report_id', reportId)
    .order('travel_date');
  if (error) throw error;
  return data || [];
}

async function fetchPublicTransport(reportId) {
  const { data, error } = await supabase
    .from('public_transport_entries')
    .select('*')
    .eq('report_id', reportId)
    .order('travel_date');
  if (error) throw error;
  return data || [];
}

async function fetchExpenses(reportId) {
  const { data, error } = await supabase
    .from('expense_entries')
    .select('*')
    .eq('report_id', reportId)
    .order('expense_date');
  if (error) throw error;
  return data || [];
}

async function fetchAttachments(reportId) {
  const { data, error } = await supabase
    .from('report_attachments')
    .select('*')
    .eq('report_id', reportId)
    .order('uploaded_at');
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

async function submitReport(reportId) {
  const { error } = await supabase
    .from('personal_reports')
    .update({ status: 'submitted', submitted_at: new Date().toISOString() })
    .eq('id', reportId);
  if (error) throw error;
}

async function adminUpdateReport(reportId, fields) {
  const { error } = await supabase
    .from('personal_reports')
    .update(fields)
    .eq('id', reportId);
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

// ─── render helpers ───────────────────────────────────────────────────────────

function showToast(msg, kind = 'info') {
  const el = document.getElementById('pr-toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `pr-toast pr-toast--${kind} pr-toast--visible`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('pr-toast--visible'), 3500);
}

function setLoading(id, on) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('pr-loading', on);
}

// ─── HTML builders ────────────────────────────────────────────────────────────

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

function employeeDashboardHtml(profile) {
  const { month, year } = currentMonthYear();
  let monthOptions = '';
  for (let i = 0; i < 12; i++) {
    const m = month - i <= 0 ? month - i + 12 : month - i;
    const y = month - i <= 0 ? year - 1 : year;
    monthOptions += `<option value="${m}-${y}" ${i === 0 ? 'selected' : ''}>${monthLabel(m, y)}</option>`;
  }

  return `
    <div class="pr-screen" dir="rtl">
      <div class="pr-topbar">
        <button class="pr-btn pr-btn--ghost pr-back-btn" data-pr-action="back-to-dashboard">← חזרה לדשבורד</button>
        <span class="pr-topbar__title">דוחות אישיים</span>
        <button class="pr-btn pr-btn--ghost pr-btn--sm" data-pr-action="sign-out">יציאה</button>
      </div>

      <div class="pr-body">
        ${dsPageHeader('הדוחות האישיים שלי', `שלום ${escapeHtml(profile.full_name)}`)}

        <div class="pr-card pr-card--highlight">
          <label class="pr-label" for="pr-month-select">בחר חודש דיווח</label>
          <select class="pr-input pr-input--select" id="pr-month-select">
            ${monthOptions}
          </select>
          <button class="pr-btn pr-btn--primary" id="pr-open-report-btn" data-pr-action="open-report" style="margin-top:12px">
            פתח / צפה בדוח
          </button>
        </div>

        <div id="pr-my-reports-list" class="pr-reports-list">
          <div class="pr-loading-placeholder">טוען דוחות…</div>
        </div>
      </div>
    </div>
  `;
}

function reportDetailHtml(report, travel, transport, expenses, attachments, profile) {
  const editable = canEditReport(report);
  const monthYearLabel = monthLabel(report.report_month, report.report_year);
  const statusChip = dsStatusChip(STATUS_LABELS[report.status] || report.status, STATUS_KIND[report.status] || 'neutral');

  const totalTravel = travel.reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalTransport = transport.reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalExpenses = expenses.reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalAll = totalTravel + totalTransport + totalExpenses;

  const travelRows = travel.map(r => `
    <div class="pr-entry-row" data-entry-id="${escapeHtml(r.id)}" data-entry-type="declared_travel">
      <div class="pr-entry-main">
        <span class="pr-entry-date">${fmtDate(r.travel_date)}</span>
        <span class="pr-entry-desc">${escapeHtml(r.origin)} → ${escapeHtml(r.destination)}</span>
        ${r.description ? `<span class="pr-entry-note">${escapeHtml(r.description)}</span>` : ''}
        <span class="pr-entry-detail">${escapeHtml(String(r.roundtrip_km))} ק"מ</span>
      </div>
      <div class="pr-entry-amount">₪${fmt(r.amount)}</div>
      ${editable ? `<button class="pr-entry-del" data-pr-action="delete-entry" data-entry-id="${escapeHtml(r.id)}" data-entry-table="declared_travel_entries" aria-label="מחק">✕</button>` : ''}
    </div>
  `).join('');

  const transportRows = transport.map(r => `
    <div class="pr-entry-row" data-entry-id="${escapeHtml(r.id)}" data-entry-type="public_transport">
      <div class="pr-entry-main">
        <span class="pr-entry-date">${fmtDate(r.travel_date)}</span>
        <span class="pr-entry-desc">${escapeHtml(r.origin)} → ${escapeHtml(r.destination)}</span>
        ${r.description ? `<span class="pr-entry-note">${escapeHtml(r.description)}</span>` : ''}
      </div>
      <div class="pr-entry-amount">₪${fmt(r.amount)}</div>
      ${editable ? `<button class="pr-entry-del" data-pr-action="delete-entry" data-entry-id="${escapeHtml(r.id)}" data-entry-table="public_transport_entries" aria-label="מחק">✕</button>` : ''}
    </div>
  `).join('');

  const expenseRows = expenses.map(r => `
    <div class="pr-entry-row" data-entry-id="${escapeHtml(r.id)}" data-entry-type="expense">
      <div class="pr-entry-main">
        <span class="pr-entry-date">${fmtDate(r.expense_date)}</span>
        <span class="pr-entry-doc-type">${escapeHtml(DOC_TYPE_LABELS[r.document_type] || r.document_type)}</span>
        <span class="pr-entry-desc">${escapeHtml(r.description)}</span>
      </div>
      <div class="pr-entry-amount">₪${fmt(r.amount)}</div>
      ${editable ? `
        <label class="pr-entry-attach-btn" title="צרף קובץ">
          📎
          <input type="file" class="pr-file-input" accept="image/*,.pdf" data-expense-id="${escapeHtml(r.id)}" />
        </label>
        <button class="pr-entry-del" data-pr-action="delete-entry" data-entry-id="${escapeHtml(r.id)}" data-entry-table="expense_entries" aria-label="מחק">✕</button>
      ` : ''}
    </div>
  `).join('');

  const attachRows = attachments.map(a => `
    <div class="pr-attachment-row">
      <span class="pr-attachment-name">${escapeHtml(a.file_name)}</span>
      <button class="pr-btn pr-btn--ghost pr-btn--sm" data-pr-action="view-attachment" data-storage-path="${escapeHtml(a.storage_path)}">צפה</button>
      ${editable ? `<button class="pr-btn pr-btn--ghost pr-btn--sm pr-btn--danger" data-pr-action="delete-attachment" data-attachment-id="${escapeHtml(a.id)}" data-storage-path="${escapeHtml(a.storage_path)}">מחק</button>` : ''}
    </div>
  `).join('');

  const addTravelForm = editable ? `
    <details class="pr-add-form-wrap" id="pr-add-travel-wrap">
      <summary class="pr-add-summary">+ הוסף נסיעה בהצהרה</summary>
      <form class="pr-add-form" id="pr-add-travel-form" data-form-type="declared_travel">
        <div class="pr-form-row">
          <div class="pr-field"><label class="pr-label">תאריך</label><input class="pr-input" type="date" name="travel_date" required /></div>
          <div class="pr-field"><label class="pr-label">נקודת התחלה</label><input class="pr-input" type="text" name="origin" required placeholder="מ..." /></div>
          <div class="pr-field"><label class="pr-label">יעד</label><input class="pr-input" type="text" name="destination" required placeholder="ל..." /></div>
        </div>
        <div class="pr-form-row">
          <div class="pr-field"><label class="pr-label">פירוט</label><input class="pr-input" type="text" name="description" placeholder="תיאור הנסיעה" /></div>
          <div class="pr-field"><label class="pr-label">ק"מ הלוך-חזור</label><input class="pr-input" type="number" name="roundtrip_km" min="0" step="0.1" required placeholder="0" /></div>
          <div class="pr-field"><label class="pr-label">סכום ₪</label><input class="pr-input" type="number" name="amount" min="0" step="0.01" required placeholder="0.00" /></div>
        </div>
        <button class="pr-btn pr-btn--primary" type="submit">הוסף</button>
      </form>
    </details>
  ` : '';

  const addTransportForm = editable ? `
    <details class="pr-add-form-wrap" id="pr-add-transport-wrap">
      <summary class="pr-add-summary">+ הוסף נסיעה בתחבורה ציבורית</summary>
      <form class="pr-add-form" id="pr-add-transport-form" data-form-type="public_transport">
        <div class="pr-form-row">
          <div class="pr-field"><label class="pr-label">תאריך</label><input class="pr-input" type="date" name="travel_date" required /></div>
          <div class="pr-field"><label class="pr-label">ממקום</label><input class="pr-input" type="text" name="origin" required placeholder="מ..." /></div>
          <div class="pr-field"><label class="pr-label">למקום</label><input class="pr-input" type="text" name="destination" required placeholder="ל..." /></div>
        </div>
        <div class="pr-form-row">
          <div class="pr-field"><label class="pr-label">פירוט</label><input class="pr-input" type="text" name="description" placeholder="תיאור" /></div>
          <div class="pr-field"><label class="pr-label">סכום ₪</label><input class="pr-input" type="number" name="amount" min="0" step="0.01" required placeholder="0.00" /></div>
        </div>
        <button class="pr-btn pr-btn--primary" type="submit">הוסף</button>
      </form>
    </details>
  ` : '';

  const addExpenseForm = editable ? `
    <details class="pr-add-form-wrap" id="pr-add-expense-wrap">
      <summary class="pr-add-summary">+ הוסף הוצאה</summary>
      <form class="pr-add-form" id="pr-add-expense-form" data-form-type="expense">
        <div class="pr-form-row">
          <div class="pr-field"><label class="pr-label">תאריך</label><input class="pr-input" type="date" name="expense_date" required /></div>
          <div class="pr-field">
            <label class="pr-label">סוג מסמך</label>
            <select class="pr-input pr-input--select" name="document_type" required>
              <option value="receipt">קבלה</option>
              <option value="invoice">חשבונית</option>
              <option value="other">אחר</option>
            </select>
          </div>
        </div>
        <div class="pr-form-row">
          <div class="pr-field pr-field--wide"><label class="pr-label">פירוט</label><input class="pr-input" type="text" name="description" required placeholder="תיאור ההוצאה" /></div>
          <div class="pr-field"><label class="pr-label">סכום ₪</label><input class="pr-input" type="number" name="amount" min="0" step="0.01" required placeholder="0.00" /></div>
        </div>
        <button class="pr-btn pr-btn--primary" type="submit">הוסף</button>
      </form>
    </details>
  ` : '';

  const financeNotes = report.finance_notes
    ? `<div class="pr-finance-notes"><strong>הערות כספים:</strong> ${escapeHtml(report.finance_notes)}</div>`
    : '';

  const submitBtn = editable
    ? `<button class="pr-btn pr-btn--primary pr-btn--large" data-pr-action="submit-report" data-report-id="${escapeHtml(report.id)}">שליחה לכספים</button>`
    : '';

  return `
    <div class="pr-screen" dir="rtl">
      <div class="pr-topbar">
        <button class="pr-btn pr-btn--ghost pr-back-btn" data-pr-action="back-to-my-reports">← חזרה לדוחות שלי</button>
        <span class="pr-topbar__title">דוח ${escapeHtml(monthYearLabel)}</span>
        ${statusChip}
      </div>

      <div class="pr-body">
        ${financeNotes}

        <div class="pr-card">
          <div class="pr-card__head">
            <h2 class="pr-card__title">נסיעות בהצהרה</h2>
            <span class="pr-card__total">₪${fmt(totalTravel)}</span>
          </div>
          ${travel.length === 0 && !editable ? dsEmptyState('אין רשומות') : ''}
          ${travelRows}
          ${addTravelForm}
        </div>

        <div class="pr-card">
          <div class="pr-card__head">
            <h2 class="pr-card__title">תחבורה ציבורית</h2>
            <span class="pr-card__total">₪${fmt(totalTransport)}</span>
          </div>
          ${transport.length === 0 && !editable ? dsEmptyState('אין רשומות') : ''}
          ${transportRows}
          ${addTransportForm}
        </div>

        <div class="pr-card">
          <div class="pr-card__head">
            <h2 class="pr-card__title">הוצאות</h2>
            <span class="pr-card__total">₪${fmt(totalExpenses)}</span>
          </div>
          ${expenses.length === 0 && !editable ? dsEmptyState('אין רשומות') : ''}
          ${expenseRows}
          ${addExpenseForm}
        </div>

        ${attachments.length > 0 ? `
          <div class="pr-card">
            <div class="pr-card__head"><h2 class="pr-card__title">קבצים מצורפים</h2></div>
            ${attachRows}
          </div>
        ` : ''}

        <div class="pr-card pr-card--summary">
          <h2 class="pr-card__title">סיכום חודשי</h2>
          <div class="pr-summary-row"><span>נסיעות בהצהרה</span><strong>₪${fmt(totalTravel)}</strong></div>
          <div class="pr-summary-row"><span>תחבורה ציבורית</span><strong>₪${fmt(totalTransport)}</strong></div>
          <div class="pr-summary-row"><span>הוצאות</span><strong>₪${fmt(totalExpenses)}</strong></div>
          <div class="pr-summary-row pr-summary-row--total"><span>סה"כ לתשלום / החזר</span><strong>₪${fmt(totalAll)}</strong></div>
          <div class="pr-summary-status">סטטוס: ${statusChip}</div>
        </div>

        <div class="pr-actions">
          ${submitBtn}
        </div>
      </div>
    </div>
  `;
}

function adminDashboardHtml(reports) {
  const rows = reports.map(r => {
    const profile = r.profiles || {};
    return `
      <tr>
        <td>${escapeHtml(profile.full_name || '—')}</td>
        <td>${escapeHtml(profile.email || '—')}</td>
        <td>${escapeHtml(monthLabel(r.report_month, r.report_year))}</td>
        <td>${dsStatusChip(STATUS_LABELS[r.status] || r.status, STATUS_KIND[r.status] || 'neutral')}</td>
        <td>${r.submitted_at ? fmtDate(r.submitted_at) : '—'}</td>
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
        ${reports.length === 0 ? dsEmptyState('אין דוחות להצגה') : `
          <div class="pr-table-scroll">
            <table class="pr-table">
              <thead>
                <tr>
                  <th>שם עובד</th>
                  <th>מייל</th>
                  <th>חודש</th>
                  <th>סטטוס</th>
                  <th>תאריך שליחה</th>
                  <th>הערות כספים</th>
                  <th>פעולות</th>
                </tr>
              </thead>
              <tbody>${rows.join('')}</tbody>
            </table>
          </div>
        `}
      </div>
    </div>
  `;
}

function adminReportViewHtml(report, travel, transport, expenses, attachments) {
  const profile = report.profiles || {};
  const totalTravel = travel.reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalTransport = transport.reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalExpenses = expenses.reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalAll = totalTravel + totalTransport + totalExpenses;

  const travelRows = travel.map(r => `
    <tr><td>${fmtDate(r.travel_date)}</td><td>${escapeHtml(r.origin)}</td><td>${escapeHtml(r.destination)}</td>
    <td>${escapeHtml(r.description)}</td><td>${r.roundtrip_km}</td><td>₪${fmt(r.amount)}</td></tr>
  `).join('');

  const transportRows = transport.map(r => `
    <tr><td>${fmtDate(r.travel_date)}</td><td>${escapeHtml(r.origin)}</td><td>${escapeHtml(r.destination)}</td>
    <td>${escapeHtml(r.description)}</td><td>₪${fmt(r.amount)}</td></tr>
  `).join('');

  const expenseRows = expenses.map(r => `
    <tr><td>${fmtDate(r.expense_date)}</td><td>${escapeHtml(DOC_TYPE_LABELS[r.document_type] || r.document_type)}</td>
    <td>${escapeHtml(r.description)}</td><td>₪${fmt(r.amount)}</td></tr>
  `).join('');

  const attachRows = attachments.map(a => `
    <div class="pr-attachment-row">
      <span class="pr-attachment-name">${escapeHtml(a.file_name)}</span>
      <button class="pr-btn pr-btn--ghost pr-btn--sm" data-pr-action="view-attachment" data-storage-path="${escapeHtml(a.storage_path)}">הורד / צפה</button>
    </div>
  `).join('');

  const notesForm = `
    <div class="pr-card" style="margin-top:16px">
      <h2 class="pr-card__title">הערות כספים</h2>
      <textarea class="pr-input" id="pr-admin-notes" rows="3" placeholder="הוסף הערה…">${escapeHtml(report.finance_notes || '')}</textarea>
      <button class="pr-btn pr-btn--primary" data-pr-action="admin-save-notes" data-report-id="${escapeHtml(report.id)}" style="margin-top:8px">שמור הערות</button>
    </div>
  `;

  const adminActions = `
    <div class="pr-actions">
      ${report.status === 'submitted' ? `
        <button class="pr-btn pr-btn--primary" data-pr-action="admin-approve" data-report-id="${escapeHtml(report.id)}">אשר דוח</button>
        <button class="pr-btn pr-btn--warning" data-pr-action="admin-return" data-report-id="${escapeHtml(report.id)}">החזר לתיקון</button>
      ` : ''}
      ${report.status === 'approved' ? `
        <button class="pr-btn pr-btn--primary" data-pr-action="admin-mark-paid" data-report-id="${escapeHtml(report.id)}">סמן כשולם</button>
      ` : ''}
    </div>
  `;

  return `
    <div class="pr-screen" dir="rtl">
      <div class="pr-topbar">
        <button class="pr-btn pr-btn--ghost pr-back-btn" data-pr-action="back-to-admin">← חזרה לרשימה</button>
        <span class="pr-topbar__title">דוח ${escapeHtml(monthLabel(report.report_month, report.report_year))} — ${escapeHtml(profile.full_name || profile.email || '')}</span>
        ${dsStatusChip(STATUS_LABELS[report.status] || report.status, STATUS_KIND[report.status] || 'neutral')}
      </div>
      <div class="pr-body">
        ${travel.length > 0 ? `
          <div class="pr-card">
            <div class="pr-card__head"><h2 class="pr-card__title">נסיעות בהצהרה</h2><span class="pr-card__total">₪${fmt(totalTravel)}</span></div>
            <div class="pr-table-scroll">
              <table class="pr-table"><thead><tr><th>תאריך</th><th>מ</th><th>ל</th><th>פירוט</th><th>ק"מ</th><th>סכום</th></tr></thead>
              <tbody>${travelRows}</tbody></table>
            </div>
          </div>
        ` : ''}
        ${transport.length > 0 ? `
          <div class="pr-card">
            <div class="pr-card__head"><h2 class="pr-card__title">תחבורה ציבורית</h2><span class="pr-card__total">₪${fmt(totalTransport)}</span></div>
            <div class="pr-table-scroll">
              <table class="pr-table"><thead><tr><th>תאריך</th><th>מ</th><th>ל</th><th>פירוט</th><th>סכום</th></tr></thead>
              <tbody>${transportRows}</tbody></table>
            </div>
          </div>
        ` : ''}
        ${expenses.length > 0 ? `
          <div class="pr-card">
            <div class="pr-card__head"><h2 class="pr-card__title">הוצאות</h2><span class="pr-card__total">₪${fmt(totalExpenses)}</span></div>
            <div class="pr-table-scroll">
              <table class="pr-table"><thead><tr><th>תאריך</th><th>סוג</th><th>פירוט</th><th>סכום</th></tr></thead>
              <tbody>${expenseRows}</tbody></table>
            </div>
          </div>
        ` : ''}
        ${attachments.length > 0 ? `
          <div class="pr-card">
            <div class="pr-card__head"><h2 class="pr-card__title">קבצים מצורפים</h2></div>
            ${attachRows}
          </div>
        ` : ''}
        <div class="pr-card pr-card--summary">
          <h2 class="pr-card__title">סיכום</h2>
          <div class="pr-summary-row"><span>נסיעות בהצהרה</span><strong>₪${fmt(totalTravel)}</strong></div>
          <div class="pr-summary-row"><span>תחבורה ציבורית</span><strong>₪${fmt(totalTransport)}</strong></div>
          <div class="pr-summary-row"><span>הוצאות</span><strong>₪${fmt(totalExpenses)}</strong></div>
          <div class="pr-summary-row pr-summary-row--total"><span>סה"כ</span><strong>₪${fmt(totalAll)}</strong></div>
        </div>
        ${notesForm}
        ${adminActions}
      </div>
    </div>
  `;
}

function myReportsListHtml(reports) {
  if (!reports || reports.length === 0) {
    return `<p class="pr-empty-msg">עדיין לא קיימים דוחות. פתח חודש חדש למעלה כדי להתחיל.</p>`;
  }
  return reports.map(r => `
    <div class="pr-report-card" data-pr-action="open-existing-report" data-report-id="${escapeHtml(r.id)}">
      <div class="pr-report-card__title">${escapeHtml(monthLabel(r.report_month, r.report_year))}</div>
      <div class="pr-report-card__meta">
        ${dsStatusChip(STATUS_LABELS[r.status] || r.status, STATUS_KIND[r.status] || 'neutral')}
        ${r.submitted_at ? `<span class="pr-report-card__date">נשלח: ${fmtDate(r.submitted_at)}</span>` : ''}
      </div>
    </div>
  `).join('');
}

// ─── main render & bind ───────────────────────────────────────────────────────

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

async function openReportDetail(root, reportId, isAdmin = false) {
  const report = await fetchReport(reportId);
  // For admin view, get profile info too
  if (isAdmin) {
    const { data: profileData } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('id', report.employee_id)
      .single();
    report.profiles = profileData;
  }
  const [travel, transport, expenses, attachments] = await Promise.all([
    fetchDeclaredTravel(reportId),
    fetchPublicTransport(reportId),
    fetchExpenses(reportId),
    fetchAttachments(reportId)
  ]);
  prSelectedReport = report;

  if (isAdmin) {
    renderInto(root, adminReportViewHtml(report, travel, transport, expenses, attachments));
    bindAdminReportView(root);
  } else {
    renderInto(root, reportDetailHtml(report, travel, transport, expenses, attachments, prSession.profile));
    bindReportDetail(root);
  }
}

function bindLoginForm(root) {
  const form = root.querySelector('#pr-login-form');
  const forgotBtn = root.querySelector('#pr-forgot-btn');

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = root.querySelector('#pr-email')?.value?.trim();
      const pass = root.querySelector('#pr-pass')?.value;
      if (!email || !pass) return;
      const btn = root.querySelector('#pr-login-btn');
      btn.disabled = true;
      btn.textContent = 'מתחבר…';
      try {
        const { user } = await signIn(email, pass);
        const profile = await getProfile(user.id);
        prSession = { user, profile };
        prView = profile.role === 'admin' ? 'admin' : 'employee';
        await rerender(root);
      } catch (err) {
        renderInto(root, loginHtml(err.message || 'שגיאה בהתחברות. בדוק פרטים ונסה שוב.'));
        bindLoginForm(root);
      }
    });
  }

  if (forgotBtn) {
    forgotBtn.addEventListener('click', async () => {
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
}

function bindEmployeeDashboard(root) {
  root.querySelector('[data-pr-action="open-report"]')?.addEventListener('click', async () => {
    const sel = root.querySelector('#pr-month-select');
    const [month, year] = (sel?.value || '').split('-').map(Number);
    if (!month || !year) return;
    try {
      const report = await getOrCreateReport(prSession.user.id, month, year);
      prSelectedReport = report;
      await openReportDetail(root, report.id, false);
    } catch (err) {
      showToast(err.message || 'שגיאה בפתיחת הדוח', 'danger');
    }
  });

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pr-action]');
    if (!btn) return;
    const action = btn.dataset.prAction;
    if (action === 'back-to-dashboard') {
      dispatchBackToDashboard();
    } else if (action === 'sign-out') {
      handleSignOut(root);
    } else if (action === 'open-existing-report') {
      const rid = btn.dataset.reportId;
      if (rid) openReportDetail(root, rid, false);
    }
  });

  if (prSession?.user?.id) {
    loadMyReportsList(root, prSession.user.id);
  }
}

function bindReportDetail(root) {
  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-pr-action]');
    if (!btn) return;
    const action = btn.dataset.prAction;

    if (action === 'back-to-my-reports') {
      prView = 'employee';
      await rerender(root);
      return;
    }
    if (action === 'back-to-dashboard') {
      dispatchBackToDashboard(); return;
    }
    if (action === 'sign-out') {
      await handleSignOut(root); return;
    }

    if (action === 'delete-entry') {
      if (!confirm('למחוק רשומה זו?')) return;
      try {
        await deleteEntry(btn.dataset.entryTable, btn.dataset.entryId);
        await openReportDetail(root, prSelectedReport.id, false);
        showToast('נמחק', 'success');
      } catch (err) { showToast(err.message, 'danger'); }
      return;
    }

    if (action === 'submit-report') {
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
      if (!confirm('למחוק קובץ זה?')) return;
      try {
        await deleteAttachment({ id: btn.dataset.attachmentId, storage_path: btn.dataset.storagePath });
        await openReportDetail(root, prSelectedReport.id, false);
        showToast('קובץ נמחק', 'success');
      } catch (err) { showToast(err.message, 'danger'); }
      return;
    }
  });

  // File upload handlers
  root.addEventListener('change', async (e) => {
    const fileInput = e.target.closest('input[type="file"].pr-file-input');
    if (!fileInput || !fileInput.files?.[0]) return;
    const file = fileInput.files[0];
    const expenseEntryId = fileInput.dataset.expenseId || null;
    try {
      await uploadAttachment(prSelectedReport.id, prSession.user.id, expenseEntryId, file);
      await openReportDetail(root, prSelectedReport.id, false);
      showToast('הקובץ הועלה', 'success');
    } catch (err) { showToast(err.message || 'שגיאה בהעלאה', 'danger'); }
  });

  // Add entry forms
  root.addEventListener('submit', async (e) => {
    const form = e.target.closest('.pr-add-form');
    if (!form) return;
    e.preventDefault();
    const formType = form.dataset.formType;
    const fd = new FormData(form);
    const reportId = prSelectedReport.id;
    const employeeId = prSession.user.id;
    try {
      if (formType === 'declared_travel') {
        await upsertDeclaredTravel({
          report_id: reportId,
          employee_id: employeeId,
          travel_date: fd.get('travel_date'),
          origin: fd.get('origin') || '',
          destination: fd.get('destination') || '',
          description: fd.get('description') || '',
          roundtrip_km: Number(fd.get('roundtrip_km') || 0),
          amount: Number(fd.get('amount') || 0)
        });
      } else if (formType === 'public_transport') {
        await upsertPublicTransport({
          report_id: reportId,
          employee_id: employeeId,
          travel_date: fd.get('travel_date'),
          origin: fd.get('origin') || '',
          destination: fd.get('destination') || '',
          description: fd.get('description') || '',
          amount: Number(fd.get('amount') || 0)
        });
      } else if (formType === 'expense') {
        await upsertExpense({
          report_id: reportId,
          employee_id: employeeId,
          expense_date: fd.get('expense_date'),
          document_type: fd.get('document_type') || 'receipt',
          description: fd.get('description') || '',
          amount: Number(fd.get('amount') || 0)
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

    if (action === 'admin-view-report' && reportId) {
      await openReportDetail(root, reportId, true);
      return;
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
      const notes = prompt('הסבר לעובד (יופיע כהערת כספים):');
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

    if (action === 'back-to-admin') {
      prView = 'admin';
      await rerender(root);
      return;
    }
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

function dispatchBackToDashboard() {
  document.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: 'dashboard' } }));
}

async function handleSignOut(root) {
  await signOut();
  prSession = null;
  prView = 'login';
  prSelectedReport = null;
  renderInto(root, loginHtml());
  bindLoginForm(root);
}

async function rerender(root) {
  if (!prSession) {
    renderInto(root, loginHtml());
    bindLoginForm(root);
    return;
  }
  if (prSession.profile.role === 'admin') {
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
  /** Called by main.js routing — no data fetch needed, screen manages its own auth */
  load: () => Promise.resolve({}),

  render(_data, _ctx) {
    return `<div id="pr-root" class="pr-module-root" dir="rtl"><div class="pr-loading-placeholder">טוען…</div></div>`;
  },

  bind({ root } = {}) {
    const prRoot = (root && root.querySelector('#pr-root')) || root;

    // Try restoring existing Supabase session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        try {
          const profile = await getProfile(session.user.id);
          prSession = { user: session.user, profile };
          prView = profile.role === 'admin' ? 'admin' : 'employee';
          await rerender(prRoot);
        } catch {
          prSession = null;
          renderInto(prRoot, loginHtml());
          bindLoginForm(prRoot);
        }
      } else {
        renderInto(prRoot, loginHtml());
        bindLoginForm(prRoot);
      }
    }).catch(() => {
      renderInto(prRoot, loginHtml());
      bindLoginForm(prRoot);
    });

  }
};
