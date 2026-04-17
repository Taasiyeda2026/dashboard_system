import { CONFIG } from './config.js';
import { state } from './state.js';

async function call(action, payload = {}) {
  let response;
  try {
    response = await fetch(CONFIG.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token: state.token, ...payload })
    });
  } catch (error) {
    throw new Error('Network error');
  }

  let json = null;
  try {
    json = await response.json();
  } catch (error) {
    throw new Error(response.status === 401 ? 'Unauthorized' : 'Malformed API response');
  }

  if (!response.ok || !json?.ok) {
    const message = json?.error || (response.status === 401 ? 'Unauthorized' : 'Request failed');
    throw new Error(message);
  }

  return json.data || {};
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
  submitEditRequest: (payload) => call('submitEditRequest', payload),
  saveActivity: (payload) => call('saveActivity', payload),
  addActivity: (payload) => call('addActivity', payload),
  savePermission: (payload) => call('savePermission', payload)
};
