import { api } from './api.js';
import { state } from './state.js';

/**
 * Security boundary for system-administration screens.
 * Operational roles may manage activities, but only role=admin may view or mutate
 * users, permissions, system settings, and system lists.
 */
export const ADMIN_ONLY_ROUTES = Object.freeze([
  'permissions',
  'admin-home',
  'admin-settings',
  'admin-lists'
]);

export const ADMIN_ONLY_API_ACTIONS = Object.freeze([
  'permissions',
  'savePermission',
  'addUser',
  'deactivateUser',
  'reactivateUser',
  'deleteUser',
  'adminSettings',
  'adminLists',
  'listSheets',
  'saveSheetMapping'
]);

const adminOnlyRouteSet = new Set(ADMIN_ONLY_ROUTES);

export function hasResolvedUser(user = state?.user) {
  return Boolean(user && typeof user === 'object' && String(user?.role || user?.display_role || '').trim());
}

export function isSystemAdmin(user = state?.user || {}) {
  return String(user?.role || user?.display_role || '').trim() === 'admin';
}

export function sanitizeAdminOnlyRoutes(routes, user = state?.user || {}) {
  const source = Array.isArray(routes) ? routes : [];
  if (isSystemAdmin(user)) return [...source];
  return source.filter((route) => !adminOnlyRouteSet.has(String(route || '').trim()));
}

function safeDefaultRoute(routes = []) {
  if (routes.includes('dashboard')) return 'dashboard';
  return routes[0] || 'my-data';
}

export function sanitizeAdminBootstrapPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const user = payload.user || state?.user || {};
  if (isSystemAdmin(user)) return payload;

  const routes = sanitizeAdminOnlyRoutes(payload.routes, user);
  const requestedDefault = String(payload.default_route || '').trim();
  const defaultRoute = adminOnlyRouteSet.has(requestedDefault) || (requestedDefault && !routes.includes(requestedDefault))
    ? safeDefaultRoute(routes)
    : (requestedDefault || safeDefaultRoute(routes));

  return {
    ...payload,
    routes,
    default_route: defaultRoute
  };
}

function adminOnlyError(action = '') {
  const error = new Error('admin_only');
  error.code = 'admin_only';
  error.action = action;
  return error;
}

function wrapBootstrapAction(action) {
  const original = api[action];
  if (typeof original !== 'function' || original.__adminRouteGuardWrapped) return;
  const wrapped = async (...args) => sanitizeAdminBootstrapPayload(await original(...args));
  wrapped.__adminRouteGuardWrapped = true;
  api[action] = wrapped;
}

function wrapAdminOnlyApiAction(action) {
  const original = api[action];
  if (typeof original !== 'function' || original.__adminOnlyGuardWrapped) return;
  const wrapped = (...args) => {
    if (!isSystemAdmin()) throw adminOnlyError(action);
    return original(...args);
  };
  wrapped.__adminOnlyGuardWrapped = true;
  api[action] = wrapped;
}

function arraysEqual(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => value === b[index]);
}

function scrubStoredRoutes() {
  if (typeof localStorage === 'undefined' || !hasResolvedUser() || isSystemAdmin()) return;
  try {
    const raw = localStorage.getItem('dashboard_routes');
    if (!raw) return;
    const stored = JSON.parse(raw);
    const routes = sanitizeAdminOnlyRoutes(stored?.routes);
    const defaultRoute = adminOnlyRouteSet.has(String(stored?.defaultRoute || '').trim())
      ? safeDefaultRoute(routes)
      : stored?.defaultRoute;
    localStorage.setItem('dashboard_routes', JSON.stringify({ ...stored, routes, defaultRoute }));
  } catch {
    // Ignore malformed diagnostic cache; the live bootstrap remains authoritative.
  }
}

function scrubAdminRouteFromUrl() {
  if (typeof window === 'undefined' || !hasResolvedUser() || isSystemAdmin()) return;
  try {
    const url = new URL(window.location.href);
    const requestedRoute = String(url.searchParams.get('route') || '').trim();
    if (!adminOnlyRouteSet.has(requestedRoute)) return;
    url.searchParams.delete('route');
    window.history.replaceState({}, '', url);
    try { sessionStorage.removeItem('dashboard_pending_route'); } catch { /* ignore */ }
  } catch {
    // Ignore URL parsing failures.
  }
}

export function enforceAdminOnlyState() {
  if (!hasResolvedUser() || isSystemAdmin()) return false;
  let changed = false;

  const nextRoutes = sanitizeAdminOnlyRoutes(state?.routes);
  if (!arraysEqual(nextRoutes, state?.routes || [])) {
    state.routes = nextRoutes;
    changed = true;
  }

  const nextEffectiveRoutes = sanitizeAdminOnlyRoutes(state?.effectiveRoutes);
  if (!arraysEqual(nextEffectiveRoutes, state?.effectiveRoutes || [])) {
    state.effectiveRoutes = nextEffectiveRoutes;
    changed = true;
  }

  if (adminOnlyRouteSet.has(String(state?.route || '').trim())) {
    state.route = safeDefaultRoute(nextEffectiveRoutes.length ? nextEffectiveRoutes : nextRoutes);
    changed = true;
  }

  scrubStoredRoutes();
  scrubAdminRouteFromUrl();
  return changed;
}

function removeAdminOnlyNavigation() {
  if (typeof document === 'undefined' || !hasResolvedUser() || isSystemAdmin()) return;
  const selectors = ADMIN_ONLY_ROUTES.flatMap((route) => [
    `[data-route="${route}"]`,
    `[data-act-subnav="${route}"]`
  ]).join(',');
  document.querySelectorAll(selectors).forEach((element) => element.remove());
}

function enforceUiBoundary() {
  enforceAdminOnlyState();
  removeAdminOnlyNavigation();
}

wrapBootstrapAction('login');
wrapBootstrapAction('bootstrap');
ADMIN_ONLY_API_ACTIONS.forEach(wrapAdminOnlyApiAction);

enforceUiBoundary();

if (typeof document !== 'undefined') {
  document.addEventListener('click', (event) => {
    if (!hasResolvedUser() || isSystemAdmin()) return;
    const target = event.target?.closest?.('[data-route], [data-act-subnav]');
    const requestedRoute = String(target?.dataset?.route || target?.dataset?.actSubnav || '').trim();
    if (!adminOnlyRouteSet.has(requestedRoute)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    enforceUiBoundary();
  }, true);

  const observer = new MutationObserver(enforceUiBoundary);
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', enforceUiBoundary);
}
