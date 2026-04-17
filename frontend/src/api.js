import { CONFIG } from './config.js';
import { state } from './state.js';

async function call(action, payload = {}) {
  const response = await fetch(CONFIG.apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, token: state.token, ...payload })
  });
  const json = await response.json();
  if (!json.ok) throw new Error(json.error || 'Request failed');
  return json.data;
}

export const api = {
  login: (entryCode) => call('login', { entryCode }),
  bootstrap: () => call('bootstrap'),
  dashboard: () => call('dashboard'),
  activities: (params = {}) => call('activities', params),
  week: (params = {}) => call('week', params),
  month: (params = {}) => call('month', params),
  exceptions: () => call('exceptions'),
  finance: (params = {}) => call('finance', params),
  instructors: () => call('instructors'),
  contacts: () => call('contacts'),
  myData: () => call('myData'),
  permissions: () => call('permissions'),
  submitEditRequest: (payload) => call('submitEditRequest', payload)
};
