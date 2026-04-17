import { state, setAuth } from './state.js';
import { api } from './api.js';
import { loginScreen, bindLogin } from './screens/login.js';
import { dashboardScreen } from './screens/dashboard.js';
import { activitiesScreen, bindActivities } from './screens/activities.js';
import { weekScreen } from './screens/week.js';
import { monthScreen } from './screens/month.js';
import { exceptionsScreen } from './screens/exceptions.js';
import { financeScreen } from './screens/finance.js';
import { instructorsScreen } from './screens/instructors.js';
import { contactsScreen } from './screens/contacts.js';
import { myDataScreen } from './screens/my-data.js';
import { permissionsScreen } from './screens/permissions.js';

const app = document.getElementById('app');

const ROLE_ROUTES = {
  admin: ['dashboard', 'activities', 'week', 'month', 'instructors', 'exceptions', 'my-data', 'contacts', 'finance', 'permissions'],
  operations_reviewer: ['dashboard', 'activities', 'week', 'month', 'instructors', 'exceptions', 'my-data', 'contacts', 'finance', 'permissions'],
  authorized_user: ['dashboard', 'activities', 'week', 'month', 'instructors', 'exceptions', 'my-data', 'contacts', 'finance'],
  instructor: ['week', 'month', 'my-data']
};

const SCREEN_REGISTRY = {
  dashboard: {
    load: async () => dashboardScreen(await api.dashboard(), state.user?.role)
  },
  activities: {
    load: async () => activitiesScreen(await api.activities({ type: state.filterType || 'all' }), state.user?.role === 'operations_reviewer' || state.user?.role === 'admin'),
    bind: () => bindActivities((tab) => {
      state.filterType = tab;
      render();
    })
  },
  week: {
    load: async () => weekScreen(await api.week())
  },
  month: {
    load: async () => monthScreen(await api.month())
  },
  exceptions: {
    load: async () => exceptionsScreen(await api.exceptions())
  },
  finance: {
    load: async () => financeScreen(await api.finance())
  },
  instructors: {
    load: async () => instructorsScreen(await api.instructors())
  },
  contacts: {
    load: async () => contactsScreen(await api.contacts())
  },
  'my-data': {
    load: async () => myDataScreen(await api.myData())
  },
  permissions: {
    load: async () => permissionsScreen(await api.permissions())
  }
};

function allowedRoutes() {
  return ROLE_ROUTES[state.user?.role] || [];
}

function shell(content) {
  const nav = allowedRoutes().map((route) => `<button class="btn nav-btn" data-route="${route}">${route}</button>`).join('');
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

  const roleRoutes = allowedRoutes();
  if (!roleRoutes.length) {
    app.innerHTML = shell('<article class="card"><h2>Access denied</h2><p>No screens are available for your role.</p></article>');
    wireShell();
    return;
  }

  if (!roleRoutes.includes(state.route)) {
    [state.route] = roleRoutes;
  }

  try {
    const current = SCREEN_REGISTRY[state.route];
    const view = current ? await current.load() : '<article class="card"><h2>Not found</h2></article>';
    app.innerHTML = shell(view);
    wireShell();
    current?.bind?.();
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
