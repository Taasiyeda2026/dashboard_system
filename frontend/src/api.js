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

const MUTATION_INVALIDATION_TARGETS = {
  // Note edit affects activities list payload only.
  savePrivateNote: ['activities:'],
  // Submiting request does not mutate primary activity datasets.
  submitEditRequest: []
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

const API_TIMEOUT_MS_READ = 12000;
const API_TIMEOUT_MS_WRITE = 18000;
const READ_RETRY_DELAY_MS = 250;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeApiError(code, fallbackMessage) {
  const normalized = String(code || '').toLowerCase().trim() || 'unknown_error';
  const err = new Error(translateApiErrorForUser(normalized || fallbackMessage || 'server_error'));
  err.code = normalized;
  err.userMessage = translateApiErrorForUser(normalized || fallbackMessage || 'server_error');
  return err;
}

function normalizeBackendErrorCode(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function shouldRetryReadError(errorCode) {
  return errorCode === 'network_error' || errorCode === 'timeout' || errorCode === 'server_error';
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
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw makeApiError('timeout');
    }
    throw makeApiError('network_error');
  } finally {
    clearTimeout(timer);
  }
}

async function request(action, payload = {}) {
  if (!config.apiUrl) {
    throw new Error('חסר קישור API. עדכנו frontend/src/config.js או window.__DASHBOARD_CONFIG__.');
  }
  const tokenAtCallTime = state.token;
  const maxAttempts = READ_ACTIONS[action] ? 2 : 1;

  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const response = await postWithTimeout(action, payload, tokenAtCallTime);
      if (!response.ok) {
        if (response.status === 401 && state.token === tokenAtCallTime) {
          setSession(null);
        }
        const code = response.status >= 500 ? 'server_error' : 'bad_request';
        throw makeApiError(code);
      }

      let json;
      try {
        json = await response.json();
      } catch {
        throw makeApiError('server_error');
      }

      if (!json.ok) {
        const code = normalizeBackendErrorCode(json.error);
        if (code === 'unauthorized' && state.token === tokenAtCallTime) {
          setSession(null);
        }
        throw makeApiError(code || 'server_error', json.error);
      }

      if (MUTATING_ACTIONS[action]) {
        if (Object.prototype.hasOwnProperty.call(MUTATION_INVALIDATION_TARGETS, action)) {
          clearScreenDataCache(MUTATION_INVALIDATION_TARGETS[action]);
        } else {
          clearScreenDataCache();
        }
      }
      return json.data;
    } catch (error) {
      const errorCode = String(error?.code || '').toLowerCase();
      const canRetry = READ_ACTIONS[action] && attempt < maxAttempts && shouldRetryReadError(errorCode);
      if (canRetry) {
        await sleep(READ_RETRY_DELAY_MS);
        continue;
      }
      if (error && typeof error.userMessage === 'string' && error.userMessage) {
        throw new Error(error.userMessage);
      }
      if (errorCode) {
        throw new Error(translateApiErrorForUser(errorCode));
      }
      throw new Error(translateApiErrorForUser('server_error'));
    }
  }

  throw new Error(translateApiErrorForUser('server_error'));
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
