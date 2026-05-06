import { api } from './api.js';
import { config } from './config.js';
import { state, setSession, defaultClientSettings } from './state.js';
import { SCREEN_CACHE_STORAGE_PREFIX, persistCacheEntry } from './cache-persist.js';
import { escapeHtml } from './screens/shared/html.js';
import { hebrewRole, translateApiErrorForUser } from './screens/shared/ui-hebrew.js';
import { createSharedInteractionLayer } from './screens/shared/interactions.js';
import { headerNavGridHtml } from './screens/shared/act-nav-grid.js';
import { loginScreen } from './screens/login.js';
import { clearFinancePrefsIfUserChanged } from './screens/shared/finance-prefs-storage.js';

const app = document.getElementById('app');
const loginLogoSrc  = new URL('../assets/logo1.png',      import.meta.url).href;
const systemLogoSrc = new URL('../assets/logo_system.png', import.meta.url).href;

let isMobileNavOpen = false;
let lastRenderedRoute = null;
let loginInlineError = '';
let hasMountedAuthenticatedShell = false;
const ui = createSharedInteractionLayer();
let loginPerfStartMs = 0;
let loginShellPerfReported = false;
let initialRoutePerfReported = false;
let loginApiDurationMs = 0;
let loginBootstrapDurationMs = 0;

/** In-flight API request dedup: prevents duplicate calls when navigating quickly. */
const inflightRequests = new Map();
const PERF_MAX_RENDERS = 150;

const ACCENT_COLORS = {
  blue:   { accent: '#1a3358', hover: '#142a49', soft: '#e8eef6', stripe: '#eef3fb', stripeHover: '#e8f0fd' },
  green:  { accent: '#166534', hover: '#14532d', soft: '#eaf5ec', stripe: '#eaf5ec', stripeHover: '#dcf0e0' },
  purple: { accent: '#5b21b6', hover: '#4c1d95', soft: '#f3eefa', stripe: '#f3eefa', stripeHover: '#ece0f8' },
  orange: { accent: '#c2410c', hover: '#9a3412', soft: '#fdf3ea', stripe: '#fdf3ea', stripeHover: '#fce9d8' },
  gray:   { accent: '#334155', hover: '#1e293b', soft: '#f1f3f6', stripe: '#f1f3f6', stripeHover: '#e8eaee' }
};
const ACCENT_LS_KEY = 'ds_global_accent';

function accentNameFromStorage() {
  try { return localStorage.getItem(ACCENT_LS_KEY) || localStorage.getItem('ds_activities_stripe') || 'blue'; } catch { return 'blue'; }
}

function applyGlobalAccent(name = accentNameFromStorage()) {
  const selected = ACCENT_COLORS[name] ? name : 'blue';
  const colors = ACCENT_COLORS[selected];
  const root = document.documentElement;
  root.style.setProperty('--ds-accent', colors.accent);
  root.style.setProperty('--ds-accent-hover', colors.hover);
  root.style.setProperty('--ds-accent-soft', colors.soft);
  root.style.setProperty('--ds-interactive-selected', colors.soft);
  root.style.setProperty('--ds-activities-stripe', colors.stripe);
  root.style.setProperty('--ds-activities-stripe-hover', colors.stripeHover);
  root.style.setProperty('--ds-focus-ring', `0 0 0 2px color-mix(in srgb, ${colors.accent} 24%, transparent)`);
  root.style.setProperty('--ds-focus-ring-strong', `0 0 0 3px color-mix(in srgb, ${colors.accent} 30%, transparent)`);
  document.querySelectorAll('[data-accent-picker-btn]').forEach((btn) => { btn.style.background = colors.accent; });
  document.querySelectorAll('[data-accent-swatch]').forEach((sw) => { sw.classList.toggle('is-active', sw.dataset.accent === selected); });
  return selected;
}

applyGlobalAccent();


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
let shellEventsBound = false;
const STABILITY_HOTFIX_DISABLE_BACKGROUND_REFRESH = false;
const STABILITY_HOTFIX_DISABLE_PERSISTENT_SCREEN_CACHE = false;
/** Single switch: off = unregister all SW and skip registration (no stale shell risk during incidents). */
const SERVICE_WORKER_ENABLED = true;
const ROUTE_LOAD_GUARD_MS = 25000;
const ROUTE_LOAD_ERROR_HE = 'טעינת המסך נמשכת זמן רב מדי. נסו לרענן או להיכנס שוב.';
const SUPABASE_READONLY_CUTOVER = false;
const SUPABASE_READONLY_ROUTES = ['dashboard', 'activities', 'week', 'month', 'instructors', 'end-dates', 'exceptions', 'archive'];

if (typeof window !== 'undefined') {
  window.__HOTFIX_VERSION__ = config.HOTFIX_VERSION;
  window.__FRONTEND_BUILD_MARKER__ = 'emergency-disable-diagnostics-v2';
}

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

/** Subtle header cue + aria-busy while a stale screen revalidates in the background (no full-screen spinner). */
function ensureRefreshIndicatorStyle() {
  if (ensureRefreshIndicatorStyle._done) return;
  ensureRefreshIndicatorStyle._done = true;
  if (typeof document === 'undefined') return;
  const el = document.createElement('style');
  el.setAttribute('data-ds', 'route-refresh');
  el.textContent =
    '.app-shell.is-route-refreshing .shell-top{box-shadow:0 2px 0 0 rgba(59,130,246,0.55);transition:box-shadow .2s ease}';
  document.head.appendChild(el);
}

function setRouteRefreshing(active) {
  if (typeof document === 'undefined') return;
  document.querySelector('.app-shell')?.classList.toggle('is-route-refreshing', !!active);
  const sr = document.getElementById('screenRoot');
  if (sr) {
    if (active) sr.setAttribute('aria-busy', 'true');
    else sr.removeAttribute('aria-busy');
  }
}

/** Injects the one-time CSS needed for the background-prefetch sidebar indicator. */
function ensurePrefetchIndicatorStyle() {
  if (ensurePrefetchIndicatorStyle._done) return;
  ensurePrefetchIndicatorStyle._done = true;
  if (typeof document === 'undefined') return;
  const el = document.createElement('style');
  el.setAttribute('data-ds', 'prefetch-indicator');
  el.textContent =
    '@keyframes ds-prefetch-sweep{0%{transform:translateX(100%)}100%{transform:translateX(-100%)}}' +
    '.app-shell.is-prefetching .shell-sidebar{position:relative;overflow:hidden}' +
    '.app-shell.is-prefetching .shell-sidebar::after{content:"";position:absolute;bottom:0;inset-inline-start:0;inset-inline-end:0;height:2px;' +
    'background:linear-gradient(90deg,transparent 0%,rgba(99,179,237,0.55) 50%,transparent 100%);' +
    'animation:ds-prefetch-sweep 1.6s linear infinite;pointer-events:none}';
  document.head.appendChild(el);
}

/** Reference count of in-flight prefetch runs — indicator stays visible until it reaches zero. */
let _prefetchIndicatorCount = 0;

/** Shows or hides the subtle sidebar prefetch indicator (no spinner, no blocking UI).
 *  Reference-counted so overlapping runs don't prematurely clear the indicator. */
function setPrefetchIndicator(active) {
  if (typeof document === 'undefined') return;
  if (active) {
    ensurePrefetchIndicatorStyle();
    _prefetchIndicatorCount = Math.max(0, _prefetchIndicatorCount) + 1;
  } else {
    _prefetchIndicatorCount = Math.max(0, _prefetchIndicatorCount - 1);
  }
  document.querySelector('.app-shell')?.classList.toggle('is-prefetching', _prefetchIndicatorCount > 0);
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
  if (STABILITY_HOTFIX_DISABLE_BACKGROUND_REFRESH) return;
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

  // When any of the prefetch-target screens already has a fresh cache entry the
  // dashboard painted immediately from localStorage — there is no hydration
  // competition to worry about, so we can start much sooner.  The 4 s floor is
  // preserved only when the caches are fully cold (very first load / hard clear).
  const _PREFETCH_WARM_SCREENS = ['activities', 'week', 'month'];
  const _prefetchAnyWarm = _PREFETCH_WARM_SCREENS.some((r) => {
    if (!isAllowedRoute(r)) return false;
    const hit = state.screenDataCache[buildScreenDataCacheKey(r, state)];
    const ttl = SCREEN_CACHE_TTL_MS[r] ?? DEFAULT_CACHE_TTL_MS;
    return !!(hit && Date.now() - hit.t < ttl);
  });
  const _prefetchDelay = _prefetchAnyWarm ? 2000 : 8000;

  prefetchTimer = setTimeout(() => {
    prefetchTimer = null;
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      prefetchIdleId = window.requestIdleCallback(run, { timeout: 1000 });
    } else {
      run();
    }
  }, _prefetchDelay);
}

function recordRenderPerf(route, phase, durationMs, extra = {}) {
  if (typeof window === 'undefined') return;
  if (!window.__dsPerf) {
    window.__dsPerf = { requests: [], renders: [], screens: {} };
    window.__resetDsPerf = () => {
      window.__dsPerf = { requests: [], renders: [], screens: {} };
    };
  }
  const normalizedDuration = Math.round(durationMs);
  const entry = {
    route: String(route || 'unknown'),
    phase: String(phase || 'render'),
    duration_ms: normalizedDuration,
    slow: normalizedDuration > 3000,
    at: new Date().toISOString(),
    ...extra
  };
  window.__dsPerf.renders.push(entry);
  if (window.__dsPerf.renders.length > PERF_MAX_RENDERS) {
    window.__dsPerf.renders.splice(0, window.__dsPerf.renders.length - PERF_MAX_RENDERS);
  }
}

function reportPerfMilestone(kind, durationMs, extra = {}) {
  if (typeof console === 'undefined' || typeof console.info !== 'function') return;
  const base = {
    kind: String(kind || ''),
    duration_ms: Math.round(durationMs || 0),
    at: new Date().toISOString(),
    ...extra
  };
  // eslint-disable-next-line no-console
  console.info('[perf]', base);
}


function startupPerfStore() {
  if (typeof window === 'undefined') return null;
  if (!window.__dsStartupPerf) {
    window.__dsStartupPerf = { runs: [] };
  }
  return window.__dsStartupPerf;
}

function reportStartupPerf(entry) {
  const store = startupPerfStore();
  if (!store) return;
  const run = {
    measured_at: new Date().toISOString(),
    login_ms: Math.round(entry?.login_ms || 0),
    bootstrap_ms: Math.round(entry?.bootstrap_ms || 0),
    first_screen_ms: Math.round(entry?.first_screen_ms || 0),
    first_route: String(entry?.first_route || state.route || ''),
    source: String(entry?.source || 'login-flow')
  };
  store.runs.push(run);
  if (store.runs.length > 30) {
    store.runs.splice(0, store.runs.length - 30);
  }
  if (typeof console !== 'undefined' && typeof console.info === 'function') {
    console.info('[startup-perf]', run);
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
  if (typeof window.__printDsPerfSummary !== 'function') {
    window.__printDsPerfSummary = () => {
      const currentStore = perfStore();
      if (!currentStore) return null;
      const requests = Array.isArray(currentStore.requests) ? currentStore.requests : [];
      const renders = Array.isArray(currentStore.renders) ? currentStore.renders : [];
      const slowestRequests = [...requests]
        .sort((a, b) => (b?.duration_ms || 0) - (a?.duration_ms || 0))
        .slice(0, 5);
      const slowestScreens = [...renders]
        .sort((a, b) => (b?.duration_ms || 0) - (a?.duration_ms || 0))
        .slice(0, 5);
      const actionCounts = requests.reduce((acc, item) => {
        const key = String(item?.action || 'unknown');
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
      const summary = {
        slowest_requests: slowestRequests,
        slowest_screens: slowestScreens,
        action_counts: actionCounts
      };
      if (typeof console !== 'undefined' && typeof console.table === 'function') {
        console.info('DS Perf Summary');
        console.table(slowestRequests);
        console.table(slowestScreens);
        console.table(Object.entries(actionCounts).map(([action, count]) => ({ action, count })));
      } else if (typeof console !== 'undefined' && typeof console.info === 'function') {
        console.info('DS Perf Summary', summary);
      }
      return summary;
    };
  }
  return window.__dsPerf;
}

if (typeof window !== 'undefined') {
  perfStore();
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
  if (STABILITY_HOTFIX_DISABLE_PERSISTENT_SCREEN_CACHE) return;
  try {
    const raw = localStorage.getItem(_storageKey());
    if (!raw) return;
    const stored = JSON.parse(raw);
    delete stored[key];
    localStorage.setItem(_storageKey(), JSON.stringify(stored));
  } catch { /* ignore */ }
}

function restoreScreenCacheFromStorage() {
  if (STABILITY_HOTFIX_DISABLE_PERSISTENT_SCREEN_CACHE) return;
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
  instructors: 'מדריכים',
  'instructor-contacts': 'אנשי קשר מדריכים',
  contacts: 'אנשי קשר',
  'end-dates': 'תאריכי סיום',
  'my-data': 'הנתונים שלי',
  'edit-requests': 'אישורים',
  permissions: 'הרשאות',
  'admin-home': 'בית — ניהול',
  'admin-settings': 'הגדרות מערכת',
  'admin-lists': 'ניהול רשימות',
  archive: 'ארכיון'
};

const screenLoaders = {
  dashboard: () => import('./screens/dashboard.js').then((m) => m.dashboardScreen),
  activities: () => import('./screens/activities.js').then((m) => m.activitiesScreen),
  week: () => import('./screens/week.js').then((m) => m.weekScreen),
  month: () => import('./screens/month.js').then((m) => m.monthScreen),
  exceptions: () => import('./screens/exceptions.js').then((m) => m.exceptionsScreen),
  instructors: () => import('./screens/instructors.js').then((m) => m.instructorsScreen),
  'instructor-contacts': () => import('./screens/instructor-contacts.js').then((m) => m.instructorContactsScreen),
  contacts: () => import('./screens/contacts.js').then((m) => m.contactsScreen),
  'end-dates': () => import('./screens/end-dates.js').then((m) => m.endDatesScreen),
  'my-data': () => import('./screens/my-data.js').then((m) => m.myDataScreen),
  'edit-requests': () => import('./screens/edit-requests.js').then((m) => m.editRequestsScreen),
  permissions: () => import('./screens/permissions.js').then((m) => m.permissionsScreen),
  'admin-home': () => import('./screens/admin-home.js').then((m) => m.adminHomeScreen),
  'admin-settings': () => import('./screens/admin-settings.js').then((m) => m.adminSettingsScreen),
  'admin-lists': () => import('./screens/admin-lists.js').then((m) => m.adminListsScreen),
  archive: () => import('./screens/archive.js').then((m) => m.archiveScreen)
};
const loadedScreens = new Map();
const loadingScreens = new Map();

async function getScreen(route) {
  if (!route) return null;
  if (loadedScreens.has(route)) return loadedScreens.get(route);
  if (loadingScreens.has(route)) return loadingScreens.get(route);
  const loader = screenLoaders[route];
  if (!loader) return null;
  const request = loader()
    .then((screen) => {
      loadedScreens.set(route, screen);
      loadingScreens.delete(route);
      return screen;
    })
    .catch((error) => {
      loadingScreens.delete(route);
      throw error;
    });
  loadingScreens.set(route, request);
  return request;
}

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
  if (SUPABASE_READONLY_CUTOVER) {
    const seen = new Set();
    return SUPABASE_READONLY_ROUTES.filter((route) => {
      if (seen.has(route)) return false;
      if (!screenLoaders[route]) return false;
      seen.add(route);
      return true;
    });
  }
  const blocked = navDisabledRoutesSet(settings);
  const seen = new Set();
  return (Array.isArray(routes) ? routes : []).filter((route) => {
    if (!route || blocked.has(route) || seen.has(route)) return false;
    if (!screenLoaders[route]) return false;
    seen.add(route);
    return true;
  });
}

function effectiveRoutes() {
  if (Array.isArray(state.effectiveRoutes) && state.effectiveRoutes.length) return state.effectiveRoutes;
  return Array.isArray(state.routes) ? state.routes : [];
}

/**
 * Routes that are permanently disabled regardless of user permissions.
 * Any attempt to navigate to these is silently redirected to dashboard (or the first allowed route).
 */
const PERMANENTLY_DISABLED_ROUTES = new Set(['finance']);

function redirectIfDisabledRoute() {
  if (!PERMANENTLY_DISABLED_ROUTES.has(state.route)) return;
  const fallback = effectiveRoutes().includes('dashboard') ? 'dashboard' : (effectiveRoutes()[0] || 'dashboard');
  state.route = fallback;
}

function isAllowedRoute(route) {
  if (PERMANENTLY_DISABLED_ROUTES.has(route)) return false;
  return !!route && effectiveRoutes().includes(route);
}

function resolveAllowedDefaultRoute(preferred, routes) {
  if (SUPABASE_READONLY_CUTOVER) {
    return SUPABASE_READONLY_ROUTES[0];
  }
  const knownRoutes = Array.isArray(routes) ? routes.filter((r) => !!screenLoaders[r] && !PERMANENTLY_DISABLED_ROUTES.has(r)) : [];
  if (preferred && screenLoaders[preferred] && knownRoutes.includes(preferred)) return preferred;
  return knownRoutes[0] || 'my-data';
}

function bootstrapSupabaseReadonlySession() {
  if (!SUPABASE_READONLY_CUTOVER) return;
  if (!state.token) {
    setSession({
      token: 'supabase-readonly',
      user: {
        user_id: 'supabase-readonly',
        display_role: 'viewer',
        full_name: 'Supabase Readonly'
      }
    });
  }
  state.routes = [...SUPABASE_READONLY_ROUTES];
  state.effectiveRoutes = [...SUPABASE_READONLY_ROUTES];
  if (!SUPABASE_READONLY_ROUTES.includes(state.route)) {
    state.route = SUPABASE_READONLY_ROUTES[0];
  }
}

function systemNameRaw() {
  return String(state?.clientSettings?.system_name || 'Dashboard Taasiyeda').trim() || 'Dashboard Taasiyeda';
}

function systemNameDisplay() {
  const raw = systemNameRaw();
  if (raw === 'Dashboard Taasiyeda') return 'דשבורד תעשיידע';
  return raw;
}

function repairHebrewMojibake(value) {
  const raw = value == null ? '' : String(value);
  if (!raw) return '';
  const hasHebrew = /[\u0590-\u05FF]/.test(raw);
  const looksBroken = /[×�□]/.test(raw);
  if (hasHebrew && !looksBroken) return raw;
  if (!looksBroken) return raw;
  try {
    const latin1Bytes = Uint8Array.from(Array.from(raw), (ch) => ch.charCodeAt(0) & 0xff);
    const repaired = new TextDecoder('utf-8', { fatal: true }).decode(latin1Bytes).trim();
    if (/[\u0590-\u05FF]/.test(repaired)) return repaired;
  } catch (_) {
    // Keep original value if decoding fails.
  }
  return raw.replace(/[�□]/g, '').trim();
}

function shellUserDisplayName() {
  const fn = repairHebrewMojibake(state.user?.full_name).trim();
  return escapeHtml(fn || 'משתמש');
}

function shellUserRoleLine() {
  const r2 = repairHebrewMojibake(state.user?.display_role2).trim();
  if (r2) return escapeHtml(r2);
  const sheetLabel = repairHebrewMojibake(state.user?.display_role_label).trim();
  const code = String(state.user?.display_role || state.user?.role || '').trim();
  if (sheetLabel && (!code || sheetLabel.toLowerCase() !== code.toLowerCase())) {
    return escapeHtml(sheetLabel);
  }
  return escapeHtml(repairHebrewMojibake(hebrewRole(code)));
}

// מסכים אלו מגיעים מניווט גריד בלבד — לא מוצגים בסרגל הצד
const ACTIVITIES_CHILD_ROUTES = new Set(['week', 'month', 'instructors', 'end-dates', 'exceptions', 'instructor-contacts']);

// מסכי ניהול — נגישים למי שיש לו הרשאה, אך לא מוצגים בסרגל הצד
const ADMIN_SIDEBAR_HIDDEN_ROUTES = new Set(['admin-home', 'admin-settings', 'admin-lists']);

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
      !ADMIN_SIDEBAR_HIDDEN_ROUTES.has(route) &&
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

  const adminHeaderExclude = isAdminUser ? new Set(['operations', 'my-data', 'permissions']) : new Set();
  const headerNavHtml = headerNavGridHtml({
    route: state.route,
    routes: effectiveRoutes().filter((r) => !adminHeaderExclude.has(r))
  });
  const headerTechHtml = '';

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
        <div class="shell-sidebar__footer" dir="rtl">
          <div class="ds-accent-picker-wrap" data-accent-picker-wrap>
            <button type="button" class="ds-accent-picker-btn" data-accent-picker-btn aria-label="צבע ממשק" title="צבע ממשק"></button>
            <div class="ds-accent-picker-popover" data-accent-picker-popover hidden>
              <button type="button" class="ds-accent-swatch" data-accent="blue" style="background:#1a3358" title="כחול"></button>
              <button type="button" class="ds-accent-swatch" data-accent="green" style="background:#166534" title="ירוק"></button>
              <button type="button" class="ds-accent-swatch" data-accent="purple" style="background:#5b21b6" title="סגול"></button>
              <button type="button" class="ds-accent-swatch" data-accent="orange" style="background:#c2410c" title="כתום"></button>
              <button type="button" class="ds-accent-swatch" data-accent="gray" style="background:#334155" title="אפור"></button>
            </div>
          </div>
          <button type="button" class="shell-logout-btn shell-logout-btn--sidebar" id="logoutBtn" aria-label="התנתקות" title="התנתקות">
            <span aria-hidden="true">⏻</span>
          </button>
        </div>
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
            ${headerTechHtml}
          </div>
        </header>
        <div class="shell-stage">
          <div id="screenRoot" class="screen-root">${content}</div>
        </div>
      </div>
    </div>
  `;
}

function renderShellLoadingImmediately() {
  if (!state.token || !effectiveRoutes().length) return;
  const shellExists = !!document.querySelector('.app-shell #screenRoot');
  if (shellExists) return;
  app.innerHTML = shell(screenLoadingMarkup());
  bindShell();
  if (loginPerfStartMs > 0 && !loginShellPerfReported) {
    loginShellPerfReported = true;
    reportPerfMilestone('login_shell_visible', performance.now() - loginPerfStartMs);
  }
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
    const ym = cacheState.activitiesMonthYm && /^\d{4}-\d{2}$/.test(cacheState.activitiesMonthYm) ? cacheState.activitiesMonthYm : 'current';
    return `activities:${ym}`;
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
    const normalized = normalizeEntryForPersistentCache(cacheKey, entry);
    if (!normalized) return false;
    return JSON.stringify(normalized).length <= MAX_PERSISTED_CACHE_ENTRY_BYTES;
  } catch {
    return false;
  }
}

function normalizeEntryForPersistentCache(cacheKey, entry) {
  if (!entry || typeof entry !== 'object') return null;
  const payload = entry.data;
  if (cacheKey.startsWith('activities:') && payload && Array.isArray(payload.rows)) {
    return { ...entry, data: { ...payload, rows: payload.rows.slice(0, 60) } };
  }
  if (cacheKey.startsWith('week:') || cacheKey.startsWith('month:')) {
    if (payload && Array.isArray(payload.rows)) {
      return { ...entry, data: { ...payload, rows: payload.rows.slice(0, 80) } };
    }
  }
  return entry;
}

function maybePersistScreenCacheEntry(key, entry) {
  if (STABILITY_HOTFIX_DISABLE_PERSISTENT_SCREEN_CACHE) return;
  if (!shouldPersistScreenCacheEntry(key, entry)) return;
  persistCacheEntry(key, normalizeEntryForPersistentCache(String(key || ''), entry));
}
/**
 * Returns cached data immediately if available and fresh (within TTL).
 * Deduplicates in-flight requests so rapid navigation doesn't fire duplicate API calls.
 */
async function loadScreenDataWithCache(screen) {
  if (!screen.load) return {};
  const routeName = String(state.route || '');
  const routePerfEnabled = routeName === 'dashboard' || routeName === 'activities' || routeName === 'week' || routeName === 'month';
  const routePerfStart = routePerfEnabled ? (typeof performance !== 'undefined' ? performance.now() : Date.now()) : 0;
  const key = screenDataCacheKey();
  const hit = state.screenDataCache[key];
  const ttl = screenCacheTtl();
  const age = hit ? Date.now() - hit.t : 0;
  const serverMarkedStale = !!(hit && hit.data && hit.data._is_stale === true);
  if (hit && age < ttl && !serverMarkedStale) {
    if (routePerfEnabled) {
      const dur = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - routePerfStart);
      console.info('[route-load]', { route: routeName, duration_ms: dur, cache_hit: true, fallback_used: false, source: 'memory-cache-fresh' });
    }
    return hit.data;
  }

  if (hit) {
    if (STABILITY_HOTFIX_DISABLE_BACKGROUND_REFRESH) {
      if (routePerfEnabled) {
        const dur = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - routePerfStart);
        console.info('[route-load]', { route: routeName, duration_ms: dur, cache_hit: true, fallback_used: false, source: 'memory-cache-stale-bg-disabled' });
      }
      return hit.data;
    }
    if (!inflightRequests.has(key)) {
      backgroundRefreshScreen(screen, key);
    }
    if (routePerfEnabled) {
      const dur = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - routePerfStart);
      console.info('[route-load]', { route: routeName, duration_ms: dur, cache_hit: true, fallback_used: false, source: 'memory-cache-swr' });
    }
    return hit.data;
  }

  if (inflightRequests.has(key)) {
    pushDuplicateRequestPerf(key, state.route);
    const inflight = inflightRequests.get(key);
    if (routePerfEnabled) {
      const dur = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - routePerfStart);
      console.info('[route-load]', { route: routeName, duration_ms: dur, cache_hit: false, fallback_used: false, source: 'inflight-dedup' });
    }
    return inflight;
  }

  const p = screen.load({ api, state })
    .then((data) => {
      if (routePerfEnabled) {
        const dur = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - routePerfStart);
        console.info('[route-load]', {
          route: routeName,
          duration_ms: dur,
          cache_hit: false,
          fallback_used: !!(data && (data._snapshot_unavailable === true || data._is_stale === true)),
          source: 'network'
        });
      }
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
  if (STABILITY_HOTFIX_DISABLE_BACKGROUND_REFRESH) return;
  if (!screen.load) return;
  if (inflightRequests.has(cacheKey)) return;
  ensureRefreshIndicatorStyle();
  const prevBg =
    typeof globalThis !== 'undefined' ? globalThis.__DS_BG_SCREEN_REFRESH__ : undefined;
  if (typeof globalThis !== 'undefined') globalThis.__DS_BG_SCREEN_REFRESH__ = true;
  setRouteRefreshing(true);
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
  } finally {
    if (typeof globalThis !== 'undefined') globalThis.__DS_BG_SCREEN_REFRESH__ = prevBg;
    setRouteRefreshing(false);
  }
}

async function prefetchFromDashboardIfNeeded() {
  if (!state.token) return;
  if (state.route !== 'dashboard') return;

  const PREFETCH_SCREENS = ['activities', 'week', 'month'];
  const toFetch = PREFETCH_SCREENS.filter((r) => isAllowedRoute(r));
  if (!toFetch.length) return;

  const capturedToken = activeNavigationToken;
  const capturedSessionToken = state.token;
  const capturedUserId = state.user?.user_id || '';

  // activitiesScreen.load() synchronously sets state.activitiesMonthYm = currentYm()
  // before its first await, so normalise it here before computing cache keys so
  // the inflightRequests key and the final cache key stay in sync.
  if (!state.activitiesMonthYm) {
    const _n = new Date();
    state.activitiesMonthYm = `${_n.getFullYear()}-${String(_n.getMonth() + 1).padStart(2, '0')}`;
  }

  let screenModules;
  try {
    screenModules = await Promise.all(toFetch.map((r) => getScreen(r).catch(() => null)));
  } catch {
    return;
  }

  if (activeNavigationToken !== capturedToken) return;
  if (!state.token) return;

  setPrefetchIndicator(true);
  const fetchPromises = toFetch.map((route, idx) => {
    const screen = screenModules[idx];
    if (!screen || !screen.load) return Promise.resolve();

    // Key is captured before load() so user changes to weekOffset/monthYm during
    // the request do not shift the write to a different period's cache slot.
    const cacheKey = buildScreenDataCacheKey(route, state);
    const ttl = SCREEN_CACHE_TTL_MS[route] ?? DEFAULT_CACHE_TTL_MS;

    const hit = state.screenDataCache[cacheKey];
    if (hit && Date.now() - hit.t < ttl) return Promise.resolve();
    if (inflightRequests.has(cacheKey)) return Promise.resolve();

    const p = screen.load({ api, state })
      .then((data) => {
        inflightRequests.delete(cacheKey);
        // Discard if navigation happened or the session changed mid-flight.
        if (activeNavigationToken !== capturedToken) return data;
        if (!state.token || state.token !== capturedSessionToken) return data;
        if (capturedUserId && (state.user?.user_id || '') !== capturedUserId) return data;
        // Keep a fresher entry if navigation already wrote one.
        const existing = state.screenDataCache[cacheKey];
        if (existing && Date.now() - existing.t < ttl) return existing.data ?? data;
        const entry = { data, t: Date.now() };
        state.screenDataCache[cacheKey] = entry;
        maybePersistScreenCacheEntry(cacheKey, entry);
        return data;
      })
      .catch((err) => {
        inflightRequests.delete(cacheKey);
        throw err;
      });

    // Registering in inflightRequests lets loadScreenDataWithCache reuse this
    // promise if navigation arrives while the request is in flight.
    inflightRequests.set(cacheKey, p);
    return p;
  });

  try {
    await Promise.allSettled(fetchPromises);
  } finally {
    setPrefetchIndicator(false);
  }
}

function maybePrefetchFromDashboard() {
  if (STABILITY_HOTFIX_DISABLE_BACKGROUND_REFRESH) return;
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
  const screenRoot = document.getElementById('screenRoot');
  if (!screenRoot) { render(); return; }
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
    const cached = state.screenDataCache[requestedKey];
    const fresh = cached && Date.now() - cached.t < screenCacheTtl();
    recordRenderPerf(routeAtBind, fresh ? 'fast-rerender' : 'fast-rerender-stale-served', performance.now() - perfStart, {
      cache_key: requestedKey
    });
    maybePrefetchFromDashboard();
  } catch {
    render();
  }
}


function renderScreenIntoRoot({ route, screen, data, screenRoot, phase, cacheKey }) {
  const dataKeys = data && typeof data === 'object' ? Object.keys(data) : [];
  // eslint-disable-next-line no-console
  console.info('[route-render:start]', { route, data_keys: dataKeys });
  const renderStart = performance.now();
  try {
    const markup = screen.render(data, { state });
    screenRoot.innerHTML = markup;
    const text = (screenRoot.textContent || '').trim();
    if (text === 'טוען נתונים...' && data && typeof data === 'object') {
      // eslint-disable-next-line no-console
      console.warn('[route-render:retry]', { route, reason: 'loading-stuck-after-render' });
      screenRoot.innerHTML = screen.render(data, { state });
    }
    const afterText = (screenRoot.textContent || '').trim();
    if (afterText === 'טוען נתונים...') {
      throw new Error('render_stuck_on_loading');
    }
    beginPerfTimer('route:bindScreen');
    bindScreen(screen, screenRoot, data);
    endPerfTimer('route:bindScreen');
    recordRenderPerf(route, phase || 'fresh-data-render', performance.now() - renderStart, {
      cache_key: cacheKey
    });
    // eslint-disable-next-line no-console
    console.info('[route-render:success]', { route });
    return true;
  } catch (err) {
    endPerfTimer('route:bindScreen');
    // eslint-disable-next-line no-console
    console.warn('[route-render:failed]', { route, error: err?.message || String(err), data_keys: dataKeys });
    screenRoot.innerHTML = `<div class="ds-loading-card" dir="rtl" role="alert">
      <p style="color:var(--ds-color-danger,#c0392b);font-weight:600;">⚠ שגיאה בהצגת המסך</p>
      <p>אירעה תקלה בהצגת הנתונים. נסו לרענן את הדף.</p>
      <button type="button" class="ds-btn ds-btn--sm" style="margin-top:8px" onclick="window.location.reload()">נסה שוב</button>
    </div>`;
    throw err;
  }
}
function clearScreenDataCache() {
  const deletedKeys = [];
  // Always purge week, month and activities caches — any activity mutation can affect
  // these views regardless of which screen initiated the save.
  Object.keys(state.screenDataCache).forEach((key) => {
    if (key.startsWith('week:') || key.startsWith('month:') || key.startsWith('activities:')) {
      delete state.screenDataCache[key];
      deletedKeys.push(key);
    }
  });
  // Also purge the current screen's own cache entry so it reloads fresh data.
  if (state.route === 'dashboard') {
    Object.keys(state.screenDataCache).forEach((key) => {
      if (key.startsWith('dashboard:')) { delete state.screenDataCache[key]; deletedKeys.push(key); }
    });
  } else if (!['activities', 'week', 'month'].includes(state.route)) {
    const k = screenDataCacheKey();
    delete state.screenDataCache[k];
    deletedKeys.push(k);
  }
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
      if (bootstrap.profile.display_role_label != null) {
        state.user.display_role_label = String(bootstrap.profile.display_role_label);
      }
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
  clearFinancePrefsIfUserChanged(state.user?.user_id);
  if (bootstrap.profile && state.user) {
    const fn = bootstrap.profile.full_name != null ? String(bootstrap.profile.full_name).trim() : '';
    if (fn) state.user.full_name = fn;
    state.user.display_role2 =
      bootstrap.profile.display_role2 != null ? String(bootstrap.profile.display_role2) : '';
    if (bootstrap.profile.display_role_label != null) {
      state.user.display_role_label = String(bootstrap.profile.display_role_label);
    }
    state.user.can_add_activity = !!bootstrap.can_add_activity;
    state.user.can_edit_direct = !!bootstrap.can_edit_direct;
    state.user.can_request_edit = !!bootstrap.can_request_edit;
    localStorage.setItem('dashboard_user', JSON.stringify(state.user));
  }
}

async function mountScreen() {
  redirectIfDisabledRoute();
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
    const leavingScreen = loadedScreens.get(lastRenderedRoute);
    if (leavingScreen?.onLeave) leavingScreen.onLeave({ state });
    ui.closeAll();
    closeMobileNav();
  }

  let screen = await getScreen(state.route);
  if (!screen) {
    const fallback = effectiveRoutes().find((r) => !!screenLoaders[r]);
    if (fallback) {
      state.route = fallback;
      screen = await getScreen(fallback);
    }
  }
  if (!screen) throw new Error('מסך לא זמין');

  const cacheKey = screenDataCacheKey();
  const routeLoadStartMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
  // eslint-disable-next-line no-console
  console.info('[route-load:start]', { route: requestedRoute, cacheKey });
  const rawEntry = screen.load ? state.screenDataCache[cacheKey] : null;
  const isStale = rawEntry && (Date.now() - rawEntry.t >= screenCacheTtl() || rawEntry.data?._is_stale === true);

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
      if (isStale) backgroundRefreshScreen(screen, cacheKey);
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
    if (isStale) backgroundRefreshScreen(screen, cacheKey);
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
      beginPerfTimer('dashboardSheet:firstLoad');
    }
    let routeLoadGuardTimer = null;
    const routeLoadGuard = new Promise((_, reject) => {
      routeLoadGuardTimer = setTimeout(() => reject(new Error('route_load_timeout')), ROUTE_LOAD_GUARD_MS);
    });
    let data;
    try {
      data = await Promise.race([loadScreenDataWithCache(screen), routeLoadGuard]);
    } finally {
      clearTimeout(routeLoadGuardTimer);
    }
    endPerfTimer('route:loadData');
    if (transitionToken !== activeNavigationToken || requestedRoute !== latestNavigationRoute) return;
    if (state.route !== requestedRoute) return;
    if (firstAuthenticatedMount && state.route === 'dashboard') {
      endPerfTimer('dashboardSheet:firstLoad');
    }
    beginPerfTimer('route:renderScreen');
    const screenRoot = document.getElementById('screenRoot');
    if (!screenRoot) throw new Error('אזור התצוגה לא זמין');
    renderScreenIntoRoot({
      route: requestedRoute,
      screen,
      data,
      screenRoot,
      phase: 'fresh-data-render',
      cacheKey
    });
    endPerfTimer('route:renderScreen');
    // eslint-disable-next-line no-console
    console.info('[route-load:success]', {
      route: requestedRoute,
      duration_ms: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - routeLoadStartMs)
    });
    if (routeChanged) lastRenderedRoute = state.route;
    if (data?._is_stale === true && !STABILITY_HOTFIX_DISABLE_BACKGROUND_REFRESH) {
      const _staleGuardToken = activeNavigationToken;
      const _staleGuardRoute = requestedRoute;
      setTimeout(() => {
        if (activeNavigationToken === _staleGuardToken && state.route === _staleGuardRoute) {
          backgroundRefreshScreen(screen, cacheKey);
        }
      }, 3000);
    }
    maybePrefetchFromDashboard();
  } catch (err) {
    inflightRequests.delete(cacheKey);
    endPerfTimer('route:loadData');
    endPerfTimer('route:renderScreen');
    endPerfTimer('route:bindScreen');
    if (transitionToken !== activeNavigationToken || state.route !== requestedRoute) return;
    if (firstAuthenticatedMount && state.route === 'dashboard') {
      endPerfTimer('dashboardSheet:firstLoad');
    }
    const screenRoot = document.getElementById('screenRoot');
    if (screenRoot) {
      const isRouteTimeout = String(err?.message || '').includes('route_load_timeout');
      const msg = isRouteTimeout
        ? ROUTE_LOAD_ERROR_HE
        : (translateApiErrorForUser(err?.message) || 'אירעה שגיאה בטעינת הדף');
      screenRoot.innerHTML = `<div class="ds-loading-card" dir="rtl" role="alert">
        <p style="color:var(--ds-color-danger,#c0392b);font-weight:600;">⚠ שגיאה בטעינת הדף</p>
        <p>${msg}</p>
        <button type="button" class="ds-btn ds-btn--sm" style="margin-top:8px" onclick="window.location.reload()">נסה שוב</button>
      </div>`;
    }
    // eslint-disable-next-line no-console
    console.warn('[route-load:failed]', {
      route: requestedRoute,
      duration_ms: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - routeLoadStartMs),
      error: err?.message || String(err)
    });
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
  if (shellEventsBound) return;
  shellEventsBound = true;

  const navigateToRoute = (route) => {
    if (!isAllowedRoute(route)) return;
    if (route === state.route) return;
    closeMobileNav();
    if (route === 'activities') {
      state.activityQuickFamily = '';
      state.activityQuickManager = '';
    }
    state.route = route;
    render();
  };

  /* Allow any screen to navigate programmatically via custom event */
  document.addEventListener('app:navigate', (e) => {
    navigateToRoute(e?.detail?.route);
  });

  document.querySelectorAll('[data-route]').forEach((button) => {
    button.addEventListener('click', () => {
      navigateToRoute(button.dataset.route);
    });
  });

  document.getElementById('mobileMenuBtn')?.addEventListener('click', () => {
    setMobileNavOpen(!isMobileNavOpen);
  });

  document.querySelectorAll('[data-mobile-close]').forEach((button) => {
    button.addEventListener('click', closeMobileNav);
  });


  applyGlobalAccent();
  const accentBtn = document.querySelector('[data-accent-picker-btn]');
  const accentPop = document.querySelector('[data-accent-picker-popover]');
  if (accentBtn && accentPop) {
    accentBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      accentPop.hidden = !accentPop.hidden;
    });
    document.querySelectorAll('[data-accent-swatch]').forEach((sw) => {
      sw.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const name = sw.dataset.accent || 'blue';
        applyGlobalAccent(name);
        try { localStorage.setItem(ACCENT_LS_KEY, name); } catch {}
        accentPop.hidden = true;
      });
    });
    document.addEventListener('click', () => { accentPop.hidden = true; }, { capture: true, passive: true });
  }

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
    if (SUPABASE_READONLY_CUTOVER && !state.token) {
      bootstrapSupabaseReadonlySession();
    }
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
            loginPerfStartMs = performance.now();
            loginShellPerfReported = false;
            initialRoutePerfReported = false;
            beginPerfTimer('login:api.login');
            const loginApiStartMs = performance.now();
            const data = await api.login(userId, code);
            loginApiDurationMs = performance.now() - loginApiStartMs;
            endPerfTimer('login:api.login');
            hasMountedAuthenticatedShell = false;
            firstAuthenticatedRenderTimerStarted = false;
            firstLoadTimerStarted = false;
            firstDashboardSnapshotTimerStarted = false;
            firstPrefetchTimerStarted = false;
            beginPerfTimer('login:setSession');
            setSession({ token: data.token, user: data.user });
            clearFinancePrefsIfUserChanged(data.user?.user_id);
            endPerfTimer('login:setSession');
            beginPerfTimer('login:applyBootstrap');
            const bootstrapApplyStartMs = performance.now();
            applyBootstrapFromLoginData(data);
            loginBootstrapDurationMs = performance.now() - bootstrapApplyStartMs;
            renderShellLoadingImmediately();
            // eslint-disable-next-line no-console
            console.info('[login-success]', { route: state.route, routes_count: effectiveRoutes().length });
            // eslint-disable-next-line no-console
            console.info('[first-route-render:start]', { route: state.route });
            loginInlineError = '';
            endPerfTimer('login:applyBootstrap');
            scheduleRender();
            mountScreen().then(() => {
              // eslint-disable-next-line no-console
              console.info('[first-route-render:success]', { route: state.route });
              if (loginPerfStartMs > 0 && !initialRoutePerfReported) {
                initialRoutePerfReported = true;
                const firstScreenDurationMs = performance.now() - loginPerfStartMs;
                reportPerfMilestone('initial_route_loaded', firstScreenDurationMs, {
                  route: String(state.route || '')
                });
                reportStartupPerf({
                  login_ms: loginApiDurationMs,
                  bootstrap_ms: loginBootstrapDurationMs,
                  first_screen_ms: firstScreenDurationMs,
                  first_route: String(state.route || ''),
                  source: 'login'
                });
              }
            }).catch(async (error) => {
              // eslint-disable-next-line no-console
              console.warn('[first-route-render:failed]', { route: state.route, error: error?.message || String(error) });
              rollbackToLogin('כשל בטעינת נתוני משתמש אחרי התחברות');
              await render();
            });
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

if ('serviceWorker' in navigator && !SERVICE_WORKER_ENABLED) {
  navigator.serviceWorker.getRegistrations()
    .then((regs) => Promise.all(regs.map((reg) => reg.unregister())))
    .catch(() => {});
}

if ('serviceWorker' in navigator && SERVICE_WORKER_ENABLED) {
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
