import { globalActivityPeriodFullLabel, globalActivityPeriodLabel, normalizeGlobalActivityPeriod } from './summer-activity.js';

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
