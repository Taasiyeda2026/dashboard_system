import { escapeHtml } from './shared/html.js';
import {
  dsPageHeader,
  dsCard,
  dsScreenStack,
  dsEmptyState
} from './shared/layout.js';

const SCREEN_META = {
  dashboard:        { label: 'לוח בקרה',               icon: '📊' },
  activities:       { label: 'פעילויות',                icon: '📋' },
  finance:          { label: 'כספים',                   icon: '💰' },
  permissions:      { label: 'הרשאות',                  icon: '🔑' },
  exceptions:       { label: 'חריגות',                  icon: '⚠️' },
  instructors:      { label: 'מדריכים',                 icon: '👥' },
  'end-dates':      { label: 'תאריכי סיום',              icon: '📅' },
  'my-data':        { label: 'הנתונים שלי',              icon: '👤' },
  week:             { label: 'שבוע',                    icon: '📆' },
  month:            { label: 'חודש',                    icon: '🗓️' }
};

const ALL_ROUTES = ['dashboard', 'activities', 'finance', 'exceptions', 'permissions'];

export const adminHomeScreen = {
  load: () => Promise.resolve({}),

  render(data, { state } = {}) {
    const routes = Array.isArray(state?.routes) ? state.routes : [];

    const cards = ALL_ROUTES
      .filter((r) => routes.includes(r))
      .map((route) => {
        const meta = SCREEN_META[route] || { label: route, icon: '▶' };
        return `<button type="button" class="ds-admin-ctrl-card ds-admin-ctrl-card--link" data-admin-nav="${escapeHtml(route)}">
          <span class="ds-admin-ctrl-icon">${meta.icon}</span>
          <span class="ds-admin-ctrl-title">${escapeHtml(meta.label)}</span>
        </button>`;
      })
      .join('');

    const body = cards
      ? `<div class="ds-admin-ctrl-grid ds-admin-ctrl-grid--3col">${cards}</div>`
      : dsEmptyState('אין מסכים נגישים');

    return dsScreenStack(`
      ${dsPageHeader('לוח בקרה – מנהל מערכת')}
      <div style="display:flex;justify-content:center;">
        ${dsCard({ title: '', body, padded: !!cards })}
      </div>
    `);
  },

  bind({ root }) {
    root.querySelectorAll('[data-admin-nav]').forEach((card) => {
      card.addEventListener('click', () => {
        const target = card.dataset.adminNav;
        if (!target) return;
        document.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: target } }));
      });
    });
  }
};
