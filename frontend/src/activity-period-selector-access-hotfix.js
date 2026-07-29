import { state, setGlobalActivityPeriod } from './state.js';
import {
  ACTIVITY_SEASON_REGULAR,
  GLOBAL_ACTIVITY_PERIOD_STORAGE_KEY,
  globalActivityPeriodFullLabel,
  globalActivityPeriodLabel,
  isValidGlobalActivityPeriod,
  normalizeGlobalActivityPeriod
} from './screens/shared/summer-activity.js';

function storedOrCurrentPeriod() {
  try {
    const stored = localStorage.getItem(GLOBAL_ACTIVITY_PERIOD_STORAGE_KEY) || '';
    if (isValidGlobalActivityPeriod(stored)) return normalizeGlobalActivityPeriod(stored);
  } catch {
    /* ignore storage failures */
  }
  const current = normalizeGlobalActivityPeriod(state.activityPeriodTab);
  return current || ACTIVITY_SEASON_REGULAR;
}

function clearPeriodScreenCache() {
  state.screenDataCache = {};
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

// 2026 remains fully accessible until an explicit operational cutover is approved.
const initialPeriod = storedOrCurrentPeriod();
setGlobalActivityPeriod(initialPeriod, { persist: false });
state.archiveActivityPeriod = null;

// Run after the authenticated shell has had a chance to bind its navigation listener.
setTimeout(() => {
  syncSelector(state.activityPeriodTab);
  refreshCurrentRoute();
}, 250);

document.addEventListener('click', (event) => {
  const option = event.target?.closest?.('[data-global-period-option]');
  if (!option) return;

  // Override the temporary cutover behavior that redirected every historical
  // period to the archive. Both 2026 and 2027 must remain normal selectable
  // operational views until the cutover is explicitly activated.
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
