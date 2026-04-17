import { state, setAuth } from './state.js';
import { api } from './api.js';
import { loginScreen, bindLogin } from './screens/login.js';
import { dashboardScreen } from './screens/dashboard.js';
import { activitiesScreen, bindActivities } from './screens/activities.js';
import { weekScreen, monthScreen } from './screens/calendar.js';
import { exceptionsScreen } from './screens/exceptions.js';
import { financeScreen, instructorsScreen, contactsScreen, myDataScreen, permissionsScreen } from './screens/simpleTables.js';

const app = document.getElementById('app');
const routes = ['dashboard', 'activities', 'week', 'month', 'instructors', 'exceptions', 'my-data', 'contacts', 'finance', 'permissions'];

function shell(content) {
  const nav = routes.map((r) => `<button class="btn nav-btn" data-route="${r}">${r}</button>`).join('');
  const who = state.user ? `<strong>${state.user.name}</strong> (${state.user.role})` : '';
  return `
    <section class="topbar card">
      <div>${who}</div>
      <div>${nav}</div>
      <button id="logout" class="btn danger">Logout</button>
    </section>
    ${content}
  `;
}

async function render() {
  if (!state.token) {
    app.innerHTML = loginScreen(refresh);
    bindLogin(refresh);
    return;
  }

  try {
    let view = '';
    if (state.route === 'dashboard') view = dashboardScreen(await api.dashboard(), state.user?.role);
    if (state.route === 'activities') view = activitiesScreen(await api.activities({ type: state.filterType || 'all' }), state.user?.role === 'operations_reviewer');
    if (state.route === 'week') view = weekScreen(await api.week());
    if (state.route === 'month') view = monthScreen(await api.month());
    if (state.route === 'exceptions') view = exceptionsScreen(await api.exceptions());
    if (state.route === 'finance') view = financeScreen(await api.finance());
    if (state.route === 'instructors') view = instructorsScreen(await api.instructors());
    if (state.route === 'contacts') view = contactsScreen(await api.contacts());
    if (state.route === 'my-data') view = myDataScreen(await api.myData());
    if (state.route === 'permissions') view = permissionsScreen(await api.permissions());

    app.innerHTML = shell(view);
    wireShell();
    if (state.route === 'activities') bindActivities((tab) => {
      state.filterType = tab;
      render();
    });
  } catch (error) {
    app.innerHTML = shell(`<article class="card"><h2>Error</h2><p>${error.message}</p></article>`);
    wireShell();
  }
}

function wireShell() {
  document.querySelectorAll('[data-route]').forEach((node) => node.addEventListener('click', () => {
    state.route = node.dataset.route;
    render();
  }));
  document.getElementById('logout')?.addEventListener('click', () => {
    setAuth(null);
    state.route = 'dashboard';
    render();
  });
}

async function refresh() {
  if (state.token) {
    state.bootstrap = await api.bootstrap();
  }
  await render();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./frontend/public/sw.js').catch(() => {}));
}

refresh();
