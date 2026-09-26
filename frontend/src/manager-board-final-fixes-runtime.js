import { api } from './api.js';

const BOARD_SELECTOR = '.manager-board-screen[data-manager-board-root]';
const ATTENDANCE_WORKFLOW_TTL_MS = 60 * 1000;
let scheduled = false;
let monthDefaultsReset = false;
const attendanceWorkflowCache = new Map();

function clearPersistedManagerMonthDefaults() {
  if (monthDefaultsReset) return;
  monthDefaultsReset = true;
  try {
    ['regular', 'summer_2026', 'school_2027'].forEach((period) => {
      localStorage.removeItem(`manager_board_month:${period}`);
    });
  } catch {
    // Ignore storage restrictions. The board runtime will still use its built-in period default.
  }
}

function activeWorkspaceTab(boardRoot) {
  return boardRoot?.querySelector('[data-manager-workspace-tab].is-active')?.getAttribute('data-manager-workspace-tab') || 'management';
}

function removeMonthlyInstructorPanel(boardRoot) {
  boardRoot?.querySelectorAll('.manager-board-panel--instructors').forEach((panel) => panel.remove());
}

function setButtonText(button, value) {
  if (button && button.textContent !== value) button.textContent = value;
}

function setButtonTitle(button, value) {
  if (!button) return;
  if (value) {
    if (button.title !== value) button.title = value;
  } else if (button.hasAttribute('title')) {
    button.removeAttribute('title');
  }
}

/**
 * A stale shared interaction backdrop can leave the visible manager board unable
 * to receive clicks even though no drawer/modal is actually open. Repair only
 * that inconsistent state; never close a real visible drawer or modal.
 */
function releaseStaleInteractionBackdrop() {
  const layer = document.getElementById('ds-shared-ui-layer');
  if (!layer) return;

  const drawerOpen = Boolean(layer.querySelector('.ds-drawer[aria-hidden="false"]'));
  const modalOpen = Boolean(layer.querySelector('.ds-modal[aria-hidden="false"]'));
  if (drawerOpen || modalOpen) return;

  layer.classList.remove(
    'is-backdrop-visible',
    'is-drawer-open',
    'is-modal-open',
    'is-secondary-drawer-open'
  );

  const backdrop = layer.querySelector('.ds-ui-backdrop');
  if (backdrop) {
    backdrop.hidden = true;
    backdrop.style.removeProperty('pointer-events');
    backdrop.style.removeProperty('opacity');
  }

  layer.querySelector('.ds-secondary-drawer')?.setAttribute('aria-hidden', 'true');
}

function syncManagementMonthNavigation(boardRoot) {
  const nav = boardRoot?.querySelector('.manager-board-month-nav');
  if (!nav) return;
  const previous = nav.querySelector('[data-manager-board-month="-1"]');
  const next = nav.querySelector('[data-manager-board-month="1"]');
  if (!previous || !next) return;

  const isManagement = activeWorkspaceTab(boardRoot) === 'management';
  nav.classList.toggle('manager-board-month-nav--arrows', isManagement);
  nav.classList.remove('manager-board-month-nav--labeled');

  if (isManagement) {
    // RTL timeline: previous month is on the right and next month is on the left.
    setButtonText(previous, '›');
    setButtonText(next, '‹');
    setButtonTitle(previous, previous.disabled ? 'זהו החודש הראשון בשנת הפעילות' : 'החודש הקודם');
    setButtonTitle(next, next.disabled ? 'זהו החודש האחרון בשנת הפעילות' : 'החודש הבא');
  } else {
    setButtonText(previous, '‹');
    setButtonText(next, '›');
    setButtonTitle(previous, '');
    setButtonTitle(next, '');
  }
}

function attendanceMonthFromTable(table) {
  for (const header of table?.querySelectorAll('thead th') || []) {
    const match = String(header.textContent || '').trim().match(/דיווח\s+(20\d{2}-\d{2})/);
    if (match) return match[1];
  }
  return '';
}

function attendanceWorkflowStatus(workflow = {}) {
  const explicit = String(workflow.workflow_status || workflow.workflowStatus || '').trim().toLowerCase();
  const submission = String(workflow.attendance_submission_status || workflow.attendanceSubmissionStatus || '').trim().toLowerCase();
  if (explicit === 'approved') return 'approved';
  if (explicit === 'manager_approved') return 'manager_approved';
  if (explicit === 'submitted' || submission === 'submitted') return 'submitted';
  if (submission === 'reopened') return 'reopened';
  return 'not_submitted';
}

function setAttendanceWorkflowBadge(row, workflow) {
  const statusCell = row?.querySelector('td[data-label="סטטוס אישור"]') || row?.querySelectorAll('td')?.[3];
  const badge = statusCell?.querySelector('.manager-workspace-status');
  if (!badge) return;

  const status = attendanceWorkflowStatus(workflow);
  if (status === 'submitted') {
    badge.textContent = '✓ אושר על ידי העובד · ממתין לבקרת מנהל';
    badge.classList.remove('is-muted', 'is-ok');
    badge.classList.add('is-pending');
  } else if (status === 'manager_approved') {
    badge.textContent = '✓ אושר על ידי המנהל';
    badge.classList.remove('is-muted', 'is-pending');
    badge.classList.add('is-ok');
  } else if (status === 'approved') {
    badge.textContent = '✓ אושר סופית';
    badge.classList.remove('is-muted', 'is-pending');
    badge.classList.add('is-ok');
  } else if (status === 'reopened') {
    badge.textContent = 'פתוח לתיקון';
    badge.classList.remove('is-muted', 'is-ok');
    badge.classList.add('is-pending');
  }
}

function syncAttendanceAlertCounts(boardRoot, table, workflowByEmployee) {
  let employeeApprovedCount = 0;
  let awaitingEmployeeApprovalCount = 0;

  table.querySelectorAll('tbody tr').forEach((row) => {
    const button = row.querySelector('[data-manager-attendance-open-employee]');
    if (!button || button.disabled) return;
    const employeeId = String(button.dataset.managerAttendanceOpenEmployee || '').trim();
    const status = attendanceWorkflowStatus(workflowByEmployee.get(employeeId) || {});
    if (['submitted', 'manager_approved', 'approved'].includes(status)) employeeApprovedCount += 1;
    else awaitingEmployeeApprovalCount += 1;
  });

  const strip = boardRoot.querySelector('.manager-workspace-alert-strip');
  strip?.querySelectorAll('article').forEach((article) => {
    const label = article.querySelector('span')?.textContent?.trim();
    const value = article.querySelector('strong');
    if (!value) return;
    if (label === 'טרם אושר' || label === 'טרם אושר ע״י העובד') value.textContent = String(awaitingEmployeeApprovalCount);
    if (label === 'אושרו' || label === 'אושר ע״י העובד') value.textContent = String(employeeApprovedCount);
  });
}

async function syncAttendanceApprovalStatuses(boardRoot) {
  if (activeWorkspaceTab(boardRoot) !== 'attendance') return;
  if (typeof api?.attendanceControlMonthWorkflowStatuses !== 'function') return;

  const table = boardRoot.querySelector('.manager-workspace-attendance-table');
  if (!table) return;
  const monthKey = attendanceMonthFromTable(table);
  const employeeIds = [...table.querySelectorAll('[data-manager-attendance-open-employee]')]
    .map((button) => String(button.dataset.managerAttendanceOpenEmployee || '').trim())
    .filter(Boolean);
  if (!monthKey || !employeeIds.length) return;

  const signature = `${monthKey}|${employeeIds.join(',')}`;
  if (table.dataset.attendanceWorkflowSignature === signature) return;
  table.dataset.attendanceWorkflowSignature = signature;

  let workflowRows;
  const cached = attendanceWorkflowCache.get(signature);
  if (cached && Date.now() - cached.loadedAt < ATTENDANCE_WORKFLOW_TTL_MS) {
    workflowRows = cached.rows;
  } else {
    try {
      workflowRows = await api.attendanceControlMonthWorkflowStatuses({ monthKey, employeeIds });
      attendanceWorkflowCache.set(signature, {
        rows: Array.isArray(workflowRows) ? workflowRows : [],
        loadedAt: Date.now()
      });
    } catch {
      delete table.dataset.attendanceWorkflowSignature;
      return;
    }
  }

  if (!table.isConnected || activeWorkspaceTab(boardRoot) !== 'attendance') return;
  const workflowByEmployee = new Map((workflowRows || []).map((row) => [
    String(row.employee_id || row.employeeId || '').trim(),
    row
  ]));

  table.querySelectorAll('tbody tr').forEach((row) => {
    const button = row.querySelector('[data-manager-attendance-open-employee]');
    const employeeId = String(button?.dataset?.managerAttendanceOpenEmployee || '').trim();
    if (!employeeId) return;
    setAttendanceWorkflowBadge(row, workflowByEmployee.get(employeeId) || {});
  });
  syncAttendanceAlertCounts(boardRoot, table, workflowByEmployee);
}

function syncBoard() {
  scheduled = false;
  const boards = document.querySelectorAll(BOARD_SELECTOR);
  if (!boards.length) return;

  releaseStaleInteractionBackdrop();
  boards.forEach((boardRoot) => {
    removeMonthlyInstructorPanel(boardRoot);
    syncManagementMonthNavigation(boardRoot);
    void syncAttendanceApprovalStatuses(boardRoot);
  });
}

function scheduleSync() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(syncBoard);
}

function handleDocumentClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  if (target.closest('[data-manager-workspace-tab], [data-manager-board-month]')) scheduleSync();
}

function start() {
  clearPersistedManagerMonthDefaults();
  const root = document.getElementById('app') || document.documentElement;
  const observer = new MutationObserver(scheduleSync);
  // Child-list changes are enough to detect board mounts/re-renders. Watching the
  // same class/disabled attributes this runtime mutates can create unnecessary
  // feedback churn and, in a bad state, starve pointer interaction.
  observer.observe(root, { childList: true, subtree: true });
  document.addEventListener('click', handleDocumentClick, true);
  document.addEventListener('app:navigate', scheduleSync);
  scheduleSync();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
