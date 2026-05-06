var READ_MODEL_ADMIN_USER_ = { user_id: 'read_model_refresh', display_role: 'admin' };
var READ_MODEL_NO_FINANCE_USER_ = { user_id: 'read_model_refresh_nf', display_role: 'authorized_user' };
var READ_MODEL_SHEET_FALLBACK_ = 'read_models';

/**
 * Metadata בלבד בגיליון — ללא payload_json / rows_json (מגבלת 50,000 תווים לתא).
 * גוף ה-JSON נשמר ב-Drive; storage_ref = מזהה קובץ.
 */
function readModelHeaders_() { return getSystemSheetSpec_('read_models').headers.slice(); }

/** JSON מלא נשמר ב-Drive בלבד; לא בתא. */
var READ_MODEL_STORAGE_DRIVE_ = 'drive';

/** מקסימום תווים לקריאת payload ישן מתא (אם נשאר עמודה payload_json אחרי מיגרציה חלקית). */
var READ_MODEL_LEGACY_INLINE_MAX_CHARS_ = 40000;

/**
 * Logging + perf custom fields when persisted read model cannot serve the request
 * and the router falls back to legacy heavy handlers (activities/week/month/...).
 */
function noteReadModelServerLegacy_(action, reason, detail) {
  var act = text_(action);
  var rs = text_(reason);
  try {
    console.warn('[read_model][server] legacy heavy handler', JSON.stringify({
      screen_action: act,
      reason: rs,
      detail: detail || null
    }));
  } catch (_e) {}
  try {
    setRequestPerfField_('read_model_legacy_fallback', true);
    setRequestPerfField_('read_model_legacy_reason', rs);
  } catch (_e2) {}
}

function noteReadModelServerLegacyReturn_(action, reason, detail) {
  noteReadModelServerLegacy_(action, reason, detail);
  return null;
}

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
  var headerScanCols = Math.max(meta.lastCol || 0, readModelHeaders_().length);
  var rawHeaders = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, headerScanCols).getValues()[0].map(text_);
  var isLegacy = rawHeaders.indexOf('payload_json') >= 0 || rawHeaders.indexOf('rows_json') >= 0;
  var dataStart = getDataStartRow_();
  if (isLegacy) {
    var lr = sheet.getLastRow();
    if (lr >= dataStart) {
      sheet.deleteRows(dataStart, lr - dataStart + 1);
    }
  }

  sheet.getRange(CONFIG.HEADER_ROW, 1, 1, readModelHeaders_().length).setValues([readModelHeaders_()]);
  while (sheet.getLastColumn() > readModelHeaders_().length) {
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
  var vals = sheet.getRange(rowNum, 1, 1, readModelHeaders_().length).getValues()[0];
  var o = {};
  for (var i = 0; i < readModelHeaders_().length; i++) {
    o[readModelHeaders_()[i]] = vals[i];
  }
  return o;
}

function writeReadModelFullMetadataRow_(rowNum, rowObj) {
  var sheet = getSpreadsheet_().getSheetByName(readModelSheetName_());
  var row = readModelHeaders_().map(function(h) {
    return Object.prototype.hasOwnProperty.call(rowObj, h) ? rowObj[h] : '';
  });
  sheet.getRange(rowNum, 1, 1, readModelHeaders_().length).setValues([row]);
  invalidateReadRowsCache_(readModelSheetName_());
}

function appendReadModelFullRow_(rowObj) {
  var sheet = getSpreadsheet_().getSheetByName(readModelSheetName_());
  var row = readModelHeaders_().map(function(h) {
    return Object.prototype.hasOwnProperty.call(rowObj, h) ? rowObj[h] : '';
  });
  sheet.appendRow(row);
  invalidateReadRowsCache_(readModelSheetName_());
}

function patchReadModelRowCells_(rowNum, patch) {
  var sheet = getSpreadsheet_().getSheetByName(readModelSheetName_());
  var headers = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, readModelHeaders_().length).getValues()[0].map(text_);
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
  for (var i = 0; i < readModelHeaders_().length; i++) {
    var h = readModelHeaders_()[i];
    if (Object.prototype.hasOwnProperty.call(rowObj, h)) cur[h] = rowObj[h];
  }
  writeReadModelFullMetadataRow_(rowNum, cur);
}

function readModelRows_() {
  ensureReadModelsSheet_();
  try {
    return readRowsProjected_(readModelSheetName_(), readModelHeaders_());
  } catch (_e) {
    return [];
  }
}

/**
 * Fast read for manifest requests only — skips ensureReadModelsSheet_() to
 * avoid the costly header-rewrite that ensureReadModelsSheet_ performs on
 * every call (1–3 s per write to Google Sheets).
 * The read_models sheet is always present in production; errors return [].
 */
function readModelRowsFast_() {
  try {
    return readRowsProjected_(readModelSheetName_(), readModelHeaders_());
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
    return actionDashboardSheet_(READ_MODEL_NO_FINANCE_USER_, {});
  });
}

function refreshActivitiesReadModel_() {
  return refreshSingleReadModel_('activities', {}, function() {
    return actionActivitiesLegacy_(READ_MODEL_ADMIN_USER_, { activity_type: 'all' });
  });
}

function refreshWeekReadModel_() {
  return refreshWeekReadModelForOffset_(0);
}

function refreshWeekReadModelForOffset_(offset) {
  var wo = parseInt(offset, 10) || 0;
  return refreshSingleReadModel_('week', { week_offset: wo }, function() {
    return actionWeek_(READ_MODEL_ADMIN_USER_, {
      week_offset: wo,
      allow_foreground_rebuild: 'yes'
    });
  });
}

function refreshMonthReadModel_() {
  var ym = formatDate_(new Date()).slice(0, 7);
  return refreshMonthReadModelForYm_(ym);
}

function refreshMonthReadModelForYm_(ym) {
  var targetYm = text_(ym).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(targetYm)) {
    targetYm = formatDate_(new Date()).slice(0, 7);
  }
  return refreshSingleReadModel_('month', { ym: targetYm }, function() {
    return actionMonth_(READ_MODEL_ADMIN_USER_, { ym: targetYm });
  });
}

function shiftYm_(ym, deltaMonths) {
  var base = text_(ym);
  if (!/^\d{4}-\d{2}$/.test(base)) base = formatDate_(new Date()).slice(0, 7);
  var y = parseInt(base.slice(0, 4), 10);
  var m = parseInt(base.slice(5, 7), 10);
  var d = new Date(y, m - 1, 1);
  d.setMonth(d.getMonth() + (parseInt(deltaMonths, 10) || 0));
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
}

function refreshExceptionsReadModel_() {
  var month = formatDate_(new Date()).slice(0, 7);
  return refreshExceptionsReadModelForYm_(month);
}

function refreshExceptionsReadModelForYm_(ym) {
  var targetYm = text_(ym).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(targetYm)) {
    targetYm = formatDate_(new Date()).slice(0, 7);
  }
  return refreshSingleReadModel_('exceptions', { month: targetYm }, function() {
    return actionExceptions_(READ_MODEL_ADMIN_USER_, { month: targetYm });
  });
}

function refreshFinanceReadModel_() {
  return { key: 'finance', status: 'disabled', skipped: true };
}

function refreshEndDatesReadModel_() {
  return refreshSingleReadModel_('end-dates', {}, function() {
    return buildEndDatesPayload_();
  });
}

function refreshAllReadModels_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) return { skipped: true, reason: 'read_models_refresh_already_running' };
  var hadCache = !!__rqCache_;
  if (!hadCache) beginRequestCache_();
  var batchStarted = perfNowMs_();
  try {
    try {
      console.info('[read_models] refreshAllReadModels_version', 'adjacent-week-month-v2');
    } catch (_vlogErr) {}
    var results = [];
    results.push(refreshDashboardReadModel_());
    results.push(refreshActivitiesReadModel_());
    results.push(refreshWeekReadModelForOffset_(-1));
    results.push(refreshWeekReadModelForOffset_(0));
    results.push(refreshWeekReadModelForOffset_(1));
    var curYm = formatDate_(new Date()).slice(0, 7);
    results.push(refreshMonthReadModelForYm_(shiftYm_(curYm, -1)));
    results.push(refreshMonthReadModelForYm_(curYm));
    results.push(refreshMonthReadModelForYm_(shiftYm_(curYm, 1)));
    results.push(refreshExceptionsReadModelForYm_(shiftYm_(curYm, -1)));
    results.push(refreshExceptionsReadModelForYm_(curYm));
    results.push(refreshExceptionsReadModelForYm_(shiftYm_(curYm, 1)));
    results.push(refreshEndDatesReadModel_());
    bumpDataViewsCacheVersion_();
    var durationMs = Math.max(0, perfNowMs_() - batchStarted);
    var failures = results.filter(function(r) {
      return r && r.status === 'failed';
    });
    var failureSummaries = failures.map(function(f) {
      return { key: text_(f.key), error: text_(f.error || '') };
    });
    var logLine = {
      event: 'read_models_refresh_all',
      duration_ms: durationMs,
      model_count: results.length,
      failure_count: failures.length,
      statuses: results.map(function(r) {
        return { key: text_(r && r.key), status: text_(r && r.status) };
      })
    };
    try {
      console.info('[read_models]', JSON.stringify(logLine));
    } catch (_logErr) {}
    if (failures.length) {
      try {
        console.warn('[read_models] refresh failures', JSON.stringify(failureSummaries));
      } catch (_w) {}
    }
    var refreshedAtIso = new Date().toISOString();
    try {
      opsHealthRecordReadModelBatchComplete_(refreshedAtIso, durationMs, failures.length);
    } catch (_opsErr) {}
    return {
      ok: true,
      refreshed_at: refreshedAtIso,
      duration_ms: durationMs,
      failure_count: failures.length,
      failures: failureSummaries,
      results: results
    };
  } finally {
    if (!hadCache) __rqCache_ = null;
    lock.releaseLock();
  }
}

function normalizeReadModelManifest_(rows) {
  var nowMonth = formatDate_(new Date()).slice(0, 7);
  var prevMonth = shiftYm_(nowMonth, -1);
  var nextMonth = shiftYm_(nowMonth, 1);
  var storageKeys = [
    'dashboard',
    'activities',
    'week?week_offset=-1',
    'week?week_offset=0',
    'week?week_offset=1',
    'month?ym=' + prevMonth,
    'month?ym=' + nowMonth,
    'month?ym=' + nextMonth,
    'exceptions?month=' + prevMonth,
    'exceptions?month=' + nowMonth,
    'exceptions?month=' + nextMonth,
    'end-dates'
  ];
  var rowMap = {};
  (rows || []).forEach(function(r) {
    if (r && r.key) rowMap[text_(r.key)] = r;
  });
  var out = {};
  storageKeys.forEach(function(storageKey) {
    var r = rowMap[storageKey] || {};
    out[storageKey] = {
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
  // Use fast read path — no sheet write, no legacy-column migration.
  var rows = readModelRowsFast_();
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
  assertMutationAllowedInCurrentRequest_('markReadModelsDirtyByMutation');
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
  } else if (action === 'savePermission') {
    refreshDashboardReadModel_();
  }
}

function resolveReadModelBuilder_(key, user, params) {
  if (key === 'dashboard') return function() { return actionDashboardSheet_(user, params || {}); };
  if (key === 'activities') return function() { return actionActivitiesSnapshotFirst_(user, params || { activity_type: 'all' }); };
  if (key === 'week') return function() { return actionWeek_(user, params || { week_offset: 0 }); };
  if (key === 'month') return function() { return actionMonth_(user, params || {}); };
  if (key === 'exceptions') return function() { return actionExceptions_(user, params || {}); };
  if (key === 'end-dates') return function() { return actionEndDates_(user); };
  if (key === 'instructors') return function() { return actionInstructors_(user); };
  return null;
}

/**
 * Loads persisted read-model JSON when the row is fresh (Drive or legacy cell).
 * No auth check — caller must enforce route access.
 */
function readModelLoadFreshPayloadData_(storageKey) {
  var sk = text_(storageKey);
  if (!sk) return null;
  var row = readModelRowByKey_(sk);
  if (!row || text_(row.status) !== 'fresh') return null;
  var data = null;
  if (text_(row.storage_type) === READ_MODEL_STORAGE_DRIVE_ && text_(row.storage_ref)) {
    try {
      var raw = readModelsLoadPayloadFromDrive_(text_(row.storage_ref));
      data = parseReadModelJson_(raw, null);
    } catch (_e) {
      return null;
    }
  }
  if (data === null) {
    var rowNum = findReadModelDataRowNum_(sk);
    if (rowNum > 0) {
      var legacy = readReadModelLegacyPayloadCellIfSmall_(rowNum);
      if (legacy !== null && typeof legacy === 'object') data = legacy;
    }
  }
  if (data === null || typeof data !== 'object') return null;
  return data;
}

/**
 * Route → canonical read model (refresh keys in refreshAllReadModels_):
 *   activities  → activities        (activities_by_month snapshot, key "activities")
 *   week        → week?week_offset=0 (week_current)
 *   month       → month?ym=YYYY-MM   (month_YYYY-MM, current month only from store)
 *   exceptions  → exceptions?month=… (exceptions_by_month, current month only)
 *   finance     → finance?month=…&tab=active (finance_by_month, current month + active tab only)
 */
function materializeScreenDataFromReadModel_(action, user, payload) {
  var act = text_(action);
  var curYm = formatDate_(new Date()).slice(0, 7);

  if (act === 'activities') {
    if (payload && payload.force_full === true) {
      return noteReadModelServerLegacyReturn_(act, 'activities_force_full', {});
    }
    var aData = readModelLoadFreshPayloadData_(buildReadModelStorageKey_('activities', {}));
    if (aData === null) {
      return noteReadModelServerLegacyReturn_(act, 'activities_no_fresh_read_model_payload', {});
    }
    try {
      var aOut = JSON.parse(JSON.stringify(aData));
      aOut.rows = filterActivitiesSnapshotRows_(aOut.rows || [], payload || {});
      setRequestPerfField_('read_model_route', 'activities_by_month');
      return aOut;
    } catch (_e) {
      return noteReadModelServerLegacyReturn_(act, 'activities_transform_error', {
        message: _e && _e.message ? String(_e.message) : 'error'
      });
    }
  }

  if (act === 'week') {
    var wo = parseInt((payload && payload.week_offset) || 0, 10) || 0;
    if (wo < -1 || wo > 1) {
      return noteReadModelServerLegacyReturn_(act, 'week_outside_supported_offsets', { week_offset: wo });
    }
    var wData = readModelLoadFreshPayloadData_(buildReadModelStorageKey_('week', { week_offset: wo }));
    if (wData === null) {
      return noteReadModelServerLegacyReturn_(act, 'week_no_fresh_read_model_payload', { week_offset: wo });
    }
    try {
      var wOut = JSON.parse(JSON.stringify(wData));
      if (user && user.display_role === 'instructor') {
        wOut = filterWeekPayloadForInstructor_(wOut, text_(user.emp_id || user.user_id));
      }
      setRequestPerfField_('read_model_route', 'week_current');
      return wOut;
    } catch (_e2) {
      return noteReadModelServerLegacyReturn_(act, 'week_transform_error', {
        message: _e2 && _e2.message ? String(_e2.message) : 'error'
      });
    }
  }

  if (act === 'month') {
    var ym = text_((payload && payload.ym) || (payload && payload.month) || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) ym = curYm;
    var prevYm = shiftYm_(curYm, -1);
    var nextYm = shiftYm_(curYm, 1);
    if (ym !== curYm && ym !== prevYm && ym !== nextYm) {
      return noteReadModelServerLegacyReturn_(act, 'month_outside_supported_period', { ym: ym, current_ym: curYm });
    }
    var mData = readModelLoadFreshPayloadData_(buildReadModelStorageKey_('month', { ym: ym }));
    if (mData === null) {
      return noteReadModelServerLegacyReturn_(act, 'month_no_fresh_read_model_payload', { ym: ym });
    }
    try {
      var mOut = JSON.parse(JSON.stringify(mData));
      if (user && user.display_role === 'instructor') {
        mOut = filterMonthPayloadForInstructor_(mOut, text_(user.emp_id || user.user_id));
      }
      setRequestPerfField_('read_model_route', 'month_YYYY-MM');
      return mOut;
    } catch (_e3) {
      return noteReadModelServerLegacyReturn_(act, 'month_transform_error', {
        message: _e3 && _e3.message ? String(_e3.message) : 'error'
      });
    }
  }

  if (act === 'exceptions') {
    if (yesNo_(payload && payload.debug) === 'yes') {
      return noteReadModelServerLegacyReturn_(act, 'exceptions_debug_enabled', {});
    }
    var exYm = text_((payload && payload.month) || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(exYm)) {
      return noteReadModelServerLegacyReturn_(act, 'exceptions_month_not_current', {
        month: exYm,
        current_ym: curYm
      });
    }
    var exPrevYm = shiftYm_(curYm, -1);
    var exNextYm = shiftYm_(curYm, 1);
    var exInWindow = (exYm === curYm || exYm === exPrevYm || exYm === exNextYm);
    if (!exInWindow) {
      return noteReadModelServerLegacyReturn_(act, 'exceptions_month_outside_window', {
        month: exYm,
        current_ym: curYm
      });
    }
    var exData = readModelLoadFreshPayloadData_(buildReadModelStorageKey_('exceptions', { month: exYm }));
    if (exData === null) {
      return noteReadModelServerLegacyReturn_(act, 'exceptions_no_fresh_read_model_payload', { month: exYm });
    }
    try {
      setRequestPerfField_('read_model_route', 'exceptions_by_month');
      return JSON.parse(JSON.stringify(exData));
    } catch (_e4) {
      return noteReadModelServerLegacyReturn_(act, 'exceptions_transform_error', {
        message: _e4 && _e4.message ? String(_e4.message) : 'error'
      });
    }
  }



  return null;
}

/**
 * Keys where the stored payload is always under the bare key (no params).
 * Filtering/transformation is applied after loading.
 */
var READ_MODEL_CANONICAL_KEYS_ = { 'activities': true, 'dashboard': true, 'end-dates': true, 'instructors': true };

function actionReadModelGet_(user, payload) {
  requireAnyRole_(user, ['admin', 'operation_manager', 'authorized_user', 'instructor']);
  var key = text_(payload && payload.key);
  if (!key) throw new Error('read model key is required');
  var params = parseJsonObject_((payload && payload.params) || {}, {});
  // For canonical (param-agnostic) keys the payload is always stored under the bare key.
  // Using params in the storage key would yield a key that never exists.
  var storageKey = READ_MODEL_CANONICAL_KEYS_[key]
    ? key
    : buildReadModelStorageKey_(key, params);
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
      data = applyReadModelParamFilter_(key, data, params);
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
    warnings.push('read_model_drive_and_inline_failed');
  }

  var builder = resolveReadModelBuilder_(key, user, params);
  if (builder) {
    try {
      var rebuilt = builder();
      if (rebuilt && typeof rebuilt === 'object') {
        warnings.push('read_model_rebuilt_inline');
        try {
          persistReadModelPayload_(storageKey, rebuilt, new Date().toISOString(), null);
        } catch (_persistErr) {
          warnings.push('read_model_persist_failed: ' + text_(_persistErr && _persistErr.message ? _persistErr.message : String(_persistErr)));
        }
        var nowVersion = String(new Date().getTime());
        var rebuiltFiltered = applyReadModelParamFilter_(key, rebuilt, params);
        return {
          key: key,
          cache_key: storageKey,
          version: nowVersion,
          hash: '',
          updated_at: new Date().toISOString(),
          status: 'rebuilt',
          data: rebuiltFiltered,
          warning: warnings.join(' | ')
        };
      }
    } catch (_rebuildErr) {
      warnings.push('read_model_rebuild_failed: ' + text_(_rebuildErr && _rebuildErr.message ? _rebuildErr.message : String(_rebuildErr)));
    }
  }

  if (row) {
    throw new Error('read_model_not_fresh');
  }
  throw new Error('read_model_missing');
}

/**
 * Applies server-side param filtering to a freshly-loaded read model payload.
 * Only 'activities' needs filtering; other canonical keys are returned as-is.
 */
function applyReadModelParamFilter_(key, data, params) {
  if (key !== 'activities' || !data || typeof data !== 'object') return data;
  if (!params || !Object.keys(params).length) return data;
  try {
    var out = JSON.parse(JSON.stringify(data));
    out.rows = filterActivitiesSnapshotRows_(out.rows || [], params);
    return out;
  } catch (_e) {
    return data;
  }
}

/**
 * הגדרת טריגר כל 30 דקות ל-refreshAllReadModels_.
 * יש להריץ פעם אחת בלבד דרך עורך Apps Script (Run → setupReadModelRefreshTrigger).
 * הפונקציה מוחקת טריגרים קיימים של refreshAllReadModels_ לפני יצירת חדש.
 */
function setupReadModelRefreshTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'refreshAllReadModels_') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('refreshAllReadModels_')
    .timeBased()
    .everyMinutes(30)
    .create();
  try {
    console.info('[read_models] setupReadModelRefreshTrigger: טריגר הוגדר — כל 30 דקות');
  } catch (_e) {}
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
