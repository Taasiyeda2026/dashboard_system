var READ_MODEL_ADMIN_USER_ = { user_id: 'read_model_refresh', display_role: 'admin' };
var READ_MODEL_NO_FINANCE_USER_ = { user_id: 'read_model_refresh_nf', display_role: 'authorized_user' };
var READ_MODEL_SHEET_FALLBACK_ = 'read_models';
var READ_MODEL_HEADERS_ = [
  'key',
  'updated_at',
  'version',
  'hash',
  'rows_json',
  'payload_json',
  'source_updated_at',
  'status',
  'duration_ms',
  'rows_count',
  'payload_size',
  'last_error'
];

function readModelSheetName_() {
  return (CONFIG.SHEETS && CONFIG.SHEETS.READ_MODELS) || READ_MODEL_SHEET_FALLBACK_;
}

function ensureReadModelsSheet_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(readModelSheetName_());
  if (!sheet) sheet = ss.insertSheet(readModelSheetName_());
  sheet.getRange(CONFIG.HEADER_ROW, 1, 1, READ_MODEL_HEADERS_.length).setValues([READ_MODEL_HEADERS_]);
  invalidateReadRowsCache_(readModelSheetName_());
  return sheet;
}

function readModelRows_() {
  ensureReadModelsSheet_();
  try {
    return readRowsProjected_(readModelSheetName_(), READ_MODEL_HEADERS_);
  } catch (_e) {
    return [];
  }
}

function readModelRowByKey_(key) {
  var k = text_(key);
  if (!k) return null;
  var rows = readModelRows_();
  for (var i = 0; i < rows.length; i++) {
    if (text_(rows[i].key) === k) return rows[i];
  }
  return null;
}

function computeReadModelHash_(value) {
  var raw = JSON.stringify(value || {});
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw);
  return bytes.map(function(b) {
    var n = b < 0 ? b + 256 : b;
    var h = n.toString(16);
    return h.length === 1 ? '0' + h : h;
  }).join('');
}

function parseReadModelJson_(raw, fallback) {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw === 'object') return raw;
  var s = String(raw || '').trim();
  if (!s) return fallback;
  try {
    return JSON.parse(s);
  } catch (_e) {
    return fallback;
  }
}

function buildReadModelStorageKey_(key, params) {
  var k = text_(key);
  var p = params && typeof params === 'object' ? params : {};
  var body = {};
  Object.keys(p).sort().forEach(function(name) {
    if (p[name] === null || p[name] === undefined) return;
    var val = text_(p[name]);
    if (!val) return;
    body[name] = val;
  });
  var qs = Object.keys(body).map(function(name) {
    return name + '=' + body[name];
  }).join('&');
  return qs ? (k + '?' + qs) : k;
}

function upsertReadModelRow_(rowObj) {
  ensureReadModelsSheet_();
  upsertRowByKey_(readModelSheetName_(), 'key', rowObj);
}

function markReadModelStatus_(key, status, message) {
  var existing = readModelRowByKey_(key) || {};
  upsertReadModelRow_({
    key: key,
    updated_at: text_(existing.updated_at || formatDate_(new Date())),
    version: text_(existing.version || dataViewsCacheVersion_()),
    hash: text_(existing.hash),
    rows_json: text_(existing.rows_json),
    payload_json: text_(existing.payload_json),
    source_updated_at: text_(existing.source_updated_at),
    status: text_(status || existing.status || 'stale'),
    duration_ms: text_(existing.duration_ms),
    rows_count: text_(existing.rows_count),
    payload_size: text_(existing.payload_size),
    last_error: text_(message || existing.last_error)
  });
}

function payloadRowsCount_(payload) {
  if (!payload || typeof payload !== 'object') return 0;
  if (Array.isArray(payload.rows)) return payload.rows.length;
  if (Array.isArray(payload.cells)) return payload.cells.length;
  if (Array.isArray(payload.days)) return payload.days.length;
  return 0;
}

function persistReadModelPayload_(storageKey, payload, sourceUpdatedAt) {
  var nowIso = new Date().toISOString();
  var version = String(new Date().getTime());
  var hash = computeReadModelHash_(payload);
  var payloadText = JSON.stringify(payload || {});
  var rows = payload && Array.isArray(payload.rows) ? payload.rows : [];
  upsertReadModelRow_({
    key: storageKey,
    updated_at: nowIso,
    version: version,
    hash: hash,
    rows_json: JSON.stringify(rows),
    payload_json: payloadText,
    source_updated_at: text_(sourceUpdatedAt || ''),
    status: 'fresh',
    duration_ms: '',
    rows_count: String(payloadRowsCount_(payload)),
    payload_size: String(payloadText.length),
    last_error: ''
  });
}

function refreshSingleReadModel_(logicalKey, params, builder) {
  var storageKey = buildReadModelStorageKey_(logicalKey, params || {});
  var started = perfNowMs_();
  markReadModelStatus_(storageKey, 'rebuilding', '');
  try {
    var payload = builder(params || {});
    var nowIso = new Date().toISOString();
    var version = String(new Date().getTime());
    var hash = computeReadModelHash_(payload);
    var payloadText = JSON.stringify(payload || {});
    var rows = payload && Array.isArray(payload.rows) ? payload.rows : [];
    upsertReadModelRow_({
      key: storageKey,
      updated_at: nowIso,
      version: version,
      hash: hash,
      rows_json: JSON.stringify(rows),
      payload_json: payloadText,
      source_updated_at: nowIso,
      status: 'fresh',
      duration_ms: String(Math.max(0, perfNowMs_() - started)),
      rows_count: String(payloadRowsCount_(payload)),
      payload_size: String(payloadText.length),
      last_error: ''
    });
    return { key: storageKey, status: 'fresh', hash: hash, version: version };
  } catch (e) {
    upsertReadModelRow_({
      key: storageKey,
      updated_at: new Date().toISOString(),
      version: String(new Date().getTime()),
      hash: '',
      rows_json: '[]',
      payload_json: '{}',
      source_updated_at: '',
      status: 'failed',
      duration_ms: String(Math.max(0, perfNowMs_() - started)),
      rows_count: '0',
      payload_size: '2',
      last_error: text_(e && e.message ? e.message : String(e))
    });
    return { key: storageKey, status: 'failed', error: text_(e && e.message ? e.message : String(e)) };
  }
}

function refreshDashboardReadModel_() {
  return refreshSingleReadModel_('dashboard', {}, function() {
    return actionDashboardSnapshot_(READ_MODEL_NO_FINANCE_USER_, {});
  });
}

function refreshActivitiesReadModel_() {
  return refreshSingleReadModel_('activities', {}, function() {
    return actionActivitiesSnapshotFirst_(READ_MODEL_ADMIN_USER_, { activity_type: 'all' });
  });
}

function refreshWeekReadModel_() {
  return refreshSingleReadModel_('week', { week_offset: 0 }, function() {
    return actionWeek_(READ_MODEL_ADMIN_USER_, { week_offset: 0 });
  });
}

function refreshMonthReadModel_() {
  var ym = formatDate_(new Date()).slice(0, 7);
  return refreshSingleReadModel_('month', { ym: ym }, function() {
    return actionMonth_(READ_MODEL_ADMIN_USER_, { ym: ym });
  });
}

function refreshExceptionsReadModel_() {
  var month = formatDate_(new Date()).slice(0, 7);
  return refreshSingleReadModel_('exceptions', { month: month }, function() {
    return actionExceptions_(READ_MODEL_ADMIN_USER_, { month: month });
  });
}

function refreshFinanceReadModel_() {
  var month = formatDate_(new Date()).slice(0, 7);
  return refreshSingleReadModel_('finance', { month: month, tab: 'active' }, function() {
    return actionFinance_(READ_MODEL_ADMIN_USER_, { month: month, tab: 'active' });
  });
}

function refreshEndDatesReadModel_() {
  return refreshSingleReadModel_('end-dates', {}, function() {
    return actionEndDates_(READ_MODEL_ADMIN_USER_);
  });
}

function refreshAllReadModels_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) return { skipped: true, reason: 'read_models_refresh_already_running' };
  var hadCache = !!__rqCache_;
  if (!hadCache) beginRequestCache_();
  try {
    var results = [];
    results.push(refreshDashboardReadModel_());
    results.push(refreshActivitiesReadModel_());
    results.push(refreshWeekReadModel_());
    results.push(refreshMonthReadModel_());
    results.push(refreshExceptionsReadModel_());
    results.push(refreshFinanceReadModel_());
    results.push(refreshEndDatesReadModel_());
    bumpDataViewsCacheVersion_();
    return { ok: true, refreshed_at: new Date().toISOString(), results: results };
  } finally {
    if (!hadCache) __rqCache_ = null;
    lock.releaseLock();
  }
}

function normalizeReadModelManifest_(rows) {
  var nowMonth = formatDate_(new Date()).slice(0, 7);
  var map = {};
  map.dashboard = readModelRowByKey_('dashboard') || {};
  map.activities = readModelRowByKey_('activities') || {};
  map.week = readModelRowByKey_('week?week_offset=0') || {};
  map.month = readModelRowByKey_('month?ym=' + nowMonth) || {};
  map.exceptions = readModelRowByKey_('exceptions?month=' + nowMonth) || {};
  map.finance = readModelRowByKey_('finance?month=' + nowMonth + '&tab=active') || {};
  map['end_dates'] = readModelRowByKey_('end-dates') || {};
  var out = {};
  Object.keys(map).forEach(function(key) {
    var r = map[key] || {};
    out[key] = {
      version: text_(r.version || ''),
      updated_at: text_(r.updated_at || ''),
      hash: text_(r.hash || ''),
      status: text_(r.status || 'missing')
    };
  });
  return out;
}

function actionReadModelManifest_(user) {
  requireAnyRole_(user, ['admin', 'operation_manager', 'authorized_user', 'instructor']);
  var rows = readModelRows_();
  return normalizeReadModelManifest_(rows);
}

function markReadModelStale_(logicalKey, params, reason) {
  var storageKey = buildReadModelStorageKey_(logicalKey, params || {});
  var row = readModelRowByKey_(storageKey);
  if (!row) {
    upsertReadModelRow_({
      key: storageKey,
      updated_at: new Date().toISOString(),
      version: String(new Date().getTime()),
      hash: '',
      rows_json: '[]',
      payload_json: '{}',
      source_updated_at: '',
      status: 'stale',
      duration_ms: '',
      rows_count: '0',
      payload_size: '2',
      last_error: text_(reason || 'marked_stale')
    });
    return;
  }
  markReadModelStatus_(storageKey, 'stale', reason || '');
}

function markReadModelsDirtyByMutation_(action, payload) {
  var nowMonth = formatDate_(new Date()).slice(0, 7);
  var targets = [];
  if (action === 'addActivity' || action === 'saveActivity') {
    targets = [
      ['activities', {}], ['dashboard', {}], ['week', { week_offset: 0 }],
      ['month', { ym: nowMonth }], ['exceptions', { month: nowMonth }], ['end-dates', {}]
    ];
  } else if (action === 'submitEditRequest' || action === 'reviewEditRequest') {
    targets = [
      ['activities', {}], ['dashboard', {}], ['exceptions', { month: nowMonth }],
      ['month', { ym: nowMonth }], ['week', { week_offset: 0 }], ['end-dates', {}]
    ];
  } else if (action === 'saveFinanceRow' || action === 'syncFinance') {
    targets = [['finance', { month: nowMonth, tab: 'active' }], ['dashboard', {}]];
  } else if (action === 'savePermission') {
    targets = [['dashboard', {}]];
  }
  targets.forEach(function(pair) {
    markReadModelStale_(pair[0], pair[1], 'mutation:' + action);
  });
}

function refreshReadModelsForMutation_(action) {
  if (action === 'addActivity' || action === 'saveActivity' || action === 'submitEditRequest' || action === 'reviewEditRequest') {
    refreshActivitiesReadModel_();
    refreshDashboardReadModel_();
    refreshWeekReadModel_();
    refreshMonthReadModel_();
    refreshExceptionsReadModel_();
    refreshEndDatesReadModel_();
  } else if (action === 'saveFinanceRow' || action === 'syncFinance') {
    refreshFinanceReadModel_();
    refreshDashboardReadModel_();
  } else if (action === 'savePermission') {
    refreshDashboardReadModel_();
  }
}

function resolveReadModelBuilder_(key, user, params) {
  if (key === 'dashboard') return function() { return actionDashboardSnapshot_(user, params || {}); };
  if (key === 'activities') return function() { return actionActivitiesSnapshotFirst_(user, params || { activity_type: 'all' }); };
  if (key === 'week') return function() { return actionWeek_(user, params || { week_offset: 0 }); };
  if (key === 'month') return function() { return actionMonth_(user, params || {}); };
  if (key === 'exceptions') return function() { return actionExceptions_(user, params || {}); };
  if (key === 'finance') return function() { return actionFinance_(user, params || {}); };
  if (key === 'end-dates') return function() { return actionEndDates_(user); };
  if (key === 'instructors') return function() { return actionInstructors_(user); };
  return null;
}

function actionReadModelGet_(user, payload) {
  requireAnyRole_(user, ['admin', 'operation_manager', 'authorized_user', 'instructor']);
  var key = text_(payload && payload.key);
  if (!key) throw new Error('read model key is required');
  var params = parseJsonObject_((payload && payload.params) || {}, {});
  var storageKey = buildReadModelStorageKey_(key, params);
  var row = readModelRowByKey_(storageKey);
  if (row && text_(row.status) === 'fresh') {
    return {
      key: key,
      cache_key: storageKey,
      version: text_(row.version),
      hash: text_(row.hash),
      updated_at: text_(row.updated_at),
      status: text_(row.status),
      data: parseReadModelJson_(row.payload_json, {})
    };
  }
  var builder = resolveReadModelBuilder_(key, user, params);
  if (!builder) throw new Error('unknown read model key: ' + key);
  var data = builder();
  persistReadModelPayload_(storageKey, data, new Date().toISOString());
  var fresh = readModelRowByKey_(storageKey) || {};
  return {
    key: key,
    cache_key: storageKey,
    version: text_(fresh.version),
    hash: text_(fresh.hash),
    updated_at: text_(fresh.updated_at),
    status: text_(fresh.status || 'fresh'),
    data: data,
    warning: row ? 'fallback_rebuild_from_source' : 'missing_read_model_fallback'
  };
}

function getReadModelHealth_() {
  var rows = readModelRows_();
  return rows.map(function(row) {
    return {
      key: text_(row.key),
      updated_at: text_(row.updated_at),
      duration_ms: parseInt(text_(row.duration_ms), 10) || 0,
      rows_count: parseInt(text_(row.rows_count), 10) || 0,
      payload_size: parseInt(text_(row.payload_size), 10) || 0,
      hash: text_(row.hash),
      status: text_(row.status || 'missing'),
      last_error: text_(row.last_error)
    };
  });
}
