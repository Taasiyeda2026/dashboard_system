import { config } from './config.js';
import { state, setSession, clearScreenDataCache } from './state.js';
import { translateApiErrorForUser } from './screens/shared/ui-hebrew.js';
import { supabase } from './supabase-client.js';

/**
 * Actions that modify server-side data.
 *
 * After mutating actions succeed, cache invalidation runs automatically
 * (see bottom of request()).
 *
 * Mutations clear only related route caches (not full wipe), so navigation
 * stays fast while still showing fresh data where needed.
 *
 * Screens that expose their own save forms (activities.js, permissions.js)
 * additionally call the bind-injected clearScreenDataCache?.() right before
 * rerender() as a belt-and-suspenders guard for their targeted route cache keys.
 * Read-only screens (exceptions, end-dates, instructors, my-data, week, month,
 * contacts, instructor-contacts) have no save handlers and rely solely on this
 * centralised clear, which is sufficient.
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
  saveSheetMapping: true
};

const READ_ACTIONS = {
  bootstrap: true,
  dashboard: true,
  dashboardSnapshot: true,
  dashboardSheet: true,
  activities: true,
  activityDetail: true,
  activityDates: true,
  week: true,
  month: true,
  exceptions: true,
  instructors: true,
  instructorContacts: true,
  contacts: true,
  endDates: true,
  myData: true,
  operations: true,
  operationsDetail: true,
  editRequests: true,
  permissions: true,
  adminSettings: true,
  adminLists: true,
  listSheets: true,
  readModelManifest: true,
  readModelGet: true,
  readModelHealth: true,
};

const API_TIMEOUT_MS_READ = 20000;
const API_TIMEOUT_MS_WRITE = 45000;
const READ_MODEL_TIMEOUT_MS = 14000;
const PERF_MAX_REQUESTS = 150;
const MONTH_READ_MODEL_TTL_MS = 5 * 60 * 1000;
const monthReadModelCache = new Map();
const READ_MODEL_CACHE_STORAGE_KEY = 'ds_read_model_cache_v2';
const MANIFEST_TTL_MS = 5 * 60 * 1000;
let manifestCache = { t: 0, data: null };
/** Deduplicates concurrent readModelManifest network calls — any call while one is in-flight joins the same Promise. */
let manifestInflight = null;

/** When true, allowed screens may use readModelGet + local manifest cache instead of legacy actions. */
const READ_MODELS_ENABLED = true;

/** Explicit allow-list: only these read-model keys use the read-model path; all others use legacy only. */
const READ_MODEL_ENABLED_KEY_LIST = ['dashboard', 'activities', 'week', 'month', 'exceptions', 'end-dates'];
const READ_MODEL_ENABLED_KEYS = new Set(READ_MODEL_ENABLED_KEY_LIST);

/**
 * Heavy screen reads that must go through requestReadModel (or pass legacy_intentional in perfMeta).
 * Direct request() otherwise logs [legacy-guard] for visibility.
 */
const HEAVY_LEGACY_GUARDED_READ_ACTIONS = new Set([
  'dashboardSnapshot',
  'activities',
  'week',
  'month',
  'exceptions',
  'endDates'
]);

function warnHeavyLegacyReadWithoutIntentionalFlag(action, perfMeta) {
  if (!READ_ACTIONS[action]) return;
  if (!HEAVY_LEGACY_GUARDED_READ_ACTIONS.has(action)) return;
  if (perfMeta?.legacy_intentional === true) return;
  let caller = '';
  try {
    caller = String(new Error().stack || '')
      .split('\n')
      .slice(2, 6)
      .map((s) => s.trim())
      .join(' | ');
  } catch {
    /* ignore */
  }
  try {
    console.warn('[legacy-guard]', JSON.stringify({
      screen: String(action),
      action: String(action),
      reason: 'heavy_legacy_read_without_read_model_path',
      caller
    }));
  } catch {
    /* ignore */
  }
}


function rowMatchesActivitiesFilters(row, filters = {}) {
  const activityType = String(filters?.activity_type || '').trim();
  const month = String(filters?.month || '').trim();

  if (activityType && activityType !== 'all' && String(row?.activity_type || '').trim() !== activityType) return false;

  if (/^\d{4}-\d{2}$/.test(month)) {
    const start = String(row?.date_start || row?.start_date || '').trim();
    if (/^\d{4}-\d{2}/.test(start) && !start.startsWith(month)) return false;
  }

  return true;
}

async function readActivitiesFromSupabase(filters = {}) {
  if (!supabase) return null;

  try {
    const [longResult, shortResult] = await Promise.all([
      supabase.from('data_long').select('*'),
      supabase.from('data_short').select('*')
    ]);

    if (longResult.error) {
      // eslint-disable-next-line no-console
      console.error('[supabase] Failed to load data_long:', longResult.error);
      return null;
    }
    if (shortResult.error) {
      // eslint-disable-next-line no-console
      console.error('[supabase] Failed to load data_short:', shortResult.error);
      return null;
    }

    const longRows = Array.isArray(longResult.data)
      ? longResult.data.map((row) => ({ ...row, source_sheet: row?.source_sheet || 'data_long' }))
      : [];
    const shortRows = Array.isArray(shortResult.data)
      ? shortResult.data.map((row) => ({ ...row, source_sheet: row?.source_sheet || 'data_short' }))
      : [];

    const rows = [...longRows, ...shortRows].filter((row) => rowMatchesActivitiesFilters(row, filters));
    return { rows };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[supabase] Unexpected data_long/data_short fetch error:', error);
    return null;
  }
}

/**
 * Reads contacts_instructors + contacts_schools from Supabase.
 * Returns { instructor_rows, school_rows, can_view_instructors, can_view_schools, _source }
 * or null on any failure (caller falls back to GAS).
 *
 * ⚠️ permissions table is intentionally excluded — login credentials must never be read client-side.
 */
async function readContactsFromSupabase() {
  if (!supabase) return null;
  try {
    const [instrResult, schoolResult] = await Promise.all([
      supabase.from('contacts_instructors').select('*'),
      supabase.from('contacts_schools').select('*')
    ]);
    if (instrResult.error) {
      // eslint-disable-next-line no-console
      console.error('[supabase] Failed to load contacts_instructors:', instrResult.error);
      return null;
    }
    if (schoolResult.error) {
      // eslint-disable-next-line no-console
      console.error('[supabase] Failed to load contacts_schools:', schoolResult.error);
      return null;
    }
    const instructor_rows = Array.isArray(instrResult.data) ? instrResult.data : [];
    const school_rows = Array.isArray(schoolResult.data) ? schoolResult.data : [];
    return {
      instructor_rows,
      school_rows,
      can_view_instructors: true,
      can_view_schools: true,
      _source: 'supabase'
    };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[supabase] Unexpected contacts fetch error:', error);
    return null;
  }
}

/**
 * Reads contacts_instructors from Supabase for the instructor-contacts screen.
 * Returns { rows, _source } or null on failure.
 */
async function readInstructorContactsFromSupabase() {
  if (!supabase) return null;
  try {
    const result = await supabase.from('contacts_instructors').select('*');
    if (result.error) {
      // eslint-disable-next-line no-console
      console.error('[supabase] Failed to load contacts_instructors:', result.error);
      return null;
    }
    return {
      rows: Array.isArray(result.data) ? result.data : [],
      _source: 'supabase'
    };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[supabase] Unexpected contacts_instructors fetch error:', error);
    return null;
  }
}

/**
 * Reads the lists table from Supabase and groups rows into categories.
 * Expected columns: category, value, label (label optional — falls back to value).
 * Returns { categories: [{ category, items: [{ label, value }] }], _source } or null.
 */
async function readListsFromSupabase() {
  if (!supabase) return null;
  try {
    const result = await supabase.from('lists').select('*').order('category').order('value');
    if (result.error) {
      // eslint-disable-next-line no-console
      console.error('[supabase] Failed to load lists:', result.error);
      return null;
    }
    const rows = Array.isArray(result.data) ? result.data : [];
    const catMap = new Map();
    for (const row of rows) {
      const cat = String(row.category || row.group || '').trim();
      if (!cat) continue;
      const value = String(row.value ?? row.item_value ?? row.val ?? '').trim();
      const label = String(row.label ?? row.item_label ?? row.display ?? value).trim() || value;
      if (!value) continue;
      if (!catMap.has(cat)) catMap.set(cat, []);
      catMap.get(cat).push({ label, value });
    }
    const categories = [...catMap.entries()].map(([category, items]) => ({ category, items }));
    return { categories, _source: 'supabase' };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[supabase] Unexpected lists fetch error:', error);
    return null;
  }
}

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
    saveActivity: ['activities:', 'activityDetail:', 'activityDates:', 'week:', 'month:', 'dashboard:', 'exceptions:', 'end-dates'],
    addActivity: ['activities:', 'activityDetail:', 'activityDates:', 'week:', 'month:', 'dashboard:', 'exceptions:', 'end-dates'],
    submitEditRequest: ['activities:', 'activityDetail:', 'activityDates:', 'edit-requests', 'week:', 'month:', 'dashboard:', 'end-dates'],
    reviewEditRequest: ['edit-requests', 'activities:', 'activityDetail:', 'activityDates:', 'week:', 'month:', 'dashboard:', 'exceptions:'],
    addUser: ['permissions', 'dashboard:'],
    deactivateUser: ['permissions', 'dashboard:'],
    reactivateUser: ['permissions', 'dashboard:'],
    deleteUser: ['permissions', 'dashboard:'],
    savePrivateNote: ['activities:', 'operations:'],
    savePermission: ['permissions'],
    addContact: ['contacts', 'instructor-contacts'],
    saveContact: ['contacts', 'instructor-contacts'],
    saveSheetMapping: ['adminSettings', 'listSheets']
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
  if (!READ_MODELS_ENABLED) return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function safeLocalStorageSetJson(key, value) {
  if (!READ_MODELS_ENABLED) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* ignore */ }
}

async function getReadModelManifestCached() {
  if (!READ_MODELS_ENABLED) return {};
  const now = Date.now();
  if (manifestCache.data && now - manifestCache.t < MANIFEST_TTL_MS) return manifestCache.data;
  if (manifestInflight) return manifestInflight;
  manifestInflight = request('readModelManifest', {})
    .then((fresh) => {
      manifestCache = { t: Date.now(), data: fresh || {} };
      manifestInflight = null;
      return manifestCache.data;
    })
    .catch((err) => {
      manifestInflight = null;
      throw err;
    });
  return manifestInflight;
}

function readModelLocalCacheKey(key, params = {}) {
  const normalized = Object.entries(params || {})
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
    .sort(([a], [b]) => a.localeCompare(b));
  const suffix = normalized.map(([k, v]) => `${k}=${String(v).trim()}`).join('&');
  return suffix ? `${key}?${suffix}` : key;
}

function manifestEntryForReadModel(key, params = {}) {
  if (key === 'week' || key === 'month' || key === 'exceptions') {
    return readModelLocalCacheKey(key, params);
  }
  if (key === 'dashboard') return 'dashboard';
  if (key === 'activities') return 'activities';
  if (key === 'end-dates') return 'end-dates';
  if (key === 'instructors') return 'instructors';
  return null;
}

function warnReadModelClientLegacy(screenKey, legacyAction, reason, extra = {}) {
  try {
    console.warn('[readModel][client] legacy action', JSON.stringify({
      screen: String(screenKey),
      legacy_action: String(legacyAction),
      reason: String(reason),
      ...extra
    }));
  } catch {
    /* ignore */
  }
}

async function requestReadModel(key, params = {}, fallbackAction, fallbackPayload = {}, options = {}) {
  const perfBase = {
    action: fallbackAction,
    used_read_model: false,
    fallback_used: false,
    cache_hit: false,
    sheet_reads_count: null
  };
  if (!READ_MODELS_ENABLED || !READ_MODEL_ENABLED_KEYS.has(key)) {
    if (READ_MODEL_ENABLED_KEYS.has(key) && !READ_MODELS_ENABLED) {
      warnReadModelClientLegacy(key, fallbackAction, 'read_models_client_disabled', { params });
      return request(fallbackAction, fallbackPayload, {
        ...perfBase,
        fallback_used: true,
        legacy_fallback_reason: 'read_models_client_disabled',
        legacy_intentional: true,
        read_model_screen_key: key,
        ...options
      });
    }
    return request(fallbackAction, fallbackPayload, {
      ...perfBase,
      fallback_used: true,
      used_read_model: false,
      legacy_fallback_reason: 'read_model_not_enabled_for_screen',
      legacy_intentional: true,
      read_model_screen_key: key,
      ...options
    });
  }

  const manifestKey = manifestEntryForReadModel(key, params);
  const localKey = readModelLocalCacheKey(key, params);

  async function fetchReadModelFresh_() {
    const envelope = await request('readModelGet', { key, params }, {
      action: fallbackAction,
      used_read_model: true,
      fallback_used: false,
      cache_hit: false,
      ...options
    });
    const data = envelope?.data ?? envelope ?? {};
    const cachedModels = safeLocalStorageGetJson(READ_MODEL_CACHE_STORAGE_KEY, {});
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
  }

  try {
    const cachedModels = safeLocalStorageGetJson(READ_MODEL_CACHE_STORAGE_KEY, {});
    const hit = cachedModels?.[localKey];

    if (hit && hit.data) {
      let cacheFresh = false;
      try {
        const manifest = await getReadModelManifestCached();
        const manifestMeta = manifestKey ? manifest?.[manifestKey] : null;
        cacheFresh =
          !!manifestMeta &&
          !!hit.version &&
          !!hit.hash &&
          hit.version === manifestMeta.version &&
          hit.hash === manifestMeta.hash;
      } catch (_manifestErr) {
        cacheFresh = false;
      }

      if (cacheFresh) {
        refreshReadModelInBackground_(key, params, localKey, manifestKey, hit);
        pushPerfRequest({
          action: fallbackAction,
          duration_ms: 0,
          slow: false,
          payload_size: JSON.stringify(hit.data || {}).length,
          used_read_model: true,
          fallback_used: false,
          cache_hit: true,
          sheet_reads_count: null
        });
        return hit.data;
      }

      try {
        return await fetchReadModelFresh_();
      } catch (_refreshErr) {
        warnReadModelClientLegacy(key, fallbackAction, 'read_model_refresh_failed', {
          params,
          error: _refreshErr?.message || String(_refreshErr)
        });
        const staleData = hit?.data && typeof hit.data === 'object' ? { ...hit.data, _read_model_stale: true } : hit?.data;
        if (staleData) {
          pushPerfRequest({
            action: fallbackAction,
            duration_ms: 0,
            slow: false,
            payload_size: JSON.stringify(staleData || {}).length,
            used_read_model: true,
            fallback_used: false,
            cache_hit: true,
            stale_cache_used: true,
            sheet_reads_count: null
          });
          return staleData;
        }
        throw _refreshErr;
      }
    }

    return await fetchReadModelFresh_();
  } catch (err) {
    warnReadModelClientLegacy(key, fallbackAction, 'read_model_get_failed', {
      params,
      error: err?.message || String(err)
    });
    const explicitLegacy = options?.forceLegacy === true || params?.force_legacy === true || String(params?.force_legacy || '').toLowerCase() === 'yes' || options?.debug === true;
    const legacyReason = explicitLegacy ? 'read_model_get_failed_explicit' : 'read_model_get_failed_auto_fallback';
    if (fallbackAction) {
      return request(fallbackAction, { ...(fallbackPayload || {}), force_legacy: true }, {
        ...perfBase,
        fallback_used: true,
        legacy_fallback_reason: legacyReason,
        legacy_intentional: true,
        read_model_screen_key: key,
        ...options
      });
    }
    throw new Error('הנתונים מתעדכנים כעת. נסו שוב בעוד מספר רגעים.');
  }
}

async function refreshReadModelInBackground_(key, params, localKey, manifestKey, hit) {
  if (!READ_MODELS_ENABLED) return;
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

/**
 * When true, requests include debug_perf and console logs [perf] lines with server metrics.
 * Enable any of:
 *   localStorage.setItem('ds_debug_perf', '1')
 *   localStorage.setItem('debug_perf', '1')   // legacy
 *   window.__DEBUG_PERF__ = true
 *   ?debug_perf=1 on the app URL
 * Server: set script property DEBUG_PERF=1 for all requests without client flags.
 */
function isPerfDebugEnabled() {
  try {
    if (typeof window !== 'undefined' && window.__DEBUG_PERF__ === true) return true;
    if (typeof localStorage !== 'undefined') {
      if (localStorage.getItem('ds_debug_perf') === '1') return true;
      if (localStorage.getItem('debug_perf') === '1') return true;
    }
    if (typeof window !== 'undefined' && window.location?.search) {
      const q = new URLSearchParams(window.location.search).get('debug_perf');
      if (q === '1' || (q && q.toLowerCase() === 'true')) return true;
    }
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

async function postWithTimeout(action, requestBody, timeoutOverrideMs) {
  const baseTimeoutMs = (action === 'readModelManifest' || action === 'readModelGet')
    ? READ_MODEL_TIMEOUT_MS
    : (READ_ACTIONS[action] ? API_TIMEOUT_MS_READ : API_TIMEOUT_MS_WRITE);
  const timeoutMs = typeof timeoutOverrideMs === 'number' && timeoutOverrideMs > 0 ? timeoutOverrideMs : baseTimeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  try {
    return await fetch(config.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
  } catch (err) {
    if (controller.signal.aborted) {
      const isWrite = !READ_ACTIONS[action];
      throw Object.assign(new Error(isWrite ? 'save_timeout' : 'request_timeout'), { _isTimeout: true });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function emitPerfEntry(entry) {
  pushPerfRequest({
    ...entry,
    slow: Number(entry?.duration_ms || 0) > 3000
  });
  if (isPerfDebugEnabled()) {
    const line = {
      action: entry.action,
      duration_ms: entry.duration_ms,
      server_duration_ms: entry.server_duration_ms,
      sheet_reads_count: entry.sheet_reads_count,
      payload_size: entry.payload_size,
      server_payload_size: entry.server_payload_size,
      fallback_used: entry.fallback_used,
      legacy_fallback_reason: entry.legacy_fallback_reason,
      cache_hit: entry.cache_hit,
      background_refresh: entry.background_refresh
    };
    // eslint-disable-next-line no-console
    console.info('[perf]', line, entry.backend_debug || '');
  }
}

function buildPerfRequestEntry(action, requestStart, lastResponseText, perfMeta = {}, sheetReads = null, backendDebug = null) {
  const durationMs = Math.round(performance.now() - requestStart);
  const dbg = backendDebug && typeof backendDebug === 'object' ? backendDebug : null;
  const fromServerCount = dbg?.sheet_reads_count;
  const fromServerArray = Array.isArray(dbg?.sheet_reads) ? dbg.sheet_reads.length : null;
  const mergedSheetReads =
    sheetReads != null && sheetReads !== ''
      ? sheetReads
      : (fromServerCount != null ? fromServerCount : fromServerArray);
  const serverDuration = dbg?.duration_ms ?? dbg?.total_ms ?? null;
  const serverPayloadSize = dbg?.payload_size ?? dbg?.response_size_bytes ?? null;
  const serverFallback = dbg?.fallback_used;
  const legacyReason =
    perfMeta.legacy_fallback_reason ?? dbg?.read_model_legacy_reason ?? null;
  const bg =
    perfMeta.background_refresh ??
    (typeof globalThis !== 'undefined' && globalThis.__DS_BG_SCREEN_REFRESH__);
  const mergedFallback =
    serverFallback !== undefined && serverFallback !== null
      ? Boolean(serverFallback)
      : Boolean(perfMeta.fallback_used) || Boolean(dbg?.read_model_legacy_fallback) || Boolean(legacyReason);
  return {
    action: perfMeta.action || action,
    duration_ms: durationMs,
    server_duration_ms: serverDuration,
    slow: durationMs > 3000,
    payload_size: typeof lastResponseText === 'string' ? lastResponseText.length : null,
    server_payload_size: serverPayloadSize,
    used_read_model: Boolean(perfMeta.used_read_model || action === 'readModelGet'),
    fallback_used: mergedFallback,
    legacy_fallback_reason: legacyReason,
    cache_hit: Boolean(perfMeta.cache_hit || dbg?.cache_hit),
    sheet_reads_count: mergedSheetReads,
    background_refresh: Boolean(bg),
    backend_debug: dbg
  };
}

async function request(action, payload = {}, perfMeta = {}) {
  warnHeavyLegacyReadWithoutIntentionalFlag(action, perfMeta);
  const timeoutMs = typeof perfMeta?.timeout_ms === 'number' ? perfMeta.timeout_ms : undefined;
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
    response = await postWithTimeout(action, requestBody, timeoutMs);
    firstResponseStatus = response?.status || 0;
  } catch (fetchErr) {
    if (fetchErr?._isTimeout) {
      throw new Error(fetchErr.message);
    }
    if (READ_ACTIONS[action]) {
      try {
        await sleep(120);
        response = await postWithTimeout(action, requestBody, timeoutMs);
      } catch (retryErr) {
        if (retryErr?._isTimeout) throw new Error(retryErr.message);
        throw new Error('network_error');
      }
    } else {
      throw new Error('network_error');
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
      const retryResponse = await postWithTimeout(action, requestBody, timeoutMs);
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
    if (action === 'diagnosticsConsistency' &&
        typeof json.error === 'string' &&
        json.error.indexOf('DIAGNOSTICS_ADMIN_DETAILS:') === 0 &&
        ['admin', 'operation_manager'].includes(String(state?.user?.display_role || ''))) {
      throw new Error(json.error.slice('DIAGNOSTICS_ADMIN_DETAILS:'.length));
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
  const backendDbg = json?.data?.debug_perf && typeof json.data.debug_perf === 'object' ? json.data.debug_perf : null;
  const sheetReads =
    backendDbg?.sheet_reads_count ??
    (Array.isArray(backendDbg?.sheet_reads) ? backendDbg.sheet_reads.length : null) ??
    json?.data?.sheet_reads_count ??
    null;
  emitPerfEntry(buildPerfRequestEntry(
    action,
    requestStart,
    lastResponseText,
    perfMeta,
    sheetReads,
    backendDbg
  ));
  return normalized;
}

export const api = {
  login: (user_id, entry_code) => request('login', { user_id, entry_code }),
  bootstrap: () => request('bootstrap'),
  dashboard: (filters) => {
    const route = String(state?.route || '').trim();
    const isProd = !config.devMode;
    if (isProd && route === 'dashboard') {
      throw new Error('Legacy dashboard API is blocked on Dashboard screen in production. Use dashboardSnapshot instead.');
    }
    return request('dashboard', filters || {});
  },
  dashboardSnapshot: (filters) => request('dashboardSnapshot', filters || {}),
  dashboardSheet: (filters) => request('dashboardSheet', filters || {}),
  dashboardReadModel: (filters, options) => {
    const resolved = (filters && typeof filters === 'object') ? filters : {};
    const candidate = String(resolved.month || resolved.ym || '').trim();
    const now = new Date();
    const currentYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const month = /^\d{4}-\d{2}$/.test(candidate) ? candidate : currentYm;
    const canonical = { ...resolved, month };
    return requestReadModel('dashboard', canonical, 'dashboardSheet', canonical, options || {});
  },
  activities: async (filters, options) => {
    const resolvedFilters = filters || {};
    const supabaseData = await readActivitiesFromSupabase(resolvedFilters);
    if (supabaseData) return normalizeData(supabaseData);
    return requestReadModel('activities', resolvedFilters, 'activities', resolvedFilters, options || {});
  },
  activityDetail: (source_row_id, source_sheet) => request('activityDetail', { source_row_id, source_sheet }),
  activityDates: (source_row_id, source_sheet) => request('activityDates', { source_row_id, source_sheet }),
  week: (params, options) => {
    const resolved = (params && typeof params === 'object') ? params : {};
    const weekOffset = Number.parseInt(resolved.week_offset, 10);
    const canonical = { ...resolved, week_offset: Number.isFinite(weekOffset) ? weekOffset : 0 };
    return requestReadModel('week', canonical, 'week', canonical, options || {});
  },
  month: (params, options) => {
    const resolved = (params && typeof params === 'object') ? params : {};
    const candidate = String(resolved.ym || resolved.month || '').trim();
    const now = new Date();
    const currentYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const ym = /^\d{4}-\d{2}$/.test(candidate) ? candidate : currentYm;
    const canonical = { ...resolved, ym };
    return requestReadModel('month', canonical, 'month', canonical, options || {});
  },
  exceptions: (params, options) => {
    const resolved = (params && typeof params === 'object') ? params : {};
    const candidate = String(resolved.month || resolved.ym || '').trim();
    const now = new Date();
    const currentYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const month = /^\d{4}-\d{2}$/.test(candidate) ? candidate : currentYm;
    const canonical = { ...resolved, month };
    return requestReadModel('exceptions', canonical, 'exceptions', canonical, options || {});
  },
  instructors: () => request('instructors'),
  instructorContacts: async () => {
    const supabaseData = await readInstructorContactsFromSupabase();
    if (supabaseData) return supabaseData;
    return request('instructorContacts');
  },
  contacts: async () => {
    const supabaseData = await readContactsFromSupabase();
    if (supabaseData) return supabaseData;
    return request('contacts');
  },
  endDates: (options) => requestReadModel('end-dates', {}, 'endDates', {}, options || {}),
  myData: () => request('myData'),
  operations: (params) => request('operations', params || {}),
  operationsDetail: (source_row_id, source_sheet) => request('operationsDetail', { source_row_id, source_sheet }),
  editRequests: () => request('editRequests'),
  permissions: () => request('permissions'),
  adminSettings: () => request('adminSettings'),
  adminLists: async () => {
    const supabaseData = await readListsFromSupabase();
    if (supabaseData) return supabaseData;
    return request('adminLists');
  },
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
  saveSheetMapping: (payload) => request('saveSheetMapping', payload),
  readModelManifest: () => request('readModelManifest', {}),
  readModelGet: (key, params = {}) => request('readModelGet', { key, params }),
  readModelHealth: () => request('readModelHealth', {}),
};

export { isPerfDebugEnabled, getPerfStore, READ_MODELS_ENABLED, READ_MODEL_ENABLED_KEY_LIST };
