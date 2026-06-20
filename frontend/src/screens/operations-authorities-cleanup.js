const AUTHORITIES_TAB_KEY = 'authorities';
const SCHOOLS_TAB_KEY = 'schools';
const SCHEDULE_TAB_KEY = 'instructors';
const FIXED_PERIOD = 'summer_2026';
const FIXED_FROM = '2026-06-15';
const FIXED_TO = '2026-08-31';
let operationsCleanupQueued = false;
let enforcingRange = false;

function getActiveOpsTab(root) {
  const active = root?.querySelector?.('.ds-ops-mgmt-tab.is-active[data-ops-tab]');
  return active?.getAttribute('data-ops-tab') || '';
}

function isAuthoritiesView(root) {
  const tab = getActiveOpsTab(root);
  return tab === AUTHORITIES_TAB_KEY || tab === SCHOOLS_TAB_KEY;
}

function isScheduleView(root) {
  return getActiveOpsTab(root) === SCHEDULE_TAB_KEY;
}

function ensureOperationsCleanupStyle() {
  if (document.getElementById('ops-authorities-cleanup-style')) return;
  const style = document.createElement('style');
  style.id = 'ops-authorities-cleanup-style';
  style.textContent = `
    .ds-ops-mgmt-screen .ds-filter-field--search {
      display: none !important;
    }
    .ds-ops-mgmt-screen.ops-authorities-clean .ds-ops-mgmt-summary-line,
    .ds-ops-mgmt-screen.ops-authorities-clean .ds-ops-schools-authority__stats,
    .ds-ops-mgmt-screen.ops-schedule-clean .ds-ops-mgmt-summary-line {
      display: none !important;
    }
  `;
  document.head.appendChild(style);
}

function resetHiddenSearch(root) {
  const searchInput = root?.querySelector?.('[data-ops-search]');
  if (!searchInput || searchInput.value === '') return;
  searchInput.value = '';
  searchInput.dispatchEvent(new Event('input', { bubbles: true }));
}

function setFieldValue(element, value) {
  if (!element || element.value === value) return false;
  element.value = value;
  element.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function enforceFixedOperationsRange(root) {
  if (!root || enforcingRange) return;
  enforcingRange = true;

  const periodSelect = root.querySelector('[data-ops-period]');
  if (periodSelect) {
    const hasSummerOption = Array.from(periodSelect.options || []).some((option) => option.value === FIXED_PERIOD);
    if (hasSummerOption) setFieldValue(periodSelect, FIXED_PERIOD);
  }

  setFieldValue(root.querySelector('[data-ops-date="from"]'), FIXED_FROM);
  setFieldValue(root.querySelector('[data-ops-date="to"]'), FIXED_TO);

  setTimeout(() => { enforcingRange = false; }, 0);
}

function cleanOperationsPage() {
  const root = document.querySelector('.ds-ops-mgmt-screen');
  if (!root) return;
  ensureOperationsCleanupStyle();
  resetHiddenSearch(root);
  enforceFixedOperationsRange(root);
  root.classList.toggle('ops-authorities-clean', isAuthoritiesView(root));
  root.classList.toggle('ops-schedule-clean', isScheduleView(root));
}

function scheduleOperationsCleanup() {
  if (operationsCleanupQueued) return;
  operationsCleanupQueued = true;
  setTimeout(() => {
    operationsCleanupQueued = false;
    cleanOperationsPage();
  }, 80);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleOperationsCleanup, { once: true });
  } else {
    scheduleOperationsCleanup();
  }
  new MutationObserver(scheduleOperationsCleanup).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-pressed', 'value'] });
}
