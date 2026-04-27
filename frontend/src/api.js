import { config } from './config.js';
import { state, setSession, clearScreenDataCache } from './state.js';
import { translateApiErrorForUser } from './screens/shared/ui-hebrew.js';

/**
 * Actions that modify server-side data.
 *
 * After mutating actions succeed, cache invalidation runs automatically
 * (see bottom of request()).
 *
 * Mutations clear only related route caches (not full wipe), so navigation
 * stays fast while still showing fresh data where needed.
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
  addContact: true,
  saveContact: true,
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
  dashboardSnapshot: true,
  activities: true,
  activityDetail: true,
  week: true,
  month: true,
  exceptions: true,
  finance: true,
  financeDetail: true,
  instructors: true,
  instructorContacts: true,
  contacts: true,
  endDates: true,
  myData: true,
  operations: true,
  operationsDetail: true,
  editRequests: true,
  permissions: true,
  listSheets: true
};

const API_TIMEOUT_MS_READ = 20000;
const API_TIMEOUT_MS_WRITE = 30000;
const PERF_MAX_REQUESTS = 150;
const RETRYABLE_SERVER_ERRORS = new Set([
  'network_error',
  'server_error',
  'service_unavailable',
  'timeout',
  'temporarily_unavailable',
  'internal_error'
]);

function invalidateScreenDataByAction(action) {
  const targetedMutations = {
    saveActivity: ['activities:', 'activityDetail:', 'week:', 'month:', 'dashboard:', 'end-dates'],
    addActivity: ['activities:', 'activityDetail:', 'week:', 'month:', 'dashboard:', 'end-dates'],
    submitEditRequest: ['activities:', 'edit-requests', 'week:', 'month:', 'dashboard:', 'end-dates'],
    reviewEditRequest: ['edit-requests', 'activities:', 'activityDetail:', 'dashboard:'],
    saveFinanceRow: ['finance:', 'dashboard:'],
    syncFinance: ['finance:', 'dashboard:'],
    addUser: ['permissions', 'dashboard:'],
    deactivateUser: ['permissions', 'dashboard:'],
    reactivateUser: ['permissions', 'dashboard:'],
    deleteUser: ['permissions', 'dashboard:'],
    savePrivateNote: ['activities:', 'operations:'],
    savePermission: ['permissions']
  };
  const prefixes = targetedMutations[action];
  if (!prefixes || !prefixes.length) return;
  if (prefixes.includes('*')) {
    clearScreenDataCache();
    return;
  }
  Object.keys(state.screenDataCache || {}).forEach((key) => {
    if (prefixes.some((prefix) => key === prefix || key.startsWith(prefix))) {
      delete state.screenDataCache[key];
    }
  });
}

function isPerfDebugEnabled() {
  try {
    if (typeof window !== 'undefined' && window.__DEBUG_PERF__ === true) return true;
    if (typeof localStorage !== 'undefined' && localStorage.getItem('debug_perf') === '1') return true;
  } catch { /* ignore */ }
  return false;
}

function getPerfStore() {
  if (typeof window === 'undefined') return null;
  if (!window.__dsPerf) {
    window.__dsPerf = { requests: [], renders: [], screens: {} };
    window.__resetDsPerf = () => {
      window.__dsPerf = { requests: [], renders: [], screens: {} };
    };
  }
  return window.__dsPerf;
}

function pushPerfRequest(entry) {
  const store = getPerfStore();
  if (!store) return;
  store.requests.push(entry);
  if (store.requests.length > PERF_MAX_REQUESTS) store.requests.splice(0, store.requests.length - PERF_MAX_REQUESTS);
  const stats = store.screens[entry.action] || { count: 0, total_ms: 0, max_ms: 0 };
  stats.count += 1;
  stats.total_ms += entry.duration_ms || 0;
  stats.max_ms = Math.max(stats.max_ms, entry.duration_ms || 0);
  store.screens[entry.action] = stats;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeData(data) {
  if (Array.isArray(data)) return data.map(normalizeData);
  if (!data || typeof data !== 'object') return data;

  const normalized = Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, normalizeData(value)])
  );

  normalized.StartTime = normalized.StartTime ?? normalized.start_time ?? normalized.startTime ?? '';
  normalized.EndTime = normalized.EndTime ?? normalized.end_time ?? normalized.endTime ?? '';
  normalized.End = normalized.End ?? normalized.end_date ?? normalized.endDate ?? normalized.DateEnd ?? '';
  normalized.EmployeeID = normalized.EmployeeID ?? normalized.emp_id ?? normalized.employee_id ?? '';
  normalized.Employee = normalized.Employee ?? normalized.instructor_name ?? normalized.employee_name ?? '';
  normalized.Program = normalized.Program ?? normalized.activity_name ?? '';
  normalized.ActivityNo = normalized.ActivityNo ?? normalized.activity_no ?? '';

  return normalized;
}

async function postWithTimeout(action, requestBody) {
  const timeoutMs = READ_ACTIONS[action] ? API_TIMEOUT_MS_READ : API_TIMEOUT_MS_WRITE;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(config.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(requestBody),
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

  const requestBody = {
    action,
    token: tokenAtCallTime,
    ...payload
  };
  if (isPerfDebugEnabled()) requestBody.debug_perf = true;

  const requestStart = performance.now();
  let response;
  let firstResponseStatus = 0;
  try {
    response = await postWithTimeout(action, requestBody);
    firstResponseStatus = response?.status || 0;
  } catch {
    if (READ_ACTIONS[action]) {
      try {
        await sleep(120);
        response = await postWithTimeout(action, requestBody);
      } catch {
        throw new Error(translateApiErrorForUser('network_error'));
      }
    } else {
      throw new Error(translateApiErrorForUser('network_error'));
    }
  }

  let lastResponseText = '';

  async function parseAndValidate(res) {
    try {
      lastResponseText = await res.text();
      return JSON.parse(lastResponseText);
    } catch {
      return null;
    }
  }

  let json = await parseAndValidate(response);

  function shouldRetryReadAction() {
    if (!READ_ACTIONS[action]) return false;
    if (!json) return true; // non-JSON / malformed response is usually transient
    if (json.ok) return false;
    const errKey = String(json.error || '').toLowerCase();
    if (errKey === 'unauthorized' || errKey === 'forbidden' || errKey === 'invalid_credentials') return false;
    if (RETRYABLE_SERVER_ERRORS.has(errKey)) return true;
    return firstResponseStatus >= 500;
  }

  // Retry once only for transient read failures.
  if (shouldRetryReadAction()) {
    try {
      const retryResponse = await postWithTimeout(action, requestBody);
      json = await parseAndValidate(retryResponse);
    } catch {
      throw new Error(translateApiErrorForUser('network_error'));
    }
  }

  if (!json) throw new Error(translateApiErrorForUser('server_error'));

  if (!json.ok) {
    if ((json.error || '').toLowerCase() === 'unauthorized' && state.token === tokenAtCallTime) {
      setSession(null);
    }
    throw new Error(translateApiErrorForUser(json.error));
  }
  if (MUTATING_ACTIONS[action]) {
    invalidateScreenDataByAction(action);
  }
  pushPerfRequest({
    action,
    duration_ms: Math.round(performance.now() - requestStart),
    payload_bytes: lastResponseText.length,
    backend_debug: json.data && json.data.debug_perf ? json.data.debug_perf : null
  });
  return normalizeData(json.data);
}

export const api = {
  login: (user_id, entry_code) => request('login', { user_id, entry_code }),
  bootstrap: () => request('bootstrap'),
  dashboard: (filters) => request('dashboard', filters || {}),
  dashboardSnapshot: (filters) => request('dashboardSnapshot', filters || {}),
  activities: (filters) => request('activities', filters),
  activityDetail: (source_row_id, source_sheet) => request('activityDetail', { source_row_id, source_sheet }),
  week: (params) => request('week', params || {}),
  month: (params) => request('month', params || {}),
  exceptions: () => request('exceptions'),
  finance: (params) => request('finance', params || {}),
  financeDetail: (source_row_id, source_sheet) => request('financeDetail', { source_row_id, source_sheet }),
  instructors: () => request('instructors'),
  instructorContacts: () => request('instructorContacts'),
  contacts: () => request('contacts'),
  endDates: () => request('endDates'),
  myData: () => request('myData'),
  operations: (params) => request('operations', params || {}),
  operationsDetail: (source_row_id, source_sheet) => request('operationsDetail', { source_row_id, source_sheet }),
  editRequests: () => request('editRequests'),
  permissions: () => request('permissions'),
  addContact: (payload) => request('addContact', payload),
  saveContact: (payload) => request('saveContact', payload),
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
  },
  listSheets: () => request('listSheets')
};
