import { escapeHtml } from './shared/html.js';
import { hebrewRole } from './shared/ui-hebrew.js';
import {
  dsPageHeader,
  dsCard,
  dsScreenStack,
  dsKpiGrid,
  dsStatusChip,
  dsEmptyState
} from './shared/layout.js';

const SCREEN_META = {
  dashboard:        { label: 'לוח בקרה',          icon: '📊' },
  activities:       { label: 'פעילויות',            icon: '📋' },
  finance:          { label: 'כספים',               icon: '💰' },
  permissions:      { label: 'הרשאות',              icon: '🔑' },
  'admin-home':     { label: 'בית — ניהול',         icon: '🏠' },
  'admin-settings': { label: 'הגדרות מערכת',        icon: '⚙️' },
  'admin-lists':    { label: 'ניהול רשימות',         icon: '📝' },
  exceptions:       { label: 'חריגות',              icon: '⚠️' },
  instructors:      { label: 'מדריכים',             icon: '👥' },
  'end-dates':      { label: 'תאריכי סיום',          icon: '📅' },
  'my-data':        { label: 'הנתונים שלי',          icon: '👤' },
  week:             { label: 'שבוע',                icon: '📆' },
  month:            { label: 'חודש',                icon: '🗓️' }
};

const ADMIN_SECTION_ROUTES = ['admin-settings', 'admin-lists', 'permissions'];
const HIGHLIGHT_ROUTES = ['finance', 'activities', 'dashboard', 'exceptions'];

export const adminHomeScreen = {
  load: ({ api }) => api.permissions(),

  render(data, { state } = {}) {
    const safeRows = Array.isArray(data?.rows) ? data.rows : [];
    const routes = Array.isArray(state?.routes) ? state.routes : [];

    /* KPIs from permissions data */
    const activeCount = safeRows.filter((r) => String(r.active || '').toLowerCase() === 'yes').length;
    const inactiveCount = safeRows.length - activeCount;
    const adminCount = safeRows.filter((r) => r.display_role === 'admin').length;
    const reviewerCount = safeRows.filter((r) => r.display_role === 'operations_reviewer').length;

    const kpis = [
      { label: 'סה"כ משתמשים', value: String(safeRows.length) },
      { label: 'פעילים', value: String(activeCount) },
      { label: 'לא פעילים', value: String(inactiveCount) },
      { label: 'מנהלים', value: String(adminCount) },
      ...(reviewerCount > 0 ? [{ label: 'בקרי תפעול', value: String(reviewerCount) }] : [])
    ];

    /* Navigation cards — only for routes the user has access to */
    function navCard(route) {
      if (!routes.includes(route)) return '';
      const meta = SCREEN_META[route] || { label: route, icon: '▶' };
      return `<button type="button" class="ds-admin-ctrl-card ds-admin-ctrl-card--link" data-admin-nav="${escapeHtml(route)}">
        <span class="ds-admin-ctrl-icon">${meta.icon}</span>
        <span class="ds-admin-ctrl-title">${escapeHtml(meta.label)}</span>
      </button>`;
    }

    const adminCards = ADMIN_SECTION_ROUTES.map(navCard).filter(Boolean).join('');
    const highlightCards = HIGHLIGHT_ROUTES.map(navCard).filter(Boolean).join('');

    const adminSection = adminCards
      ? `<div class="ds-admin-section">
          <p class="ds-admin-section-heading">כלי ניהול</p>
          <div class="ds-admin-ctrl-grid">${adminCards}</div>
        </div>`
      : '';

    const highlightSection = highlightCards
      ? `<div class="ds-admin-section">
          <p class="ds-admin-section-heading">מסכים מהירים</p>
          <div class="ds-admin-ctrl-grid">${highlightCards}</div>
        </div>`
      : '';

    /* Role breakdown table */
    const roleRows = [
      { role: 'admin', count: adminCount },
      { role: 'operations_reviewer', count: reviewerCount },
      { role: 'authorized_user', count: safeRows.filter((r) => r.display_role === 'authorized_user').length },
      { role: 'instructor', count: safeRows.filter((r) => r.display_role === 'instructor').length }
    ].filter((r) => r.count > 0);

    const roleTable = roleRows.length === 0
      ? dsEmptyState('אין נתוני משתמשים')
      : `<table class="ds-table" style="max-width:360px;">
          <thead><tr><th>תפקיד</th><th style="text-align:center;">כמות</th><th style="text-align:center;">פעילים</th></tr></thead>
          <tbody>
            ${roleRows.map((r) => {
              const active = safeRows.filter((u) => u.display_role === r.role && String(u.active || '').toLowerCase() === 'yes').length;
              return `<tr>
                <td>${escapeHtml(hebrewRole(r.role))}</td>
                <td style="text-align:center;">${r.count}</td>
                <td style="text-align:center;">${dsStatusChip(String(active), active === r.count ? 'success' : 'warning')}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>`;

    /* Recently inactive users */
    const recentInactive = safeRows
      .filter((r) => String(r.active || '').toLowerCase() !== 'yes')
      .slice(0, 8);

    const inactiveSection = recentInactive.length === 0 ? '' : dsCard({
      title: 'משתמשים לא פעילים',
      badge: String(inactiveCount),
      body: `<div style="padding:var(--ds-space-3);display:flex;flex-direction:column;gap:6px;">
        ${recentInactive.map((r) => `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--ds-border);">
          <span style="font-weight:600;font-size:0.88rem;flex:1;">${escapeHtml(r.full_name || r.user_id)}</span>
          ${dsStatusChip(hebrewRole(r.display_role), 'neutral')}
        </div>`).join('')}
      </div>`,
      padded: false
    });

    return dsScreenStack(`
      ${dsPageHeader('בית — ניהול', 'לוח בקרה למנהלי מערכת')}
      ${dsKpiGrid(kpis)}
      ${dsCard({ title: 'ניווט', body: adminSection + highlightSection || dsEmptyState('אין מסכים נגישים'), padded: !(adminSection || highlightSection) })}
      ${dsCard({ title: 'התפלגות תפקידים', body: roleTable, padded: true })}
      ${inactiveSection}
    `);
  },

  bind({ root }) {
    root.querySelectorAll('[data-admin-nav]').forEach((card) => {
      card.addEventListener('click', () => {
        const target = card.dataset.adminNav;
        if (!target) return;
        /* Dispatch app:navigate so the shell handles it — works for hidden routes too */
        document.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: target } }));
      });
    });
  }
};
