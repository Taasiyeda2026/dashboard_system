import { CONFIG } from '../config.js';
import { state, clearSession } from './state.js';
import { renderLogin } from '../screens/login.js';
import { renderDashboard } from '../screens/dashboard.js';
import { renderActivities } from '../screens/activities.js';

export async function renderApp(root) {
  root.innerHTML = '';

  if (!state.user) {
    root.appendChild(renderLogin(() => {
      state.route = CONFIG.ROUTES.dashboard;
      renderApp(root);
    }));
    return;
  }

  const shell = document.createElement('div');
  shell.className = 'app-shell';
  shell.innerHTML = `
    <header class="topbar">
      <strong>${CONFIG.APP_NAME}</strong>
      <div class="topbar-actions">
        <button data-route="${CONFIG.ROUTES.dashboard}">Dashboard</button>
        <button data-route="${CONFIG.ROUTES.activities}">Activities</button>
        <button id="logout-btn">Logout</button>
      </div>
    </header>
    <main id="view"></main>
  `;

  shell.querySelectorAll('[data-route]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.route = btn.dataset.route;
      renderApp(root);
    });
  });

  shell.querySelector('#logout-btn').addEventListener('click', () => {
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

  view.appendChild(await renderDashboard());
}
