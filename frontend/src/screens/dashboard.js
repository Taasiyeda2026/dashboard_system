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

function normalizeNames(names) {
  const unique = [...new Set((Array.isArray(names) ? names : []).map((n) => String(n || '').trim()).filter(Boolean))];
  return unique.join(', ');
}

function getStrictNumericField(obj, fieldName) {
  if (!obj || typeof obj !== 'object' || !Object.prototype.hasOwnProperty.call(obj, fieldName)) {
    return { ok: false, reason: 'missing_field', fieldName };
  }
  const raw = obj[fieldName];
  const asNumber = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(asNumber)) {
    return { ok: false, reason: 'invalid_number', fieldName };
  }
  return { ok: true, value: asNumber, fieldName };
}

function pickNumericFallback(obj, fieldName, fallbackValue = 0) {
  const strict = getStrictNumericField(obj, fieldName);
  if (strict.ok) return strict.value;
  const fromFallback = Number(fallbackValue);
  return Number.isFinite(fromFallback) ? fromFallback : 0;
}

const MANAGER_DISPLAY_NAMES = {
  'גיל נאמן':               'מחוז צפון',
  'לינוי שמואל מזרחי':      'מחוז דרום',
};

function renderStructuredSummary(summary, ym, byManager) {
  const monthTitle     = hebrewMonthTitle(ym);
  const nextMonthTitle = hebrewMonthTitle(shiftYm(ym, 1));

  const activeCurrentField = getStrictNumericField(summary, 'active_courses_current_month');
  const endingCurrentField = getStrictNumericField(summary, 'ending_courses_current_month');
  const activeNextField = getStrictNumericField(summary, 'active_courses_next_month');
  const missingInstrField = getStrictNumericField(summary, 'missing_instructor_count');
  const missingDateField = getStrictNumericField(summary, 'missing_start_date_count');
  const lateEndField = getStrictNumericField(summary, 'late_end_date_count');
  const exceptionsFromParts = pickNumericFallback(summary, 'missing_instructor_count')
    + pickNumericFallback(summary, 'missing_start_date_count')
    + pickNumericFallback(summary, 'late_end_date_count');
  const exceptionsTotalField = getStrictNumericField(summary, 'exceptions_count');
  const byManagerExceptions = (Array.isArray(byManager) ? byManager : [])
    .reduce((sum, row) => sum + (Number(row?.exceptions || 0) || 0), 0);
  const exceptionsTotalResolved = exceptionsTotalField.ok
    ? Math.max(exceptionsTotalField.value, exceptionsFromParts, byManagerExceptions)
    : Math.max(exceptionsFromParts, byManagerExceptions);

  const activeCurrent = escapeHtml(String(activeCurrentField.ok ? activeCurrentField.value : 'שגיאת מיפוי'));
  const endingCurrent = escapeHtml(String(endingCurrentField.ok ? endingCurrentField.value : 'שגיאת מיפוי'));
  const activeNext = escapeHtml(String(activeNextField.ok ? activeNextField.value : 'שגיאת מיפוי'));
  const missingInstr = escapeHtml(String(missingInstrField.ok ? missingInstrField.value : 'שגיאת מיפוי'));
  const missingDate = escapeHtml(String(missingDateField.ok ? missingDateField.value : 'שגיאת מיפוי'));
  const lateEnd = escapeHtml(String(lateEndField.ok ? lateEndField.value : 'שגיאת מיפוי'));
  const exceptionsTotal = escapeHtml(String(exceptionsTotalResolved));

  const mappingErrors = [
    activeCurrentField,
    endingCurrentField,
    activeNextField,
    missingInstrField,
    missingDateField,
    lateEndField
  ].filter((field) => !field.ok);

  const districtRows = (Array.isArray(byManager) ? byManager : []).filter(
    (row) => row.activity_manager && row.activity_manager !== 'activity_manager' && row.activity_manager !== 'unassigned'
  );

  const districtByName = districtRows.reduce((acc, row) => {
    const label = MANAGER_DISPLAY_NAMES[row.activity_manager] || row.activity_manager;
    acc[label] = row;
    return acc;
  }, {});
  const northRow = districtByName['מחוז צפון'] || {};
  const southRow = districtByName['מחוז דרום'] || {};
  const northActive = escapeHtml(String(northRow.total_long ?? 0));
  const southActive = escapeHtml(String(southRow.total_long ?? 0));

  const allInstructors = normalizeNames(Array.isArray(summary?.active_instructors) ? summary.active_instructors : []);

  return `<div class="ds-summary-panel__structured">
    <h3 class="ds-summary-panel__title">סיכום חודשי – <strong>${escapeHtml(monthTitle)}</strong></h3>

    <p class="ds-summary-panel__text">בחודש <strong>${escapeHtml(monthTitle)}</strong> יש קורסים (<strong>${activeCurrent}</strong>) קורסים פעילים.</p>
    <p class="ds-summary-panel__text">במהלך החודש צפויים להסתיים (<strong>${endingCurrent}</strong>) קורסי.</p>
    <p class="ds-summary-panel__text ds-summary-panel__text--districts">מחוז צפון: (<strong>${northActive}</strong>) קורסים פעילים · מחוז דרום: (<strong>${southActive}</strong>) קורסים פעילים</p>
    <p class="ds-summary-panel__text">בחודש <strong>${escapeHtml(nextMonthTitle)}</strong> צפויים להיות (<strong>${activeNext}</strong>) קורסים פעילים.</p>

    <h4 class="ds-summary-panel__inner-title"><strong>המדריכים הפעילים החודש:</strong></h4>
    <p class="ds-summary-panel__text">${escapeHtml(allInstructors || '—')}</p>

    <div class="ds-summary-panel__block ds-summary-panel__block--exceptions">
      <h4 class="ds-summary-panel__inner-title"><strong>חריגות החודש:</strong></h4>
      <p class="ds-summary-panel__text"><strong>סה״כ חריגות: ${exceptionsTotal}</strong></p>
    </div>
    ${mappingErrors.length ? `<p class="ds-summary-panel__text" style="color:#b42318"><strong>שגיאת מיפוי שדות Snapshot:</strong> ${escapeHtml(mappingErrors.map((f) => f.fieldName).join(', '))}</p>` : ''}
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
    return api.dashboardSnapshot({ month: ym });
  },
  render(data, { state } = {}) {
    const ym = data?.month || currentMonthYm();

    const _seenMgr = new Set();
    const managers = (Array.isArray(data.by_activity_manager) ? data.by_activity_manager : []).filter(
      (row) => {
        if (!row.activity_manager || row.activity_manager === 'activity_manager' || row.activity_manager === 'unassigned') return false;
        if (_seenMgr.has(row.activity_manager)) return false;
        _seenMgr.add(row.activity_manager);
        return true;
      }
    );
    const showOnly = !!data?.show_only_nonzero_kpis;
    const kpiCards = filterKpiCards(data?.kpi_cards, showOnly);

    const managerCards = managers
      .map((row) => {
        const mgr = encodeURIComponent(row.activity_manager);
        const displayName = MANAGER_DISPLAY_NAMES[row.activity_manager] || row.activity_manager;
        const isDistrict = !!MANAGER_DISPLAY_NAMES[row.activity_manager];
        const exceptionsValue = Number(row.exceptions ?? 0);
        const allStats = [
          { label: 'תוכניות פעילות', value: row.total_long      ?? 0, action: `mstat|${mgr}|long` },
          { label: 'מדריכים פעילים',  value: row.num_instructors ?? 0, action: `mstat|${mgr}|instructors` },
          { label: 'חריגות',           value: exceptionsValue, action: `mstat|${mgr}|exceptions` },
          { label: 'סיומי קורסים',    value: row.course_endings  ?? 0, action: `mstat|${mgr}|endings` },
        ];
        const stats = isDistrict ? allStats.filter((s) => s.label !== 'חריגות') : allStats;
        const statsHtml = stats
          .map((s) => {
            const displayValue = s.label === 'חריגות' && Number(s.value || 0) === 0 ? 'מצב תקין' : s.value;
            return `<button type="button" class="ds-manager-stat" data-card-action="${escapeHtml(s.action)}">
              <span class="ds-manager-stat__label">${escapeHtml(s.label)}</span>
              <span class="ds-manager-stat__value">${escapeHtml(String(displayValue))}</span>
            </button>`;
          })
          .join('');
        return `<div class="ds-manager-card${isDistrict ? ' ds-manager-card--district' : ''}">
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

    const navLoading = !!state?.dashboardNavLoading;
    const monthNav = `<div class="ds-dash-month-nav${navLoading ? ' is-nav-loading' : ''}" dir="rtl" aria-label="בחירת חודש לתצוגה">
      <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-dash-month-prev aria-label="חודש קודם" title="חודש קודם" ${navLoading ? 'disabled' : ''}>▶</button>
      <span class="ds-dash-month-nav__label">${escapeHtml(hebrewMonthTitle(ym))} ${navLoading ? '<span class="ds-inline-loading-dot is-inline-loading" aria-hidden="true"></span>' : ''}</span>
      <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-dash-month-next aria-label="חודש הבא" title="חודש הבא" ${navLoading ? 'disabled' : ''}>◀</button>
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
    function putDashboardCache(cacheKey, payload) {
      const existing = state.screenDataCache[cacheKey];
      if (!existing) {
        state.screenDataCache[cacheKey] = { data: payload, t: Date.now() };
        return;
      }
      const existingIsSnapshot = !!existing.data?._is_snapshot;
      const nextIsSnapshot = !!payload?._is_snapshot;
      if (!nextIsSnapshot) {
        state.screenDataCache[cacheKey] = { data: payload, t: Date.now() };
        return;
      }
      if (existingIsSnapshot) {
        state.screenDataCache[cacheKey] = { data: payload, t: Date.now() };
      }
    }

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

    const prefetchDashboardMonth = (targetYm) => {
      const validYm = /^\d{4}-\d{2}$/.test(targetYm || '') ? targetYm : '';
      if (!validYm) return;
      const key = `dashboard:${validYm}`;
      const cached = state.screenDataCache[key];
      if (cached?.data && Date.now() - cached.t < DASHBOARD_TTL_MS) return;
      api.dashboardSnapshot({ month: validYm })
        .then((payload) => {
          putDashboardCache(key, payload);
        })
        .catch(() => {});
    };

    const applyYm = async (nextYm) => {
      if (state.dashboardNavLoading) return;
      state.dashboardNavLoading = true;
      state.dashboardMonthYm = nextYm;
      const cacheKey = `dashboard:${/^\d{4}-\d{2}$/.test(nextYm) ? nextYm : 'default'}`;

      const cached = state.screenDataCache[cacheKey];
      if (cached?.data && Date.now() - cached.t < DASHBOARD_TTL_MS) {
        rerender();
      } else {
        showDataAreaLoading();
        let snapshotLoaded = false;
        try {
          const snapshotData = await api.dashboardSnapshot({ month: nextYm });
          putDashboardCache(cacheKey, snapshotData);
          snapshotLoaded = true;
        } catch (_err) {
          if (!snapshotLoaded) clearScreenDataCache?.();
        }
        rerender();
      }
      state.dashboardNavLoading = false;
      rerender();
      prefetchDashboardMonth(shiftYm(nextYm, -1));
      prefetchDashboardMonth(shiftYm(nextYm, 1));
    };

    setTimeout(() => {
      if (!state.dashboardNavLoading) {
        prefetchDashboardMonth(shiftYm(ym, -1));
        prefetchDashboardMonth(shiftYm(ym, 1));
      }
    }, 1500);

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
        state.exceptionsMonthYm = state.dashboardMonthYm || currentMonthYm();
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
          state.exceptionsMonthYm = state.dashboardMonthYm || currentMonthYm();
        }
        ui.closeAll();
        rerender();
        return;
      }
    });
  }
};
