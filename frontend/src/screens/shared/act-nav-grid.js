import { escapeHtml } from './html.js';

export const ACT_SUBNAV_ITEMS = [
  { route: 'dashboard',           label: 'לוח בקרה',             icon: '📊' },
  { route: 'activities',          label: 'פעילויות',             icon: '📋' },
  { route: 'week',                label: 'שבוע',                 icon: '📅' },
  { route: 'month',               label: 'חודש',                 icon: '🗓️' },
  { route: 'end-dates',           label: 'תאריכי סיום',          icon: '🏁' },
  { route: 'exceptions',          label: 'חריגות',               icon: '⚠️' },
  { route: 'instructors',         label: 'מדריכים',              icon: '👥' },
  { route: 'contacts',            label: 'אנשי קשר',             icon: '📇' },
  { route: 'finance',             label: 'כספים',                icon: '💰' },
  { route: 'permissions',         label: 'הרשאות',               icon: '🔑' },
  { route: 'operations',          label: 'תפעול',                icon: '⚙️' },
  { route: 'edit-requests',       label: 'אישורים',              icon: '✅' },
  { route: 'my-data',             label: 'הנתונים שלי',          icon: '👤' }
];

/**
 * מחזיר HTML של גריד ניווט הפעילויות.
 * @param {object} state - state.routes, state.route
 * @returns {string}
 */
export function actNavGridHtml(state) {
  const availableRoutes = new Set(Array.isArray(state?.routes) ? state.routes : []);
  const currentRoute = state?.route || '';
  const items = ACT_SUBNAV_ITEMS.filter((item) => availableRoutes.has(item.route));
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
        <span class="ds-act-nav-item__label">${escapeHtml(item.label)}</span>
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
export function headerNavGridHtml(state) {
  const availableRoutes = new Set(Array.isArray(state?.routes) ? state.routes : []);
  const currentRoute = state?.route || '';
  const items = ACT_SUBNAV_ITEMS.filter((item) => availableRoutes.has(item.route));
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
        <span class="ds-act-nav-item__label">${escapeHtml(item.label)}</span>
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
