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

export const state = {
  token: localStorage.getItem('dashboard_token') || '',
  user: JSON.parse(localStorage.getItem('dashboard_user') || 'null'),
  route: 'login',
  routes: [],
  effectiveRoutes: [],
  activityTab: 'all',
  activityFinanceStatus: '',
  activityQuickFamily: '',
  activityQuickManager: '',
  activityEndingCurrentMonth: false,
  /** לוח בקרה: חודש מוצג בפורמט YYYY-MM; ריק = ייטען חודש נוכחי בכניסה */
  dashboardMonthYm: '',
  /** מסך שבוע: הזזה בשבועות מהשבוע הנוכחי (0 = שבוע נוכחי, -1 = קודם, +1 = הבא) */
  weekOffset: 0,
  /** מסך חודש: חודש מוצג בפורמט YYYY-MM; ריק = חודש נוכחי */
  monthYm: localStorage.getItem('dashboard_calendar_month_ym') || '',
  /** פעילויות: `table` | `compact` — נשמר בלוקאל סטורג' במסך הפעילויות */
  activityView: 'compact',
  financeFilter: '',
  /** הגדרות UI ממקור הנתונים (bootstrap / login) */
  clientSettings: defaultClientSettings(),
  /** @type {Record<string, { data: unknown, t: number }>} */
  screenDataCache: {}
};

function parseTokenPayloadClaims(token) {
  const value = String(token || '').trim();
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    let json = '';
    if (typeof atob === 'function') {
      json = atob(padded);
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
    state.activityFinanceStatus = '';
    state.activityQuickFamily = '';
    state.activityQuickManager = '';
    state.activityEndingCurrentMonth = false;
    state.dashboardMonthYm = '';
    state.weekOffset = 0;
    state.monthYm = '';
    state.clientSettings = defaultClientSettings();
    state.screenDataCache = {};
    localStorage.removeItem('dashboard_token');
    localStorage.removeItem('dashboard_user');
    localStorage.removeItem('dashboard_calendar_month_ym');
    sessionStorage.removeItem('ds_session_alive');
    return;
  }
  state.token = session.token;
  const claims = parseTokenPayloadClaims(session.token);
  state.user = {
    ...(session.user || {}),
    ...(claims || {}),
    user_id: String((session.user && session.user.user_id) || (claims && claims.user_id) || '').trim(),
    display_role: String((session.user && session.user.display_role) || (claims && claims.display_role) || '').trim(),
    emp_id: String((session.user && session.user.emp_id) || (claims && claims.emp_id) || '').trim()
  };
  state.screenDataCache = {};
  localStorage.setItem('dashboard_token', session.token);
  localStorage.setItem('dashboard_user', JSON.stringify(state.user));
  sessionStorage.setItem('ds_session_alive', '1');
}

export { defaultClientSettings };
