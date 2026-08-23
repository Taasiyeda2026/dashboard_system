// Prevent Operations home cards that stay inside operations-management from
// triggering the route-entry reset. The screen's own click handler already
// updates state, lazy-loads data where needed, and rerenders the current route.
// Re-dispatching app:navigate for the same route used to mark the screen for an
// entry reset, which immediately returned the user to the Operations home.

const INTERNAL_HOME_TARGET_TYPES = new Set(['ops-tab', 'ops-custom-tab']);
const INTERNAL_ROUTE = 'operations-management';
const PENDING_TTL_MS = 60000;

let pendingInternalNavigations = [];

function cleanupExpired(now = Date.now()) {
  pendingInternalNavigations = pendingInternalNavigations.filter((entry) => entry.expiresAt > now);
}

function markInternalHomeNavigation(event) {
  const target = event.target instanceof Element ? event.target : null;
  const tile = target?.closest?.('[data-operations-management-home] [data-ops-home-target-type]');
  if (!tile) return;

  const type = String(tile.getAttribute('data-ops-home-target-type') || '').trim();
  if (!INTERNAL_HOME_TARGET_TYPES.has(type)) return;

  cleanupExpired();
  pendingInternalNavigations.push({
    type,
    value: String(tile.getAttribute('data-ops-home-target-value') || '').trim(),
    expiresAt: Date.now() + PENDING_TTL_MS
  });
}

function suppressSameRouteReset(event) {
  cleanupExpired();
  if (!pendingInternalNavigations.length) return;
  const route = String(event?.detail?.route || '').trim();
  if (route !== INTERNAL_ROUTE) return;

  // Consume exactly one internal-card navigation. Stopping this same-route event
  // is intentional: the Operations screen handler continues immediately after
  // dispatchEvent() and performs its own rerender. External route cards are not
  // marked and therefore remain untouched.
  pendingInternalNavigations.shift();
  event.stopImmediatePropagation();
}

function installOperationsHomeNavigationHotfix() {
  if (typeof document === 'undefined') return;
  if (document.documentElement.dataset.opsHomeNavigationHotfix === '1') return;
  document.documentElement.dataset.opsHomeNavigationHotfix = '1';
  document.addEventListener('click', markInternalHomeNavigation, true);
  document.addEventListener('app:navigate', suppressSameRouteReset, true);
}

installOperationsHomeNavigationHotfix();

export {
  INTERNAL_HOME_TARGET_TYPES,
  INTERNAL_ROUTE,
  markInternalHomeNavigation,
  suppressSameRouteReset,
  installOperationsHomeNavigationHotfix
};
