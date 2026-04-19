export const state = {
  token: localStorage.getItem('dashboard_token') || '',
  user: JSON.parse(localStorage.getItem('dashboard_user') || 'null'),
  route: 'login',
  routes: [],
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
  monthYm: '',
  activityView: 'compact',
  financeFilter: '',
  /** הגדרות UI ממקור הנתונים (bootstrap / login) */
  clientSettings: {},
  /** @type {Record<string, { data: unknown, t: number }>} */
  screenDataCache: {}
};

export function clearScreenDataCache() {
  state.screenDataCache = {};
}

export function setSession(session) {
  if (!session) {
    state.token = '';
    state.user = null;
    state.routes = [];
    state.route = 'login';
    state.activityTab = 'all';
    state.activityFinanceStatus = '';
    state.activityQuickFamily = '';
    state.activityQuickManager = '';
    state.activityEndingCurrentMonth = false;
    state.dashboardMonthYm = '';
    state.weekOffset = 0;
    state.monthYm = '';
    state.clientSettings = {};
    state.screenDataCache = {};
    localStorage.removeItem('dashboard_token');
    localStorage.removeItem('dashboard_user');
    return;
  }
  state.token = session.token;
  state.user = session.user;
  state.screenDataCache = {};
  localStorage.setItem('dashboard_token', session.token);
  localStorage.setItem('dashboard_user', JSON.stringify(session.user));
}
