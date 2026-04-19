import { api } from './api.js';
import { state, setSession } from './state.js';
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
import { permissionsScreen } from './screens/permissions.js';

const app = document.getElementById('app');
const loginLogoSrc = new URL('../assets/logo1.png', import.meta.url).href;

let isMobileNavOpen = false;
let lastRenderedRoute = null;
const ui = createSharedInteractionLayer();

/** In-flight API request dedup: prevents duplicate calls when navigating quickly. */
const inflightRequests = new Map();

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

/* ——— Route cache in localStorage (avoids extra bootstrap call on refresh) ——— */
function saveRoutesToStorage(routes, defaultRoute, clientSettings) {
  try {
    localStorage.setItem('dashboard_routes', JSON.stringify({
      routes,
      defaultRoute,
      clientSettings: clientSettings || {}
    }));
  } catch {}
}

function loadRoutesFromStorage() {
  try {
    const raw = localStorage.getItem('dashboard_routes');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function applyBootstrapFromLoginData(data) {
  if (!data || !Array.isArray(data.routes) || !data.routes.length) return;
  state.routes = data.routes;
  state.route =
    data.default_route && data.routes.includes(data.default_route)
      ? data.default_route
      : state.routes[0] || 'my-data';
  if (data.client_settings && typeof data.client_settings === 'object') {
    state.clientSettings = { ...data.client_settings };
  }
  saveRoutesToStorage(state.routes, state.route, state.clientSettings);
}

/** מסכים שנשארים ב־routes מהשרת אך מוסרים מסרגל הצד (גישה חלופית מתוך מסכים אחרים). */
const SIDEBAR_ROUTE_EXCLUDE = new Set(['instructor-contacts', 'contacts']);

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
  permissions: permissionsScreen
};

const NAV_HIDDEN_ROUTES = new Set(['contacts', 'instructor-contacts', 'week', 'month', 'exceptions', 'instructors']);

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
  const nav = state.routes
    .filter((route) => !NAV_HIDDEN_ROUTES.has(route))
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

  return `
    <div class="app-shell${drawerClass}" dir="rtl">
      <button type="button" class="shell-backdrop" data-mobile-close aria-label="סגירת תפריט"></button>
      <aside class="shell-sidebar" aria-label="ניווט ראשי" id="mobileNavDrawer" aria-hidden="${drawerHidden}">
        <div class="shell-sidebar__mobile-head">
          <span class="shell-sidebar__mobile-brand">תעשיידע</span>
          <button type="button" class="shell-close-btn" data-mobile-close aria-label="סגירת תפריט">✕</button>
        </div>
        <div class="shell-brand">
          <img class="shell-brand__mark" src="${loginLogoSrc}" alt="" width="120" height="52" decoding="async" />
          <span class="shell-brand__name">תעשיידע</span>
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
            <p class="shell-top__mobile-brand">${screenLabels[state.route] || 'תעשיידע'}</p>
          </div>
          <div class="shell-top__end">
            <button type="button" class="ds-btn ds-btn--danger ds-btn--sm" id="logoutBtn">התנתקות</button>
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
      state.screenDataCache[screenDataCacheKey()] = { data, t: Date.now() };
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

function setShellNavBusy(busy) {
  document.querySelectorAll('.app-shell [data-route]').forEach((b) => {
    b.disabled = busy;
  });
  document.querySelector('.app-shell')?.classList.toggle('is-route-loading', busy);
}

function updateNavActiveClasses() {
  document.querySelectorAll('[data-route]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.route === state.route);
  });
  const mobileBrand = document.querySelector('.shell-top__mobile-brand');
  if (mobileBrand) {
    mobileBrand.textContent = screenLabels[state.route] || 'תעשיידע';
  }
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
  if (state.route === 'activities') {
    Object.keys(state.screenDataCache).forEach((key) => {
      if (key.startsWith('activities:')) delete state.screenDataCache[key];
    });
  } else if (state.route === 'finance') {
    Object.keys(state.screenDataCache).forEach((key) => {
      if (key.startsWith('finance:')) delete state.screenDataCache[key];
    });
  } else {
    delete state.screenDataCache[screenDataCacheKey()];
  }
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
 * Uses cached routes from localStorage to avoid a blocking bootstrap API call.
 * The bootstrap call runs in the background to refresh permissions/profile.
 */
async function restoreSession() {
  if (!state.token) return;
  if (state.routes.length) return;

  const saved = loadRoutesFromStorage();
  if (saved?.routes?.length) {
    state.routes = saved.routes;
    state.route = saved.defaultRoute || state.routes[0] || 'my-data';
    if (saved.clientSettings && typeof saved.clientSettings === 'object') {
      state.clientSettings = { ...saved.clientSettings };
    }
    // Non-blocking background refresh
    api.bootstrap().then((b) => {
      if (b.routes?.length) {
        state.routes = b.routes;
        saveRoutesToStorage(b.routes, b.default_route, b.client_settings);
      }
      if (b.client_settings && typeof b.client_settings === 'object') {
        state.clientSettings = { ...b.client_settings };
      }
      if (b.profile && state.user) {
        const fn = b.profile.full_name != null ? String(b.profile.full_name).trim() : '';
        if (fn) state.user.full_name = fn;
        state.user.display_role2 =
          b.profile.display_role2 != null ? String(b.profile.display_role2) : '';
        localStorage.setItem('dashboard_user', JSON.stringify(state.user));
      }
    }).catch(() => {});
    return;
  }

  // First ever login on this device: blocking bootstrap call
  const bootstrap = await api.bootstrap();
  state.routes = bootstrap.routes || [];
  state.route = bootstrap.default_route || state.routes[0] || 'my-data';
  if (bootstrap.client_settings && typeof bootstrap.client_settings === 'object') {
    state.clientSettings = { ...bootstrap.client_settings };
  }
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
  if (!state.routes.length) await restoreSession();
  if (!state.routes.includes(state.route)) state.route = state.routes[0] || 'my-data';

  const routeChanged = lastRenderedRoute !== state.route;
  if (routeChanged) {
    ui.closeAll();
    closeMobileNav();
  }

  const screen = screens[state.route];
  if (!screen) throw new Error('מסך לא זמין');

  const cacheKey = screenDataCacheKey();
  const rawEntry = screen.load ? state.screenDataCache[cacheKey] : null;
  const cacheEntry = rawEntry && Date.now() - rawEntry.t < screenCacheTtl() ? rawEntry : null;

  const shellExists = !!(state.token && document.querySelector('.app-shell #screenRoot'));

  if (!shellExists) {
    // First mount: build shell HTML
    const shellBody = cacheEntry ? screen.render(cacheEntry.data, { state }) : screenLoadingMarkup();
    app.innerHTML = shell(shellBody);
    bindShell();
    if (cacheEntry) {
      // Already rendered inside shell — just bind, no API call needed
      const screenRoot = document.getElementById('screenRoot');
      if (screenRoot) bindScreen(screen, screenRoot, cacheEntry.data);
      if (routeChanged) lastRenderedRoute = state.route;
      return;
    }
    await flushPaint();
  } else if (cacheEntry) {
    // Shell exists + fresh cache hit: render immediately, no loading state, no flushPaint
    updateNavActiveClasses();
    const screenRoot = document.getElementById('screenRoot');
    if (screenRoot) {
      screenRoot.innerHTML = screen.render(cacheEntry.data, { state });
      bindScreen(screen, screenRoot, cacheEntry.data);
    }
    if (routeChanged) lastRenderedRoute = state.route;
    return;
  } else {
    // Shell exists, no cache: show loading spinner
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
    schedulePrefetch(state.route);
  } finally {
    setShellNavBusy(false);
  }
}

/** Prefetch adjacent screens in the background after the current screen renders. */
const PREFETCH_MAP = {
  dashboard:   ['exceptions', 'instructors', 'instructor-contacts'],
  activities:  ['exceptions', 'instructors'],
  week:        ['month'],
  month:       ['week'],
  instructors: ['instructor-contacts'],
};
let _prefetchTimer;
function schedulePrefetch(currentRoute) {
  clearTimeout(_prefetchTimer);
  _prefetchTimer = setTimeout(() => {
    const targets = PREFETCH_MAP[currentRoute] || [];
    for (const route of targets) {
      if (!state.routes.includes(route)) continue;
      const key = route;
      const hit = state.screenDataCache[key];
      if (hit && Date.now() - hit.t < (SCREEN_CACHE_TTL_MS[route] ?? DEFAULT_CACHE_TTL_MS)) continue;
      if (inflightRequests.has(key)) continue;
      const s = screens[route];
      if (!s?.load) continue;
      const p = s.load({ api, state })
        .then((data) => { state.screenDataCache[key] = { data, t: Date.now() }; inflightRequests.delete(key); })
        .catch(() => { inflightRequests.delete(key); });
      inflightRequests.set(key, p);
    }
  }, 800);
}

function bindShell() {
  document.querySelectorAll('[data-route]').forEach((button) => {
    button.addEventListener('click', () => {
      closeMobileNav();
      state.route = button.dataset.route;
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
      app.innerHTML = loginScreen.render();
      loginScreen.bind({
        root: app,
        onLogin: async (userId, code, errorNode) => {
          try {
            const data = await api.login(userId, code);
            setSession({ token: data.token, user: data.user });
            applyBootstrapFromLoginData(data);
            await restoreSession();
            await render();
          } catch (error) {
            if (errorNode) errorNode.textContent = error.message;
            throw error;
          }
        }
      });
      return;
    }
    await mountScreen();
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
  const msg = translateApiErrorForUser(error?.message);
  app.innerHTML = `
    <div class="login-shell" dir="rtl">
      <section class="login-card ds-error-page panel--error">
        <h2>שגיאה</h2>
        <p>${escapeHtml(msg)}</p>
      </section>
    </div>`;
});
