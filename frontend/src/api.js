import { config } from './config.js';
import { state, setSession } from './state.js';

async function request(action, payload = {}) {
  const response = await fetch(config.apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, token: state.token, ...payload })
  });

  const json = await response.json();
  if (!json.ok) {
    if ((json.error || '').toLowerCase() === 'unauthorized') {
      setSession(null);
    }
    throw new Error(json.error || 'Request failed');
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
