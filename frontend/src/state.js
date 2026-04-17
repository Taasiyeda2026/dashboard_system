export const state = {
  token: localStorage.getItem('dashboard_token') || '',
  user: JSON.parse(localStorage.getItem('dashboard_user') || 'null'),
  route: 'login',
  routes: [],
  activityTab: 'all',
  activityView: 'compact',
  financeFilter: ''
};

export function setSession(session) {
  if (!session) {
    state.token = '';
    state.user = null;
    state.routes = [];
    state.route = 'login';
    localStorage.removeItem('dashboard_token');
    localStorage.removeItem('dashboard_user');
    return;
  }
  state.token = session.token;
  state.user = session.user;
  localStorage.setItem('dashboard_token', session.token);
  localStorage.setItem('dashboard_user', JSON.stringify(session.user));
}
