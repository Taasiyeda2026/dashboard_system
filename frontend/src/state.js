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
  /** מסך שבוע: היסט/קדימה בשבועות */
  weekOffset: 0,
  /** מסך חודש: חודש מוצג בפורמט YYYY-MM */
  monthYm: '',
  /** לוח בקרה: חודש מוצג בפורמט YYYY-MM; ריק = חודש נוכחי */
  dashboardMonthYm: '',
  activityView: 'compact',
  financeFilter: '',
  /** הגדרות UI ממקור הנתונים (bootstrap / login) */
  clientSettings: {},
  /** @type {Record<string, { data: unknown, t: number }>} */
  screenDataCache: {}
};

export function clearScreenDataCache(targets) {
  if (!targets) {
    state.screenDataCache = {};
    return;
  }
  const list = Array.isArray(targets) ? targets : [targets];
  if (!list.length) return;

  Object.keys(state.screenDataCache).forEach((key) => {
    const shouldDelete = list.some((target) => {
      const t = String(target || '');
      if (!t) return false;
      if (t.endsWith(':')) return key.startsWith(t);
      return key === t || key.startsWith(`${t}:`);
    });
    if (shouldDelete) delete state.screenDataCache[key];
  });
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
    state.weekOffset = 0;
    state.monthYm = '';
    state.dashboardMonthYm = '';
    state.clientSettings = {};
    state.screenDataCache = {};
    localStorage.removeItem('dashboard_token');
    localStorage.removeItem('dashboard_user');
    localStorage.removeItem('dashboard_routes');
    return;
  }
  state.token = session.token;
  state.user = session.user;
  state.screenDataCache = {};
  localStorage.setItem('dashboard_token', session.token);
  localStorage.setItem('dashboard_user', JSON.stringify(session.user));
}
