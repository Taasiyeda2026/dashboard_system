export const state = {
  token: localStorage.getItem('ops_token') || '',
  user: JSON.parse(localStorage.getItem('ops_user') || 'null'),
  bootstrap: null,
  route: 'dashboard',
  viewMode: 'table'
};

export function setAuth(session) {
  state.token = session?.token || '';
  state.user = session?.user || null;
  if (state.token) {
    localStorage.setItem('ops_token', state.token);
    localStorage.setItem('ops_user', JSON.stringify(state.user));
    return;
  }
  localStorage.removeItem('ops_token');
  localStorage.removeItem('ops_user');
}
