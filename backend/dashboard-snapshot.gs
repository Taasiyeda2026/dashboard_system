var SUMMARY_SNAPSHOT_HEADERS_ = [
  'month',
  'can_view_finance',
  'total_short_activities',
  'total_long_activities',
  'total_instructors',
  'total_course_endings_current_month',
  'active_courses_current_month',
  'ending_courses_current_month',
  'active_courses_next_month',
  'missing_instructor_count',
  'missing_start_date_count',
  'late_end_date_count',
  'active_instructors_json',
  'short_activities_json',
  'kpi_cards_json',
  'show_only_nonzero_kpis',
  'updated_at'
];

var SUMMARY_SNAPSHOT_LABELS_HE_ = [
  'חודש',
  'הרשאת כספים',
  'סה״כ חד-יומי',
  'סה״כ תוכניות',
  'סה״כ מדריכים',
  'סה״כ סיומי קורסים בחודש',
  'קורסים פעילים בחודש',
  'קורסים מסתיימים בחודש',
  'קורסים פעילים בחודש הבא',
  'ללא מדריך',
  'ללא תאריך התחלה',
  'תאריך סיום מאוחר',
  'מדריכים פעילים (JSON)',
  'חד-יומי לפי סוג (JSON)',
  'כרטיסי KPI (JSON)',
  'הצג רק KPI לא-אפס',
  'עודכן בתאריך'
];

var BY_MANAGER_SNAPSHOT_HEADERS_ = [
  'month',
  'activity_manager',
  'total_short',
  'total_long',
  'total',
  'num_instructors',
  'course_endings',
  'finance_open',
  'exceptions',
  'updated_at'
];

var BY_MANAGER_SNAPSHOT_LABELS_HE_ = [
  'חודש',
  'מנהל פעילות',
  'חד-יומי',
  'תוכניות',
  'סה״כ',
  'מדריכים פעילים',
  'סיומי קורסים',
  'כספים פתוחים',
  'חריגות',
  'עודכן בתאריך'
];

var REFRESH_CONTROL_HEADERS_ = [
  'key',
  'last_refresh_at',
  'last_status',
  'last_message'
];

var REFRESH_CONTROL_LABELS_HE_ = [
  'מפתח',
  'רענון אחרון',
  'סטטוס אחרון',
  'הודעה אחרונה'
];

function invalidateSnapshotSheetCache_(sheetName) {
  if (!__rqCache_ || !sheetName) return;
  if (__rqCache_.headers) delete __rqCache_.headers[sheetName];
  if (__rqCache_.readRows) delete __rqCache_.readRows[sheetName];
  if (__rqCache_.sheetMeta) delete __rqCache_.sheetMeta[sheetName];
  if (__rqCache_.sheetByName) delete __rqCache_.sheetByName[sheetName];
}

function ensureSnapshotSheetScaffold_(sheetName, englishHeaders, hebrewLabels) {
  var sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) return false;

  sheet.getRange(CONFIG.HEADER_ROW, 1, 1, englishHeaders.length).setValues([englishHeaders]);

  var labelRange = sheet.getRange(CONFIG.HEADER_ROW + 1, 1, 1, englishHeaders.length);
  var currentLabelRow = labelRange.getValues()[0];
  var isLabelRowEmpty = true;
  for (var i = 0; i < currentLabelRow.length; i++) {
    if (text_(currentLabelRow[i])) {
      isLabelRowEmpty = false;
      break;
    }
  }
  if (isLabelRowEmpty) {
    labelRange.setValues([hebrewLabels]);
  }

  invalidateSnapshotSheetCache_(sheetName);
  return true;
}

function dashboardSnapshotSummarySheetName_() {
  return CONFIG.SHEETS.DASHBOARD_SUMMARY_SNAPSHOT || 'dashboard_summary_snapshot';
}

function dashboardSnapshotByManagerSheetName_() {
  return CONFIG.SHEETS.DASHBOARD_BY_MANAGER_SNAPSHOT || 'dashboard_by_manager_snapshot';
}

function dashboardSnapshotRefreshControlSheetName_() {
  return CONFIG.SHEETS.DASHBOARD_REFRESH_CONTROL || 'dashboard_refresh_control';
}

function toJsonText_(value, fallback) {
  try {
    return JSON.stringify(value || fallback || []);
  } catch (_e) {
    return JSON.stringify(fallback || []);
  }
}

function parseJsonText_(raw, fallback) {
  var txt = text_(raw);
  if (!txt) return fallback;
  try {
    return JSON.parse(txt);
  } catch (_e) {
    return fallback;
  }
}

function intOrZero_(value) {
  var n = parseInt(text_(value), 10);
  return isNaN(n) ? 0 : n;
}

function boolFromCell_(value) {
  var raw = text_(value).toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function writeDashboardSummarySnapshotRow_(ym, dashboardData) {
  var sheetName = dashboardSnapshotSummarySheetName_();
  if (!ensureSnapshotSheetScaffold_(sheetName, SUMMARY_SNAPSHOT_HEADERS_, SUMMARY_SNAPSHOT_LABELS_HE_)) return false;
  var totals = dashboardData.totals || {};
  var summary = dashboardData.summary || {};
  upsertRowByKey_(sheetName, 'month', {
    month: ym,
    can_view_finance: dashboardData.can_view_finance ? 'yes' : 'no',
    total_short_activities: intOrZero_(totals.total_short_activities || totals.short),
    total_long_activities: intOrZero_(totals.total_long_activities || totals.long),
    total_instructors: intOrZero_(totals.total_instructors),
    total_course_endings_current_month: intOrZero_(totals.total_course_endings_current_month),
    active_courses_current_month: intOrZero_(summary.active_courses_current_month),
    ending_courses_current_month: intOrZero_(summary.ending_courses_current_month),
    active_courses_next_month: intOrZero_(summary.active_courses_next_month),
    missing_instructor_count: intOrZero_(summary.missing_instructor_count),
    missing_start_date_count: intOrZero_(summary.missing_start_date_count),
    late_end_date_count: intOrZero_(summary.late_end_date_count),
    active_instructors_json: toJsonText_(summary.active_instructors, []),
    short_activities_json: toJsonText_(summary.short_activities, []),
    kpi_cards_json: toJsonText_(dashboardData.kpi_cards, []),
    show_only_nonzero_kpis: dashboardData.show_only_nonzero_kpis ? 'yes' : 'no',
    updated_at: formatDate_(new Date())
  });
  return true;
}

function replaceDashboardByManagerSnapshotRows_(ym, byManagerRows) {
  var sheetName = dashboardSnapshotByManagerSheetName_();
  if (!ensureSnapshotSheetScaffold_(sheetName, BY_MANAGER_SNAPSHOT_HEADERS_, BY_MANAGER_SNAPSHOT_LABELS_HE_)) return false;
  deleteRowsByKey_(sheetName, 'month', ym);
  (byManagerRows || []).forEach(function(row) {
    appendRow_(sheetName, {
      month: ym,
      activity_manager: text_(row.activity_manager),
      total_short: intOrZero_(row.total_short),
      total_long: intOrZero_(row.total_long),
      total: intOrZero_(row.total),
      num_instructors: intOrZero_(row.num_instructors),
      course_endings: intOrZero_(row.course_endings),
      finance_open: intOrZero_(row.finance_open),
      exceptions: intOrZero_(row.exceptions),
      updated_at: formatDate_(new Date())
    });
  });
  return true;
}

function updateDashboardRefreshControl_(status, message) {
  var sheetName = dashboardSnapshotRefreshControlSheetName_();
  if (!ensureSnapshotSheetScaffold_(sheetName, REFRESH_CONTROL_HEADERS_, REFRESH_CONTROL_LABELS_HE_)) return false;
  upsertRowByKey_(sheetName, 'key', {
    key: 'dashboard',
    last_refresh_at: formatDate_(new Date()),
    last_status: text_(status),
    last_message: text_(message)
  });
  return true;
}

function readDashboardSummarySnapshotRow_(ym) {
  var sheetName = dashboardSnapshotSummarySheetName_();
  var sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) return null;
  var rows = readRows_(sheetName);
  var hit = rows.find(function(row) { return text_(row.month) === text_(ym); });
  return hit || null;
}

function readDashboardByManagerSnapshotRows_(ym) {
  var sheetName = dashboardSnapshotByManagerSheetName_();
  var sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) return null;
  return readRows_(sheetName).filter(function(row) {
    return text_(row.month) === text_(ym);
  }).map(function(row) {
    return {
      activity_manager: text_(row.activity_manager),
      total_short: intOrZero_(row.total_short),
      total_long: intOrZero_(row.total_long),
      total: intOrZero_(row.total),
      num_instructors: intOrZero_(row.num_instructors),
      course_endings: intOrZero_(row.course_endings),
      finance_open: intOrZero_(row.finance_open),
      exceptions: intOrZero_(row.exceptions)
    };
  });
}

function actionDashboardSnapshot_(user, payload) {
  var ym = dashboardPayloadYm_(payload || {});
  var summaryRow = readDashboardSummarySnapshotRow_(ym);
  var byManagerRows = readDashboardByManagerSnapshotRows_(ym);
  if (!summaryRow || byManagerRows === null) {
    var full = actionDashboard_(user, payload || {});
    full._is_snapshot = false;
    return full;
  }

  var canViewFinance = yesNo_(summaryRow.can_view_finance) === 'yes' || boolFromCell_(summaryRow.can_view_finance);
  var activeInstructors = parseJsonText_(summaryRow.active_instructors_json, []);
  var shortActivities = parseJsonText_(summaryRow.short_activities_json, []);
  var kpiCards = parseJsonText_(summaryRow.kpi_cards_json, []);
  var showOnlyNonzero = yesNo_(summaryRow.show_only_nonzero_kpis) === 'yes' || boolFromCell_(summaryRow.show_only_nonzero_kpis);

  return {
    month: ym,
    can_view_finance: canViewFinance,
    totals: {
      total_short_activities: intOrZero_(summaryRow.total_short_activities),
      total_long_activities: intOrZero_(summaryRow.total_long_activities),
      total_instructors: intOrZero_(summaryRow.total_instructors),
      total_course_endings_current_month: intOrZero_(summaryRow.total_course_endings_current_month),
      short: intOrZero_(summaryRow.total_short_activities),
      long: intOrZero_(summaryRow.total_long_activities)
    },
    by_activity_manager: byManagerRows,
    summary: {
      active_courses_current_month: intOrZero_(summaryRow.active_courses_current_month),
      ending_courses_current_month: intOrZero_(summaryRow.ending_courses_current_month),
      active_courses_next_month: intOrZero_(summaryRow.active_courses_next_month),
      active_instructors: Array.isArray(activeInstructors) ? activeInstructors : [],
      missing_instructor_count: intOrZero_(summaryRow.missing_instructor_count),
      missing_start_date_count: intOrZero_(summaryRow.missing_start_date_count),
      late_end_date_count: intOrZero_(summaryRow.late_end_date_count),
      short_activities: Array.isArray(shortActivities) ? shortActivities : []
    },
    kpi_cards: Array.isArray(kpiCards) ? kpiCards : [],
    show_only_nonzero_kpis: showOnlyNonzero,
    _is_snapshot: true
  };
}

function monthsForDashboardSnapshotRefresh_() {
  var nowYm = dashboardPayloadYm_({});
  return [shiftYm_(nowYm, -1), nowYm, shiftYm_(nowYm, 1)];
}

function resolveSnapshotRefreshUser_(user) {
  if (user && text_(user.user_id)) return user;
  var rows = readRows_(CONFIG.SHEETS.PERMISSIONS);
  var match = rows.find(function(row) {
    if (yesNo_(row.active) === 'no') return false;
    try {
      return normalizeRole_(internalRoleFromPermissionRow_(row)) === 'admin';
    } catch (_e) {
      return false;
    }
  });
  if (!match) {
    throw new Error('No active admin user found for snapshot refresh');
  }
  return {
    user_id: text_(match.user_id),
    display_role: 'admin'
  };
}

function refreshDashboardSnapshots_(user) {
  var actor = resolveSnapshotRefreshUser_(user);
  var months = monthsForDashboardSnapshotRefresh_();
  try {
    months.forEach(function(ym) {
      var dashboard = actionDashboard_(actor, { month: ym });
      writeDashboardSummarySnapshotRow_(ym, dashboard);
      replaceDashboardByManagerSnapshotRows_(ym, dashboard.by_activity_manager || []);
    });
    updateDashboardRefreshControl_('ok', 'refresh_completed');
    bumpDataViewsCacheVersion_();
    return { ok: true, months: months };
  } catch (err) {
    updateDashboardRefreshControl_('error', err && err.message ? err.message : String(err));
    throw err;
  }
}
