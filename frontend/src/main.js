import { api } from './api.js';
import { state, setSession } from './state.js';
import { escapeHtml } from './screens/shared/html.js';
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

const screenLabels = {
  dashboard: 'Dashboard',
  activities: 'Activities',
  week: 'Week',
  month: 'Month',
  exceptions: 'Exceptions',
  finance: 'Finance',
  instructors: 'Instructors',
  contacts: 'Contacts',
  'my-data': 'My Data',
  permissions: 'Permissions'
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
    .map((route) => `<button class="nav-btn ${route === state.route ? 'is-active' : ''}" data-route="${route}">${screenLabels[route] || route}</button>`)
    .join('');

  return `
    <div class="outer-shell">
      <header class="topbar panel">
        <div class="title-wrap">
          <h1>Internal Dashboard</h1>
          <p>${escapeHtml(state.user?.name)} · ${escapeHtml(state.user?.role)}</p>
        </div>
        <button class="danger" id="logoutBtn">Logout</button>
      </header>
      <nav class="tabs panel">${nav}</nav>
      <section id="screenRoot">${content}</section>
    </div>
  `;
}

async function restoreSession() {
  if (!state.token) return;
  const bootstrap = await api.bootstrap();
  state.routes = bootstrap.routes || [];
  state.route = bootstrap.default_route || state.routes[0] || 'my-data';
}

async function mountScreen() {
  if (!state.routes.length) await restoreSession();
  if (!state.routes.includes(state.route)) state.route = state.routes[0] || 'my-data';

  const screen = screens[state.route];
  if (!screen) throw new Error('Screen not found: ' + state.route);
  const data = screen.load ? await screen.load({ api, state }) : {};

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
          const session = await api.login(userId, code);
          setSession(session);
          await restoreSession();
          await render();
        } catch (error) {
          if (errorNode) errorNode.textContent = error.message;
        }
      }
    });
    return;
  }

  await mountScreen();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./frontend/public/sw.js').catch(() => {});
  });
}

render().catch((error) => {
  app.innerHTML = `<div class="outer-shell"><section class="panel"><h2>Error</h2><p>${escapeHtml(error.message)}</p></section></div>`;
});
