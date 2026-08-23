import { state } from './state.js';

const STYLE_ID = 'admin-data-admin-guard-style';
const ADMIN_ROLE = 'admin';

function normalizedRole() {
  return String(state?.user?.role || state?.user?.display_role || '').trim();
}

function isAdminDataUser() {
  return normalizedRole() === ADMIN_ROLE;
}

function ensureGuardStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    html:not(.admin-data-admin-allowed) [data-admin-data-tool],
    html:not(.admin-data-admin-allowed) [data-admin-data-page],
    html:not(.admin-data-admin-allowed) .admin-data-drawer,
    html:not(.admin-data-admin-allowed) .admin-data-drawer-backdrop {
      display: none !important;
    }
  `;
  document.head.appendChild(style);
}

function closeUnauthorizedDataUi() {
  document.querySelectorAll('[data-admin-data-page], .admin-data-drawer, .admin-data-drawer-backdrop')
    .forEach((node) => node.remove());
  const home = document.querySelector('.admin-management-home');
  if (home) home.hidden = false;
}

function enforceAdminDataAccess() {
  ensureGuardStyle();
  const allowed = isAdminDataUser();
  document.documentElement.classList.toggle('admin-data-admin-allowed', allowed);
  if (!allowed) closeUnauthorizedDataUi();
  return allowed;
}

function blockUnauthorizedInteraction(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  const guarded = target.closest('[data-admin-data-tool], [data-admin-data-show], [data-funding-source], [data-admin-data-alert-open]');
  if (!guarded || isAdminDataUser()) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  enforceAdminDataAccess();
}

function scheduleEnforcement() {
  window.setTimeout(enforceAdminDataAccess, 0);
}

function startAdminDataGuard() {
  ensureGuardStyle();
  document.addEventListener('click', blockUnauthorizedInteraction, true);
  document.addEventListener('keydown', blockUnauthorizedInteraction, true);
  document.addEventListener('app:navigate', scheduleEnforcement);

  const observer = new MutationObserver(scheduleEnforcement);
  observer.observe(document.getElementById('app') || document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-current-route']
  });

  enforceAdminDataAccess();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startAdminDataGuard, { once: true });
} else {
  startAdminDataGuard();
}

export { isAdminDataUser, enforceAdminDataAccess };
