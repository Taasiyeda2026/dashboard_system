import { state } from '../state.js';
import { dsPageHeader, dsScreenStack } from './shared/layout.js';


function iconSvg(name) {
  const common = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  const icons = {
    israa: `<svg ${common}><circle cx="12" cy="8" r="3"/><path d="M5.5 19c.7-3.5 3-5.5 6.5-5.5s5.8 2 6.5 5.5"/><path d="M18 4v4M16 6h4"/></svg>`,
    reports: `<svg ${common}><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5"/><path d="M10 12h5M10 16h5"/></svg>`,
    finance: `<svg ${common}><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 15h2"/><path d="M7 6V4h10v2"/></svg>`,
    pricing: `<svg ${common}><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h2M12 11h2M16 11h0M8 15h2M12 15h2M16 15h0M8 18h8"/></svg>`,
    summer: `<svg ${common}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>`,
    permissions: `<svg ${common}><path d="M12 3l7 3v5c0 4.4-2.8 8.4-7 10-4.2-1.6-7-5.6-7-10V6z"/><path d="M9.5 12l1.8 1.8 3.5-4"/></svg>`,
    attendance: `<svg ${common}><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 9h16"/><path d="M9 14l2 2 4-4"/></svg>`,
    team: `<svg ${common}><circle cx="9" cy="8" r="3"/><circle cx="17" cy="10" r="2.5"/><path d="M3.5 19c.6-3.5 2.6-5.5 5.5-5.5s4.9 2 5.5 5.5"/><path d="M14.5 15c2.8-.7 5.1.8 6 3.5"/></svg>`,
    control: `<svg ${common}><path d="M9 4h6l1 2h3v15H5V6h3z"/><path d="M9 4v3h6V4"/><path d="M9 13l2 2 4-4"/></svg>`,
    dates: `<svg ${common}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 9h18"/><path d="M8 13h3M13 13h3M8 17h3M13 17h3"/></svg>`
  };
  return icons[name] || icons.reports;
}

function effectiveRoutes() {
  const routes = Array.isArray(state?.effectiveRoutes) && state.effectiveRoutes.length
    ? state.effectiveRoutes
    : state?.routes;
  return new Set(Array.isArray(routes) ? routes : []);
}

function canViewAdminOnlyTools() {
  return String(state?.user?.role || state?.user?.display_role || '').trim() === 'admin';
}

function tileButton({ title, description, icon, route = '', url = '', managerTab = '', capabilityId = '', dateSimulator = false, pricingSimulator = false }) {
  const attrs = [];
  if (capabilityId) attrs.push(`data-capability-id="${capabilityId}"`);
  if (route) attrs.push(`data-route="${route}"`);
  if (url) attrs.push(`data-admin-hub-url="${url}"`);
  if (dateSimulator) attrs.push('data-admin-date-simulator="true"');
  if (pricingSimulator) attrs.push('data-admin-pricing-simulator="true"');
  if (managerTab) {
    attrs.push('data-manager-board-open="true"');
    attrs.push(`data-admin-hub-manager-tab="${managerTab}"`);
  } else if (icon === 'team') {
    attrs.push('data-manager-board-open="true"');
  }

  return `
    <button type="button" class="admin-management-tile" ${attrs.join(' ')}>
      <span class="admin-management-tile__icon">${iconSvg(icon)}</span>
      <span class="admin-management-tile__content">
        <strong>${title}</strong>
        <small>${description}</small>
      </span>
      <span class="admin-management-tile__arrow" aria-hidden="true">‹</span>
    </button>`;
}

function managementTilesHtml() {
  const routes = effectiveRoutes();
  const tiles = [
    routes.has('israa-management') && tileButton({
      title: 'איסראא',
      description: 'מעקב וניהול פעילות איסראא',
      icon: 'israa',
      capabilityId: 'israa',
      route: 'israa-management'
    }),
    routes.has('personal-reports') && tileButton({
      title: 'דוחות אישיים',
      description: 'צפייה וניהול דוחות אישיים',
      icon: 'reports',
      capabilityId: 'reports',
      route: 'personal-reports'
    }),
    routes.has('finance') && tileButton({
      title: 'כספים',
      description: 'נתונים וכלים פיננסיים',
      icon: 'finance',
      capabilityId: 'finance',
      route: 'finance'
    }),
    canViewAdminOnlyTools() && tileButton({
      title: 'סימולטור סיורים',
      description: 'בדיקת רווחיות לקבוצה ולעסקה בית־ספרית',
      icon: 'pricing',
      capabilityId: 'admin.pricing_simulator',
      pricingSimulator: true
    }),
    canViewAdminOnlyTools() && tileButton({
      title: 'משוב קיץ',
      description: 'משובי הקיץ של הצוות החינוכי',
      icon: 'summer',
      capabilityId: 'admin.summer_feedback',
      url: 'https://taasiyeda2026.github.io/dev/summer/admin.html'
    }),
    routes.has('permissions') && tileButton({
      title: 'הרשאות',
      description: 'ניהול משתמשים והרשאות במערכת',
      icon: 'permissions',
      capabilityId: 'admin.permissions',
      route: 'permissions'
    }),
    tileButton({
      title: 'מערכת נוכחות',
      description: 'כניסה למערכת דיווח הנוכחות',
      icon: 'attendance',
      capabilityId: 'attendance_reporting',
      url: '/dashboard_system/attendance/'
    }),
    tileButton({
      title: 'לוח מנהל צוות',
      description: 'תמונת מצב וניהול צוות המדריכים',
      icon: 'team',
      capabilityId: 'admin.team_board'
    }),
    tileButton({
      title: 'בקרת נוכחות אדמין',
      description: 'בקרה ואישור דוחות נוכחות לכלל העובדים',
      icon: 'control',
      capabilityId: 'admin.attendance',
      managerTab: 'payroll-attendance'
    }),
    canViewAdminOnlyTools() && tileButton({
      title: 'תאריכים',
      description: 'סימולציית רצף מפגשים לפי לוח הלימודים',
      icon: 'dates',
      dateSimulator: true
    })
  ].filter(Boolean);

  return tiles.join('');
}

function stylesHtml() {
  return `
    <style>
      .admin-management-home {
        width: min(100%, 1120px);
        margin-inline: auto;
      }
      .admin-management-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 14px;
        margin-top: 4px;
      }
      .admin-management-tile {
        appearance: none;
        min-width: 0;
        min-height: 132px;
        display: grid;
        grid-template-columns: 42px minmax(0, 1fr) 18px;
        align-items: center;
        gap: 12px;
        padding: 18px;
        border: 1px solid var(--color-border, #dbe3ec);
        border-radius: 16px;
        background: var(--color-surface, #fff);
        color: var(--color-text, #172033);
        text-align: right;
        cursor: pointer;
        box-shadow: 0 1px 2px rgba(15, 23, 42, .04);
        transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease;
      }
      .admin-management-tile:hover {
        transform: translateY(-2px);
        border-color: var(--color-primary, #64748b);
        box-shadow: 0 8px 22px rgba(15, 23, 42, .08);
      }
      .admin-management-tile:focus-visible {
        outline: 3px solid color-mix(in srgb, var(--color-primary, #2563eb) 28%, transparent);
        outline-offset: 2px;
      }
      .admin-management-tile__icon {
        width: 42px;
        height: 42px;
        display: grid;
        place-items: center;
        border: 1px solid var(--color-border, #dbe3ec);
        border-radius: 12px;
        background: var(--color-surface-muted, #f8fafc);
        color: var(--color-primary, #334155);
      }
      .admin-management-tile__icon svg {
        width: 23px;
        height: 23px;
      }
      .admin-management-tile__content {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .admin-management-tile__content strong {
        font-size: 16px;
        line-height: 1.25;
        font-weight: 800;
      }
      .admin-management-tile__content small {
        color: var(--color-text-secondary, #64748b);
        font-size: 12.5px;
        line-height: 1.45;
      }
      .admin-management-tile__arrow {
        color: var(--color-text-secondary, #94a3b8);
        font-size: 24px;
        line-height: 1;
      }
      @media (max-width: 1050px) {
        .admin-management-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
      @media (max-width: 620px) {
        .admin-management-grid { grid-template-columns: 1fr; gap: 10px; }
        .admin-management-tile { min-height: 112px; padding: 15px; }
      }
    </style>`;
}

export const adminHomeScreen = {
  load: () => Promise.resolve({}),
  render() {
    return dsScreenStack(`
      ${stylesHtml()}
      <section class="admin-management-home" dir="rtl">
        ${dsPageHeader('ניהול', 'כלי הניהול המרכזיים במקום אחד')}
        <div class="admin-management-grid" aria-label="כלי ניהול">
          ${managementTilesHtml()}
        </div>
      </section>
    `);
  },
  bind({ root }) {
    root?.querySelectorAll?.('[data-admin-hub-url]').forEach((button) => {
      button.addEventListener('click', () => {
        const url = String(button.getAttribute('data-admin-hub-url') || '').trim();
        if (url) window.location.assign(url);
      });
    });

    root?.querySelector?.('[data-admin-pricing-simulator]')?.addEventListener('click', () => {
      void import('./admin-pricing-simulator.js')
        .then(({ openAdminPricingSimulator }) => openAdminPricingSimulator())
        .catch((error) => console.error('[admin-pricing-simulator] failed to open', error));
    });

    root?.querySelector?.('[data-admin-date-simulator]')?.addEventListener('click', () => {
      void import('./admin-date-simulator.js')
        .then(({ openAdminDateSimulator }) => openAdminDateSimulator())
        .catch((error) => console.error('[admin-date-simulator] failed to open', error));
    });
  }
};
