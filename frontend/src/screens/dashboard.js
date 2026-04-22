import { escapeHtml } from './shared/html.js';
import { dsPageHeader, dsCard, dsScreenStack, dsInteractiveCard } from './shared/layout.js';
import { hebrewActivityType } from './shared/ui-hebrew.js';

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

function normalizeNames(names) {
  const unique = [...new Set((Array.isArray(names) ? names : []).map((n) => String(n || '').trim()).filter(Boolean))];
  return unique.join(', ');
}

const MANAGER_DISPLAY_NAMES = {
  'גיל נאמן':               'מחוז צפון',
  'לינוי שמואל מזרחי':      'מחוז דרום',
};

function renderStructuredSummary(summary, ym, byManager) {
  const monthTitle   = hebrewMonthTitle(ym);
  const nextMonthTitle = hebrewMonthTitle(shiftYm(ym, 1));
  const instructorList = Array.isArray(summary?.active_instructors) ? summary.active_instructors : [];
  const instructorCount = instructorList.length;
  const instructorNames = normalizeNames(instructorList);
  const shortActivities = Array.isArray(summary?.short_activities) ? summary.short_activities : [];
  const hasShortActivities = shortActivities.length > 0;

  const activeCurrent  = String(summary?.active_courses_current_month ?? 0);
  const endingCurrent  = String(summary?.ending_courses_current_month ?? 0);
  const activeNext     = String(summary?.active_courses_next_month ?? 0);
  const missingInstr   = String(summary?.missing_instructor_count ?? 0);
  const missingDate    = String(summary?.missing_start_date_count ?? 0);
  const lateEnd        = String(summary?.late_end_date_count ?? 0);

  // ── Stat chips ──────────────────────────────────────────────────────────
  const statChips = [
    { num: activeCurrent, label: 'קורסים פעילים' },
    { num: endingCurrent, label: 'יסתיימו החודש' },
    { num: String(instructorCount), label: 'מדריכים פעילים' },
  ].map((s) => `<div class="ds-summary-stat">
      <span class="ds-summary-stat__num">${escapeHtml(s.num)}</span>
      <span class="ds-summary-stat__label">${escapeHtml(s.label)}</span>
    </div>`).join('');

  // ── Instructors line ────────────────────────────────────────────────────
  const instructorsLine = instructorNames
    ? `<p class="ds-summary-panel__text ds-summary-panel__text--instructors">
        <span class="ds-summary-label">מדריכים:</span> ${escapeHtml(instructorNames)}
       </p>`
    : '';

  // ── District grid ───────────────────────────────────────────────────────
  const districtRows = (Array.isArray(byManager) ? byManager : []).filter(
    (row) => row.activity_manager && row.activity_manager !== 'activity_manager' && row.activity_manager !== 'unassigned'
  );
  const districtHtml = districtRows.length
    ? `<div class="ds-summary-district-grid">
        ${districtRows.map((row) => {
          const name = MANAGER_DISPLAY_NAMES[row.activity_manager] || row.activity_manager;
          return `<div class="ds-summary-district-card">
            <span class="ds-summary-district-card__name">${escapeHtml(name)}</span>
            <span class="ds-summary-district-card__num">${escapeHtml(String(row.total_long ?? 0))}</span>
            <span class="ds-summary-district-card__sub">קורסים פעילים</span>
          </div>`;
        }).join('')}
      </div>`
    : '';

  // ── Next month ──────────────────────────────────────────────────────────
  const nextMonthLine = `<p class="ds-summary-panel__text">
    <span class="ds-summary-label">חודש הבא – ${escapeHtml(nextMonthTitle)}:</span>
    <strong>${escapeHtml(activeNext)}</strong> קורסים פעילים
  </p>`;

  // ── Exceptions ──────────────────────────────────────────────────────────
  const exceptionItems = [
    { num: missingInstr, label: 'ללא שיבוץ מדריך' },
    { num: missingDate,  label: 'ללא תאריך התחלה' },
    { num: lateEnd,      label: 'סיכון סיום' },
  ].map((e) => `<div class="ds-summary-exception-item">
      <span class="ds-summary-exception-item__num">${escapeHtml(e.num)}</span>
      <span class="ds-summary-exception-item__text">${escapeHtml(e.label)}</span>
    </div>`).join('');

  // ── Short activities ────────────────────────────────────────────────────
  const shortActivitiesHtml = hasShortActivities
    ? `<div class="ds-summary-panel__block ds-summary-panel__block--short-activities">
        <h4 class="ds-summary-panel__inner-title"><strong>פעילויות חד-יומיות בחודש זה</strong></h4>
        <ul class="ds-summary-panel__list">
          ${shortActivities.map((item) =>
            `<li><strong>${escapeHtml(hebrewActivityType(item.activity_type || ''))}</strong> – <strong>${escapeHtml(String(item.count || 0))}</strong></li>`
          ).join('')}
        </ul>
      </div>`
    : '';

  return `<div class="ds-summary-panel__structured">
    <h3 class="ds-summary-panel__title">סיכום חודשי – <strong>${escapeHtml(monthTitle)}</strong></h3>

    <div class="ds-summary-stat-row">${statChips}</div>

    ${instructorsLine}

    ${districtHtml}

    ${nextMonthLine}

    <div class="ds-summary-panel__block ds-summary-panel__block--exceptions">
      <h4 class="ds-summary-panel__inner-title">⚠️ חריגות החודש</h4>
      <div class="ds-summary-exception-row">${exceptionItems}</div>
    </div>

    ${shortActivitiesHtml}
  </div>`;
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

    const managers = (Array.isArray(data.by_activity_manager) ? data.by_activity_manager : []).filter(
      (row) => row.activity_manager && row.activity_manager !== 'activity_manager' && row.activity_manager !== 'unassigned'
    );
    const showOnly = !!data?.show_only_nonzero_kpis;
    const kpiCards = filterKpiCards(data?.kpi_cards, showOnly);

    const managerCards = managers
      .map((row) => {
        const mgr = encodeURIComponent(row.activity_manager);
        const displayName = MANAGER_DISPLAY_NAMES[row.activity_manager] || row.activity_manager;
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
          <div class="ds-manager-card__head">
            <p class="ds-manager-card__name">${escapeHtml(displayName)}</p>
          </div>
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
              value: k.value != null ? String(k.value) : String(k.title || ''),
              extraClass: (k.id === 'exceptions' && Number(k.value || 0) > 0) ? 'ds-kpi--exceptions-alert' : ''
            })
          )
          .join('')
      : '<p class="ds-muted">אין כרטיסי KPI להצגה.</p>';

    const monthNav = `<div class="ds-dash-month-nav" dir="rtl" aria-label="בחירת חודש לתצוגה">
      <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-dash-month-prev aria-label="חודש קודם">▶</button>
      <span class="ds-dash-month-nav__label">${escapeHtml(hebrewMonthTitle(ym))}</span>
      <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-dash-month-next aria-label="חודש הבא">◀</button>
    </div>`;

    return dsScreenStack(`
      <div class="ds-dashboard-wrap">
        ${dsPageHeader('לוח בקרה')}
        ${monthNav}
        <div data-dash-data-area>
          <div class="ds-dashboard-summary-row">
            <button type="button" class="ds-summary-btn" data-summary-target="national" aria-label="סיכום">סיכום</button>
          </div>
          <div class="ds-summary-panel" data-summary-panel="national" hidden>
            <div class="ds-summary-panel__content"></div>
          </div>
          <div class="ds-kpi-grid ds-dashboard-kpi-grid">${kpiHtml}</div>
          <div style="margin-top: var(--ds-space-3)"></div>
          ${dsCard({
            title: 'פעילויות לפי מחוזות',
            body: managersBlock,
            padded: true
          })}
        </div>
      </div>
    `);
  },
  bind({ root, ui, state, api, rerender, clearScreenDataCache, data }) {
    const DASHBOARD_TTL_MS = 5 * 60 * 1000;
    const ym = data?.month || state.dashboardMonthYm || currentMonthYm();

    function getSummaryBtn(target) {
      return [...root.querySelectorAll('.ds-summary-btn[data-summary-target]')]
        .find((el) => (el.dataset.summaryTarget || '') === target);
    }

    function getSummaryPanel(target) {
      return [...root.querySelectorAll('.ds-summary-panel[data-summary-panel]')]
        .find((el) => (el.dataset.summaryPanel || '') === target);
    }

    function toggleSummaryButton(target, disabled) {
      const btn = getSummaryBtn(target);
      if (btn) btn.disabled = !!disabled;
    }

    function showSummary(target, htmlText) {
      const panel = getSummaryPanel(target);
      const content = panel?.querySelector('.ds-summary-panel__content');
      const btn = getSummaryBtn(target);
      if (!panel || !content) return;
      const isOpen = !panel.hidden;
      if (isOpen) {
        panel.hidden = true;
        if (btn) {
          btn.textContent = 'סיכום';
          btn.classList.remove('is-active');
        }
      } else {
        panel.hidden = false;
        content.innerHTML = htmlText;
        if (btn) {
          btn.textContent = 'סגור ✕';
          btn.classList.add('is-active');
        }
      }
      toggleSummaryButton(target, false);
    }

    function handleSummaryClick(target) {
      const nationalSummary = renderStructuredSummary(data?.summary || {}, ym, data?.by_activity_manager);
      showSummary(target, nationalSummary);
    }

    function showDataAreaLoading() {
      const area = root.querySelector('[data-dash-data-area]');
      if (area) {
        area.innerHTML = '<div class="ds-loading-card" dir="rtl" role="status"><div class="ds-spinner" aria-hidden="true"></div><p>טוען נתונים...</p></div>';
      }
    }

    function prefetchAdjacentDashboard(baseYm) {
      [shiftYm(baseYm, -1), shiftYm(baseYm, 1)].forEach((adjYm) => {
        const adjKey = `dashboard:${adjYm}`;
        const hit = state.screenDataCache[adjKey];
        if (hit && Date.now() - hit.t < DASHBOARD_TTL_MS) return;
        api.dashboard({ month: adjYm }).then((d) => {
          if (!state.screenDataCache[adjKey] || Date.now() - state.screenDataCache[adjKey].t > DASHBOARD_TTL_MS) {
            state.screenDataCache[adjKey] = { data: d, t: Date.now() };
          }
        }).catch(() => {});
      });
    }

    const applyYm = async (nextYm) => {
      state.dashboardMonthYm = nextYm;
      const cacheKey = `dashboard:${/^\d{4}-\d{2}$/.test(nextYm) ? nextYm : 'default'}`;

      const cached = state.screenDataCache[cacheKey];
      if (cached?.data && Date.now() - cached.t < DASHBOARD_TTL_MS) {
        rerender();
        prefetchAdjacentDashboard(nextYm);
        return;
      }

      showDataAreaLoading();
      try {
        const data = await api.dashboard({ month: nextYm });
        state.screenDataCache[cacheKey] = { data, t: Date.now() };
        prefetchAdjacentDashboard(nextYm);
      } catch (_err) {
        clearScreenDataCache?.();
      }
      rerender();
    };

    root.querySelector('[data-dash-month-prev]')?.addEventListener('click', () => {
      applyYm(shiftYm(state.dashboardMonthYm || currentMonthYm(), -1));
    });
    root.querySelector('[data-dash-month-next]')?.addEventListener('click', () => {
      applyYm(shiftYm(state.dashboardMonthYm || currentMonthYm(), 1));
    });

    root.querySelectorAll('.ds-summary-btn[data-summary-target]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.summaryTarget || '';
        handleSummaryClick(target);
      });
    });

    // Pre-fetch adjacent months silently after initial render
    prefetchAdjacentDashboard(state.dashboardMonthYm || currentMonthYm());

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
