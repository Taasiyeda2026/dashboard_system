import { escapeHtml } from './shared/html.js';
import { UI_ACTIVITY_FAMILY_LONG, UI_ACTIVITY_FAMILY_SHORT } from './shared/ui-hebrew.js';
import { dsPageHeader, dsCard, dsScreenStack, dsInteractiveCard } from './shared/layout.js';
import { dsPageListToolsBar, bindPageListTools } from './shared/page-list-tools.js';
import { clearScreenDataCache } from '../state.js';

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

function filterKpiCards(cards, showOnlyNonzero) {
  const list = Array.isArray(cards) ? cards : [];
  if (!showOnlyNonzero) return list;
  return list.filter((c) => Number(c.value || 0) > 0);
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
  render(data) {
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
        const searchHay = `${row.activity_manager} ${row.total_short} ${row.total_long} ${row.num_instructors ?? ''}`;
        const stats = [
          { label: UI_ACTIVITY_FAMILY_SHORT,   value: row.total_short    ?? 0 },
          { label: UI_ACTIVITY_FAMILY_LONG,    value: row.total_long     ?? 0 },
          { label: 'מדריכים',                  value: row.num_instructors ?? 0 },
          { label: 'סיומי קורסים',             value: row.course_endings  ?? 0 },
          { label: 'כספים פתוחים',             value: row.finance_open    ?? 0 },
          { label: 'חריגות',                   value: row.exceptions      ?? 0 },
        ];
        const statsHtml = stats
          .map((s) => `<div class="ds-manager-stat">
              <span class="ds-manager-stat__value">${escapeHtml(String(s.value))}</span>
              <span class="ds-manager-stat__label">${escapeHtml(s.label)}</span>
            </div>`)
          .join('');
        return `<div data-list-item data-search="${escapeHtml(searchHay)}" data-filter="">
          <button type="button" class="ds-manager-card" data-card-action="manager|${encodeURIComponent(row.activity_manager)}">
            <p class="ds-manager-card__name">${escapeHtml(row.activity_manager)}</p>
            <div class="ds-manager-stats">${statsHtml}</div>
          </button>
        </div>`;
      })
      .join('');

    const managersBlock = managers.length
      ? `<div class="ds-manager-grid">${managerCards}</div>`
      : '<div class="ds-empty"><p class="ds-empty__msg">אין נתונים להצגה</p></div>';

    const kpiHtml = kpiCards.length
      ? kpiCards
          .map((k) => {
            const searchHay = `${k.title || ''} ${k.value ?? ''}`.trim();
            return `<div data-list-item data-search="${escapeHtml(searchHay)}" data-filter="">
            ${dsInteractiveCard({
              variant: 'kpi',
              action: k.action,
              title: k.title,
              value: k.value != null ? String(k.value) : ''
            })}
          </div>`;
          })
          .join('')
      : '<p class="ds-muted">אין כרטיסי KPI להצגה (לפי מסנן &quot;ערך בלבד&quot;).</p>';

    const monthNav = `<div class="ds-dash-month-nav" dir="rtl" aria-label="בחירת חודש לתצוגה">
      <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-dash-month-prev aria-label="חודש קודם">◀</button>
      <span class="ds-dash-month-nav__label">${escapeHtml(hebrewMonthTitle(ym))}</span>
      <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-dash-month-next aria-label="חודש הבא" ${
        canGoNext ? '' : 'disabled'
      }>▶</button>
    </div>`;

    return dsScreenStack(`
      ${dsPageHeader('לוח בקרה', 'כל הסיכומים לפי חודש — חצים לשינוי חודש')}
      ${monthNav}
      ${dsPageListToolsBar({ searchPlaceholder: 'חיפוש בכרטיסים…', filters: [] })}
      <div class="ds-kpi-grid">${kpiHtml}</div>
      ${dsCard({
        title: 'פילוח לפי מנהל פעילויות',
        body: managersBlock,
        padded: true
      })}
    `);
  },
  bind({ root, ui, state, rerender }) {
    bindPageListTools(root);

    const applyYm = (nextYm) => {
      state.dashboardMonthYm = nextYm;
      clearScreenDataCache();
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
        state.route = 'finance';
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
      }
    });
  }
};
