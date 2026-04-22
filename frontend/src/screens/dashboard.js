import { escapeHtml } from './shared/html.js';
import { dsPageHeader, dsCard, dsScreenStack, dsInteractiveCard } from './shared/layout.js';
import { getHolidayLabel } from './shared/holidays.js';

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

function formatDateHe(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('he-IL');
}

function monthStartIso(ym) {
  return `${ym}-01`;
}

function monthEndIso(ym) {
  const [y, m] = ym.split('-').map(Number);
  const end = new Date(y, m, 0);
  return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
}

function getHolidaysInRange(fromYm, toYm) {
  const from = monthStartIso(fromYm);
  const to = monthEndIso(toYm);
  const days = [];
  const cursor = new Date(from);
  const last = new Date(to);
  while (cursor <= last) {
    const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
    const label = getHolidayLabel(iso);
    if (label) days.push({ date: iso, label });
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function buildNationalPrompt(payload) {
  const { currentMonth, today, totals, kpiCards, managers, holidays } = payload;
  const exceptions = Array.isArray(kpiCards) ? (kpiCards.find((k) => k.id === 'exceptions')?.value ?? 0) : 0;
  return `סיכום מצב ארצי לחודש ${hebrewMonthTitle(currentMonth)}.
היום: ${formatDateHe(today)}.

נתונים:
- תוכניות פעילות: ${totals?.total_long ?? 0}
- מדריכים פעילים: ${totals?.total_instructors ?? 0}
- חריגות: ${exceptions}
- סיומי קורסים החודש: ${totals?.total_course_endings_current_month ?? 0}

פירוט מחוזות:
${(Array.isArray(managers) ? managers : []).map((m) => `${m.activity_manager}: ${m.total_long} תוכניות, ${m.num_instructors} מדריכים, ${m.exceptions} חריגות`).join('\n')}

${holidays.length ? `אירועים בטווח החודשיים הקרובים:\n${holidays.map((h) => `${formatDateHe(h.date)}: ${h.label}`).join('\n')}` : ''}

כתוב סיכום קצר ומדויק למנהל הארצי.`;
}

function buildManagerPrompt(payload) {
  const { managerName, currentMonth, today, stats, holidays } = payload;
  return `סיכום מצב ${managerName} לחודש ${hebrewMonthTitle(currentMonth)}.
היום: ${formatDateHe(today)}.

נתונים:
- תוכניות פעילות: ${stats?.total_long ?? 0}
- מדריכים פעילים: ${stats?.num_instructors ?? 0}
- חריגות: ${stats?.exceptions ?? 0}
- סיומי קורסים החודש: ${stats?.course_endings ?? 0}

${holidays.length ? `אירועים בטווח החודשיים הקרובים:\n${holidays.map((h) => `${formatDateHe(h.date)}: ${h.label}`).join('\n')}` : ''}

כתוב סיכום קצר ומדויק למנהל.`;
}

async function fetchSummary(payload) {
  const runtimeConfig = (typeof globalThis !== 'undefined' && globalThis.__DASHBOARD_CONFIG__) || {};
  const apiKey = runtimeConfig.anthropicApiKey || runtimeConfig.claudeApiKey || '';
  const endpoint = runtimeConfig.anthropicUrl || 'https://api.anthropic.com/v1/messages';
  const systemPrompt = `אתה עוזר ניהולי של מערכת ניהול פעילויות חינוכיות ארצית בישראל.
תפקידך: לנתח נתונים ולהפיק סיכום תמציתי למנהל.

חוקים:
- כתוב עברית בלבד
- 3–5 משפטים קצרים בלבד. אין כותרות, אין bullets, אין bold
- ניסוח ישיר, עובדתי, ממוקד — לא שיווקי ולא מחמיא
- הדגש: מה בולט החודש הנוכחי, מה צפוי החודש הבא, אירועים שדורשים תשומת לב
- אם יש חגים בטווח — ציין אותם רק אם רלוונטיים לפעילות (סיומים, הפסקות)
- אם יש חריגות גבוהות — ציין בפשטות את המספר
- אל תמציא נתונים שלא נמסרו לך`;
  const userPrompt = payload.type === 'national'
    ? buildNationalPrompt(payload)
    : buildManagerPrompt(payload);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } : {})
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });
    if (!response.ok) return 'לא ניתן לייצר סיכום כרגע.';
    const data = await response.json();
    return data.content?.[0]?.text || 'לא ניתן לייצר סיכום כרגע.';
  } catch (_) {
    return 'לא ניתן לייצר סיכום כרגע.';
  }
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

    const MANAGER_DISPLAY_NAMES = {
      'גיל נאמן': 'מחוז צפון',
      'לינוי שמואל מזרחי': 'מחוז דרום',
    };

    const managerCards = managers
      .map((row) => {
        const mgr = encodeURIComponent(row.activity_manager);
        const summaryTarget = encodeURIComponent(row.activity_manager);
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
            <button type="button" class="ds-summary-btn" data-summary-target="${summaryTarget}" aria-label="סיכום AI">✨ סיכום</button>
          </div>
          <div class="ds-manager-stats">${statsHtml}</div>
          <div class="ds-summary-panel" data-summary-panel="${summaryTarget}" hidden>
            <div class="ds-summary-panel__content"></div>
            <div class="ds-summary-panel__footer">
              <button type="button" class="ds-summary-refresh" data-summary-refresh="${summaryTarget}">↺ רענן</button>
            </div>
          </div>
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
            <button type="button" class="ds-summary-btn" data-summary-target="national" aria-label="סיכום AI">✨ סיכום</button>
          </div>
          <div class="ds-summary-panel" data-summary-panel="national" hidden>
            <div class="ds-summary-panel__content"></div>
            <div class="ds-summary-panel__footer">
              <button type="button" class="ds-summary-refresh" data-summary-refresh="national">↺ רענן</button>
            </div>
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
    const summaryCache = new Map();
    const ym = data?.month || state.dashboardMonthYm || currentMonthYm();
    const nextYm = shiftYm(ym, 1);
    const todayIso = new Date().toISOString().slice(0, 10);
    const holidays = getHolidaysInRange(ym, nextYm);
    const managerRows = Array.isArray(data?.by_activity_manager) ? data.by_activity_manager : [];
    const nationalPayload = {
      type: 'national',
      currentMonth: ym,
      nextMonth: nextYm,
      today: todayIso,
      totals: data?.totals || {},
      kpiCards: data?.kpi_cards || [],
      managers: managerRows,
      holidays
    };

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

    function showLoading(target) {
      const panel = getSummaryPanel(target);
      const content = panel?.querySelector('.ds-summary-panel__content');
      if (!panel || !content) return;
      panel.hidden = false;
      content.innerHTML = '<span class="ds-summary-loading">מנתח נתונים…</span>';
      toggleSummaryButton(target, true);
    }

    function showSummary(target, text) {
      const panel = getSummaryPanel(target);
      const content = panel?.querySelector('.ds-summary-panel__content');
      const btn = getSummaryBtn(target);
      if (!panel || !content) return;
      panel.hidden = false;
      content.textContent = text || 'לא ניתן לייצר סיכום כרגע.';
      if (btn) btn.hidden = true;
      toggleSummaryButton(target, false);
    }

    async function handleSummaryClick(target, payload, forceRefresh = false) {
      if (forceRefresh) summaryCache.delete(target);
      if (summaryCache.has(target)) {
        showSummary(target, summaryCache.get(target));
        return;
      }
      showLoading(target);
      const text = await fetchSummary(payload);
      summaryCache.set(target, text);
      showSummary(target, text);
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
        const managerHit = managerRows.find((r) => String(r.activity_manager || '') === decodeURIComponent(target));
        const payload = target === 'national'
          ? nationalPayload
          : {
              type: 'manager',
              managerName: managerHit?.activity_manager || decodeURIComponent(target),
              currentMonth: ym,
              nextMonth: nextYm,
              today: todayIso,
              stats: {
                total_long: managerHit?.total_long ?? 0,
                num_instructors: managerHit?.num_instructors ?? 0,
                exceptions: managerHit?.exceptions ?? 0,
                course_endings: managerHit?.course_endings ?? 0
              },
              holidays
            };
        handleSummaryClick(target, payload).catch(() => {});
      });
    });

    root.querySelectorAll('.ds-summary-refresh[data-summary-refresh]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.summaryRefresh || '';
        const managerHit = managerRows.find((r) => String(r.activity_manager || '') === decodeURIComponent(target));
        const payload = target === 'national'
          ? nationalPayload
          : {
              type: 'manager',
              managerName: managerHit?.activity_manager || decodeURIComponent(target),
              currentMonth: ym,
              nextMonth: nextYm,
              today: todayIso,
              stats: {
                total_long: managerHit?.total_long ?? 0,
                num_instructors: managerHit?.num_instructors ?? 0,
                exceptions: managerHit?.exceptions ?? 0,
                course_endings: managerHit?.course_endings ?? 0
              },
              holidays
            };
        const openBtn = getSummaryBtn(target);
        if (openBtn) openBtn.hidden = false;
        handleSummaryClick(target, payload, true).catch(() => {});
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
