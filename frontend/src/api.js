import { config } from './config.js';
import { state, setSession, clearScreenDataCache } from './state.js';
import { translateApiErrorForUser } from './screens/shared/ui-hebrew.js';

const MUTATING_ACTIONS = {
  saveActivity: true,
  addActivity: true,
  submitEditRequest: true,
  reviewEditRequest: true,
  savePermission: true,
  savePrivateNote: true
};

async function request(action, payload = {}) {
  if (!config.apiUrl) {
    throw new Error('חסר קישור API. עדכנו frontend/src/config.js או window.__DASHBOARD_CONFIG__.');
  }

  let response;
  try {
    response = await fetch(config.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ action, token: state.token, ...payload })
    });
  } catch {
    throw new Error(translateApiErrorForUser('network_error'));
  }

  let json;
  try {
    json = await response.json();
  } catch {
    throw new Error(translateApiErrorForUser('server_error'));
  }
  if (!json.ok) {
    if ((json.error || '').toLowerCase() === 'unauthorized') {
      setSession(null);
    }
    throw new Error(translateApiErrorForUser(json.error));
  }
  if (MUTATING_ACTIONS[action]) {
    clearScreenDataCache();
  }
  return json.data;
}

export const api = {
  login: (user_id, entry_code) => request('login', { user_id, entry_code }),
  bootstrap: () => request('bootstrap'),
  dashboard: () => request('dashboard'),
  activities: (filters) => request('activities', filters),
  week: () => request('week'),
  month: () => request('month'),
  exceptions: () => request('exceptions'),
  finance: () => request('finance'),
  instructors: () => request('instructors'),
  contacts: () => request('contacts'),
  myData: () => request('myData'),
  permissions: () => request('permissions'),
  addActivity: (target, data) => request('addActivity', { target, data }),
  saveActivity: (source_row_id, changes) => request('saveActivity', { source_row_id, changes }),
  submitEditRequest: (source_row_id, changes) => request('submitEditRequest', { source_row_id, changes }),
  reviewEditRequest: (request_id, status) => request('reviewEditRequest', { request_id, status }),
  savePermission: (row) => request('savePermission', { row }),
  savePrivateNote: (source_row_id, note) => request('savePrivateNote', { source_row_id, note })
};
