import { config } from './config.js';
import { state, setSession, clearScreenDataCache } from './state.js';
import { translateApiErrorForUser } from './screens/shared/ui-hebrew.js';

/**
 * Actions that modify server-side data.
 *
 * After any of these actions succeeds, clearScreenDataCache() is called
 * automatically (see bottom of request()). This wipes the entire
 * state.screenDataCache so that every screen — activities, finance,
 * permissions, exceptions, end-dates, instructors, my-data, week, month,
 * dashboard, etc. — fetches fresh data on its next render.
 *
 * Calendar views (week, month, dashboard) are therefore always stale-safe:
 * any admin action (deactivateUser, reactivateUser, deleteUser, savePermission,
 * addUser) or finance mutation (saveFinanceRow, syncFinance, saveActivity)
 * triggers a full cache wipe, ensuring calendar screens never show stale data
 * after a mutation elsewhere in the app.
 *
 * Screens that expose their own save forms (activities.js, finance.js,
 * permissions.js) additionally call the bind-injected clearScreenDataCache?.()
 * right before rerender() as a belt-and-suspenders guard for their targeted
 * route cache keys. Read-only screens (exceptions, end-dates, instructors,
 * my-data, week, month, contacts, instructor-contacts) have no save handlers
 * and rely solely on this centralised clear, which is sufficient.
 */
const MUTATING_ACTIONS = {
  saveActivity: true,
  addActivity: true,
  submitEditRequest: true,
  reviewEditRequest: true,
  savePermission: true,
  addUser: true,
  deactivateUser: true,
  reactivateUser: true,
  deleteUser: true,
  savePrivateNote: true,
  saveFinanceRow: true,
  syncFinance: true
};

const READ_ACTIONS = {
  bootstrap: true,
  dashboard: true,
  activities: true,
  week: true,
  month: true,
  exceptions: true,
  finance: true,
  instructors: true,
  instructorContacts: true,
  contacts: true,
  endDates: true,
  myData: true,
  permissions: true
};

const API_TIMEOUT_MS_READ = 20000;
const API_TIMEOUT_MS_WRITE = 30000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postWithTimeout(action, payload, tokenAtCallTime) {
  const timeoutMs = READ_ACTIONS[action] ? API_TIMEOUT_MS_READ : API_TIMEOUT_MS_WRITE;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(config.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ action, token: tokenAtCallTime, ...payload }),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function request(action, payload = {}) {
  if (!config.apiUrl) {
    throw new Error('חסר קישור API. עדכנו frontend/src/config.js או window.__DASHBOARD_CONFIG__.');
  }

  const tokenAtCallTime = state.token;

  let response;
  try {
    response = await postWithTimeout(action, payload, tokenAtCallTime);
  } catch {
    if (READ_ACTIONS[action]) {
      try {
        await sleep(250);
        response = await postWithTimeout(action, payload, tokenAtCallTime);
      } catch {
        throw new Error(translateApiErrorForUser('network_error'));
      }
    } else {
      throw new Error(translateApiErrorForUser('network_error'));
    }
  }

  let json;
  try {
    json = await response.json();
  } catch {
    throw new Error(translateApiErrorForUser('server_error'));
  }
  if (!json.ok) {
    if ((json.error || '').toLowerCase() === 'unauthorized' && state.token === tokenAtCallTime) {
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
  finance: (params) => request('finance', params || {}),
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
  addUser: (row) => request('addUser', { row }),
  deactivateUser: (user_id) => request('deactivateUser', { user_id }),
  reactivateUser: (user_id) => request('reactivateUser', { user_id }),
  deleteUser: (user_id) => request('deleteUser', { user_id }),
  saveFinanceRow: (payload) => request('saveFinanceRow', payload),
  syncFinance: () => request('syncFinance', {}),
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
