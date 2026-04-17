import { CONFIG } from '../config.js';

export const state = {
  user: null,
  route: CONFIG.ROUTES.login,
  activitiesFilters: {
    activity_type: 'all',
    authority: '',
    school: '',
    instructor_name: '',
    activity_manager: '',
    status: ''
  }
};

export function loadSession() {
  try {
    const raw = localStorage.getItem(CONFIG.SESSION_KEY);
    if (raw) state.user = JSON.parse(raw);
  } catch (_e) {
    state.user = null;
  }
}

export function saveSession(user) {
  state.user = user;
  localStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify(user));
}

export function clearSession() {
  state.user = null;
  localStorage.removeItem(CONFIG.SESSION_KEY);
}
