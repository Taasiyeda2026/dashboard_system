/**
 * dashboard-snapshot.gs
 *
 * קריאה וכתיבה של snapshots קלים ללוח הבקרה.
 * לא משנה לוגיקה עסקית — actionDashboard_ הוא מקור האמת.
 * Snapshot הוא שכבת cache/write-through בלבד.
 *
 * גיליונות: dashboard_summary_snapshot, dashboard_by_manager_snapshot,
 *            dashboard_refresh_control
 */

var SNAPSHOT_ADMIN_USER_ = { user_id: 'snapshot_refresh', display_role: 'admin' };

var SUMMARY_SNAPSHOT_HEADERS_ = [
  'month_ym', 'month_label', 'updated_at',
  'total_short_activities', 'total_long_activities',
  'active_courses_current_month', 'active_workshops_current_month',
  'active_tours_current_month', 'active_after_school_current_month',
  'active_escape_room_current_month',
  'finance_open_count', 'exceptions_count', 'active_instructors_count',
  'course_endings_current_month', 'active_courses_next_month',
  'missing_instructor_count', 'missing_start_date_count', 'late_end_date_count',
  'north_active_instructors_names', 'south_active_instructors_names'
];

var BY_MANAGER_SNAPSHOT_HEADERS_ = [
  'month_ym', 'activity_manager', 'manager_display_name',
  'total_short', 'total_long', 'total', 'num_instructors',
  'course_endings', 'finance_open', 'exceptions',
  'active_instructors_names', 'updated_at'
];

var REFRESH_CONTROL_HEADERS_ = ['key', 'value', 'label_he'];
var SUMMARY_SNAPSHOT_LABELS_HE_ = [
  'חודש',
  'תווית חודש',
  'עודכן בתאריך',
  'סך פעילויות חד-יומיות',
  'סך תוכניות',
  'קורסים פעילים בחודש נוכחי',
  'סדנאות פעילות בחודש נוכחי',
  'סיורים פעילים בחודש נוכחי',
  'צהרונים פעילים בחודש נוכחי',
  'חדרי בריחה פעילים בחודש נוכחי',
  'כספים פתוחים',
  'חריגות',
  'מדריכים פעילים',
  'סיומי קורסים בחודש נוכחי',
  'קורסים פעילים בחודש הבא',
  'ללא מדריך',
  'ללא תאריך התחלה',
  'תאריך סיום מאוחר',
  'שמות מדריכים פעילים צפון',
  'שמות מדריכים פעילים דרום'
];
var BY_MANAGER_SNAPSHOT_LABELS_HE_ = [
  'חודש',
  'מנהל פעילות',
  'שם תצוגה מנהל',
  'חד-יומי',
  'תוכניות',
  'סך הכול',
  'מספר מדריכים',
  'סיומי קורסים',
  'כספים פתוחים',
  'חריגות',
  'שמות מדריכים פעילים',
  'עודכן בתאריך'
];
var REFRESH_CONTROL_LABELS_HE_ = ['מפתח', 'ערך', 'תווית'];

var SNAPSHOT_MANAGER_DISPLAY_NAMES_ = {
  'גיל נאמן':          'מחוז צפון',
  'לינוי שמואל מזרחי': 'מחוז דרום'
};

// ─── header helpers ───────────────────────────────────────────────────────────

function ensureSnapshotSheetScaffold_(sheetName, englishHeaders, hebrewLabels) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return false;

  var headerLen = englishHeaders.length;
  var maxCol = Math.max(sheet.getLastColumn(), headerLen);
  if (maxCol > headerLen) {
    sheet.getRange(CONFIG.HEADER_ROW, headerLen + 1, 1, maxCol - headerLen).clearContent();
  }
  sheet.getRange(CONFIG.HEADER_ROW, 1, 1, headerLen).setValues([englishHeaders]);

  var row2 = sheet.getRange(CONFIG.HEADER_ROW + 1, 1, 1, maxCol).getValues()[0];
  var row2IsEmpty = row2.every(function(v) { return text_(v) === ''; });
  if (row2IsEmpty) {
    sheet.getRange(CONFIG.HEADER_ROW + 1, 1, 1, hebrewLabels.length).setValues([hebrewLabels]);
  }

  if (__rqCache_) {
    if (__rqCache_.headers) delete __rqCache_.headers[sheetName];
    if (__rqCache_.readRows) delete __rqCache_.readRows[sheetName];
    if (__rqCache_.sheetMeta) delete __rqCache_.sheetMeta[sheetName];
    if (__rqCache_.sheetByName) delete __rqCache_.sheetByName[sheetName];
  }
  return true;
}

// ─── A. actionDashboardSnapshot_ ─────────────────────────────────────────────

function actionDashboardSnapshot_(user, payload) {
  requireAnyRole_(user, ['admin', 'operations_reviewer', 'authorized_user']);

  var permission = getPermissionRow_(user.user_id);
  var canViewFinance = user.display_role === 'admin' ||
    yesNo_(permission.view_finance) === 'yes';

  var ym = dashboardPayloadYm_(payload || {});

  var snap = null;
  var byManagerRows = [];

  var ss = getSpreadsheet_();
  var hasSummarySnapshotSheet = !!ss.getSheetByName(CONFIG.SHEETS.DASHBOARD_SUMMARY_SNAPSHOT);

  if (hasSummarySnapshotSheet) {
    var summaryRows = readRows_(CONFIG.SHEETS.DASHBOARD_SUMMARY_SNAPSHOT);
    snap = summaryRows.find(function(r) { return text_(r.month_ym) === ym; }) || null;
  }

  if (ss.getSheetByName(CONFIG.SHEETS.DASHBOARD_BY_MANAGER_SNAPSHOT)) {
    var allByMgr = readRows_(CONFIG.SHEETS.DASHBOARD_BY_MANAGER_SNAPSHOT);
    byManagerRows = allByMgr.filter(function(r) { return text_(r.month_ym) === ym; });
  }

  if (!snap || !hasSummarySnapshotSheet) {
    if (payload && payload.force_full === true) {
      var fullData = actionDashboard_(user, payload);
      if (fullData && typeof fullData === 'object') {
        fullData._is_snapshot = false;
      }
      return fullData;
    }
    return {
      month: ym,
      _is_snapshot: false,
      _is_snapshot_missing: true,
      can_view_finance: canViewFinance,
      totals: {},
      summary: {},
      by_activity_manager: [],
      kpi_cards: [],
      show_only_nonzero_kpis: true
    };
  }

  var s = snap || {};

  var totalShort     = parseInt(text_(s.total_short_activities),   10) || 0;
  var totalLong      = parseInt(text_(s.total_long_activities),    10) || 0;
  var totalInstr     = parseInt(text_(s.active_instructors_count), 10) || 0;
  var courseEndings  = parseInt(text_(s.course_endings_current_month), 10) || 0;
  var financeOpen    = parseInt(text_(s.finance_open_count),       10) || 0;
  var exceptCount    = parseInt(text_(s.exceptions_count),         10) || 0;
  var activeCurrent  = parseInt(text_(s.active_courses_current_month), 10) || 0;
  var activeNext     = parseInt(text_(s.active_courses_next_month), 10) || 0;
  var missingInstr   = parseInt(text_(s.missing_instructor_count), 10) || 0;
  var missingDate    = parseInt(text_(s.missing_start_date_count), 10) || 0;
  var lateEnd        = parseInt(text_(s.late_end_date_count),      10) || 0;

  var northStr = text_(s.north_active_instructors_names);
  var southStr = text_(s.south_active_instructors_names);
  var northArr = northStr
    ? northStr.split(',').map(function(n) { return n.trim(); }).filter(Boolean)
    : [];
  var southArr = southStr
    ? southStr.split(',').map(function(n) { return n.trim(); }).filter(Boolean)
    : [];

  var byActivityManager = byManagerRows.map(function(r) {
    var row = {
      activity_manager: text_(r.activity_manager),
      total_short:     parseInt(text_(r.total_short),    10) || 0,
      total_long:      parseInt(text_(r.total_long),     10) || 0,
      total:           parseInt(text_(r.total),          10) || 0,
      num_instructors: parseInt(text_(r.num_instructors),10) || 0,
      course_endings:  parseInt(text_(r.course_endings), 10) || 0,
      exceptions:      parseInt(text_(r.exceptions),     10) || 0
    };
    if (canViewFinance) {
      row.finance_open = parseInt(text_(r.finance_open), 10) || 0;
    }
    return row;
  });

  var snapshotData = {
    total_short_activities:    totalShort,
    total_long_activities:     totalLong,
    active_instructors_count:  totalInstr,
    course_endings_current_month: courseEndings,
    finance_open_count:        canViewFinance ? financeOpen : 0,
    exceptions_count:          exceptCount,
    active_courses_current_month: activeCurrent,
    active_courses_next_month: activeNext,
    missing_instructor_count:  missingInstr,
    missing_start_date_count:  missingDate,
    late_end_date_count:       lateEnd
  };

  var kpiCards = buildDashboardSnapshotKpis_(snapshotData, canViewFinance);

  return {
    month: ym,
    can_view_finance: canViewFinance,
    totals: {
      total_short_activities:           totalShort,
      total_long_activities:            totalLong,
      total_instructors:                totalInstr,
      total_course_endings_current_month: courseEndings,
      short: totalShort,
      long:  totalLong
    },
    by_activity_manager: byActivityManager,
    summary: {
      active_courses_current_month: activeCurrent,
      ending_courses_current_month: courseEndings,
      active_courses_next_month:    activeNext,
      active_instructors:           northArr.concat(southArr),
      active_instructors_by_manager: {
        'מחוז צפון': northArr,
        'מחוז דרום': southArr
      },
      missing_instructor_count:  missingInstr,
      missing_start_date_count:  missingDate,
      late_end_date_count:       lateEnd,
      short_activities:          []
    },
    kpi_cards: kpiCards,
    show_only_nonzero_kpis: settingYes_('show_only_nonzero_kpis'),
    _is_snapshot: true
  };
}

// ─── B. buildDashboardSnapshotKpis_ ──────────────────────────────────────────

function buildDashboardSnapshotKpis_(snapshot, canViewFinance) {
  var cards = [
    {
      id: 'short', action: 'kpi|short',
      title: String(snapshot.total_short_activities || 0),
      subtitle: 'חד-יומי',
      value: snapshot.total_short_activities || 0
    },
    {
      id: 'long', action: 'kpi|long',
      title: String(snapshot.total_long_activities || 0),
      subtitle: 'תוכניות',
      value: snapshot.total_long_activities || 0
    },
    {
      id: 'instructors', action: 'kpi|instructors',
      title: String(snapshot.active_instructors_count || 0),
      subtitle: 'מדריכים פעילים',
      value: snapshot.active_instructors_count || 0
    },
    {
      id: 'endings', action: 'kpi|endings',
      title: String(snapshot.course_endings_current_month || 0),
      subtitle: 'סיומי קורסים',
      value: snapshot.course_endings_current_month || 0
    },
    {
      id: 'exceptions', action: 'kpi|exceptions',
      title: String(snapshot.exceptions_count || 0),
      subtitle: 'חריגות (קורסים)',
      value: snapshot.exceptions_count || 0
    }
  ];

  if (canViewFinance) {
    cards.push({
      id: 'finance_open', action: 'kpi|finance_open',
      title: String(snapshot.finance_open_count || 0),
      subtitle: 'כספים פתוחים',
      value: snapshot.finance_open_count || 0,
      requires_finance: true
    });
  }

  return cards;
}

// ─── C. refreshDashboardSnapshots_ ───────────────────────────────────────────

function refreshDashboardSnapshots_() {
  var hadCache = !!__rqCache_;
  if (!hadCache) {
    beginRequestCache_();
  }

  try {
    var today = formatDate_(new Date());
    var currentYm = today.slice(0, 7);
    var months = [shiftYm_(currentYm, -1), currentYm, shiftYm_(currentYm, 1)];
    var errors = [];

    months.forEach(function(ym) {
      try {
        var fullData = actionDashboard_(SNAPSHOT_ADMIN_USER_, { month: ym });
        writeDashboardSummarySnapshotRow_(ym, fullData);
        replaceDashboardByManagerSnapshotRows_(ym, fullData);
      } catch (e) {
        errors.push(ym + ': ' + (e && e.message ? e.message : String(e)));
      }
    });

    var status  = errors.length === 0 ? 'ok' : 'partial';
    var message = errors.length === 0 ? 'all months updated' : errors.join('; ');
    try {
      updateDashboardRefreshControl_(status, message);
    } finally {
      bumpDataViewsCacheVersion_();
    }
  } finally {
    if (!hadCache) {
      __rqCache_ = null;
    }
  }
}

function markDashboardSnapshotsRefreshNeeded_(reason) {
  var message = text_(reason || 'data changed; refresh required');
  try {
    updateDashboardRefreshControl_('pending', message);
  } finally {
    // Keep read caches coherent after writes without running full snapshot rebuild inline.
    bumpDataViewsCacheVersion_();
  }
}

// ─── D. writeDashboardSummarySnapshotRow_ ────────────────────────────────────

function writeDashboardSummarySnapshotRow_(ym, fullData) {
  var sheetName = CONFIG.SHEETS.DASHBOARD_SUMMARY_SNAPSHOT;
  ensureSnapshotSheetScaffold_(sheetName, SUMMARY_SNAPSHOT_HEADERS_, SUMMARY_SNAPSHOT_LABELS_HE_);

  var summary = fullData.summary || {};
  var totals  = fullData.totals  || {};

  // Extract north/south instructor names from summary if available
  var byMgrNames = summary.active_instructors_by_manager || {};
  var northNames = (byMgrNames['מחוז צפון'] || byMgrNames['גיל נאמן'] || []).join(', ');
  var southNames = (byMgrNames['מחוז דרום'] || byMgrNames['לינוי שמואל מזרחי'] || []).join(', ');

  // Fall back to active_instructors list if per-manager names are absent
  if (!northNames && !southNames && Array.isArray(summary.active_instructors)) {
    northNames = summary.active_instructors.join(', ');
  }

  // Extract per-type activity counts from kpi_cards when available
  var kpiAll = Array.isArray(fullData.kpi_cards) ? fullData.kpi_cards : [];
  var counts = {};
  kpiAll.forEach(function(card) { counts[card.id] = card.value || 0; });

  var financeOpen = canViewFinanceFromKpis_(kpiAll, fullData);
  var exceptions  = counts['exceptions'] || 0;

  var rowObj = {
    month_ym:                          ym,
    month_label:                       ym,
    updated_at:                        formatDate_(new Date()),
    total_short_activities:            totals.total_short_activities || totals.short || 0,
    total_long_activities:             totals.total_long_activities  || totals.long  || 0,
    active_courses_current_month:      counts['active_courses']      || summary.active_courses_current_month || 0,
    active_workshops_current_month:    counts['active_workshops']    || 0,
    active_tours_current_month:        counts['active_tours']        || 0,
    active_after_school_current_month: counts['active_after_school'] || 0,
    active_escape_room_current_month:  counts['active_escape_room']  || 0,
    finance_open_count:                financeOpen,
    exceptions_count:                  exceptions,
    active_instructors_count:          totals.total_instructors || 0,
    course_endings_current_month:      summary.ending_courses_current_month || totals.total_course_endings_current_month || 0,
    active_courses_next_month:         summary.active_courses_next_month || 0,
    missing_instructor_count:          summary.missing_instructor_count  || 0,
    missing_start_date_count:          summary.missing_start_date_count  || 0,
    late_end_date_count:               summary.late_end_date_count       || 0,
    north_active_instructors_names:    northNames,
    south_active_instructors_names:    southNames
  };

  upsertRowByKey_(sheetName, 'month_ym', rowObj);
}

function canViewFinanceFromKpis_(kpiAll, fullData) {
  var card = kpiAll.find(function(c) { return c.id === 'finance_open'; });
  if (card) return card.value || 0;
  if (fullData.can_view_finance === false) return 0;
  var totals = fullData.totals || {};
  return totals.finance_open || 0;
}

// ─── E. replaceDashboardByManagerSnapshotRows_ ───────────────────────────────

function replaceDashboardByManagerSnapshotRows_(ym, fullData) {
  var sheetName = CONFIG.SHEETS.DASHBOARD_BY_MANAGER_SNAPSHOT;
  ensureSnapshotSheetScaffold_(sheetName, BY_MANAGER_SNAPSHOT_HEADERS_, BY_MANAGER_SNAPSHOT_LABELS_HE_);

  deleteRowsByKey_(sheetName, 'month_ym', ym);

  var byManager = Array.isArray(fullData.by_activity_manager) ? fullData.by_activity_manager : [];
  var updatedAt = formatDate_(new Date());

  byManager.forEach(function(row) {
    var manager = text_(row.activity_manager);
    if (!manager || manager === 'unassigned') return;
    var displayName = SNAPSHOT_MANAGER_DISPLAY_NAMES_[manager] || manager;
    var rowObj = {
      month_ym:               ym,
      activity_manager:       manager,
      manager_display_name:   displayName,
      total_short:            row.total_short    || 0,
      total_long:             row.total_long     || 0,
      total:                  row.total          || 0,
      num_instructors:        row.num_instructors|| 0,
      course_endings:         row.course_endings || 0,
      finance_open:           row.finance_open   || 0,
      exceptions:             row.exceptions     || 0,
      active_instructors_names: text_(row.active_instructors_names) || '',
      updated_at:             updatedAt
    };
    appendRow_(sheetName, rowObj);
  });
}

// ─── F. updateDashboardRefreshControl_ ───────────────────────────────────────

function updateDashboardRefreshControl_(status, message) {
  var sheetName = CONFIG.SHEETS.DASHBOARD_REFRESH_CONTROL;
  ensureSnapshotSheetScaffold_(sheetName, REFRESH_CONTROL_HEADERS_, REFRESH_CONTROL_LABELS_HE_);

  var now = new Date().toISOString();
  var entries = [
    { key: 'last_refresh_at', value: now,     label_he: 'עדכון אחרון' },
    { key: 'last_status',     value: status,  label_he: 'סטטוס' },
    { key: 'last_message',    value: message, label_he: 'הודעה' }
  ];

  entries.forEach(function(entry) {
    upsertRowByKey_(sheetName, 'key', entry);
  });
}
