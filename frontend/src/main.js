import { api } from './api.js';
import { state, setSession, defaultClientSettings } from './state.js';
import { escapeHtml } from './screens/shared/html.js';
import { hebrewRole, translateApiErrorForUser } from './screens/shared/ui-hebrew.js';
import { createSharedInteractionLayer } from './screens/shared/interactions.js';
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
const loginLogoSrc = new URL('../assets/logo1.png', import.meta.url).href;

let isMobileNavOpen = false;
let lastRenderedRoute = null;
let loginInlineError = '';
const ui = createSharedInteractionLayer();

/** In-flight API request dedup: prevents duplicate calls when navigating quickly. */
const inflightRequests = new Map();

// ─── LocalStorage screen-data cache ───────────────────────────────────────
// Keys include a user-id prefix so different users on the same browser don't
// share data. Entries survive page reloads so the first navigation after a
// refresh shows cached content immediately (stale-while-revalidate handles
// the async refresh in the background).
const SCREEN_CACHE_STORAGE_PREFIX = 'ds_screen_cache_v1';
const SCREEN_CACHE_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours — after this ignore stored entry

function _storageKey() {
  const uid = state.user?.user_id || 'anon';
  return `${SCREEN_CACHE_STORAGE_PREFIX}:${uid}`;
}

function persistCacheEntry(key, entry) {
  try {
    const raw = localStorage.getItem(_storageKey());
    const stored = raw ? JSON.parse(raw) : {};
    stored[key] = entry;
    localStorage.setItem(_storageKey(), JSON.stringify(stored));
  } catch { /* quota or serialization error — silently ignore */ }
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
  'edit-requests': 'בקשות עריכה',
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

function navContextualRoutesSet() {
  const list = state?.clientSettings?.navigation?.contextual_only_routes;
  return new Set(Array.isArray(list) ? list : []);
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

function shell(content) {
  const hiddenSet = navSidebarHiddenRoutesSet();
  const contextualSet = navContextualRoutesSet();
  const nav = effectiveRoutes()
    .filter((route) => !hiddenSet.has(route) && !contextualSet.has(route))
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

  return `
    <div class="app-shell${drawerClass} route-${escapeHtml(String(state.route || ''))}" data-current-route="${escapeHtml(String(state.route || ''))}" dir="rtl">
      <button type="button" class="shell-backdrop" data-mobile-close aria-label="סגירת תפריט"></button>
      <aside class="shell-sidebar" aria-label="ניווט ראשי" id="mobileNavDrawer" aria-hidden="${drawerHidden}">
        <div class="shell-sidebar__mobile-head">
          <span class="shell-sidebar__mobile-brand">${systemName}</span>
          <button type="button" class="shell-close-btn" data-mobile-close aria-label="סגירת תפריט">✕</button>
        </div>
        <div class="shell-brand">
          <img class="shell-brand__mark" src="${loginLogoSrc}" alt="" width="120" height="52" decoding="async" />
          <span class="shell-brand__name">${systemName}</span>
        </div>
        <div class="shell-sidebar__user" aria-label="משתמש מחובר">
          <span class="shell-sidebar__user-name">${displayName}</span>
          <span class="shell-sidebar__user-role">${roleLine}</span>
        </div>
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
          <div class="shell-top__end">
            <button type="button" class="shell-logout-btn" id="logoutBtn" aria-label="התנתקות">
              <span class="shell-logout-btn__icon" aria-hidden="true">⏻</span>
              <span class="shell-logout-btn__label">התנתקות</span>
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

function screenDataCacheKey() {
  if (state.route === 'activities') {
    return `activities:${state.activityTab || 'all'}:${state.activityFinanceStatus || ''}`;
  }
  if (state.route === 'finance') {
    const df = state.financeDateFrom || '';
    const dt = state.financeDateTo || '';
    return `finance:${df}:${dt}`;
  }
  if (state.route === 'dashboard') {
    const ym = state.dashboardMonthYm && /^\d{4}-\d{2}$/.test(state.dashboardMonthYm) ? state.dashboardMonthYm : 'default';
    return `dashboard:${ym}`;
  }
  if (state.route === 'week') {
    return `week:${state.weekOffset || 0}`;
  }
  if (state.route === 'month') {
    const ym = state.monthYm && /^\d{4}-\d{2}$/.test(state.monthYm) ? state.monthYm : 'current';
    return `month:${ym}`;
  }
  return state.route;
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

/**
 * Returns cached data immediately if available and fresh (within TTL).
 * Deduplicates in-flight requests so rapid navigation doesn't fire duplicate API calls.
 */
async function loadScreenDataWithCache(screen) {
  if (!screen.load) return {};
  const key = screenDataCacheKey();
  const hit = state.screenDataCache[key];
  if (hit && Date.now() - hit.t < screenCacheTtl()) return hit.data;

  if (inflightRequests.has(key)) return inflightRequests.get(key);

  const p = screen.load({ api, state })
    .then((data) => {
      const entry = { data, t: Date.now() };
      state.screenDataCache[screenDataCacheKey()] = entry;
      persistCacheEntry(screenDataCacheKey(), entry);
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
  try {
    const p = screen.load({ api, state });
    inflightRequests.set(cacheKey, p);
    const data = await p;
    inflightRequests.delete(cacheKey);
    const entry = { data, t: Date.now() };
    state.screenDataCache[cacheKey] = entry;
    persistCacheEntry(cacheKey, entry);
    if (screenDataCacheKey() === cacheKey) {
      const screenRoot = document.getElementById('screenRoot');
      if (screenRoot) {
        screenRoot.innerHTML = screen.render(data, { state });
        bindScreen(screen, screenRoot, data);
      }
    }
  } catch {
    inflightRequests.delete(cacheKey);
  }
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
 * Bypasses the full mount cycle when data is already cached.
 * Falls back to full render() if cache is missing or route has changed.
 */
function fastRerenderScreen(screen, routeAtBind) {
  if (state.route !== routeAtBind) { render(); return; }
  const key = screenDataCacheKey();
  const raw = state.screenDataCache[key];
  const hit = raw && Date.now() - raw.t < screenCacheTtl() ? raw : null;
  if (!hit) { render(); return; }
  const screenRoot = document.getElementById('screenRoot');
  if (!screenRoot) { render(); return; }
  screenRoot.innerHTML = screen.render(hit.data, { state });
  bindScreen(screen, screenRoot, hit.data);
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
 * Restores session on page refresh.
 * Permissions are authoritative on the server, so refresh is always
 * bootstrap-driven (no route restore from localStorage).
 */
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
    localStorage.setItem('dashboard_user', JSON.stringify(state.user));
  }
}

async function mountScreen() {
  if (isDesktopViewport()) {
    isMobileNavOpen = false;
    document.body.classList.remove('is-shell-nav-open');
  }
  if (!effectiveRoutes().length) await restoreSession();
  if (!isAllowedRoute(state.route)) state.route = resolveAllowedDefaultRoute('', state.routes);

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

  if (!shellExists) {
    // First mount: build shell HTML.
    // Use any available entry (fresh or stale) to paint immediately.
    const shellBody = rawEntry ? screen.render(rawEntry.data, { state }) : screenLoadingMarkup();
    app.innerHTML = shell(shellBody);
    bindShell();
    if (rawEntry) {
      const screenRoot = document.getElementById('screenRoot');
      if (screenRoot) bindScreen(screen, screenRoot, rawEntry.data);
      if (routeChanged) lastRenderedRoute = state.route;
      if (isStale) backgroundRefreshScreen(screen, cacheKey);
      return;
    }
    await flushPaint();
  } else if (rawEntry) {
    // Shell exists + have any data (fresh or stale): render immediately, no spinner.
    updateNavActiveClasses();
    const screenRoot = document.getElementById('screenRoot');
    if (screenRoot) {
      screenRoot.innerHTML = screen.render(rawEntry.data, { state });
      bindScreen(screen, screenRoot, rawEntry.data);
    }
    if (routeChanged) lastRenderedRoute = state.route;
    if (isStale) backgroundRefreshScreen(screen, cacheKey);
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
    const data = await loadScreenDataWithCache(screen);
    const screenRoot = document.getElementById('screenRoot');
    if (!screenRoot) throw new Error('אזור התצוגה לא זמין');
    screenRoot.innerHTML = screen.render(data, { state });
    bindScreen(screen, screenRoot, data);
    if (routeChanged) lastRenderedRoute = state.route;
  } catch (err) {
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
    setShellNavBusy(false);
  }
}

function bindShell() {
  /* Allow any screen to navigate programmatically via custom event */
  document.addEventListener('app:navigate', (e) => {
    const route = e?.detail?.route;
    if (!isAllowedRoute(route)) return;
    closeMobileNav();
    state.route = route;
    render();
  });

  document.querySelectorAll('[data-route]').forEach((button) => {
    button.addEventListener('click', () => {
      closeMobileNav();
      const route = button.dataset.route;
      if (!isAllowedRoute(route)) return;
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
          try {
            const data = await api.login(userId, code);
            setSession({ token: data.token, user: data.user });
            applyBootstrapFromLoginData(data);
            try {
              await restoreSession();
              await mountScreen();
              loginInlineError = '';
            } catch {
              rollbackToLogin('כשל בטעינת נתוני משתמש אחרי התחברות');
              await render();
            }
          } catch (error) {
            const msg = translateApiErrorForUser(error?.message);
            if (errorNode) errorNode.textContent = msg;
            rollbackToLogin(msg);
            throw error;
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
