import { state } from '../state.js';
import { supabase, waitForSupabaseAuthSession } from '../supabase-client.js';
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
    dates: `<svg ${common}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 9h18"/><path d="M8 13h3M13 13h3M8 17h3M13 17h3"/></svg>`,
    keyboard: `<svg ${common}><rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/><path d="M6 9h.01M9 9h.01M12 9h.01M15 9h.01M18 9h.01M6 12h.01M9 12h.01M12 12h.01M15 12h.01M18 12h.01M7 15h10"/></svg>`
  };
  return icons[name] || icons.reports;
}

function effectiveRoutes() {
  const routes = Array.isArray(state?.effectiveRoutes) && state.effectiveRoutes.length
    ? state.effectiveRoutes
    : state?.routes;
  return new Set(Array.isArray(routes) ? routes : []);
}

function premiumEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function premiumDate(value) {
  return value ? new Date(value).toLocaleString('he-IL') : '—';
}
function renderPremiumResults(container, classes) {
  const items = Array.isArray(classes) ? classes : [];
  const count = items.reduce((total, item) => total + (item.responses || []).length, 0);
  const teams = items.reduce((total, item) => total + (item.latestTeamRun?.teams?.length || 0), 0);
  container.innerHTML = `
    <div class="admin-course-results-summary"><span>כיתות: <strong>${items.length}</strong></span><span>תשובות: <strong>${count}</strong></span><span>צוותים: <strong>${teams}</strong></span></div>
    <label>סינון כיתה או תלמיד <input type="search" data-premium-filter placeholder="חיפוש בתוצאות פרימיום"></label>
    <div data-premium-class-list></div>`;
  const list = container.querySelector('[data-premium-class-list]');
  function draw(filter = '') {
    const query = filter.trim().toLocaleLowerCase('he');
    const filtered = items.filter(item => [item.name, item.code, ...(item.responses || []).map(r => r.name)]
      .join(' ').toLocaleLowerCase('he').includes(query));
    list.innerHTML = filtered.map(item => {
      const responses = item.responses || [];
      const rows = responses.map(r => `<tr><td>${premiumEscape(r.name)}</td><td>${premiumEscape(premiumDate(r.completedAt))}</td><td>${premiumEscape(Object.entries(r.scores || {}).map(([key,value]) => key + ': ' + value).join(' | '))}</td></tr>`).join('');
      const run = item.latestTeamRun;
      const teamRows = run?.teams?.map((team, index) => `<tr><td>${premiumEscape(team.team ?? index + 1)}</td><td>${premiumEscape((team.members || []).map(m => typeof m === 'string' ? m : (m.name || m.studentName || '')).join(', '))}</td></tr>`).join('') || '';
      return `<details class="admin-course-results-class">
        <summary>${premiumEscape(item.name || 'כיתה ללא שם')} — ${responses.length} תשובות</summary>
        <p>קוד כיתה: ${premiumEscape(item.code)} | סטטוס: ${premiumEscape(item.status)} | נפתחה: ${premiumEscape(premiumDate(item.createdAt))}</p>
        <div class="admin-course-results-table"><table><thead><tr><th>תלמיד/ה</th><th>מועד מילוי</th><th>תוצאות הפרופיל</th></tr></thead><tbody>${rows || '<tr><td colspan="3">אין עדיין תשובות</td></tr>'}</tbody></table></div>
        <h3>חלוקת צוותים</h3>${teamRows ? `<div class="admin-course-results-table"><table><thead><tr><th>צוות</th><th>חברים</th></tr></thead><tbody>${teamRows}</tbody></table></div>` : '<p>לא נוצרו צוותים.</p>'}
      </details>`;
    }).join('') || '<p>לא נמצאו כיתות.</p>';
  }
  draw();
  container.querySelector('[data-premium-filter]').addEventListener('input', event => draw(event.target.value));
}
function canViewAdminOnlyTools() {
  return String(state?.user?.role || state?.user?.display_role || '').trim() === 'admin';
}

function canViewCourseResults() {
  return canViewAdminOnlyTools() && String(state?.user?.user_id ?? state?.user?.id ?? '') === '8000';
}

function tileButton({ title, description, icon, route = '', url = '', managerTab = '', capabilityId = '', dateSimulator = false, pricingSimulator = false, keyboardConverter = false, courseResults = false }) {
  const attrs = [];
  if (courseResults) attrs.push('data-course-results-open="true"');
  if (capabilityId) attrs.push(`data-capability-id="${capabilityId}"`);
  if (route) attrs.push(`data-route="${route}"`);
  if (url) attrs.push(`data-admin-hub-url="${url}"`);
  if (dateSimulator) attrs.push('data-admin-date-simulator="true"');
  if (pricingSimulator) attrs.push('data-admin-pricing-simulator="true"');
  if (keyboardConverter) attrs.push('data-admin-keyboard-converter="true"');
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
  const isAdmin = canViewAdminOnlyTools();
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
    isAdmin && tileButton({
      title: 'סימולטור סיורים',
      description: 'בדיקת רווחיות לקבוצה ולעסקה בית־ספרית',
      icon: 'pricing',
      capabilityId: 'admin.pricing_simulator',
      pricingSimulator: true
    }),
    isAdmin && tileButton({
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
    !isAdmin && tileButton({
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
    canViewCourseResults() && tileButton({
      title: 'תוצאות קורסים',
      description: 'תוצאות פרימיום ופורצות דרך',
      icon: 'reports',
      courseResults: true
    }),
    isAdmin && tileButton({
      title: 'תאריכים',
      description: 'סימולציית רצף מפגשים לפי לוח הלימודים',
      icon: 'dates',
      dateSimulator: true
    }),
    isAdmin && tileButton({
      title: 'ממיר מקלדת',
      description: 'תיקון טקסט שהוקלד בפריסת מקלדת שגויה',
      icon: 'keyboard',
      capabilityId: 'admin.keyboard_converter',
      keyboardConverter: true
    })
  ].filter(Boolean);

  return tiles.join('');
}

function stylesHtml() {
  return `
    <style>
      .admin-course-results-summary { display:flex; gap:18px; flex-wrap:wrap; margin:12px 0 20px; }
      .admin-course-results-data input { width:min(100%,360px); padding:10px; margin:8px 0 16px; border:1px solid var(--color-border,#dbe3ec); border-radius:9px; background:var(--color-surface,#fff); color:inherit; }
      .admin-course-results-class { border:1px solid var(--color-border,#dbe3ec); border-radius:12px; padding:14px; margin-bottom:12px; background:var(--color-surface,#fff); }
      .admin-course-results-class summary { font-weight:700; cursor:pointer; }
      .admin-course-results-class p { color:var(--color-text-secondary,#64748b); }
      .admin-course-results-table { overflow-x:auto; }
      .admin-course-results-table table { width:100%; border-collapse:collapse; }
      .admin-course-results-table th,.admin-course-results-table td { padding:10px; border-bottom:1px solid var(--color-border,#dbe3ec); text-align:right; }
      .admin-course-results-back { margin-bottom: 16px; border: 1px solid var(--color-border, #dbe3ec); background: var(--color-surface, #fff); color: var(--color-text, #172033); border-radius: 10px; padding: 10px 16px; cursor: pointer; }
      .admin-course-results-disabled { opacity: .65; cursor: default; }
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
        <div data-course-results-main>
          <div class="admin-management-grid" aria-label="כלי ניהול">
            ${managementTilesHtml()}
          </div>
        </div>
        ${canViewCourseResults() ? `
          <section data-course-results-section hidden aria-label="תוצאות קורסים">
            <button type="button" class="admin-course-results-back" data-course-results-back>חזרה לניהול</button>
            <h2>תוצאות קורסים</h2>
            <div class="admin-management-grid">
              ${tileButton({title: 'פרימיום', description: 'תוצאות שאלון הצוות וחלוקת קבוצות', icon: 'reports', courseResults: false}) .replace('class="admin-management-tile"', 'class="admin-management-tile" data-premium-course-results="true"')}
              <div class="admin-management-tile admin-course-results-disabled" aria-label="פורצות דרך – בקרוב">
                <span class="admin-management-tile__icon">${iconSvg('reports')}</span>
                <span class="admin-management-tile__content"><strong>פורצות דרך</strong><small>יתחבר לתוצאות הקורס בהמשך</small></span>
              </div>
            </div>
            <div data-premium-results-section hidden>
              <button type="button" class="admin-course-results-back" data-premium-results-back>חזרה לקורסים</button>
              <h2>פרימיום – תוצאות שאלון הצוות</h2>
              <p data-premium-load-status role="status"></p>
              <div class="admin-course-results-data" data-premium-results-data></div>
            </div>
          </section>
        ` : ''}

      </section>
    `);
  },
  bind({ root }) {
    if (canViewCourseResults()) {
      const main = root?.querySelector('[data-course-results-main]');
      const section = root?.querySelector('[data-course-results-section]');
      root?.querySelector('[data-course-results-open]')?.addEventListener('click', () => {
        if (main && section) { main.hidden = true; section.hidden = false; }
      });
      root?.querySelector('[data-course-results-back]')?.addEventListener('click', () => {
        if (main && section) { section.hidden = true; main.hidden = false; }
      });
      const courseGrid = section?.querySelector('.admin-management-grid');
      const premiumSection = root?.querySelector('[data-premium-results-section]');
      const premiumStatus = root?.querySelector('[data-premium-load-status]');
      const premiumData = root?.querySelector('[data-premium-results-data]');
      root?.querySelector('[data-premium-results-back]')?.addEventListener('click', () => {
        if (courseGrid && premiumSection) { premiumSection.hidden = true; courseGrid.hidden = false; }
      });
      root?.querySelector('[data-premium-course-results]')?.addEventListener('click', async () => {
        if (!courseGrid || !premiumSection || !premiumStatus || !premiumData) return;
        courseGrid.hidden = true;
        premiumSection.hidden = false;
        premiumStatus.textContent = 'טוען תוצאות...';
        premiumData.replaceChildren();
        try {
          if (!canViewCourseResults() || !supabase) throw new Error('אין הרשאה לצפות בתוצאות.');
          const session = await waitForSupabaseAuthSession();
          if (!session?.access_token) throw new Error('נדרשת התחברות פעילה לדשבורד.');
          const { data, error } = await supabase.rpc('premium_questionnaire_owner_dashboard');
          if (error) throw error;
          if (!premiumSection.isConnected) return;
          renderPremiumResults(premiumData, data);
          premiumStatus.textContent = '';
        } catch (error) {
          console.error('[premium-course-results] unable to load:', error);
          premiumStatus.textContent = 'לא ניתן לטעון את התוצאות. ודא שהתחברת לדשבורד בחשבון המורשה.';
        }
      });
    }
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

    root?.querySelector?.('[data-admin-keyboard-converter]')?.addEventListener('click', () => {
      void import('./admin-keyboard-converter.js')
        .then(({ openAdminKeyboardConverter }) => openAdminKeyboardConverter())
        .catch((error) => console.error('[admin-keyboard-converter] failed to open', error));
    });
  }
};
