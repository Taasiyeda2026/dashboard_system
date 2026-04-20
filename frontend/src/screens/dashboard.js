import { escapeHtml } from './shared/html.js';
import { UI_ACTIVITY_FAMILY_LONG, UI_ACTIVITY_FAMILY_SHORT } from './shared/ui-hebrew.js';
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
  const [y, m] = String(ym || currentMonthYm()).split('-').map(Number);
  const d = new Date(y, (m || 1) - 1 + deltaMonths, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function hebrewMonthTitle(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || '').trim());
  if (!m) return ym || '';
  const mo = Number(m[2]);
  const name = mo >= 1 && mo <= 12 ? HEBREW_MONTHS[mo - 1] : m[2];
  return `${name} ${m[1]}`;
}

function dashboardCacheKey(ym) {
  return `dashboard:${/^\d{4}-\d{2}$/.test(String(ym || '')) ? ym : 'default'}`;
}

function isFreshDashboardCache(entry) {
  if (!entry || typeof entry.t !== 'number') return false;
  return Date.now() - entry.t < 5 * 60 * 1000;
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

function dashboardDataAreaHtml(data) {
  const managers = Array.isArray(data?.by_activity_manager) ? data.by_activity_manager : [];
  const showOnly = !!data?.show_only_nonzero_kpis;
  const kpiCards = filterKpiCards(data?.kpi_cards, showOnly);

  const managerCards = managers
    .map((row) => {
      const meta = `${UI_ACTIVITY_FAMILY_SHORT}: ${row.total_short} · ${UI_ACTIVITY_FAMILY_LONG}: ${row.total_long} · סה״כ: ${row.total}`;
      return dsInteractiveCard({
        variant: 'mini',
        action: `manager|${encodeURIComponent(row.activity_manager)}`,
        title: row.activity_manager,
        meta
      });
    })
    .join('');

  const managersBlock = managers.length
    ? `<div class="ds-mini-grid">${managerCards}</div>`
    : '<div class="ds-empty"><p class="ds-empty__msg">אין נתונים להצגה</p></div>';

  const kpiHtml = kpiCards.length
    ? kpiCards
        .map((k) =>
          dsInteractiveCard({
            variant: 'kpi',
            action: k.action,
            title: k.title,
            subtitle: k.subtitle
          })
        )
        .join('')
    : '<p class="ds-muted">אין כרטיסי KPI להצגה (לפי מסנן &quot;ערך בלבד&quot;).</p>';

  return `
    <div class="ds-kpi-grid">${kpiHtml}</div>
    ${dsCard({
      title: 'פילוח לפי אחראי פעילות',
      badge: `${managers.length} רשומות`,
      body: managersBlock,
      padded: true
    })}
  `;
}

function bindDashboardCardActions(root, ui, state, rerender) {
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

export const dashboardScreen = {
  load: ({ api, state }) => {
    let ym = state.dashboardMonthYm;
    if (!ym || !/^\d{4}-\d{2}$/.test(ym)) {
      ym = currentMonthYm();
      state.dashboardMonthYm = ym;
    }
    return api.dashboard({ month: ym });
  },
  render(data, { state }) {
    const ym = data?.month || state.dashboardMonthYm || currentMonthYm();
    const curYm = currentMonthYm();
    const canGoNext = ym < curYm;

    return dsScreenStack(`
      ${dsPageHeader('לוח בקרה', 'תמונת מצב כללית — לחיצה מעבירה לעבודה')}
      <nav class="ds-cal-nav" role="navigation" aria-label="ניווט חודשי בדשבורד" dir="rtl">
        <button type="button" class="ds-btn ds-btn--sm" data-dash-month-prev aria-label="חודש קודם">▶ חודש קודם</button>
        <span class="ds-cal-nav__label" data-dash-month-label>${escapeHtml(hebrewMonthTitle(ym))}</span>
        <button type="button" class="ds-btn ds-btn--sm" data-dash-month-next aria-label="חודש הבא" ${canGoNext ? '' : 'disabled'}>חודש הבא ◀</button>
      </nav>
      <div data-dash-data-area>
        ${dashboardDataAreaHtml(data)}
      </div>
    `);
  },
  bind({ root, ui, state, api, rerender }) {
    bindDashboardCardActions(root, ui, state, rerender);
    let monthRequestSeq = 0;

    const setMonthHeader = (ym) => {
      const curYm = currentMonthYm();
      const labelNode = root.querySelector('[data-dash-month-label]');
      if (labelNode) labelNode.textContent = hebrewMonthTitle(ym);
      const nextBtn = root.querySelector('[data-dash-month-next]');
      if (nextBtn) nextBtn.disabled = ym >= curYm;
    };

    const showAreaLoading = () => {
      const area = root.querySelector('[data-dash-data-area]');
      if (area) {
        area.innerHTML = '<div class="ds-loading-card" dir="rtl" role="status"><div class="ds-spinner" aria-hidden="true"></div><p>טוען נתוני דשבורד...</p></div>';
      }
    };

    const applyYm = async (nextYm) => {
      monthRequestSeq += 1;
      const reqId = monthRequestSeq;
      state.dashboardMonthYm = nextYm;
      setMonthHeader(nextYm);

      const cacheKey = dashboardCacheKey(nextYm);
      const cached = state.screenDataCache[cacheKey];
      if (isFreshDashboardCache(cached)) {
        const area = root.querySelector('[data-dash-data-area]');
        if (area) {
          area.innerHTML = dashboardDataAreaHtml(cached.data);
          bindDashboardCardActions(root, ui, state, rerender);
        }
        return;
      }

      showAreaLoading();
      try {
        const data = await api.dashboard({ month: nextYm });
        if (reqId !== monthRequestSeq) return;
        state.screenDataCache[cacheKey] = { data, t: Date.now() };
        const area = root.querySelector('[data-dash-data-area]');
        if (area) {
          area.innerHTML = dashboardDataAreaHtml(data);
          bindDashboardCardActions(root, ui, state, rerender);
        }
      } catch (_error) {
        if (reqId !== monthRequestSeq) return;
        rerender();
      }
    };

    root.querySelector('[data-dash-month-prev]')?.addEventListener('click', () => {
      const currentYm = state.dashboardMonthYm || currentMonthYm();
      applyYm(shiftYm(currentYm, -1));
    });

    root.querySelector('[data-dash-month-next]')?.addEventListener('click', () => {
      const currentYm = state.dashboardMonthYm || currentMonthYm();
      const nextYm = shiftYm(currentYm, 1);
      if (nextYm <= currentMonthYm()) {
        applyYm(nextYm);
      }
    });
  }
};
