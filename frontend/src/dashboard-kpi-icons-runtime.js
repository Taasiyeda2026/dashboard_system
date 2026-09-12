const DASHBOARD_KPI_ICON_SIZE = 22;

export const DASHBOARD_KPI_ICON_BODIES = Object.freeze({
  'kpi|active_courses': '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  'kpi|active_workshops': '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.08V21a2 2 0 1 1-4 0v-.08A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.08-.4H3a2 2 0 1 1 0-4h-.08A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.08V3a2 2 0 1 1 4 0v-.08A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.12.37.33.72.6 1 .3.27.65.48 1.08.5H21a2 2 0 1 1 0 4h-.08A1.7 1.7 0 0 0 19.4 15z"/>',
  'kpi|active_escape_room': '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/><circle cx="12" cy="16" r="1"/>',
  'kpi|active_tours': '<path d="M3 21V10l6 3v-3l6 3V4h6v17H3z"/><path d="M7 17h2"/><path d="M13 17h2"/><path d="M18 8h3"/>',
  'kpi|active_after_school': '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/>',
  'kpi|endings': '<circle cx="12" cy="12" r="9"/><polyline points="8 12 11 15 16 9"/>',
  'kpi|instructors': '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  'kpi|exceptions': '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'
});

export function dashboardKpiIconSvg(action) {
  const body = DASHBOARD_KPI_ICON_BODIES[action];
  if (!body) return '';
  return `<svg width="${DASHBOARD_KPI_ICON_SIZE}" height="${DASHBOARD_KPI_ICON_SIZE}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export function applyDashboardKpiIcons(root = document) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll('.ds-dashboard-kpi-grid [data-card-action]').forEach((button) => {
    const action = String(button.getAttribute('data-card-action') || '');
    const svg = dashboardKpiIconSvg(action);
    if (!svg) return;
    const host = button.querySelector('.ds-kpi-icon');
    if (!host || host.dataset.dashboardKpiIcon === action) return;
    host.innerHTML = svg;
    host.dataset.dashboardKpiIcon = action;
  });
}

function installDashboardKpiIconSync() {
  if (typeof document === 'undefined') return;
  applyDashboardKpiIcons(document);
  const target = document.getElementById('app') || document.body;
  if (!target || typeof MutationObserver === 'undefined') return;
  const observer = new MutationObserver(() => applyDashboardKpiIcons(target));
  observer.observe(target, { childList: true, subtree: true });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installDashboardKpiIconSync, { once: true });
  } else {
    installDashboardKpiIconSync();
  }
}
