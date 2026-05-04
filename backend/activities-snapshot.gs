/**
 * activities-snapshot.gs
 *
 * Snapshot-first read path for the Activities screen.
 * Source of truth remains data_short/data_long/activity_meetings.
 * The snapshot stores the already mapped list payload so normal navigation
 * does not rebuild all activities, notes and meetings on every request.
 */

var ACTIVITIES_SNAPSHOT_SHEET_FALLBACK_ = 'activities_snapshot';
function activitiesSnapshotHeaders_() { return getSystemSheetSpec_('activities_snapshot').headers.slice(); }
function activitiesSnapshotLabelsHe_() { return getSystemSheetSpec_('activities_snapshot').hebrewLabels.slice(); }

/**
 * Google Sheets hard limit: 50,000 chars per cell.
 * safeCellValue_ caps at 45,000 for headroom and appends a truncation marker.
 * NOTE: the result may not be valid JSON — use safeJsonArrayCell_ for arrays.
 *
 * @param {*}      value     value to serialise
 * @param {string} fieldName descriptive label used in log messages
 * @param {number} [maxLength=45000]
 * @returns {string}
 */
function safeCellValue_(value, fieldName, maxLength) {
  maxLength = maxLength || 45000;
  var text = (value === null || value === undefined)
    ? ''
    : (typeof value === 'string' ? value : JSON.stringify(value));
  if (text.length <= maxLength) return text;
  Logger.log(
    '[safeCellValue_] field="' + (fieldName || 'unknown') + '"' +
    ' truncated from ' + text.length + ' chars to ' + maxLength
  );
  return text.slice(0, maxLength) + '\n...[TRUNCATED: original length ' + text.length + ' chars]';
}

/**
 * Safely serialise a JSON array for a single Sheets cell.
 * Uses binary search to keep the maximum number of whole items that fit within
 * maxLength, so the result is always valid JSON (never a broken string).
 * Logs truncation details when items are dropped.
 *
 * @param {Array}  arr       array to serialise
 * @param {string} fieldName descriptive label used in log messages
 * @param {number} [maxLength=45000]
 * @returns {string} valid JSON array string
 */
function safeJsonArrayCell_(arr, fieldName, maxLength) {
  maxLength = maxLength || 45000;
  if (!Array.isArray(arr) || arr.length === 0) return { json: '[]', truncated: false, original_rows_count: 0, kept_rows_count: 0 };
  var full = JSON.stringify(arr);
  if (full.length <= maxLength) return { json: full, truncated: false, original_rows_count: arr.length, kept_rows_count: arr.length };
  var lo = 0;
  var hi = arr.length;
  while (lo < hi) {
    var mid = Math.floor((lo + hi + 1) / 2);
    if (JSON.stringify(arr.slice(0, mid)).length <= maxLength) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  var kept = arr.slice(0, lo);
  Logger.log(
    '[safeJsonArrayCell_] field="' + (fieldName || 'unknown') + '"' +
    ' original=' + arr.length + ' rows (' + full.length + ' chars)' +
    ' kept=' + kept.length + ' rows (' + JSON.stringify(kept).length + ' chars)' +
    ' maxLength=' + maxLength
  );
  return { json: JSON.stringify(kept), truncated: true, original_rows_count: arr.length, kept_rows_count: kept.length };
}

function activitiesSnapshotSheetName_() {
  return (CONFIG.SHEETS && CONFIG.SHEETS.ACTIVITIES_SNAPSHOT) || ACTIVITIES_SNAPSHOT_SHEET_FALLBACK_;
}

function canForceActivitiesFull_(user) {
  var role = text_(user && user.display_role);
  return role === 'admin' || role === 'operation_manager';
}

function ensureActivitiesSnapshotSheet_() {
  var ss = getSpreadsheet_();
  var sheetName = activitiesSnapshotSheetName_();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  sheet.getRange(CONFIG.HEADER_ROW, 1, 1, activitiesSnapshotHeaders_().length)
    .setValues([activitiesSnapshotHeaders_()]);
  var row2 = sheet.getRange(CONFIG.HEADER_ROW + 1, 1, 1, activitiesSnapshotHeaders_().length).getValues()[0];
  var row2IsEmpty = row2.every(function(v) { return text_(v) === ''; });
  if (row2IsEmpty) {
    sheet.getRange(CONFIG.HEADER_ROW + 1, 1, 1, activitiesSnapshotLabelsHe_().length)
      .setValues([activitiesSnapshotLabelsHe_()]);
  }
  invalidateReadRowsCache_(sheetName);
  return sheet;
}

function readActivitiesSnapshotRow_() {
  var sheetName = activitiesSnapshotSheetName_();
  try {
    var rows = readRowsProjected_(sheetName, activitiesSnapshotHeaders_());
    var row = rows.find(function(r) { return text_(r.snapshot_key) === 'all'; }) || null;
    if (!row) return null;
    row._rows_meta = parseActivitiesSnapshotJson_(row.rows_meta_json, {});
    return row;
  } catch (_err) {
    return null;
  }
}

function isActivitiesSnapshotTruncated_(snap) {
  var meta = (snap && snap._rows_meta) || parseActivitiesSnapshotJson_(snap && snap.rows_meta_json, {}) || {};
  if (yesNo_(meta.truncated || 'no') === 'yes') return true;
  var originalCount = parseInt(meta.original_rows_count, 10);
  var keptCount = parseInt(meta.kept_rows_count, 10);
  return originalCount > 0 && keptCount >= 0 && keptCount < originalCount;
}

function parseActivitiesSnapshotJson_(raw, fallback) {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw === 'object') return raw;
  var s = String(raw).trim();
  if (!s) return fallback;
  try {
    var parsed = JSON.parse(s);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch (_err) {
    return fallback;
  }
}

function normalizeActivitiesSnapshotRow_(row) {
  var src = row && typeof row === 'object' ? row : {};
  var normalized = {};
  Object.keys(src).forEach(function(key) { normalized[key] = src[key]; });
  var instructor1 = text_(src.instructor_name || src.Instructor || src.Employee || src.employee_name || src.employee);
  var instructor2 = text_(src.instructor_name_2 || src.Instructor2 || src.Employee2 || src.employee_name_2 || src.employee2_name || src.employee2 || src.employee_2 || src.instructor2);
  var emp1 = text_(src.emp_id || src.EmployeeID || src.employee_id || src.employeeId || src.empId);
  var emp2 = text_(src.emp_id_2 || src.EmployeeID2 || src.EmployeeID_2 || src.employee_id_2 || src.employee_id2 || src.employeeId2 || src.empId2);
  normalized.instructor_name = instructor1;
  normalized.instructor_name_2 = instructor2;
  normalized.emp_id = emp1;
  normalized.emp_id_2 = emp2;
  normalized.Employee = text_(src.Employee || src.employee || instructor1);
  normalized.Employee2 = text_(src.Employee2 || src.employee2 || instructor2);
  normalized.EmployeeID = text_(src.EmployeeID || src.employee_id || emp1);
  normalized.EmployeeID2 = text_(src.EmployeeID2 || src.EmployeeID_2 || src.employee_id_2 || emp2);
  if (!normalized.source_sheet) {
    var rowId = text_(src.RowID);
    normalized.source_sheet = rowId.indexOf('LONG-') === 0 ? configuredLongActivitiesSheet_() : configuredShortActivitiesSheet_();
  }
  return normalized;
}



function activitiesInstructorCoverageStats_(rows) {
  var list = Array.isArray(rows) ? rows : [];
  var total = list.length;
  var withInstructorName = 0;
  var withEmpId = 0;
  var missingInstructor = 0;
  list.forEach(function(row) {
    var hasName = !!(text_(row && row.instructor_name) || text_(row && row.instructor_name_2));
    var hasEmp = !!(text_(row && row.emp_id) || text_(row && row.emp_id_2));
    if (hasName) withInstructorName++;
    if (hasEmp) withEmpId++;
    if (!hasName && !hasEmp) missingInstructor++;
  });
  return {
    total: total,
    with_instructor_name: withInstructorName,
    with_emp_id: withEmpId,
    missing_instructor: missingInstructor
  };
}

function filterActivitiesSnapshotRows_(rows, payload) {
  var oneDayTypes = configuredOneDayActivityTypes_();
  var programTypes = configuredProgramActivityTypes_();
  var activityType = text_(payload.activity_type || payload.tab || 'all');
  var financeStatus = text_(payload.finance_status || '');
  var search = text_(payload.search || '').toLowerCase();
  var manager = text_(payload.manager || '');
  var family = text_(payload.family || '');
  var endingCurrentMonth = yesNo_(payload.ending_current_month || 'no') === 'yes';
  var monthFilter = text_(payload.month || formatDate_(new Date()).slice(0, 7));
  var hasMonthFilter = /^\d{4}-\d{2}$/.test(monthFilter);

  return (Array.isArray(rows) ? rows : []).filter(function(row) {
    if (text_(row.status) === 'סגור') return false;
    if (activityType && activityType !== 'all' && text_(row.activity_type) !== activityType) return false;
    if (financeStatus && text_(row.finance_status) !== financeStatus) return false;
    if (manager && text_(row.activity_manager) !== manager) return false;
    if (family === 'short' && oneDayTypes.indexOf(text_(row.activity_type)) < 0) return false;
    if (family === 'long' && programTypes.indexOf(text_(row.activity_type)) < 0) return false;
    if (endingCurrentMonth &&
      !(text_(row.activity_type) === 'course' && text_(row.end_date || '').slice(0, 7) === monthFilter)) return false;
    if (hasMonthFilter && !activityOverlapsYm_(row, monthFilter)) return false;
    if (search) {
      var hay = [
        row.RowID,
        row.activity_name,
        row.school,
        row.authority,
        row.activity_manager,
        row.emp_id,
        row.emp_id_2
      ].map(text_).join(' ').toLowerCase();
      if (hay.indexOf(search) < 0) return false;
    }
    return true;
  }).sort(function(a, b) {
    return text_(a.start_date).localeCompare(text_(b.start_date));
  });
}

function rowHasInstructorData_(row) {
  var hasName = !!(text_(row && row.instructor_name) || text_(row && row.instructor_name_2) || text_(row && row.Employee) || text_(row && row.Employee2));
  var hasEmp = !!(text_(row && row.emp_id) || text_(row && row.emp_id_2) || text_(row && row.EmployeeID) || text_(row && row.EmployeeID2));
  return hasName || hasEmp;
}

function mergeInstructorFieldsByRowId_(snapshotRows, legacyRows) {
  var snapRows = Array.isArray(snapshotRows) ? snapshotRows : [];
  var legacyMap = {};
  (Array.isArray(legacyRows) ? legacyRows : []).forEach(function(row) {
    legacyMap[text_(row && row.RowID)] = normalizeActivitiesSnapshotRow_(row);
  });
  var mergedCount = 0;
  var missingCount = 0;
  var out = snapRows.map(function(row) {
    var normalized = normalizeActivitiesSnapshotRow_(row);
    if (rowHasInstructorData_(normalized)) return normalized;
    missingCount += 1;
    var match = legacyMap[text_(normalized && normalized.RowID)];
    if (!match || !rowHasInstructorData_(match)) return normalized;
    mergedCount += 1;
    normalized.instructor_name = text_(match.instructor_name);
    normalized.instructor_name_2 = text_(match.instructor_name_2);
    normalized.emp_id = text_(match.emp_id);
    normalized.emp_id_2 = text_(match.emp_id_2);
    normalized.Employee = text_(match.Employee || match.instructor_name);
    normalized.Employee2 = text_(match.Employee2 || match.instructor_name_2);
    normalized.EmployeeID = text_(match.EmployeeID || match.emp_id);
    normalized.EmployeeID2 = text_(match.EmployeeID2 || match.emp_id_2);
    return normalized;
  });
  return {
    rows: out,
    missing_before: missingCount,
    merged: mergedCount,
    still_missing: Math.max(0, missingCount - mergedCount)
  };
}

function actionActivitiesLegacy_(user, payload) {
  return actionActivities_(user, payload);
}

function actionActivitiesSnapshotFirst_(user, payload) {
  requireAnyRole_(user, ['admin', 'operation_manager', 'authorized_user']);

  if (payload && payload.force_full === true && canForceActivitiesFull_(user)) {
    var forced = actionActivitiesLegacy_(user, payload || {});
    forced._is_snapshot = false;
    forced._activities_fallback_used = true;
    return forced;
  }

  var snap = readActivitiesSnapshotRow_();
  if (!snap) {
    var fallback = actionActivitiesLegacy_(user, payload || {});
    fallback._is_snapshot = false;
    fallback._activities_fallback_used = true;
    return fallback;
  }
  var counts = parseActivitiesSnapshotJson_(snap.activity_type_counts_json, {});
  var snapMeta = (snap && snap._rows_meta) || {};
  var driveFileId = text_(snapMeta.drive_file_id);
  var rows;
  if (driveFileId) {
    try {
      var driveRaw = readModelsLoadPayloadFromDrive_(driveFileId);
      rows = JSON.parse(driveRaw).map(normalizeActivitiesSnapshotRow_);
      Logger.log('[activities_snapshot] loaded ' + rows.length + ' rows from Drive file=' + driveFileId);
    } catch (_driveErr) {
      Logger.log('[activities_snapshot] Drive load failed, falling back to cell: ' + String(_driveErr));
      rows = null;
    }
  }
  if (!rows) {
    if (isActivitiesSnapshotTruncated_(snap)) {
      Logger.log('[activities_snapshot] truncated rows_json and no Drive file; fallback to legacy');
      var fullFallback = actionActivitiesLegacy_(user, payload || {});
      fullFallback._is_snapshot = false;
      fullFallback._activities_fallback_used = true;
      fullFallback._snapshot_truncated = true;
      return fullFallback;
    }
    rows = parseActivitiesSnapshotJson_(snap.rows_json, []).map(normalizeActivitiesSnapshotRow_);
  }
  Logger.log('[activities_snapshot] rows before filter=' + rows.length);
  var filtered = filterActivitiesSnapshotRows_(rows, payload || {});
  Logger.log('[activities_snapshot] rows after filter=' + filtered.length + ' month=' + text_((payload || {}).month || ''));
  Logger.log('[activities_snapshot] missing RowID rows=' + filtered.filter(function(row) { return !text_(row && row.RowID); }).length);
  var snapStats = activitiesInstructorCoverageStats_(filtered);

  var needsFallbackMerge = filtered.some(function(row) {
    return !rowHasInstructorData_(row);
  });
  var mergeReport = { missing_before: 0, merged: 0, still_missing: 0 };

  if (needsFallbackMerge) {
    var fallbackData = actionActivitiesLegacy_(user, payload || {});
    var fallbackRows = Array.isArray(fallbackData.rows) ? fallbackData.rows : [];
    var merged = mergeInstructorFieldsByRowId_(filtered, fallbackRows);
    filtered = merged.rows;
    mergeReport = {
      missing_before: merged.missing_before,
      merged: merged.merged,
      still_missing: merged.still_missing
    };
    var mergedStats = activitiesInstructorCoverageStats_(filtered);
    if (merged.merged > 0 || mergedStats.missing_instructor < snapStats.missing_instructor) {
      try { refreshActivitiesSnapshot_(); } catch (_refreshErrInstructorMerge) {}
    }
    snapStats = mergedStats;
  }

  return {
    activity_type_counts: counts,
    rows: filtered,
    can_add_activity: true,
    _is_snapshot: true,
    _activities_fallback_used: false,
    _snapshot_updated_at: text_(snap.updated_at),
    _snapshot_instructor_stats: { snapshot: snapStats, merge: mergeReport }
  };
}

function refreshActivitiesSnapshot_() {
  assertMutationAllowedInCurrentRequest_('refreshActivitiesSnapshot');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    return { skipped: true, reason: 'activities_snapshot_refresh_already_running' };
  }

  var hadCache = !!__rqCache_;
  if (!hadCache) beginRequestCache_();

  try {
    var payload = actionActivitiesLegacy_(SNAPSHOT_ADMIN_USER_, { activity_type: 'all' });
    Logger.log('[activities_snapshot] read rows data_short=' + text_(payload._data_short_rows_read) + ' data_long=' + text_(payload._data_long_rows_read));
    Logger.log('[activities_snapshot] payload rows before snapshot=' + (payload.rows || []).length);
    var sheet = ensureActivitiesSnapshotSheet_();
    var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
    var rowsCell = safeJsonArrayCell_(payload.rows || [], 'rows_json');
    var rowsMeta = {
      truncated: rowsCell.truncated ? 'yes' : 'no',
      original_rows_count: rowsCell.original_rows_count,
      kept_rows_count: rowsCell.kept_rows_count,
      drive_file_id: ''
    };

    var oldMeta = null;
    try {
      var oldSnap = readActivitiesSnapshotRow_();
      oldMeta = (oldSnap && oldSnap._rows_meta) || null;
    } catch (_readErr) {}

    try {
      var oldDriveFileId = oldMeta && text_(oldMeta.drive_file_id);
      if (oldDriveFileId) { try { readModelsTrashDriveFile_(oldDriveFileId); } catch (_trashErr) {} }
      var driveVersion = String(new Date().getTime());
      var driveName = 'activities-snapshot-rows-' + driveVersion + '.json';
      var folder = readModelsDriveParentFolder_();
      var driveFile = folder.createFile(driveName, JSON.stringify(payload.rows || []), MimeType.PLAIN_TEXT);
      driveFile.setDescription('activities_snapshot_rows:all');
      rowsMeta.drive_file_id = driveFile.getId();
      Logger.log('[activities_snapshot] rows written to Drive file=' + rowsMeta.drive_file_id + ' rows=' + (payload.rows || []).length);
    } catch (_driveWriteErr) {
      Logger.log('[activities_snapshot] Drive write failed: ' + String(_driveWriteErr));
    }

    Logger.log('[activities_snapshot] rows_json truncated=' + rowsMeta.truncated + ' original=' + rowsMeta.original_rows_count + ' kept=' + rowsMeta.kept_rows_count);
    var row = [
      'all',
      now,
      safeCellValue_(payload.activity_type_counts || {}, 'activity_type_counts_json'),
      rowsCell.json,
      safeCellValue_(rowsMeta, 'rows_meta_json')
    ];
    sheet.getRange(CONFIG.DATA_START_ROW, 1, 1, activitiesSnapshotHeaders_().length).setValues([row]);
    var lastRow = sheet.getLastRow();
    if (lastRow > CONFIG.DATA_START_ROW) {
      sheet.getRange(CONFIG.DATA_START_ROW + 1, 1, lastRow - CONFIG.DATA_START_ROW, activitiesSnapshotHeaders_().length).clearContent();
    }
    invalidateReadRowsCache_(activitiesSnapshotSheetName_());
    bumpDataViewsCacheVersion_();
    return {
      skipped: false,
      status: 'ok',
      rows: (payload.rows || []).length,
      updated_at: now
    };
  } finally {
    if (!hadCache) __rqCache_ = null;
    lock.releaseLock();
  }
}

/**
 * הגדרת טריגר כל 10 דקות ל-refreshActivitiesSnapshot_.
 * יש להריץ פעם אחת בלבד דרך עורך Apps Script (Run → setupActivitiesSnapshotTrigger).
 * הפונקציה מוחקת טריגרים קיימים של refreshActivitiesSnapshot_ לפני יצירת חדש.
 *
 * הערה: פונקציה זו נפרדת מ-setupReadModelRefreshTrigger (כל 30 דקות).
 * snapshot הפעילויות הוא קלט לבניית read_model — חייב להיות מעודכן לפני כל בנייה.
 * אין כפילות: snapshot = קריאה מ-Sheets ואחסון גולמי; read_model = payload מוכן ל-UI.
 */
function setupActivitiesSnapshotTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'refreshActivitiesSnapshot_') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('refreshActivitiesSnapshot_')
    .timeBased()
    .everyMinutes(10)
    .create();
  try {
    console.info('[activities_snapshot] setupActivitiesSnapshotTrigger: טריגר הוגדר — כל 10 דקות');
  } catch (_e) {}
}
