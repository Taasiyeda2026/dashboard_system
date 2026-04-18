import { api } from './api.js';
import { state, setSession } from './state.js';
import { escapeHtml } from './screens/shared/html.js';
import { hebrewRole, translateApiErrorForUser } from './screens/shared/ui-hebrew.js';
import { dsSkeletonLines } from './screens/shared/layout.js';
import { loginScreen } from './screens/login.js';
import { dashboardScreen } from './screens/dashboard.js';
import { activitiesScreen } from './screens/activities.js';
import { weekScreen } from './screens/week.js';
import { monthScreen } from './screens/month.js';
import { exceptionsScreen } from './screens/exceptions.js';
import { financeScreen } from './screens/finance.js';
import { instructorsScreen } from './screens/instructors.js';
import { contactsScreen } from './screens/contacts.js';
import { myDataScreen } from './screens/my-data.js';
import { permissionsScreen } from './screens/permissions.js';

const app = document.getElementById('app');
const loginLogoSrc = new URL('../assets/logo1.png', import.meta.url).href;

function flushPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(resolve);
    });
  });
}

function renderPostLoginLoadingHtml() {
  return `
    <div class="login-shell" dir="rtl">
      <section class="login-card login-card--post-auth" aria-busy="true">
        <div class="login-brand">
          <img
            class="login-logo"
            src="${loginLogoSrc}"
            alt="תעשיידע"
            width="200"
            height="86"
            decoding="async"
          />
        </div>
        <p class="login-loading-heading" role="status">טוען את המערכת...</p>
        <p class="login-loading-sub">מכינים את המסך הראשון, נא להמתין</p>
        ${dsSkeletonLines(3)}
      </section>
    </div>
  `;
}

function screenLoadingMarkup() {
  return `
    <div class="ds-loading-card" dir="rtl" role="status" aria-live="polite">
      <div class="ds-spinner" aria-hidden="true"></div>
      <p>טוען נתונים...</p>
    </div>
  `;
}

function applyBootstrapFromLoginData(data) {
  if (!data || !Array.isArray(data.routes) || !data.routes.length) return;
  state.routes = data.routes;
  state.route =
    data.default_route && data.routes.includes(data.default_route)
      ? data.default_route
      : state.routes[0] || 'my-data';
}

const screenLabels = {
  dashboard: 'לוח בקרה',
  activities: 'פעילויות',
  week: 'שבוע',
  month: 'חודש',
  exceptions: 'חריגות',
  finance: 'כספים',
  instructors: 'מדריכים',
  contacts: 'אנשי קשר',
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
  contacts: contactsScreen,
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

  return `
    <div class="app-shell" dir="rtl">
      <aside class="shell-sidebar" aria-label="ניווט ראשי">
        <div class="shell-brand">
          <img class="shell-brand__mark" src="${loginLogoSrc}" alt="" width="120" height="52" decoding="async" />
          <span class="shell-brand__name">תעשיידע</span>
        </div>
        <nav class="shell-nav">${nav}</nav>
        <div class="shell-sidebar__footer">
          <div class="shell-user">
            <span class="shell-user__name">${displayName}</span>
            <span class="shell-user__role">${roleLine}</span>
          </div>
        </div>
      </aside>
      <div class="shell-main">
        <header class="shell-top">
          <p class="shell-top__mobile-brand">תעשיידע</p>
          <button type="button" class="ds-btn ds-btn--danger ds-btn--sm" id="logoutBtn">התנתקות</button>
        </header>
        <div class="shell-stage">
          <div id="screenRoot" class="screen-root">${content}</div>
        </div>
      </div>
    </div>
  `;
}

function screenDataCacheKey() {
  if (state.route === 'activities') {
    return `activities:${state.activityTab || 'all'}`;
  }
  return state.route;
}

async function loadScreenDataWithCache(screen) {
  if (!screen.load) return {};
  const keyBefore = screenDataCacheKey();
  const hit = state.screenDataCache[keyBefore];
  if (hit) return hit.data;
  const data = await screen.load({ api, state });
  const keyAfter = screenDataCacheKey();
  state.screenDataCache[keyAfter] = { data, t: Date.now() };
  return data;
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
  screen.bind?.({
    root: screenRoot,
    data,
    state,
    api,
    rerender: render,
    rerenderActivitiesView: () => rerenderActivitiesViewOnly(screen, screenRoot)
  });
}

function rerenderActivitiesViewOnly(screen, screenRoot) {
  if (state.route !== 'activities') {
    render();
    return;
  }
  const key = screenDataCacheKey();
  const hit = state.screenDataCache[key];
  if (!hit) {
    render();
    return;
  }
  screenRoot.innerHTML = screen.render(hit.data, { state });
  bindScreen(screen, screenRoot, hit.data);
}

async function restoreSession() {
  if (!state.token) return;
  if (state.routes.length) return;
  const bootstrap = await api.bootstrap();
  state.routes = bootstrap.routes || [];
  state.route = bootstrap.default_route || state.routes[0] || 'my-data';
  if (bootstrap.profile && state.user) {
    const fn = bootstrap.profile.full_name != null ? String(bootstrap.profile.full_name).trim() : '';
    if (fn) state.user.full_name = fn;
    state.user.display_role2 =
      bootstrap.profile.display_role2 != null ? String(bootstrap.profile.display_role2) : '';
    localStorage.setItem('dashboard_user', JSON.stringify(state.user));
  }
}

async function mountScreen() {
  if (!state.routes.length) await restoreSession();
  if (!state.routes.includes(state.route)) state.route = state.routes[0] || 'my-data';

  const screen = screens[state.route];
  if (!screen) throw new Error('מסך לא זמין');

  const shellExists = !!(state.token && document.querySelector('.app-shell #screenRoot'));

  if (!shellExists) {
    app.innerHTML = shell(screenLoadingMarkup());
    bindShell();
    await flushPaint();
  } else {
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
  } finally {
    setShellNavBusy(false);
  }
}

function bindShell() {
  document.querySelectorAll('[data-route]').forEach((button) => {
    button.addEventListener('click', () => {
      state.route = button.dataset.route;
      render();
    });
  });

  document.getElementById('logoutBtn')?.addEventListener('click', () => {
    setSession(null);
    render();
  });
}

async function render() {
  if (!state.token) {
    app.innerHTML = loginScreen.render();
    loginScreen.bind({
      root: app,
      onLogin: async (userId, code, errorNode) => {
        try {
          const data = await api.login(userId, code);
          setSession({ token: data.token, user: data.user });
          applyBootstrapFromLoginData(data);
          app.innerHTML = renderPostLoginLoadingHtml();
          await flushPaint();
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
}

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
