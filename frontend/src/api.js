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
  listSheets: true,
  readModelManifest: true,
  readModelGet: true,
  readModelHealth: true
};

const API_TIMEOUT_MS_READ = 20000;
const API_TIMEOUT_MS_WRITE = 30000;
const READ_MODEL_TIMEOUT_MS = 6000;
const PERF_MAX_REQUESTS = 150;
const MONTH_READ_MODEL_TTL_MS = 5 * 60 * 1000;
const monthReadModelCache = new Map();
const READ_MODEL_CACHE_STORAGE_KEY = 'ds_read_model_cache_v1';
const MANIFEST_TTL_MS = 30 * 1000;
let manifestCache = { t: 0, data: null };

const READ_MODELS_ENABLED = (() => {
  try {
    return localStorage.getItem('disable_read_models') !== '1';
  } catch {
    return true;
  }
})();

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
    saveActivity: ['activities:', 'activityDetail:', 'week:', 'month:', 'dashboard:', 'exceptions:', 'end-dates'],
    addActivity: ['activities:', 'activityDetail:', 'week:', 'month:', 'dashboard:', 'exceptions:', 'end-dates'],
    submitEditRequest: ['activities:', 'edit-requests', 'week:', 'month:', 'dashboard:', 'end-dates'],
    reviewEditRequest: ['edit-requests', 'activities:', 'activityDetail:', 'dashboard:', 'exceptions:'],
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

function invalidateReadModelLocalCacheByAction(action) {
  const targeted = {
    saveActivity: ['dashboard', 'activities', 'week', 'month', 'exceptions', 'end-dates'],
    addActivity: ['dashboard', 'activities', 'week', 'month', 'exceptions', 'end-dates'],
    submitEditRequest: ['dashboard', 'activities', 'week', 'month', 'exceptions', 'end-dates'],
    reviewEditRequest: ['dashboard', 'activities', 'week', 'month', 'exceptions'],
    saveFinanceRow: ['dashboard', 'finance'],
    syncFinance: ['dashboard', 'finance'],
    savePermission: ['dashboard']
  };
  const keys = targeted[action];
  if (!keys?.length) return;
  const allCache = safeLocalStorageGetJson(READ_MODEL_CACHE_STORAGE_KEY, {});
  Object.keys(allCache).forEach((cacheKey) => {
    if (keys.some((key) => cacheKey === key || cacheKey.startsWith(`${key}?`))) {
      delete allCache[cacheKey];
    }
  });
  safeLocalStorageSetJson(READ_MODEL_CACHE_STORAGE_KEY, allCache);
  manifestCache = { t: 0, data: null };
}

function monthReadModelKey(payload = {}) {
  const ym = String(payload?.ym || payload?.month || '').trim();
  return /^\d{4}-\d{2}$/.test(ym) ? ym : '__current__';
}

function clearMonthReadModelCache() {
  monthReadModelCache.clear();
}

function safeLocalStorageGetJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function safeLocalStorageSetJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* ignore */ }
}

async function getReadModelManifestCached() {
  const now = Date.now();
  if (manifestCache.data && now - manifestCache.t < MANIFEST_TTL_MS) return manifestCache.data;
  const fresh = await request('readModelManifest', {});
  manifestCache = { t: now, data: fresh || {} };
  return manifestCache.data;
}

function readModelLocalCacheKey(key, params = {}) {
  const normalized = Object.entries(params || {})
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
    .sort(([a], [b]) => a.localeCompare(b));
  const suffix = normalized.map(([k, v]) => `${k}=${String(v).trim()}`).join('&');
  return suffix ? `${key}?${suffix}` : key;
}

function manifestEntryForReadModel(key, params = {}) {
  if (key === 'dashboard') return 'dashboard';
  if (key === 'activities') return 'activities';
  if (key === 'week') return 'week';
  if (key === 'month') return 'month';
  if (key === 'exceptions') return 'exceptions';
  if (key === 'finance') return 'finance';
  if (key === 'end-dates') return 'end_dates';
  if (key === 'instructors') return 'instructors';
  return null;
}

async function requestReadModel(key, params = {}, fallbackAction, fallbackPayload = {}) {
  if (!READ_MODELS_ENABLED) {
    return request(fallbackAction, fallbackPayload);
  }
  try {
    const manifestKey = manifestEntryForReadModel(key, params);
    const localKey = readModelLocalCacheKey(key, params);
    const cachedModels = safeLocalStorageGetJson(READ_MODEL_CACHE_STORAGE_KEY, {});
    const hit = cachedModels?.[localKey];
    if (hit && hit.data) {
      refreshReadModelInBackground_(key, params, localKey, manifestKey, hit);
      return hit.data;
    }

    const manifest = await getReadModelManifestCached();
    const manifestMeta = manifestKey ? manifest?.[manifestKey] : null;

    if (
      hit &&
      manifestMeta &&
      hit.version &&
      hit.hash &&
      hit.version === manifestMeta.version &&
      hit.hash === manifestMeta.hash
    ) {
      return hit.data;
    }

    const envelope = await request('readModelGet', { key, params });
    const data = envelope?.data ?? envelope ?? {};

    const nextCache = {
      ...cachedModels,
      [localKey]: {
        key,
        version: envelope?.version || '',
        hash: envelope?.hash || '',
        updated_at: envelope?.updated_at || '',
        data
      }
    };

    safeLocalStorageSetJson(READ_MODEL_CACHE_STORAGE_KEY, nextCache);
    return data;
  } catch (err) {
    console.warn('[readModel] fallback to legacy endpoint', {
      key,
      fallbackAction,
      error: err?.message || err
    });
    return request(fallbackAction, fallbackPayload);
  }
}

async function refreshReadModelInBackground_(key, params, localKey, manifestKey, hit) {
  try {
    const manifest = await getReadModelManifestCached();
    const manifestMeta = manifestKey ? manifest?.[manifestKey] : null;
    if (
      manifestMeta &&
      hit.version &&
      hit.hash &&
      hit.version === manifestMeta.version &&
      hit.hash === manifestMeta.hash
    ) return;
    const envelope = await request('readModelGet', { key, params });
    const data = envelope?.data ?? envelope ?? {};
    const cachedModels = safeLocalStorageGetJson(READ_MODEL_CACHE_STORAGE_KEY, {});
    cachedModels[localKey] = {
      key,
      version: envelope?.version || '',
      hash: envelope?.hash || '',
      updated_at: envelope?.updated_at || '',
      data
    };
    safeLocalStorageSetJson(READ_MODEL_CACHE_STORAGE_KEY, cachedModels);
  } catch (_err) {}
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
  const timeoutMs = (action === 'readModelManifest' || action === 'readModelGet')
    ? READ_MODEL_TIMEOUT_MS
    : (READ_ACTIONS[action] ? API_TIMEOUT_MS_READ : API_TIMEOUT_MS_WRITE);
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
  if (action === 'month') {
    const key = monthReadModelKey(payload);
    const cached = monthReadModelCache.get(key);
    if (cached && Date.now() - cached.t < MONTH_READ_MODEL_TTL_MS) {
      return cached.data;
    }
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
  const normalized = normalizeData(json.data);
  if (action === 'month') {
    monthReadModelCache.set(monthReadModelKey(payload), { data: normalized, t: Date.now() });
  }
  if (action === 'saveActivity' || action === 'addActivity' || action === 'reviewEditRequest') {
    clearMonthReadModelCache();
  }
  if (MUTATING_ACTIONS[action]) {
    invalidateScreenDataByAction(action);
    invalidateReadModelLocalCacheByAction(action);
  }
  pushPerfRequest({
    action,
    duration_ms: Math.round(performance.now() - requestStart),
    payload_bytes: lastResponseText.length,
    backend_debug: json.data && json.data.debug_perf ? json.data.debug_perf : null
  });
  return normalized;
}

export const api = {
  login: (user_id, entry_code) => request('login', { user_id, entry_code }),
  bootstrap: () => request('bootstrap'),
  dashboard: (filters) => request('dashboard', filters || {}),
  dashboardSnapshot: (filters) => requestReadModel('dashboard', filters || {}, 'dashboardSnapshot', filters || {}),
  activities: (filters) => requestReadModel('activities', filters || {}, 'activities', filters || {}),
  activityDetail: (source_row_id, source_sheet) => request('activityDetail', { source_row_id, source_sheet }),
  week: (params) => requestReadModel('week', params || { week_offset: 0 }, 'week', params || {}),
  month: (params) => requestReadModel('month', params || {}, 'month', params || {}),
  exceptions: (params) => requestReadModel('exceptions', params || {}, 'exceptions', params || {}),
  finance: (params) => requestReadModel('finance', params || {}, 'finance', params || {}),
  financeDetail: (source_row_id, source_sheet) => request('financeDetail', { source_row_id, source_sheet }),
  instructors: () => request('instructors'),
  instructorContacts: () => request('instructorContacts'),
  contacts: () => request('contacts'),
  endDates: () => requestReadModel('end-dates', {}, 'endDates', {}),
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
  submitEditRequest: (source_row_id, changes) => {
    const normalizedChanges = Object.entries(changes || {}).reduce((acc, [key, value]) => {
      if (value === undefined || value === null) return acc;
      const normalizedValue = String(value).trim();
      acc[key] = normalizedValue;
      return acc;
    }, {});
    // eslint-disable-next-line no-console
    console.info('[submitEditRequest] source_row_id', source_row_id);
    // eslint-disable-next-line no-console
    console.info('[submitEditRequest] changes', normalizedChanges);
    if (!source_row_id || !Object.keys(normalizedChanges).length) {
      throw new Error('No changes to submit');
    }
    return request('submitEditRequest', { source_row_id, changes: normalizedChanges });
  },
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
  listSheets: () => request('listSheets'),
  readModelManifest: () => request('readModelManifest', {}),
  readModelGet: (key, params = {}) => request('readModelGet', { key, params }),
  readModelHealth: () => request('readModelHealth', {})
};
