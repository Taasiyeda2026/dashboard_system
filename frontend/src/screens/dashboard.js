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

const ALWAYS_SHOW_KPI_IDS = new Set(['exceptions']);

function filterKpiCards(cards, showOnlyNonzero) {
  const list = Array.isArray(cards) ? cards : [];
  const actionable = list.filter((c) => c && c.action);
  if (!showOnlyNonzero) return actionable;
  return actionable.filter((c) => ALWAYS_SHOW_KPI_IDS.has(c.id) || Number(c.value || 0) > 0);
}

// ─── Admin section (merged from admin-home) ──────────────────────────────────

const ADMIN_SCREEN_META = {
  dashboard:        { label: 'לוח בקרה',      icon: '📊' },
  activities:       { label: 'פעילויות',       icon: '📋' },
  finance:          { label: 'כספים',          icon: '💰' },
  permissions:      { label: 'הרשאות',         icon: '🔑' },
  exceptions:       { label: 'חריגות',         icon: '⚠️' },
  instructors:      { label: 'מדריכים',        icon: '👥' },
  'end-dates':      { label: 'תאריכי סיום',    icon: '📅' },
  'my-data':        { label: 'הנתונים שלי',    icon: '👤' },
  week:             { label: 'שבוע',           icon: '📆' },
  month:            { label: 'חודש',           icon: '🗓️' }
};

const ADMIN_NAV_ROUTES = ['dashboard', 'activities', 'finance', 'exceptions', 'permissions'];

const SYSTEM_SHEET_LABELS = {
  data_short:               'פעילויות (קצרות)',
  data_long:                'פעילויות (ארוכות)',
  permissions:              'הרשאות משתמשים',
  settings:                 'הגדרות מערכת',
  lists:                    'רשימות בחירה',
  activity_meetings:        'מפגשי פעילות',
  contacts_instructors:     'אנשי קשר – מדריכים',
  contacts_schools:         'אנשי קשר – בתי ספר',
  edit_requests:            'בקשות עריכה',
  operations_private_notes: 'הערות פרטיות'
};

function renderSheetDiagnostics(data) {
  if (!data) return '<p class="ds-muted">לא התקבלו נתונים.</p>';
  const { sheets = [], missing_required_sheets = [], data_start_row, activities_data_sources = [] } = data;

  const missingBanner = missing_required_sheets.length
    ? `<div class="ds-alert ds-alert--warn" style="margin-bottom:1rem" dir="rtl">
        <strong>גיליונות חסרים:</strong> ${missing_required_sheets.map(escapeHtml).join(', ')}
       </div>`
    : '';

  const metaInfo = `<p class="ds-muted" dir="rtl" style="margin-bottom:.75rem">
    שורת נתונים מתחילה בשורה ${escapeHtml(String(data_start_row))} ·
    מקורות פעילויות: ${activities_data_sources.map(escapeHtml).join(', ') || '—'}
  </p>`;

  const systemSheets = sheets.filter((s) => s.is_system_sheet);
  const otherSheets  = sheets.filter((s) => !s.is_system_sheet);

  function sheetCard(s) {
    const label = SYSTEM_SHEET_LABELS[s.name] || s.name;
    const statusIcon = s.ok ? '✅' : s.missing_cols && s.missing_cols.length ? '⚠️' : '📄';
    const missingColsHtml = s.missing_cols && s.missing_cols.length
      ? `<p style="margin:.25rem 0 0;color:var(--ds-color-warn,#d97706)">עמודות חסרות: ${s.missing_cols.map(escapeHtml).join(', ')}</p>`
      : '';
    const extraColsHtml = s.extra_cols && s.extra_cols.length
      ? `<p style="margin:.25rem 0 0" class="ds-muted">עמודות נוספות: ${s.extra_cols.map(escapeHtml).join(', ')}</p>`
      : '';
    const headersHtml = `<p class="ds-muted" style="margin:.3rem 0 0;font-size:.8rem;word-break:break-all">${s.headers.filter(Boolean).map(escapeHtml).join(' · ')}</p>`;
    return `<div class="ds-sheet-diag-row" dir="rtl">
      <div style="display:flex;align-items:baseline;gap:.4rem">
        <span>${statusIcon}</span>
        <strong>${escapeHtml(label)}</strong>
        <code class="ds-muted" style="font-size:.75rem">${escapeHtml(s.name)}</code>
        <span class="ds-muted" style="font-size:.8rem">(${escapeHtml(String(s.row_count))} שורות נתונים)</span>
      </div>
      ${headersHtml}${missingColsHtml}${extraColsHtml}
    </div>`;
  }

  const systemHtml = systemSheets.length
    ? systemSheets.map(sheetCard).join('')
    : '<p class="ds-muted">לא נמצאו גיליונות מערכת.</p>';

  const otherHtml = otherSheets.length
    ? `<details style="margin-top:.75rem">
        <summary class="ds-muted" style="cursor:pointer">גיליונות נוספים (${otherSheets.length})</summary>
        <div style="margin-top:.5rem">${otherSheets.map(sheetCard).join('')}</div>
       </details>`
    : '';

  return `${missingBanner}${metaInfo}<div class="ds-sheet-diag-list">${systemHtml}</div>${otherHtml}`;
}

function renderAdminSection(state) {
  const role = state?.user?.display_role;
  if (role !== 'admin' && role !== 'operations_reviewer') return '';

  const routes = Array.isArray(state?.routes) ? state.routes : [];
  const cards = ADMIN_NAV_ROUTES
    .filter((r) => routes.includes(r))
    .map((route) => {
      const meta = ADMIN_SCREEN_META[route] || { label: route, icon: '▶' };
      return `<button type="button" class="ds-admin-ctrl-card ds-admin-ctrl-card--link" data-admin-nav="${escapeHtml(route)}">
        <span class="ds-admin-ctrl-icon">${meta.icon}</span>
        <span class="ds-admin-ctrl-title">${escapeHtml(meta.label)}</span>
      </button>`;
    })
    .join('');

  const navBody = cards
    ? `<div class="ds-admin-ctrl-grid ds-admin-ctrl-grid--3col">${cards}</div>`
    : '';

  const diagBody = `
    <div dir="rtl">
      <p class="ds-muted" style="margin-bottom:.75rem">
        בדיקת גיליונות האקסל המחוברים — שמות הגיליונות, העמודות שלהם, ואם הם תואמים למה שהמערכת מצפה.
      </p>
      <button type="button" class="ds-btn ds-btn--primary" data-check-sheets>בדיקת גיליונות</button>
      <div id="sheet-diag-result" style="margin-top:1rem"></div>
    </div>
  `;

  return `
    ${navBody ? dsCard({ title: 'ניווט מהיר', body: navBody, padded: true }) : ''}
    ${dsCard({ title: 'אבחון גיליונות', body: diagBody, padded: true })}
  `;
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
          { label: 'מדריכים',      value: row.num_instructors ?? 0, action: `mstat|${mgr}|instructors` },
          { label: 'תוכניות',      value: row.total_long      ?? 0, action: `mstat|${mgr}|long` },
          { label: 'סיומי קורסים', value: row.course_endings  ?? 0, action: `mstat|${mgr}|endings` },
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

    return dsScreenStack(`
      ${dsPageHeader('לוח בקרה')}
      ${monthNav}
      <div data-dash-data-area>
        <div class="ds-kpi-grid ds-dashboard-kpi-grid">${kpiHtml}</div>
        ${dsCard({
          title: 'פילוח לפי מנהל פעילויות',
          body: managersBlock,
          padded: true
        })}
      </div>
      ${renderAdminSection(state)}
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

    // Admin section: navigation cards
    root.querySelectorAll('[data-admin-nav]').forEach((card) => {
      card.addEventListener('click', () => {
        const target = card.dataset.adminNav;
        if (!target) return;
        document.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: target } }));
      });
    });

    // Admin section: sheet diagnostics
    const checkBtn = root.querySelector('[data-check-sheets]');
    const resultEl = root.querySelector('#sheet-diag-result');
    if (checkBtn && resultEl) {
      checkBtn.addEventListener('click', async () => {
        checkBtn.disabled = true;
        checkBtn.textContent = 'בודק...';
        resultEl.innerHTML = '<p class="ds-muted">טוען נתוני גיליונות...</p>';
        try {
          const data = await api.listSheets();
          resultEl.innerHTML = renderSheetDiagnostics(data);
        } catch (err) {
          resultEl.innerHTML = `<p style="color:var(--ds-color-error,#dc2626)">${escapeHtml(err?.message || 'שגיאה בטעינת הגיליונות')}</p>`;
        } finally {
          checkBtn.disabled = false;
          checkBtn.textContent = 'בדיקת גיליונות';
        }
      });
    }

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
