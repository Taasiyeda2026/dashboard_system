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
const inflightRequests = new Map();

const SCREEN_CACHE_TTL_MS = {
  dashboard: 5 * 60 * 1000,
  activities: 5 * 60 * 1000,
  finance: 5 * 60 * 1000,
  week: 8 * 60 * 1000,
  month: 8 * 60 * 1000,
  exceptions: 8 * 60 * 1000,
  instructors: 10 * 60 * 1000,
  contacts: 10 * 60 * 1000,
  'instructor-contacts': 10 * 60 * 1000,
  'end-dates': 10 * 60 * 1000,
  'my-data': 5 * 60 * 1000
};
const DEFAULT_CACHE_TTL_MS = 8 * 60 * 1000;

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

function screenErrorMarkup(message) {
  return `
    <div class="ds-error-card" dir="rtl" role="alert" aria-live="assertive">
      <h3>שגיאה בטעינת המסך</h3>
      <p>${escapeHtml(message || 'אירעה שגיאה בלתי צפויה')}</p>
    </div>
  `;
}

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
  } catch {
    return null;
  }
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
              ☰
            </button>
            <p class="shell-top__mobile-brand">תעשיידע</p>
          </div>
          <div class="shell-top__center">
            <div class="shell-top-user" aria-label="משתמש מחובר">
              <span class="shell-top-user__name">${displayName}</span>
              <span class="shell-top-user__role">${roleLine}</span>
            </div>
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
  if (state.route === 'dashboard') {
    const ym = state.dashboardMonthYm && /^\d{4}-\d{2}$/.test(state.dashboardMonthYm)
      ? state.dashboardMonthYm
      : 'default';
    return `dashboard:${ym}`;
  }
  if (state.route === 'week') {
    return `week:${Number(state.weekOffset || 0)}`;
  }
  if (state.route === 'month') {
    const ym = state.monthYm && /^\d{4}-\d{2}$/.test(state.monthYm)
      ? state.monthYm
      : 'current';
    return `month:${ym}`;
  }
  return state.route;
}

function screenCacheTtlForRoute(route) {
  return SCREEN_CACHE_TTL_MS[route] ?? DEFAULT_CACHE_TTL_MS;
}

function isFreshCacheEntry(entry, route) {
  if (!entry || typeof entry.t !== 'number') return false;
  return Date.now() - entry.t < screenCacheTtlForRoute(route);
}

async function loadScreenDataWithCache(screen) {
  if (!screen.load) return {};
  const keyBefore = screenDataCacheKey();
  const routeBefore = state.route;
  const hit = state.screenDataCache[keyBefore];
  if (isFreshCacheEntry(hit, routeBefore)) return hit.data;

  if (inflightRequests.has(keyBefore)) {
    return inflightRequests.get(keyBefore);
  }

  const p = Promise.resolve()
    .then(() => screen.load({ api, state }))
    .then((resolved) => {
      const keyAfter = screenDataCacheKey();
      state.screenDataCache[keyAfter] = { data: resolved, t: Date.now() };
      inflightRequests.delete(keyBefore);
      return resolved;
    })
    .catch((err) => {
      inflightRequests.delete(keyBefore);
      throw err;
    });
  inflightRequests.set(keyBefore, p);
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
    rerenderActivitiesView: () => rerenderActivitiesViewOnly(screen, screenRoot)
  });
}

function fastRerenderScreen(screen, routeAtBind) {
  if (state.route !== routeAtBind) {
    render();
    return;
  }
  const key = screenDataCacheKey();
  const hit = state.screenDataCache[key];
  if (!isFreshCacheEntry(hit, state.route)) {
    render();
    return;
  }
  const screenRoot = document.getElementById('screenRoot');
  if (!screenRoot) {
    render();
    return;
  }
  screenRoot.innerHTML = screen.render(hit.data, { state });
  bindScreen(screen, screenRoot, hit.data);
}

function rerenderActivitiesViewOnly(screen, screenRoot) {
  if (state.route !== 'activities') {
    render();
    return;
  }
  const key = screenDataCacheKey();
  const hit = state.screenDataCache[key];
  if (!isFreshCacheEntry(hit, state.route)) {
    render();
    return;
  }
  screenRoot.innerHTML = screen.render(hit.data, { state });
  bindScreen(screen, screenRoot, hit.data);
}

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
    api.bootstrap()
      .then((bootstrap) => {
        if (!state.token) return;
        if (bootstrap.routes?.length) {
          state.routes = bootstrap.routes;
          const nextRoute = bootstrap.default_route || state.routes[0] || 'my-data';
          if (!state.routes.includes(state.route)) {
            state.route = nextRoute;
          }
          saveRoutesToStorage(state.routes, nextRoute, bootstrap.client_settings || state.clientSettings);
        }
        if (bootstrap.client_settings && typeof bootstrap.client_settings === 'object') {
          state.clientSettings = { ...bootstrap.client_settings };
        }
        if (bootstrap.profile && state.user) {
          const fn = bootstrap.profile.full_name != null ? String(bootstrap.profile.full_name).trim() : '';
          if (fn) state.user.full_name = fn;
          state.user.display_role2 =
            bootstrap.profile.display_role2 != null ? String(bootstrap.profile.display_role2) : '';
          localStorage.setItem('dashboard_user', JSON.stringify(state.user));
        }
      })
      .catch(() => {
        if (!state.token) {
          render().catch(() => {});
        }
      });
    return;
  }

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

  const hadShellAtStart = !!(state.token && document.querySelector('.app-shell #screenRoot'));
  let renderedProvisionalShell = false;
  if (!hadShellAtStart && !state.routes.length) {
    // Show shell immediately while restoring routes/bootstrap in background.
    app.innerHTML = shell(screenLoadingMarkup());
    bindShell();
    renderedProvisionalShell = true;
    await flushPaint();
  }

  if (!state.routes.length) await restoreSession();
  if (!state.token) {
    await render();
    return;
  }
  if (!state.routes.includes(state.route)) state.route = state.routes[0] || 'my-data';
  if (renderedProvisionalShell) {
    // Rebuild sidebar/topbar with resolved routes and active route.
    app.innerHTML = shell(screenLoadingMarkup());
    bindShell();
  }

  const routeChanged = lastRenderedRoute !== state.route;
  if (routeChanged) {
    ui.closeAll();
    closeMobileNav();
  }

  const screen = screens[state.route];
  if (!screen) throw new Error('מסך לא זמין');

  const cacheKey = screenDataCacheKey();
  const rawEntry = screen.load ? state.screenDataCache[cacheKey] : null;
  const cacheEntry = isFreshCacheEntry(rawEntry, state.route) ? rawEntry : null;

  const shellExists = !!(state.token && document.querySelector('.app-shell #screenRoot'));
  const firstShellMount = !shellExists;

  if (firstShellMount) {
    const shellBody = cacheEntry ? screen.render(cacheEntry.data, { state }) : screenLoadingMarkup();
    app.innerHTML = shell(shellBody);
    bindShell();
    if (cacheEntry) {
      const screenRoot = document.getElementById('screenRoot');
      if (screenRoot) bindScreen(screen, screenRoot, cacheEntry.data);
      if (routeChanged) lastRenderedRoute = state.route;
      return;
    }
    if (!cacheEntry) {
      await flushPaint();
    }
  } else if (cacheEntry) {
    updateNavActiveClasses();
    const screenRoot = document.getElementById('screenRoot');
    if (screenRoot) {
      screenRoot.innerHTML = screen.render(cacheEntry.data, { state });
      bindScreen(screen, screenRoot, cacheEntry.data);
      if (routeChanged) lastRenderedRoute = state.route;
    }
    return;
  } else {
    setShellNavBusy(true);
    const sr = document.getElementById('screenRoot');
    if (sr) sr.innerHTML = screenLoadingMarkup();
    updateNavActiveClasses();
    await flushPaint();
  }

  if (firstShellMount && !cacheEntry) {
    // Keep login perceived fast: do first screen load asynchronously inside shell.
    const routeAtRequest = state.route;
    setShellNavBusy(true);
    loadScreenDataWithCache(screen)
      .then((data) => {
        if (state.route !== routeAtRequest) return;
        const screenRoot = document.getElementById('screenRoot');
        if (!screenRoot) return;
        screenRoot.innerHTML = screen.render(data, { state });
        bindScreen(screen, screenRoot, data);
        if (routeChanged) lastRenderedRoute = state.route;
      })
      .catch((error) => {
        if (!state.token) {
          render().catch(() => {});
          return;
        }
        if (state.route !== routeAtRequest) return;
        const screenRoot = document.getElementById('screenRoot');
        if (!screenRoot) return;
        screenRoot.innerHTML = screenErrorMarkup(translateApiErrorForUser(error?.message));
      })
      .finally(() => {
        if (state.route === routeAtRequest) {
          setShellNavBusy(false);
        }
      });
    return;
  }

  try {
    const data = await loadScreenDataWithCache(screen);
    const screenRoot = document.getElementById('screenRoot');
    if (!screenRoot) return;
    screenRoot.innerHTML = screen.render(data, { state });
    bindScreen(screen, screenRoot, data);
    if (routeChanged) lastRenderedRoute = state.route;
  } catch (error) {
    if (!state.token) {
      await render();
      return;
    }
    const screenRoot = document.getElementById('screenRoot');
    if (screenRoot) {
      screenRoot.innerHTML = screenErrorMarkup(translateApiErrorForUser(error?.message));
    }
  } finally {
    setShellNavBusy(false);
  }
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
    inflightRequests.clear();
    render();
  });
}

async function render() {
  if (!state.token) {
    inflightRequests.clear();
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
          if (!state.routes.length) {
            await restoreSession();
          }
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
