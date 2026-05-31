import { escapeHtml } from './html.js';

const VIEW_SWITCH_ROUTES = [
  { route: 'activities', label: 'פעילויות' },
  { route: 'week', label: 'שבוע' },
  { route: 'month', label: 'חודש' }
];

export function renderActivitiesViewSwitcher(state, activeRoute) {
  const availableRoutes = new Set(Array.isArray(state?.routes) ? state.routes : []);
  const allowedRoutes = activeRoute === 'activities'
    ? new Set(['week', 'month'])
    : (activeRoute === 'week'
        ? new Set(['month'])
        : (activeRoute === 'month' ? new Set(['week']) : new Set()));
  const buttons = VIEW_SWITCH_ROUTES
    .filter(({ route }) => availableRoutes.has(route) && route !== activeRoute && allowedRoutes.has(route))
    .map(({ route, label }) => {
      const isActive = route === activeRoute;
      return `<button type="button" class="ds-btn ds-btn--sm ds-btn--accent ds-activities-view-btn${isActive ? ' is-active' : ''}" data-route-switch="${escapeHtml(route)}" ${isActive ? 'aria-current="page"' : ''}>${escapeHtml(label)}</button>`;
    });
  if (activeRoute === 'activities') {
    const isSummerActive = String(state?.activityQuickFamily || '') === 'summer';
    buttons.push(`<button type="button" class="ds-btn ds-btn--sm ds-activities-view-btn ds-activities-view-btn--summer${isSummerActive ? ' is-active' : ''}" data-activities-summer-filter ${isSummerActive ? 'aria-pressed="true"' : 'aria-pressed="false"'}>${escapeHtml('קיץ')}</button>`);
  }
  if (!buttons.length) return '';
  return `<div class="ds-activities-view-switcher" dir="rtl" aria-label="מעבר בין תצוגות פעילות">${buttons.join('')}</div>`;
}

export function bindActivitiesViewSwitcher(root, state, rerender) {
  root.querySelectorAll('[data-route-switch]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const route = String(btn.getAttribute('data-route-switch') || '').trim();
      if (!route) return;
      const availableRoutes = new Set(Array.isArray(state?.routes) ? state.routes : []);
      if (!availableRoutes.has(route) || state.route === route) return;
      state.activityQuickFamily = '';
      state.route = route;
      rerender();
    });
  });
  root.querySelectorAll('[data-activities-summer-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activityQuickFamily = String(state?.activityQuickFamily || '') === 'summer' ? '' : 'summer';
      state.activityEndingCurrentMonth = false;
      state.activityTab = 'all';
      rerender();
    });
  });
}
