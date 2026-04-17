import { CONFIG } from '../config.js';
import { state } from '../app/state.js';

async function request(action, params = {}, method = 'GET') {
  const payload = {
    action,
    user_id: state.user?.user_id,
    entry_code: state.user?.entry_code,
    ...params
  };

  let response;
  if (method === 'POST') {
    response = await fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } else {
    const qs = new URLSearchParams(payload).toString();
    response = await fetch(`${CONFIG.API_URL}?${qs}`);
  }

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json = await response.json();
  if (json.ok === false) throw new Error(json.error || 'Request failed');
  return json;
}

export const api = {
  login: (identifier, password) => request('login', { identifier, entry_code: password }, 'POST'),
  getBootstrap: () => request('getBootstrap'),
  getDashboard: () => request('getDashboard'),
  getActivities: (filters) => request('getActivities', filters),
  getModuleData: (moduleId, filters = {}) => {
    const payload = { module_id: moduleId };
    Object.entries(filters).forEach(([key, value]) => {
      payload[`filter_${key}`] = value;
    });
    return request('getModuleData', payload);
  }
};
