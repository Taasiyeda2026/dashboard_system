import { resetSupabaseAuthSessionWait } from './supabase-client.js';
import { permissionFlagYes } from './permissions.js';
import {
  ACTIVITY_SEASON_SUMMER_2026,
  GLOBAL_ACTIVITY_PERIOD_STORAGE_KEY,
  defaultMonthForGlobalActivityPeriod,
  isValidGlobalActivityPeriod,
  normalizeGlobalActivityPeriod
} from './screens/shared/summer-activity.js';

function defaultClientSettings() {
  return {
    system_name: 'Dashboard Taasiyeda',
    week_start_day: 0,
    show_shabbat: true,
    week_hide_saturday_column: false,
    show_only_nonzero_kpis: true,
    use_status_with_dates: true,
    hide_emp_id_on_screens: true,
    hide_activity_no_on_screens: true,
    hide_row_id_in_ui: true,
    hebrew_only_headers: true,
    all_data_fields_editable: true,
    constrained_fields_use_dropdown: true,
    compact_layout_preferred: true,
    narrow_boxes_preferred: true,
    prefer_emoji_over_wide_boxes: true,
    navigation: {
      disabled_routes: [],
      sidebar_hidden_routes: [],
      contextual_only_routes: []
    },
    dropdown_options: {}
  };
}

if (!sessionStorage.getItem('ds_session_alive')) {
  localStorage.removeItem('dashboard_token');
  localStorage.removeItem('dashboard_user');
}

function legacyCalendarMonthStorageKey(userId) {
  return userId ? `dashboard_calendar_month_ym:${userId}` : null;
}

function calendarMonthSessionKey(userId) {
  return userId ? `dashboard_calendar_month_ym_session:${userId}` : null;
}

function cleanupLegacyCalendarMonthLocalStorage(userId) {
  try {
    localStorage.removeItem('dashboard_calendar_month_ym');
    const specificKey = legacyCalendarMonthStorageKey(userId);
    if (specificKey) localStorage.removeItem(specificKey);
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith('dashboard_calendar_month_ym:')) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch {
    /* ignore */
  }
}

function normalizeBoolPermission(value) {
  return permissionFlagYes(value);
}

function normalizeStoredUserFlags(user) {
  if (!user || typeof user !== 'object') return user;
  return {
    ...user,
    can_add_activity: normalizeBoolPermission(user.can_add_activity),
    can_edit_direct: normalizeBoolPermission(user.can_edit_direct),
    can_request_edit: normalizeBoolPermission(user.can_request_edit),
    can_request_create_activity: normalizeBoolPermission(user.can_request_create_activity),
    can_review_requests: normalizeBoolPermission(user.can_review_requests),
    finance_access: normalizeBoolPermission(user.finance_access),
    can_access_personal_reports: normalizeBoolPermission(user.can_access_personal_reports),
    personal_reports_manager: normalizeBoolPermission(user.personal_reports_manager)
  };
}

const DEFAULT_GLOBAL_ACTIVITY_PERIOD = ACTIVITY_SEASON_SUMMER_2026;

const _initStoredUser = normalizeStoredUserFlags(JSON.parse(localStorage.getItem('dashboard_user') || 'null'));
const _initCalKey = calendarMonthSessionKey(_initStoredUser?.user_id);
const _initMonthYm = (_initCalKey && sessionStorage.getItem(_initCalKey)) || '';
const _storedGlobalActivityPeriod = (() => {
  try {
    const stored = localStorage.getItem(GLOBAL_ACTIVITY_PERIOD_STORAGE_KEY) || '';
    if (stored && !isValidGlobalActivityPeriod(stored)) {
      localStorage.removeItem(GLOBAL_ACTIVITY_PERIOD_STORAGE_KEY);
      return '';
    }
    return stored;
  } catch { return ''; }
})();
cleanupLegacyCalendarMonthLocalStorage(_initStoredUser?.user_id);

export const state = {
  token: localStorage.getItem('dashboard_token') || '',
  user: _initStoredUser,
  route: 'login',
  routes: [],
  effectiveRoutes: [],
  activityTab: 'all',
  activityPeriodTab: normalizeGlobalActivityPeriod(_storedGlobalActivityPeriod || DEFAULT_GLOBAL_ACTIVITY_PERIOD),
  activityFinanceStatus: '',
  activityQuickFamily: '',
  activityQuickManager: '',
  activityEndingCurrentMonth: false,
  /** פעילויות: סינון חריגות מכרטיסי לוח בקרה (missing_instructor | missing_start_date) */
  activitiesGapFilter: '',
  /** לוח בקרה: חודש מוצג בפורמט YYYY-MM; ריק = ייטען חודש נוכחי בכניסה */
  dashboardMonthYm: '',
  /** מסך שבוע: הזזה בשבועות מהשבוע הנוכחי (0 = שבוע נוכחי, -1 = קודם, +1 = הבא) */
  weekOffset: 0,
  /** מסך חודש: חודש מוצג בפורמט YYYY-MM; ריק = חודש נוכחי */
  monthYm: _initMonthYm,
  /** פעילויות: `table` | `compact` — נשמר בלוקאל סטורג' במסך הפעילויות */
  activityView: 'compact',
  financeFilter: '',
  /** הגדרות UI ממקור הנתונים (bootstrap / login) */
  clientSettings: defaultClientSettings(),
  /** @type {Record<string, { data: unknown, t: number }>} */
  screenDataCache: {},
  /** Sidebar badge for open approval requests (null = not loaded yet). */
  openEditRequestsCount: null,
  /** Sidebar badge for approved proposals awaiting send (null = not loaded yet). */
  pendingApprovedProposalsCount: null,
  /** True once Supabase Auth session is available on the shared client. */
  authSessionReady: false,
  /** False while bootstrap/profile permission sync is in flight after reload. */
  permissionsReady: false
};

function parseTokenPayloadClaims(token) {
  const value = String(token || '').trim();
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    let json = '';
    if (typeof atob === 'function' && typeof TextDecoder === 'function') {
      const binary = atob(padded);
      const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
      json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } else if (typeof atob === 'function') {
      json = decodeURIComponent(escape(atob(padded)));
    } else if (typeof globalThis !== 'undefined' && globalThis.Buffer) {
      json = globalThis.Buffer.from(padded, 'base64').toString('utf8');
    } else {
      return null;
    }
    const payload = JSON.parse(json);
    if (!payload || typeof payload !== 'object') return null;
    return {
      user_id: String(payload.uid || '').trim(),
      display_role: String(payload.role || '').trim(),
      org_id: String(payload.org_id || '').trim(),
      emp_id: String(payload.emp_id || payload.uid || '').trim(),
      can_add_activity: !!payload.can_add_activity,
      full_name: String(payload.name || '').trim(),
      display_role2: String(payload.role2 || '').trim()
    };
  } catch {
    return null;
  }
}

export function clearScreenDataCache() {
  state.screenDataCache = {};
}

export function setSession(session) {
  if (!session) {
    state.token = '';
    state.user = null;
    state.routes = [];
    state.effectiveRoutes = [];
    state.route = 'login';
    state.activityTab = 'all';
    setGlobalActivityPeriod(DEFAULT_GLOBAL_ACTIVITY_PERIOD, { persist: false });
    state.activityFinanceStatus = '';
    state.activityQuickFamily = '';
    state.activityQuickManager = '';
    state.activityEndingCurrentMonth = false;
    state.activitiesGapFilter = '';
    state.dashboardMonthYm = '';
    state.weekOffset = 0;
    state.monthYm = '';
    state.clientSettings = defaultClientSettings();
    state.screenDataCache = {};
    state.openEditRequestsCount = null;
    state.pendingApprovedProposalsCount = null;
    state.authSessionReady = false;
    state.permissionsReady = false;
    resetSupabaseAuthSessionWait();
    localStorage.removeItem('dashboard_token');
    localStorage.removeItem('dashboard_user');
    cleanupLegacyCalendarMonthLocalStorage(state.user?.user_id);
    try {
      Object.keys(sessionStorage)
        .filter((key) => key === 'dashboard_calendar_month_ym_session' || key.startsWith('dashboard_calendar_month_ym_session:'))
        .forEach((key) => sessionStorage.removeItem(key));
    } catch { /* ignore */ }
    sessionStorage.removeItem('ds_session_alive');
    return;
  }
  state.token = session.token;
  const claims = parseTokenPayloadClaims(session.token);
  state.user = {
    ...(claims || {}),
    ...(session.user || {}),
    user_id: String((session.user && session.user.user_id) || (claims && claims.user_id) || '').trim(),
    role: String((session.user && session.user.role) || '').trim(),
    display_role: String((session.user && session.user.display_role) || (claims && claims.display_role) || '').trim(),
    display_role_label: String((session.user && session.user.display_role_label) || '').trim(),
    emp_id: String((session.user && session.user.emp_id) || (claims && claims.emp_id) || '').trim(),
    full_name: String((session.user && session.user.full_name) || (claims && claims.full_name) || '').trim(),
    display_role2: String((session.user && session.user.display_role2) || (claims && claims.display_role2) || '').trim(),
    can_add_activity: (session.user && session.user.can_add_activity) ?? (claims && claims.can_add_activity),
    can_edit_direct: session.user && session.user.can_edit_direct,
    can_request_edit: session.user && session.user.can_request_edit,
    can_request_create_activity: session.user && session.user.can_request_create_activity
  };
  state.user.can_add_activity = normalizeBoolPermission(state.user.can_add_activity);
  state.user.can_edit_direct = normalizeBoolPermission(state.user.can_edit_direct);
  state.user.can_request_edit = normalizeBoolPermission(state.user.can_request_edit);
  state.user.can_request_create_activity = normalizeBoolPermission(state.user.can_request_create_activity);
  state.user.can_review_requests = normalizeBoolPermission(state.user.can_review_requests);
  state.user.finance_access = normalizeBoolPermission(state.user.finance_access);
  state.user.can_access_personal_reports = normalizeBoolPermission(state.user.can_access_personal_reports);
  state.user.personal_reports_manager = normalizeBoolPermission(state.user.personal_reports_manager);
  const newCalKey = calendarMonthSessionKey(state.user.user_id);
  state.monthYm = (newCalKey && sessionStorage.getItem(newCalKey)) || '';
  cleanupLegacyCalendarMonthLocalStorage(state.user.user_id);
  state.screenDataCache = {};
  state.openEditRequestsCount = null;
  state.pendingApprovedProposalsCount = null;
  localStorage.setItem('dashboard_token', session.token);
  localStorage.setItem('dashboard_user', JSON.stringify(state.user));
  sessionStorage.setItem('ds_session_alive', '1');
}

export function setGlobalActivityPeriod(value, { persist = true } = {}) {
  const nextPeriod = normalizeGlobalActivityPeriod(value || DEFAULT_GLOBAL_ACTIVITY_PERIOD);
  state.activityPeriodTab = nextPeriod;
  const periodMonth = defaultMonthForGlobalActivityPeriod(nextPeriod);
  state.dashboardMonthYm = periodMonth;
  state.activitiesMonthYm = periodMonth;
  if (state.operationsManagement) {
    state.operationsManagement.period = nextPeriod;
    const from = nextPeriod === ACTIVITY_SEASON_SUMMER_2026 ? '2026-07-01' : nextPeriod === 'school_2027' ? '2026-09-01' : '';
    const to = nextPeriod === ACTIVITY_SEASON_SUMMER_2026 ? '2026-08-31' : nextPeriod === 'school_2027' ? '2027-08-31' : '';
    state.operationsManagement.dateFrom = from;
    state.operationsManagement.dateTo = to;
  }
  if (persist) {
    try { localStorage.setItem(GLOBAL_ACTIVITY_PERIOD_STORAGE_KEY, nextPeriod); } catch { /* ignore */ }
  }
  return nextPeriod;
}

export { defaultClientSettings, calendarMonthSessionKey, cleanupLegacyCalendarMonthLocalStorage };
