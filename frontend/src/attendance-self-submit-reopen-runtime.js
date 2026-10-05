import { api } from './api.js';
import { state } from './state.js';

const PATCH_MARK = 'attendanceSelfSubmitReopenPatched';
const CACHE_TTL_MS = 15_000;
let scheduled = 0;
const statusCache = new Map();

function text(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function isAdmin() {
  return text(state?.user?.role || state?.user?.display_role) === 'admin';
}

async function workflowStatuses(monthKey, employeeIds) {
  const ids = [...new Set((employeeIds || []).map(text).filter(Boolean))].sort();
  if (!monthKey || !ids.length || typeof api?.attendanceControlMonthWorkflowStatuses !== 'function') return new Map();
  const key = `${monthKey}|${ids.join(',')}`;
  const cached = statusCache.get(key);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached.map;
  const rows = await api.attendanceControlMonthWorkflowStatuses({ monthKey, employeeIds: ids });
  const map = new Map((rows || []).map((row) => [text(row.employee_id || row.employeeId), row]));
  statusCache.set(key, { loadedAt: Date.now(), map });
  return map;
}

function setAdminMessage(root, message = '', isError = false) {
  const target = root?.querySelector('[data-admin-attendance-message]');
  if (!target) return;
  target.hidden = !message;
  target.textContent = message;
  target.classList.toggle('is-error', Boolean(isError));
}

function adminDomSignature(root, monthKey, rows) {
  return `${monthKey}|${rows.map((row) => {
    const id = text(row.dataset.adminAttendanceRow);
    const status = text(row.querySelector('td:nth-child(7) .admin-attendance-status')?.textContent);
    const hasOpen = Boolean(row.querySelector('[data-admin-attendance-open-for-employee]'));
    return `${id}:${status}:${hasOpen ? 1 : 0}`;
  }).join('|')}`;
}

async function patchAdminStandalone(root) {
  if (!root || !root.isConnected || !isAdmin()) return;
  const monthKey = text(root.querySelector('[data-admin-attendance-month]')?.value);
  if (!monthKey) return;
  const rows = [...root.querySelectorAll('[data-admin-attendance-row]')];
  const ids = rows.map((row) => text(row.dataset.adminAttendanceRow)).filter(Boolean);
  if (!ids.length) return;

  const beforeSignature = adminDomSignature(root, monthKey, rows);
  if (root.dataset[PATCH_MARK] === beforeSignature) return;

  let statuses;
  try {
    statuses = await workflowStatuses(monthKey, ids);
  } catch (error) {
    console.warn('[attendance-reopen] admin status patch failed', error);
    return;
  }
  if (!root.isConnected || text(root.querySelector('[data-admin-attendance-month]')?.value) !== monthKey) return;

  for (const row of rows) {
    const empId = text(row.dataset.adminAttendanceRow);
    const workflow = statuses.get(empId) || {};
    const workflowStatus = text(workflow.workflow_status || 'not_submitted');
    const submissionStatus = text(workflow.attendance_submission_status || 'open');
    const actions = row.querySelector('.admin-attendance-actions');
    const existingOpen = actions?.querySelector('[data-admin-attendance-open-for-employee]');

    if (workflowStatus === 'not_submitted') {
      if (submissionStatus === 'reopened') {
        existingOpen?.remove();
      } else if (monthKey < currentMonthKey()) {
        if (actions && !existingOpen) {
          actions.insertAdjacentHTML(
            'afterbegin',
            `<button type="button" class="is-primary" data-admin-attendance-open-for-employee="${empId}">פתח לעובד להשלמה ואישור</button>`
          );
        }
      } else {
        existingOpen?.remove();
      }
    } else {
      existingOpen?.remove();
    }
  }
  root.dataset[PATCH_MARK] = adminDomSignature(root, monthKey, rows);
}

function managerMonthKey(table) {
  const headers = [...(table?.querySelectorAll('thead th') || [])].map((cell) => text(cell.textContent));
  const header = headers.find((value) => /20\d{2}-(0[1-9]|1[0-2])/.test(value)) || '';
  return header.match(/20\d{2}-(0[1-9]|1[0-2])/)?.[0] || '';
}

function managerRowEmployeeId(row) {
  return text(row?.querySelector('td[data-label="מס׳ עובד"]')?.textContent)
    || text(row?.querySelector('[data-manager-attendance-reopen-employee]')?.dataset.managerAttendanceReopenEmployee)
    || text(row?.querySelector('[data-manager-attendance-open-employee]')?.dataset.managerAttendanceOpenEmployee);
}

function managerRowHasReport(row) {
  const reportText = text(row?.querySelector('td[data-label="דיווח"]')?.textContent);
  return Boolean(reportText) && !reportText.includes('לא נמצא דיווח');
}

function managerStatusHtml(label, cls = 'is-pending') {
  return `<span class="manager-workspace-status ${cls}">${label}</span>`;
}

function managerDomSignature(table, monthKey, rows) {
  return `${monthKey}|${rows.map((row) => {
    const id = managerRowEmployeeId(row);
    const status = text(row.querySelector('td[data-label="סטטוס אישור"]')?.textContent);
    return `${id}:${status}`;
  }).join('|')}`;
}

async function patchManagerAttendanceTable(table) {
  if (!table || !table.isConnected) return;
  const monthKey = managerMonthKey(table);
  if (!monthKey) return;
  const rows = [...table.querySelectorAll('tbody tr')];
  const ids = rows.map((row) => managerRowEmployeeId(row)).filter(Boolean);
  if (!ids.length) return;
  const beforeSignature = managerDomSignature(table, monthKey, rows);
  if (table.dataset[PATCH_MARK] === beforeSignature) return;

  let statuses;
  try {
    statuses = await workflowStatuses(monthKey, ids);
  } catch (error) {
    console.warn('[attendance-reopen] manager status patch failed', error);
    return;
  }
  if (!table.isConnected || managerMonthKey(table) !== monthKey) return;

  let employeeApproved = 0;
  let awaitingEmployee = 0;
  for (const row of rows) {
    const empId = managerRowEmployeeId(row);
    const workflow = statuses.get(empId) || {};
    const workflowStatus = text(workflow.workflow_status || 'not_submitted');
    const submissionStatus = text(workflow.attendance_submission_status || 'open');
    const statusCell = row.querySelector('td[data-label="סטטוס אישור"]');
    if (!statusCell) continue;

    const hasReport = managerRowHasReport(row);
    let nextHtml = '';
    if (workflowStatus === 'approved') {
      nextHtml = managerStatusHtml('✓ אושר סופית', 'is-ok');
      employeeApproved += 1;
    } else if (workflowStatus === 'manager_approved') {
      nextHtml = managerStatusHtml('✓ אושר על ידי המנהל', 'is-ok');
      employeeApproved += 1;
    } else if (workflowStatus === 'submitted') {
      const approvedAt = workflow.submitted_at ? new Date(workflow.submitted_at).toLocaleDateString('he-IL') : '';
      nextHtml = `${managerStatusHtml('✓ המדריך אישר · ממתין לבקרת מנהל', 'is-ok')}${approvedAt ? `<small>${approvedAt}</small>` : ''}`;
      employeeApproved += 1;
    } else if (submissionStatus === 'reopened') {
      nextHtml = managerStatusHtml('פתוח לעובד לתיקון ואישור');
      if (hasReport) awaitingEmployee += 1;
    } else if (hasReport) {
      nextHtml = managerStatusHtml('טרם אושר על ידי המדריך');
      awaitingEmployee += 1;
    } else {
      nextHtml = '<span class="manager-workspace-status is-muted">אין דיווח</span>';
    }
    if (statusCell.innerHTML !== nextHtml) statusCell.innerHTML = nextHtml;
  }

  const strip = table.closest('[data-manager-workspace-view]')?.querySelector('.manager-workspace-alert-strip');
  strip?.querySelectorAll('article').forEach((article) => {
    const label = text(article.querySelector('span')?.textContent);
    const value = article.querySelector('strong');
    if (!value) return;
    if (label === 'טרם אושר ע״י העובד' && value.textContent !== String(awaitingEmployee)) value.textContent = String(awaitingEmployee);
    if (label === 'אושר ע״י העובד' && value.textContent !== String(employeeApproved)) value.textContent = String(employeeApproved);
  });

  table.dataset[PATCH_MARK] = managerDomSignature(table, monthKey, rows);
}

async function patchVisibleAttendance() {
  const adminRoot = document.querySelector('[data-admin-attendance-standalone]');
  if (adminRoot) await patchAdminStandalone(adminRoot);
  const managerTable = document.querySelector('.manager-workspace-attendance-table');
  if (managerTable) await patchManagerAttendanceTable(managerTable);
}

function schedulePatch() {
  if (scheduled) window.clearTimeout(scheduled);
  scheduled = window.setTimeout(() => {
    scheduled = 0;
    void patchVisibleAttendance();
  }, 60);
}

async function handleAdminOpenForEmployee(button) {
  const root = button.closest('[data-admin-attendance-standalone]');
  if (!root || !isAdmin()) return;
  const empId = text(button.dataset.adminAttendanceOpenForEmployee);
  const monthKey = text(root.querySelector('[data-admin-attendance-month]')?.value);
  if (!empId || !monthKey) return;

  const row = button.closest('[data-admin-attendance-row]');
  const employeeName = text(row?.querySelector('.admin-attendance-person strong')?.textContent) || empId;

  button.disabled = true;
  try {
    setAdminMessage(root, `פותח את ${monthKey} עבור ${employeeName} להשלמה ואישור…`);
    await api.adminReopenAttendanceMonthForCorrection({ employee_id: empId, month_key: monthKey, reason: null });
    statusCache.clear();
    delete root.dataset[PATCH_MARK];
    setAdminMessage(root, `החודש נפתח עבור ${employeeName}. העובד צריך להיכנס, להשלים במידת הצורך ולבצע "סיום ואישור חודש" בעצמו.`);
    root.querySelector('[data-admin-attendance-refresh]')?.click();
  } catch (error) {
    setAdminMessage(root, error?.message || 'פתיחת החודש לעובד נכשלה.', true);
  } finally {
    button.disabled = false;
  }
}

function start() {
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest('[data-admin-attendance-open-for-employee]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void handleAdminOpenForEmployee(button);
  }, true);

  const observer = new MutationObserver(schedulePatch);
  observer.observe(document.getElementById('app') || document.documentElement, { childList: true, subtree: true });
  schedulePatch();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
