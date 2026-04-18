import { api } from './api.js';
import { state, setSession } from './state.js';
import { escapeHtml } from './screens/shared/html.js';
import { hebrewRole } from './screens/shared/ui-hebrew.js';
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

let pendingProgressiveShell = false;

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
      </section>
    </div>
  `;
}

function screenLoadingMarkup() {
  return `
    <div class="screen-loading screen-loading--prominent" dir="rtl" role="status" aria-live="polite">
      <p class="screen-loading-msg">טוען נתונים...</p>
    </div>
  `;
}

function consumeProgressiveShellFlag() {
  if (!pendingProgressiveShell) return false;
  pendingProgressiveShell = false;
  return true;
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

function shell(content) {
  const nav = state.routes
    .map((route) => `<button type="button" class="nav-btn ${route === state.route ? 'is-active' : ''}" data-route="${route}">${screenLabels[route] || 'מסך'}</button>`)
    .join('');

  return `
    <div class="outer-shell">
      <header class="topbar panel">
        <div class="title-wrap">
          <h1>לוח בקרה פנימי</h1>
          <p>${escapeHtml(state.user?.full_name || state.user?.name || '')} · ${escapeHtml(hebrewRole(state.user?.display_role || state.user?.role))}</p>
        </div>
        <button class="danger" id="logoutBtn" type="button">התנתקות</button>
      </header>
      <nav class="tabs panel">${nav}</nav>
      <section id="screenRoot">${content}</section>
    </div>
  `;
}

async function restoreSession() {
  if (!state.token) return;
  if (state.routes.length) return;
  const bootstrap = await api.bootstrap();
  state.routes = bootstrap.routes || [];
  state.route = bootstrap.default_route || state.routes[0] || 'my-data';
}

async function mountScreen() {
  if (!state.routes.length) await restoreSession();
  if (!state.routes.includes(state.route)) state.route = state.routes[0] || 'my-data';

  const screen = screens[state.route];
  if (!screen) throw new Error('Screen not found: ' + state.route);

  const progressive = consumeProgressiveShellFlag();

  if (progressive) {
    app.innerHTML = shell(screenLoadingMarkup());
    bindShell();
    await flushPaint();
  }

  const data = screen.load ? await screen.load({ api, state }) : {};

  if (progressive) {
    const screenRoot = document.getElementById('screenRoot');
    if (!screenRoot) throw new Error('screenRoot missing');
    screenRoot.innerHTML = screen.render(data, { state });
    screen.bind?.({
      root: screenRoot,
      data,
      state,
      api,
      rerender: render
    });
  } else {
    app.innerHTML = shell(screen.render(data, { state }));
    bindShell();
    screen.bind?.({
      root: document.getElementById('screenRoot'),
      data,
      state,
      api,
      rerender: render
    });
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
          pendingProgressiveShell = true;
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
  app.innerHTML = `<div class="outer-shell"><section class="panel panel--error"><h2>שגיאה</h2><p>${escapeHtml(error.message)}</p></section></div>`;
});
