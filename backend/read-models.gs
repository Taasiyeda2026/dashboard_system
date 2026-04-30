var READ_MODEL_ADMIN_USER_ = { user_id: 'read_model_refresh', display_role: 'admin' };
var READ_MODEL_NO_FINANCE_USER_ = { user_id: 'read_model_refresh_nf', display_role: 'authorized_user' };
var READ_MODEL_SHEET_FALLBACK_ = 'read_models';

/**
 * Metadata בלבד בגיליון — ללא payload_json / rows_json (מגבלת 50,000 תווים לתא).
 * גוף ה-JSON נשמר ב-Drive; storage_ref = מזהה קובץ.
 */
var READ_MODEL_HEADERS_ = [
  'key',
  'updated_at',
  'version',
  'hash',
  'source_updated_at',
  'status',
  'duration_ms',
  'rows_count',
  'payload_size',
  'last_error',
  'storage_type',
  'storage_ref'
];

/** JSON מלא נשמר ב-Drive בלבד; לא בתא. */
var READ_MODEL_STORAGE_DRIVE_ = 'drive';

/** מקסימום תווים לקריאת payload ישן מתא (אם נשאר עמודה payload_json אחרי מיגרציה חלקית). */
var READ_MODEL_LEGACY_INLINE_MAX_CHARS_ = 40000;

function readModelSheetName_() {
  return (CONFIG.SHEETS && CONFIG.SHEETS.READ_MODELS) || READ_MODEL_SHEET_FALLBACK_;
}

function readModelsSafeFileSegment_(storageKey) {
  var s = text_(storageKey).replace(/[^a-zA-Z0-9._-]+/g, '_');
  if (s.length > 100) s = s.slice(0, 100);
  return s || 'model';
}

function readModelsDriveParentFolder_() {
  var folderId = CONFIG.READ_MODELS_DRIVE_FOLDER_ID && text_(CONFIG.READ_MODELS_DRIVE_FOLDER_ID);
  if (folderId) {
    try {
      return DriveApp.getFolderById(folderId);
    } catch (_e) {
      // fall through
    }
  }
  try {
    var ssFile = DriveApp.getFileById(CONFIG.SPREADSHEET_ID);
    var parents = ssFile.getParents();
    if (parents.hasNext()) return parents.next();
  } catch (_e2) {
    // fall through
  }
  return DriveApp.getRootFolder();
}

function readModelsTrashDriveFile_(fileId) {
  var id = text_(fileId);
  if (!id) return;
  try {
    DriveApp.getFileById(id).setTrashed(true);
  } catch (_e) {
    // ignore
  }
}

function readModelsWritePayloadDrive_(storageKey, version, payloadText) {
  var folder = readModelsDriveParentFolder_();
  var name = 'read-model-' + readModelsSafeFileSegment_(storageKey) + '-' + text_(version) + '.json';
  var file = folder.createFile(name, payloadText, MimeType.PLAIN_TEXT);
  file.setDescription('read_model_payload:' + text_(storageKey));
  return file.getId();
}

function readModelsLoadPayloadFromDrive_(fileId) {
  var file = DriveApp.getFileById(text_(fileId));
  return file.getBlob().getDataAsString();
}

function ensureReadModelsSheet_() {
  var ss = getSpreadsheet_();
  var name = readModelSheetName_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);

  var meta = getSheetMeta_(sheet);
  var headerScanCols = Math.max(meta.lastCol || 0, READ_MODEL_HEADERS_.length);
  var rawHeaders = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, headerScanCols).getValues()[0].map(text_);
  var isLegacy = rawHeaders.indexOf('payload_json') >= 0 || rawHeaders.indexOf('rows_json') >= 0;
  var dataStart = getDataStartRow_();
  if (isLegacy) {
    var lr = sheet.getLastRow();
    if (lr >= dataStart) {
      sheet.deleteRows(dataStart, lr - dataStart + 1);
    }
  }

  sheet.getRange(CONFIG.HEADER_ROW, 1, 1, READ_MODEL_HEADERS_.length).setValues([READ_MODEL_HEADERS_]);
  while (sheet.getLastColumn() > READ_MODEL_HEADERS_.length) {
    sheet.deleteColumn(sheet.getLastColumn());
  }
  invalidateReadRowsCache_(name);
  return sheet;
}

function findReadModelDataRowNum_(key) {
  var k = text_(key);
  if (!k) return -1;
  ensureReadModelsSheet_();
  var sheet = getSpreadsheet_().getSheetByName(readModelSheetName_());
  var dataStart = getDataStartRow_();
  var lastRow = sheet.getLastRow();
  if (lastRow < dataStart) return -1;
  var keys = sheet.getRange(dataStart, 1, lastRow - dataStart + 1, 1).getValues();
  for (var i = 0; i < keys.length; i++) {
    if (text_(keys[i][0]) === k) return dataStart + i;
  }
  return -1;
}

function readReadModelMetadataAtRow_(rowNum) {
  var sheet = getSpreadsheet_().getSheetByName(readModelSheetName_());
  var vals = sheet.getRange(rowNum, 1, 1, READ_MODEL_HEADERS_.length).getValues()[0];
  var o = {};
  for (var i = 0; i < READ_MODEL_HEADERS_.length; i++) {
    o[READ_MODEL_HEADERS_[i]] = vals[i];
  }
  return o;
}

function writeReadModelFullMetadataRow_(rowNum, rowObj) {
  var sheet = getSpreadsheet_().getSheetByName(readModelSheetName_());
  var row = READ_MODEL_HEADERS_.map(function(h) {
    return Object.prototype.hasOwnProperty.call(rowObj, h) ? rowObj[h] : '';
  });
  sheet.getRange(rowNum, 1, 1, READ_MODEL_HEADERS_.length).setValues([row]);
  invalidateReadRowsCache_(readModelSheetName_());
}

function appendReadModelFullRow_(rowObj) {
  var sheet = getSpreadsheet_().getSheetByName(readModelSheetName_());
  var row = READ_MODEL_HEADERS_.map(function(h) {
    return Object.prototype.hasOwnProperty.call(rowObj, h) ? rowObj[h] : '';
  });
  sheet.appendRow(row);
  invalidateReadRowsCache_(readModelSheetName_());
}

function patchReadModelRowCells_(rowNum, patch) {
  var sheet = getSpreadsheet_().getSheetByName(readModelSheetName_());
  var headers = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, READ_MODEL_HEADERS_.length).getValues()[0].map(text_);
  Object.keys(patch || {}).forEach(function(field) {
    var col = headers.indexOf(text_(field));
    if (col < 0) return;
    sheet.getRange(rowNum, col + 1).setValue(patch[field]);
  });
  invalidateReadRowsCache_(readModelSheetName_());
}

function upsertReadModelMetadataRow_(rowObj) {
  ensureReadModelsSheet_();
  var key = text_(rowObj.key);
  if (!key) throw new Error('read model key is required');
  var rowNum = findReadModelDataRowNum_(key);
  if (rowNum < 0) {
    appendReadModelFullRow_(rowObj);
    return;
  }
  var cur = readReadModelMetadataAtRow_(rowNum);
  for (var i = 0; i < READ_MODEL_HEADERS_.length; i++) {
    var h = READ_MODEL_HEADERS_[i];
    if (Object.prototype.hasOwnProperty.call(rowObj, h)) cur[h] = rowObj[h];
  }
  writeReadModelFullMetadataRow_(rowNum, cur);
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

/**
 * מעדכן רק status / updated_at / last_error — לא נוגע ב-storage_ref ובגוף ה-JSON.
 */
function markReadModelStatus_(key, status, message) {
  ensureReadModelsSheet_();
  var rowNum = findReadModelDataRowNum_(key);
  var nowIso = new Date().toISOString();
  var st = text_(status || 'stale');
  var err = message === undefined || message === null ? '' : text_(message);
  if (rowNum < 0) {
    appendReadModelFullRow_({
      key: key,
      updated_at: nowIso,
      version: String(new Date().getTime()),
      hash: '',
      source_updated_at: '',
      status: st,
      duration_ms: '',
      rows_count: '0',
      payload_size: '0',
      last_error: err,
      storage_type: '',
      storage_ref: ''
    });
    return;
  }
  patchReadModelRowCells_(rowNum, { status: st, updated_at: nowIso, last_error: err });
}

function payloadRowsCount_(payload) {
  if (!payload || typeof payload !== 'object') return 0;
  if (Array.isArray(payload.rows)) return payload.rows.length;
  if (Array.isArray(payload.cells)) return payload.cells.length;
  if (Array.isArray(payload.days)) return payload.days.length;
  return 0;
}

/**
 * שומר JSON ב-Drive בלבד (גם payload קטן — שיטה אחידה).
 * אם payloadText.length > READ_MODEL_LEGACY_INLINE_MAX_CHARS_ — בכל מקרה לא נכתב לתא.
 */
function persistReadModelPayload_(storageKey, payload, sourceUpdatedAt, durationMs) {
  var nowIso = new Date().toISOString();
  var version = String(new Date().getTime());
  var hash = computeReadModelHash_(payload);
  var payloadText = JSON.stringify(payload || {});
  var prev = readModelRowByKey_(storageKey);
  var oldRef = prev && text_(prev.storage_ref);
  if (oldRef) readModelsTrashDriveFile_(oldRef);
  var fileId = readModelsWritePayloadDrive_(storageKey, version, payloadText);
  var dm = durationMs === undefined || durationMs === null ? '' : String(durationMs);
  upsertReadModelMetadataRow_({
    key: storageKey,
    updated_at: nowIso,
    version: version,
    hash: hash,
    source_updated_at: text_(sourceUpdatedAt || ''),
    status: 'fresh',
    duration_ms: dm,
    rows_count: String(payloadRowsCount_(payload)),
    payload_size: String(payloadText.length),
    last_error: '',
    storage_type: READ_MODEL_STORAGE_DRIVE_,
    storage_ref: fileId
  });
}

function readReadModelLegacyPayloadCellIfSmall_(rowNum) {
  var sheet = getSpreadsheet_().getSheetByName(readModelSheetName_());
  var lc = sheet.getLastColumn();
  if (!lc || rowNum < getDataStartRow_()) return null;
  var headers = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, lc).getValues()[0].map(text_);
  var idx = headers.indexOf('payload_json');
  if (idx < 0) return null;
  var raw = sheet.getRange(rowNum, idx + 1).getValue();
  var s = String(raw || '');
  if (!s || s.length > READ_MODEL_LEGACY_INLINE_MAX_CHARS_) return null;
  return parseReadModelJson_(s, null);
}

function refreshSingleReadModel_(logicalKey, params, builder) {
  var storageKey = buildReadModelStorageKey_(logicalKey, params || {});
  var started = perfNowMs_();
  markReadModelStatus_(storageKey, 'rebuilding', '');
  try {
    var payload = builder(params || {});
    var nowIso = new Date().toISOString();
    persistReadModelPayload_(storageKey, payload, nowIso, Math.max(0, perfNowMs_() - started));
    var done = readModelRowByKey_(storageKey) || {};
    return { key: storageKey, status: 'fresh', hash: text_(done.hash), version: text_(done.version) };
  } catch (e) {
    upsertReadModelMetadataRow_({
      key: storageKey,
      updated_at: new Date().toISOString(),
      version: String(new Date().getTime()),
      hash: '',
      source_updated_at: '',
      status: 'failed',
      duration_ms: String(Math.max(0, perfNowMs_() - started)),
      rows_count: '0',
      payload_size: '0',
      last_error: text_(e && e.message ? e.message : String(e)),
      storage_type: '',
      storage_ref: ''
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
  Object.keys(map).forEach(function(mkey) {
    var r = map[mkey] || {};
    out[mkey] = {
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
    upsertReadModelMetadataRow_({
      key: storageKey,
      updated_at: new Date().toISOString(),
      version: String(new Date().getTime()),
      hash: '',
      source_updated_at: '',
      status: 'stale',
      duration_ms: '',
      rows_count: '0',
      payload_size: '0',
      last_error: text_(reason || 'marked_stale'),
      storage_type: '',
      storage_ref: ''
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
  var warnings = [];

  if (row && text_(row.status) === 'fresh') {
    var data = null;
    if (text_(row.storage_type) === READ_MODEL_STORAGE_DRIVE_ && text_(row.storage_ref)) {
      try {
        var raw = readModelsLoadPayloadFromDrive_(text_(row.storage_ref));
        data = parseReadModelJson_(raw, null);
      } catch (e) {
        warnings.push('read_model_storage_read_failed: ' + text_(e && e.message ? e.message : String(e)));
      }
    }
    if (data === null) {
      var rowNum = findReadModelDataRowNum_(storageKey);
      if (rowNum > 0) {
        var legacy = readReadModelLegacyPayloadCellIfSmall_(rowNum);
        if (legacy !== null && typeof legacy === 'object') {
          data = legacy;
          if (!warnings.length) warnings.push('read_model_legacy_inline_payload');
        }
      }
    }
    if (data !== null) {
      return {
        key: key,
        cache_key: storageKey,
        version: text_(row.version),
        hash: text_(row.hash),
        updated_at: text_(row.updated_at),
        status: text_(row.status),
        data: data,
        warning: warnings.length ? warnings.join(' | ') : undefined
      };
    }
    if (warnings.length) warnings.push('read_model_fallback_rebuild');
  }

  if (row) {
    throw new Error('read_model_not_fresh');
  }
  throw new Error('read_model_missing');
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
      last_error: text_(row.last_error),
      storage_type: text_(row.storage_type),
      storage_ref: text_(row.storage_ref)
    };
  });
}
