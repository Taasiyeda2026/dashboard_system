import { escapeHtml } from './html.js';

function itemLabelHtml(item, counts = {}) {
  const label = escapeHtml(item.label);
  if (item.route === 'exceptions') {
    const count = Number(counts.exceptions || 0);
    if (!Number.isFinite(count) || count <= 0) return label;
    return `${label} <span class="ds-nav-count-badge" aria-label="${escapeHtml(String(count))} חריגות">(${escapeHtml(String(count))})</span>`;
  }
  if (item.route === 'edit-requests') {
    const count = Number(counts.editRequests || 0);
    if (!Number.isFinite(count) || count <= 0) return label;
    return `${label} <span class="ds-nav-count-badge ds-nav-count-badge--edit-requests" aria-label="${escapeHtml(String(count))} בקשות עריכה פתוחות">${escapeHtml(String(count))}</span>`;
  }
  return label;
}

export const ACT_SUBNAV_ITEMS = [
  { route: 'activities',    label: 'כל הפעילויות',  icon: '📋' },
  { route: 'operations-management', label: 'ניהול תפעול', icon: '🛠️' },
  { route: 'end-dates',     label: 'תאריכי סיום',   icon: '🏁' },
  { route: 'exceptions',    label: 'חריגות',         icon: '⚠️' },
  { route: 'instructors',   label: 'מדריכים',        icon: '👥' },
  { route: 'archive',       label: 'ארכיון',         icon: '🗄️' },
  { route: 'contacts',      label: 'אנשי קשר',       icon: '📇' },
  { route: 'edit-requests', label: 'אישורי עריכה',   icon: '✅' },
];

function visibleSubnavItems(availableRoutes) {
  const hasUnifiedClientFile = availableRoutes.has('proposals-agreements');
  return ACT_SUBNAV_ITEMS.filter((item) => availableRoutes.has(item.route) && !(hasUnifiedClientFile && item.route === 'contacts'));
}

/**
 * מחזיר HTML של גריד ניווט הפעילויות.
 * @param {object} state - state.routes, state.route
 * @returns {string}
 */
export function actNavGridHtml(state, counts = {}) {
  const availableRoutes = new Set(Array.isArray(state?.routes) ? state.routes : []);
  const currentRoute = state?.route || '';
  const items = visibleSubnavItems(availableRoutes);
  if (!items.length) return '';
  const buttons = items
    .map(
      (item) => `
      <button
        type="button"
        class="ds-act-nav-item${item.route === currentRoute ? ' is-active' : ''}"
        data-act-subnav="${escapeHtml(item.route)}"
        dir="rtl"
      >
        <span class="ds-act-nav-item__icon" aria-hidden="true">${item.icon}</span>
        <span class="ds-act-nav-item__label">${itemLabelHtml(item, counts)}</span>
      </button>`
    )
    .join('');
  return `<div class="ds-act-nav-grid" dir="rtl">${buttons}</div>`;
}

/**
 * מחזיר HTML של סרגל ניווט אחיד עבור ההידר (עם הרשאות בלבד).
 * @param {object} state - state.routes, state.route
 * @returns {string}
 */
export function headerNavGridHtml(state, counts = {}) {
  const availableRoutes = new Set(Array.isArray(state?.routes) ? state.routes : []);
  const currentRoute = state?.route || '';
  const items = visibleSubnavItems(availableRoutes);
  if (!items.length) return '';
  const buttons = items
    .map(
      (item) => `
      <button
        type="button"
        class="ds-act-nav-item ds-act-nav-item--header${item.route === currentRoute ? ' is-active' : ''}"
        data-route="${escapeHtml(item.route)}"
        dir="rtl"
      >
        <span class="ds-act-nav-item__label">${itemLabelHtml(item, counts)}</span>
      </button>`
    )
    .join('');
  return `<nav class="shell-header-nav ds-act-nav-grid ds-act-nav-grid--header" aria-label="ניווט מהיר" dir="rtl">${buttons}</nav>`;
}

/**
 * מאגד אירועי לחיצה על כפתורי גריד הניווט.
 * @param {Element} root
 * @param {{ state: object, rerender: Function }} ctx
 */
export function bindActNavGrid(root, { state, rerender }) {
  root.querySelectorAll('[data-act-subnav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const route = btn.dataset.actSubnav;
      if (route) {
        state.route = route;
        rerender?.();
      }
    });
  });
}
