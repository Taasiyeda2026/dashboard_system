const QUERY_FLAG = 'dsBaseline';
const STORAGE_FLAG = 'ds_baseline_enabled';
const DUPLICATE_WINDOW_MS = 1500;
const ALLOWED_ACTIONS = new Map([
  ['ops-tab:instructors', 'operations-schedule'],
  ['ops-tab:authorities', 'operations-authorities'],
  ['ops-tab:completion_approval', 'operations-completion-approvals'],
  ['ops-tab:workshops', 'operations-inventory'],
  ['pa-open-proposal', 'client-file-open'],
  ['pa-edit', 'client-file-edit'],
  ['pa-linked-documents', 'linked-documents-open'],
  ['pa-final-pdf', 'final-pdf-open']
]);

function safeUrl(raw, base = 'http://localhost/') {
  try { return new URL(String(raw || ''), base); } catch { return null; }
}

function serviceFor(url) {
  const path = url?.pathname || '';
  if (path.includes('/rest/v1/')) return 'supabase-rest';
  if (path.includes('/auth/v1/')) return 'supabase-auth';
  if (path.includes('/storage/v1/')) return 'supabase-storage';
  return /\.(?:m?js|css|woff2?|png|jpe?g|gif|svg|ico|webp|json)$/i.test(path) ? 'static' : 'other';
}

function pathTemplate(url, service) {
  const path = url?.pathname || '/';
  if (service === 'supabase-storage') return path.replace(/(\/object\/(?:sign|public|authenticated)\/[^/]+)\/.+$/, '$1/:redacted');
  return path.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/ig, ':id').replace(/\/\d+(?=\/|$)/g, '/:id');
}

function randomSalt(cryptoObject) {
  const bytes = new Uint8Array(16);
  if (cryptoObject?.getRandomValues) cryptoObject.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function memoryHash(value, salt) {
  let hash = 2166136261;
  const input = `${salt}:${value}`;
  for (let i = 0; i < input.length; i += 1) hash = Math.imul(hash ^ input.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function normalizeResource(rawUrl, { method = 'GET', salt = '' } = {}) {
  const url = safeUrl(rawUrl);
  if (!url) return { service: 'unknown', path: '/unknown', query_keys: [], filter_fingerprint: memoryHash('invalid', salt) };
  const pairs = Array.from(url.searchParams.entries()).sort(([ak, av], [bk, bv]) => `${ak}=${av}`.localeCompare(`${bk}=${bv}`));
  const canonical = pairs.map(([key, value]) => `${key}=${value}`).join('&');
  const service = serviceFor(url);
  const lower = canonical.toLowerCase();
  return {
    service,
    path: pathTemplate(url, service),
    query_keys: [...new Set(pairs.map(([key]) => key))].sort(),
    filter_fingerprint: memoryHash(`${String(method).toUpperCase()}:${url.origin}${url.pathname}?${canonical}`, salt),
    requested_regular_period: /(?:activity_season|activity_period)=regular(?:&|$)/.test(lower),
    requested_summer_2026_period: /(?:activity_season|activity_period)=summer_2026(?:&|$)/.test(lower),
    requested_2026_completion_approvals: service === 'supabase-rest' && url.pathname.includes('completion_approval') && /2026|summer_2026/.test(lower)
  };
}

export function shouldEnableBaselineMonitor({ buildEnabled, location, storage }) {
  if (!buildEnabled) return false;
  const url = safeUrl(location?.href);
  return url?.searchParams.get(QUERY_FLAG) === '1' || storage?.getItem?.(STORAGE_FLAG) === '1';
}

export function consumeQueryFlag(location, history) {
  const url = safeUrl(location?.href);
  if (!url || url.searchParams.get(QUERY_FLAG) !== '1') return false;
  url.searchParams.delete(QUERY_FLAG);
  history?.replaceState?.(history.state, '', `${url.pathname}${url.search}${url.hash}`);
  return true;
}

function safeContext(getContext) {
  const raw = getContext?.() || {};
  return {
    route: String(raw.route || 'unknown'),
    activity_period: String(raw.activity_period || 'unknown'),
    tab: String(raw.tab || 'unknown'),
    drawer_open: !!raw.drawer_open,
    document_open: !!raw.document_open,
    navigation_id: String(raw.navigation_id || 'unknown')
  };
}

export function installLocalBaselineMonitor(options = {}) {
  const scope = options.scope || globalThis;
  const originalFetch = scope.fetch;
  if (typeof originalFetch !== 'function') return null;
  const now = options.now || (() => scope.performance?.now?.() ?? Date.now());
  const salt = randomSalt(options.crypto || scope.crypto);
  const records = [];
  const observers = [];
  const listeners = [];
  const timers = new Set();
  const pendingFetches = [];
  let sequence = 0;
  let scenario = null;
  let removed = false;

  function exportableRecords() {
    const groups = new Map();
    let nextGroup = 0;
    return records.map((row) => {
      const fingerprint = row.filter_fingerprint;
      if (!groups.has(fingerprint)) groups.set(fingerprint, `request-shape-${++nextGroup}`);
      return { ...row, filter_fingerprint: undefined, request_shape_group: groups.get(fingerprint) };
    });
  }

  const recordResource = (entry) => {
    const normalized = normalizeResource(entry.name, { method: 'UNKNOWN', salt });
    const candidate = pendingFetches.find((item) => !item.matched && item.path === normalized.path && Math.abs(item.started_at_ms - entry.startTime) < 50);
    if (candidate) candidate.matched = true;
    records.push({
      id: `resource-${++sequence}`,
      source: candidate ? 'fetch+resource' : 'resource',
      matched_fetch_id: candidate?.id || null,
      method: candidate?.method || null,
      method_exposed: !!candidate,
      ...normalized,
      started_at_ms: entry.startTime,
      duration_ms: entry.duration,
      transfer_size: Number.isFinite(entry.transferSize) ? entry.transferSize : null,
      encoded_body_size: Number.isFinite(entry.encodedBodySize) ? entry.encodedBodySize : null,
      decoded_body_size: Number.isFinite(entry.decodedBodySize) ? entry.decodedBodySize : null,
      preflight_status: candidate?.method === 'OPTIONS' ? 'confirmed' : 'browser-not-exposed',
      context: candidate?.context || safeContext(options.getContext),
      scenario
    });
  };

  if (typeof scope.PerformanceObserver === 'function') {
    const observer = new scope.PerformanceObserver((list) => list.getEntries().forEach(recordResource));
    try { observer.observe({ type: 'resource', buffered: true }); observers.push(observer); } catch { observer.disconnect(); }
  }

  function monitoredFetch(input, init) {
    const method = String(init?.method || (typeof scope.Request === 'function' && input instanceof scope.Request ? input.method : 'GET') || 'GET').toUpperCase();
    const rawUrl = typeof scope.Request === 'function' && input instanceof scope.Request ? input.url : input;
    const started = now();
    const normalized = normalizeResource(rawUrl, { method, salt });
    const item = { id: `fetch-${++sequence}`, source: 'fetch', method, ...normalized, started_at_ms: started, context: safeContext(options.getContext), scenario, matched: false };
    pendingFetches.push(item);
    const requestPromise = originalFetch.apply(this, arguments);
    void requestPromise.then(
      (response) => records.push({ ...item, matched: undefined, duration_ms: now() - started, ok: !!response?.ok, status: Number(response?.status) || null }),
      () => records.push({ ...item, matched: undefined, duration_ms: now() - started, ok: false, status: null })
    );
    return requestPromise;
  }
  scope.fetch = monitoredFetch;

  const clickListener = (event) => {
    const target = event.target?.closest?.('[data-ops-tab],[data-pa-open-proposal-id],[data-pa-edit-row],[data-pa-linked-documents],[data-pa-view-final-pdf]');
    if (!target) return;
    let key = 'unknown';
    if (target.hasAttribute('data-ops-tab')) key = `ops-tab:${target.getAttribute('data-ops-tab')}`;
    else if (target.hasAttribute('data-pa-open-proposal-id')) key = 'pa-open-proposal';
    else if (target.hasAttribute('data-pa-edit-row')) key = 'pa-edit';
    else if (target.hasAttribute('data-pa-linked-documents')) key = 'pa-linked-documents';
    else if (target.hasAttribute('data-pa-view-final-pdf')) key = 'pa-final-pdf';
    options.onAction?.(ALLOWED_ACTIONS.get(key) || 'unknown');
  };
  options.document?.addEventListener?.('click', clickListener, true);
  if (options.document?.removeEventListener) listeners.push(() => options.document.removeEventListener('click', clickListener, true));

  const api = {
    startScenario(meta = {}) { scenario = { name: String(meta.name || 'unknown'), temperature: meta.temperature === 'warm' ? 'warm' : 'cold', started_at_ms: now() }; },
    endScenario() { if (scenario) scenario.ended_at_ms = now(); return scenario; },
    markNavigation(meta = {}) { options.onNavigation?.({ route: String(meta.route || 'unknown'), started_at_ms: now() }); },
    markContent(meta = {}) { options.onContent?.({ route: String(meta.route || 'unknown'), displayed_at_ms: now() }); },
    snapshot() { return { schema_version: 1, generated_at: new Date().toISOString(), records: exportableRecords() }; },
    exportJson() { return JSON.stringify(this.snapshot(), null, 2); },
    uninstall() {
      if (removed) return;
      removed = true;
      if (scope.fetch === monitoredFetch) scope.fetch = originalFetch;
      observers.forEach((observer) => observer.disconnect());
      listeners.splice(0).forEach((remove) => remove());
      timers.forEach((timer) => scope.clearTimeout?.(timer));
      timers.clear(); records.length = 0; pendingFetches.length = 0; scenario = null;
      if (scope.__dsLocalBaseline === api) delete scope.__dsLocalBaseline;
    }
  };
  scope.__dsLocalBaseline = api;
  return api;
}

export function bootstrapLocalBaselineMonitor(options = {}) {
  const scope = options.scope || globalThis;
  const location = options.location || scope.location;
  const storage = options.storage || scope.localStorage;
  if (!shouldEnableBaselineMonitor({ buildEnabled: options.buildEnabled === true, location, storage })) return null;
  consumeQueryFlag(location, options.history || scope.history);
  return installLocalBaselineMonitor({ ...options, scope });
}
