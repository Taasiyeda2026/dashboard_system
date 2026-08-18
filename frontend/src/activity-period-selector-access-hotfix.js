import { state, setGlobalActivityPeriod } from './state.js';
import {
  globalActivityPeriodFullLabel,
  globalActivityPeriodLabel,
  normalizeGlobalActivityPeriod
} from './screens/shared/summer-activity.js';
import { clearActivityPeriodScreenCache, resolveInitialActivityPeriod } from './activity-period-cutover.js';

function storedOrDefaultPeriod() {
  try {
    return resolveInitialActivityPeriod(localStorage);
  } catch {
    return { period: normalizeGlobalActivityPeriod(''), didCutover: false };
  }
}

function clearPeriodScreenCache() {
  clearActivityPeriodScreenCache(state.screenDataCache);
  state.archiveActivityPeriod = null;
}

function syncSelector(period) {
  const selected = normalizeGlobalActivityPeriod(period);
  document.querySelectorAll('[data-global-period-toggle]').forEach((button) => {
    button.textContent = globalActivityPeriodLabel(selected);
    button.setAttribute('title', globalActivityPeriodFullLabel(selected));
  });
  document.querySelectorAll('[data-global-period-option]').forEach((option) => {
    const active = normalizeGlobalActivityPeriod(option.getAttribute('data-global-period-option')) === selected;
    option.classList.toggle('is-active', active);
    option.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

function refreshCurrentRoute() {
  if (!state.token || !state.route || state.route === 'login') return;
  const route = state.route;
  state.route = '__period_switch__';
  document.dispatchEvent(new CustomEvent('app:navigate', { detail: { route } }));
}

const { period: initialPeriod, didCutover } = storedOrDefaultPeriod();
setGlobalActivityPeriod(initialPeriod, { persist: false });
if (didCutover) clearPeriodScreenCache();
state.archiveActivityPeriod = null;

// Run after the authenticated shell has had a chance to bind its navigation listener.
setTimeout(() => {
  syncSelector(state.activityPeriodTab);
  refreshCurrentRoute();
}, 250);

/**
 * Immediately close any open manager summary panel (e.g. "לוח מנהל פעילות").
 * This is a DOM-level overlay above the dashboard route whose `hidden` flag is
 * owned by dashboard.js, not by app state. A programmatic navigation to the
 * same route (dashboard → dashboard) does not recreate the DOM synchronously,
 * so we must close it here before handing off to the router.
 */
function closeSummaryPanels() {
  document.querySelectorAll('[data-summary-panel]').forEach((panel) => {
    if (panel.hidden) return; // already closed
    panel.hidden = true;
    const target = panel.dataset.summaryPanel;
    if (!target) return;
    const btn = document.querySelector(`[data-summary-target="${CSS.escape(target)}"]`);
    if (!btn) return;
    btn.textContent = 'סיכום';
    btn.classList.remove('is-active');
    btn.setAttribute('aria-expanded', 'false');
  });
}

document.addEventListener('click', (event) => {
  const option = event.target?.closest?.('[data-global-period-option]');
  if (!option) return;

  // Single source of truth for year/period switching.
  // Both 2026 and 2027 are live operational views — never redirect to archive.
  // stopImmediatePropagation prevents the legacy archive-routing in main.js
  // and the competing microtask in shell-period-selector.js from running.
  event.preventDefault();
  event.stopImmediatePropagation();

  const selected = normalizeGlobalActivityPeriod(option.getAttribute('data-global-period-option'));
  setGlobalActivityPeriod(selected);
  clearPeriodScreenCache();
  syncSelector(selected);

  // Close the manager summary panel immediately — synchronously, before any
  // async navigation, so the user never sees it stay open during the transition.
  closeSummaryPanels();

  const menu = option.closest('[data-global-period-wrap]')?.querySelector('[data-global-period-menu]');
  const toggle = option.closest('[data-global-period-wrap]')?.querySelector('[data-global-period-toggle]');
  if (menu) menu.hidden = true;
  if (toggle) toggle.setAttribute('aria-expanded', 'false');

  // Navigate to the dashboard. If the router's same-route guard would block it
  // (user already on dashboard), temporarily set route to '__period_switch__'
  // so the guard detects a change and re-renders fresh data.
  queueMicrotask(() => {
    if (!state.token || !state.route || state.route === 'login') return;
    if (state.route === 'dashboard') {
      // Force re-render even when already on dashboard so the period change
      // is reflected and any stale screen state is reset.
      state.route = '__period_switch__';
    }
    document.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: 'dashboard' } }));
  });
}, true);
