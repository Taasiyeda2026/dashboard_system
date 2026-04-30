/**
 * activities-snapshot.gs
 *
 * Snapshot-first read path for the Activities screen.
 * Source of truth remains data_short/data_long/activity_meetings.
 * The snapshot stores the already mapped list payload so normal navigation
 * does not rebuild all activities, notes and meetings on every request.
 */

var ACTIVITIES_SNAPSHOT_SHEET_FALLBACK_ = 'activities_snapshot';
var ACTIVITIES_SNAPSHOT_HEADERS_ = [
  'snapshot_key',
  'updated_at',
  'activity_type_counts_json',
  'rows_json'
];
var ACTIVITIES_SNAPSHOT_LABELS_HE_ = [
  'מפתח snapshot',
  'עודכן בתאריך',
  'ספירות לפי סוג פעילות',
  'שורות פעילות לתצוגה'
];

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
  sheet.getRange(CONFIG.HEADER_ROW, 1, 1, ACTIVITIES_SNAPSHOT_HEADERS_.length)
    .setValues([ACTIVITIES_SNAPSHOT_HEADERS_]);
  var row2 = sheet.getRange(CONFIG.HEADER_ROW + 1, 1, 1, ACTIVITIES_SNAPSHOT_HEADERS_.length).getValues()[0];
  var row2IsEmpty = row2.every(function(v) { return text_(v) === ''; });
  if (row2IsEmpty) {
    sheet.getRange(CONFIG.HEADER_ROW + 1, 1, 1, ACTIVITIES_SNAPSHOT_LABELS_HE_.length)
      .setValues([ACTIVITIES_SNAPSHOT_LABELS_HE_]);
  }
  invalidateReadRowsCache_(sheetName);
  return sheet;
}

function readActivitiesSnapshotRow_() {
  var sheetName = activitiesSnapshotSheetName_();
  try {
    var rows = readRowsProjected_(sheetName, ACTIVITIES_SNAPSHOT_HEADERS_);
    return rows.find(function(r) { return text_(r.snapshot_key) === 'all'; }) || null;
  } catch (_err) {
    return null;
  }
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
    normalized.source_sheet = rowId.indexOf('LONG-') === 0 ? CONFIG.SHEETS.DATA_LONG : CONFIG.SHEETS.DATA_SHORT;
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
  var rows = parseActivitiesSnapshotJson_(snap.rows_json, []).map(normalizeActivitiesSnapshotRow_);
  var filtered = filterActivitiesSnapshotRows_(rows, payload || {});
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
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    return { skipped: true, reason: 'activities_snapshot_refresh_already_running' };
  }

  var hadCache = !!__rqCache_;
  if (!hadCache) beginRequestCache_();

  try {
    var payload = actionActivitiesLegacy_(SNAPSHOT_ADMIN_USER_, { activity_type: 'all' });
    var sheet = ensureActivitiesSnapshotSheet_();
    var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
    var row = [
      'all',
      now,
      JSON.stringify(payload.activity_type_counts || {}),
      JSON.stringify(payload.rows || [])
    ];
    sheet.getRange(CONFIG.DATA_START_ROW, 1, 1, ACTIVITIES_SNAPSHOT_HEADERS_.length).setValues([row]);
    var lastRow = sheet.getLastRow();
    if (lastRow > CONFIG.DATA_START_ROW) {
      sheet.getRange(CONFIG.DATA_START_ROW + 1, 1, lastRow - CONFIG.DATA_START_ROW, ACTIVITIES_SNAPSHOT_HEADERS_.length).clearContent();
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
