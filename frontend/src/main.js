import { api } from './api.js';
import { state, setSession, defaultClientSettings } from './state.js';
import { SCREEN_CACHE_STORAGE_PREFIX, persistCacheEntry } from './cache-persist.js';
import { escapeHtml } from './screens/shared/html.js';
import { hebrewRole, translateApiErrorForUser } from './screens/shared/ui-hebrew.js';
import { createSharedInteractionLayer } from './screens/shared/interactions.js';
import { headerNavGridHtml } from './screens/shared/act-nav-grid.js';
import { loginScreen } from './screens/login.js';
import { dashboardScreen } from './screens/dashboard.js';
import { activitiesScreen } from './screens/activities.js';
import { weekScreen } from './screens/week.js';
import { monthScreen } from './screens/month.js';
import { exceptionsScreen } from './screens/exceptions.js';
import { financeScreen } from './screens/finance.js';
import { instructorsScreen } from './screens/instructors.js';
import { instructorContactsScreen } from './screens/instructor-contacts.js';
import { contactsScreen } from './screens/contacts.js';
import { endDatesScreen } from './screens/end-dates.js';
import { myDataScreen } from './screens/my-data.js';
import { operationsScreen } from './screens/operations.js';
import { editRequestsScreen } from './screens/edit-requests.js';
import { permissionsScreen } from './screens/permissions.js';

const app = document.getElementById('app');
const loginLogoSrc  = new URL('../assets/logo1.png',      import.meta.url).href;
const systemLogoSrc = new URL('../assets/logo_system.png', import.meta.url).href;

let isMobileNavOpen = false;
let lastRenderedRoute = null;
let loginInlineError = '';
let hasMountedAuthenticatedShell = false;
const ui = createSharedInteractionLayer();

/** In-flight API request dedup: prevents duplicate calls when navigating quickly. */
const inflightRequests = new Map();
const PERF_MAX_RENDERS = 150;

/** Timer handle for deferred prefetch — cancelled on every new navigation. */
let prefetchTimer = null;
let prefetchIdleId = null;
let firstAuthenticatedRenderTimerStarted = false;
let firstLoadTimerStarted = false;
let firstDashboardSnapshotTimerStarted = false;
let firstPrefetchTimerStarted = false;
let fastRerenderVersion = 0;
let navigationToken = 0;
let activeNavigationToken = 0;
let latestNavigationRoute = '';
let activeRouteTransitionLabel = null;
const activeConsoleTimers = new Set();

function beginPerfTimer(label) {
  if (!label || typeof console === 'undefined' || typeof console.time !== 'function') return;
  if (activeConsoleTimers.has(label)) return;
  activeConsoleTimers.add(label);
  console.time(label);
}

function endPerfTimer(label) {
  if (!label || typeof console === 'undefined' || typeof console.timeEnd !== 'function') return;
  if (!activeConsoleTimers.has(label)) return;
  activeConsoleTimers.delete(label);
  console.timeEnd(label);
}

function scheduleRender() {
  beginPerfTimer('login:scheduleRender');
  const complete = () => {
    endPerfTimer('login:scheduleRender');
    render().catch(() => {});
  };
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(complete);
    return;
  }
  setTimeout(complete, 0);
}

function cancelPrefetchSchedule() {
  clearTimeout(prefetchTimer);
  prefetchTimer = null;
  if (typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function' && prefetchIdleId != null) {
    window.cancelIdleCallback(prefetchIdleId);
  }
  prefetchIdleId = null;
}

function schedulePostLoginPrefetch() {
  cancelPrefetchSchedule();
  const run = () => {
    prefetchTimer = null;
    prefetchIdleId = null;
    if (!state.token) return;
    if (_isRendering || _pendingRender) return;
    if (!firstPrefetchTimerStarted) {
      firstPrefetchTimerStarted = true;
      beginPerfTimer('prefetch:firstRun');
      try {
        prefetchFromDashboardIfNeeded();
      } finally {
        endPerfTimer('prefetch:firstRun');
      }
      return;
    }
    prefetchFromDashboardIfNeeded();
  };

  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    prefetchIdleId = window.requestIdleCallback(run, { timeout: 5000 });
    return;
  }
  prefetchTimer = setTimeout(run, 5000);
}

function recordRenderPerf(route, phase, durationMs, extra = {}) {
  if (typeof window === 'undefined') return;
  if (!window.__dsPerf) {
    window.__dsPerf = { requests: [], renders: [], screens: {} };
    window.__resetDsPerf = () => {
      window.__dsPerf = { requests: [], renders: [], screens: {} };
    };
  }
  const entry = {
    route: String(route || 'unknown'),
    phase: String(phase || 'render'),
    duration_ms: Math.round(durationMs),
    at: new Date().toISOString(),
    ...extra
  };
  window.__dsPerf.renders.push(entry);
  if (window.__dsPerf.renders.length > PERF_MAX_RENDERS) {
    window.__dsPerf.renders.splice(0, window.__dsPerf.renders.length - PERF_MAX_RENDERS);
  }
  if (entry.duration_ms >= 120) {
    // eslint-disable-next-line no-console
    console.warn('[perf][render] heavy render', entry);
  }
}

function perfStore() {
  if (typeof window === 'undefined') return null;
  if (!window.__dsPerf) {
    window.__dsPerf = { requests: [], renders: [], screens: {} };
    window.__resetDsPerf = () => {
      window.__dsPerf = { requests: [], renders: [], screens: {} };
    };
  }
  if (!window.__dsPerf.navigation) {
    window.__dsPerf.navigation = {
      transitions: [],
      duplicate_requests: [],
      heavy_renders: []
    };
  }
  return window.__dsPerf;
}

function pushDuplicateRequestPerf(cacheKey, route) {
  const store = perfStore();
  if (!store) return;
  store.navigation.duplicate_requests.push({
    cache_key: cacheKey,
    route: String(route || ''),
    at: new Date().toISOString()
  });
  if (store.navigation.duplicate_requests.length > PERF_MAX_RENDERS) {
    store.navigation.duplicate_requests.splice(0, store.navigation.duplicate_requests.length - PERF_MAX_RENDERS);
  }
}

function pushRouteTransitionPerf(entry) {
  const store = perfStore();
  if (!store) return;
  store.navigation.transitions.push({
    ...entry,
    at: new Date().toISOString()
  });
  if (store.navigation.transitions.length > PERF_MAX_RENDERS) {
    store.navigation.transitions.splice(0, store.navigation.transitions.length - PERF_MAX_RENDERS);
  }
}

function finishRouteTransition(transitionLabel, requestedRoute, cacheKey, mountStartMs, transitionToken) {
  recordRenderPerf(requestedRoute, 'mount-total', performance.now() - mountStartMs, { cache_key: cacheKey });
  pushRouteTransitionPerf({
    route: requestedRoute,
    cache_key: cacheKey,
    duration_ms: Math.round(performance.now() - mountStartMs),
    token: transitionToken
  });
  if (activeRouteTransitionLabel === transitionLabel) {
    endPerfTimer(transitionLabel);
    endPerfTimer('route:transition');
    activeRouteTransitionLabel = null;
  }
}

// ─── LocalStorage screen-data cache ───────────────────────────────────────
// Keys include a user-id prefix so different users on the same browser don't
// share data. Entries survive page reloads so the first navigation after a
// refresh shows cached content immediately (stale-while-revalidate handles
// the async refresh in the background).
// persistCacheEntry and SCREEN_CACHE_STORAGE_PREFIX are imported from ./cache-persist.js
const SCREEN_CACHE_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours — after this ignore stored entry

function _storageKey() {
  const uid = state.user?.user_id || 'anon';
  return `${SCREEN_CACHE_STORAGE_PREFIX}:${uid}`;
}

function persistCacheDelete(key) {
  try {
    const raw = localStorage.getItem(_storageKey());
    if (!raw) return;
    const stored = JSON.parse(raw);
    delete stored[key];
    localStorage.setItem(_storageKey(), JSON.stringify(stored));
  } catch { /* ignore */ }
}

function restoreScreenCacheFromStorage() {
  try {
    const raw = localStorage.getItem(_storageKey());
    if (!raw) return;
    const stored = JSON.parse(raw);
    const now = Date.now();
    let changed = false;
    Object.entries(stored).forEach(([k, v]) => {
      if (!v || !v.t) return;
      if (MEMORY_ONLY_CACHE_PREFIXES.some((prefix) => k.startsWith(prefix))) {
        delete stored[k];
        changed = true;
        return;
      }
      if (now - v.t > SCREEN_CACHE_MAX_AGE_MS) { delete stored[k]; changed = true; return; }
      if (!state.screenDataCache[k]) {
        state.screenDataCache[k] = v;
      }
    });
    if (changed) localStorage.setItem(_storageKey(), JSON.stringify(stored));
  } catch { /* ignore */ }
}

function clearStorageCache() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(SCREEN_CACHE_STORAGE_PREFIX))
      .forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

function isDesktopViewport() {
  return typeof window !== 'undefined' && window.matchMedia('(min-width: 960px)').matches;
}

function flushPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(resolve);
    });
  });
}

function screenLoadingMarkup() {
  if (state.route === 'activities') {
    return `
      <div class="ds-loading-card" dir="rtl" role="status" aria-live="polite">
        <p>טוען פעילויות…</p>
        <div class="ds-skeleton" aria-hidden="true">
          <div class="ds-skeleton-line"></div>
          <div class="ds-skeleton-line"></div>
          <div class="ds-skeleton-line"></div>
          <div class="ds-skeleton-line ds-skeleton-line--short"></div>
        </div>
      </div>
    `;
  }
  if (state.route === 'week') {
    return `
      <div class="ds-loading-card" dir="rtl" role="status" aria-live="polite">
        <p>טוען שבוע…</p>
        <div class="ds-skeleton" aria-hidden="true">
          <div class="ds-skeleton-line"></div>
          <div class="ds-skeleton-line"></div>
          <div class="ds-skeleton-line"></div>
        </div>
      </div>
    `;
  }
  return `
    <div class="ds-loading-card" dir="rtl" role="status" aria-live="polite">
      <div class="ds-spinner" aria-hidden="true"></div>
      <p>טוען נתונים...</p>
    </div>
  `;
}

/* ——— Route snapshot in localStorage (diagnostic only) ——— */
function saveRoutesToStorage(routes, defaultRoute, clientSettings) {
  try {
    localStorage.setItem('dashboard_routes', JSON.stringify({
      routes,
      defaultRoute,
      clientSettings: clientSettings || {}
    }));
  } catch {}
}

function applyBootstrapFromLoginData(data) {
  if (!data || !Array.isArray(data.routes) || !data.routes.length) return;
  if (data.client_settings && typeof data.client_settings === 'object') {
    state.clientSettings = { ...defaultClientSettings(), ...data.client_settings };
  }
  const effectiveRoutes = applySettingsToRoutes(data.routes, state.clientSettings);
  state.routes = effectiveRoutes;
  state.effectiveRoutes = effectiveRoutes;
  state.route = resolveAllowedDefaultRoute(data.default_route, effectiveRoutes);
  saveRoutesToStorage(state.routes, state.route, state.clientSettings);
}

const screenLabels = {
  dashboard: 'לוח בקרה',
  activities: 'פעילויות',
  week: 'שבוע',
  month: 'חודש',
  exceptions: 'חריגות',
  finance: 'כספים',
  instructors: 'מדריכים',
  'instructor-contacts': 'אנשי קשר מדריכים',
  contacts: 'אנשי קשר',
  'end-dates': 'תאריכי סיום',
  'my-data': 'הנתונים שלי',
  operations: 'תפעול',
  'edit-requests': 'אישורים',
  permissions: 'הרשאות'
};

const screens = {
  dashboard: dashboardScreen,
  activities: activitiesScreen,
  week: weekScreen,
  month: monthScreen,
  exceptions: exceptionsScreen,
  finance: financeScreen,
  instructors: instructorsScreen,
  'instructor-contacts': instructorContactsScreen,
  contacts: contactsScreen,
  'end-dates': endDatesScreen,
  'my-data': myDataScreen,
  operations: operationsScreen,
  'edit-requests': editRequestsScreen,
  permissions: permissionsScreen
};

function navSidebarHiddenRoutesSet() {
  const list = state?.clientSettings?.navigation?.sidebar_hidden_routes;
  return new Set(Array.isArray(list) ? list : []);
}

const DEFAULT_CONTEXTUAL_ROUTES = ['week', 'month', 'instructors', 'end-dates', 'exceptions'];

function navContextualRoutesSet() {
  const list = state?.clientSettings?.navigation?.contextual_only_routes;
  return new Set(Array.isArray(list) ? list : DEFAULT_CONTEXTUAL_ROUTES);
}

function navDisabledRoutesSet(settings = state.clientSettings) {
  const list = settings?.navigation?.disabled_routes;
  return new Set(Array.isArray(list) ? list : []);
}

function applySettingsToRoutes(routes, settings = state.clientSettings) {
  const blocked = navDisabledRoutesSet(settings);
  const seen = new Set();
  return (Array.isArray(routes) ? routes : []).filter((route) => {
    if (!route || blocked.has(route) || seen.has(route)) return false;
    if (!screens[route]) return false;
    seen.add(route);
    return true;
  });
}

function effectiveRoutes() {
  if (Array.isArray(state.effectiveRoutes) && state.effectiveRoutes.length) return state.effectiveRoutes;
  return Array.isArray(state.routes) ? state.routes : [];
}

function isAllowedRoute(route) {
  return !!route && effectiveRoutes().includes(route);
}

function resolveAllowedDefaultRoute(preferred, routes) {
  const knownRoutes = Array.isArray(routes) ? routes.filter((r) => !!screens[r]) : [];
  if (preferred && screens[preferred] && knownRoutes.includes(preferred)) return preferred;
  return knownRoutes[0] || 'my-data';
}

function systemNameRaw() {
  return String(state?.clientSettings?.system_name || 'Dashboard Taasiyeda').trim() || 'Dashboard Taasiyeda';
}

function systemNameDisplay() {
  const raw = systemNameRaw();
  if (raw === 'Dashboard Taasiyeda') return 'דשבורד תעשיידע';
  return raw;
}

function shellUserDisplayName() {
  const fn = state.user?.full_name != null ? String(state.user.full_name).trim() : '';
  return escapeHtml(fn || 'משתמש');
}

function shellUserRoleLine() {
  const r2 = state.user?.display_role2 != null ? String(state.user.display_role2).trim() : '';
  if (r2) return escapeHtml(r2);
  return escapeHtml(hebrewRole(state.user?.display_role || state.user?.role));
}

// מסכים אלו מגיעים מניווט גריד בלבד — לא מוצגים בסרגל הצד
const ACTIVITIES_CHILD_ROUTES = new Set(['week', 'month', 'instructors', 'end-dates', 'exceptions', 'instructor-contacts']);

function shell(content) {
  const hiddenSet = navSidebarHiddenRoutesSet();
  const contextualSet = navContextualRoutesSet();
  const isAdminUser = state?.user?.display_role === 'admin' || state?.user?.display_role === 'operation_manager';
  // לאדמין: הנתונים שלי — מוסתר לחלוטין; הרשאות — בסרגל בלבד
  const adminSidebarExclude = isAdminUser ? new Set(['my-data']) : new Set();
  const nav = effectiveRoutes()
    .filter((route) =>
      !hiddenSet.has(route) &&
      !contextualSet.has(route) &&
      !ACTIVITIES_CHILD_ROUTES.has(route) &&
      !adminSidebarExclude.has(route)
    )
    .map(
      (route) =>
        `<button type="button" class="shell-nav__btn ${route === state.route ? 'is-active' : ''}" data-route="${route}">${screenLabels[route] || 'מסך'}</button>`
    )
    .join('');

  const displayName = shellUserDisplayName();
  const roleLine = shellUserRoleLine();
  const drawerClass = isMobileNavOpen ? ' is-mobile-nav-open' : '';
  const drawerHidden = !isDesktopViewport() && !isMobileNavOpen ? 'true' : 'false';
  const drawerExpanded = isMobileNavOpen ? 'true' : 'false';

  const systemName = escapeHtml(systemNameDisplay());

  const adminHeaderExclude = isAdminUser ? new Set(['operations', 'my-data', 'finance', 'permissions']) : new Set();
  const headerNavHtml = headerNavGridHtml({
    route: state.route,
    routes: effectiveRoutes().filter((r) => !adminHeaderExclude.has(r))
  });

  return `
    <div class="app-shell${drawerClass} route-${escapeHtml(String(state.route || ''))}" data-current-route="${escapeHtml(String(state.route || ''))}" dir="rtl">
      <button type="button" class="shell-backdrop" data-mobile-close aria-label="סגירת תפריט"></button>
      <aside class="shell-sidebar" aria-label="ניווט ראשי" id="mobileNavDrawer" aria-hidden="${drawerHidden}">
        <div class="shell-sidebar__mobile-head">
          <span class="shell-sidebar__mobile-brand">${systemName}</span>
          <button type="button" class="shell-close-btn" data-mobile-close aria-label="סגירת תפריט">✕</button>
        </div>
        <div class="shell-brand">
          <img class="shell-brand__mark" src="${systemLogoSrc}" alt="" width="120" height="52" decoding="async" />
          <div class="shell-sidebar__user" aria-label="משתמש מחובר">
            <span class="shell-sidebar__user-name">${displayName}</span>
            <span class="shell-sidebar__user-role">${roleLine}</span>
          </div>
        </div>
        <hr class="shell-sidebar__divider" />
        <nav class="shell-nav">${nav}</nav>
      </aside>
      <div class="shell-main">
        <header class="shell-top">
          <div class="shell-top__start">
            <button
              type="button"
              class="shell-menu-btn"
              id="mobileMenuBtn"
              aria-controls="mobileNavDrawer"
              aria-expanded="${drawerExpanded}"
              aria-label="פתיחת תפריט ניווט"
            >
              <span aria-hidden="true">☰</span>
            </button>
            <p class="shell-top__mobile-brand">${screenLabels[state.route] || systemName}</p>
          </div>
          ${headerNavHtml}
          <div class="shell-top__end">
            <button type="button" class="shell-logout-btn" id="logoutBtn" aria-label="התנתקות" title="התנתקות">
              <span aria-hidden="true">⏻</span>
            </button>
          </div>
        </header>
        <div class="shell-stage">
          <div id="screenRoot" class="screen-root">${content}</div>
        </div>
      </div>
    </div>
  `;
}

function setMobileNavOpen(open) {
  isMobileNavOpen = !!open;
  document.body.classList.toggle('is-shell-nav-open', isMobileNavOpen && !isDesktopViewport());
  const shellNode = document.querySelector('.app-shell');
  if (!shellNode) return;
  shellNode.classList.toggle('is-mobile-nav-open', isMobileNavOpen);
  const drawer = shellNode.querySelector('.shell-sidebar');
  if (drawer) {
    drawer.setAttribute('aria-hidden', !isDesktopViewport() && !isMobileNavOpen ? 'true' : 'false');
  }
  const menuBtn = shellNode.querySelector('#mobileMenuBtn');
  if (menuBtn) {
    menuBtn.setAttribute('aria-expanded', isMobileNavOpen ? 'true' : 'false');
  }
}

function closeMobileNav() {
  if (!isMobileNavOpen) return;
  setMobileNavOpen(false);
}

function buildScreenDataCacheKey(route, cacheState = state) {
  if (route === 'activities') {
    return 'activities:all';
  }
  if (route === 'finance') {
    const filters = {
      dateFrom: cacheState.financeDateFrom || '',
      dateTo: cacheState.financeDateTo || '',
      search: cacheState.financeSearch || '',
      status: cacheState.financeStatusFilter || '',
      tab: cacheState.financeTab || 'active',
      ym: cacheState.financeMonthYm || ''
    };
    return `finance:${JSON.stringify(filters)}`;
  }
  if (route === 'operations') {
    return `operations:${cacheState.operationsSearch || ''}:${cacheState.operationsActivityType || ''}`;
  }
  if (route === 'dashboard') {
    const ym = cacheState.dashboardMonthYm && /^\d{4}-\d{2}$/.test(cacheState.dashboardMonthYm) ? cacheState.dashboardMonthYm : 'default';
    return `dashboard:${ym}`;
  }
  if (route === 'week') {
    return `week:${cacheState.weekOffset || 0}`;
  }
  if (route === 'month') {
    const ym = cacheState.monthYm && /^\d{4}-\d{2}$/.test(cacheState.monthYm) ? cacheState.monthYm : 'current';
    return `month:${ym}`;
  }
  return route;
}

function screenDataCacheKey() {
  return buildScreenDataCacheKey(state.route, state);
}

/**
 * מסכים שבהם הנתונים משתנים לעיתים תכופות — TTL קצר יותר.
 * שאר המסכים מקבלים TTL של 15 דקות.
 */
const SCREEN_CACHE_TTL_MS = {
  dashboard: 5 * 60 * 1000,
  activities: 5 * 60 * 1000,
  week: 8 * 60 * 1000,
  month: 8 * 60 * 1000,
  exceptions: 8 * 60 * 1000,
};
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;

function screenCacheTtl() {
  return SCREEN_CACHE_TTL_MS[state.route] ?? DEFAULT_CACHE_TTL_MS;
}
const MEMORY_ONLY_CACHE_PREFIXES = [
  'activities:',
  'month:',
  'week:',
  'finance:',
  'activityDetail:',
  'operations:'
];

const MAX_PERSISTED_CACHE_ENTRY_BYTES = 80000;

function shouldPersistScreenCacheEntry(key, entry) {
  const cacheKey = String(key || '');

  if (MEMORY_ONLY_CACHE_PREFIXES.some((prefix) => cacheKey.startsWith(prefix))) {
    return false;
  }

  try {
    return JSON.stringify(entry || {}).length <= MAX_PERSISTED_CACHE_ENTRY_BYTES;
  } catch {
    return false;
  }
}

function maybePersistScreenCacheEntry(key, entry) {
  if (!shouldPersistScreenCacheEntry(key, entry)) return;
  persistCacheEntry(key, entry);
}
/**
 * Returns cached data immediately if available and fresh (within TTL).
 * Deduplicates in-flight requests so rapid navigation doesn't fire duplicate API calls.
 */
async function loadScreenDataWithCache(screen) {
  if (!screen.load) return {};
  const key = screenDataCacheKey();
  const hit = state.screenDataCache[key];
  if (hit && Date.now() - hit.t < screenCacheTtl()) return hit.data;

  if (inflightRequests.has(key)) {
    pushDuplicateRequestPerf(key, state.route);
    return inflightRequests.get(key);
  }

  const p = screen.load({ api, state })
    .then((data) => {
      const entry = { data, t: Date.now() };
      state.screenDataCache[key] = entry;
      maybePersistScreenCacheEntry(key, entry);
      inflightRequests.delete(key);
      return data;
    })
    .catch((err) => {
      inflightRequests.delete(key);
      throw err;
    });
  inflightRequests.set(key, p);
  return p;
}

/**
 * Background refresh — fetches fresh data after showing stale cache.
 * Updates UI silently if the user is still on the same screen.
 */
async function backgroundRefreshScreen(screen, cacheKey) {
  if (!screen.load) return;
  if (inflightRequests.has(cacheKey)) return;
  delete state.screenDataCache[cacheKey];
  const guardedToken = activeNavigationToken;
  const guardedRoute = state.route;
  try {
    const p = screen.load({ api, state });
    inflightRequests.set(cacheKey, p);
    const data = await p;
    inflightRequests.delete(cacheKey);
    const entry = { data, t: Date.now() };
    state.screenDataCache[cacheKey] = entry;
    maybePersistScreenCacheEntry(cacheKey, entry);
    if (
      activeNavigationToken === guardedToken &&
      state.route === guardedRoute &&
      screenDataCacheKey() === cacheKey
    ) {
      const screenRoot = document.getElementById('screenRoot');
      if (screenRoot) {
        const renderStart = performance.now();
        screenRoot.innerHTML = screen.render(data, { state });
        bindScreen(screen, screenRoot, data);
        recordRenderPerf(state.route, 'background-refresh-render', performance.now() - renderStart, {
          cache_key: cacheKey
        });
      }
    }
  } catch {
    inflightRequests.delete(cacheKey);
  }
}

function prefetchFromDashboardIfNeeded() {
  // Prefetch disabled — heavy screens (activities/week/month) are loaded on demand only.
}

function maybePrefetchFromDashboard() {
  if (!hasMountedAuthenticatedShell) return;
  if (_isRendering || _pendingRender) return;
  schedulePostLoginPrefetch();
}

function setShellNavBusy(busy) {
  document.querySelectorAll('.app-shell [data-route]').forEach((b) => {
    b.disabled = busy;
  });
  document.querySelector('.app-shell')?.classList.toggle('is-route-loading', busy);
}

function updateNavActiveClasses() {
  const shellNode = document.querySelector('.app-shell');
  if (shellNode) {
    Array.from(shellNode.classList).forEach((cls) => {
      if (cls.startsWith('route-')) shellNode.classList.remove(cls);
    });
    const routeClass = `route-${String(state.route || '')}`;
    shellNode.classList.add(routeClass);
    shellNode.setAttribute('data-current-route', String(state.route || ''));
  }
  document.querySelectorAll('[data-route]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.route === state.route);
  });
  const mobileBrand = document.querySelector('.shell-top__mobile-brand');
  if (mobileBrand) {
    mobileBrand.textContent = screenLabels[state.route] || systemNameDisplay();
  }
  document.body.classList.toggle('pref-compact-layout', !!state?.clientSettings?.compact_layout_preferred);
  document.body.classList.toggle('pref-narrow-boxes', !!state?.clientSettings?.narrow_boxes_preferred);
  document.body.classList.toggle('pref-emoji-ui', !!state?.clientSettings?.prefer_emoji_over_wide_boxes);
  document.body.classList.toggle('pref-hebrew-only', !!state?.clientSettings?.hebrew_only_headers);
  document.title = systemNameRaw();
}

/**
 * Fast re-render for same-route filter/search changes.
 * Uses cached data immediately; if cache is missing, fetches in place
 * (same screen root) to avoid full-shell reload/spinner.
 */
async function fastRerenderScreen(screen, routeAtBind) {
  const rerenderVersion = ++fastRerenderVersion;
  const rerenderToken = activeNavigationToken;
  const perfStart = performance.now();
  if (state.route !== routeAtBind) { render(); return; }
  const key = screenDataCacheKey();
  const raw = state.screenDataCache[key];
  const hit = raw && Date.now() - raw.t < screenCacheTtl() ? raw : null;
  const screenRoot = document.getElementById('screenRoot');
  if (!screenRoot) { render(); return; }
  if (!hit) {
    if (!screen.load) { render(); return; }
    const requestedKey = key;
    try {
      const data = await loadScreenDataWithCache(screen);
      if (rerenderVersion !== fastRerenderVersion) return;
      if (rerenderToken !== activeNavigationToken) return;
      if (state.route !== routeAtBind) return;
      if (screenDataCacheKey() !== requestedKey) return;
      screenRoot.innerHTML = screen.render(data, { state });
      bindScreen(screen, screenRoot, data);
      recordRenderPerf(routeAtBind, 'fast-rerender-fetch', performance.now() - perfStart, { cache_key: requestedKey });
      maybePrefetchFromDashboard();
    } catch {
      render();
    }
    return;
  }
  screenRoot.innerHTML = screen.render(hit.data, { state });
  if (rerenderToken !== activeNavigationToken) return;
  bindScreen(screen, screenRoot, hit.data);
  recordRenderPerf(routeAtBind, 'fast-rerender', performance.now() - perfStart, { cache_key: key });
}

function clearScreenDataCache() {
  const deletedKeys = [];
  if (state.route === 'activities') {
    Object.keys(state.screenDataCache).forEach((key) => {
      if (key.startsWith('activities:')) { delete state.screenDataCache[key]; deletedKeys.push(key); }
    });
  } else if (state.route === 'finance') {
    Object.keys(state.screenDataCache).forEach((key) => {
      if (key.startsWith('finance:')) { delete state.screenDataCache[key]; deletedKeys.push(key); }
    });
  } else {
    const k = screenDataCacheKey();
    delete state.screenDataCache[k];
    deletedKeys.push(k);
  }
  Object.keys(state.screenDataCache).forEach((key) => {
    if (key.startsWith('dashboard:') || key.startsWith('week:') || key.startsWith('month:')) {
      delete state.screenDataCache[key];
      deletedKeys.push(key);
    }
  });
  deletedKeys.forEach(persistCacheDelete);
}

function bindScreen(screen, screenRoot, data) {
  const routeAtBind = state.route;
  screen.bind?.({
    root: screenRoot,
    data,
    state,
    api,
    ui,
    rerender: () => fastRerenderScreen(screen, routeAtBind),
    rerenderActivitiesView: () => rerenderActivitiesViewOnly(screen, screenRoot),
    clearScreenDataCache
  });
}

function rerenderActivitiesViewOnly(screen, screenRoot) {
  if (state.route !== 'activities') {
    render();
    return;
  }
  const key = screenDataCacheKey();
  const raw = state.screenDataCache[key];
  const hit = raw && Date.now() - raw.t < screenCacheTtl() ? raw : null;
  if (!hit) {
    render();
    return;
  }
  screenRoot.innerHTML = screen.render(hit.data, { state });
  bindScreen(screen, screenRoot, hit.data);
}

/**
 * Synchronously restores routes + screen cache from localStorage.
 * Returns true when routes were successfully loaded.
 * Used for instant paint on page refresh — bootstrap then runs in the background.
 */
function tryRestoreRoutesInstant() {
  if (!state.token) return false;
  if (state.routes.length) return true;
  try {
    const raw = localStorage.getItem('dashboard_routes');
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (!saved || !Array.isArray(saved.routes) || !saved.routes.length) return false;
    if (saved.clientSettings && typeof saved.clientSettings === 'object') {
      state.clientSettings = { ...defaultClientSettings(), ...saved.clientSettings };
    }
    const effectiveR = applySettingsToRoutes(saved.routes, state.clientSettings);
    state.routes = effectiveR;
    state.effectiveRoutes = effectiveR;
    state.route = resolveAllowedDefaultRoute(saved.defaultRoute || '', effectiveR);
    restoreScreenCacheFromStorage();
    return true;
  } catch { return false; }
}

/**
 * Fetches a fresh bootstrap in the background and silently updates state.
 * Called after instant-restore so permissions/profile stay up to date.
 * If the current route is no longer allowed after the update, re-renders.
 */
function backgroundSyncBootstrap() {
  if (!state.token) return;
  api.bootstrap().then((bootstrap) => {
    if (bootstrap.client_settings && typeof bootstrap.client_settings === 'object') {
      state.clientSettings = { ...defaultClientSettings(), ...bootstrap.client_settings };
    }
    const normalizedRoutes = applySettingsToRoutes(bootstrap.routes || [], state.clientSettings);
    state.routes = normalizedRoutes;
    state.effectiveRoutes = normalizedRoutes;
    const newDefault = resolveAllowedDefaultRoute(bootstrap.default_route, normalizedRoutes);
    saveRoutesToStorage(state.routes, newDefault, state.clientSettings);
    if (bootstrap.profile && state.user) {
      const fn = bootstrap.profile.full_name != null ? String(bootstrap.profile.full_name).trim() : '';
      if (fn) state.user.full_name = fn;
      state.user.display_role2 =
        bootstrap.profile.display_role2 != null ? String(bootstrap.profile.display_role2) : '';
      state.user.can_add_activity = !!bootstrap.can_add_activity;
      state.user.can_edit_direct = !!bootstrap.can_edit_direct;
      state.user.can_request_edit = !!bootstrap.can_request_edit;
      localStorage.setItem('dashboard_user', JSON.stringify(state.user));
    }
    if (!isAllowedRoute(state.route)) {
      state.route = newDefault;
      render().catch(() => {});
    } else {
      updateNavActiveClasses();
    }
  }).catch(() => {});
}

async function restoreSession() {
  if (!state.token) return;
  if (state.routes.length) return;

  restoreScreenCacheFromStorage();
  const bootstrap = await api.bootstrap();
  if (bootstrap.client_settings && typeof bootstrap.client_settings === 'object') {
    state.clientSettings = { ...defaultClientSettings(), ...bootstrap.client_settings };
  }
  const normalizedRoutes = applySettingsToRoutes(bootstrap.routes || [], state.clientSettings);
  state.routes = normalizedRoutes;
  state.effectiveRoutes = normalizedRoutes;
  state.route = resolveAllowedDefaultRoute(bootstrap.default_route, normalizedRoutes);
  saveRoutesToStorage(state.routes, state.route, state.clientSettings);
  if (bootstrap.profile && state.user) {
    const fn = bootstrap.profile.full_name != null ? String(bootstrap.profile.full_name).trim() : '';
    if (fn) state.user.full_name = fn;
    state.user.display_role2 =
      bootstrap.profile.display_role2 != null ? String(bootstrap.profile.display_role2) : '';
    state.user.can_add_activity = !!bootstrap.can_add_activity;
    state.user.can_edit_direct = !!bootstrap.can_edit_direct;
    state.user.can_request_edit = !!bootstrap.can_request_edit;
    localStorage.setItem('dashboard_user', JSON.stringify(state.user));
  }
}

async function mountScreen() {
  const requestedRoute = state.route;
  const transitionToken = ++navigationToken;
  activeNavigationToken = transitionToken;
  latestNavigationRoute = requestedRoute;
  const transitionLabel = `route:transition:${transitionToken}`;
  activeRouteTransitionLabel = transitionLabel;
  beginPerfTimer('route:transition');
  beginPerfTimer(transitionLabel);
  const mountStartMs = performance.now();
  cancelPrefetchSchedule();
  if (isDesktopViewport()) {
    isMobileNavOpen = false;
    document.body.classList.remove('is-shell-nav-open');
  }
  if (!effectiveRoutes().length) {
    if (tryRestoreRoutesInstant()) {
      backgroundSyncBootstrap();
    } else {
      await restoreSession();
    }
  }
  if (!isAllowedRoute(state.route)) state.route = resolveAllowedDefaultRoute('', state.routes);

  if (transitionToken !== activeNavigationToken || requestedRoute !== latestNavigationRoute) {
    finishRouteTransition(transitionLabel, requestedRoute, screenDataCacheKey(), mountStartMs, transitionToken);
    return;
  }
  const routeChanged = lastRenderedRoute !== state.route;
  if (routeChanged) {
    const leavingScreen = screens[lastRenderedRoute];
    if (leavingScreen?.onLeave) leavingScreen.onLeave({ state });
    ui.closeAll();
    closeMobileNav();
  }

  let screen = screens[state.route];
  if (!screen) {
    const fallback = effectiveRoutes().find((r) => screens[r]);
    if (fallback) {
      state.route = fallback;
      screen = screens[fallback];
    }
  }
  if (!screen) throw new Error('מסך לא זמין');

  const cacheKey = screenDataCacheKey();
  const rawEntry = screen.load ? state.screenDataCache[cacheKey] : null;
  const isStale = rawEntry && Date.now() - rawEntry.t >= screenCacheTtl();

  const shellExists = !!(state.token && document.querySelector('.app-shell #screenRoot'));
  const firstAuthenticatedMount = !!(state.token && !hasMountedAuthenticatedShell);
  if (firstAuthenticatedMount && !firstAuthenticatedRenderTimerStarted) {
    firstAuthenticatedRenderTimerStarted = true;
    beginPerfTimer('login:firstAuthenticatedRender');
  }

  if (!shellExists) {
    // First mount: build shell HTML.
    // Use any available entry (fresh or stale) to paint immediately.
    const shellBody = rawEntry ? screen.render(rawEntry.data, { state }) : screenLoadingMarkup();
    app.innerHTML = shell(shellBody);
    bindShell();
    if (rawEntry) {
      beginPerfTimer('route:renderScreen');
      const renderStart = performance.now();
      const screenRoot = document.getElementById('screenRoot');
      if (screenRoot) {
        beginPerfTimer('route:bindScreen');
        bindScreen(screen, screenRoot, rawEntry.data);
        endPerfTimer('route:bindScreen');
      }
      endPerfTimer('route:renderScreen');
      recordRenderPerf(state.route, 'first-mount-cached', performance.now() - renderStart, {
        cache_key: cacheKey,
        stale: !!isStale
      });
      if (routeChanged) lastRenderedRoute = state.route;
      if (isStale && state.route !== 'finance') backgroundRefreshScreen(screen, cacheKey);
      maybePrefetchFromDashboard();
      finishRouteTransition(transitionLabel, requestedRoute, cacheKey, mountStartMs, transitionToken);
      return;
    }
    await flushPaint();
  } else if (rawEntry) {
    beginPerfTimer('route:renderScreen');
    const renderStart = performance.now();
    // Shell exists + have any data (fresh or stale): render immediately, no spinner.
    updateNavActiveClasses();
    const screenRoot = document.getElementById('screenRoot');
    if (screenRoot) {
      screenRoot.innerHTML = screen.render(rawEntry.data, { state });
      beginPerfTimer('route:bindScreen');
      bindScreen(screen, screenRoot, rawEntry.data);
      endPerfTimer('route:bindScreen');
    }
    endPerfTimer('route:renderScreen');
    recordRenderPerf(state.route, 'shell-cached', performance.now() - renderStart, {
      cache_key: cacheKey,
      stale: !!isStale
    });
    if (routeChanged) lastRenderedRoute = state.route;
    if (isStale && state.route !== 'finance') backgroundRefreshScreen(screen, cacheKey);
    maybePrefetchFromDashboard();
    finishRouteTransition(transitionLabel, requestedRoute, cacheKey, mountStartMs, transitionToken);
    return;
  } else {
    // No data at all: show loading spinner and fetch.
    setShellNavBusy(true);
    const sr = document.getElementById('screenRoot');
    if (sr) sr.innerHTML = screenLoadingMarkup();
    updateNavActiveClasses();
    await flushPaint();
  }

  try {
    beginPerfTimer('route:loadData');
    if (firstAuthenticatedMount && !firstLoadTimerStarted) {
      firstLoadTimerStarted = true;
      beginPerfTimer('screen:firstLoad');
    }
    if (firstAuthenticatedMount && state.route === 'dashboard' && !firstDashboardSnapshotTimerStarted) {
      firstDashboardSnapshotTimerStarted = true;
      beginPerfTimer('dashboardSnapshot:firstLoad');
    }
    const data = await loadScreenDataWithCache(screen);
    endPerfTimer('route:loadData');
    if (transitionToken !== activeNavigationToken || requestedRoute !== latestNavigationRoute) return;
    if (state.route !== requestedRoute) return;
    if (firstAuthenticatedMount && state.route === 'dashboard') {
      endPerfTimer('dashboardSnapshot:firstLoad');
    }
    beginPerfTimer('route:renderScreen');
    const renderStart = performance.now();
    const screenRoot = document.getElementById('screenRoot');
    if (!screenRoot) throw new Error('אזור התצוגה לא זמין');
    screenRoot.innerHTML = screen.render(data, { state });
    endPerfTimer('route:renderScreen');
    beginPerfTimer('route:bindScreen');
    bindScreen(screen, screenRoot, data);
    endPerfTimer('route:bindScreen');
    recordRenderPerf(state.route, 'fresh-data-render', performance.now() - renderStart, {
      cache_key: cacheKey
    });
    if (routeChanged) lastRenderedRoute = state.route;
    maybePrefetchFromDashboard();
  } catch (err) {
    endPerfTimer('route:loadData');
    endPerfTimer('route:renderScreen');
    endPerfTimer('route:bindScreen');
    if (transitionToken !== activeNavigationToken || state.route !== requestedRoute) return;
    if (firstAuthenticatedMount && state.route === 'dashboard') {
      endPerfTimer('dashboardSnapshot:firstLoad');
    }
    const screenRoot = document.getElementById('screenRoot');
    if (screenRoot) {
      const msg = translateApiErrorForUser(err?.message) || 'אירעה שגיאה בטעינת הדף';
      screenRoot.innerHTML = `<div class="ds-loading-card" dir="rtl" role="alert">
        <p style="color:var(--ds-color-danger,#c0392b);font-weight:600;">⚠ שגיאה בטעינת הדף</p>
        <p>${msg}</p>
        <button type="button" class="ds-btn ds-btn--sm" style="margin-top:8px" onclick="window.location.reload()">נסה שוב</button>
      </div>`;
    }
  } finally {
    if (!hasMountedAuthenticatedShell) {
      hasMountedAuthenticatedShell = true;
      endPerfTimer('login:firstAuthenticatedRender');
      endPerfTimer('screen:firstLoad');
      schedulePostLoginPrefetch();
    }
    setShellNavBusy(false);
    finishRouteTransition(transitionLabel, requestedRoute, cacheKey, mountStartMs, transitionToken);
  }
}

function bindShell() {
  /* Allow any screen to navigate programmatically via custom event */
  document.addEventListener('app:navigate', (e) => {
    const route = e?.detail?.route;
    if (!isAllowedRoute(route)) return;
    closeMobileNav();
    if (route === 'activities') {
      state.activityQuickFamily = '';
      state.activityQuickManager = '';
    }
    state.route = route;
    render();
  });

  document.querySelectorAll('[data-route]').forEach((button) => {
    button.addEventListener('click', () => {
      closeMobileNav();
      const route = button.dataset.route;
      if (!isAllowedRoute(route)) return;
      if (route === 'activities') {
        state.activityQuickFamily = '';
        state.activityQuickManager = '';
      }
      state.route = route;
      render();
    });
  });

  document.getElementById('mobileMenuBtn')?.addEventListener('click', () => {
    setMobileNavOpen(!isMobileNavOpen);
  });

  document.querySelectorAll('[data-mobile-close]').forEach((button) => {
    button.addEventListener('click', closeMobileNav);
  });

  document.getElementById('logoutBtn')?.addEventListener('click', () => {
    ui.closeAll();
    clearStorageCache();
    hasMountedAuthenticatedShell = false;
    setSession(null);
    localStorage.removeItem('dashboard_routes');
    render();
  });
}

let _isRendering = false;
let _pendingRender = false;

async function render() {
  if (_isRendering) {
    _pendingRender = true;
    return;
  }
  _isRendering = true;
  _pendingRender = false;
  try {
    if (!state.token) {
      lastRenderedRoute = null;
      isMobileNavOpen = false;
      document.body.classList.remove('is-shell-nav-open');
      ui.closeAll();
      app.innerHTML = loginScreen.render(escapeHtml(loginInlineError), escapeHtml(systemNameDisplay()));
      loginScreen.bind({
        root: app,
        onLogin: async (userId, code, errorNode) => {
          loginInlineError = '';
          const clearRoutesSnapshot = () => localStorage.removeItem('dashboard_routes');
          const rollbackToLogin = (message) => {
            setSession(null);
            clearRoutesSnapshot();
            loginInlineError = message;
          };
          beginPerfTimer('login:total');
          try {
            beginPerfTimer('login:api.login');
            const data = await api.login(userId, code);
            endPerfTimer('login:api.login');
            hasMountedAuthenticatedShell = false;
            firstAuthenticatedRenderTimerStarted = false;
            firstLoadTimerStarted = false;
            firstDashboardSnapshotTimerStarted = false;
            firstPrefetchTimerStarted = false;
            beginPerfTimer('login:setSession');
            setSession({ token: data.token, user: data.user });
            endPerfTimer('login:setSession');
            beginPerfTimer('login:applyBootstrap');
            applyBootstrapFromLoginData(data);
            endPerfTimer('login:applyBootstrap');
            loginInlineError = '';
            scheduleRender();
          } catch (error) {
            endPerfTimer('login:api.login');
            endPerfTimer('login:setSession');
            endPerfTimer('login:applyBootstrap');
            endPerfTimer('login:scheduleRender');
            const msg = translateApiErrorForUser(error?.message);
            if (errorNode) errorNode.textContent = msg;
            rollbackToLogin(msg);
            throw error;
          } finally {
            endPerfTimer('login:total');
          }
        }
      });
      return;
    }
    await mountScreen();
  } catch (err) {
    if (!state.token) {
      _pendingRender = true;
    } else {
      throw err;
    }
  } finally {
    _isRendering = false;
    if (_pendingRender) {
      _pendingRender = false;
      render().catch(() => {});
    }
  }
}


window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeMobileNav();
  }
});

window.addEventListener('resize', () => {
  if (isDesktopViewport()) {
    closeMobileNav();
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const swUrl = new URL('./sw.js', window.location.href);
    navigator.serviceWorker
      .register(swUrl.href, { updateViaCache: 'none' })
      .then((reg) => {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            reg.update().catch(() => {});
          }
        });
      })
      .catch(() => {});
  });
}

render().catch((error) => {
  loginInlineError = translateApiErrorForUser(error?.message);
  setSession(null);
  render().catch(() => {});
});
