import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';
import { tableHtml } from './manager-board-employee-file-tracking.js';

let renderSequence = 0;

function text(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function managerFromPanel(panel) {
  const boardRoot = panel?.closest('[data-manager-board-root]');
  const select = boardRoot?.querySelector('[data-manager-board-manager]');
  if (select?.value) return text(select.value);
  const fixed = boardRoot?.querySelector('.manager-board-manager-fixed strong');
  return text(fixed?.textContent);
}

function schoolYearFromPanel(panel) {
  const canonical = text(panel?.closest('[data-manager-board-root]')?.dataset?.managerBoardSchoolYear);
  if (/^20\d{2}$/.test(canonical)) return canonical;
  const heading = text(panel?.querySelector('.manager-workspace-panel__head p')?.textContent);
  return heading.match(/שנת\s+(20\d{2})/)?.[1] || '2027';
}

function installStyles() {
  if (document.getElementById('manager-tracking-employee-file-source-styles')) return;
  const style = document.createElement('style');
  style.id = 'manager-tracking-employee-file-source-styles';
  style.textContent = `
    .manager-workspace-tracking-table--employee-file{min-width:1180px}
    .manager-workspace-tracking-table--employee-file th:not(:first-child),
    .manager-workspace-tracking-table--employee-file td:not(:first-child){text-align:center}
    .manager-workspace-followup-cell__content{display:inline-flex;align-items:center;justify-content:center;min-height:28px}
    .manager-workspace-deadline-date{color:#475569;font-size:12px;font-weight:700;white-space:nowrap}
    .manager-workspace-deadline-date--late{color:#b45309}
    .manager-workspace-deadline-empty{color:#94a3b8;font-size:13px}
    .manager-workspace-deadline-review{color:#64748b;font-size:12px;font-weight:600;white-space:nowrap}
    .manager-workspace-followup-cell--not-for-update{color:#94a3b8}
    .manager-workspace-followup-cell__content--muted{color:#94a3b8;font-size:12px;font-weight:600;white-space:nowrap}
    .manager-workspace-tracking-error{margin:0;padding:12px 16px;border-top:1px solid #e2e8f0;background:#f8fafc;color:#64748b;font-size:.8rem}
  `;
  document.head.appendChild(style);
}

async function replaceTrackingProjection(panel) {
  if (!panel || !panel.isConnected || !panel.classList.contains('manager-workspace-tracking')) return;
  const manager = managerFromPanel(panel);
  const schoolYear = schoolYearFromPanel(panel);
  if (!manager || !supabase) return;

  const contextKey = `${manager}|${schoolYear}`;
  const sameContext = panel.dataset.employeeFileTrackingContext === contextKey;
  const state = panel.dataset.employeeFileTrackingReady;
  if (sameContext && (state === 'loading' || state === 'true')) return;

  panel.dataset.employeeFileTrackingContext = contextKey;
  panel.dataset.employeeFileTrackingReady = 'loading';
  const sequence = ++renderSequence;

  try {
    await waitForSupabaseAuthSession({ timeoutMs: 7000 }).catch(() => null);
    const { data, error } = await supabase.rpc('get_manager_team_roster', {
      p_manager_name: manager,
      p_school_year: schoolYear
    });
    if (error) throw new Error(error.message || 'טעינת מעקב הצוות נכשלה.');
    if (!panel.isConnected || sequence !== renderSequence) return;

    const currentContext = `${managerFromPanel(panel)}|${schoolYearFromPanel(panel)}`;
    if (currentContext !== contextKey) return;

    const header = panel.querySelector('.manager-workspace-panel__head');
    panel.innerHTML = `${header?.outerHTML || ''}${tableHtml(Array.isArray(data) ? data : [])}`;
    panel.dataset.employeeFileTrackingContext = contextKey;
    panel.dataset.employeeFileTrackingReady = 'true';
  } catch (error) {
    if (!panel.isConnected || sequence !== renderSequence) return;
    panel.dataset.employeeFileTrackingReady = 'error';
    let existing = panel.querySelector('.manager-workspace-tracking-error');
    if (!existing) {
      existing = document.createElement('p');
      existing.className = 'manager-workspace-tracking-error';
      panel.appendChild(existing);
    }
    existing.textContent = `לא ניתן היה לרענן את תיקי העובד: ${String(error?.message || '')}`;
    console.error('[manager-tracking] employee-file projection failed', error);
  }
}

function refreshVisibleTracking() {
  const panel = document.querySelector('.manager-workspace-panel.manager-workspace-tracking');
  if (panel) void replaceTrackingProjection(panel);
}

installStyles();

const observer = new MutationObserver(() => refreshVisibleTracking());
observer.observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener('change', (event) => {
  if (event.target instanceof Element && event.target.matches('[data-manager-board-manager]')) queueMicrotask(refreshVisibleTracking);
});

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('[data-manager-workspace-tab="tracking"]')) {
    const panel = document.querySelector('.manager-workspace-panel.manager-workspace-tracking');
    if (panel) panel.dataset.employeeFileTrackingReady = '';
    queueMicrotask(refreshVisibleTracking);
  }
});

document.addEventListener('manager-board:tracking-invalidate', () => {
  const panel = document.querySelector('.manager-workspace-panel.manager-workspace-tracking');
  if (panel) panel.dataset.employeeFileTrackingReady = '';
  queueMicrotask(refreshVisibleTracking);
});

refreshVisibleTracking();
