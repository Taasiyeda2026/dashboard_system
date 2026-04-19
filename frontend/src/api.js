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
  dashboard: (filters) => request('dashboard', filters || {}),
  activities: (filters) => request('activities', filters),
  week: (params) => request('week', params || {}),
  month: (params) => request('month', params || {}),
  exceptions: () => request('exceptions'),
  finance: () => request('finance'),
  instructors: () => request('instructors'),
  instructorContacts: () => request('instructorContacts'),
  contacts: () => request('contacts'),
  endDates: () => request('endDates'),
  myData: () => request('myData'),
  permissions: () => request('permissions'),
  addActivity: (target, data) => {
    if (typeof target === 'object' && target !== null && data === undefined) {
      return request('addActivity', { activity: target });
    }
    return request('addActivity', { activity: { ...(data || {}), source: target } });
  },
  /** מקבל אובייקט מלא (כולל source_sheet, changes) או חתימה ישנה (id, changes). */
  saveActivity: (a, b) =>
    b !== undefined && b !== null
      ? request('saveActivity', { source_row_id: a, changes: b })
      : request('saveActivity', a),
  submitEditRequest: (source_row_id, changes) => request('submitEditRequest', { source_row_id, changes }),
  reviewEditRequest: (request_id, status) => request('reviewEditRequest', { request_id, status }),
  savePermission: (row) => request('savePermission', { row }),
  savePrivateNote: (a, b, c) => {
    if (typeof a === 'object' && a !== null) {
      return request('savePrivateNote', {
        source_sheet: a.source_sheet,
        source_row_id: a.source_row_id,
        note: a.note ?? a.note_text ?? ''
      });
    }
    return request('savePrivateNote', { source_sheet: a, source_row_id: b, note: c });
  }
};
