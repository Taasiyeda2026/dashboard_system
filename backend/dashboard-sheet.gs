/**
 * dashboard-sheet.gs — מסך Dashboard מגיליון dashboard בלבד.
 *
 * קריאה אחת: getRange(1,1, DASHBOARD_SHEET_MAX_ROW_, DASHBOARD_SHEET_MAX_COL_) על גיליון dashboard.
 * טווח מאוחד A1:W17 — שלושה בלוקים קבועים (לא מבנה A=אזור / B=metric).
 */

var DASHBOARD_SHEET_NAME_ = 'dashboard';
/** איחוד בלוקים: כל הארץ A1:G17, צפון I1:O17, דרום Q1:W17 → A1:W17 */
var DASHBOARD_SHEET_MAX_ROW_ = 17;
var DASHBOARD_SHEET_MAX_COL_ = 23;

/**
 * שורה 1 = כותרות תאריך חודש בפועל; שורה 2 = תווית חודש/אזור לתצוגה; שורות 3–8 ספירות לפי סוג; 10 סיומים; 12–14 חריגות; 16 מספר מדריכים; 17 שמות.
 * עמודת label_col = תיאורי מדדים; month_cols = ערכים לפי חודש (כותרות התאריך בשורה 1 באותן עמודות).
 */
var DASHBOARD_SHEET_BLOCKS_ = {
  all: {
    region_key: 'all',
    region_label: 'כל הארץ',
    manager_name: 'all',
    labelCol: 1,
    monthColStart: 2,
    monthColEnd: 7,
    table_range: 'A1:G17'
  },
  north: {
    region_key: 'north',
    region_label: 'מחוז צפון',
    manager_name: 'גיל נאמן',
    labelCol: 9,
    monthColStart: 10,
    monthColEnd: 15,
    table_range: 'I1:O17'
  },
  south: {
    region_key: 'south',
    region_label: 'מחוז דרום',
    manager_name: 'לינוי שמואל מזרחי',
    labelCol: 17,
    monthColStart: 18,
    monthColEnd: 23,
    table_range: 'Q1:W17'
  }
};

var DASHBOARD_SHEET_MONTH_HEADER_ROW_ = 1;

var DASHBOARD_METRIC_ROWS_ = {
  all_activities: 3,
  course: 4,
  after_school: 5,
  workshop: 6,
  tour: 7,
  escape_room: 8,
  end_date: 10,
  course_late_end_date: 12,
  course_operational_gaps: 13,
  course_total_exceptions: 14,
  all_instructors: 16,
  all_instructors_names: 17
};

function dashboardSheetNum_(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  var s = String(v).replace(/,/g, '').replace(/\u200f|\u200e/g, '').trim();
  if (!s) return 0;
  var n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

function dashboardSheetCellYm_(cell) {
  if (cell instanceof Date) {
    var tz = Session.getScriptTimeZone();
    return Utilities.formatDate(cell, tz, 'yyyy-MM');
  }
  var s = text_(cell).trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    var mo = ('0' + m[2]).slice(-2);
    return m[3] + '-' + mo;
  }
  var short = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (short) {
    var yy = parseInt(short[3], 10);
    var yyyy = yy >= 70 ? 1900 + yy : 2000 + yy;
    var mo2 = ('0' + short[2]).slice(-2);
    return yyyy + '-' + mo2;
  }
  return '';
}

function dashboardSheetFindMonthCol_(values, block, ym) {
  var r = DASHBOARD_SHEET_MONTH_HEADER_ROW_ - 1;
  var c0 = block.monthColStart;
  var c1 = block.monthColEnd;
  for (var c = c0; c <= c1; c++) {
    if (dashboardSheetCellYm_(values[r][c - 1]) === ym) return c;
  }
  return null;
}

function dashboardSheetAvailableMonthCols_(values, block) {
  var out = [];
  var r = DASHBOARD_SHEET_MONTH_HEADER_ROW_ - 1;
  for (var c = block.monthColStart; c <= block.monthColEnd; c++) {
    var ym = dashboardSheetCellYm_(values[r][c - 1]);
    if (ym) out.push({ col: c, ym: ym });
  }
  return out.sort(function(a, b) { return text_(a.ym).localeCompare(text_(b.ym)); });
}

function dashboardSheetFallbackMonthCol_(values, block) {
  var months = dashboardSheetAvailableMonthCols_(values, block);
  return months.length ? months[months.length - 1] : null;
}

function dashboardSheetMetric_(values, row1, col1) {
  if (row1 < 1 || col1 < 1) return 0;
  if (row1 > values.length) return 0;
  var row = values[row1 - 1];
  if (!row || col1 > row.length) return 0;
  return dashboardSheetNum_(row[col1 - 1]);
}

function dashboardSheetInstructorNamesList_(values, colYm) {
  var r = DASHBOARD_METRIC_ROWS_.all_instructors_names;
  var raw = text_(values[r - 1][colYm - 1]);
  if (!raw) return [];
  return raw.split(/[,;]/).map(function(s) { return String(s || '').trim(); }).filter(Boolean);
}

function dashboardSheetUniqueInstructorCount_(values, colYm) {
  var n = dashboardSheetMetric_(values, DASHBOARD_METRIC_ROWS_.all_instructors, colYm);
  var names = dashboardSheetInstructorNamesList_(values, colYm);
  if (n > 0) return Math.round(n);
  return names.length;
}

function dashboardSheetBuildShortActivities_(values, colYm) {
  var out = [];
  var pairs = [
    { type: 'workshop', row: DASHBOARD_METRIC_ROWS_.workshop },
    { type: 'tour', row: DASHBOARD_METRIC_ROWS_.tour },
    { type: 'escape_room', row: DASHBOARD_METRIC_ROWS_.escape_room }
  ];
  pairs.forEach(function(p) {
    var n = dashboardSheetMetric_(values, p.row, colYm);
    if (n > 0) out.push({ activity_type: p.type, count: n });
  });
  return out.sort(function(a, b) { return text_(a.activity_type).localeCompare(text_(b.activity_type)); });
}

function dashboardSheetBuildKpiCards_(totals, activeTypeCounts, canViewFinance, financeOpenCount, exceptionSum, uniqueInstructorCount, courseEndings) {
  var kpi_cards_all = [
    { id: 'short', action: 'kpi|short', title: String(totals.total_short_activities), subtitle: 'חד-יומי', value: totals.total_short_activities },
    { id: 'long', action: 'kpi|long', title: String(totals.total_long_activities), subtitle: 'תוכניות', value: totals.total_long_activities },
    {
      id: 'active_courses',
      action: 'kpi|active_courses',
      title: String(activeTypeCounts.course || 0),
      subtitle: 'קורסים פעילים',
      value: activeTypeCounts.course || 0
    },
    {
      id: 'active_workshops',
      action: 'kpi|active_workshops',
      title: String(activeTypeCounts.workshop || 0),
      subtitle: 'סדנאות פעילות',
      value: activeTypeCounts.workshop || 0
    },
    {
      id: 'active_tours',
      action: 'kpi|active_tours',
      title: String(activeTypeCounts.tour || 0),
      subtitle: 'סיורים פעילים',
      value: activeTypeCounts.tour || 0
    },
    {
      id: 'active_after_school',
      action: 'kpi|active_after_school',
      title: String(activeTypeCounts.after_school || 0),
      subtitle: 'אפטרסקול פעיל',
      value: activeTypeCounts.after_school || 0
    },
    {
      id: 'active_escape_room',
      action: 'kpi|active_escape_room',
      title: String(activeTypeCounts.escape_room || 0),
      subtitle: 'חדרי בריחה פעילים',
      value: activeTypeCounts.escape_room || 0
    },
    {
      id: 'finance_open',
      action: 'kpi|finance_open',
      title: String(financeOpenCount),
      subtitle: 'כספים פתוחים',
      value: financeOpenCount,
      requires_finance: true
    },
    {
      id: 'exceptions',
      action: 'kpi|exceptions',
      title: String(exceptionSum),
      subtitle: 'חריגות (קורסים)',
      value: exceptionSum
    },
    {
      id: 'instructors',
      action: 'kpi|instructors',
      title: String(uniqueInstructorCount),
      subtitle: 'מדריכים פעילים',
      value: uniqueInstructorCount
    },
    {
      id: 'endings',
      action: 'kpi|endings',
      title: String(courseEndings),
      subtitle: 'סיומי קורסים',
      value: courseEndings
    }
  ];
  return canViewFinance ? kpi_cards_all : kpi_cards_all.filter(function(c) { return !c.requires_finance; });
}

function dashboardSheetManagerRow_(values, colYm, managerKey) {
  var totalShort =
    dashboardSheetMetric_(values, DASHBOARD_METRIC_ROWS_.workshop, colYm) +
    dashboardSheetMetric_(values, DASHBOARD_METRIC_ROWS_.tour, colYm) +
    dashboardSheetMetric_(values, DASHBOARD_METRIC_ROWS_.escape_room, colYm);
  var totalLong =
    dashboardSheetMetric_(values, DASHBOARD_METRIC_ROWS_.after_school, colYm) +
    dashboardSheetMetric_(values, DASHBOARD_METRIC_ROWS_.course, colYm);
  var numInstr = dashboardSheetUniqueInstructorCount_(values, colYm);
  var endings = dashboardSheetMetric_(values, DASHBOARD_METRIC_ROWS_.end_date, colYm);
  var exceptions = dashboardSheetMetric_(values, DASHBOARD_METRIC_ROWS_.course_total_exceptions, colYm);
  return {
    activity_manager: managerKey,
    total_short: totalShort,
    total_long: totalLong,
    total: totalShort + totalLong,
    num_instructors: numInstr,
    course_endings: endings,
    exceptions: exceptions
  };
}

function actionDashboardSheet_(user, payload) {
  requireAnyRole_(user, ['admin', 'operation_manager', 'authorized_user']);

  var permission = getPermissionRow_(user.user_id);
  var canViewFinance = user.display_role === 'admin' ||
    yesNo_(permission.view_finance) === 'yes';

  var requestedYm = dashboardPayloadYm_(payload || {});
  var ym = requestedYm;

  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(DASHBOARD_SHEET_NAME_);
  if (!sheet) {
    throw new Error('DASHBOARD_SHEET_MISSING');
  }

  var range = sheet.getRange(1, 1, DASHBOARD_SHEET_MAX_ROW_, DASHBOARD_SHEET_MAX_COL_);
  var values = range.getValues();

  var bAll = DASHBOARD_SHEET_BLOCKS_.all;
  var colYmAll = dashboardSheetFindMonthCol_(values, bAll, ym);
  var fallbackMonth = null;
  if (!colYmAll) {
    fallbackMonth = dashboardSheetFallbackMonthCol_(values, bAll);
    if (!fallbackMonth) {
      throw new Error('DASHBOARD_MONTH_NOT_FOUND:' + ym);
    }
    ym = fallbackMonth.ym;
    colYmAll = fallbackMonth.col;
    setRequestPerfField_('dashboard_month_fallback_from', requestedYm);
    setRequestPerfField_('dashboard_month_fallback_to', ym);
  }

  var nextYm = shiftYm_(ym, 1);
  var colNextAll = dashboardSheetFindMonthCol_(values, bAll, nextYm);

  var totalShort =
    dashboardSheetMetric_(values, DASHBOARD_METRIC_ROWS_.workshop, colYmAll) +
    dashboardSheetMetric_(values, DASHBOARD_METRIC_ROWS_.tour, colYmAll) +
    dashboardSheetMetric_(values, DASHBOARD_METRIC_ROWS_.escape_room, colYmAll);
  var totalLong =
    dashboardSheetMetric_(values, DASHBOARD_METRIC_ROWS_.after_school, colYmAll) +
    dashboardSheetMetric_(values, DASHBOARD_METRIC_ROWS_.course, colYmAll);
  var courseEndings = dashboardSheetMetric_(values, DASHBOARD_METRIC_ROWS_.end_date, colYmAll);
  var exceptionSum = dashboardSheetMetric_(values, DASHBOARD_METRIC_ROWS_.course_total_exceptions, colYmAll);
  var lateEndDateCount = dashboardSheetMetric_(values, DASHBOARD_METRIC_ROWS_.course_late_end_date, colYmAll);
  var operationalGapsCount = dashboardSheetMetric_(values, DASHBOARD_METRIC_ROWS_.course_operational_gaps, colYmAll);
  var nationalInstructors = dashboardSheetInstructorNamesList_(values, colYmAll);
  var uniqueInstructorCount = dashboardSheetUniqueInstructorCount_(values, colYmAll);

  var activeTypeCounts = {
    course: dashboardSheetMetric_(values, DASHBOARD_METRIC_ROWS_.course, colYmAll),
    workshop: dashboardSheetMetric_(values, DASHBOARD_METRIC_ROWS_.workshop, colYmAll),
    tour: dashboardSheetMetric_(values, DASHBOARD_METRIC_ROWS_.tour, colYmAll),
    after_school: dashboardSheetMetric_(values, DASHBOARD_METRIC_ROWS_.after_school, colYmAll),
    escape_room: dashboardSheetMetric_(values, DASHBOARD_METRIC_ROWS_.escape_room, colYmAll)
  };

  var activeNext = colNextAll ? dashboardSheetMetric_(values, DASHBOARD_METRIC_ROWS_.course, colNextAll) : 0;

  var colNorth = dashboardSheetFindMonthCol_(values, DASHBOARD_SHEET_BLOCKS_.north, ym);
  var colSouth = dashboardSheetFindMonthCol_(values, DASHBOARD_SHEET_BLOCKS_.south, ym);

  var byList = [];
  if (colNorth) {
    byList.push(dashboardSheetManagerRow_(values, colNorth, DASHBOARD_SHEET_BLOCKS_.north.manager_name));
  }
  if (colSouth) {
    byList.push(dashboardSheetManagerRow_(values, colSouth, DASHBOARD_SHEET_BLOCKS_.south.manager_name));
  }

  var activeInstructorsByManager = {};
  if (colNorth) {
    activeInstructorsByManager['מחוז צפון'] = dashboardSheetInstructorNamesList_(values, colNorth);
  }
  if (colSouth) {
    activeInstructorsByManager['מחוז דרום'] = dashboardSheetInstructorNamesList_(values, colSouth);
  }

  var financeOpenCount = 0;

  var kpi_cards = dashboardSheetBuildKpiCards_(
    {
      total_short_activities: totalShort,
      total_long_activities: totalLong,
      total_instructors: uniqueInstructorCount,
      total_course_endings_current_month: courseEndings,
      exceptions_count: exceptionSum,
      short: totalShort,
      long: totalLong
    },
    activeTypeCounts,
    canViewFinance,
    financeOpenCount,
    exceptionSum,
    uniqueInstructorCount,
    courseEndings
  );

  return {
    month: ym,
    requested_month: requestedYm,
    month_fallback_used: requestedYm !== ym,
    can_view_finance: canViewFinance,
    totals: {
      total_short_activities: totalShort,
      total_long_activities: totalLong,
      total_instructors: uniqueInstructorCount,
      total_course_endings_current_month: courseEndings,
      exceptions_count: exceptionSum,
      short: totalShort,
      long: totalLong
    },
    by_activity_manager: byList,
    summary: {
      active_courses_current_month: activeTypeCounts.course,
      ending_courses_current_month: courseEndings,
      active_courses_next_month: activeNext,
      exceptions_count: exceptionSum,
      active_instructors: nationalInstructors,
      active_instructors_by_manager: activeInstructorsByManager,
      operational_gaps_count: operationalGapsCount,
      missing_instructor_count: operationalGapsCount,
      missing_start_date_count: 0,
      late_end_date_count: lateEndDateCount,
      short_activities: dashboardSheetBuildShortActivities_(values, colYmAll)
    },
    kpi_cards: kpi_cards,
    show_only_nonzero_kpis: settingYes_('show_only_nonzero_kpis'),
    _is_dashboard_sheet: true
  };
}
