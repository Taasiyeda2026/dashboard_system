import { escapeHtml } from './shared/html.js';
import { dsCard, dsScreenStack } from './shared/layout.js';
import { computeOperationalExceptionsTotal } from './shared/exceptions-metrics.js';
import { syncActivitiesGapQuery } from './shared/route-query.js';

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

const KPI_ICON_MAP = {
  'kpi|short':              '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  'kpi|long':               '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
  'kpi|exceptions':         '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  'kpi|instructors':        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>',
  'kpi|endings':            '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>',
  'kpi|missing_instructor': '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="23" y2="12"/><line x1="23" y1="8" x2="19" y2="12"/></svg>',
  'kpi|missing_start_date': '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="12" y1="14" x2="12" y2="18"/></svg>',
  'kpi|active_courses':     '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>',
  'kpi|active_workshops':   '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 010 14.14M4.93 4.93a10 10 0 000 14.14"/></svg>',
  'kpi|active_tours':       '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>',
  'kpi|active_after_school':'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>'
};

const INSTRUCTORS_KPI_TOOLTIP = 'שימו לב: מדריכים הפעילים ביותר ממחוז אחד נספרים בכל מחוז בנפרד, אך בסה״כ הכללי נספרים פעם אחת בלבד';

function renderKpiCard(k) {
  const icon = KPI_ICON_MAP[k.action] || '';
  const alertClass = (k.id === 'exceptions' && Number(k.value || 0) > 0) ? ' ds-kpi--exceptions-alert' : '';
  const title = escapeHtml(k.subtitle || k.title || '');
  const value = escapeHtml(k.value != null ? String(k.value) : String(k.title || ''));
  const cardBtn = `<button type="button" class="ds-interactive-card ds-interactive-card--kpi${alertClass}" data-card-action="${escapeHtml(k.action)}">${icon ? `<span class="ds-kpi-icon" aria-hidden="true">${icon}</span>` : ''}<p class="ds-interactive-card__label">${title}</p><p class="ds-interactive-card__value">${value}</p></button>`;
  if (k.action === 'kpi|instructors') {
    const infoIcon = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
    return `<div class="ds-kpi-info-wrap">${cardBtn}<button type="button" class="ds-kpi-info-btn" data-kpi-info-toggle aria-label="מידע על ספירת מדריכים">${infoIcon}<span class="ds-kpi-info-tooltip" role="tooltip">${escapeHtml(INSTRUCTORS_KPI_TOOLTIP)}</span></button></div>`;
  }
  return cardBtn;
}

const ACTIVITY_TYPE_ORDER = [
  { key: 'course',       label: 'קורסים' },
  { key: 'after_school', label: 'אפטרסקול' },
  { key: 'tour',         label: 'סיורים' },
  { key: 'workshop',     label: 'סדנאות' },
  { key: 'escape_room',  label: 'חדרי בריחה' }
];

function renderStructuredSummary(summary, ym, byManager) {
  const monthTitle     = hebrewMonthTitle(ym);

  const endingCurrentField = getStrictNumericField(summary, 'ending_courses_current_month');
  const counts = summary?.counts && typeof summary.counts === 'object' ? summary.counts : {};
  const missingInstructorCount = pickNumericFallback(counts, 'missing_instructor', summary?.missing_instructor_count);
  const missingStartDateCount = pickNumericFallback(counts, 'missing_start_date', summary?.missing_start_date_count ?? summary?.missing_date_count);
  const endDateAfterCutoffCount = pickNumericFallback(counts, 'end_date_after_cutoff', summary?.end_date_after_cutoff_count);
  const endDatePassedCount = pickNumericFallback(counts, 'end_date_passed', summary?.end_date_passed_count);
  const exceptionsTotalField = getStrictNumericField(summary, 'totalExceptionInstances');
  const exceptionsTotalFallback = getStrictNumericField(summary, 'exceptions_count');
  const exceptionsTotalResolved = exceptionsTotalField.ok
    ? exceptionsTotalField.value
    : (exceptionsTotalFallback.ok ? exceptionsTotalFallback.value : 0);

  const endingCurrent = escapeHtml(String(endingCurrentField.ok ? endingCurrentField.value : 0));
  const operationalUniqueField = getStrictNumericField(summary, 'operational_gaps_unique_count');
  const operationalUniqueCount = operationalUniqueField.ok ? operationalUniqueField.value : 0;
  const missingInstructor = missingInstructorCount;
  const missingStartDate  = missingStartDateCount;
  const endDateAfterCutoff = escapeHtml(String(endDateAfterCutoffCount));
  const endDatePassed = escapeHtml(String(endDatePassedCount));

  const typeCounts = summary?.active_type_counts || {};
  const typeRows = ACTIVITY_TYPE_ORDER
    .map(({ key, label }) => {
      const count = Number(typeCounts[key] || 0);
      if (count === 0) return '';
      return `<p class="ds-summary-panel__text">
        <span class="ds-summary-panel__type-label">${escapeHtml(label)}:</span>
        <strong>${count}</strong>
      </p>`;
    })
    .join('');

  const districtRows = (Array.isArray(byManager) ? byManager : []).filter(
    (row) => row.activity_manager && row.activity_manager !== 'activity_manager' && row.activity_manager !== 'unassigned' && row.activity_manager !== 'ללא' && row.activity_manager !== 'ללא מנהל'
  );
  const districtByName = districtRows.reduce((acc, row) => {
    const label = row.activity_manager;
    acc[label] = row;
    return acc;
  }, {});
  const northRow = districtByName['מחוז צפון'] || {};
  const southRow = districtByName['מחוז דרום'] || {};
  const northActive = escapeHtml(String(northRow.total_activities ?? northRow.total_long ?? 0));
  const southActive = escapeHtml(String(southRow.total_activities ?? southRow.total_long ?? 0));

  const allInstructors = normalizeNames(Array.isArray(summary?.active_instructors) ? summary.active_instructors : []);

  return `<div class="ds-summary-panel__structured">
    <h3 class="ds-summary-panel__title">סיכום חודשי – <strong>${escapeHtml(monthTitle)}</strong></h3>

    <h4 class="ds-summary-panel__inner-title"><strong>פעילויות פעילות החודש:</strong></h4>
    ${typeRows || '<p class="ds-summary-panel__text ds-muted">אין פעילויות פעילות</p>'}
    <p class="ds-summary-panel__text">מחוז צפון: <strong>${northActive}</strong> פעילויות · מחוז דרום: <strong>${southActive}</strong> פעילויות</p>
    <p class="ds-summary-panel__text">סיומי קורסים החודש: <strong>${endingCurrent}</strong></p>

    <h4 class="ds-summary-panel__inner-title"><strong>המדריכים הפעילים החודש:</strong></h4>
    <p class="ds-summary-panel__text">${escapeHtml(allInstructors || '—')}</p>

    <div class="ds-summary-panel__block ds-summary-panel__block--exceptions">
      <h4 class="ds-summary-panel__inner-title"><strong>חריגות החודש:</strong></h4>
      <p class="ds-summary-panel__text"><strong>סה״כ חריגות: ${escapeHtml(String(exceptionsTotalResolved))}</strong></p>
      <p class="ds-summary-panel__text">
        חריגות תפעוליות: <strong>${escapeHtml(String(operationalUniqueCount))}</strong>
        <span class="ds-muted"> (ללא מדריך: ${escapeHtml(String(missingInstructor))} · ללא תאריך התחלה: ${escapeHtml(String(missingStartDate))})</span>
      </p>
      <p class="ds-summary-panel__text">תאריך סיום מאוחר: <strong>${endDateAfterCutoff}</strong></p>
      <p class="ds-summary-panel__text">הסתיימה ולא נסגרה: <strong>${endDatePassed}</strong></p>
    </div>
  </div>`;
}

function goActivitiesDrill(state, patch) {
  state.route = 'activities';
  state.activityTab = patch.activityTab ?? 'all';
  state.activityFinanceStatus = patch.activityFinanceStatus ?? '';
  state.activityQuickFamily = patch.activityQuickFamily ?? '';
  state.activityQuickManager = patch.activityQuickManager ?? '';
  state.activityEndingCurrentMonth = !!patch.activityEndingCurrentMonth;
  state.activitiesMonthYm = state.dashboardMonthYm || currentMonthYm();
  if (Object.prototype.hasOwnProperty.call(patch, 'activitiesGapFilter')) {
    state.activitiesGapFilter = patch.activitiesGapFilter || '';
    syncActivitiesGapQuery(state.activitiesGapFilter);
  }
}

const ALLOWED_KPI_ACTIONS = new Set([
  'kpi|long',
  'kpi|short',
  'kpi|active_courses',
  'kpi|active_workshops',
  'kpi|active_tours',
  'kpi|active_after_school',
  'kpi|active_escape_room',
  'kpi|exceptions',
  'kpi|instructors',
  'kpi|endings',
  'kpi|missing_instructor',
  'kpi|missing_start_date'
]);

function filterKpiCards(cards, showOnlyNonzero) {
  const list = Array.isArray(cards) ? cards : [];
  const allowed = list.filter((c) => c && c.action && ALLOWED_KPI_ACTIONS.has(c.action));
  if (!showOnlyNonzero) return allowed;
  return allowed.filter((c) => c.id === 'exceptions' || Number(c.value || 0) > 0);
}

function dashboardSourceError(data) {
  return data?.error || data?._debug?.error || '';
}

function dashboardTotalsAllZero(totals = {}) {
  const values = [
    totals.total_short_activities,
    totals.total_long_activities,
    totals.total_instructors,
    totals.total_course_endings_current_month,
    totals.exceptions_count,
    totals.short,
    totals.long
  ].filter((v) => v !== undefined && v !== null && v !== '');
  return values.length > 0 && values.every((v) => Number(v || 0) === 0);
}

function dashboardErrorHtml(data, ym) {
  const errorText = dashboardSourceError(data) || 'dashboard_source_failed';
  return dsScreenStack(`
    <div class="ds-dashboard-wrap">
      <header class="ds-dash-header" dir="rtl">
        <h1 class="ds-dash-header__title">לוח בקרה</h1>
        <div class="ds-dash-month-nav" dir="rtl" aria-label="בחירת חודש לתצוגה">
          <span class="ds-dash-month-nav__label">${escapeHtml(hebrewMonthTitle(ym))}</span>
        </div>
      </header>
      ${dsCard({
        title: 'לא ניתן לטעון את נתוני לוח הבקרה',
        body: `<p class="ds-empty__msg">מקור הנתונים נכשל ולכן לא מוצגים כרטיסי KPI עם ערכי 0 שאינם מאומתים.</p><p class="ds-muted" dir="ltr">${escapeHtml(errorText)}</p>`,
        padded: true
      })}
    </div>
  `);
}

// ─────────────────────────────────────────────────────────────────────────────



const DASHBOARD_LOAD_GUARD_MS = 22000;
const DASHBOARD_LOAD_ERROR_HE = 'לא ניתן לטעון את לוח הבקרה כרגע. נסו לרענן או בדקו את חיבור השרת.';
const DASHBOARD_INFO_TEXT = 'לוח הבקרה מציג את פעילויות החודש הנוכחי. החלוקה לפי מחוזות מתייחסת רק לפעילויות שעדיין לא הסתיימו, כדי להציג תמונת מצב תפעולית עדכנית.';

/** Snapshot / read-model status line above dashboard body (controlled copy). */
function buildDashboardStaleBanner(data) {
  if (!data || typeof data !== 'object') return '';
  if (data._snapshot_unavailable === true) {
    return '<div class="ds-muted" style="margin-bottom:var(--ds-space-2)">הנתונים בהכנה — ייתכן שחלק מהמידע חסר. רעננו את הדף לאחר מספר דקות לקבלת תצוגה מלאה.</div>';
  }
  if (data._read_model_stale === true || data._is_stale === true) {
    return '<div class="ds-muted" style="margin-bottom:var(--ds-space-2)">נתוני לוח הבקרה מתעדכנים כעת — מוצגים נתוני מטמון אחרונים עד לסיום העדכון.</div>';
  }
  return '';
}

const LS_DASHBOARD_MONTH_KEY = 'dashboard_month_ym';

function loadDashboardMonthFromStorage() {
  try {
    const stored = localStorage.getItem(LS_DASHBOARD_MONTH_KEY);
    if (stored && /^\d{4}-\d{2}$/.test(stored)) {
      const now = currentMonthYm();
      return stored > now ? now : stored;
    }
  } catch { /* ignore */ }
  return null;
}

function saveDashboardMonthToStorage(ym) {
  try {
    localStorage.setItem(LS_DASHBOARD_MONTH_KEY, ym);
  } catch { /* ignore */ }
}

export const dashboardScreen = {
  async load({ api, state }) {
    let ym = state.dashboardMonthYm;
    if (!ym || !/^\d{4}-\d{2}$/.test(ym)) {
      ym = loadDashboardMonthFromStorage() || currentMonthYm();
    }
    const now = currentMonthYm();
    if (ym > now) {
      ym = now;
      saveDashboardMonthToStorage(ym);
    }
    state.dashboardMonthYm = ym;

    const loadStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let guardTimer = null;

    const guardPromise = new Promise((_, reject) => {
      guardTimer = setTimeout(
        () => reject(new Error('dashboard_load_timeout')),
        DASHBOARD_LOAD_GUARD_MS
      );
    });

    try {
      const data = await Promise.race([
        api.dashboardSnapshot({ month: ym }),
        guardPromise
      ]);
      clearTimeout(guardTimer);
      const durationMs = Math.round(
        (typeof performance !== 'undefined' ? performance.now() : Date.now()) - loadStart
      );
      // eslint-disable-next-line no-console
      console.info('[dashboard-load]', {
        action: 'dashboardSnapshot',
        duration_ms: durationMs,
        is_snapshot: data?._is_snapshot !== false,
        is_stale: data?._is_stale === true,
        snapshot_fallback_reason: data?._snapshot_fallback_reason || null,
        month: ym
      });
      return data;
    } catch (err) {
      clearTimeout(guardTimer);
      const durationMs = Math.round(
        (typeof performance !== 'undefined' ? performance.now() : Date.now()) - loadStart
      );
      const isTimeout =
        String(err?.message || '').includes('dashboard_load_timeout') ||
        String(err?.message || '').includes('timeout');
      // eslint-disable-next-line no-console
      console.warn('[dashboard-load] failed', {
        action: 'dashboardSnapshot',
        duration_ms: durationMs,
        is_timeout: isTimeout,
        error: err?.message || String(err),
        month: ym
      });
      throw new Error(DASHBOARD_LOAD_ERROR_HE);
    }
  },
  render(data, { state } = {}) {
    const ym = data?.month || currentMonthYm();
    const sourceError = dashboardSourceError(data);
    if (sourceError) {
      console.warn('[dashboard] source error; KPI cards suppressed', { month: ym, error: sourceError });
      if (dashboardTotalsAllZero(data?.totals || {})) {
        console.warn('[dashboard] totals are all zero while source error exists', { month: ym, error: sourceError });
      }
      return dashboardErrorHtml(data, ym);
    }

    const _seenMgr = new Set();
    const managers = (Array.isArray(data.by_activity_manager) ? data.by_activity_manager : []).filter(
      (row) => {
        if (!row.activity_manager || row.activity_manager === 'activity_manager' || row.activity_manager === 'unassigned' || row.activity_manager === 'ללא' || row.activity_manager === 'ללא מנהל') return false;
        if (_seenMgr.has(row.activity_manager)) return false;
        _seenMgr.add(row.activity_manager);
        return true;
      }
    );
    const showOnly = !!data?.show_only_nonzero_kpis;
    let _kpiSource = data?.kpi_cards;
    if (!Array.isArray(_kpiSource) || _kpiSource.filter(c => c && ALLOWED_KPI_ACTIONS.has(c.action)).length === 0) {
      console.warn('[dashboard] KPI cards empty', { month: ym, has_totals: !!data?.totals, has_summary: !!data?.summary });
      _kpiSource = [];
    }
    const kpiCards = filterKpiCards(_kpiSource, showOnly).map((card) => {
      if (card?.action !== 'kpi|exceptions') return card;
      const totalExceptions =
        data?.summary?.totalExceptionInstances ??
        data?.summary?.exceptions_count ??
        data?.totals?.exceptions_count ??
        0;
      return { ...card, value: Number(totalExceptions) };
    });
    if (kpiCards.length === 0) {
      console.warn('[dashboard] KPI cards empty after filtering', { month: ym, show_only_nonzero_kpis: showOnly });
    }

    const managerCards = managers
      .map((row) => {
        const mgr = encodeURIComponent(row.activity_manager);
        const displayName = row.activity_manager;
        const isDistrict = true;
        const exceptionsValue = Number(row.exceptions ?? 0);
        const allStats = [
          { label: 'פעילויות פעילות', value: row.total_activities ?? row.total_long ?? 0, action: `mstat|${mgr}|activities` },
          { label: 'מדריכים פעילים',  value: row.num_instructors ?? 0, action: `mstat|${mgr}|instructors` },
          { label: 'סה"כ חריגות',       value: exceptionsValue, action: `mstat|${mgr}|exceptions` },
          { label: 'סיומי קורסים',    value: row.course_endings  ?? 0, action: `mstat|${mgr}|endings` },
        ];
        const stats = allStats;
        const statsHtml = stats
          .map((s) => {
            const displayValue = s.value;
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

    const emptyDashboardMessage = data?.no_data_message || 'אין נתונים להצגה';
    const managersBlock = managers.length
      ? `<div class="ds-manager-grid">${managerCards}</div>`
      : `<div class="ds-empty"><p class="ds-empty__msg">${escapeHtml(emptyDashboardMessage)}</p></div>`;

    const typeKpiCards  = kpiCards.filter((c) => String(c.action || '').startsWith('kpi|active_'));
    const statKpiCards  = kpiCards.filter((c) => !String(c.action || '').startsWith('kpi|active_'));
    const kpiHtml = kpiCards.length
      ? `<div class="ds-kpi-grid ds-dashboard-kpi-grid">${typeKpiCards.map(renderKpiCard).join('')}</div>
         <div class="ds-kpi-grid ds-dashboard-kpi-grid ds-dashboard-kpi-grid--row2">${statKpiCards.map(renderKpiCard).join('')}</div>`
      : '<p class="ds-muted">אין כרטיסי KPI להצגה.</p>';

    const navLoading = !!state?.dashboardNavLoading;
    const staleBanner = buildDashboardStaleBanner(data);
    const infoIcon = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
    const dashHeader = `<header class="ds-dash-header" dir="rtl">
      <div class="ds-dash-header__title-row">
        <h1 class="ds-dash-header__title">לוח בקרה</h1>
        <button type="button" class="ds-dash-info-btn" aria-label="מה מוצג כאן?">${infoIcon}<span class="ds-dash-info-tooltip" role="tooltip">${escapeHtml(DASHBOARD_INFO_TEXT)}</span></button>
      </div>
      <div class="ds-dash-month-nav${navLoading ? ' is-nav-loading' : ''}" dir="rtl" aria-label="בחירת חודש לתצוגה">
        <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-dash-month-prev aria-label="חודש קודם" title="חודש קודם" ${navLoading ? 'disabled' : ''}>▶</button>
        <span class="ds-dash-month-nav__label">${escapeHtml(hebrewMonthTitle(ym))}${navLoading ? ' <span class="ds-inline-loading-dot is-inline-loading" aria-hidden="true"></span>' : ''}</span>
        <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-dash-month-next aria-label="חודש הבא" title="חודש הבא" ${navLoading ? 'disabled' : ''}>◀</button>
      </div>
    </header>`;

    return dsScreenStack(`
      <div class="ds-dashboard-wrap">
        ${dashHeader}
        ${staleBanner}
        <div data-dash-data-area>
          <div class="ds-dashboard-summary-row">
            <button type="button" class="ds-summary-btn ds-dashboard-summary-title" data-summary-target="national" aria-expanded="false">סיכום</button>
          </div>
          <div class="ds-summary-panel" data-summary-panel="national" hidden>
            <div class="ds-summary-panel__content"></div>
          </div>
          <div class="ds-dashboard-kpi-rows">${kpiHtml}</div>
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

    function resetExceptionsFilters(district = '') {
      state.listFilters = state.listFilters || {};
      const prev = state.listFilters.exceptions || {};
      state.listFilters.exceptions = {
        ...prev,
        q: '',
        district,
        activity_manager: '',
        exception_type: '',
        visibleCount: 200
      };
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
          btn.setAttribute('aria-expanded', 'false');
        }
      } else {
        panel.hidden = false;
        content.innerHTML = htmlText;
        if (btn) {
          btn.textContent = 'סגור ✕';
          btn.classList.add('is-active');
          btn.setAttribute('aria-expanded', 'true');
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

    const applyYm = async (nextYm) => {
      if (state.dashboardNavLoading) return;
      state.dashboardNavLoading = true;
      state.dashboardMonthYm = nextYm;
      saveDashboardMonthToStorage(nextYm);
      const cacheKey = `dashboard:${/^\d{4}-\d{2}$/.test(nextYm) ? nextYm : 'default'}`;
      try {
        const cached = state.screenDataCache[cacheKey];
        if (cached?.data && Date.now() - cached.t < DASHBOARD_TTL_MS) {
          return;
        }
        showDataAreaLoading();
        try {
          const snapshotData = await api.dashboardSnapshot({ month: nextYm });
          putDashboardCache(cacheKey, snapshotData);
        } catch (err) {
          // Keep currently rendered dashboard content when refresh fails, but never leave the loading state active.
          console.warn('[dashboard-refresh:failed]', { month: nextYm, error: err?.message || String(err) });
        }
      } finally {
        state.dashboardNavLoading = false;
        if (state.route === 'dashboard') rerender();
      }
    };

    root.querySelector('[data-dash-month-prev]')?.addEventListener('click', () => {
      applyYm(shiftYm(state.dashboardMonthYm || currentMonthYm(), -1));
    });
    root.querySelector('[data-dash-month-next]')?.addEventListener('click', () => {
      applyYm(shiftYm(state.dashboardMonthYm || currentMonthYm(), 1));
    });

    root.querySelector('.ds-summary-btn[data-summary-target]')?.addEventListener('click', (e) => {
      const target = e.currentTarget.dataset.summaryTarget || '';
      if (target) handleSummaryClick(target);
    });

    root.querySelectorAll('[data-kpi-info-toggle]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        btn.classList.toggle('is-open');
      });
    });
    root.addEventListener('click', (e) => {
      if (!e.target.closest('[data-kpi-info-toggle]')) {
        root.querySelectorAll('.ds-kpi-info-btn.is-open').forEach((b) => b.classList.remove('is-open'));
      }
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
      if (action === 'kpi|active_courses' || action === 'kpi|active_workshops' || action === 'kpi|active_tours' || action === 'kpi|active_after_school' || action === 'kpi|active_escape_room') {
        goActivitiesDrill(state, { activityQuickFamily: 'long' });
        const quickTypeMap = {
          'kpi|active_courses': 'course',
          'kpi|active_workshops': 'workshop',
          'kpi|active_tours': 'tour',
          'kpi|active_after_school': 'after_school',
          'kpi|active_escape_room': 'escape_room'
        };
        state.listFilters = state.listFilters || {};
        const prev = state.listFilters.activities || {};
        state.listFilters.activities = {
          ...prev,
          activity_type: quickTypeMap[action] || '',
          visibleCount: 200
        };
        ui.closeAll();
        rerender();
        return;
      }
      if (action === 'kpi|instructors') {
        state.route = 'instructors';
        state.instructorsActiveOnly = true;
        ui.closeAll();
        rerender();
        return;
      }
      if (action === 'kpi|endings') {
        state.route = 'end-dates';
        state.endDatesMonthYm = state.dashboardMonthYm || currentMonthYm();
        ui.closeAll();
        rerender();
        return;
      }
      if (action === 'kpi|missing_instructor' || action === 'kpi|missing_start_date') {
        const gapFilter = action === 'kpi|missing_instructor' ? 'missing_instructor' : 'missing_start_date';
        goActivitiesDrill(state, {
          activityQuickFamily: 'long',
          activitiesGapFilter: gapFilter
        });
        ui.closeAll();
        rerender();
        return;
      }
      if (action === 'kpi|exceptions') {
        state.route = 'exceptions';
        state.exceptionsMonthYm = state.dashboardMonthYm || currentMonthYm();
        resetExceptionsFilters('');
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
          state.instructorsActiveOnly = true;
        } else if (kind === 'activities') {
          goActivitiesDrill(state, { activityQuickManager: name });
        } else if (kind === 'long') {
          goActivitiesDrill(state, { activityQuickManager: name, activityQuickFamily: 'long' });
        } else if (kind === 'endings') {
          goActivitiesDrill(state, { activityQuickManager: name, activityEndingCurrentMonth: true });
        } else if (kind === 'exceptions') {
          state.route = 'exceptions';
          state.exceptionsMonthYm = state.dashboardMonthYm || currentMonthYm();
          resetExceptionsFilters(name);
        }
        ui.closeAll();
        rerender();
        return;
      }
    });
  }
};
