import { escapeHtml } from './html.js';
import { openPayrollControlWindow } from './payroll-control-launcher.js';
import { ensureCourseSchedulingManualPickerAccess } from './course-scheduling-manual-picker-access.js';
import { ensureCourseSchedulingManagerApproval } from './course-scheduling-manager-approval.js';
import { hasPermission } from '../../permission-policy.js';

export const INSTRUCTORS_WORKSPACE_TABS = Object.freeze([
  { id: 'list', label: 'רשימת מדריכים', route: 'instructors' },
  { id: 'scheduling', label: 'שיבוצים', route: 'course-scheduling' },
  { id: 'work-schedule', label: 'סידור עבודה', route: 'operations-management', opsContext: 'instructors' },
  // id `payroll-control` is kept for backward compatibility; the UI label is Attendance Control.
  { id: 'payroll-control', label: 'בקרת נוכחות', route: 'operations-management', opsContext: 'instructors', action: 'payroll-control' },
  { id: 'maintenance', label: 'תחזוקה', route: 'course-scheduling' }
]);

const COURSE_SCHEDULING_ROUTE = 'course-scheduling';
function hasCourseSchedulingRole(state = {}) {
  return hasPermission(state?.user, 'view_operations_scheduling');
}

function hasPayrollControlRole(state = {}) {
  return hasPermission(state?.user, 'view_attendance_control');
}

function rowId(row = {}) {
  return String(row?.row_id ?? row?.RowID ?? row?.id ?? '').trim();
}

/**
 * Exit the temporary instructor-replacement workspace without touching the
 * confirmed assignment. Only the calculation result created for the replacement
 * course is discarded; ordinary results for other courses remain intact.
 */
export function clearCourseSchedulingReplacementState(state = {}) {
  const replacementId = String(state.courseSchedulingReplacementCourseId || '').trim();
  state.courseSchedulingReplacementCourseId = '';
  state.courseSchedulingReplacementMeetings = 0;
  state.courseSchedulingReplacementReason = '';
  state.courseSchedulingReplacementEffectiveFrom = '';
  state.courseSchedulingReplacementConfirmed = false;
  state.courseSchedulingSelectedCandidateId = '';
  state.courseSchedulingExpandedCandidateId = '';
  if (replacementId && Array.isArray(state.courseSchedulingResults)) {
    state.courseSchedulingResults = state.courseSchedulingResults.filter((result) => rowId(result?.course) !== replacementId);
  }
  return replacementId;
}

function availableRoutes(state) {
  const source = Array.isArray(state?.effectiveRoutes)
    ? state.effectiveRoutes
    : (Array.isArray(state?.routes) ? state.routes : []);
  const routes = new Set(source);
  // Keep the shared instructors navigation aligned with main.js, which explicitly
  // grants course-scheduling to these two roles even when bootstrap routes omit it.
  if (hasCourseSchedulingRole(state)) routes.add(COURSE_SCHEDULING_ROUTE);
  return routes;
}

function canOpenTab(tab, routes, state = {}) {
  if (tab?.id === 'payroll-control' && !hasPayrollControlRole(state)) return false;
  return routes.has(tab.route);
}

function ensureCourseSchedulingRouteInState(tab, state = {}) {
  if (tab?.route !== COURSE_SCHEDULING_ROUTE || !hasCourseSchedulingRole(state)) return;
  const addRoute = (key) => {
    const current = Array.isArray(state?.[key]) ? state[key] : [];
    if (!current.includes(COURSE_SCHEDULING_ROUTE)) state[key] = [...current, COURSE_SCHEDULING_ROUTE];
  };
  addRoute('routes');
  addRoute('effectiveRoutes');
}

export function resolveInstructorsWorkspaceActiveTab(state = {}) {
  const route = String(state?.route || '').trim();
  if (route === 'course-scheduling') {
    return state?.courseSchedulingTab === 'maintenance' ? 'maintenance' : 'scheduling';
  }
  if (route === 'operations-management' && state?.operationsManagement?.context === 'instructors') return 'work-schedule';
  if (route === 'instructors') return 'list';
  return '';
}

export function isInstructorsWorkspaceRoute(state = {}) {
  return !!resolveInstructorsWorkspaceActiveTab(state);
}

/**
 * Shared sub-tabs for the Instructors workspace.
 * @param {{ activeTab?: string, state?: object }} opts
 */
export function instructorsWorkspaceNavHtml({ activeTab = '', state = {} } = {}) {
  const routes = availableRoutes(state);
  const tabs = INSTRUCTORS_WORKSPACE_TABS.filter((tab) => canOpenTab(tab, routes, state));
  if (!tabs.length) return '';
  const current = activeTab || resolveInstructorsWorkspaceActiveTab(state) || tabs[0].id;
  const buttons = tabs.map((tab) => {
    const selected = tab.id === current;
    return `<button
      type="button"
      role="tab"
      class="instructors-workspace-tab${selected ? ' is-active' : ''}"
      data-instructors-workspace-tab="${escapeHtml(tab.id)}"
      aria-selected="${selected ? 'true' : 'false'}"
      tabindex="${selected ? '0' : '-1'}"
    >${escapeHtml(tab.label)}</button>`;
  }).join('');
  return `<div class="instructors-workspace-nav" dir="rtl">
    <div class="instructors-workspace-tabs" role="tablist" aria-label="לשוניות סביבת מדריכים">${buttons}</div>
  </div>`;
}

/** Shared tabs row for the Instructors workspace. */
export function instructorsWorkspaceHeaderHtml({ activeTab = '', state = {} } = {}) {
  return instructorsWorkspaceNavHtml({ activeTab, state });
}

export function instructorsWorkspaceNavStylesHtml() {
  return `<style id="instructors-workspace-nav-styles">
.instructors-workspace-nav{margin:0 0 8px}
.instructors-workspace-tabs{display:flex;flex-wrap:wrap;gap:8px;border-bottom:1px solid #e5e7eb;padding-bottom:6px}
.instructors-workspace-tab{appearance:none;border:1px solid #d8dce2;background:#fff;color:#1f2a37;border-radius:999px;padding:7px 14px;min-height:32px;min-width:88px;box-sizing:border-box;font:inherit;font-weight:700;font-size:.82rem;line-height:1.2;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.instructors-workspace-tab:hover{border-color:#b6bcc6;background:#f4f5f7}
.instructors-workspace-tab.is-active{background:#1f4b7a;border-color:#1f4b7a;color:#fff;box-shadow:inset 0 0 0 1px rgba(255,255,255,.2)}
.instructors-workspace-tab:focus-visible{outline:2px solid #1f4b7a;outline-offset:2px}
.ds-ops-mgmt-panel__toolbar [data-attendance-open]{display:none!important}
@media(max-width:720px){.instructors-workspace-tabs{gap:6px}.instructors-workspace-tab{padding:7px 12px;font-size:.8rem}}
</style>`;
}

function prepareTabContext(tab, state) {
  if (tab.id === 'maintenance') {
    if (state.operationsManagement) state.operationsManagement.context = 'operations';
    state.courseSchedulingTab = 'maintenance';
    state.courseSchedulingDistanceCoverageLoaded = false;
    return { route: 'course-scheduling' };
  }
  if (tab.id === 'scheduling') {
    if (state.operationsManagement) state.operationsManagement.context = 'operations';
    state.courseSchedulingTab = '';
    return { route: tab.route };
  }
  if (tab.id === 'list') {
    if (state.operationsManagement) state.operationsManagement.context = 'operations';
    return { route: tab.route };
  }
  state.operationsManagement = state.operationsManagement || {};
  state.operationsManagement.context = 'instructors';
  state.operationsManagement.tab = 'instructors';
  return { route: 'operations-management', opsContext: 'instructors' };
}

function activateTab(tabId, { state, rerender } = {}) {
  const routes = availableRoutes(state);
  const tab = INSTRUCTORS_WORKSPACE_TABS.find((item) => item.id === tabId);
  if (!tab || !canOpenTab(tab, routes, state)) return;

  if (tab.action === 'payroll-control') {
    try {
      openPayrollControlWindow(state);
    } catch (error) {
      if (typeof window !== 'undefined') window.alert(error?.message || 'פתיחת בקרת הנוכחות נכשלה.');
    }
    return;
  }

  if (tab.id !== 'scheduling' && state?.courseSchedulingReplacementCourseId) {
    clearCourseSchedulingReplacementState(state);
  }

  // A lightweight/bootstrap route refresh can replace effectiveRoutes after this
  // tab row was already rendered. Restore the same explicit grant main.js applies
  // so a visible scheduling/maintenance button never becomes a silent no-op.
  ensureCourseSchedulingRouteInState(tab, state);
  const detail = prepareTabContext(tab, state);

  // Browser: never set state.route before app:navigate — main.js bails when route === state.route.
  if (typeof document !== 'undefined') {
    if (state.route === detail.route) {
      // Already on this route — state was mutated in prepareTabContext; just re-render.
      rerender?.();
      return;
    }
    document.dispatchEvent(new CustomEvent('app:navigate', { detail }));
    return;
  }

  state.route = detail.route;
  rerender?.();
}

/**
 * Bind click + keyboard activation for Instructors workspace tabs.
 */
export function bindInstructorsWorkspaceNav(root, { state, rerender } = {}) {
  if (!root) return;

  // The legacy payroll/attendance launcher used to live in the work-schedule toolbar.
  // Remove it after every render so the shared tab row is the single entry point.
  root.querySelectorAll('.ds-ops-mgmt-panel__toolbar [data-attendance-open]').forEach((button) => button.remove());

  // course-scheduling.js owns the existing manual-pick handlers and RPC flow.
  // Inject only the missing access UI before those handlers are bound.
  ensureCourseSchedulingManualPickerAccess(root, { state });
  void ensureCourseSchedulingManagerApproval(root, { state });

  // course-scheduling.js reuses the same state object across re-renders. Clear the
  // temporary replacement calculation before its ordinary handlers process an exit
  // action, so another course never inherits replacement-only labels or controls.
  root.addEventListener('click', (event) => {
    if (!state?.courseSchedulingReplacementCourseId) return;
    const target = event.target;
    const courseCard = target?.closest?.('[data-course-card]');
    const calendarCourse = target?.closest?.('[data-calendar-course]');
    const periodButton = target?.closest?.('[data-period-key]');
    const clearCandidate = target?.closest?.('[data-clear-candidate]');
    const innerTab = target?.closest?.('[data-switch-tab]');
    if (courseCard || calendarCourse || periodButton || clearCandidate || (innerTab && innerTab.dataset.switchTab !== 'courses')) {
      clearCourseSchedulingReplacementState(state);
    }
  }, true);

  root.addEventListener('change', (event) => {
    if (!state?.courseSchedulingReplacementCourseId) return;
    if (event.target?.matches?.('[data-district-filter], [data-authority-filter]')) {
      clearCourseSchedulingReplacementState(state);
    }
  }, true);

  const tabs = [...root.querySelectorAll('[data-instructors-workspace-tab]')];
  if (!tabs.length) return;

  const focusTab = (index) => {
    const target = tabs[(index + tabs.length) % tabs.length];
    target?.focus();
  };

  tabs.forEach((btn, index) => {
    btn.addEventListener('click', () => {
      activateTab(btn.getAttribute('data-instructors-workspace-tab') || '', { state, rerender });
    });
    btn.addEventListener('keydown', (event) => {
      const key = event.key;
      if (key === 'Enter' || key === ' ') {
        event.preventDefault();
        activateTab(btn.getAttribute('data-instructors-workspace-tab') || '', { state, rerender });
        return;
      }
      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        event.preventDefault();
        // RTL: ArrowLeft moves to next visual tab (higher index), ArrowRight to previous.
        focusTab(index + (key === 'ArrowLeft' ? 1 : -1));
      }
    });
  });
}
