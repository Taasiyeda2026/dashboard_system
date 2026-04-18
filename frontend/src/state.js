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
  activityView: 'compact',
  financeFilter: '',
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
