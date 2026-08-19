import { state } from './state.js';

const ADMIN_ROLE = 'admin';
const HUB_ROUTE = 'admin-home';
const STYLE_ID = 'admin-management-hub-sidebar-style';
const HUB_NAV_ATTRIBUTE = 'data-admin-management-hub-nav';
const PENDING_MANAGER_TAB_KEY = 'admin_management_pending_manager_tab';

const ADMIN_HUB_ROUTES = new Set([
  HUB_ROUTE,
  'israa-management',
  'personal-reports',
  'finance',
  'permissions'
]);

function normalize(value) {
  return String(value || '').trim();
}

function isAdmin() {
  return normalize(state?.user?.role || state?.user?.display_role) === ADMIN_ROLE;
}

function ensureSidebarStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    html.admin-management-hub-active .shell-sidebar .shell-nav [data-route="israa-management"],
    html.admin-management-hub-active .shell-sidebar .shell-nav [data-route="personal-reports"],
    html.admin-management-hub-active .shell-sidebar .shell-nav [data-route="finance"],
    html.admin-management-hub-active .shell-sidebar .shell-nav [data-route="permissions"],
    html.admin-management-hub-active .shell-sidebar .shell-nav [data-external-url="/dashboard_system/attendance/"],
    html.admin-management-hub-active .shell-sidebar .shell-nav [data-educational-feedback-admin-nav-item],
    html.admin-management-hub-active .shell-sidebar .shell-nav .manager-board-nav-button {
      display: none !important;
    }
  `;
  document.head.append(style);
}

function removeInjectedHubNavigation() {
  document.querySelectorAll(`[${HUB_NAV_ATTRIBUTE}]`).forEach((button) => button.remove());
}

function hubIsActive() {
  if (ADMIN_HUB_ROUTES.has(normalize(state?.route))) return true;
  return Boolean(document.querySelector('[data-manager-board-root]'));
}

function ensureHubNavigation() {
  ensureSidebarStyle();

  if (!isAdmin()) {
    document.documentElement.classList.remove('admin-management-hub-active');
    removeInjectedHubNavigation();
    return;
  }

  document.documentElement.classList.add('admin-management-hub-active');
  const nav = document.querySelector('.shell-sidebar .shell-nav');
  if (!nav) return;

  let button = nav.querySelector(`[${HUB_NAV_ATTRIBUTE}]`);
  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'shell-nav__btn';
    button.dataset.route = HUB_ROUTE;
    button.setAttribute(HUB_NAV_ATTRIBUTE, 'true');
    button.textContent = 'ניהול';
    nav.append(button);
  }

  button.classList.toggle('is-active', hubIsActive());
}

function readPendingManagerTab() {
  try {
    return normalize(sessionStorage.getItem(PENDING_MANAGER_TAB_KEY));
  } catch {
    return '';
  }
}

function clearPendingManagerTab() {
  try {
    sessionStorage.removeItem(PENDING_MANAGER_TAB_KEY);
  } catch {
    // Ignore storage restrictions.
  }
}

function savePendingManagerTab(tab) {
  try {
    sessionStorage.setItem(PENDING_MANAGER_TAB_KEY, normalize(tab));
  } catch {
    // Ignore storage restrictions.
  }
}

function openPendingManagerTabIfReady() {
  if (!isAdmin()) {
    clearPendingManagerTab();
    return;
  }
  const tab = readPendingManagerTab();
  if (!tab) return;
  const button = document.querySelector(`[data-manager-workspace-tab="${tab}"]`);
  if (!button) return;
  clearPendingManagerTab();
  requestAnimationFrame(() => {
    if (button.isConnected) button.click();
  });
}

function syncAdminManagementHub() {
  ensureHubNavigation();
  openPendingManagerTabIfReady();
}

function scheduleSync() {
  window.setTimeout(syncAdminManagementHub, 0);
}

function handleDocumentClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target || !isAdmin()) return;
  const managerTarget = target.closest('[data-admin-hub-manager-tab]');
  if (!managerTarget) return;
  const tab = normalize(managerTarget.getAttribute('data-admin-hub-manager-tab'));
  if (tab) savePendingManagerTab(tab);
}

function startAdminManagementHub() {
  ensureSidebarStyle();
  document.addEventListener('click', handleDocumentClick, true);
  document.addEventListener('app:navigate', scheduleSync);

  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.getElementById('app') || document.documentElement, {
    childList: true,
    subtree: true
  });

  syncAdminManagementHub();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startAdminManagementHub, { once: true });
} else {
  startAdminManagementHub();
}
