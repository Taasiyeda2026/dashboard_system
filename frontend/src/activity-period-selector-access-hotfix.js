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

document.addEventListener('click', (event) => {
  const option = event.target?.closest?.('[data-global-period-option]');
  if (!option) return;

  // Override the temporary cutover behavior that redirected 2026 directly to
  // the archive. Both 2026 and 2027 remain normal selectable operational views.
  event.preventDefault();
  event.stopImmediatePropagation();

  const selected = normalizeGlobalActivityPeriod(option.getAttribute('data-global-period-option'));
  setGlobalActivityPeriod(selected);
  clearPeriodScreenCache();
  syncSelector(selected);

  const menu = option.closest('[data-global-period-wrap]')?.querySelector('[data-global-period-menu]');
  const toggle = option.closest('[data-global-period-wrap]')?.querySelector('[data-global-period-toggle]');
  if (menu) menu.hidden = true;
  if (toggle) toggle.setAttribute('aria-expanded', 'false');

  queueMicrotask(refreshCurrentRoute);
}, true);
