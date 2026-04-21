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

const ALLOWED_KPI_ACTIONS = new Set([
  'kpi|long',
  'kpi|short',
  'kpi|exceptions',
  'kpi|instructors',
  'kpi|endings'
]);

function filterKpiCards(cards, showOnlyNonzero) {
  const list = Array.isArray(cards) ? cards : [];
  const allowed = list.filter((c) => c && c.action && ALLOWED_KPI_ACTIONS.has(c.action));
  if (!showOnlyNonzero) return allowed;
  return allowed.filter((c) => c.id === 'exceptions' || Number(c.value || 0) > 0);
}

// ─────────────────────────────────────────────────────────────────────────────

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
          { label: 'תוכניות פעילות', value: row.total_long      ?? 0, action: `mstat|${mgr}|long` },
          { label: 'מדריכים פעילים',  value: row.num_instructors ?? 0, action: `mstat|${mgr}|instructors` },
          { label: 'חריגות',           value: row.exceptions      ?? 0, action: `mstat|${mgr}|exceptions` },
          { label: 'סיומי קורסים',    value: row.course_endings  ?? 0, action: `mstat|${mgr}|endings` },
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
      : '<p class="ds-muted">אין כרטיסי KPI להצגה.</p>';

    const monthNav = `<div class="ds-dash-month-nav" dir="rtl" aria-label="בחירת חודש לתצוגה">
      <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-dash-month-prev aria-label="חודש קודם">◀</button>
      <span class="ds-dash-month-nav__label">${escapeHtml(hebrewMonthTitle(ym))}</span>
      <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-dash-month-next aria-label="חודש הבא" ${
        canGoNext ? '' : 'disabled'
      }>▶</button>
    </div>`;

    return dsScreenStack(`
      ${dsPageHeader('לוח בקרה')}
      ${monthNav}
      <div data-dash-data-area>
        <div class="ds-kpi-grid ds-dashboard-kpi-grid">${kpiHtml}</div>
        ${dsCard({
          title: 'פעילויות לפי מנהל פעילות',
          body: managersBlock,
          padded: true
        })}
      </div>
    `);
  },
  bind({ root, ui, state, api, rerender, clearScreenDataCache }) {
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
      if (action === 'kpi|long') {
        goActivitiesDrill(state, { activityQuickFamily: 'long' });
        ui.closeAll();
        rerender();
        return;
      }
      if (action === 'kpi|short') {
        goActivitiesDrill(state, { activityQuickFamily: 'short' });
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
      if (action === 'kpi|exceptions') {
        state.route = 'exceptions';
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
        } else if (kind === 'exceptions') {
          state.route = 'exceptions';
        }
        ui.closeAll();
        rerender();
        return;
      }
    });
  }
};
