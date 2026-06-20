const AUTHORITIES_TAB_KEY = 'authorities';
const SCHOOLS_TAB_KEY = 'schools';
let authoritiesCleanupQueued = false;

function getActiveOpsTab(root) {
  const active = root?.querySelector?.('.ds-ops-mgmt-tab.is-active[data-ops-tab]');
  return active?.getAttribute('data-ops-tab') || '';
}

function isAuthoritiesView(root) {
  const tab = getActiveOpsTab(root);
  return tab === AUTHORITIES_TAB_KEY || tab === SCHOOLS_TAB_KEY;
}

function ensureAuthoritiesCleanupStyle() {
  if (document.getElementById('ops-authorities-cleanup-style')) return;
  const style = document.createElement('style');
  style.id = 'ops-authorities-cleanup-style';
  style.textContent = `
    .ds-ops-mgmt-screen.ops-authorities-clean .ds-filter-field--search,
    .ds-ops-mgmt-screen.ops-authorities-clean .ds-ops-mgmt-summary-line,
    .ds-ops-mgmt-screen.ops-authorities-clean .ds-ops-schools-authority__stats {
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

function cleanAuthoritiesTab() {
  const root = document.querySelector('.ds-ops-mgmt-screen');
  if (!root) return;
  ensureAuthoritiesCleanupStyle();
  const active = isAuthoritiesView(root);
  root.classList.toggle('ops-authorities-clean', active);
  if (active) resetHiddenSearch(root);
}

function scheduleAuthoritiesCleanup() {
  if (authoritiesCleanupQueued) return;
  authoritiesCleanupQueued = true;
  setTimeout(() => {
    authoritiesCleanupQueued = false;
    cleanAuthoritiesTab();
  }, 80);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleAuthoritiesCleanup, { once: true });
  } else {
    scheduleAuthoritiesCleanup();
  }
  new MutationObserver(scheduleAuthoritiesCleanup).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-pressed'] });
}
