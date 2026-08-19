import { state } from './state.js';
import { api } from './api.js';
import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';
import { escapeHtml } from './screens/shared/html.js';

const ADMIN_ROLE = 'admin';
const LEGACY_MANAGER_TAB = 'payroll-attendance';
const MANAGER_TAB_STORAGE_KEY = 'manager_board_workspace_tab';
const PENDING_MANAGER_TAB_KEY = 'admin_management_pending_manager_tab';
const STANDALONE_ATTRIBUTE = 'data-admin-attendance-standalone';
const STYLE_ID = 'admin-attendance-standalone-style';
const HIDDEN_CLASS = 'is-admin-attendance-hidden';

let renderToken = 0;

function text(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function isAdmin() {
  return text(state?.user?.role || state?.user?.display_role) === ADMIN_ROLE;
}

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function isActiveEmployee(row = {}) {
  if (row.active === false || row.is_active === false) return false;
  const value = text(row.active ?? row.is_active).toLowerCase();
  return !['false', '0', 'no', 'לא', 'inactive', 'לא פעיל'].includes(value);
}

function employeeId(row = {}) {
  return text(row.emp_id || row.employee_id || row.employeeId);
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .${HIDDEN_CLASS} { display: none !important; }
    [data-manager-workspace-tab="${LEGACY_MANAGER_TAB}"] { display: none !important; }
    .admin-attendance-standalone { width: min(100%, 1280px); margin-inline: auto; direction: rtl; }
    .admin-attendance-standalone__top { display:flex; align-items:flex-start; justify-content:space-between; gap:18px; margin-bottom:18px; }
    .admin-attendance-standalone__title-wrap { display:flex; align-items:flex-start; gap:12px; min-width:0; }
    .admin-attendance-standalone__back { appearance:none; border:1px solid var(--color-border,#dbe3ec); background:var(--color-surface,#fff); color:var(--color-text,#172033); border-radius:10px; padding:8px 11px; cursor:pointer; font:inherit; }
    .admin-attendance-standalone__top h1 { margin:0 0 4px; font-size:26px; line-height:1.2; }
    .admin-attendance-standalone__top p { margin:0; color:var(--color-text-secondary,#64748b); font-size:13px; }
    .admin-attendance-standalone__tools { display:flex; align-items:end; gap:8px; flex-wrap:wrap; }
    .admin-attendance-standalone__month { display:grid; gap:4px; font-size:12px; color:var(--color-text-secondary,#64748b); }
    .admin-attendance-standalone__month input { min-height:38px; border:1px solid var(--color-border,#dbe3ec); border-radius:10px; padding:6px 10px; background:var(--color-surface,#fff); color:var(--color-text,#172033); font:inherit; }
    .admin-attendance-standalone__refresh { min-height:38px; border:1px solid var(--color-border,#dbe3ec); border-radius:10px; padding:7px 13px; background:var(--color-surface,#fff); color:var(--color-text,#172033); cursor:pointer; font:inherit; }
    .admin-attendance-standalone__summary { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin-bottom:18px; }
    .admin-attendance-standalone__summary article { border:1px solid var(--color-border,#dbe3ec); border-radius:14px; padding:14px 16px; background:var(--color-surface,#fff); }
    .admin-attendance-standalone__summary span { display:block; color:var(--color-text-secondary,#64748b); font-size:12px; margin-bottom:5px; }
    .admin-attendance-standalone__summary strong { font-size:22px; }
    .admin-attendance-team { border:1px solid var(--color-border,#dbe3ec); border-radius:16px; background:var(--color-surface,#fff); margin-bottom:14px; overflow:hidden; }
    .admin-attendance-team__head { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px 16px; border-bottom:1px solid var(--color-border,#e5e7eb); background:var(--color-surface-muted,#f8fafc); }
    .admin-attendance-team__head h2 { margin:0; font-size:16px; }
    .admin-attendance-team__head span { color:var(--color-text-secondary,#64748b); font-size:12px; }
    .admin-attendance-table-wrap { overflow:auto; }
    .admin-attendance-table { width:100%; border-collapse:collapse; min-width:900px; }
    .admin-attendance-table th,.admin-attendance-table td { text-align:right; padding:11px 13px; border-bottom:1px solid var(--color-border,#edf1f5); vertical-align:middle; font-size:13px; }
    .admin-attendance-table th { color:var(--color-text-secondary,#64748b); font-size:12px; font-weight:700; background:rgba(248,250,252,.65); }
    .admin-attendance-table tr:last-child td { border-bottom:0; }
    .admin-attendance-person strong,.admin-attendance-approval strong { display:block; font-size:13px; }
    .admin-attendance-person small,.admin-attendance-approval small { display:block; margin-top:2px; color:var(--color-text-secondary,#64748b); font-size:11px; }
    .admin-attendance-status { display:inline-flex; align-items:center; border-radius:999px; padding:5px 8px; font-size:11px; font-weight:700; background:#f1f5f9; color:#475569; white-space:nowrap; }
    .admin-attendance-status.is-ok { background:#ecfdf3; color:#166534; }
    .admin-attendance-status.is-pending { background:#fff7ed; color:#9a3412; }
    .admin-attendance-actions { display:flex; gap:6px; flex-wrap:wrap; }
    .admin-attendance-actions button { border:1px solid var(--color-border,#dbe3ec); border-radius:8px; padding:6px 9px; background:var(--color-surface,#fff); color:var(--color-text,#172033); cursor:pointer; font:inherit; font-size:11px; white-space:nowrap; }
    .admin-attendance-actions button.is-primary { background:var(--color-primary,#2563eb); border-color:var(--color-primary,#2563eb); color:#fff; }
    .admin-attendance-actions button:disabled { opacity:.55; cursor:wait; }
    .admin-attendance-message { margin:0 0 12px; padding:10px 12px; border-radius:10px; background:#ecfdf3; color:#166534; font-size:12px; }
    .admin-attendance-message.is-error { background:#fef2f2; color:#b91c1c; }
    .admin-attendance-loading,.admin-attendance-empty { border:1px solid var(--color-border,#dbe3ec); border-radius:14px; background:var(--color-surface,#fff); padding:28px; text-align:center; color:var(--color-text-secondary,#64748b); }
    @media (max-width:900px) { .admin-attendance-standalone__summary { grid-template-columns:repeat(2,minmax(0,1fr)); } .admin-attendance-standalone__top { flex-direction:column; } }
    @media (max-width:620px) { .admin-attendance-standalone__summary { grid-template-columns:1fr 1fr; gap:8px; } .admin-attendance-standalone__top h1 { font-size:22px; } }
  `;
  document.head.append(style);
}

function patchAdminHubTile() {
  if (!isAdmin()) return;
  document.querySelectorAll(`[data-admin-hub-manager-tab="${LEGACY_MANAGER_TAB}"]`).forEach((button) => {
    button.removeAttribute('data-admin-hub-manager-tab');
    button.removeAttribute('data-manager-board-open');
    button.setAttribute('data-admin-attendance-open', 'true');
  });
  try { sessionStorage.removeItem(PENDING_MANAGER_TAB_KEY); } catch { /* ignore */ }
}

function separateFromManagerBoard() {
  document.querySelectorAll(`[data-manager-workspace-tab="${LEGACY_MANAGER_TAB}"]`).forEach((button) => button.remove());
  if (!isAdmin()) return;
  let stored = '';
  try { stored = text(localStorage.getItem(MANAGER_TAB_STORAGE_KEY)); } catch { /* ignore */ }
  if (stored !== LEGACY_MANAGER_TAB) return;
  try { localStorage.setItem(MANAGER_TAB_STORAGE_KEY, 'management'); } catch { /* ignore */ }
  const managementButton = document.querySelector('[data-manager-board-root] [data-manager-workspace-tab="management"]');
  if (managementButton && !managementButton.classList.contains('is-active')) managementButton.click();
}

async function ensureAuth() {
  await waitForSupabaseAuthSession({ timeoutMs: 7000 }).catch(() => null);
}

async function loadEmployees() {
  if (!supabase) throw new Error('חיבור הנתונים אינו זמין.');
  await ensureAuth();
  const { data, error } = await supabase
    .from('contacts_instructors')
    .select('emp_id,full_name,direct_manager,active,employment_type')
    .order('direct_manager', { ascending: true, nullsFirst: false })
    .order('full_name', { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message || 'טעינת העובדים נכשלה.');
  const byId = new Map();
  for (const row of Array.isArray(data) ? data : []) {
    const id = employeeId(row);
    if (!id || !isActiveEmployee(row) || byId.has(id)) continue;
    byId.set(id, row);
  }
  return [...byId.values()];
}

function workflowStatus(row = {}, finalApproval = null) {
  const raw = text(row.workflow_status || row.status || 'not_submitted');
  if (finalApproval || raw === 'approved') return { raw: 'approved', label: '✓ אושר סופית · מוכן לשכר', cls: 'is-ok' };
  if (raw === 'manager_approved') return { raw, label: 'אושר על ידי המנהל', cls: 'is-pending' };
  if (raw === 'submitted') return { raw, label: 'אושר על ידי העובד · בבקרת מנהל', cls: 'is-pending' };
  return { raw: 'not_submitted', label: 'פתוח לדיווח', cls: '' };
}

function approvalCell(name, at, missingLabel) {
  const who = text(name);
  const when = at ? new Date(at).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : '';
  if (!who && !when) return `<span class="admin-attendance-status">${escapeHtml(missingLabel)}</span>`;
  return `<div class="admin-attendance-approval"><strong>${escapeHtml(who || '—')}</strong><small>${escapeHtml(when || '—')}</small></div>`;
}

function groupEmployees(employees) {
  const groups = new Map();
  for (const employee of employees) {
    const manager = text(employee.direct_manager) || 'ללא מנהל משויך';
    if (!groups.has(manager)) groups.set(manager, []);
    groups.get(manager).push(employee);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, 'he'));
}

function actionButtons(empId, workflowRow, finalApproval) {
  const status = workflowStatus(workflowRow, finalApproval);
  const finalButton = status.raw === 'manager_approved' && !finalApproval
    ? `<button type="button" class="is-primary" data-admin-attendance-final="${escapeHtml(empId)}">אישור סופי</button>`
    : '';
  const managerPdfUrl = text(workflowRow.manager_pdf_sharepoint_url);
  const finalPdfPath = text(finalApproval?.pdf_path);
  const pdfButton = managerPdfUrl || finalPdfPath
    ? `<button type="button" data-admin-attendance-pdf="${escapeHtml(empId)}">צפייה ב-PDF</button>`
    : '';
  const releaseButton = ['submitted', 'manager_approved', 'approved'].includes(status.raw)
    ? `<button type="button" data-admin-attendance-release="${escapeHtml(empId)}">שחרור נעילה</button>`
    : '';
  return `<div class="admin-attendance-actions">${finalButton}${pdfButton}${releaseButton}</div>`;
}

function summaryHtml(employees, workflowByEmployee, finalByEmployee) {
  let employeeApproved = 0;
  let managerApproved = 0;
  let finalApproved = 0;
  for (const employee of employees) {
    const id = employeeId(employee);
    const workflow = workflowByEmployee.get(id) || {};
    if (workflow.submitted_at) employeeApproved += 1;
    if (workflow.manager_approved_at) managerApproved += 1;
    if (finalByEmployee.has(id) || text(workflow.workflow_status) === 'approved') finalApproved += 1;
  }
  return `<div class="admin-attendance-standalone__summary">
    <article><span>עובדים פעילים</span><strong>${employees.length}</strong></article>
    <article><span>אישור עובד</span><strong>${employeeApproved}</strong></article>
    <article><span>אישור מנהל</span><strong>${managerApproved}</strong></article>
    <article><span>מוכן לשכר</span><strong>${finalApproved}</strong></article>
  </div>`;
}

function groupsHtml(employees, workflowByEmployee, finalByEmployee, monthKey) {
  return groupEmployees(employees).map(([manager, rows]) => {
    const body = rows.map((employee) => {
      const id = employeeId(employee);
      const workflow = workflowByEmployee.get(id) || {};
      const finalApproval = finalByEmployee.get(id) || null;
      const status = workflowStatus(workflow, finalApproval);
      return `<tr data-admin-attendance-row="${escapeHtml(id)}">
        <td class="admin-attendance-person"><strong>${escapeHtml(text(employee.full_name) || id)}</strong><small>${escapeHtml(id)}${text(employee.employment_type) ? ` · ${escapeHtml(text(employee.employment_type))}` : ''}</small></td>
        <td>${approvalCell(workflow.submitted_by_name, workflow.submitted_at, 'טרם אושר עובד')}</td>
        <td>${approvalCell(workflow.manager_approved_by_name, workflow.manager_approved_at, 'טרם אושר מנהל')}</td>
        <td>${approvalCell(finalApproval?.approved_by_name, finalApproval?.approved_at, 'טרם אושר סופית')}</td>
        <td><span class="admin-attendance-status ${status.cls}">${escapeHtml(status.label)}</span></td>
        <td>${actionButtons(id, workflow, finalApproval)}</td>
      </tr>`;
    }).join('');
    return `<section class="admin-attendance-team">
      <header class="admin-attendance-team__head"><h2>${escapeHtml(manager)}</h2><span>${rows.length} עובדים · ${escapeHtml(monthKey)}</span></header>
      <div class="admin-attendance-table-wrap"><table class="admin-attendance-table">
        <thead><tr><th>עובד</th><th>אישור עובד</th><th>אישור מנהל</th><th>אישור סופי</th><th>סטטוס</th><th>פעולות</th></tr></thead>
        <tbody>${body}</tbody>
      </table></div>
    </section>`;
  }).join('');
}

function setMessage(root, message = '', isError = false) {
  const target = root?.querySelector('[data-admin-attendance-message]');
  if (!target) return;
  target.hidden = !message;
  target.textContent = message;
  target.classList.toggle('is-error', !!isError);
}

async function renderData(root, monthKey, message = '') {
  if (!root || !isAdmin()) return;
  const token = ++renderToken;
  const body = root.querySelector('[data-admin-attendance-body]');
  if (body) body.innerHTML = '<div class="admin-attendance-loading">טוען את כלל הצוותים וסטטוסי הנוכחות…</div>';
  setMessage(root, message, false);
  try {
    const employees = await loadEmployees();
    const ids = employees.map(employeeId).filter(Boolean);
    const [workflowRows, finalRows] = await Promise.all([
      api.attendanceControlMonthWorkflowStatuses({ monthKey, employeeIds: ids }),
      api.listPayrollControlApprovals({ monthKey, employeeIds: ids, statuses: ['approved_for_payroll'] })
    ]);
    if (token !== renderToken || !root.isConnected) return;
    const workflowByEmployee = new Map((workflowRows || []).map((row) => [text(row.employee_id || row.employeeId), row]));
    const finalByEmployee = new Map((finalRows || []).map((row) => [text(row.employee_id || row.employeeId), row]));
    root.__adminAttendanceContext = { employees, workflowByEmployee, finalByEmployee, monthKey };
    if (body) body.innerHTML = employees.length
      ? `${summaryHtml(employees, workflowByEmployee, finalByEmployee)}${groupsHtml(employees, workflowByEmployee, finalByEmployee, monthKey)}`
      : '<div class="admin-attendance-empty">לא נמצאו עובדים פעילים להצגה.</div>';
  } catch (error) {
    if (token !== renderToken || !root.isConnected) return;
    if (body) body.innerHTML = '<div class="admin-attendance-empty">לא ניתן לטעון את בקרת הנוכחות כרגע.</div>';
    setMessage(root, error?.message || 'טעינת בקרת הנוכחות נכשלה.', true);
  }
}

async function openPdf(root, empId) {
  const context = root.__adminAttendanceContext || {};
  const workflow = context.workflowByEmployee?.get(empId) || {};
  const finalApproval = context.finalByEmployee?.get(empId) || null;
  const managerPdfUrl = text(workflow.manager_pdf_sharepoint_url);
  if (managerPdfUrl) {
    window.open(managerPdfUrl, '_blank', 'noopener');
    return;
  }
  const finalPdfPath = text(finalApproval?.pdf_path);
  if (!finalPdfPath) return;
  if (/^https?:\/\//i.test(finalPdfPath)) {
    window.open(finalPdfPath, '_blank', 'noopener');
    return;
  }
  const signed = await api.payrollControlApprovalSignedUrl(finalPdfPath);
  if (signed?.signedUrl) window.open(signed.signedUrl, '_blank', 'noopener');
}

async function handleAction(button, root) {
  const monthKey = text(root.querySelector('[data-admin-attendance-month]')?.value) || currentMonthKey();
  const finalEmpId = text(button.dataset.adminAttendanceFinal);
  const releaseEmpId = text(button.dataset.adminAttendanceRelease);
  const pdfEmpId = text(button.dataset.adminAttendancePdf);
  if (pdfEmpId) {
    try { await openPdf(root, pdfEmpId); } catch (error) { setMessage(root, error?.message || 'פתיחת ה-PDF נכשלה.', true); }
    return;
  }
  if (!finalEmpId && !releaseEmpId) return;
  button.disabled = true;
  try {
    if (finalEmpId) {
      setMessage(root, 'שומר אישור סופי…');
      await api.adminFinalizeAttendanceMonthPayroll({
        employee_id: finalEmpId,
        month_key: monthKey,
        final_approved_by_name: text(state?.user?.full_name || state?.user?.name || state?.user?.username)
      });
      await renderData(root, monthKey, 'האישור הסופי נשמר. החודש מוכן לשכר.');
      return;
    }
    const reason = window.prompt('סיבת שחרור נעילה (אופציונלי):', '') || '';
    setMessage(root, 'משחרר נעילה…');
    await api.adminReopenAttendanceMonthForCorrection({ employee_id: releaseEmpId, month_key: monthKey, reason });
    await renderData(root, monthKey, 'החודש שוחרר ונפתח לתיקון.');
  } catch (error) {
    setMessage(root, error?.message || 'הפעולה נכשלה.', true);
  } finally {
    button.disabled = false;
  }
}

function standaloneHtml() {
  const monthKey = currentMonthKey();
  return `<section class="admin-attendance-standalone" ${STANDALONE_ATTRIBUTE} dir="rtl">
    <div class="admin-attendance-standalone__top">
      <div class="admin-attendance-standalone__title-wrap">
        <button type="button" class="admin-attendance-standalone__back" data-admin-attendance-back>חזרה לניהול</button>
        <div><h1>בקרת נוכחות אדמין</h1><p>בקרה סופית על כלל העובדים, מקובצים לפי צוות ומנהל.</p></div>
      </div>
      <div class="admin-attendance-standalone__tools">
        <label class="admin-attendance-standalone__month"><span>חודש דיווח</span><input type="month" value="${monthKey}" data-admin-attendance-month></label>
        <button type="button" class="admin-attendance-standalone__refresh" data-admin-attendance-refresh>רענון</button>
      </div>
    </div>
    <p class="admin-attendance-message" data-admin-attendance-message hidden></p>
    <div data-admin-attendance-body></div>
  </section>`;
}

function openStandalone(button) {
  if (!isAdmin()) return;
  ensureStyles();
  const screenRoot = button.closest('#screenRoot') || document.getElementById('screenRoot') || document.getElementById('app');
  if (!screenRoot) return;
  const existing = screenRoot.querySelector(`[${STANDALONE_ATTRIBUTE}]`);
  if (existing) return;
  const hub = screenRoot.querySelector('.admin-management-home');
  if (!hub) return;
  hub.classList.add(HIDDEN_CLASS);
  hub.insertAdjacentHTML('afterend', standaloneHtml());
  const root = screenRoot.querySelector(`[${STANDALONE_ATTRIBUTE}]`);
  void renderData(root, currentMonthKey());
}

function closeStandalone(root) {
  if (!root) return;
  const screenRoot = root.closest('#screenRoot') || document.getElementById('screenRoot') || document.getElementById('app');
  root.remove();
  screenRoot?.querySelector('.admin-management-home')?.classList.remove(HIDDEN_CLASS);
}

function sync() {
  ensureStyles();
  patchAdminHubTile();
  separateFromManagerBoard();
}

function handleClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  const openButton = target.closest('[data-admin-attendance-open]');
  if (openButton) {
    event.preventDefault();
    event.stopImmediatePropagation();
    openStandalone(openButton);
    return;
  }
  const root = target.closest(`[${STANDALONE_ATTRIBUTE}]`);
  if (!root) return;
  if (target.closest('[data-admin-attendance-back]')) {
    event.preventDefault();
    closeStandalone(root);
    return;
  }
  if (target.closest('[data-admin-attendance-refresh]')) {
    const month = text(root.querySelector('[data-admin-attendance-month]')?.value) || currentMonthKey();
    void renderData(root, month);
    return;
  }
  const action = target.closest('[data-admin-attendance-final], [data-admin-attendance-release], [data-admin-attendance-pdf]');
  if (action) void handleAction(action, root);
}

function handleChange(event) {
  const input = event.target instanceof HTMLInputElement ? event.target : null;
  if (!input?.matches('[data-admin-attendance-month]')) return;
  const root = input.closest(`[${STANDALONE_ATTRIBUTE}]`);
  if (!root) return;
  void renderData(root, text(input.value) || currentMonthKey());
}

function start() {
  ensureStyles();
  document.addEventListener('click', handleClick, true);
  document.addEventListener('change', handleChange);
  const observer = new MutationObserver(sync);
  observer.observe(document.getElementById('app') || document.documentElement, { childList: true, subtree: true });
  sync();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
