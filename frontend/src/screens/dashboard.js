import { escapeHtml } from './shared/html.js';
import { dsPageHeader, dsCard, dsScreenStack, dsInteractiveCard } from './shared/layout.js';

const HEBREW_MONTHS = [
  'ינואר',
  'פברואר',
  'מרץ',
  'אפריל',
  'מאי',
  'יוני',
  'יולי',
  'אוגוסט',
  'ספטמבר',
  'אוקטובר',
  'נובמבר',
  'דצמבר'
];

function currentMonthYm() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function shiftYm(ym, deltaMonths) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + deltaMonths, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function hebrewMonthTitle(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || '').trim());
  if (!m) return ym || '';
  const mo = Number(m[2]);
  const name = mo >= 1 && mo <= 12 ? HEBREW_MONTHS[mo - 1] : m[2];
  return `${name} ${m[1]}`;
}

function goActivitiesDrill(state, patch) {
  state.route = 'activities';
  state.activityTab = patch.activityTab ?? 'all';
  state.activityFinanceStatus = patch.activityFinanceStatus ?? '';
  state.activityQuickFamily = patch.activityQuickFamily ?? '';
  state.activityQuickManager = patch.activityQuickManager ?? '';
  state.activityEndingCurrentMonth = !!patch.activityEndingCurrentMonth;
}

function goFinanceDrill(state, patch = {}) {
  state.route = 'finance';
  state.financeTab = patch.financeTab ?? 'active';
  state.financeStatusFilter = patch.financeStatusFilter ?? '';
}

function filterKpiCards(cards, showOnlyNonzero) {
  const list = Array.isArray(cards) ? cards : [];
  const actionable = list.filter((c) => c && c.action);
  if (!showOnlyNonzero) return actionable;
  return actionable.filter((c) => Number(c.value || 0) > 0);
}


function renderAdminNavBar(state) {
  const routes = Array.isArray(state?.routes) ? state.routes : [];
  const adminRoutes = [
    { route: 'admin-home', label: 'ניהול מערכת', icon: '🏠' },
    { route: 'permissions', label: 'הרשאות', icon: '🔑' }
  ].filter((r) => routes.includes(r.route));
  if (!adminRoutes.length) return '';
  const btns = adminRoutes
    .map((r) => `<button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-goto-route="${escapeHtml(r.route)}"><span aria-hidden="true">${r.icon}</span> ${escapeHtml(r.label)}</button>`)
    .join('');
  return `<div class="ds-screen-shortcuts ds-screen-shortcuts--admin" dir="rtl">${btns}</div>`;
}

export const dashboardScreen = {
  async load({ api, state }) {
    let ym = state.dashboardMonthYm;
    if (!ym || !/^\d{4}-\d{2}$/.test(ym)) {
      ym = currentMonthYm();
    }
    state.dashboardMonthYm = ym;
    return api.dashboard({ month: ym });
  },
  render(data, { state } = {}) {
    const ym = data?.month || currentMonthYm();
    const curYm = currentMonthYm();
    const canGoNext = ym < curYm;

    const managers = (Array.isArray(data.by_activity_manager) ? data.by_activity_manager : []).filter(
      (row) => row.activity_manager && row.activity_manager !== 'activity_manager' && row.activity_manager !== 'unassigned'
    );
    const showOnly = !!data?.show_only_nonzero_kpis;
    const kpiCards = filterKpiCards(data?.kpi_cards, showOnly);

    const managerCards = managers
      .map((row) => {
        const mgr = encodeURIComponent(row.activity_manager);
        const stats = [
          { label: 'מדריכים',      value: row.num_instructors ?? 0,                        action: `mstat|${mgr}|instructors` },
          { label: 'תוכניות',      value: row.total_long      ?? 0,                        action: `mstat|${mgr}|long` },
          { label: 'סיומי קורסים', value: row.course_endings  ?? 0,                        action: `mstat|${mgr}|endings` },
        ];
        const statsHtml = stats
          .map((s) => `<button type="button" class="ds-manager-stat" data-card-action="${escapeHtml(s.action)}">
              <span class="ds-manager-stat__label">${escapeHtml(s.label)}</span>
              <span class="ds-manager-stat__value">${escapeHtml(String(s.value))}</span>
            </button>`)
          .join('');
        return `<div class="ds-manager-card">
          <p class="ds-manager-card__name">${escapeHtml(row.activity_manager)}</p>
          <div class="ds-manager-stats">${statsHtml}</div>
        </div>`;
      })
      .join('');

    const managersBlock = managers.length
      ? `<div class="ds-manager-grid">${managerCards}</div>`
      : '<div class="ds-empty"><p class="ds-empty__msg">אין נתונים להצגה</p></div>';

    const kpiHtml = kpiCards.length
      ? kpiCards
          .map((k) =>
            dsInteractiveCard({
              variant: 'kpi',
              action: k.action,
              title: k.subtitle || k.title || '',
              value: k.value != null ? String(k.value) : String(k.title || '')
            })
          )
          .join('')
      : '<p class="ds-muted">אין כרטיסי KPI להצגה (לפי מסנן &quot;ערך בלבד&quot;).</p>';

    const monthNav = `<div class="ds-dash-month-nav" dir="rtl" aria-label="בחירת חודש לתצוגה">
      <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-dash-month-prev aria-label="חודש קודם">◀</button>
      <span class="ds-dash-month-nav__label">${escapeHtml(hebrewMonthTitle(ym))}</span>
      <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-dash-month-next aria-label="חודש הבא" ${
        canGoNext ? '' : 'disabled'
      }>▶</button>
    </div>`;

    const isAdmin = state?.user?.display_role === 'admin';
    const adminNavBar = isAdmin ? renderAdminNavBar(state) : '';

    return dsScreenStack(`
      ${dsPageHeader('לוח בקרה')}
      ${adminNavBar}
      ${monthNav}
      <div data-dash-data-area>
        <div class="ds-kpi-grid ds-dashboard-kpi-grid">${kpiHtml}</div>
        ${dsCard({
          title: 'פילוח לפי מנהל פעילויות',
          body: managersBlock,
          padded: true
        })}
      </div>
    `);
  },
  bind({ root, ui, state, api, rerender, clearScreenDataCache }) {
    root.querySelectorAll('[data-goto-route]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.gotoRoute;
        if (!target) return;
        document.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: target } }));
      });
    });
    function showDataAreaLoading() {
      const area = root.querySelector('[data-dash-data-area]');
      if (area) {
        area.innerHTML = '<div class="ds-loading-card" dir="rtl" role="status"><div class="ds-spinner" aria-hidden="true"></div><p>טוען נתונים...</p></div>';
      }
    }

    const applyYm = async (nextYm) => {
      state.dashboardMonthYm = nextYm;
      showDataAreaLoading();
      try {
        const data = await api.dashboard({ month: nextYm });
        const cacheKey = `dashboard:${/^\d{4}-\d{2}$/.test(nextYm) ? nextYm : 'default'}`;
        state.screenDataCache[cacheKey] = { data, t: Date.now() };
      } catch (_err) {
        clearScreenDataCache?.();
      }
      rerender();
    };

    root.querySelector('[data-dash-month-prev]')?.addEventListener('click', () => {
      applyYm(shiftYm(state.dashboardMonthYm || currentMonthYm(), -1));
    });
    root.querySelector('[data-dash-month-next]')?.addEventListener('click', () => {
      const cur = currentMonthYm();
      const next = shiftYm(state.dashboardMonthYm || cur, 1);
      if (next <= cur) applyYm(next);
    });

    ui.bindInteractiveCards(root, (action) => {
      if (action === 'kpi|short') {
        goActivitiesDrill(state, { activityQuickFamily: 'short' });
        ui.closeAll();
        rerender();
        return;
      }
      if (action === 'kpi|long') {
        goActivitiesDrill(state, { activityQuickFamily: 'long' });
        ui.closeAll();
        rerender();
        return;
      }
      if (action === 'kpi|instructors') {
        state.route = 'instructors';
        ui.closeAll();
        rerender();
        return;
      }
      if (action === 'kpi|endings') {
        goActivitiesDrill(state, { activityEndingCurrentMonth: true });
        ui.closeAll();
        rerender();
        return;
      }
      if (action === 'kpi|active_courses') {
        goActivitiesDrill(state, { activityTab: 'course' });
        ui.closeAll();
        rerender();
        return;
      }
      if (action === 'kpi|active_workshops') {
        goActivitiesDrill(state, { activityTab: 'workshop' });
        ui.closeAll();
        rerender();
        return;
      }
      if (action === 'kpi|active_tours') {
        goActivitiesDrill(state, { activityTab: 'tour' });
        ui.closeAll();
        rerender();
        return;
      }
      if (action === 'kpi|active_after_school') {
        goActivitiesDrill(state, { activityTab: 'after_school' });
        ui.closeAll();
        rerender();
        return;
      }
      if (action === 'kpi|active_escape_room') {
        goActivitiesDrill(state, { activityTab: 'escape_room' });
        ui.closeAll();
        rerender();
        return;
      }
      if (action === 'kpi|finance_open') {
        goFinanceDrill(state, { financeStatusFilter: 'open' });
        ui.closeAll();
        rerender();
        return;
      }
      if (action === 'kpi|exceptions') {
        state.route = 'exceptions';
        ui.closeAll();
        rerender();
        return;
      }
      if (action.startsWith('manager|')) {
        const name = decodeURIComponent(action.slice('manager|'.length));
        goActivitiesDrill(state, { activityQuickManager: name });
        ui.closeAll();
        rerender();
        return;
      }
      if (action.startsWith('mstat|')) {
        const parts = action.split('|');
        const name = decodeURIComponent(parts[1] || '');
        const kind = parts[2] || 'long';
        if (kind === 'instructors') {
          state.route = 'instructors';
        } else if (kind === 'long') {
          goActivitiesDrill(state, { activityQuickManager: name, activityQuickFamily: 'long' });
        } else if (kind === 'endings') {
          goActivitiesDrill(state, { activityQuickManager: name, activityEndingCurrentMonth: true });
        }
        ui.closeAll();
        rerender();
        return;
      }
    });
  }
};
