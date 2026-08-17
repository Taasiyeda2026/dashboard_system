import { clearScreenDataCache, setArchiveActivityPeriod, setGlobalActivityPeriod, state } from '../../state.js';
import {
  ACTIVE_ACTIVITY_SEASON,
  globalActivityPeriodFullLabel,
  globalActivityPeriodLabel,
  normalizeGlobalActivityPeriod
} from './summer-activity.js';

/**
 * The global year selector is a navigation control, not an archive shortcut.
 * main.js still owns the menu click flow, so apply the final year/route state in
 * a microtask after that handler finishes. This keeps both 2026 -> 2027 and
 * 2027 -> 2026 transitions anchored on the dashboard.
 */
function bindGlobalPeriodDashboardRouteGuard(root = document) {
  if (!root?.addEventListener || root.__dsGlobalPeriodDashboardRouteGuardBound) return;
  root.__dsGlobalPeriodDashboardRouteGuardBound = true;

  root.addEventListener('click', (event) => {
    const option = event.target?.closest?.('[data-global-period-option]');
    if (!option) return;

    const selected = normalizeGlobalActivityPeriod(option.getAttribute('data-global-period-option'));
    const applyFinalState = () => {
      setArchiveActivityPeriod(ACTIVE_ACTIVITY_SEASON);
      setGlobalActivityPeriod(selected);
      state.route = 'dashboard';
      clearScreenDataCache();
      syncGlobalActivityPeriodSelector(root, selected);
    };

    if (typeof queueMicrotask === 'function') queueMicrotask(applyFinalState);
    else Promise.resolve().then(applyFinalState);
  });
}

export function syncGlobalActivityPeriodSelector(root = document, activityPeriodValue = 'regular') {
  const current = normalizeGlobalActivityPeriod(activityPeriodValue);
  root.querySelectorAll?.('[data-global-period-toggle]').forEach((button) => {
    const isExpanded = button.getAttribute('aria-expanded') === 'true';
    button.textContent = globalActivityPeriodLabel(current);
    button.setAttribute('title', globalActivityPeriodFullLabel(current));
    button.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
  });
  root.querySelectorAll?.('[data-global-period-option]').forEach((option) => {
    const active = normalizeGlobalActivityPeriod(option.getAttribute('data-global-period-option')) === current;
    option.classList.toggle('is-active', active);
    option.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

bindGlobalPeriodDashboardRouteGuard();
