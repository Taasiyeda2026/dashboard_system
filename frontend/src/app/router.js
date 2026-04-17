import { CONFIG } from '../config.js';
import { state, clearSession } from './state.js';
import { renderLogin } from '../screens/login.js';
import { renderDashboard } from '../screens/dashboard.js';
import { renderActivities } from '../screens/activities.js';
import { renderModuleTable } from '../screens/moduleTable.js';

function getAccessibleModules() {
  const modules = state.bootstrap?.bootstrap?.modules || [];
  return modules.filter((m) => m.accessible);
}

export async function renderApp(root) {
  root.innerHTML = '';

  if (!state.user) {
    root.appendChild(renderLogin(async () => {
      state.route = CONFIG.ROUTES.dashboard;
      renderApp(root);
    }));
    return;
  }

  const modules = getAccessibleModules();
  const shell = document.createElement('div');
  shell.className = 'app-shell';
  shell.innerHTML = `
    <header class="topbar">
      <strong>${CONFIG.APP_NAME}</strong>
      <div class="topbar-actions" id="topbar-actions"></div>
    </header>
    <main id="view"></main>
  `;

  const actions = shell.querySelector('#topbar-actions');
  actions.innerHTML = modules
    .map((moduleDef) => `<button data-route="${moduleDef.id}">${moduleDef.title}</button>`)
    .join('') + '<button id="logout-btn">Logout</button>';

  actions.querySelectorAll('[data-route]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.route = btn.dataset.route;
      renderApp(root);
    });
  });

  actions.querySelector('#logout-btn').addEventListener('click', () => {
    clearSession();
    state.route = CONFIG.ROUTES.login;
    renderApp(root);
  });

  root.appendChild(shell);
  const view = shell.querySelector('#view');

  if (state.route === CONFIG.ROUTES.activities) {
    view.appendChild(await renderActivities(state.activitiesFilters, (nextFilters) => {
      state.activitiesFilters = nextFilters;
      state.route = CONFIG.ROUTES.activities;
      renderApp(root);
    }));
    return;
  }

  if (state.route === CONFIG.ROUTES.dashboard) {
    view.appendChild(await renderDashboard());
    return;
  }

  const moduleDef = state.moduleMap[state.route];
  if (moduleDef && moduleDef.sheet) {
    view.appendChild(await renderModuleTable(moduleDef.id, moduleDef.title));
    return;
  }

  state.route = CONFIG.ROUTES.dashboard;
  view.appendChild(await renderDashboard());
}
