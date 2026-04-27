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
  normalized.instructor_name = text_(src.instructor_name || src.Instructor || src.Employee);
  normalized.instructor_name_2 = text_(src.instructor_name_2 || src.Instructor2);
  normalized.emp_id = text_(src.emp_id || src.EmployeeID);
  normalized.emp_id_2 = text_(src.emp_id_2);
  if (!normalized.source_sheet) {
    var rowId = text_(src.RowID);
    normalized.source_sheet = rowId.indexOf('LONG-') === 0 ? CONFIG.SHEETS.DATA_LONG : CONFIG.SHEETS.DATA_SHORT;
  }
  return normalized;
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

  return (Array.isArray(rows) ? rows : []).filter(function(row) {
    if (text_(row.status) === 'סגור') return false;
    if (activityType && activityType !== 'all' && text_(row.activity_type) !== activityType) return false;
    if (financeStatus && text_(row.finance_status) !== financeStatus) return false;
    if (manager && text_(row.activity_manager) !== manager) return false;
    if (family === 'short' && oneDayTypes.indexOf(text_(row.activity_type)) < 0) return false;
    if (family === 'long' && programTypes.indexOf(text_(row.activity_type)) < 0) return false;
    if (endingCurrentMonth &&
      !(text_(row.activity_type) === 'course' && text_(row.end_date || '').slice(0, 7) === monthFilter)) return false;
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
  return {
    activity_type_counts: counts,
    rows: filtered,
    can_add_activity: true,
    _is_snapshot: true,
    _activities_fallback_used: false,
    _snapshot_updated_at: text_(snap.updated_at)
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
