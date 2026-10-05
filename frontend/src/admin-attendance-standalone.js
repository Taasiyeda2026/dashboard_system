import { state } from './state.js';
import { api } from './api.js';
import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';
import { escapeHtml } from './screens/shared/html.js';
import {
  resolveAdminAttendanceDefaultMonth
} from './screens/attendance-control.js?v=20261005-manager-reopen-hierarchy-v1';

const ADMIN_ROLE = 'admin';
const LEGACY_MANAGER_TAB = 'payroll-attendance';
const MANAGER_TAB_STORAGE_KEY = 'manager_board_workspace_tab';
const PENDING_MANAGER_TAB_KEY = 'admin_management_pending_manager_tab';
const STANDALONE_ATTRIBUTE = 'data-admin-attendance-standalone';
const STYLE_ID = 'admin-attendance-standalone-style';
const HIDDEN_CLASS = 'is-admin-attendance-hidden';
const PENDING_BADGE_ATTR = 'data-admin-attendance-pending-badge';
const PENDING_BADGE_COUNT_ATTR = 'data-admin-attendance-pending-count';

let renderToken = 0;
let pendingSummaryCache = { rows: null, loadedAt: 0, total: 0 };
let pendingSummaryInFlight = null;
let pendingSummaryInvalidated = false;
let pendingSummaryTrailingRefresh = false;
let pendingSummaryRetryAfter = 0;
let syncScheduled = false;
const PENDING_SUMMARY_TTL_MS = 60 * 1000;
const PENDING_SUMMARY_RETRY_BACKOFF_MS = 5 * 1000;

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

function monthMode(monthKey) {
  const current = currentMonthKey();
  if (monthKey === current) return { key: 'current', label: 'בקרה שוטפת' };
  if (monthKey < current) return { key: 'closed', label: 'בקרה ואישור' };
  return { key: 'future', label: 'חודש עתידי' };
}

function isActiveEmployee(row = {}) {
  if (row.active === false || row.is_active === false) return false;
  const value = text(row.active ?? row.is_active).toLowerCase();
  return !['false', '0', 'no', 'לא', 'inactive', 'לא פעיל'].includes(value);
}

function employeeId(row = {}) {
  return text(row.emp_id || row.employee_id || row.employeeId || row.EmployeeId || row.empNum || row.ID || row.id);
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
    .admin-attendance-standalone__top h1 { margin:0; font-size:26px; line-height:1.2; }
    .admin-attendance-standalone__mode { display:inline-flex; margin-top:6px; border-radius:999px; padding:4px 8px; background:#eef2ff; color:#334155; font-size:11px; font-weight:700; }
    .admin-attendance-standalone__tools { display:flex; align-items:end; gap:8px; flex-wrap:wrap; }
    .admin-attendance-standalone__month { display:grid; gap:4px; font-size:12px; color:var(--color-text-secondary,#64748b); }
    .admin-attendance-standalone__month input { min-height:38px; border:1px solid var(--color-border,#dbe3ec); border-radius:10px; padding:6px 10px; background:var(--color-surface,#fff); color:var(--color-text,#172033); font:inherit; }
    .admin-attendance-standalone__refresh { min-height:38px; border:1px solid var(--color-border,#dbe3ec); border-radius:10px; padding:7px 13px; background:var(--color-surface,#fff); color:var(--color-text,#172033); cursor:pointer; font:inherit; }
    .admin-attendance-standalone__control { min-height:38px; border:1px solid var(--color-primary,#2563eb); border-radius:10px; padding:7px 13px; background:var(--color-primary,#2563eb); color:#fff; cursor:pointer; font:inherit; font-weight:700; }
    .admin-attendance-standalone__overview-tools { display:contents; }
    .admin-attendance-standalone.is-control-mode .admin-attendance-standalone__overview-tools { display:none; }
    .admin-attendance-standalone.is-control-mode [data-admin-attendance-body] { display:none; }
    .admin-attendance-standalone__control-host { margin-top:8px; }
    .admin-attendance-standalone:not(.is-control-mode) .admin-attendance-standalone__control-host { display:none; }
    .admin-attendance-standalone__summary-row { display:flex; align-items:stretch; gap:8px; margin-bottom:12px; }
    .admin-attendance-standalone__summary { display:grid; grid-template-columns:repeat(auto-fit,minmax(125px,1fr)); gap:8px; flex:1; margin:0; }
    .admin-attendance-standalone__summary article { border:1px solid var(--color-border,#dbe3ec); border-radius:10px; padding:8px 12px; background:var(--color-surface,#fff); }
    .admin-attendance-standalone__summary span { display:block; color:var(--color-text-secondary,#64748b); font-size:11px; margin-bottom:2px; }
    .admin-attendance-standalone__summary strong { font-size:18px; line-height:1.1; }
    .admin-attendance-standalone__batch { min-width:180px; border:1px solid var(--color-primary,#2563eb); border-radius:10px; padding:8px 14px; background:var(--color-primary,#2563eb); color:#fff; cursor:pointer; font:inherit; font-weight:700; }
    .admin-attendance-standalone__batch:disabled { opacity:.45; cursor:not-allowed; }
    .admin-attendance-team { border:1px solid var(--color-border,#dbe3ec); border-radius:16px; background:var(--color-surface,#fff); margin-bottom:14px; overflow:hidden; }
    .admin-attendance-team__head { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px 16px; border-bottom:1px solid var(--color-border,#e5e7eb); background:var(--color-surface-muted,#f8fafc); }
    .admin-attendance-team__head h2 { margin:0; font-size:16px; }
    .admin-attendance-team__head span { color:var(--color-text-secondary,#64748b); font-size:12px; }
    .admin-attendance-table-wrap { overflow:auto; }
    .admin-attendance-table { width:100%; border-collapse:collapse; table-layout:fixed; min-width:780px; }
    .admin-attendance-table th,.admin-attendance-table td { text-align:right; padding:8px 10px; border-bottom:1px solid var(--color-border,#edf1f5); vertical-align:middle; font-size:13px; }
    .admin-attendance-table th { color:var(--color-text-secondary,#64748b); font-size:12px; font-weight:700; background:rgba(248,250,252,.65); }
    .admin-attendance-table tr:last-child td { border-bottom:0; }
    .admin-attendance-person strong { display:block; font-size:13px; }
    .admin-attendance-person small { display:block; margin-top:2px; color:var(--color-text-secondary,#64748b); font-size:11px; }
    .admin-attendance-status { display:inline; padding:0; border-radius:0; background:transparent; color:#475569; font-size:11px; font-weight:700; white-space:nowrap; }
    .admin-attendance-status.is-ok { background:transparent; color:#166534; }
    .admin-attendance-status.is-pending { background:transparent; color:#9a3412; }
    .admin-attendance-approval-check { appearance:none; border:0; padding:2px 5px; background:transparent; color:#166534; cursor:pointer; font:inherit; font-size:17px; font-weight:800; line-height:1; }
    .admin-attendance-approval-popover { position:fixed; z-index:10020; width:min(260px,calc(100vw - 16px)); padding:10px 12px; border:1px solid var(--color-border,#dbe3ec); border-radius:10px; background:var(--color-surface,#fff); box-shadow:0 8px 24px rgba(15,23,42,.14); color:var(--color-text,#172033); direction:rtl; }
    .admin-attendance-approval-popover strong { display:block; margin-bottom:6px; font-size:13px; }
    .admin-attendance-approval-popover dl { display:grid; grid-template-columns:auto 1fr; gap:4px 8px; margin:0; font-size:12px; }
    .admin-attendance-approval-popover dt { color:var(--color-text-secondary,#64748b); }
    .admin-attendance-approval-popover dd { margin:0; }
    .admin-attendance-actions { display:flex; gap:6px; flex-wrap:wrap; }
    .admin-attendance-actions button { border:1px solid var(--color-border,#dbe3ec); border-radius:8px; padding:6px 9px; background:var(--color-surface,#fff); color:var(--color-text,#172033); cursor:pointer; font:inherit; font-size:11px; white-space:nowrap; }
    .admin-attendance-actions button.is-primary { background:var(--color-primary,#2563eb); border-color:var(--color-primary,#2563eb); color:#fff; }
    .admin-attendance-actions button:disabled { opacity:.55; cursor:wait; }
    .admin-attendance-message { margin:0 0 12px; padding:10px 12px; border-radius:10px; background:#ecfdf3; color:#166534; font-size:12px; }
    .admin-attendance-message.is-error { background:#fef2f2; color:#b91c1c; }
    .admin-attendance-loading,.admin-attendance-empty { border:1px solid var(--color-border,#dbe3ec); border-radius:14px; background:var(--color-surface,#fff); padding:28px; text-align:center; color:var(--color-text-secondary,#64748b); }
    .admin-management-tile[${PENDING_BADGE_ATTR}] .admin-management-tile__content small[data-admin-attendance-pending-label] { display:inline-flex; align-items:center; gap:6px; margin-top:2px; color:#9a3412; font-weight:700; }
    .admin-management-tile[${PENDING_BADGE_ATTR}] .admin-management-tile__pending-count { display:inline; min-width:0; height:auto; padding:0; border-radius:0; background:transparent; color:#9a3412; font-size:12px; font-weight:800; }
    @media (max-width:900px) { .admin-attendance-standalone__summary-row { flex-direction:column; } .admin-attendance-standalone__summary { grid-template-columns:repeat(2,minmax(0,1fr)); } .admin-attendance-standalone__top { flex-direction:column; } }
    @media (max-width:620px) { .admin-attendance-standalone__summary { grid-template-columns:1fr 1fr; gap:8px; } .admin-attendance-standalone__top h1 { font-size:22px; } }
  `;
  document.head.append(style);
}

async function requestAdminPendingSummary() {
  const previousCache = pendingSummaryCache.rows ? pendingSummaryCache : null;
  try {
    const rows = typeof api.adminPendingAttendanceByMonth === 'function'
      ? await api.adminPendingAttendanceByMonth()
      : [];
    const normalized = (Array.isArray(rows) ? rows : []).map((row) => ({
      month_key: text(row.month_key || row.monthKey),
      pending_count: Math.max(0, Number(row.pending_count ?? row.pendingCount) || 0)
    })).filter((row) => row.month_key && row.pending_count > 0);
    const total = normalized.reduce((sum, row) => sum + row.pending_count, 0);
    pendingSummaryCache = { rows: normalized, total, loadedAt: Date.now() };
    pendingSummaryRetryAfter = 0;
    return pendingSummaryCache;
  } catch {
    pendingSummaryRetryAfter = Date.now() + PENDING_SUMMARY_RETRY_BACKOFF_MS;
    return previousCache || { rows: [], total: 0, loadedAt: 0 };
  }
}

export async function loadAdminPendingSummary(force = false) {
  if (!isAdmin()) return { rows: [], total: 0 };
  if (!force && pendingSummaryCache.rows && Date.now() - pendingSummaryCache.loadedAt < PENDING_SUMMARY_TTL_MS) {
    return pendingSummaryCache;
  }
  if (pendingSummaryInFlight) {
    if (force && !pendingSummaryTrailingRefresh) pendingSummaryInvalidated = true;
    return pendingSummaryInFlight;
  }
  if (!force && !pendingSummaryCache.rows && Date.now() < pendingSummaryRetryAfter) {
    return { rows: [], total: 0, loadedAt: 0 };
  }

  pendingSummaryInvalidated = false;
  pendingSummaryTrailingRefresh = false;
  pendingSummaryInFlight = (async () => {
    let summary = await requestAdminPendingSummary();
    if (pendingSummaryInvalidated) {
      pendingSummaryInvalidated = false;
      pendingSummaryTrailingRefresh = true;
      summary = await requestAdminPendingSummary();
    }
    return summary;
  })().finally(() => {
    pendingSummaryInFlight = null;
    pendingSummaryInvalidated = false;
    pendingSummaryTrailingRefresh = false;
  });
  return pendingSummaryInFlight;
}

export function applyAdminHubPendingBadge(total = 0) {
  const normalizedTotal = Math.max(0, Number(total) || 0);
  document.querySelectorAll('[data-admin-attendance-open]').forEach((button) => {
    const content = button.querySelector('.admin-management-tile__content');
    if (!content) return;
    let label = content.querySelector('[data-admin-attendance-pending-label]');
    if (normalizedTotal > 0) {
      const totalText = String(normalizedTotal);
      if (button.getAttribute(PENDING_BADGE_ATTR) !== 'true') {
        button.setAttribute(PENDING_BADGE_ATTR, 'true');
      }
      if (!label) {
        label = document.createElement('small');
        label.setAttribute('data-admin-attendance-pending-label', 'true');
        const count = document.createElement('span');
        count.className = 'admin-management-tile__pending-count';
        count.setAttribute(PENDING_BADGE_COUNT_ATTR, 'true');
        count.textContent = totalText;
        label.append(count, document.createTextNode(' ממתינים לאישור'));
        content.append(label);
        return;
      }
      let count = label.querySelector(`[${PENDING_BADGE_COUNT_ATTR}]`);
      if (!count) {
        count = label.querySelector('.admin-management-tile__pending-count');
        if (count) count.setAttribute(PENDING_BADGE_COUNT_ATTR, 'true');
      }
      const suffix = count?.nextSibling;
      const hasExpectedStructure = count
        && label.childNodes.length === 2
        && suffix?.nodeType === Node.TEXT_NODE
        && suffix.textContent === ' ממתינים לאישור';
      if (!hasExpectedStructure) {
        const replacementCount = document.createElement('span');
        replacementCount.className = 'admin-management-tile__pending-count';
        replacementCount.setAttribute(PENDING_BADGE_COUNT_ATTR, 'true');
        replacementCount.textContent = totalText;
        label.replaceChildren(replacementCount, document.createTextNode(' ממתינים לאישור'));
      } else if (count.textContent !== totalText) {
        count.textContent = totalText;
      }
    } else {
      if (button.hasAttribute(PENDING_BADGE_ATTR)) button.removeAttribute(PENDING_BADGE_ATTR);
      if (label) label.remove();
    }
  });
}

function patchAdminHubTile() {
  if (!isAdmin()) return;
  const legacyTiles = document.querySelectorAll(`[data-admin-hub-manager-tab="${LEGACY_MANAGER_TAB}"]`);
  const existingTiles = document.querySelectorAll('[data-admin-attendance-open]');
  if (!legacyTiles.length && !existingTiles.length) return;
  legacyTiles.forEach((button) => {
    button.removeAttribute('data-admin-hub-manager-tab');
    button.removeAttribute('data-manager-board-open');
    button.setAttribute('data-admin-attendance-open', 'true');
  });
  try { sessionStorage.removeItem(PENDING_MANAGER_TAB_KEY); } catch { /* ignore */ }
  if (!document.querySelector('[data-admin-attendance-open]')) return;
  void loadAdminPendingSummary().then((summary) => applyAdminHubPendingBadge(summary.total || 0));
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

function workflowStatus(row = {}, finalApproval = null, monthKey = '', priorDispatch = null) {
  const raw = text(row.workflow_status || row.status || 'not_submitted');
  const submission = text(row.attendance_submission_status);
  const payrollStatus = text(finalApproval?.status);
  if (payrollStatus === 'approved_for_payroll') return { raw: 'sent_to_payroll', label: 'הועבר לשכר', cls: 'is-ok' };
  if (payrollStatus === 'admin_approved') return { raw: 'admin_approved', label: 'מוכן לשכר', cls: 'is-ok' };
  if (submission === 'reopened') {
    return priorDispatch
      ? { raw: 'correction_required', label: 'דורש תיקון', cls: 'is-pending' }
      : { raw: 'reopened', label: 'נפתח לעדכון', cls: 'is-pending' };
  }
  if (raw === 'manager_approved') return { raw, label: 'ממתין לאדמין', cls: 'is-pending' };
  if (raw === 'submitted') return { raw, label: 'ממתין למנהל', cls: 'is-pending' };
  if (monthMode(monthKey).key === 'closed') return { raw: 'not_submitted', label: 'ממתין לעובד', cls: 'is-pending' };
  return { raw: 'not_submitted', label: 'פתוח', cls: '' };
}

export function approvalCell(kind, name, at) {
  const who = text(name);
  const when = at ? new Date(at).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : '';
  if (!who && !when) return '';
  const label = kind === 'employee' ? 'אישור עובד' : kind === 'manager' ? 'אישור מנהל' : 'אישור אדמין';
  return `<button type="button" class="admin-attendance-approval-check" data-admin-attendance-approval-check data-approval-kind="${escapeHtml(label)}" data-approval-name="${escapeHtml(who)}" data-approval-at="${escapeHtml(at || '')}" aria-label="${escapeHtml(`${label}: ${who || 'אושר'}${when ? `, ${when}` : ''}`)}">✓</button>`;
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

function actionButtons(empId, workflowRow, finalApproval, monthKey, priorDispatch) {
  const status = workflowStatus(workflowRow, finalApproval, monthKey, priorDispatch);
  const canApprove = monthMode(monthKey).key === 'closed';
  const finalButton = canApprove && status.raw === 'manager_approved' && !finalApproval
    ? `<button type="button" class="is-primary" data-admin-attendance-final="${escapeHtml(empId)}">אישור סופי</button>`
    : '';
  const sendButton = canApprove && text(finalApproval?.status) === 'admin_approved'
    ? `<button type="button" class="is-primary" data-admin-attendance-send-payroll="${escapeHtml(empId)}">העבר לשכר</button>`
    : '';
  const managerPdfUrl = text(workflowRow.manager_pdf_sharepoint_url);
  const finalPdfPath = text(finalApproval?.pdf_path);
  const pdfButton = managerPdfUrl || finalPdfPath
    ? `<button type="button" data-admin-attendance-pdf="${escapeHtml(empId)}">צפייה ב-PDF</button>`
    : (status.raw === 'manager_approved' ? '<span class="admin-attendance-status is-pending">PDF ממתין</span>' : '');
  const releaseButton = canApprove && ['submitted', 'manager_approved', 'admin_approved', 'sent_to_payroll'].includes(status.raw)
    ? `<button type="button" data-admin-attendance-release="${escapeHtml(empId)}">${status.raw === 'sent_to_payroll' ? 'פתח לעדכון' : 'שחרור נעילה'}</button>`
    : '';
  return `<div class="admin-attendance-actions">${finalButton}${sendButton}${pdfButton}${releaseButton}</div>`;
}

function summaryHtml(employees, workflowByEmployee, finalByEmployee, dispatchByEmployee, monthKey) {
  if (monthMode(monthKey).key === 'current') {
    let open = 0;
    let reopened = 0;
    for (const employee of employees) {
      const workflow = workflowByEmployee.get(employeeId(employee)) || {};
      if (text(workflow.attendance_submission_status) === 'reopened') reopened += 1;
      else if (!workflow.submitted_at) open += 1;
    }
    return `<div class="admin-attendance-standalone__summary-row"><div class="admin-attendance-standalone__summary">
      <article><span>עובדים פעילים</span><strong>${employees.length}</strong></article>
      <article><span>פתוח לדיווח</span><strong>${open}</strong></article>
      <article><span>נפתח לעדכון</span><strong>${reopened}</strong></article>
    </div></div>`;
  }
  const counts = { not_submitted: 0, submitted: 0, manager_approved: 0, admin_approved: 0, sent_to_payroll: 0, correction_required: 0 };
  for (const employee of employees) {
    const id = employeeId(employee);
    const workflow = workflowByEmployee.get(id) || {};
    const status = workflowStatus(workflow, finalByEmployee.get(id) || null, monthKey, dispatchByEmployee.get(id) || null);
    if (Object.hasOwn(counts, status.raw)) counts[status.raw] += 1;
  }
  return `<div class="admin-attendance-standalone__summary-row"><div class="admin-attendance-standalone__summary">
    <article><span>ממתינים לעובד</span><strong>${counts.not_submitted}</strong></article>
    <article><span>ממתינים למנהל</span><strong>${counts.submitted}</strong></article>
    <article><span>ממתינים לאדמין</span><strong>${counts.manager_approved}</strong></article>
    <article><span>מוכנים לשכר</span><strong>${counts.admin_approved}</strong></article>
    <article><span>הועברו לשכר</span><strong>${counts.sent_to_payroll}</strong></article>
  </div><button type="button" class="admin-attendance-standalone__batch" data-admin-attendance-send-all${counts.admin_approved ? '' : ' disabled'}>העבר את כלל המוכנים לשכר</button></div>`;
}

function groupsHtml(employees, workflowByEmployee, finalByEmployee, dispatchByEmployee, monthKey) {
  return groupEmployees(employees).map(([manager, rows]) => {
    const body = rows.map((employee) => {
      const id = employeeId(employee);
      const workflow = workflowByEmployee.get(id) || {};
      const finalApproval = finalByEmployee.get(id) || null;
      const priorDispatch = dispatchByEmployee.get(id) || null;
      const status = workflowStatus(workflow, finalApproval, monthKey, priorDispatch);
      return `<tr data-admin-attendance-row="${escapeHtml(id)}">
        <td class="admin-attendance-person"><strong>${escapeHtml(text(employee.full_name) || id)}</strong><small>${escapeHtml(id)}${text(employee.employment_type) ? ` · ${escapeHtml(text(employee.employment_type))}` : ''}</small></td>
        <td>${approvalCell('employee', workflow.submitted_by_name, workflow.submitted_at)}</td>
        <td>${approvalCell('manager', workflow.manager_approved_by_name, workflow.manager_approved_at)}</td>
        <td>${approvalCell('admin', finalApproval?.approved_by_name, finalApproval?.approved_at)}</td>
        <td><span class="admin-attendance-status ${status.cls}">${escapeHtml(status.label)}</span></td>
        <td>${actionButtons(id, workflow, finalApproval, monthKey, priorDispatch)}</td>
      </tr>`;
    }).join('');
    return `<section class="admin-attendance-team">
      <header class="admin-attendance-team__head"><h2>${escapeHtml(manager)}</h2><span>${rows.length} עובדים · ${escapeHtml(monthKey)}</span></header>
      <div class="admin-attendance-table-wrap"><table class="admin-attendance-table">
        <colgroup><col style="width:25%"><col style="width:15%"><col style="width:15%"><col style="width:15%"><col style="width:15%"><col style="width:15%"></colgroup>
        <thead><tr><th>עובד</th><th>אישור עובד</th><th>אישור מנהל</th><th>אישור אדמין</th><th>סטטוס</th><th>פעולות</th></tr></thead>
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
    const [workflowRows, finalRows, dispatchRows] = await Promise.all([
      api.attendanceControlMonthWorkflowStatuses({ monthKey, employeeIds: ids }),
      api.listPayrollControlApprovals({ monthKey, employeeIds: ids, statuses: ['admin_approved', 'approved_for_payroll'] }),
      typeof api.listAttendancePayrollDispatches === 'function'
        ? api.listAttendancePayrollDispatches({ monthKey, employeeIds: ids })
        : Promise.resolve([])
    ]);
    if (token !== renderToken || !root.isConnected) return;
    const workflowByEmployee = new Map((workflowRows || []).map((row) => [text(row.employee_id || row.employeeId), row]));
    const finalByEmployee = new Map((finalRows || []).map((row) => [text(row.employee_id || row.employeeId), row]));
    const dispatchByEmployee = new Map();
    for (const row of Array.isArray(dispatchRows) ? dispatchRows : []) {
      const id = text(row.employee_id || row.employeeId);
      if (id && !dispatchByEmployee.has(id)) dispatchByEmployee.set(id, row);
    }
    root.__adminAttendanceContext = { employees, workflowByEmployee, finalByEmployee, dispatchByEmployee, monthKey };
    const modeEl = root.querySelector('[data-admin-attendance-mode]');
    if (modeEl) modeEl.textContent = monthMode(monthKey).label;
    if (body) body.innerHTML = employees.length
      ? `${summaryHtml(employees, workflowByEmployee, finalByEmployee, dispatchByEmployee, monthKey)}${groupsHtml(employees, workflowByEmployee, finalByEmployee, dispatchByEmployee, monthKey)}`
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

async function refreshPendingBadge(force = false) {
  const summary = await loadAdminPendingSummary(force);
  applyAdminHubPendingBadge(summary.total || 0);
  return summary;
}

async function handleAction(button, root) {
  const monthKey = text(root.querySelector('[data-admin-attendance-month]')?.value) || currentMonthKey();
  const finalEmpId = text(button.dataset.adminAttendanceFinal);
  const sendPayrollEmpId = text(button.dataset.adminAttendanceSendPayroll);
  const releaseEmpId = text(button.dataset.adminAttendanceRelease);
  const pdfEmpId = text(button.dataset.adminAttendancePdf);
  if (pdfEmpId) {
    try { await openPdf(root, pdfEmpId); } catch (error) { setMessage(root, error?.message || 'פתיחת ה-PDF נכשלה.', true); }
    return;
  }
  if (!finalEmpId && !sendPayrollEmpId && !releaseEmpId) return;
  if (monthMode(monthKey).key !== 'closed') {
    setMessage(root, 'אישור חודשי זמין לאחר סיום החודש.');
    return;
  }
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
      await refreshPendingBadge(true);
      return;
    }
    if (sendPayrollEmpId) {
      setMessage(root, 'מעביר לשכר…');
      await api.adminSendAttendanceMonthToPayroll({
        employee_id: sendPayrollEmpId,
        month_key: monthKey,
        sent_by_name: text(state?.user?.full_name || state?.user?.name || state?.user?.username)
      });
      await renderData(root, monthKey, 'העובד הועבר לשכר.');
      await refreshPendingBadge(true);
      return;
    }
    const currentFinal = root.__adminAttendanceContext?.finalByEmployee?.get(releaseEmpId) || null;
    if (text(currentFinal?.status) === 'approved_for_payroll') {
      const confirmed = window.confirm('העובד כבר הועבר לשכר. פתיחה לעדכון תשאיר את ההעברה הקודמת בהיסטוריה ותדרוש אישור ושליחה מחדש. להמשיך?');
      if (!confirmed) return;
    }
    setMessage(root, 'משחרר נעילה…');
    await api.adminReopenAttendanceMonthForCorrection({ employee_id: releaseEmpId, month_key: monthKey });
    await renderData(root, monthKey, 'החודש שוחרר ונפתח לתיקון.');
    await refreshPendingBadge(true);
  } catch (error) {
    setMessage(root, error?.message || 'הפעולה נכשלה.', true);
  } finally {
    button.disabled = false;
  }
}

async function handleBatchPayroll(root) {
  const monthKey = text(root.querySelector('[data-admin-attendance-month]')?.value) || currentMonthKey();
  if (monthMode(monthKey).key !== 'closed') return;
  const context = root.__adminAttendanceContext || {};
  const readyIds = (context.employees || [])
    .map(employeeId)
    .filter((id) => text(context.finalByEmployee?.get(id)?.status) === 'admin_approved');
  if (!readyIds.length) {
    setMessage(root, 'אין עובדים שמוכנים להעברה לשכר.');
    return;
  }
  if (!window.confirm(`יועברו לשכר ${readyIds.length} עובדים שמוכנים לכך. להמשיך?`)) return;
  const button = root.querySelector('[data-admin-attendance-send-all]');
  if (button) button.disabled = true;
  setMessage(root, 'מעביר את העובדים לשכר…');
  try {
    const result = await api.adminSendAttendanceMonthToPayrollBatch({
      month_key: monthKey,
      employee_ids: readyIds,
      sent_by_name: text(state?.user?.full_name || state?.user?.name || state?.user?.username)
    });
    const sent = Number(result?.sent_count) || 0;
    await renderData(root, monthKey, `${sent} עובדים הועברו לשכר.`);
  } catch (error) {
    setMessage(root, error?.message || 'העברת העובדים לשכר נכשלה.', true);
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
}

function standaloneHtml(monthKey = currentMonthKey()) {
  const selectedMonth = text(monthKey) || currentMonthKey();
  return `<section class="admin-attendance-standalone" ${STANDALONE_ATTRIBUTE} dir="rtl">
    <div class="admin-attendance-standalone__top">
      <div class="admin-attendance-standalone__title-wrap">
        <button type="button" class="admin-attendance-standalone__back" data-admin-attendance-back>חזרה לניהול</button>
        <div><h1>בקרת נוכחות אדמין</h1><span class="admin-attendance-standalone__mode" data-admin-attendance-mode>בקרה שוטפת</span></div>
      </div>
      <div class="admin-attendance-standalone__tools">
        <span class="admin-attendance-standalone__overview-tools">
          <label class="admin-attendance-standalone__month"><span>חודש</span><input type="month" value="${selectedMonth}" max="${currentMonthKey()}" data-admin-attendance-month></label>
          <button type="button" class="admin-attendance-standalone__refresh" data-admin-attendance-refresh>רענון</button>
          <button type="button" class="admin-attendance-standalone__control" data-admin-attendance-control-open>בקרה ועריכה</button>
        </span>
        <button type="button" class="admin-attendance-standalone__refresh" data-admin-attendance-control-back hidden>חזרה לסקירה</button>
      </div>
    </div>
    <p class="admin-attendance-message" data-admin-attendance-message hidden></p>
    <div data-admin-attendance-body></div>
    <div class="admin-attendance-standalone__control-host" data-admin-attendance-control-host hidden></div>
  </section>`;
}

async function openStandalone(button) {
  if (!isAdmin()) return;
  ensureStyles();
  const screenRoot = button.closest('#screenRoot') || document.getElementById('screenRoot') || document.getElementById('app');
  if (!screenRoot) return;
  const existing = screenRoot.querySelector(`[${STANDALONE_ATTRIBUTE}]`);
  if (existing) return;
  const hub = screenRoot.querySelector('.admin-management-home');
  if (!hub) return;
  hub.classList.add(HIDDEN_CLASS);
  const pending = await loadAdminPendingSummary();
  const monthKey = resolveAdminAttendanceDefaultMonth({
    pendingByMonth: pending.rows || [],
    currentMonth: currentMonthKey()
  });
  applyAdminHubPendingBadge(pending.total || 0);
  hub.insertAdjacentHTML('afterend', standaloneHtml(monthKey));
  const root = screenRoot.querySelector(`[${STANDALONE_ATTRIBUTE}]`);
  void renderData(root, monthKey);
}

function closeStandalone(root) {
  if (!root) return;
  const screenRoot = root.closest('#screenRoot') || document.getElementById('screenRoot') || document.getElementById('app');
  root.remove();
  screenRoot?.querySelector('.admin-management-home')?.classList.remove(HIDDEN_CLASS);
}

async function openControlMode(root) {
  if (!root || !isAdmin()) return;
  const host = root.querySelector('[data-admin-attendance-control-host]');
  const backToOverview = root.querySelector('[data-admin-attendance-control-back]');
  const modeEl = root.querySelector('[data-admin-attendance-mode]');
  if (!host) return;
  root.classList.add('is-control-mode');
  host.hidden = false;
  if (backToOverview) backToOverview.hidden = false;
  if (modeEl) modeEl.textContent = 'בקרה ועריכה';
  setMessage(root, '', false);
  host.innerHTML = '<div class="admin-attendance-loading">טוען את ממשק הבקרה הקיים…</div>';
  try {
    const attendance = await import('./screens/attendance-control.js?v=20261005-manager-reopen-hierarchy-v1');
    host.innerHTML = `${attendance.attendanceControlStylesHtml()}${attendance.attendanceControlHtml()}`;
    const panel = host.querySelector('[data-attendance-control]');
    if (panel) panel.hidden = false;
    host.querySelector('[data-attendance-close]')?.remove();
    attendance.bindAttendanceControl(host, {
      api,
      state,
      standalone: true
    });
  } catch (error) {
    host.innerHTML = '<div class="admin-attendance-empty">לא ניתן לפתוח את מצב בקרה ועריכה כרגע.</div>';
    setMessage(root, error?.message || 'פתיחת בקרה ועריכה נכשלה.', true);
  }
}

function closeControlMode(root) {
  if (!root) return;
  const host = root.querySelector('[data-admin-attendance-control-host]');
  const backToOverview = root.querySelector('[data-admin-attendance-control-back]');
  const modeEl = root.querySelector('[data-admin-attendance-mode]');
  const month = text(root.querySelector('[data-admin-attendance-month]')?.value) || currentMonthKey();
  root.classList.remove('is-control-mode');
  if (host) {
    host.hidden = true;
    host.innerHTML = '';
  }
  if (backToOverview) backToOverview.hidden = true;
  if (modeEl) modeEl.textContent = monthMode(month).label;
  void renderData(root, month);
}

function sync() {
  syncScheduled = false;
  ensureStyles();
  patchAdminHubTile();
  separateFromManagerBoard();
}

function scheduleSync() {
  if (syncScheduled) return;
  syncScheduled = true;
  requestAnimationFrame(sync);
}

function closeApprovalPopover() {
  document.querySelector('[data-admin-attendance-approval-popover]')?.remove();
}

function openApprovalPopover(button) {
  closeApprovalPopover();
  const kind = text(button.dataset.approvalKind) || 'פרטי אישור';
  const name = text(button.dataset.approvalName) || 'לא צוין';
  const rawAt = text(button.dataset.approvalAt);
  const approvalDate = rawAt ? new Date(rawAt) : null;
  const date = approvalDate && !Number.isNaN(approvalDate.getTime())
    ? approvalDate.toLocaleDateString('he-IL')
    : (rawAt || 'לא צוין');
  const time = approvalDate && !Number.isNaN(approvalDate.getTime())
    ? approvalDate.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
    : '';
  const popover = document.createElement('div');
  popover.className = 'admin-attendance-approval-popover';
  popover.setAttribute('data-admin-attendance-approval-popover', 'true');
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', kind);
  popover.innerHTML = `<strong>${escapeHtml(kind)}</strong><dl>
    <dt>${kind === 'אישור עובד' ? 'חתם/ה' : 'אושר על ידי'}</dt><dd>${escapeHtml(name)}</dd>
    <dt>תאריך</dt><dd>${escapeHtml(date)}</dd>
    ${time ? `<dt>שעה</dt><dd>${escapeHtml(time)}</dd>` : ''}
  </dl>`;
  document.body.append(popover);
  const rect = button.getBoundingClientRect();
  const width = popover.offsetWidth || 260;
  const left = Math.min(window.innerWidth - width - 8, Math.max(8, rect.right - width));
  const top = Math.min(window.innerHeight - (popover.offsetHeight || 120) - 8, rect.bottom + 6);
  popover.style.left = `${Math.max(8, left)}px`;
  popover.style.top = `${Math.max(8, top)}px`;
}

function handleClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  const approvalCheck = target.closest('[data-admin-attendance-approval-check]');
  if (approvalCheck) {
    event.preventDefault();
    event.stopPropagation();
    openApprovalPopover(approvalCheck);
    return;
  }
  if (!target.closest('[data-admin-attendance-approval-popover]')) closeApprovalPopover();
  const openButton = target.closest('[data-admin-attendance-open]');
  if (openButton) {
    event.preventDefault();
    event.stopImmediatePropagation();
    openStandalone(openButton);
    return;
  }
  const root = target.closest(`[${STANDALONE_ATTRIBUTE}]`);
  if (!root) return;
  if (target.closest('[data-admin-attendance-control-open]')) {
    event.preventDefault();
    void openControlMode(root);
    return;
  }
  if (target.closest('[data-admin-attendance-control-back]')) {
    event.preventDefault();
    closeControlMode(root);
    return;
  }
  if (target.closest('[data-admin-attendance-back]')) {
    event.preventDefault();
    if (root.classList.contains('is-control-mode')) {
      closeControlMode(root);
      return;
    }
    closeStandalone(root);
    return;
  }
  if (target.closest('[data-admin-attendance-refresh]')) {
    const month = text(root.querySelector('[data-admin-attendance-month]')?.value) || currentMonthKey();
    void renderData(root, month);
    return;
  }
  if (target.closest('[data-admin-attendance-send-all]')) {
    void handleBatchPayroll(root);
    return;
  }
  const action = target.closest('[data-admin-attendance-final], [data-admin-attendance-send-payroll], [data-admin-attendance-release], [data-admin-attendance-pdf]');
  if (action) void handleAction(action, root);
}

function handleKeydown(event) {
  if (event.key === 'Escape') closeApprovalPopover();
}

function handleChange(event) {
  const input = event.target instanceof HTMLInputElement ? event.target : null;
  if (!input?.matches('[data-admin-attendance-month]')) return;
  const root = input.closest(`[${STANDALONE_ATTRIBUTE}]`);
  if (!root) return;
  const month = text(input.value) || currentMonthKey();
  if (month > currentMonthKey()) {
    input.value = currentMonthKey();
    void renderData(root, currentMonthKey());
    return;
  }
  void renderData(root, month);
}

function start() {
  ensureStyles();
  document.addEventListener('click', handleClick, true);
  document.addEventListener('change', handleChange);
  document.addEventListener('keydown', handleKeydown);
  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.getElementById('app') || document.documentElement, { childList: true, subtree: true });
  scheduleSync();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
