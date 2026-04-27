function actionBootstrap_(user) {
  var permission = getPermissionRow_(user.user_id);
  var routes = effectiveRoutesForUser_(permission, user.display_role);
  var preferred = text_(permission.default_view) || defaultRouteForRole_(user.display_role);
  var defaultRoute = resolveDefaultRoute_(preferred, routes, user.display_role);

  return {
    role: user.display_role,
    default_route: defaultRoute,
    routes: routes,
    can_add_activity: effectiveCanAddActivity_(permission, user.display_role),
    can_edit_direct: effectiveCanEditDirect_(permission, user.display_role),
    can_request_edit: effectiveCanRequestEdit_(permission, user.display_role),
    profile: {
      full_name: text_(permission.full_name),
      display_role2: text_(permission.display_role2)
    },
    client_settings: buildClientSettingsPayload_()
  };
}

/** חודש בקשה YYYY-MM — ברירת מחדל חודש נוכחי */
function dashboardPayloadYm_(payload) {
  var m = text_(payload && payload.month).slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(m)) return m;
  return formatDate_(new Date()).slice(0, 7);
}

function ymBounds_(ym) {
  var parts = String(ym || '').split('-');
  var y = parseInt(parts[0], 10);
  var mo = parseInt(parts[1], 10);
  var tz = Session.getScriptTimeZone();
  if (!y || !mo || mo < 1 || mo > 12) {
    var today = formatDate_(new Date());
    return { first: today.slice(0, 8) + '01', last: today };
  }
  var first = Utilities.formatDate(new Date(y, mo - 1, 1), tz, 'yyyy-MM-dd');
  var last = Utilities.formatDate(new Date(y, mo, 0), tz, 'yyyy-MM-dd');
  return { first: first, last: last };
}

function shiftYm_(ym, deltaMonths) {
  var parts = String(ym || '').split('-');
  var y = parseInt(parts[0], 10);
  var mo = parseInt(parts[1], 10);
  var shifted = new Date(y, mo - 1 + deltaMonths, 1);
  var year = shifted.getFullYear();
  var month = ('0' + (shifted.getMonth() + 1)).slice(-2);
  return year + '-' + month;
}

/** פעילות עם טווח תאריכים שחופף לחודש ym (כולל קצה) */
function activityOverlapsYm_(row, ym) {
  var b = ymBounds_(ym);
  var s = text_(row.start_date);
  var e = text_(row.end_date || row.start_date);
  if (!s) return false;
  if (!e) e = s;
  return s <= b.last && e >= b.first;
}

/**
 * Returns true when the row has at least one session date (Date1-Date35)
 * that falls inside the given YYYY-MM month.
 * Used for long-type programs on the dashboard so that only programs with
 * an actual meeting in the month are counted (not just range-overlap).
 */
function activityHasSessionInYm_(row, ym) {
  for (var i = 1; i <= 35; i++) {
    var d = text_(row['Date' + i]);
    if (d && d.slice(0, 7) === ym) return true;
  }
  return false;
}

/** יום ייחוס ל"פעיל" בתוך חודש — היום בחודש הנוכחי, אחרון בחודש שעבר, ראשון בחודש עתידי */
function dashboardActivityRefIso_(ym) {
  var today = formatDate_(new Date());
  var curYm = today.slice(0, 7);
  var b = ymBounds_(ym);
  if (ym === curYm) return today;
  if (ym < curYm) return b.last;
  return b.first;
}

function countActiveByTypeInYm_(rows, ym, activityType) {
  var ref = dashboardActivityRefIso_(ym);
  return rows.filter(function(row) {
    return activityOverlapsYm_(row, ym) &&
      text_(row.activity_type) === activityType &&
      isActivityActiveBySpec_(row, ref);
  }).length;
}

/* ── parseCsvSetting_, getSettingText_, getSettingBool_, configuredXxx_,
      listValuesForName_, settingYes_, settingShowShabbat_, getWeekStartDay_,
      getLateEndDateCutoff_ — הועברו ל-settings.gs ── */

function rowExceptionTypes_(row) {
  var out = [];
  if (isExcludedStatusForControl_(row && row.status)) return out;
  var hasInstructor1 = !isNormalizedEmptyValue_(row && row.instructor_name) || !isNormalizedEmptyValue_(row && row.emp_id);
  var hasInstructor2 = !isNormalizedEmptyValue_(row && row.instructor_name_2) || !isNormalizedEmptyValue_(row && row.emp_id_2);
  if (!hasInstructor1 && !hasInstructor2) out.push('missing_instructor');
  if (isDataShortRow_(row)) {
    if (!normalizeDateTextToIso_(row && row.start_date)) out.push('missing_start_date');
  } else {
    if (!activityStartDateFromRow_(row)) out.push('missing_start_date');
  }
  if (text_(row.end_date) > getLateEndDateCutoff_()) out.push('late_end_date');
  return out;
}

function collectProgramExceptions_(rows, opts) {
  var options = opts || {};
  var ym = text_(options.month || '');
  var programTypes = configuredProgramActivityTypes_();
  var includePerTypeRows = options.include_per_type_rows !== false;
  var sourceRows = Array.isArray(rows) ? rows : [];
  var counts = {
    missing_instructor: 0,
    missing_start_date: 0,
    late_end_date: 0
  };
  var exceptionRows = [];
  var rowLevelExceptionCount = 0;

  sourceRows.forEach(function(row) {
    if (programTypes.indexOf(text_(row && row.activity_type)) < 0) return;
    if (ym && !activityOverlapsYm_(row, ym)) return;
    var types = rowExceptionTypes_(row);
    if (!types.length) return;
    rowLevelExceptionCount += 1;
    types.forEach(function(type) {
      if (!counts[type]) counts[type] = 0;
      counts[type] += 1;
      if (!includePerTypeRows) return;
      exceptionRows.push({
        RowID: text_(row && row.RowID),
        source_sheet: text_(row && row.source_sheet),
        activity_name: row && row.activity_name,
        activity_manager: row && row.activity_manager,
        activity_type: row && row.activity_type,
        activity_no: row && row.activity_no,
        authority: row && row.authority,
        school: row && row.school,
        funding: row && row.funding,
        grade: text_(row && row.grade),
        class_group: text_(row && row.class_group),
        emp_id: row && row.emp_id,
        instructor_name: row && row.instructor_name,
        emp_id_2: row && row.emp_id_2,
        instructor_name_2: row && row.instructor_name_2,
        status: row && row.status,
        start_date: row && row.start_date,
        end_date: row && row.end_date,
        sessions: row && row.sessions,
        notes: row && row.notes,
        exception_type: type
      });
    });
  });

  return {
    counts: counts,
    rows: exceptionRows,
    total_exception_instances: exceptionRows.length,
    total_exception_rows: rowLevelExceptionCount
  };
}

function primaryExceptionForRow_(row) {
  var types = rowExceptionTypes_(row);
  if (!types.length) return '';
  var rule = getSettingText_('exceptions_primary_rule', 'first_by_priority');
  if (rule === 'first_found') {
    return types[0];
  }
  var priority = configuredExceptionPriority_();
  for (var i = 0; i < priority.length; i++) {
    if (types.indexOf(priority[i]) >= 0) return priority[i];
  }
  return types[0];
}

function normalizeDateTextToIso_(value) {
  return normalizeDateToIsoFlexible_(value);
}

function resolveMappedTimeField_(row, aliases) {
  var src = row || {};
  for (var i = 0; i < aliases.length; i++) {
    var key = aliases[i];
    if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
    if (isNormalizedEmptyValue_(src[key])) continue;
    return normalizeTimeToTextFlexible_(src[key]);
  }
  return '';
}

function mappedStartTime_(row) {
  return resolveMappedTimeField_(row, ['start_time', 'StartTime', 'startTime', 'שעת התחלה']);
}

function mappedEndTime_(row) {
  return resolveMappedTimeField_(row, ['end_time', 'EndTime', 'endTime', 'שעת סיום']);
}

function activityLastValidDateColumnFromRow_(row) {
  var latest = '';
  var latestCol = '';
  for (var i = 1; i <= 35; i++) {
    var key = 'Date' + i;
    var iso = normalizeDateTextToIso_(row && row[key]);
    if (!iso) continue;
    if (!latest || iso > latest) {
      latest = iso;
      latestCol = key;
    }
  }
  return { date: latest, column: latestCol };
}

function buildControlMetricDebugRow_(row, ym, cutoff) {
  var lastValid = activityLastValidDateColumnFromRow_(row);
  var computedStartDate = activityStartDateFromRow_(row);
  var computedEndDate = activityEndDateFromRow_(row);
  var exceptionTypes = rowExceptionTypes_(row);
  return {
    RowID: text_(row.RowID),
    source_sheet: text_(row.source_sheet),
    activity_type: text_(row.activity_type),
    status: text_(row.status),
    instructor_name: row && row.instructor_name,
    instructor_name_2: row && row.instructor_name_2,
    emp_id: row && row.emp_id,
    emp_id_2: row && row.emp_id_2,
    start_date: row && row.start_date,
    Date1: row && row.Date1,
    computed_start_date: computedStartDate,
    computed_end_date: computedEndDate,
    raw_end_date: row && row.end_date,
    last_valid_Date_column: lastValid.column,
    late_end_date_cutoff: cutoff,
    is_missing_instructor: exceptionTypes.indexOf('missing_instructor') >= 0,
    is_missing_start_date: exceptionTypes.indexOf('missing_start_date') >= 0,
    is_excluded_status: isExcludedStatusForControl_(row && row.status),
    overlaps_dashboard_month: activityOverlapsYm_(row, ym),
    is_program_activity_type: configuredProgramActivityTypes_().indexOf(text_(row.activity_type)) >= 0,
    exception_types: exceptionTypes
  };
}

function activityDateColumnsFromRow_(row) {
  var out = [];
  for (var i = 1; i <= 35; i++) {
    var key = 'Date' + i;
    var iso = normalizeDateTextToIso_(row[key]);
    if (!iso) continue;
    out.push(iso);
  }
  return out;
}

function isDataShortRow_(row) {
  var source = text_(row && row.source_sheet);
  if (source) return source === CONFIG.SHEETS.DATA_SHORT;
  return text_(row && row.RowID).indexOf('SHORT-') === 0;
}

function isDataLongRow_(row) {
  var source = text_(row && row.source_sheet);
  if (source) return source === CONFIG.SHEETS.DATA_LONG;
  return text_(row && row.RowID).indexOf('LONG-') === 0;
}

function activityStartDateFromRow_(row) {
  return normalizeDateTextToIso_(row && row.start_date) || '';
}

function activityEndDateFromRow_(row) {
  var start = activityStartDateFromRow_(row);
  return normalizeDateTextToIso_(row && row.end_date) || start || '';
}

function appendDateColumnsToMappedRow_(mapped, sourceRow) {
  for (var i = 1; i <= 35; i++) {
    var key = 'Date' + i;
    mapped[key] = normalizeDateTextToIso_(sourceRow[key]);
  }
  if (mapped.source_sheet === CONFIG.SHEETS.DATA_SHORT) {
    var shortStart = normalizeDateTextToIso_(sourceRow && sourceRow.start_date);
    mapped.start_date = shortStart;
    mapped.end_date = normalizeDateTextToIso_(sourceRow && sourceRow.end_date) || shortStart || '';
  } else {
    mapped.start_date = normalizeDateTextToIso_(sourceRow && sourceRow.start_date) || '';
    mapped.end_date = normalizeDateTextToIso_(sourceRow && sourceRow.end_date) || mapped.start_date || '';
  }
  return mapped;
}

function dateColumnsPatchFromActivityPayload_(activity) {
  var patch = {};
  var hasExplicitDateCols = false;
  for (var i = 1; i <= 35; i++) {
    var key = 'Date' + i;
    if (Object.prototype.hasOwnProperty.call(activity || {}, key)) {
      patch[key] = normalizeDateTextToIso_(activity[key]);
      hasExplicitDateCols = true;
    }
  }
  if (!hasExplicitDateCols) {
    patch.Date1 = normalizeDateTextToIso_(activity && activity.start_date);
    if (normalizeDateTextToIso_(activity && activity.end_date) && normalizeDateTextToIso_(activity && activity.end_date) !== patch.Date1) {
      patch.Date2 = normalizeDateTextToIso_(activity && activity.end_date);
    }
  }
  return patch;
}

function dateColumnsPatchFromChanges_(changes) {
  var patch = {};
  var hasDateColumns = false;
  Object.keys(changes || {}).forEach(function(key) {
    if (/^Date([1-9]|[12]\d|3[0-5])$/.test(key)) {
      patch[key] = normalizeDateTextToIso_(changes[key]);
      hasDateColumns = true;
    }
  });
  if (!hasDateColumns && Object.prototype.hasOwnProperty.call(changes || {}, 'start_date')) {
    patch.Date1 = normalizeDateTextToIso_(changes.start_date);
  }
  return patch;
}

function actionDashboard_(user, payload) {
  requireAnyRole_(user, ['admin', 'operation_manager', 'authorized_user']);

  var permission = getPermissionRow_(user.user_id);
  var canViewFinance = user.display_role === 'admin' ||
    yesNo_(permission.view_finance) === 'yes';

  var ym = dashboardPayloadYm_(payload || {});
  var nextYm = shiftYm_(ym, 1);

  var allSummary = allActivitiesSummary_();
  var oneDayTypes = configuredOneDayActivityTypes_();
  var programTypes = configuredProgramActivityTypes_();
  // meetingsMap already populated inside allActivitiesSummary_() — __rqCache_ hit
  var dashMeetingsMap = buildMeetingsMap_();
  var shortRowsBySource = allSummary.filter(function(row) {
    if (oneDayTypes.indexOf(text_(row.activity_type)) < 0) return false;
    return activityOverlapsYm_(row, ym);
  });
  var longRowsBySource = allSummary.filter(function(row) {
    if (programTypes.indexOf(text_(row.activity_type)) < 0) return false;
    var rowDates = dashMeetingsMap[text_(row.RowID)];
    var normalizedRowDates = [];
    if (rowDates && Object.prototype.toString.call(rowDates) !== '[object Array]') {
      scriptCacheDebugMark_(
        'dashboard_invalid_meetings_map_shape',
        'row:' + text_(row.RowID),
        0,
        'type=' + Object.prototype.toString.call(rowDates)
      );
      rowDates = null;
    } else if (rowDates) {
      var hadNonStringItem = false;
      normalizedRowDates = rowDates.map(function(d) {
        if (Object.prototype.toString.call(d) !== '[object String]') hadNonStringItem = true;
        return text_(d);
      }).filter(Boolean);
      if (hadNonStringItem) {
        scriptCacheDebugMark_(
          'dashboard_invalid_meetings_map_item',
          'row:' + text_(row.RowID),
          0,
          'sample=' + text_(rowDates[0])
        );
      }
    }
    if (normalizedRowDates.some(function(d) { return d.slice(0, 7) === ym; })) return true;
    return activityOverlapsYm_(row, ym);
  });

  var combined = shortRowsBySource.concat(longRowsBySource);
  var shortRows = combined.filter(function(row) {
    return oneDayTypes.indexOf(text_(row.activity_type)) >= 0;
  });
  var longRows = combined.filter(function(row) {
    return programTypes.indexOf(text_(row.activity_type)) >= 0;
  });
  var uniqueInstructorCount = countUniqueOperationalInstructors_(combined);

  // תוכניות פעילות: פתוחות + חופפות לחודש הנוכחי של הדשבורד.
  // הלוגיקה כאן מיושרת לתצוגת activities לחודש כדי למנוע פערים בין המסכים.
  var activeLongRows = longRows.filter(function(row) {
    if (text_(row.status) === 'סגור') return false;
    if (!activityOverlapsYm_(row, ym)) return false;
    return true;
  });

  var byManager = {};
  var managerInstructorSets = {};
  var managerCourseEndings = {};
  var managerFinanceOpen = {};
  var managerExceptions = {};
  var managerActiveLong = {};
  var activeTypeCountsCurrent = {
    course: 0,
    workshop: 0,
    tour: 0,
    after_school: 0,
    escape_room: 0
  };
  var dashboardRefIso = dashboardActivityRefIso_(ym);
  combined.forEach(function(row) {
    var manager = text_(row.activity_manager) || 'unassigned';
    if (!byManager[manager]) {
      byManager[manager] = {
        activity_manager: manager,
        total_short: 0,
        total_long: 0,
        total: 0
      };
    }
    if (!managerInstructorSets[manager]) managerInstructorSets[manager] = {};
    if (!managerCourseEndings[manager]) managerCourseEndings[manager] = 0;
    if (!managerFinanceOpen[manager]) managerFinanceOpen[manager] = 0;
    if (!managerExceptions[manager]) managerExceptions[manager] = 0;
    if (!managerActiveLong[manager]) managerActiveLong[manager] = 0;

    var t = text_(row.activity_type);
    if (oneDayTypes.indexOf(t) >= 0) {
      byManager[manager].total_short += 1;
      byManager[manager].total += 1;
    } else if (programTypes.indexOf(t) >= 0) {
      byManager[manager].total_long += 1;
      byManager[manager].total += 1;
    }

    var empA = text_(row.emp_id);
    var empB = text_(row.emp_id_2);
    if (empA) managerInstructorSets[manager][empA] = true;
    if (empB) managerInstructorSets[manager][empB] = true;

    if (canViewFinance && normalizeFinance_(row.finance_status) === 'open') {
      managerFinanceOpen[manager] += 1;
    }

    if (programTypes.indexOf(t) >= 0) {
      var rowExceptionsCount = rowExceptionTypes_(row).length;
      if (rowExceptionsCount > 0) managerExceptions[manager] += rowExceptionsCount;
      if (t === 'course' && text_(row.end_date).slice(0, 7) === ym) managerCourseEndings[manager] += 1;
    }

    if (activityOverlapsYm_(row, ym) && isActivityActiveBySpec_(row, dashboardRefIso)) {
      if (Object.prototype.hasOwnProperty.call(activeTypeCountsCurrent, t)) {
        activeTypeCountsCurrent[t] += 1;
      }
    }
  });

  activeLongRows.forEach(function(row) {
    var manager = text_(row.activity_manager) || 'unassigned';
    managerActiveLong[manager] = (managerActiveLong[manager] || 0) + 1;
  });

  Object.keys(byManager).forEach(function(manager) {
    byManager[manager].num_instructors = Object.keys(managerInstructorSets[manager] || {}).length;
    byManager[manager].course_endings = managerCourseEndings[manager] || 0;
    if (canViewFinance) byManager[manager].finance_open = managerFinanceOpen[manager] || 0;
    byManager[manager].exceptions = managerExceptions[manager] || 0;
    byManager[manager].total_long = managerActiveLong[manager] || 0;
  });

  var courseEndings = longRows.filter(function(row) {
    return text_(row.activity_type) === 'course' && text_(row.end_date).slice(0, 7) === ym;
  }).length;

  var financeOpenCount = canViewFinance ? combined.filter(function(row) {
    return normalizeFinance_(row.finance_status) === 'open';
  }).length : 0;

  var missingInstructorCount = 0;
  var missingStartDateCount = 0;
  var lateEndDateCount = 0;
  var totalLongRows = longRows.length;
  var relevantLongRows = longRows.filter(function(row) {
    return !isExcludedStatusForControl_(row && row.status);
  });
  var missingInstructorExamples = [];
  var missingStartDateExamples = [];
  var controlMetricDebugRows = [];
  var lateEndDateCutoff = getLateEndDateCutoff_();
  relevantLongRows.forEach(function(row) {
    var exceptionTypes = rowExceptionTypes_(row);
    var needsControlDebug = exceptionTypes.indexOf('missing_instructor') >= 0 ||
      exceptionTypes.indexOf('missing_start_date') >= 0;
    if (needsControlDebug && controlMetricDebugRows.length < 5) {
      controlMetricDebugRows.push(buildControlMetricDebugRow_(row, ym, lateEndDateCutoff));
    }
    if (exceptionTypes.indexOf('missing_instructor') >= 0) {
      missingInstructorCount += 1;
      if (missingInstructorExamples.length < 5) {
        missingInstructorExamples.push({
          RowID: text_(row.RowID),
          instructor_name: row.instructor_name,
          instructor_name_2: row.instructor_name_2,
          emp_id: row.emp_id,
          emp_id_2: row.emp_id_2,
          status: row.status
        });
      }
    }
    if (exceptionTypes.indexOf('missing_start_date') >= 0) {
      missingStartDateCount += 1;
      if (missingStartDateExamples.length < 5) {
        missingStartDateExamples.push({
          RowID: text_(row.RowID),
          start_date: row.start_date,
          status: row.status
        });
      }
    }
    if (exceptionTypes.indexOf('late_end_date') >= 0) lateEndDateCount += 1;
  });
  var exceptionSummary = collectProgramExceptions_(longRows, { month: ym, include_per_type_rows: false });
  missingInstructorCount = exceptionSummary.counts.missing_instructor || 0;
  missingStartDateCount = exceptionSummary.counts.missing_start_date || 0;
  lateEndDateCount = exceptionSummary.counts.late_end_date || 0;
  var exceptionSum = exceptionSummary.total_exception_instances || 0;


  var shortActivitiesByType = {};
  shortRowsBySource.forEach(function(row) {
    if (text_(row.source_sheet) !== CONFIG.SHEETS.DATA_SHORT) return;
    var activityType = text_(row.activity_type);
    if (!activityType) return;
    shortActivitiesByType[activityType] = (shortActivitiesByType[activityType] || 0) + 1;
  });
  var shortActivitiesSummary = Object.keys(shortActivitiesByType).sort().map(function(typeKey) {
    return {
      activity_type: typeKey,
      count: shortActivitiesByType[typeKey]
    };
  });

  var kpi_cards_all = [
    { id: 'short', action: 'kpi|short', title: String(shortRows.length), subtitle: 'חד-יומי', value: shortRows.length },
    { id: 'long', action: 'kpi|long', title: String(activeLongRows.length), subtitle: 'תוכניות', value: activeLongRows.length },
    {
      id: 'active_courses',
      action: 'kpi|active_courses',
      title: String(activeTypeCountsCurrent.course),
      subtitle: 'קורסים פעילים',
      value: activeTypeCountsCurrent.course
    },
    {
      id: 'active_workshops',
      action: 'kpi|active_workshops',
      title: String(activeTypeCountsCurrent.workshop),
      subtitle: 'סדנאות פעילות',
      value: activeTypeCountsCurrent.workshop
    },
    {
      id: 'active_tours',
      action: 'kpi|active_tours',
      title: String(activeTypeCountsCurrent.tour),
      subtitle: 'סיורים פעילים',
      value: activeTypeCountsCurrent.tour
    },
    {
      id: 'active_after_school',
      action: 'kpi|active_after_school',
      title: String(activeTypeCountsCurrent.after_school),
      subtitle: 'אפטרסקול פעיל',
      value: activeTypeCountsCurrent.after_school
    },
    {
      id: 'active_escape_room',
      action: 'kpi|active_escape_room',
      title: String(activeTypeCountsCurrent.escape_room),
      subtitle: 'חדרי בריחה פעילים',
      value: activeTypeCountsCurrent.escape_room
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

  var kpi_cards = canViewFinance
    ? kpi_cards_all
    : kpi_cards_all.filter(function(c) { return !c.requires_finance; });

  var DISTRICT_MANAGER_MAP_ = {
    'גיל נאמן': 'מחוז צפון',
    'לינוי שמואל מזרחי': 'מחוז דרום'
  };
  var activeInstructorsByManager = {};
  Object.keys(DISTRICT_MANAGER_MAP_).forEach(function(manager) {
    var district = DISTRICT_MANAGER_MAP_[manager];
    var names = {};
    combined.forEach(function(row) {
      if ((text_(row.activity_manager) || '') !== manager) return;
      var n1 = text_(row.instructor_name);
      var n2 = text_(row.instructor_name_2);
      if (n1) names[n1] = true;
      if (n2) names[n2] = true;
    });
    activeInstructorsByManager[district] = Object.keys(names).sort();
  });

  var result = {
    month: ym,
    can_view_finance: canViewFinance,
    totals: {
      total_short_activities: shortRows.length,
      total_long_activities: activeLongRows.length,
      total_instructors: uniqueInstructorCount,
      total_course_endings_current_month: courseEndings,
      /** תאימות לאחור לבדיקות / לקוחות ישנים */
      short: shortRows.length,
      long: activeLongRows.length
    },
    by_activity_manager: Object.keys(byManager).sort().map(function(key) {
      return byManager[key];
    }),
    summary: {
      active_courses_current_month: activeTypeCountsCurrent.course,
      ending_courses_current_month: courseEndings,
      active_courses_next_month: countActiveByTypeInYm_(allSummary, nextYm, 'course'),
      exceptions_count: exceptionSum,
      active_instructors: collectUniqueInstructorNames_(combined),
      active_instructors_by_manager: activeInstructorsByManager,
      missing_instructor_count: missingInstructorCount,
      missing_start_date_count: missingStartDateCount,
      late_end_date_count: lateEndDateCount,
      short_activities: shortActivitiesSummary
    },
    kpi_cards: kpi_cards,
    show_only_nonzero_kpis: settingYes_('show_only_nonzero_kpis')
  };
  return result;
}

function actionActivities_(user, payload) {
  requireAnyRole_(user, ['admin', 'operation_manager', 'authorized_user']);
  var permission = getPermissionRow_(user.user_id);
  var canAddActivity = effectiveCanAddActivity_(permission, user.display_role);
  var oneDayTypes = configuredOneDayActivityTypes_();
  var programTypes = configuredProgramActivityTypes_();

  var allRows = allActivitiesSummary_();
  var today = formatDate_(new Date());
  var typeKeys = listValuesForName_('activity_type');
  if (!typeKeys.length) {
    typeKeys = programTypes.concat(oneDayTypes);
  }
  var activityTypeCounts = {};
  typeKeys.forEach(function(t) {
    activityTypeCounts[t] = 0;
  });
  allRows.forEach(function(r) {
    if (text_(r.status) === 'סגור') return;
    var t = text_(r.activity_type);
    if (Object.prototype.hasOwnProperty.call(activityTypeCounts, t)) {
      activityTypeCounts[t] += 1;
    }
  });

  var activityType = text_(payload.activity_type || payload.tab || 'all');
  var financeStatus = text_(payload.finance_status || '');
  var search = text_(payload.search || '').toLowerCase();
  var manager = text_(payload.manager || '');
  var family = text_(payload.family || '');
  var endingCurrentMonth = yesNo_(payload.ending_current_month || 'no') === 'yes';
  var monthFilter = text_(payload.month || formatDate_(new Date()).slice(0, 7));
  var rows = allRows.filter(function(row) {
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
  });

  rows.sort(function(a, b) {
    return text_(a.start_date).localeCompare(text_(b.start_date));
  });

  var noteMap = buildPrivateNotesMap_();
  var activitiesMeetingsMap = buildMeetingsMap_();

  return {
    activity_type_counts: activityTypeCounts,
    rows: rows.map(function(row) {
      return mapActivitySummaryRowForList_(row, user, noteMap, activitiesMeetingsMap, today);
    }),
    can_add_activity: canAddActivity,
    filters: {
      activity_types: activityTypesForFilters_(),
      finance_statuses: financeStatusesForFilters_()
    }
  };
}

function mapActivitySummaryRowForList_(row, user, noteMap, meetingsMap, today) {
  var noteKey = row.source_sheet + '|' + row.RowID;
  var noteRow = noteMap[noteKey];
  var meetingsFromSheet = meetingsMap[text_(row.RowID)] || [];
  var meetingDates = meetingsFromSheet.slice();
  var computedStartDate = '';
  var computedEndDate = '';
  if (isDataLongRow_(row)) {
    var dateRange = meetingDateRangeFromList_(meetingDates);
    computedStartDate = dateRange.start || normalizeDateTextToIso_(row.start_date) || '';
    computedEndDate = dateRange.end || normalizeDateTextToIso_(row.end_date) || computedStartDate;
  } else {
    computedStartDate = normalizeDateTextToIso_(row.start_date) || '';
    computedEndDate = normalizeDateTextToIso_(row.end_date) || computedStartDate;
    if (computedStartDate) meetingDates.push(computedStartDate);
    if (computedEndDate && computedEndDate !== computedStartDate) meetingDates.push(computedEndDate);
  }
  return {
    RowID: row.RowID,
    source_sheet: row.source_sheet,
    activity_manager: row.activity_manager,
    authority: row.authority,
    school: row.school,
    grade: row.grade,
    class_group: row.class_group,
    activity_type: row.activity_type,
    activity_name: row.activity_name,
    emp_id: row.emp_id,
    instructor_name: row.instructor_name,
    emp_id_2: row.emp_id_2,
    instructor_name_2: row.instructor_name_2,
    start_date: computedStartDate,
    end_date: computedEndDate,
    meeting_dates: meetingDates,
    status: row.status,
    finance_status: row.finance_status,
    meetings_total: meetingDates.length,
    meetings_done: meetingDates.filter(function(dateKey) { return dateKey <= today; }).length,
    meetings_remaining: meetingDates.filter(function(dateKey) { return dateKey > today; }).length,
    private_note: user.display_role === 'operation_manager' && noteRow && yesNo_(noteRow.active) === 'yes'
      ? text_(noteRow.note_text)
      : ''
  };
}

function mapActivityDetailRowForDrawer_(row, user) {
  var noteMap = buildPrivateNotesMap_();
  var meetingsMap = buildMeetingsMap_();
  var today = formatDate_(new Date());
  var summary = mapActivitySummaryRowForList_(row, user, noteMap, meetingsMap, today);
  var meetingDates = [];
  if (isDataLongRow_(row)) {
    var meetingsFromSheet = meetingsMap[text_(row.RowID)];
    meetingDates = (meetingsFromSheet && meetingsFromSheet.length) ? meetingsFromSheet.slice() : [];
  } else {
    var shortStart = normalizeDateTextToIso_(summary.start_date);
    var shortEnd = normalizeDateTextToIso_(summary.end_date);
    if (shortStart) meetingDates.push(shortStart);
    if (shortEnd && shortEnd !== shortStart) meetingDates.push(shortEnd);
  }
  var meetingSchedule = meetingDates.map(function(dateKey) {
    return { date: dateKey, performed: dateKey <= today ? 'yes' : 'no' };
  });
  var detail = {
    RowID: summary.RowID,
    source_sheet: summary.source_sheet,
    activity_manager: summary.activity_manager,
    authority: summary.authority,
    school: summary.school,
    grade: text_(row.grade),
    class_group: text_(row.class_group),
    activity_type: summary.activity_type,
    activity_no: row.activity_no,
    activity_name: summary.activity_name,
    sessions: row.sessions,
    price: row.price,
    funding: row.funding,
    start_time: row.start_time,
    end_time: row.end_time,
    emp_id: row.emp_id,
    instructor_name: row.instructor_name,
    emp_id_2: row.emp_id_2,
    instructor_name_2: row.instructor_name_2,
    start_date: summary.start_date,
    end_date: summary.end_date,
    status: summary.status,
    notes: row.notes,
    finance_status: row.finance_status,
    finance_notes: row.finance_notes,
    private_note: summary.private_note,
    meeting_dates: meetingDates,
    meeting_schedule: meetingSchedule,
    meetings_total: summary.meetings_total,
    meetings_done: summary.meetings_done,
    meetings_remaining: summary.meetings_remaining
  };
  for (var i = 1; i <= 35; i++) {
    detail['Date' + i] = normalizeDateTextToIso_(row['Date' + i]);
  }
  return detail;
}

function findActivityRowById_(sourceRowId, sourceSheet) {
  var rowId = text_(sourceRowId);
  if (!rowId) throw new Error('source_row_id is required');
  var sourceCandidates = [];
  if (sourceSheet) {
    sourceCandidates = [text_(sourceSheet)];
  } else {
    sourceCandidates = configuredActivitiesSources_().filter(function(name) {
      return name === CONFIG.SHEETS.DATA_SHORT || name === CONFIG.SHEETS.DATA_LONG;
    });
  }
  var cols = projectedActivityColumnsForDetail_();
  for (var i = 0; i < sourceCandidates.length; i++) {
    var sheetName = sourceCandidates[i];
    var rows = readRowsProjected_(sheetName, cols);
    for (var j = 0; j < rows.length; j++) {
      if (text_(rows[j].RowID) !== rowId) continue;
      return mapProjectedActivityDetailRow_(sheetName, rows[j]);
    }
  }
  throw new Error('Row not found: ' + rowId);
}

function actionActivityDetail_(user, payload) {
  requireAnyRole_(user, ['admin', 'operation_manager', 'authorized_user']);
  var sourceRowId = text_((payload || {}).source_row_id || (payload || {}).RowID);
  var sourceSheet = text_((payload || {}).source_sheet);
  var row = findActivityRowById_(sourceRowId, sourceSheet);
  return { row: mapActivityDetailRowForDrawer_(row, user) };
}

function actionAddActivityOptions_(user) {
  requireAnyRole_(user, ['admin', 'operation_manager', 'authorized_user']);
  var permission = getPermissionRow_(user.user_id);
  if (!effectiveCanAddActivity_(permission, user.display_role)) {
    throw new Error('Forbidden');
  }
  var settings = buildClientSettingsPayload_();
  var opts = settings.dropdown_options || {};
  return {
    one_day_activity_types: settings.one_day_activity_types || configuredOneDayActivityTypes_(),
    program_activity_types: settings.program_activity_types || configuredProgramActivityTypes_(),
    dropdown_options: {
      activity_type: opts.activity_type || opts.activity_types || [],
      activity_names: opts.activity_names || [],
      activity_manager: opts.activity_manager || [],
      instructor_name: opts.instructor_name || [],
      instructor_users: opts.instructor_users || [],
      funding: opts.funding || opts.fundings || [],
      grade: opts.grade || opts.grades || []
    }
  };
}

function actionActivityDraftOptions_(user, payload) {
  requireAnyRole_(user, ['admin', 'operation_manager', 'authorized_user']);
  var permission = getPermissionRow_(user.user_id);
  if (!effectiveCanAddActivity_(permission, user.display_role)) {
    throw new Error('Forbidden');
  }
  var settings = buildClientSettingsPayload_();
  var opts = settings.dropdown_options || {};
  return {
    one_day_activity_types: configuredOneDayActivityTypes_(),
    program_activity_types: configuredProgramActivityTypes_(),
    dropdown_options: opts,
    constrained_fields_use_dropdown: settings.constrained_fields_use_dropdown !== false,
    can_add_activity: true
  };
}

/** YYYY-MM ייחודיים לשבוע לוח (7 ימים מ-anchor) — לצורך טעינת month payload / view */
function weekUniqueYmsFromAnchor_(anchor) {
  var yms = [];
  var seen = {};
  for (var i = 0; i < 7; i++) {
    var d = shiftDate_(anchor, i);
    var ym = formatDate_(d).slice(0, 7);
    if (seen[ym]) continue;
    seen[ym] = true;
    yms.push(ym);
  }
  return yms;
}

/**
 * טוען לכל ym ברשימה month payload מ-ScriptCache או מ-view_activity_meetings (קריאה אחת לגיליון).
 * חודש ללא שורות ב-view — נבנה payload ריק (תאים עם item_ids ריקים) ונשמר ב-cache, כדי שלא ניפול ל-fallback בשבועות שחוצים חודש.
 */
function ensureMonthPayloadBundleForYms_(yms) {
  var byYm = {};
  var need = [];
  var usedCacheOnly = true;
  var idx;
  for (idx = 0; idx < yms.length; idx++) {
    var ym = text_(yms[idx]);
    var cacheKey = monthPayloadCacheKey_(ym);
    var cached = null;
    try {
      cached = cacheKey ? scriptCacheGetJson_(cacheKey) : null;
    } catch (_e) {
      cached = null;
    }
    if (cached && typeof cached === 'object' && Array.isArray(cached.cells) && text_(cached.month).slice(0, 7) === ym) {
      byYm[ym] = cached;
    } else {
      need.push(ym);
      usedCacheOnly = false;
    }
  }
  if (need.length === 0) {
    return { ok: true, byYm: byYm, viewRowsRead: 0, filteredRowsTotal: 0, usedCacheOnly: true };
  }
  var projected = [
    'month_ym', 'meeting_date', 'source_sheet', 'source_row_id',
    'activity_type', 'activity_name', 'activity_manager',
    'authority', 'school', 'funding', 'grade', 'class_group',
    'instructor_name', 'instructor_name_2', 'emp_id', 'emp_id_2',
    'status', 'start_time', 'end_time', 'start_date', 'end_date',
    'activity_no', 'private_note'
  ];
  var viewRowsAll;
  try {
    viewRowsAll = readRowsProjected_(CONFIG.SHEETS.VIEW_ACTIVITY_MEETINGS, projected);
  } catch (_readErr) {
    return { ok: false };
  }
  var viewRowsRead = viewRowsAll.length;
  var filteredRowsTotal = 0;
  for (idx = 0; idx < need.length; idx++) {
    var ymNeed = text_(need[idx]);
    var parts = String(ymNeed).split('-');
    var y = parseInt(parts[0], 10);
    var mo = parseInt(parts[1], 10) - 1;
    var viewRows = viewRowsAll.filter(function(row) {
      return normalizeMonthYmFlexible_(row.month_ym) === ymNeed;
    });
    filteredRowsTotal += viewRows.length;
    var built = buildMonthResponseFromMeetingViewRows_(viewRows, y, mo);
    var putKey = monthPayloadCacheKey_(ymNeed);
    if (putKey) scriptCachePutJson_(putKey, built, 21600);
    byYm[ymNeed] = built;
  }
  for (idx = 0; idx < yms.length; idx++) {
    if (!byYm[text_(yms[idx])]) return { ok: false };
  }
  return { ok: true, byYm: byYm, viewRowsRead: viewRowsRead, filteredRowsTotal: filteredRowsTotal, usedCacheOnly: false };
}

function calendarItemIdsForDateFromMonthBundle_(byYm, dateKey) {
  var dk = text_(dateKey);
  if (!dk || dk.length < 7) return [];
  var ym = dk.slice(0, 7);
  var mp = byYm[ym];
  if (!mp) return [];
  var cells = mp.cells || [];
  for (var i = 0; i < cells.length; i++) {
    if (text_(cells[i].date) === dk) return (cells[i].item_ids || []).slice();
  }
  return [];
}

function buildWeekResponseFromMonthBundle_(byYm, anchor, showSat, weekStartsOn, hideSatColumn, weekOffset) {
  var mergedItems = {};
  Object.keys(byYm || {}).forEach(function(ym) {
    var mp = byYm[ym] || {};
    var src = mp.items_by_id || {};
    Object.keys(src).forEach(function(rid) {
      mergedItems[rid] = src[rid];
    });
  });
  var days = [];
  var neededIds = {};
  for (var i = 0; i < 7; i++) {
    var d = shiftDate_(anchor, i);
    var dow = d.getDay();
    if (!showSat && dow === 6) continue;
    var key = formatDate_(d);
    var ids = calendarItemIdsForDateFromMonthBundle_(byYm, key);
    for (var j = 0; j < ids.length; j++) neededIds[text_(ids[j])] = true;
    days.push({
      date: key,
      weekday_label: hebrewWeekdayLabel_(dow),
      item_ids: ids
    });
  }
  var itemsById = {};
  Object.keys(neededIds).forEach(function(rid) {
    if (mergedItems[rid]) itemsById[rid] = mergedItems[rid];
  });
  return {
    days: days,
    items_by_id: itemsById,
    week_starts_on: weekStartsOn,
    show_shabbat: showSat,
    week_hide_saturday_column: hideSatColumn,
    week_offset: weekOffset
  };
}

function filterWeekPayloadForInstructor_(weekPayload, empId) {
  var normalizedEmpId = text_(empId);
  if (!normalizedEmpId) return weekPayload;
  var source = weekPayload || {};
  var sourceItems = source.items_by_id || {};
  var itemsById = {};
  Object.keys(sourceItems).forEach(function(rowId) {
    var item = sourceItems[rowId] || {};
    if (text_(item.emp_id) === normalizedEmpId || text_(item.emp_id_2) === normalizedEmpId) {
      itemsById[rowId] = item;
    }
  });
  var days = (source.days || []).map(function(day) {
    var itemIds = (day.item_ids || []).filter(function(rowId) {
      return !!itemsById[rowId];
    });
    return {
      date: day.date,
      weekday_label: day.weekday_label,
      item_ids: itemIds
    };
  });
  return {
    days: days,
    items_by_id: itemsById,
    week_starts_on: source.week_starts_on,
    show_shabbat: source.show_shabbat,
    week_hide_saturday_column: source.week_hide_saturday_column,
    week_offset: source.week_offset
  };
}

function normalizeWeekPayloadShape_(payload) {
  var source = payload || {};
  var srcItems = source.items_by_id && typeof source.items_by_id === 'object' ? source.items_by_id : {};
  var itemsById = {};
  Object.keys(srcItems).forEach(function(rowId) {
    if (!rowId) return;
    itemsById[text_(rowId)] = srcItems[rowId];
  });

  var days = Array.isArray(source.days) ? source.days : [];
  var normalizedDays = days.map(function(day) {
    var normalizedDate = text_(day && day.date);
    var normalizedDow = text_(day && day.weekday_label);
    var dayItems = Array.isArray(day && day.items) ? day.items.filter(Boolean) : null;
    var dayItemIds = [];
    if (Array.isArray(day && day.item_ids)) {
      dayItemIds = day.item_ids.map(function(id) { return text_(id); }).filter(Boolean);
    } else if (dayItems && dayItems.length) {
      dayItemIds = dayItems
        .map(function(item) { return text_(item && item.RowID); })
        .filter(Boolean);
    }

    return {
      date: normalizedDate,
      weekday_label: normalizedDow,
      item_ids: dayItemIds
    };
  });

  return {
    days: normalizedDays,
    items_by_id: itemsById,
    week_starts_on: source.week_starts_on,
    show_shabbat: source.show_shabbat,
    week_hide_saturday_column: source.week_hide_saturday_column,
    week_offset: source.week_offset
  };
}

function actionWeekLegacy_(user, payload) {
  requireAnyRole_(user, ['admin', 'operation_manager', 'authorized_user', 'instructor']);

  var today = new Date();
  var startDay = getWeekStartDay_();
  var weekOffset = parseInt((payload && payload.week_offset) || 0, 10) || 0;
  var anchor = shiftDate_(startOfWeekContaining_(today, startDay), weekOffset * 7);
  var showSat = settingShowShabbat_();
  var hideSatColumn = getSettingBool_('week_hide_saturday_column', false);
  if (hideSatColumn) showSat = false;
  var calRows = visibleActivitiesSummaryForUser_(user);
  var meetingsMap = buildMeetingsMap_();
  var fromDate = formatDate_(anchor);
  var toDate = formatDate_(shiftDate_(anchor, 6));
  var calendarIndex = buildCalendarIndexForDateRange_(calRows, meetingsMap, fromDate, toDate);
  var itemsById = calendarIndex.items_by_id;
  var byDate = calendarIndex.by_date;

  var days = [];
  for (var i = 0; i < 7; i++) {
    var d = shiftDate_(anchor, i);
    var dow = d.getDay();
    if (!showSat && dow === 6) {
      continue;
    }
    var key = formatDate_(d);
    days.push({
      date: key,
      weekday_label: hebrewWeekdayLabel_(dow),
      item_ids: byDate[key] || []
    });
  }

  return normalizeWeekPayloadShape_({
    days: days,
    items_by_id: itemsById,
    week_starts_on: startDay,
    show_shabbat: showSat,
    week_hide_saturday_column: hideSatColumn,
    week_offset: weekOffset
  });
}

function actionWeek_(user, payload) {
  requireAnyRole_(user, ['admin', 'operation_manager', 'authorized_user', 'instructor']);

  var today = new Date();
  var startDay = getWeekStartDay_();
  var weekOffset = parseInt((payload && payload.week_offset) || 0, 10) || 0;
  var anchor = shiftDate_(startOfWeekContaining_(today, startDay), weekOffset * 7);
  var showSat = settingShowShabbat_();
  var hideSatColumn = getSettingBool_('week_hide_saturday_column', false);
  if (hideSatColumn) showSat = false;

  var yms = weekUniqueYmsFromAnchor_(anchor);
  markRequestPerf_('week:cache lookup:start');
  var ensured = null;
  try {
    ensured = ensureMonthPayloadBundleForYms_(yms);
  } catch (_ensureErr) {
    ensured = { ok: false };
  }
  markRequestPerf_('week:cache lookup:end');

  if (!ensured || !ensured.ok) {
    setRequestPerfField_('week_used_view', false);
    setRequestPerfField_('week_used_cache', false);
    setRequestPerfField_('week_fallback_used', true);
    setRequestPerfField_('week_view_rows_read', 0);
    setRequestPerfField_('week_filtered_rows', 0);
    markRequestPerf_('week:used_view:false');
    markRequestPerf_('week:fallback_used:true');
    var legacyWeek = normalizeWeekPayloadShape_(actionWeekLegacy_(user, payload));
    setRequestPerfField_('payload_bytes', JSON.stringify(legacyWeek || {}).length);
    return legacyWeek;
  }

  var weekPayload = buildWeekResponseFromMonthBundle_(ensured.byYm, anchor, showSat, startDay, hideSatColumn, weekOffset);
  if (user.display_role === 'instructor') {
    weekPayload = filterWeekPayloadForInstructor_(weekPayload, text_(user.emp_id || user.user_id));
  }
  weekPayload = normalizeWeekPayloadShape_(weekPayload);

  setRequestPerfField_('week_used_view', true);
  setRequestPerfField_('week_used_cache', !!ensured.usedCacheOnly);
  setRequestPerfField_('week_fallback_used', false);
  setRequestPerfField_('week_view_rows_read', ensured.viewRowsRead);
  setRequestPerfField_('week_filtered_rows', ensured.filteredRowsTotal);
  setRequestPerfField_('payload_bytes', JSON.stringify(weekPayload || {}).length);
  markRequestPerf_('week:used_view:true');
  markRequestPerf_(ensured.usedCacheOnly ? 'week:used_cache:true' : 'week:used_cache:false');
  markRequestPerf_('week:fallback_used:false');
  return weekPayload;
}

function buildMonthResponseFromMeetingViewRows_(rows, year, month) {
  var daysInMonth = new Date(year, month + 1, 0).getDate();
  var byDate = {};
  var itemsById = {};

  (rows || []).forEach(function(row) {
    var rowId = text_(row.source_row_id);
    var dateKey = normalizeDateTextToIso_(row.meeting_date);
    if (!rowId || !dateKey) return;
    if (!itemsById[rowId]) {
      itemsById[rowId] = {
        RowID: rowId,
        source_sheet: text_(row.source_sheet),
        activity_manager: text_(row.activity_manager),
        authority: text_(row.authority),
        school: text_(row.school),
        grade: text_(row.grade),
        class_group: text_(row.class_group),
        activity_type: text_(row.activity_type),
        activity_no: text_(row.activity_no),
        activity_name: text_(row.activity_name),
        funding: text_(row.funding),
        start_time: text_(row.start_time),
        end_time: text_(row.end_time),
        emp_id: text_(row.emp_id),
        instructor_name: text_(row.instructor_name),
        emp_id_2: text_(row.emp_id_2),
        instructor_name_2: text_(row.instructor_name_2),
        start_date: normalizeDateTextToIso_(row.start_date),
        end_date: normalizeDateTextToIso_(row.end_date) || normalizeDateTextToIso_(row.start_date),
        status: text_(row.status),
        private_note: text_(row.private_note)
      };
    }
    if (!byDate[dateKey]) byDate[dateKey] = [];
    if (byDate[dateKey].indexOf(rowId) < 0) byDate[dateKey].push(rowId);
  });

  var cells = [];
  for (var i = 1; i <= daysInMonth; i++) {
    var d = new Date(year, month, i);
    var key = formatDate_(d);
    cells.push({
      day: i,
      date: key,
      item_ids: byDate[key] || []
    });
  }

  var mm = month + 1;
  return {
    month: year + '-' + (mm < 10 ? '0' : '') + mm,
    cells: cells,
    items_by_id: itemsById,
    hide_saturday: false
  };
}

function filterMonthPayloadForInstructor_(monthPayload, empId) {
  var source = monthPayload || {};
  var normalizedEmpId = text_(empId);
  if (!normalizedEmpId) return source;
  var sourceItems = source.items_by_id || {};
  var itemsById = {};
  Object.keys(sourceItems).forEach(function(rowId) {
    var item = sourceItems[rowId] || {};
    if (text_(item.emp_id) === normalizedEmpId || text_(item.emp_id_2) === normalizedEmpId) {
      itemsById[rowId] = item;
    }
  });
  var cells = (source.cells || []).map(function(cell) {
    var itemIds = (cell.item_ids || []).filter(function(rowId) {
      return !!itemsById[rowId];
    });
    return {
      day: cell.day,
      date: cell.date,
      item_ids: itemIds
    };
  });
  return {
    month: text_(source.month),
    cells: cells,
    items_by_id: itemsById,
    hide_saturday: !!source.hide_saturday
  };
}

function actionMonthLegacy_(user, year, month) {
  var daysInMonth = new Date(year, month + 1, 0).getDate();
  var calRows = visibleActivitiesSummaryForUser_(user);
  var meetingsMap = buildMeetingsMap_();
  var monthStart = formatDate_(new Date(year, month, 1));
  var monthEnd = formatDate_(new Date(year, month, daysInMonth));
  var calendarIndex = buildCalendarIndexForDateRange_(calRows, meetingsMap, monthStart, monthEnd);
  var itemsById = calendarIndex.items_by_id;
  var byDate = calendarIndex.by_date;

  var cells = [];
  for (var i = 1; i <= daysInMonth; i++) {
    var d = new Date(year, month, i);
    var key = formatDate_(d);
    cells.push({
      day: i,
      date: key,
      item_ids: byDate[key] || []
    });
  }

  var mm = month + 1;
  return {
    month: year + '-' + (mm < 10 ? '0' : '') + mm,
    cells: cells,
    items_by_id: itemsById,
    hide_saturday: false
  };
}

function actionMonth_(user, payload) {
  requireAnyRole_(user, ['admin', 'operation_manager', 'authorized_user', 'instructor']);
  var now = new Date();
  var ym = text_(payload && payload.ym).slice(0, 7);
  var ymMatch = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(ym);
  var year, month;
  if (ymMatch) {
    year = parseInt(ymMatch[1], 10);
    month = parseInt(ymMatch[2], 10) - 1;
  } else {
    year = now.getFullYear();
    month = now.getMonth();
  }

  var targetYm = year + '-' + ('0' + (month + 1)).slice(-2);
  var viewRowsRead = 0;
  var filteredRows = 0;
  var buildStartMs = perfNowMs_();
  var buildMs = 0;
  var monthCacheHit = false;
  var usedMonthPayloadCache = false;
  var usedView = false;
  var monthPayload = null;

  markRequestPerf_('month:cache lookup:start');
  try {
    var payloadCacheKey = monthPayloadCacheKey_(targetYm);
    var cachedMonthPayload = payloadCacheKey ? scriptCacheGetJson_(payloadCacheKey) : null;
    if (cachedMonthPayload && typeof cachedMonthPayload === 'object') {
      monthPayload = cachedMonthPayload;
      monthCacheHit = true;
      usedMonthPayloadCache = true;
      usedView = true;
    }
  } catch (_cacheErr) {}
  markRequestPerf_('month:cache lookup:end');

  markRequestPerf_('month:view lookup:start');
  if (!monthPayload) {
    var projected = [
      'month_ym', 'meeting_date', 'source_sheet', 'source_row_id',
      'activity_type', 'activity_name', 'activity_manager',
      'authority', 'school', 'funding', 'grade', 'class_group',
      'instructor_name', 'instructor_name_2', 'emp_id', 'emp_id_2',
      'status', 'start_time', 'end_time', 'start_date', 'end_date',
      'activity_no', 'private_note'
    ];
    try {
      var viewRowsAll = readRowsProjected_(CONFIG.SHEETS.VIEW_ACTIVITY_MEETINGS, projected);
      viewRowsRead = viewRowsAll.length;
      var viewRows = viewRowsAll.filter(function(row) {
        return normalizeMonthYmFlexible_(row.month_ym) === targetYm;
      });
      filteredRows = viewRows.length;
      if (viewRows.length > 0) {
        monthPayload = buildMonthResponseFromMeetingViewRows_(viewRows, year, month);
        buildMs = Math.max(0, perfNowMs_() - buildStartMs);
        var cacheKey = monthPayloadCacheKey_(targetYm);
        if (cacheKey) scriptCachePutJson_(cacheKey, monthPayload, 21600);
        usedView = true;
      }
    } catch (_viewErr) {
      usedView = false;
      monthPayload = null;
    }
  }
  markRequestPerf_('month:view lookup:end');

  setRequestPerfField_('month_cache_hit', monthCacheHit);
  setRequestPerfField_('used_month_payload_cache', usedMonthPayloadCache);
  setRequestPerfField_('view_rows_read', viewRowsRead);
  setRequestPerfField_('filtered_rows', filteredRows);
  setRequestPerfField_('build_ms', buildMs);

  if (usedView) {
    if (user.display_role === 'instructor') {
      monthPayload = filterMonthPayloadForInstructor_(monthPayload, text_(user.emp_id || user.user_id));
    }
    markRequestPerf_('month:used_view:true');
    return monthPayload;
  }
  markRequestPerf_('month:fallback_used:true');
  return actionMonthLegacy_(user, year, month);
}

function actionExceptions_(user, payload) {
  requireAnyRole_(user, ['admin', 'operation_manager', 'authorized_user']);
  var month = text_((payload && payload.month) || '');
  var rows = enrichRowsWithMeetings_(allActivitiesSummary_().slice());
  var exceptionPayload = collectProgramExceptions_(rows, {
    month: month,
    include_per_type_rows: true
  });
  var counts = exceptionPayload.counts || {};
  var result = exceptionPayload.rows || [];
  var relevantRows = rows.filter(function(row) {
    return !isExcludedStatusForControl_(row && row.status) &&
      configuredProgramActivityTypes_().indexOf(text_(row && row.activity_type)) >= 0 &&
      (!month || activityOverlapsYm_(row, month));
  });
  var missingInstructorExamples = [];
  var missingStartDateExamples = [];

  relevantRows.forEach(function(row) {
    var types = rowExceptionTypes_(row);
    if (!types.length) return;
    if (types.indexOf('missing_instructor') >= 0 && missingInstructorExamples.length < 5) {
      missingInstructorExamples.push({
        RowID: text_(row.RowID),
        instructor_name: row.instructor_name,
        instructor_name_2: row.instructor_name_2,
        emp_id: row.emp_id,
        emp_id_2: row.emp_id_2,
        status: row.status
      });
    }
    if (types.indexOf('missing_start_date') >= 0 && missingStartDateExamples.length < 5) {
      missingStartDateExamples.push({
        RowID: text_(row.RowID),
        start_date: row.start_date,
        status: row.status
      });
    }
  });

  return {
    month: month || '',
    rows: result,
    counts: counts,
    priority: configuredExceptionPriority_()
  };
}

function actionFinance_(user, payload) {
  requireAnyRole_(user, ['admin', 'operation_manager', 'authorized_user']);

  var today = formatDate_(new Date());
  var rule = getSettingText_('finance_display_rule', CONFIG.DEFAULT_FINANCE_DISPLAY_RULE || 'ended_until_today');
  var groupingRule = getSettingText_('finance_grouping_rule', CONFIG.DEFAULT_FINANCE_GROUPING_RULE || 'gafen_by_school_else_funding');
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var dateFrom = text_((payload || {}).date_from || '');
  var dateTo = text_((payload || {}).date_to || '');
  var search = text_((payload || {}).search || '').toLowerCase();
  var statusFilter = text_((payload || {}).status || '');
  var tab = text_((payload || {}).tab || 'active');
  var monthYm = text_((payload || {}).month || '');
  var monthFilterEnabled = monthYm && /^\d{4}-\d{2}$/.test(monthYm);
  var prevYm = '';
  if (dateFrom && !DATE_RE.test(dateFrom)) dateFrom = '';
  if (dateTo && !DATE_RE.test(dateTo)) dateTo = '';
  if (monthFilterEnabled) {
    var p = monthYm.split('-');
    var yy = parseInt(p[0], 10);
    var mm = parseInt(p[1], 10);
    var prev = new Date(yy, mm - 2, 1);
    prevYm = Utilities.formatDate(prev, Session.getScriptTimeZone(), 'yyyy-MM');
  }

  var rows = allActivitiesSummary_().filter(function(row) {
    var endOrStart = text_(row.end_date || row.start_date);
    if (rule === 'ended_until_today') {
      if (!endOrStart || endOrStart > today) return false;
    }
    if (dateFrom || dateTo) {
      if (!endOrStart) return false;
      if (dateFrom && endOrStart < dateFrom) return false;
      if (dateTo && endOrStart > dateTo) return false;
    }
    if (monthFilterEnabled) {
      var ym = text_(row.end_date || '').slice(0, 7);
      if (ym !== monthYm && ym !== prevYm) return false;
    }
    var isArchived = text_(row.is_archived || row.archive).toLowerCase();
    if (tab === 'active' && (isArchived === 'yes' || isArchived === 'true' || isArchived === '1')) return false;
    if (tab === 'archive' && !(isArchived === 'yes' || isArchived === 'true' || isArchived === '1')) return false;
    if (statusFilter && text_(normalizeFinance_(row.finance_status)) !== statusFilter) return false;
    if (search) {
      var hay = [
        row.RowID, row.activity_name, row.school, row.activity_manager,
        row.funding, row.authority, row.Payer, row.grade, row.class_group
      ].map(text_).join(' ').toLowerCase();
      if (hay.indexOf(search) < 0) return false;
    }
    return true;
  });

  var mappedRows = rows.map(function(row) {
    var price = parseFloat(row.price) || 0;
    var sessions = parseFloat(row.sessions) || 0;
    var amount = sessions > 0 ? price * sessions : price;
    var mapped = {
      RowID: row.RowID,
      source_sheet: row.source_sheet,
      activity_name: row.activity_name,
      emp_id: text_(row.emp_id),
      emp_id_2: text_(row.emp_id_2),
      instructor_name: text_(row.instructor_name),
      instructor_name_2: text_(row.instructor_name_2),
      finance_status: normalizeFinance_(row.finance_status),
      finance_notes: text_(row.finance_notes),
      status: text_(row.status),
      activity_manager: text_(row.activity_manager),
      authority: text_(row.authority),
      school: text_(row.school),
      grade: text_(row.grade),
      class_group: text_(row.class_group),
      activity_type: text_(row.activity_type),
      funding: text_(row.funding),
      start_date: text_(row.start_date),
      end_date: text_(row.end_date || row.start_date),
      price: price,
      sessions: sessions,
      amount: amount,
      is_archived: text_(row.is_archived || row.archive || ''),
      Payer: text_(row.Payer || row.payer || ''),
      Payment: parseFloat(row.Payment || row.payment || '') || 0
    };
    return mapped;
  });

  var totalOpen = 0, totalClosed = 0, totalOther = 0;
  var amountOpen = 0, amountClosed = 0, amountOther = 0;
  var managerMap = {};
  mappedRows.forEach(function(r) {
    var st = String(r.finance_status || '').toLowerCase();
    /* Prefer actual Payment (collected) over expected price×sessions */
    var explicitPayment = parseFloat(r.Payment) || 0;
    var price = parseFloat(r.price) || 0;
    var sessions = parseFloat(r.sessions) || 0;
    var amount = explicitPayment > 0 ? explicitPayment : (sessions > 0 ? price * sessions : price);

    if (st === 'open') { totalOpen++; amountOpen += amount; }
    else if (st === 'closed') { totalClosed++; amountClosed += amount; }
    else { totalOther++; amountOther += amount; }

    var mgr = String(r.activity_manager || '').trim() || '—';
    if (!managerMap[mgr]) managerMap[mgr] = { mgr: mgr, total: 0, open: 0, closed: 0, other: 0, amountOpen: 0, amountClosed: 0, amountOther: 0, amountTotal: 0 };
    managerMap[mgr].total++;
    managerMap[mgr].amountTotal += amount;
    if (st === 'open') { managerMap[mgr].open++; managerMap[mgr].amountOpen += amount; }
    else if (st === 'closed') { managerMap[mgr].closed++; managerMap[mgr].amountClosed += amount; }
    else { managerMap[mgr].other++; managerMap[mgr].amountOther += amount; }
  });

  var byManager = Object.keys(managerMap).map(function(k) { return managerMap[k]; }).sort(function(a, b) { return b.total - a.total; });

  return {
    rows: mappedRows,
    finance_grouping_rule: groupingRule,
    aggregates: {
      total: mappedRows.length,
      totalOpen: totalOpen,
      totalClosed: totalClosed,
      totalOther: totalOther,
      amountOpen: amountOpen,
      amountClosed: amountClosed,
      amountOther: amountOther,
      amountTotal: amountOpen + amountClosed + amountOther,
      byManager: byManager
    }
  };
}

function actionFinanceDetail_(user, payload) {
  requireAnyRole_(user, ['admin', 'operation_manager', 'authorized_user']);
  var sourceRowId = text_((payload || {}).source_row_id || (payload || {}).RowID);
  var sourceSheet = text_((payload || {}).source_sheet);
  var row = findActivityRowById_(sourceRowId, sourceSheet);
  var mapped = mapActivityDetailRowForDrawer_(row, user);
  mapped.finance_status = normalizeFinance_(mapped.finance_status);
  return { row: mapped };
}

function actionInstructors_(user) {
  requireAnyRole_(user, ['admin', 'operation_manager', 'authorized_user']);

  var all = allActivitiesSummary_();
  var ym = formatDate_(new Date()).slice(0, 7);
  var programTypes = configuredProgramActivityTypes_();
  var oneDayTypes  = configuredOneDayActivityTypes_();
  var enrichMap    = readInstructorContactsEnrichmentMap_();

  var instructorMap = {};

  function ensureInstructor(empId, nameFromActivity) {
    if (!empId) return;
    if (!instructorMap[empId]) {
      var contact  = enrichMap[empId];
      var fullName = contact ? text_(contact.full_name) : (nameFromActivity || empId);
      instructorMap[empId] = {
        emp_id:          empId,
        full_name:       fullName,
        programs_count:  0,
        one_day_count:   0,
        latest_end_date: ''
      };
    }
    if (!instructorMap[empId].full_name && nameFromActivity) {
      instructorMap[empId].full_name = nameFromActivity;
    }
  }

  all.forEach(function(row) {
    var e1 = text_(row.emp_id);
    var e2 = text_(row.emp_id_2);
    ensureInstructor(e1, text_(row.instructor_name));
    ensureInstructor(e2, text_(row.instructor_name_2));

    var isActive  = activityOverlapsYm_(row, ym);
    var actType   = text_(row.activity_type);
    var isProgram = programTypes.indexOf(actType) >= 0;
    var isOneDay  = oneDayTypes.indexOf(actType)  >= 0;
    var endDate   = text_(row.end_date);

    [e1, e2].forEach(function(empId) {
      if (!empId || !instructorMap[empId]) return;
      var inst = instructorMap[empId];
      if (isActive) {
        if (isProgram) inst.programs_count++;
        if (isOneDay)  inst.one_day_count++;
      }
      if (endDate && (!inst.latest_end_date || endDate > inst.latest_end_date)) {
        inst.latest_end_date = endDate;
      }
    });
  });

  var rows = Object.keys(instructorMap)
    .map(function(id) { return instructorMap[id]; })
    .sort(function(a, b) {
      return String(a.full_name || a.emp_id || '').localeCompare(
        String(b.full_name || b.emp_id || ''), 'he');
    });

  return { rows: rows, ym: ym, program_types: programTypes, one_day_types: oneDayTypes };
}

function actionContacts_(user) {
  requireAnyRole_(user, ['admin', 'operation_manager', 'authorized_user']);
  var permission = getPermissionRow_(user.user_id);
  var canViewInstructors = instructorContactsViewYes_(permission);
  var canViewSchools     = schoolContactsViewYes_(permission);

  if (!canViewInstructors && !canViewSchools) {
    throw new Error('Forbidden');
  }

  var instructorRows = canViewInstructors
    ? readRows_(configuredInstructorContactsSourceSheet_()).map(function(row, idx) {
        return {
          _row_index: idx,
          emp_id:          text_(row.emp_id),
          full_name:       text_(row.full_name),
          mobile:          text_(row.mobile),
          email:           text_(row.email),
          address:         text_(row.address),
          employment_type: text_(row.employment_type),
          direct_manager:  text_(row.direct_manager),
          active:          yesNo_(row.active)
        };
      })
    : [];

  var schoolRows = canViewSchools
    ? readRows_(configuredSchoolContactsSourceSheet_()).map(function(row, idx) {
        return {
          _row_index: idx,
          authority:    text_(row.authority),
          school:       text_(row.school),
          contact_name: text_(row.contact_name),
          role:         text_(row.role),
          phone:        text_(row.phone),
          mobile:       text_(row.mobile),
          email:        text_(row.email),
          notes:        text_(row.notes || '')
        };
      })
    : [];

  return {
    instructor_rows:      instructorRows,
    school_rows:          schoolRows,
    can_view_instructors: canViewInstructors,
    can_view_schools:     canViewSchools
  };
}

function canManageContacts_(user, kind) {
  if (!user) return false;
  if (user.display_role === 'admin' || user.display_role === 'operation_manager') return true;
  var permission = getPermissionRow_(user.user_id);
  if (kind === 'instructor') return instructorContactsViewYes_(permission);
  if (kind === 'school') return schoolContactsViewYes_(permission);
  return false;
}

function updateRowByIndex_(sheetName, rowIndex, changes) {
  var sheet = getSheet_(sheetName);
  var headers = getHeaders_(sheet);
  var rows = readRows_(sheetName);
  var idx = parseInt(text_(rowIndex), 10);
  if (isNaN(idx) || idx < 0 || idx >= rows.length) throw new Error('Row not found');
  var updated = {};
  headers.forEach(function(header) {
    updated[header] = Object.prototype.hasOwnProperty.call(changes, header)
      ? changes[header]
      : rows[idx][header];
  });
  var rowNumber = getDataStartRow_() + idx;
  var values = headers.map(function(header) { return updated[header]; });
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([values]);
  invalidateReadRowsCache_(sheetName);
}

function actionAddContact_(user, payload) {
  var kind = text_((payload || {}).kind).toLowerCase();
  if (kind !== 'instructor' && kind !== 'school') throw new Error('invalid contact kind');
  if (!canManageContacts_(user, kind)) throw new Error('Forbidden');
  var row = payload.row || {};
  if (kind === 'instructor') {
    var sheetName = configuredInstructorContactsSourceSheet_();
    var empId = text_(row.emp_id || row.user_id);
    if (!empId) throw new Error('emp_id is required');
    appendRow_(sheetName, {
      emp_id: empId,
      full_name: text_(row.full_name),
      mobile: text_(row.mobile),
      email: text_(row.email),
      address: text_(row.address),
      employment_type: text_(row.employment_type),
      direct_manager: text_(row.direct_manager),
      active: yesNo_(row.active || 'yes')
    });
    scriptCacheInvalidateDataViews_();
    return { saved: true, kind: kind };
  }
  var schoolSheet = configuredSchoolContactsSourceSheet_();
  appendRow_(schoolSheet, {
    authority: text_(row.authority),
    school: text_(row.school),
    contact_name: text_(row.contact_name),
    role: text_(row.role),
    phone: text_(row.phone),
    mobile: text_(row.mobile),
    email: text_(row.email),
    notes: text_(row.notes)
  });
  scriptCacheInvalidateDataViews_();
  return { saved: true, kind: kind };
}

function actionSaveContact_(user, payload) {
  var kind = text_((payload || {}).kind).toLowerCase();
  if (kind !== 'instructor' && kind !== 'school') throw new Error('invalid contact kind');
  if (!canManageContacts_(user, kind)) throw new Error('Forbidden');
  var row = payload.row || {};
  var rowIndex = (payload || {}).row_index;
  if (rowIndex === undefined || rowIndex === null || text_(rowIndex) === '') {
    throw new Error('row_index is required');
  }
  if (kind === 'instructor') {
    updateRowByIndex_(configuredInstructorContactsSourceSheet_(), rowIndex, {
      emp_id: text_(row.emp_id),
      full_name: text_(row.full_name),
      mobile: text_(row.mobile),
      email: text_(row.email),
      address: text_(row.address),
      employment_type: text_(row.employment_type),
      direct_manager: text_(row.direct_manager),
      active: yesNo_(row.active || 'yes')
    });
    scriptCacheInvalidateDataViews_();
    return { saved: true, kind: kind };
  }
  updateRowByIndex_(configuredSchoolContactsSourceSheet_(), rowIndex, {
    authority: text_(row.authority),
    school: text_(row.school),
    contact_name: text_(row.contact_name),
    role: text_(row.role),
    phone: text_(row.phone),
    mobile: text_(row.mobile),
    email: text_(row.email),
    notes: text_(row.notes)
  });
  scriptCacheInvalidateDataViews_();
  return { saved: true, kind: kind };
}

function actionInstructorContacts_(user) {
  requireAnyRole_(user, ['admin', 'operation_manager', 'authorized_user']);
  var permission = getPermissionRow_(user.user_id);
  if (!instructorContactsViewYes_(permission)) {
    throw new Error('Forbidden');
  }

  return {
    rows: readRows_(configuredInstructorContactsSourceSheet_()).map(function(row) {
      return {
        emp_id: text_(row.emp_id),
        full_name: text_(row.full_name),
        mobile: text_(row.mobile),
        email: text_(row.email),
        address: text_(row.address),
        employment_type: text_(row.employment_type),
        direct_manager: text_(row.direct_manager),
        active: yesNo_(row.active)
      };
    })
  };
}

function actionEndDates_(user) {
  requireAnyRole_(user, ['admin', 'operation_manager', 'authorized_user']);
  var permission = getPermissionRow_(user.user_id);
  if (!endDatesViewYes_(permission)) {
    throw new Error('Forbidden');
  }

  var meetingsMap = buildMeetingsMap_();
  var activityRows = enrichRowsWithMeetings_(allActivitiesSummary_().slice());
  var rows = activityRows
    .filter(function(row) {
      return !!text_(row.end_date);
    })
    .map(function(row) {
      var rowId = text_(row.RowID);

      var meetingDates = [];
      if (isDataLongRow_(row)) {
        var fromMeetings = meetingsMap[rowId];
        meetingDates = (fromMeetings && fromMeetings.length)
          ? fromMeetings.map(function(d) { return text_(d); }).filter(Boolean).sort()
          : [];
      }

      return {
        RowID: rowId,
        activity_name: row.activity_name,
        activity_type: text_(row.activity_type),
        activity_manager: text_(row.activity_manager),
        authority: text_(row.authority),
        school: text_(row.school),
        start_date: text_(row.start_date),
        end_date: text_(row.end_date),
        status: text_(row.status),
        source_sheet: row.source_sheet,
        meeting_dates: meetingDates,
        date_cols: []
      };
    });

  rows.sort(function(a, b) {
    return text_(a.end_date).localeCompare(text_(b.end_date));
  });

  return { rows: rows };
}

function actionMyData_(user) {
  requireAnyRole_(user, ['admin', 'operation_manager', 'authorized_user', 'instructor']);
  var permission = getPermissionRow_(user.user_id);
  if (user.display_role !== 'instructor' && !myDataViewYes_(permission)) {
    throw new Error('Forbidden');
  }

  if (user.display_role === 'instructor') {
    var myEmpId = text_(user.emp_id || user.user_id);
    return {
      rows: allActivities_().filter(function(row) {
        return text_(row.emp_id) === myEmpId || text_(row.emp_id_2) === myEmpId;
      })
    };
  }

  return { rows: allActivities_() };
}

function actionOperations_(user, payload) {
  requireAnyRole_(user, ['admin', 'operation_manager', 'authorized_user']);
  var permission = getPermissionRow_(user.user_id);
  if (yesNo_(permission.view_operations_data) !== 'yes' && user.display_role !== 'admin') {
    throw new Error('Forbidden');
  }
  var search = text_((payload || {}).search || '').toLowerCase();
  var activityType = text_((payload || {}).activity_type || '');
  var rows = allActivitiesSummary_().filter(function(row) {
    if (activityType && text_(row.activity_type) !== activityType) return false;
    if (search) {
      var hay = [row.RowID, row.activity_name, row.activity_type, row.start_date, row.end_date, row.grade, row.class_group].map(text_).join(' ').toLowerCase();
      if (hay.indexOf(search) < 0) return false;
    }
    return true;
  }).map(function(row) {
    return {
      RowID: row.RowID,
      source_sheet: row.source_sheet,
      activity_name: row.activity_name,
      grade: text_(row.grade),
      class_group: text_(row.class_group),
      start_date: row.start_date,
      end_date: row.end_date,
      activity_type: row.activity_type
    };
  });
  return { rows: rows };
}

function actionOperationsDetail_(user, payload) {
  requireAnyRole_(user, ['admin', 'operation_manager', 'authorized_user']);
  var permission = getPermissionRow_(user.user_id);
  if (yesNo_(permission.view_operations_data) !== 'yes' && user.display_role !== 'admin') {
    throw new Error('Forbidden');
  }
  var sourceRowId = text_((payload || {}).source_row_id || (payload || {}).RowID);
  var sourceSheet = text_((payload || {}).source_sheet);
  var row = findActivityRowById_(sourceRowId, sourceSheet);
  return { row: mapActivityDetailRowForDrawer_(row, user) };
}

function actionEditRequests_(user) {
  requireAnyRole_(user, ['admin', 'operation_manager', 'authorized_user']);
  var canReview = canDirectWriteRole_(user.display_role);

  var rows = readRows_(CONFIG.SHEETS.EDIT_REQUESTS).filter(function(r) {
    return yesNo_(r.active) === 'yes';
  });

  if (!canReview) {
    var myId = text_(user.user_id);
    rows = rows.filter(function(r) {
      return text_(r.requested_by_user_id) === myId;
    });
  }

  var result = rows.map(function(r) {
    var changedFields = parseJsonObject_(r.changed_fields, []);
    if (!Array.isArray(changedFields)) changedFields = [];
    var originalValues = parseJsonObject_(r.original_values, {});
    var requestedValues = parseJsonObject_(r.requested_values, {});
    if (!changedFields.length && text_(r.field_name)) {
      changedFields = [text_(r.field_name)];
      originalValues[text_(r.field_name)] = text_(r.old_value);
      requestedValues[text_(r.field_name)] = text_(r.new_value);
    }
    return {
      request_id: text_(r.request_id),
      RowID: text_(r.RowID || r.source_row_id),
      source_sheet: text_(r.source_sheet),
      source_row_id: text_(r.source_row_id || r.RowID),
      activity_name: text_(r.activity_name),
      school: text_(r.school),
      authority: text_(r.authority),
      requested_by_user_id: text_(r.requested_by_user_id),
      requested_by_name: text_(r.requested_by_name),
      requested_at: text_(r.requested_at),
      status: text_(r.status),
      changed_fields: changedFields,
      original_values: originalValues,
      requested_values: requestedValues,
      reviewer_user_id: text_(r.reviewer_user_id || r.reviewed_by),
      reviewed_at: text_(r.reviewed_at),
      review_note: text_(r.review_note || r.reviewer_notes),
      fields: changedFields.map(function(fieldName) {
        return {
          field_name: fieldName,
          old_value: text_(originalValues[fieldName]),
          new_value: text_(requestedValues[fieldName])
        };
      })
    };
  });
  result.sort(function(a, b) {
    return (b.requested_at || '').localeCompare(a.requested_at || '');
  });

  return {
    groups: result,
    canReview: canReview
  };
}

/**
 * Computes effective non-admin role defaults, merging hardcoded baseline with
 * any active overrides in the settings sheet (role_defaults.<role>.<flag>).
 * Returns { operation_manager: {...}, authorized_user: {...}, instructor: {} }
 * where each value is a flag-name → 'yes'/'no' object.
 */
function computeNonAdminRoleDefaults_() {
  var defaults = {
    operation_manager: {
      view_dashboard: 'yes', view_activities: 'yes', view_week: 'yes', view_month: 'yes',
      view_instructors: 'yes', view_exceptions: 'yes', view_finance: 'yes',
      view_edit_requests: 'yes', view_final_approvals: 'yes',
      can_edit_direct: 'yes', can_add_activity: 'yes', can_review_requests: 'yes'
    },
    authorized_user: {
      view_dashboard: 'yes', view_activities: 'yes', view_week: 'yes', view_month: 'yes',
      can_add_activity: 'no', can_edit_direct: 'no'
    },
    instructor: {
      can_edit_direct: 'no',
      can_add_activity: 'no'
    }
  };
  var settingsMap = readActiveSettingsMap_();
  var nonAdminRoles = ['operation_manager', 'authorized_user', 'instructor'];
  nonAdminRoles.forEach(function(role) {
    var base = defaults[role] || {};
    var prefix = 'role_defaults.' + role + '.';
    Object.keys(settingsMap).forEach(function(k) {
      if (k.indexOf(prefix) !== 0) return;
      var flag = k.slice(prefix.length);
      if (flag.indexOf('view_') !== 0 && flag.indexOf('can_') !== 0) return;
      base[flag] = yesNo_(settingsMap[k]) === 'yes' ? 'yes' : 'no';
    });
    defaults[role] = base;
  });
  return defaults;
}

function actionPermissions_(user) {
  requireAnyRole_(user, ['admin', 'operation_manager']);
  var permission = getPermissionRow_(user.user_id);
  // Admin always has access; for operation_manager require explicit flag
  if (user.display_role !== 'admin' && yesNo_(permission.view_permissions) !== 'yes') {
    throw new Error('Forbidden');
  }

  var cachedPerm = scriptCacheGetJson_(SCRIPT_CACHE_KEY_PERMISSIONS_LIST);
  if (cachedPerm) {
    // roleDefaults is always computed fresh (not stored in script cache) so that
    // settings-sheet overrides are reflected without waiting for cache expiry.
    cachedPerm.roleDefaults = computeNonAdminRoleDefaults_();
    return cachedPerm;
  }

  var permSheet = getSheet_(CONFIG.SHEETS.PERMISSIONS);
  var permHeaders = getHeaders_(permSheet);

  var result = {
    rows: readRows_(CONFIG.SHEETS.PERMISSIONS).map(function(row) {
      var out = {
        user_id: text_(row.user_id),
        entry_code: text_(row.entry_code),
        full_name: text_(row.full_name),
        display_role: normalizeRole_(internalRoleFromPermissionRow_(row)),
        display_role2: text_(row.display_role2),
        default_view: text_(row.default_view),
        active: yesNo_(row.active)
      };
      permHeaders.forEach(function(h) {
        if (h === 'user_id' || h === 'entry_code' || h === 'full_name' || h === 'display_role' || h === 'display_role2' || h === 'default_view' || h === 'active') {
          return;
        }
        if (h.indexOf('view_') === 0 || h.indexOf('can_') === 0) {
          out[h] = yesNo_(row[h]);
        }
      });
      return out;
    })
  };
  scriptCachePutJson_(SCRIPT_CACHE_KEY_PERMISSIONS_LIST, result, CONFIG.SCRIPT_CACHE_SECONDS);
  // Add roleDefaults after caching (not stored in script cache — always fresh)
  result.roleDefaults = computeNonAdminRoleDefaults_();
  return result;
}

function actionAddActivity_(user, payload) {
  var permission = getPermissionRow_(user.user_id);
  if (!effectiveCanAddActivity_(permission, user.display_role)) {
    throw new Error('Forbidden');
  }

  var activity = payload.activity || {};
  var source = text_(activity.source || 'short').toLowerCase();
  var targetSheet = source === 'long' ? CONFIG.SHEETS.DATA_LONG : CONFIG.SHEETS.DATA_SHORT;
  var rowId = nextId_(targetSheet, targetSheet === CONFIG.SHEETS.DATA_LONG ? 'LONG-' : 'SHORT-');

  var dropdowns = buildDropdownOptionsMap_();
  var roster = Array.isArray(dropdowns.instructor_users) ? dropdowns.instructor_users : [];
  var oneDayTypes = configuredOneDayActivityTypes_();
  var programTypes = configuredProgramActivityTypes_();
  var selectedType = text_(activity.activity_type);
  var isOneDay = oneDayTypes.indexOf(selectedType) >= 0;
  var isProgram = programTypes.indexOf(selectedType) >= 0;

  function empIdForInstructorName_(name) {
    var target = text_(name);
    if (!target) return '';
    for (var i = 0; i < roster.length; i++) {
      var it = roster[i] || {};
      if (text_(it.name) === target) return text_(it.emp_id);
    }
    return '';
  }

  function meetingScheduleFromPayload_(baseStartDate, sessionsRaw) {
    var start = normalizeDateTextToIso_(baseStartDate);
    if (!start) return [];
    var count = parseInt(text_(sessionsRaw), 10);
    if (isNaN(count) || count < 1) count = 1;
    if (count > 35) count = 35;
    if (isOneDay) count = 1;
    var out = [];
    var d = dateFromIso_(start);
    if (!d) return [];
    for (var i = 0; i < count; i++) {
      out.push({
        source_row_id: rowId,
        meeting_no: String(i + 1),
        meeting_date: formatDate_(d),
        notes: '',
        active: 'yes'
      });
      d = shiftDate_(d, 7);
    }
    return out;
  }

  var dateCols = dateColumnsPatchFromActivityPayload_(activity);
  var instructorName1 = text_(activity.instructor_name);
  var instructorName2 = text_(activity.instructor_name_2);
  var derivedEmpId1 = empIdForInstructorName_(instructorName1);
  var derivedEmpId2 = empIdForInstructorName_(instructorName2);
  var firstStartDate = normalizeDateTextToIso_(activity.start_date || dateCols.Date1);
  var plannedMeetings = meetingScheduleFromPayload_(firstStartDate, activity.sessions);
  var meetingsTotal = plannedMeetings.length;
  var autoEndDate = meetingsTotal ? text_(plannedMeetings[meetingsTotal - 1].meeting_date) : '';

  var common = {
    RowID: rowId,
    activity_manager: text_(activity.activity_manager),
    authority: text_(activity.authority),
    school: text_(activity.school),
    grade: text_(activity.grade),
    class_group: text_(activity.class_group),
    activity_type: text_(activity.activity_type),
    activity_no: text_(activity.activity_no),
    activity_name: text_(activity.activity_name),
    sessions: text_(isOneDay ? '1' : (meetingsTotal ? String(meetingsTotal) : activity.sessions)),
    price: text_(activity.price),
    funding: text_(activity.funding),
    start_time: text_(activity.start_time),
    end_time: text_(activity.end_time),
    emp_id: text_(derivedEmpId1 || activity.emp_id),
    instructor_name: instructorName1,
    status: 'פעיל',
    notes: text_(activity.notes),
    finance_status: normalizeFinance_(activity.finance_status),
    finance_notes: text_(activity.finance_notes)
  };

  if (targetSheet === CONFIG.SHEETS.DATA_SHORT) {
    appendRow_(targetSheet, {
      RowID: common.RowID,
      activity_manager: common.activity_manager,
      authority: common.authority,
      school: common.school,
      grade: common.grade,
      class_group: common.class_group,
      activity_type: common.activity_type,
      activity_no: common.activity_no,
      activity_name: common.activity_name,
      sessions: common.sessions,
      price: common.price,
      funding: common.funding,
      start_time: common.start_time,
      end_time: common.end_time,
      emp_id: common.emp_id,
      instructor_name: common.instructor_name,
      emp_id_2: text_(derivedEmpId2 || activity.emp_id_2),
      instructor_name_2: instructorName2,
      start_date: firstStartDate || '',
      end_date: (autoEndDate || firstStartDate || ''),
      Date1: firstStartDate || dateCols.Date1 || '',
      Date2: (isOneDay ? '' : (autoEndDate || dateCols.Date2 || '')),
      status: common.status,
      notes: common.notes,
      finance_status: common.finance_status,
      finance_notes: common.finance_notes,
      Date3: dateCols.Date3 || '',
      Date4: dateCols.Date4 || '',
      Date5: dateCols.Date5 || '',
      Date6: dateCols.Date6 || '',
      Date7: dateCols.Date7 || '',
      Date8: dateCols.Date8 || '',
      Date9: dateCols.Date9 || '',
      Date10: dateCols.Date10 || '',
      Date11: dateCols.Date11 || '',
      Date12: dateCols.Date12 || '',
      Date13: dateCols.Date13 || '',
      Date14: dateCols.Date14 || '',
      Date15: dateCols.Date15 || '',
      Date16: dateCols.Date16 || '',
      Date17: dateCols.Date17 || '',
      Date18: dateCols.Date18 || '',
      Date19: dateCols.Date19 || '',
      Date20: dateCols.Date20 || '',
      Date21: dateCols.Date21 || '',
      Date22: dateCols.Date22 || '',
      Date23: dateCols.Date23 || '',
      Date24: dateCols.Date24 || '',
      Date25: dateCols.Date25 || '',
      Date26: dateCols.Date26 || '',
      Date27: dateCols.Date27 || '',
      Date28: dateCols.Date28 || '',
      Date29: dateCols.Date29 || '',
      Date30: dateCols.Date30 || '',
      Date31: dateCols.Date31 || '',
      Date32: dateCols.Date32 || '',
      Date33: dateCols.Date33 || '',
      Date34: dateCols.Date34 || '',
      Date35: dateCols.Date35 || ''
    });
  } else {
    appendRow_(targetSheet, {
      RowID: common.RowID,
      activity_manager: common.activity_manager,
      authority: common.authority,
      school: common.school,
      grade: common.grade,
      class_group: common.class_group,
      activity_type: common.activity_type,
      activity_no: common.activity_no,
      activity_name: common.activity_name,
      sessions: common.sessions,
      price: common.price,
      funding: common.funding,
      start_time: common.start_time,
      end_time: common.end_time,
      emp_id: common.emp_id,
      instructor_name: common.instructor_name,
      Date1: firstStartDate || dateCols.Date1 || '',
      start_date: firstStartDate || dateCols.Date1 || '',
      end_date: autoEndDate || dateCols.Date2 || firstStartDate || dateCols.Date1 || '',
      status: common.status,
      notes: common.notes,
      finance_status: common.finance_status,
      finance_notes: common.finance_notes,
      Date2: autoEndDate || dateCols.Date2 || '',
      Date3: dateCols.Date3 || '',
      Date4: dateCols.Date4 || '',
      Date5: dateCols.Date5 || '',
      Date6: dateCols.Date6 || '',
      Date7: dateCols.Date7 || '',
      Date8: dateCols.Date8 || '',
      Date9: dateCols.Date9 || '',
      Date10: dateCols.Date10 || '',
      Date11: dateCols.Date11 || '',
      Date12: dateCols.Date12 || '',
      Date13: dateCols.Date13 || '',
      Date14: dateCols.Date14 || '',
      Date15: dateCols.Date15 || '',
      Date16: dateCols.Date16 || '',
      Date17: dateCols.Date17 || '',
      Date18: dateCols.Date18 || '',
      Date19: dateCols.Date19 || '',
      Date20: dateCols.Date20 || '',
      Date21: dateCols.Date21 || '',
      Date22: dateCols.Date22 || '',
      Date23: dateCols.Date23 || '',
      Date24: dateCols.Date24 || '',
      Date25: dateCols.Date25 || '',
      Date26: dateCols.Date26 || '',
      Date27: dateCols.Date27 || '',
      Date28: dateCols.Date28 || '',
      Date29: dateCols.Date29 || '',
      Date30: dateCols.Date30 || '',
      Date31: dateCols.Date31 || '',
      Date32: dateCols.Date32 || '',
      Date33: dateCols.Date33 || '',
      Date34: dateCols.Date34 || '',
      Date35: dateCols.Date35 || ''
    });
  }

  var maintenanceHandledInMeetings = false;
  if (plannedMeetings.length) {
    setMeetings_(rowId, plannedMeetings);
    maintenanceHandledInMeetings = true;
  } else if (targetSheet === CONFIG.SHEETS.DATA_LONG) {
    syncDataLongDatesForRowFromMeetings_(rowId);
  }

  scriptCacheInvalidateDataViews_();
  if (!maintenanceHandledInMeetings) {
    runDataMaintenance_('actionAddActivity');
  }
  return {
    created: true,
    RowID: rowId,
    source_sheet: targetSheet
  };
}

function actionSaveActivity_(user, payload) {
  var sourceRowId = text_(payload.source_row_id || payload.RowID);
  var sourceSheet = text_(payload.source_sheet || (sourceRowId.indexOf('LONG-') === 0 ? CONFIG.SHEETS.DATA_LONG : CONFIG.SHEETS.DATA_SHORT));
  var changes = payload.changes || {};
  var currentRow = null;

  if (!sourceRowId) throw new Error('source_row_id is required');

  var permission = getPermissionRow_(user.user_id);
  if (user.display_role === 'instructor') {
    throw new Error('Forbidden');
  }
  var datePatch = dateColumnsPatchFromChanges_(changes);
  Object.keys(datePatch).forEach(function(k) {
    changes[k] = datePatch[k];
  });
  if (Object.prototype.hasOwnProperty.call(changes, 'status')) {
    var rawStatus = text_(changes.status).toLowerCase();
    changes.status = (rawStatus === 'closed' || rawStatus === 'סגור') ? 'סגור' : 'פעיל';
  }
  if (sourceSheet === CONFIG.SHEETS.DATA_LONG) {
    currentRow = getRowByKey_(sourceSheet, 'RowID', sourceRowId);
  }
  var meetingsPatch = sourceSheet === CONFIG.SHEETS.DATA_LONG
    ? normalizeMeetingsPatch_(sourceRowId, changes, currentRow)
    : null;
  Object.keys(changes).forEach(function(key) {
    if (/^meeting_date_\d+$/.test(key) || /^meeting_active_\d+$/.test(key) || key === 'meetings') {
      delete changes[key];
    }
  });

  if (sourceSheet === CONFIG.SHEETS.DATA_SHORT) {
    if (Object.prototype.hasOwnProperty.call(changes, 'start_date')) {
      changes.start_date = normalizeDateTextToIso_(changes.start_date);
      if (!Object.prototype.hasOwnProperty.call(changes, 'end_date')) {
        changes.end_date = normalizeDateTextToIso_(changes.end_date) || changes.start_date;
      }
    }
    if (Object.prototype.hasOwnProperty.call(changes, 'end_date')) {
      changes.end_date = normalizeDateTextToIso_(changes.end_date) || normalizeDateTextToIso_(changes.start_date) || '';
    }
    if (!Object.prototype.hasOwnProperty.call(changes, 'end_date') && Object.prototype.hasOwnProperty.call(changes, 'start_date')) {
      changes.end_date = changes.start_date || '';
    }
  }
  if (!effectiveCanEditDirect_(permission, user.display_role)) {
    if (!effectiveCanRequestEdit_(permission, user.display_role)) {
      throw new Error('Forbidden');
    }
    return actionSubmitEditRequest_(user, {
      source_sheet: sourceSheet,
      source_row_id: sourceRowId,
      changes: changes
    });
  }

  updateRowByKey_(sourceSheet, 'RowID', sourceRowId, changes);
  var maintenanceHandled = false;
  if (sourceSheet === CONFIG.SHEETS.DATA_LONG) {
    if (meetingsPatch) {
      setMeetings_(sourceRowId, meetingsPatch);
      maintenanceHandled = true;
    }
    syncDataLongDatesForRowFromMeetings_(sourceRowId);
  }

  scriptCacheInvalidateDataViews_();
  if (!maintenanceHandled) {
    runDataMaintenance_('actionSaveActivity');
  }
  return {
    updated: true,
    source_sheet: sourceSheet,
    source_row_id: sourceRowId
  };
}

function actionSubmitEditRequest_(user, payload) {
  requireAnyRole_(user, ['authorized_user', 'admin', 'operation_manager']);
  var permission = getPermissionRow_(user.user_id);
  if (user.display_role === 'instructor' || !effectiveCanRequestEdit_(permission, user.display_role)) {
    throw new Error('Forbidden');
  }

  var sourceRowId = text_(payload.source_row_id || payload.RowID);
  var sourceSheet = text_(payload.source_sheet || (sourceRowId.indexOf('LONG-') === 0 ? CONFIG.SHEETS.DATA_LONG : CONFIG.SHEETS.DATA_SHORT));
  var changes = payload.changes || {};
  var datePatch = dateColumnsPatchFromChanges_(changes);
  Object.keys(datePatch).forEach(function(k) {
    changes[k] = datePatch[k];
  });

  if (!sourceRowId) throw new Error('source_row_id is required');
  if (sourceRowId.indexOf('SHORT-') !== 0 && sourceRowId.indexOf('LONG-') !== 0) {
    throw new Error('Invalid source_row_id');
  }

  var currentRow = getRowByKey_(sourceSheet, 'RowID', sourceRowId);
  var requestId = 'REQ-' + new Date().getTime();

  var changedFields = [];
  var originalValues = {};
  var requestedValues = {};
  Object.keys(changes).forEach(function(fieldName) {
    var oldValue = text_(currentRow[fieldName]);
    var newValue = text_(changes[fieldName]);
    if (oldValue === newValue) return;
    changedFields.push(fieldName);
    originalValues[fieldName] = oldValue;
    requestedValues[fieldName] = newValue;
  });
  if (!changedFields.length) {
    throw new Error('No changes to submit');
  }
  appendRow_(CONFIG.SHEETS.EDIT_REQUESTS, {
    request_id: requestId,
    RowID: sourceRowId,
    source_sheet: sourceSheet,
    source_row_id: sourceRowId,
    activity_name: text_(currentRow.activity_name),
    school: text_(currentRow.school),
    authority: text_(currentRow.authority),
    requested_by_user_id: text_(user.user_id),
    requested_by_name: text_(user.full_name),
    requested_at: new Date().toISOString(),
    status: 'pending',
    changed_fields: JSON.stringify(changedFields),
    original_values: JSON.stringify(originalValues),
    requested_values: JSON.stringify(requestedValues),
    reviewer_user_id: '',
    reviewed_by: '',
    reviewed_at: '',
    review_note: '',
    reviewer_notes: '',
    active: 'yes'
  });

  return {
    created: true,
    request_id: requestId
  };
}

function actionReviewEditRequest_(user, payload) {
  if (!canDirectWriteRole_(user.display_role)) {
    throw new Error('Forbidden');
  }

  var requestId = text_(payload.request_id);
  var status = text_(payload.status).toLowerCase();
  var reviewerNotes = text_(payload.reviewer_notes);

  if (!requestId) throw new Error('request_id is required');
  if (CONFIG.EDIT_REQUEST_STATUSES.indexOf(status) < 0 || status === 'pending') {
    throw new Error('Invalid review status');
  }

  var rows = readRows_(CONFIG.SHEETS.EDIT_REQUESTS);
  var requestRows = rows.filter(function(row) {
    return text_(row.request_id) === requestId;
  });

  if (!requestRows.length) throw new Error('Request not found');
  if (text_(requestRows[0].status) !== 'pending') throw new Error('Request already reviewed');

  if (status === 'approved') {
    var sourceSheet = text_(requestRows[0].source_sheet);
    var sourceRowId = text_(requestRows[0].RowID || requestRows[0].source_row_id);
    var currentRow = getRowByKey_(sourceSheet, 'RowID', sourceRowId);
    var changedFields = parseJsonObject_(requestRows[0].changed_fields, []);
    if (!Array.isArray(changedFields)) changedFields = [];
    var originalValues = parseJsonObject_(requestRows[0].original_values, {});
    var requestedValues = parseJsonObject_(requestRows[0].requested_values, {});
    var changes = {};
    var hasConflict = false;
    if (!changedFields.length) {
      requestRows.forEach(function(row) {
        var field = text_(row.field_name);
        if (!field) return;
        changedFields.push(field);
        originalValues[field] = text_(row.old_value);
        requestedValues[field] = text_(row.new_value);
      });
    }

    changedFields.forEach(function(fieldName) {
      var expectedValue = text_(originalValues[fieldName]);
      var currentValue = text_(currentRow[fieldName]);
      if (expectedValue !== currentValue) {
        hasConflict = true;
        return;
      }
      if (!Object.prototype.hasOwnProperty.call(requestedValues, fieldName)) return;
      changes[fieldName] = text_(requestedValues[fieldName]);
    });

    if (hasConflict) {
      status = 'conflict';
    } else {
      updateRowByKey_(sourceSheet, 'RowID', sourceRowId, changes);
      var maintenanceHandledByMeetings = false;

      if (sourceSheet === CONFIG.SHEETS.DATA_LONG && (changes.start_date || changes.end_date)) {
        setMeetingsFromRange_(sourceRowId, text_(changes.start_date), text_(changes.end_date));
        maintenanceHandledByMeetings = true;
      }
      if (!maintenanceHandledByMeetings) {
        runDataMaintenance_('actionReviewEditRequest');
      }
    }
  }

  updateEditRequestRows_(requestId, {
    status: status,
    reviewed_at: new Date().toISOString(),
    reviewer_user_id: text_(user.user_id),
    reviewed_by: text_(user.user_id),
    review_note: reviewerNotes,
    reviewer_notes: reviewerNotes
  });

  if (status === 'approved') {
    scriptCacheInvalidateDataViews_();
  }
  return {
    reviewed: true,
    request_id: requestId,
    status: status
  };
}

function actionSavePermission_(user, payload) {
  requireAnyRole_(user, ['admin', 'operation_manager']);

  var row = payload.permission || payload.row || {};
  var userId = text_(row.user_id);
  if (!userId) throw new Error('user_id is required');

  var existing = getPermissionRow_(userId);
  var sheet = getSheet_(CONFIG.SHEETS.PERMISSIONS);
  var headers = getHeaders_(sheet);

  var merged = {};
  headers.forEach(function(h) {
    if (h === 'user_id') {
      merged[h] = userId;
      return;
    }
    if (Object.prototype.hasOwnProperty.call(row, h)) {
      if (h === 'display_role') {
        merged[h] = normalizeRole_(text_(row[h]) || internalRoleFromPermissionRow_(existing));
      } else if (h === 'active' || h.indexOf('view_') === 0 || h.indexOf('can_') === 0) {
        merged[h] = yesNo_(row[h]);
      } else {
        merged[h] = row[h];
      }
      return;
    }
    merged[h] = existing[h] !== undefined && existing[h] !== null ? existing[h] : '';
  });

  if (headers.indexOf('entry_code') >= 0 && !text_(merged.entry_code)) {
    merged.entry_code = text_(row.entry_code || existing.entry_code);
  }
  if (headers.indexOf('full_name') >= 0 && !text_(merged.full_name)) {
    merged.full_name = text_(row.full_name || existing.full_name);
  }
  if (headers.indexOf('display_role') >= 0 && !text_(merged.display_role)) {
    merged.display_role = normalizeRole_(internalRoleFromPermissionRow_(existing));
  }
  if (headers.indexOf('default_view') >= 0 && !text_(merged.default_view)) {
    merged.default_view = text_(row.default_view || existing.default_view);
  }
  if (headers.indexOf('active') >= 0) {
    merged.active = Object.prototype.hasOwnProperty.call(row, 'active') ? yesNo_(row.active) : yesNo_(existing.active);
  }
  if (headers.indexOf('default_view') >= 0) {
    var mergedRole = normalizeRole_(text_(merged.display_role) || internalRoleFromPermissionRow_(existing));
    var mergedRoutes = effectiveRoutesForUser_(merged, mergedRole);
    merged.default_view = resolveDefaultRoute_(text_(merged.default_view), mergedRoutes, mergedRole);
  }

  upsertRowByKey_(CONFIG.SHEETS.PERMISSIONS, 'user_id', merged);

  scriptCacheInvalidateDataViews_();
  return {
    saved: true,
    user_id: userId
  };
}

function actionAddUser_(user, payload) {
  requireAnyRole_(user, ['admin']);

  var row = payload.row || {};
  var userId = text_(row.user_id);
  if (!userId) throw new Error('user_id is required');

  var sheet = getSheet_(CONFIG.SHEETS.PERMISSIONS);
  var headers = getHeaders_(sheet);

  var existingRows = readRows_(CONFIG.SHEETS.PERMISSIONS);
  var alreadyExists = existingRows.some(function(r) {
    return text_(r.user_id) === userId;
  });
  if (alreadyExists) throw new Error('user_already_exists');

  var resolvedRole = normalizeRole_(text_(row.display_role || 'instructor'));

  var nonAdminRoleDefaults = computeNonAdminRoleDefaults_();

  var isAdmin = resolvedRole === 'admin';
  var nonAdminDefaults = nonAdminRoleDefaults[resolvedRole] || {};

  var newRow = {};
  headers.forEach(function(h) {
    if (h === 'user_id') {
      newRow[h] = userId;
    } else if (h === 'full_name') {
      newRow[h] = text_(row.full_name || '');
    } else if (h === 'entry_code') {
      newRow[h] = text_(row.entry_code || '');
    } else if (h === 'display_role') {
      newRow[h] = resolvedRole;
    } else if (h === 'active') {
      newRow[h] = 'yes';
    } else if (h.indexOf('view_') === 0 || h.indexOf('can_') === 0) {
      newRow[h] = isAdmin ? 'yes' : (nonAdminDefaults[h] || 'no');
    } else {
      newRow[h] = '';
    }
  });
  if (headers.indexOf('default_view') >= 0) {
    var newUserRoutes = effectiveRoutesForUser_(newRow, resolvedRole);
    newRow.default_view = resolveDefaultRoute_(text_(row.default_view), newUserRoutes, resolvedRole);
  }

  upsertRowByKey_(CONFIG.SHEETS.PERMISSIONS, 'user_id', newRow);

  scriptCacheInvalidateDataViews_();
  return {
    created: true,
    user_id: userId
  };
}

function actionDeactivateUser_(user, payload) {
  requireAnyRole_(user, ['admin']);

  var userId = text_(payload.user_id);
  if (!userId) throw new Error('user_id is required');

  if (userId === text_(user.user_id)) throw new Error('cannot_deactivate_self');

  var existing = getPermissionRow_(userId);
  if (!existing || !text_(existing.user_id)) throw new Error('user_not_found');

  var sheet = getSheet_(CONFIG.SHEETS.PERMISSIONS);
  var headers = getHeaders_(sheet);

  var merged = {};
  headers.forEach(function(h) {
    merged[h] = existing[h] !== undefined && existing[h] !== null ? existing[h] : '';
  });
  merged.active = 'no';

  upsertRowByKey_(CONFIG.SHEETS.PERMISSIONS, 'user_id', merged);

  scriptCacheInvalidateDataViews_();
  return {
    deactivated: true,
    user_id: userId
  };
}

function actionReactivateUser_(user, payload) {
  requireAnyRole_(user, ['admin']);

  var userId = text_(payload.user_id);
  if (!userId) throw new Error('user_id is required');

  var existing = getPermissionRow_(userId);
  if (!existing || !text_(existing.user_id)) throw new Error('user_not_found');

  var sheet = getSheet_(CONFIG.SHEETS.PERMISSIONS);
  var headers = getHeaders_(sheet);

  var merged = {};
  headers.forEach(function(h) {
    merged[h] = existing[h] !== undefined && existing[h] !== null ? existing[h] : '';
  });
  merged.active = 'yes';

  upsertRowByKey_(CONFIG.SHEETS.PERMISSIONS, 'user_id', merged);

  scriptCacheInvalidateDataViews_();
  return {
    reactivated: true,
    user_id: userId
  };
}

function actionDeleteUser_(user, payload) {
  requireAnyRole_(user, ['admin']);

  var userId = text_(payload.user_id);
  if (!userId) throw new Error('user_id is required');

  if (userId === text_(user.user_id)) throw new Error('cannot_delete_self');

  var existing = getPermissionRow_(userId);
  if (!existing || !text_(existing.user_id)) throw new Error('user_not_found');

  if (text_(existing.active).toLowerCase() === 'yes') throw new Error('cannot_delete_active_user');

  deleteRowsByKey_(CONFIG.SHEETS.PERMISSIONS, 'user_id', userId);

  scriptCacheInvalidateDataViews_();
  return {
    deleted: true,
    user_id: userId
  };
}

function actionSavePrivateNote_(user, payload) {
  var permission = getPermissionRow_(user.user_id);
  if (yesNo_(permission.can_review_requests) !== 'yes' || user.display_role !== 'operation_manager') {
    throw new Error('Forbidden');
  }

  var sourceSheet = text_(payload.source_sheet);
  var sourceRowId = text_(payload.source_row_id);
  var noteText = text_(payload.note_text || payload.note);

  if (!sourceSheet || !sourceRowId) throw new Error('source_sheet and source_row_id are required');

  var existing = getPrivateNoteRow_(sourceSheet, sourceRowId);

  var row = {
    source_sheet: sourceSheet,
    source_row_id: sourceRowId,
    note_text: noteText,
    updated_at: new Date().toISOString(),
    updated_by: text_(user.user_id),
    active: existing ? yesNo_(existing.active || 'yes') : 'yes'
  };

  upsertPrivateNoteRow_(row);

  scriptCacheInvalidateDataViews_();
  return {
    saved: true,
    source_sheet: sourceSheet,
    source_row_id: sourceRowId
  };
}

/**
 * מחשב מחדש start_date ו-end_date לפי גיליון activity_meetings כמקור אמת.
 * תאריך התחלה = הרשומה הקטנה ביותר (meeting_no=1 בפועל לאחר מיון).
 * תאריך סיום = הרשומה הגדולה ביותר (תאריך אחרון תקין).
 * כשאין רשומות בגיליון — נשארים הערכים המחושבים מ-Date1-Date35.
 */
function enrichRowsWithMeetings_(rows) {
  var meetingsMap = buildMeetingsMap_();
  rows.forEach(function(row) {
    var rowId = text_(row.RowID);
    if (isDataShortRow_(row)) {
      row.start_date = normalizeDateTextToIso_(row.start_date) || '';
      row.end_date = normalizeDateTextToIso_(row.end_date) || row.start_date || '';
      row.meeting_dates = [];
      return;
    }
    var dates = meetingsMap[rowId];
    if (dates && dates.length) {
      var range = meetingDateRangeFromList_(dates);
      row.start_date = range.start;
      row.end_date = range.end || range.start;
      row.meeting_dates = dates.slice();
      return;
    }
    row.start_date = normalizeDateTextToIso_(row.start_date) || '';
    row.end_date = normalizeDateTextToIso_(row.end_date) || row.start_date || '';
    row.meeting_dates = [];
  });
  return rows;
}

function meetingDateRangeFromList_(dates) {
  var list = (dates || []).map(function(v) { return normalizeDateTextToIso_(v); }).filter(Boolean).sort();
  if (!list.length) return { start: '', end: '' };
  var start = list[0];
  var end = list[0];
  list.forEach(function(v) {
    if (v > end) end = v;
  });
  return { start: start, end: end };
}

function allActivities_() {
  if (__rqCache_ && Object.prototype.hasOwnProperty.call(__rqCache_, 'allActivities')) {
    return __rqCache_.allActivities;
  }
  var list = [];
  configuredActivitiesSources_().forEach(function(sheetName) {
    if (sheetName === CONFIG.SHEETS.DATA_SHORT) {
      list = list.concat(readRows_(CONFIG.SHEETS.DATA_SHORT).map(mapShortRow_));
    } else if (sheetName === CONFIG.SHEETS.DATA_LONG) {
      list = list.concat(buildLongRows_());
    }
  });
  enrichRowsWithMeetings_(list);
  if (__rqCache_) {
    __rqCache_.allActivities = list;
  }
  return list;
}

function projectedActivityColumnsForSummary_() {
  return [
    'RowID',
    'activity_manager',
    'authority',
    'school',
    'grade',
    'class_group',
    'activity_type',
    'activity_no',
    'activity_name',
    'sessions',
    'price',
    'funding',
    'start_time',
    'end_time',
    'emp_id',
    'instructor_name',
    'emp_id_2',
    'instructor_name_2',
    'start_date',
    'end_date',
    'status',
    'notes',
    'finance_status',
    'finance_notes',
    'is_archived',
    'archive',
    'Payer',
    'Payment',
    'Date1'
  ];
}

function projectedActivityColumnsForDetail_() {
  var base = projectedActivityColumnsForSummary_().slice();
  [
    'source_sheet',
    'Date2', 'Date3', 'Date4', 'Date5', 'Date6', 'Date7', 'Date8', 'Date9',
    'Date10', 'Date11', 'Date12', 'Date13', 'Date14', 'Date15', 'Date16', 'Date17', 'Date18', 'Date19',
    'Date20', 'Date21', 'Date22', 'Date23', 'Date24', 'Date25', 'Date26', 'Date27', 'Date28', 'Date29',
    'Date30', 'Date31', 'Date32', 'Date33', 'Date34', 'Date35'
  ].forEach(function(col) {
    if (base.indexOf(col) < 0) base.push(col);
  });
  return base;
}

function mapProjectedActivityDetailRow_(sheetName, row) {
  var startIso = normalizeDateTextToIso_(row.start_date) || '';
  var endIso = normalizeDateTextToIso_(row.end_date) || startIso || '';
  var out = {
    source_sheet: sheetName,
    RowID: text_(row.RowID),
    activity_manager: text_(row.activity_manager),
    authority: text_(row.authority),
    school: text_(row.school),
    grade: text_(row.grade),
    class_group: text_(row.class_group),
    activity_type: text_(row.activity_type),
    activity_no: text_(row.activity_no),
    activity_name: text_(row.activity_name),
    sessions: text_(row.sessions),
    price: text_(row.price),
    funding: text_(row.funding),
    start_time: mappedStartTime_(row),
    end_time: mappedEndTime_(row),
    emp_id: text_(row.emp_id),
    instructor_name: text_(row.instructor_name),
    emp_id_2: text_(row.emp_id_2),
    instructor_name_2: text_(row.instructor_name_2),
    start_date: startIso,
    end_date: endIso,
    status: text_(row.status),
    notes: text_(row.notes),
    finance_status: normalizeFinance_(row.finance_status),
    finance_notes: text_(row.finance_notes),
    is_archived: text_(row.is_archived || row.archive || ''),
    archive: text_(row.archive || row.is_archived || ''),
    Payer: text_(row.Payer || ''),
    Payment: text_(row.Payment || '')
  };
  for (var i = 1; i <= 35; i++) {
    out['Date' + i] = normalizeDateTextToIso_(row['Date' + i]);
  }
  return out;
}

function summaryCacheKeyForSheet_(version, sheetName) {
  return 'pc:activities-summary:' + version + ':' + sheetName;
}

function readSummaryRowsFromCache_(version, sheetName) {
  var baseKey = summaryCacheKeyForSheet_(version, sheetName);
  var direct = scriptCacheGetJson_(baseKey);
  if (Object.prototype.toString.call(direct) === '[object Array]') return direct;
  if (!direct || !direct.chunk_count) return null;
  var total = parseInt(direct.chunk_count, 10) || 0;
  if (total <= 0) return null;
  var merged = [];
  for (var i = 0; i < total; i++) {
    var chunk = scriptCacheGetJson_(baseKey + ':chunk:' + i);
    if (Object.prototype.toString.call(chunk) !== '[object Array]') return null;
    merged = merged.concat(chunk);
  }
  return merged;
}

function writeSummaryRowsToCache_(version, sheetName, rows) {
  var baseKey = summaryCacheKeyForSheet_(version, sheetName);
  var ttl = CONFIG.SCRIPT_CACHE_SECONDS || 120;
  var putResult = scriptCachePutJson_(baseKey, rows, ttl);
  if (putResult && putResult.ok) return;

  var chunkSize = 200;
  var MIN_CHUNK_SIZE = 10;
  while (chunkSize >= MIN_CHUNK_SIZE) {
    var chunkCount = Math.ceil(rows.length / chunkSize);
    var allOk = true;
    for (var i = 0; i < chunkCount; i++) {
      var chunk = rows.slice(i * chunkSize, (i + 1) * chunkSize);
      var chunkPut = scriptCachePutJson_(baseKey + ':chunk:' + i, chunk, ttl);
      if (!chunkPut || !chunkPut.ok) {
        allOk = false;
        break;
      }
    }
    if (allOk) {
      scriptCachePutJson_(baseKey, { chunk_count: chunkCount }, ttl);
      return;
    }
    chunkSize = Math.floor(chunkSize / 2);
  }
  scriptCacheDebugMark_('summary_cache_write_failed', baseKey, JSON.stringify(rows).length);
}

function allActivitiesSummary_() {
  if (__rqCache_ && Object.prototype.hasOwnProperty.call(__rqCache_, 'allActivitiesSummary')) {
    return __rqCache_.allActivitiesSummary;
  }
  var version = dataViewsCacheVersion_();
  var list = [];
  var cols = projectedActivityColumnsForSummary_();
  var sourceSheets = configuredActivitiesSources_().filter(function(sheetName) {
    return sheetName === CONFIG.SHEETS.DATA_SHORT || sheetName === CONFIG.SHEETS.DATA_LONG;
  });

  sourceSheets.forEach(function(sheetName) {
    var cachedRows = readSummaryRowsFromCache_(version, sheetName);
    if (cachedRows) {
      list = list.concat(cachedRows);
      return;
    }
    var rows = readRowsProjected_(sheetName, cols).map(function(row) {
      var startIso = normalizeDateTextToIso_(row.start_date) || '';
      var endIso = normalizeDateTextToIso_(row.end_date) || startIso || '';
      return {
        source_sheet: sheetName,
        RowID: text_(row.RowID),
        activity_manager: text_(row.activity_manager),
        authority: text_(row.authority),
        school: text_(row.school),
        grade: text_(row.grade),
        class_group: text_(row.class_group),
        activity_type: text_(row.activity_type),
        activity_no: text_(row.activity_no),
        activity_name: text_(row.activity_name),
        sessions: text_(row.sessions),
        price: text_(row.price),
        funding: text_(row.funding),
        start_time: text_(row.start_time),
        end_time: text_(row.end_time),
        emp_id: text_(row.emp_id),
        instructor_name: text_(row.instructor_name),
        emp_id_2: text_(row.emp_id_2),
        instructor_name_2: text_(row.instructor_name_2),
        start_date: startIso,
        end_date: endIso,
        status: text_(row.status),
        notes: text_(row.notes),
        finance_status: normalizeFinance_(row.finance_status),
        finance_notes: text_(row.finance_notes),
        is_archived: text_(row.is_archived || row.archive || ''),
        archive: text_(row.archive || row.is_archived || ''),
        Payer: text_(row.Payer || ''),
        Payment: text_(row.Payment || ''),
        Date1: normalizeDateTextToIso_(row.Date1)
      };
    });
    writeSummaryRowsToCache_(version, sheetName, rows);
    list = list.concat(rows);
  });

  enrichRowsWithMeetings_(list);
  if (__rqCache_) {
    __rqCache_.allActivitiesSummary = list;
  }
  return list;
}

function visibleActivitiesForUser_(user) {
  if (__rqCache_ && __rqCache_.visibleActivitiesForUserCache) {
    return __rqCache_.visibleActivitiesForUserCache;
  }
  var result;
  if (user.display_role !== 'instructor') {
    result = allActivities_();
  } else {
    var empId = text_(user.emp_id || user.user_id);
    result = allActivities_().filter(function(row) {
      return text_(row.emp_id) === empId || text_(row.emp_id_2) === empId;
    });
  }
  if (__rqCache_) {
    __rqCache_.visibleActivitiesForUserCache = result;
  }
  return result;
}

/**
 * כמו visibleActivitiesForUser_ אבל משתמש ב-allActivitiesSummary_() (projected read)
 * במקום allActivities_() (full read). מתאים למסכי תצוגה בלבד (week, month) שאינם
 * זקוקים ל-Date2-Date35 ישירות — meetingsMap מטפל בהם.
 */
function visibleActivitiesSummaryForUser_(user) {
  if (__rqCache_ && __rqCache_.visibleActivitiesSummaryForUserCache) {
    return __rqCache_.visibleActivitiesSummaryForUserCache;
  }
  var result;
  if (user.display_role !== 'instructor') {
    result = allActivitiesSummary_();
  } else {
    var empId = text_(user.emp_id || user.user_id);
    result = allActivitiesSummary_().filter(function(row) {
      return text_(row.emp_id) === empId || text_(row.emp_id_2) === empId;
    });
  }
  if (__rqCache_) {
    __rqCache_.visibleActivitiesSummaryForUserCache = result;
  }
  return result;
}

function buildLongRows_() {
  if (__rqCache_ && __rqCache_.buildLongRows) {
    return __rqCache_.buildLongRows;
  }
  var built = readRows_(CONFIG.SHEETS.DATA_LONG).map(mapLongRow_);
  if (__rqCache_) {
    __rqCache_.buildLongRows = built;
  }
  return built;
}

function mapShortRow_(row) {
  return appendDateColumnsToMappedRow_({
    source_sheet: CONFIG.SHEETS.DATA_SHORT,
    RowID: text_(row.RowID),
    activity_manager: text_(row.activity_manager),
    authority: text_(row.authority),
    school: text_(row.school),
    grade: text_(row.grade),
    class_group: text_(row.class_group),
    activity_type: text_(row.activity_type),
    activity_no: text_(row.activity_no),
    activity_name: text_(row.activity_name),
    sessions: text_(row.sessions),
    price: text_(row.price),
    funding: text_(row.funding),
    start_time: mappedStartTime_(row),
    end_time: mappedEndTime_(row),
    emp_id: text_(row.emp_id),
    instructor_name: text_(row.instructor_name),
    emp_id_2: text_(row.emp_id_2),
    instructor_name_2: text_(row.instructor_name_2),
    status: text_(row.status),
    notes: text_(row.notes),
    finance_status: normalizeFinance_(row.finance_status),
    finance_notes: text_(row.finance_notes)
  }, row);
}

function mapLongRow_(row) {
  return appendDateColumnsToMappedRow_({
    source_sheet: CONFIG.SHEETS.DATA_LONG,
    RowID: text_(row.RowID),
    activity_manager: text_(row.activity_manager),
    authority: text_(row.authority),
    school: text_(row.school),
    grade: text_(row.grade),
    class_group: text_(row.class_group),
    activity_type: text_(row.activity_type),
    activity_no: text_(row.activity_no),
    activity_name: text_(row.activity_name),
    sessions: text_(row.sessions),
    price: text_(row.price),
    funding: text_(row.funding),
    start_time: mappedStartTime_(row),
    end_time: mappedEndTime_(row),
    emp_id: text_(row.emp_id),
    instructor_name: text_(row.instructor_name),
    emp_id_2: text_(row.emp_id_2),
    instructor_name_2: text_(row.instructor_name_2),
    status: text_(row.status),
    notes: text_(row.notes),
    finance_status: normalizeFinance_(row.finance_status),
    finance_notes: text_(row.finance_notes)
  }, row);
}

/** מזהי מדריך/ה תפעוליים ייחודיים מתוך שורות פעילות — רק emp_id ו-emp_id_2. */
function collectUniqueOperationalEmpIds_(activityRows) {
  var seen = {};
  activityRows.forEach(function(row) {
    var a = text_(row.emp_id);
    var b = text_(row.emp_id_2);
    if (a) seen[a] = true;
    if (b) seen[b] = true;
  });
  return Object.keys(seen).sort();
}

function countUniqueOperationalInstructors_(activityRows) {
  return collectUniqueOperationalEmpIds_(activityRows).length;
}

function collectUniqueInstructorNames_(activityRows) {
  var seen = {};
  activityRows.forEach(function(row) {
    var primaryName = text_(row.instructor_name) || text_(row.emp_id);
    var secondaryName = text_(row.instructor_name_2) || text_(row.emp_id_2);
    if (primaryName) seen[primaryName] = true;
    if (secondaryName) seen[secondaryName] = true;
  });
  return Object.keys(seen).sort();
}

/** מפת העשרה: emp_id -> שורה בגיליון contacts_instructors (תצוגה / פרטי קשר בלבד). */
function readInstructorContactsEnrichmentMap_() {
  var rows = readRows_(configuredInstructorContactsSourceSheet_());
  var map = {};
  rows.forEach(function(row) {
    var id = text_(row.emp_id);
    if (!id) return;
    if (!map[id]) map[id] = row;
  });
  return map;
}

/**
 * מסך instructors: ישות תפעולית — רשימת מזהים ייחודיים מ-data_short + data_long,
 * עם שדות תצוגה מהעשרה אופציונלית מ-contacts_instructors או משמות בפעילות.
 */
function buildOperationalInstructorsPayloadRows_() {
  var combined = [];
  configuredInstructorsSources_().forEach(function(sheetName) {
    if (sheetName === CONFIG.SHEETS.DATA_SHORT) {
      combined = combined.concat(readRows_(CONFIG.SHEETS.DATA_SHORT).map(mapShortRow_));
    } else if (sheetName === CONFIG.SHEETS.DATA_LONG) {
      combined = combined.concat(buildLongRows_());
    }
  });
  var ids = collectUniqueOperationalEmpIds_(combined);
  var enrich = readInstructorContactsEnrichmentMap_();
  var displayNameFromActivity = {};
  var activityCount = {};
  combined.forEach(function(row) {
    var e1 = text_(row.emp_id);
    var n1 = text_(row.instructor_name);
    if (e1) {
      if (n1 && !displayNameFromActivity[e1]) displayNameFromActivity[e1] = n1;
      activityCount[e1] = (activityCount[e1] || 0) + 1;
    }
    var e2 = text_(row.emp_id_2);
    var n2 = text_(row.instructor_name_2);
    if (e2) {
      if (n2 && !displayNameFromActivity[e2]) displayNameFromActivity[e2] = n2;
      activityCount[e2] = (activityCount[e2] || 0) + 1;
    }
  });
  return ids.map(function(empId) {
    var c = enrich[empId];
    var fromAct = displayNameFromActivity[empId] || '';
    var fullName = c ? text_(c.full_name) : fromAct;
    return {
      emp_id: empId,
      full_name: fullName,
      mobile: c ? text_(c.mobile) : '',
      email: c ? text_(c.email) : '',
      address: c ? text_(c.address) : '',
      employment_type: c ? text_(c.employment_type) : '',
      direct_manager: c ? text_(c.direct_manager) : '',
      active: c ? yesNo_(c.active) : 'yes',
      activity_count: activityCount[empId] || 0
    };
  });
}

function buildPrivateNotesMap_() {
  var rows = readRows_(CONFIG.SHEETS.PRIVATE_NOTES);
  var map = {};
  rows.forEach(function(row) {
    var key = text_(row.source_sheet) + '|' + text_(row.source_row_id);
    map[key] = row;
  });
  return map;
}

function getPrivateNoteRow_(sourceSheet, sourceRowId) {
  var rows = readRows_(CONFIG.SHEETS.PRIVATE_NOTES);
  var match = rows.find(function(row) {
    return text_(row.source_sheet) === text_(sourceSheet) &&
           text_(row.source_row_id) === text_(sourceRowId);
  });
  return match || null;
}

function upsertPrivateNoteRow_(rowObj) {
  var sheet = getSheet_(CONFIG.SHEETS.PRIVATE_NOTES);
  var headers = getHeaders_(sheet);
  var rows = readRows_(CONFIG.SHEETS.PRIVATE_NOTES);
  var index = rows.findIndex(function(row) {
    return text_(row.source_sheet) === text_(rowObj.source_sheet) &&
           text_(row.source_row_id) === text_(rowObj.source_row_id);
  });

  if (index < 0) {
    appendRow_(CONFIG.SHEETS.PRIVATE_NOTES, rowObj);
    return;
  }

  var updated = {};
  headers.forEach(function(header) {
    updated[header] = Object.prototype.hasOwnProperty.call(rowObj, header) ? rowObj[header] : rows[index][header];
  });

  var rowNumber = getDataStartRow_() + index;
  var values = headers.map(function(header) { return updated[header]; });
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([values]);
  invalidateReadRowsCache_(CONFIG.SHEETS.PRIVATE_NOTES);
}

function buildMeetingsMap_() {
  if (__rqCache_ && __rqCache_.meetingsMap) {
    return __rqCache_.meetingsMap;
  }
  var version = dataViewsCacheVersion_();
  var cacheKey = 'pc:meetings-map:' + version;
  var cached = scriptCacheGetJson_(cacheKey);
  if (cached && typeof cached === 'object' && !Array.isArray(cached)) {
    if (__rqCache_) __rqCache_.meetingsMap = cached;
    return cached;
  }
  var rows = readRows_(CONFIG.SHEETS.MEETINGS).filter(function(row) {
    return yesNo_(row.active) === 'yes';
  });

  var map = {};
  var byMeetingNo = {};
  rows.forEach(function(row) {
    var key = text_(row.source_row_id);
    var date = normalizeDateTextToIso_(row.meeting_date);
    var meetingNo = parseInt(text_(row.meeting_no), 10);
    if (!key || !date) return;
    if (!map[key]) map[key] = [];
    map[key].push(date);
    if (!byMeetingNo[key]) byMeetingNo[key] = {};
    if (meetingNo > 0 && (!byMeetingNo[key][meetingNo] || date < byMeetingNo[key][meetingNo])) {
      byMeetingNo[key][meetingNo] = date;
    }
  });

  Object.keys(map).forEach(function(key) {
    var uniq = {};
    map[key].forEach(function(date) { uniq[date] = true; });
    var allDates = Object.keys(uniq).sort();
    var firstMeetingDate = byMeetingNo[key] && byMeetingNo[key][1] ? byMeetingNo[key][1] : '';
    if (firstMeetingDate && allDates.indexOf(firstMeetingDate) >= 0) {
      map[key] = [firstMeetingDate].concat(allDates.filter(function(d) { return d !== firstMeetingDate; }));
    } else {
      map[key] = allDates;
    }
  });

  scriptCachePutJson_(
    cacheKey,
    map,
    CONFIG.MEETINGS_MAP_CACHE_SECONDS || CONFIG.SCRIPT_CACHE_SECONDS || 120
  );
  if (__rqCache_) {
    __rqCache_.meetingsMap = map;
  }
  return map;
}

function setMeetings_(sourceRowId, meetings) {
  sourceRowId = text_(sourceRowId);
  if (!sourceRowId) return;

  var cleaned = (meetings || []).map(function(item, idx) {
    if (typeof item === 'string') {
      return {
        source_row_id: sourceRowId,
        meeting_no: String(idx + 1),
        meeting_date: text_(item),
        notes: '',
        active: 'yes'
      };
    }
    return {
      source_row_id: sourceRowId,
      meeting_no: text_(item.meeting_no || String(idx + 1)),
      meeting_date: text_(item.meeting_date),
      notes: text_(item.notes),
      active: yesNo_(item.active || 'yes')
    };
  }).filter(function(item) {
    return !!text_(item.meeting_date);
  });

  deleteRowsByKey_(CONFIG.SHEETS.MEETINGS, 'source_row_id', sourceRowId);

  cleaned.forEach(function(row) {
    appendRow_(CONFIG.SHEETS.MEETINGS, row);
  });

  syncEndDateForRow_(sourceRowId);
  runDataMaintenance_('setMeetings');
}

function meetingsForRow_(sourceRowId) {
  var wanted = text_(sourceRowId);
  if (!wanted) return [];
  var rows = readRows_(CONFIG.SHEETS.MEETINGS).filter(function(row) {
    return text_(row.source_row_id) === wanted;
  }).map(function(row) {
    return {
      source_row_id: wanted,
      meeting_no: text_(row.meeting_no),
      meeting_date: normalizeDateTextToIso_(row.meeting_date),
      notes: text_(row.notes),
      active: yesNo_(row.active || 'yes')
    };
  }).filter(function(row) {
    return !!row.meeting_date;
  });

  rows.sort(function(a, b) {
    var na = parseInt(text_(a.meeting_no), 10);
    var nb = parseInt(text_(b.meeting_no), 10);
    if (na > 0 && nb > 0 && na !== nb) return na - nb;
    if (a.meeting_date !== b.meeting_date) return a.meeting_date < b.meeting_date ? -1 : 1;
    return 0;
  });
  return rows;
}

function normalizeMeetingsPatch_(sourceRowId, changes, currentRow) {
  var source = text_(sourceRowId);
  if (!source) return null;
  var payload = changes || {};
  var hasMeetingsArray = Object.prototype.hasOwnProperty.call(payload, 'meetings') && Array.isArray(payload.meetings);
  var keyedMeetingDates = [];
  var keyedMeetingActive = {};
  Object.keys(payload).forEach(function(key) {
    var md = /^meeting_date_(\d+)$/.exec(text_(key));
    if (md) {
      keyedMeetingDates.push({
        idx: parseInt(md[1], 10),
        date: normalizeDateTextToIso_(payload[key])
      });
      return;
    }
    var ma = /^meeting_active_(\d+)$/.exec(text_(key));
    if (ma) {
      keyedMeetingActive[parseInt(ma[1], 10)] = yesNo_(payload[key] || 'yes');
    }
  });
  keyedMeetingDates = keyedMeetingDates.filter(function(item) {
    return item.idx >= 0 && !!item.date;
  }).sort(function(a, b) {
    return a.idx - b.idx;
  });

  var sessionsProvided = Object.prototype.hasOwnProperty.call(payload, 'sessions');
  var sessionsCount = sessionsProvided ? Math.max(0, parseInt(text_(payload.sessions), 10) || 0) : null;

  if (!hasMeetingsArray && !keyedMeetingDates.length && !sessionsProvided) {
    return null;
  }

  var currentMeetings = meetingsForRow_(source);
  var nextMeetings = [];

  if (hasMeetingsArray) {
    nextMeetings = payload.meetings.map(function(item, idx) {
      return {
        source_row_id: source,
        meeting_no: text_(item && item.meeting_no) || String(idx + 1),
        meeting_date: normalizeDateTextToIso_(item && item.meeting_date),
        notes: text_(item && item.notes),
        active: yesNo_(item && item.active || 'yes')
      };
    }).filter(function(item) {
      return !!item.meeting_date;
    });
  } else if (keyedMeetingDates.length) {
    nextMeetings = keyedMeetingDates.map(function(item, idx) {
      return {
        source_row_id: source,
        meeting_no: String(idx + 1),
        meeting_date: item.date,
        notes: '',
        active: Object.prototype.hasOwnProperty.call(keyedMeetingActive, item.idx) ? keyedMeetingActive[item.idx] : 'yes'
      };
    });
  } else {
    nextMeetings = currentMeetings.slice();
  }

  if (sessionsCount !== null) {
    if (!nextMeetings.length) {
      var anchorDate = normalizeDateTextToIso_(payload.start_date) ||
        normalizeDateTextToIso_(currentRow && currentRow.start_date) ||
        (currentMeetings.length ? currentMeetings[0].meeting_date : '');
      for (var i = 0; i < sessionsCount; i++) {
        nextMeetings.push({
          source_row_id: source,
          meeting_no: String(i + 1),
          meeting_date: i === 0 ? anchorDate : '',
          notes: '',
          active: 'yes'
        });
      }
    }
    if (sessionsCount < nextMeetings.length) {
      nextMeetings = nextMeetings.slice(0, sessionsCount);
    } else if (sessionsCount > nextMeetings.length) {
      var lastDate = nextMeetings.length ? normalizeDateTextToIso_(nextMeetings[nextMeetings.length - 1].meeting_date) : '';
      for (var addIdx = nextMeetings.length; addIdx < sessionsCount; addIdx++) {
        var nextDate = '';
        if (lastDate) {
          var d = dateFromIso_(lastDate);
          if (d) {
            d.setDate(d.getDate() + 7);
            nextDate = formatDate_(d);
            lastDate = nextDate;
          }
        }
        nextMeetings.push({
          source_row_id: source,
          meeting_no: String(addIdx + 1),
          meeting_date: nextDate,
          notes: '',
          active: 'yes'
        });
      }
    }
  }

  nextMeetings = nextMeetings.map(function(item, idx) {
    return {
      source_row_id: source,
      meeting_no: String(idx + 1),
      meeting_date: normalizeDateTextToIso_(item.meeting_date),
      notes: text_(item.notes),
      active: yesNo_(item.active || 'yes')
    };
  }).filter(function(item) {
    return !!item.meeting_date;
  });

  return nextMeetings;
}

function setMeetingsFromRange_(sourceRowId, startDate, endDate) {
  var rows = [];
  if (text_(startDate)) {
    rows.push({
      source_row_id: sourceRowId,
      meeting_no: '1',
      meeting_date: text_(startDate),
      notes: '',
      active: 'yes'
    });
  }
  if (text_(endDate) && text_(endDate) !== text_(startDate)) {
    rows.push({
      source_row_id: sourceRowId,
      meeting_no: '2',
      meeting_date: text_(endDate),
      notes: '',
      active: 'yes'
    });
  }
  setMeetings_(sourceRowId, rows);
}

function updateEditRequestRows_(requestId, patch) {
  var sheet = getSheet_(CONFIG.SHEETS.EDIT_REQUESTS);
  var headers = getHeaders_(sheet);
  var rows = readRows_(CONFIG.SHEETS.EDIT_REQUESTS);

  rows.forEach(function(row, idx) {
    if (text_(row.request_id) !== text_(requestId)) return;

    var updated = {};
    headers.forEach(function(header) {
      updated[header] = Object.prototype.hasOwnProperty.call(patch, header) ? patch[header] : row[header];
    });

    var rowNumber = getDataStartRow_() + idx;
    var values = headers.map(function(header) { return updated[header]; });
    sheet.getRange(rowNumber, 1, 1, headers.length).setValues([values]);
  });
  invalidateReadRowsCache_(CONFIG.SHEETS.EDIT_REQUESTS);
}

/* ── listValuesForName_, activityTypesForFilters_, financeStatusesForFilters_,
      getLateEndDateCutoff_, settingYes_, settingShowShabbat_, getWeekStartDay_
      — הועברו ל-settings.gs ── */

function startOfWeekContaining_(date, startDay) {
  var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  var day = d.getDay();
  var diff = (day - startDay + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}

function hebrewWeekdayLabel_(jsDay) {
  var names = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  return names[jsDay] || '';
}

function listKey_(name) {
  return text_(name).toLowerCase();
}

function buildActivityNameOptionsFromListRows_(rows) {
  var out = [];
  var seen = {};
  (rows || []).forEach(function(row) {
    var label = text_(row.label || row.activity_name || row.value);
    if (!label) return;
    var parent = text_(row.parent_value || row.activity_type);
    var actNo = text_(row.activity_no);
    if (!actNo || /[^\d]/.test(actNo)) {
      var fromType = text_(row.activity_type);
      var fromValue = text_(row.value);
      var fromValueMatch = /activity_(\d+)/i.exec(fromValue);
      actNo = /^\d+$/.test(fromType) ? fromType : (fromValueMatch ? fromValueMatch[1] : '');
    }
    var sig = label + '\t' + actNo + '\t' + parent;
    if (seen[sig]) return;
    seen[sig] = true;
    out.push({
      label: label,
      activity_no: actNo,
      parent_value: parent,
      activity_type: text_(row.activity_type || row.parent_value || parent)
    });
  });
  return out;
}

function isActivityListRow_(key, value) {
  if (key === 'activity_name' || key === 'activity') return true;
  // שורה שה-value שלה מתחיל ב-activity_ + מספר היא רשומת פעילות
  if (/^activity_\d+/i.test(value)) return true;
  // list_name שמתאים לסוג פעילות מוגדר — program, workshop, after_school, tour, escape_room וכו'
  var activityTypes = configuredProgramActivityTypes_().concat(configuredOneDayActivityTypes_()).concat(['program']);
  return activityTypes.indexOf(key) >= 0;
}

function buildDropdownOptionsMapFromRows_(rows) {
  var out = {};
  var activityNameRows = [];
  (rows || []).forEach(function(row) {
    var key = listKey_(row.list_name);
    var value = text_(row.value || row.display_value || row.val);
    if (!key) return;
    if (isActivityListRow_(key, value)) {
      activityNameRows.push(row);
      return;
    }
    if (!value) return;
    if (!out[key]) out[key] = [];
    if (out[key].indexOf(value) < 0) out[key].push(value);
  });
  out.activity_names = buildActivityNameOptionsFromListRows_(activityNameRows);
  return out;
}

function roleRosterFromPermissions_() {
  var rows = readRows_(CONFIG.SHEETS.PERMISSIONS);
  var instructorNames = [];
  var managerNames = [];
  var instructorUsers = [];
  var managerUsers = [];
  var seenInstructors = {};
  var seenManagers = {};
  rows.forEach(function(row) {
    if (yesNo_(row.active) === 'no') return;
    var role = '';
    try {
      role = normalizeRole_(internalRoleFromPermissionRow_(row));
    } catch (_e) {
      role = '';
    }
    var name = text_(row.full_name || row.user_id);
    if (!name || name === 'שם מלא') return;
    var empId = text_(row.user_id);
    if (role === 'instructor') {
      if (!seenInstructors[name]) {
        seenInstructors[name] = true;
        instructorNames.push(name);
      }
      instructorUsers.push({ name: name, emp_id: empId });
      return;
    }
    if (role === 'activities_manager') {
      if (!seenManagers[name]) {
        seenManagers[name] = true;
        managerNames.push(name);
        managerUsers.push({ name: name, emp_id: empId });
      }
    }
  });
  return {
    instructor_names: instructorNames,
    activity_manager_names: managerNames,
    instructor_users: instructorUsers,
    activities_manager_users: managerUsers
  };
}

function buildDropdownOptionsMap_() {
  var out = buildDropdownOptionsMapFromRows_(readRows_(configuredDropdownSourceSheet_()));
  var roster = roleRosterFromPermissions_();
  var instructors = roster.instructor_names || [];
  var managers = roster.activity_manager_names || [];
  if (instructors.length) {
    out.instructor_name = instructors.slice();
    out.instructor_users = (roster.instructor_users || []).slice();
  }
  if (managers.length) {
    out.activity_manager = managers.slice();
    out.activities_manager_users = (roster.activities_manager_users || []).slice();
  }
  return out;
}

function buildClientSettingsPayload_() {
  var m = readActiveSettingsMap_();
  var navigation = buildNavigationSettings_();
  var roleDefaults = computeNonAdminRoleDefaults_();
  var roleDefaultsBool = {
    operation_manager: {
      can_edit_direct: (roleDefaults.operation_manager || {}).can_edit_direct === 'yes',
      can_add_activity: (roleDefaults.operation_manager || {}).can_add_activity === 'yes'
    },
    authorized_user: {
      can_edit_direct: (roleDefaults.authorized_user || {}).can_edit_direct === 'yes',
      can_add_activity: (roleDefaults.authorized_user || {}).can_add_activity === 'yes'
    },
    instructor: {
      can_edit_direct: (roleDefaults.instructor || {}).can_edit_direct === 'yes',
      can_add_activity: (roleDefaults.instructor || {}).can_add_activity === 'yes'
    }
  };
  return {
    system_name: getSettingText_('system_name', CONFIG.SYSTEM_NAME || 'Dashboard Taasiyeda'),
    data_start_row: getDataStartRow_(),
    activities_data_sources: configuredActivitiesSources_(),
    instructors_screen_sources: configuredInstructorsSources_(),
    instructor_contacts_source: configuredInstructorContactsSourceSheet_(),
    school_contacts_source: configuredSchoolContactsSourceSheet_(),
    program_activity_types: configuredProgramActivityTypes_(),
    one_day_activity_types: configuredOneDayActivityTypes_(),
    finance_display_rule: getSettingText_('finance_display_rule', CONFIG.DEFAULT_FINANCE_DISPLAY_RULE || 'ended_until_today'),
    finance_grouping_rule: getSettingText_('finance_grouping_rule', CONFIG.DEFAULT_FINANCE_GROUPING_RULE || 'gafen_by_school_else_funding'),
    week_start_day: getWeekStartDay_(),
    show_shabbat: settingShowShabbat_(),
    week_hide_saturday_column: getSettingBool_('week_hide_saturday_column', false),
    late_end_date_cutoff: getLateEndDateCutoff_(),
    show_only_nonzero_kpis: getSettingBool_('show_only_nonzero_kpis', true),
    use_status_with_dates: getSettingBool_('use_status_with_dates', true),
    hide_emp_id_on_screens: yesNo_(m.hide_emp_id_on_screens) === 'yes',
    hide_activity_no_on_screens: yesNo_(m.hide_activity_no_on_screens) === 'yes',
    hide_row_id_in_ui: getSettingBool_('hide_row_id_in_ui', true),
    hebrew_only_headers: getSettingBool_('hebrew_only_headers', true),
    exceptions_priority: configuredExceptionPriority_(),
    exceptions_primary_rule: getSettingText_('exceptions_primary_rule', 'first_by_priority'),
    all_data_fields_editable: getSettingBool_('all_data_fields_editable', true),
    constrained_fields_use_dropdown: getSettingBool_('constrained_fields_use_dropdown', true),
    dropdown_source_sheet: configuredDropdownSourceSheet_(),
    dropdown_options: buildDropdownOptionsMap_(),
    instructors_read_only: getSettingBool_('instructors_read_only', true),
    admin_direct_edit: getSettingBool_('admin_direct_edit', true),
    operations_direct_edit: getSettingBool_('operations_direct_edit', true),
    admin_can_add_rows: getSettingBool_('admin_can_add_rows', true),
    operations_can_add_rows: getSettingBool_('operations_can_add_rows', true),
    non_admin_edits_require_approval: getSettingBool_('non_admin_edits_require_approval', true),
    approval_target_role: getSettingText_('approval_target_role', 'operation_manager'),
    operations_default_view_key: getSettingText_('operations_default_view_key', 'view_operations_data'),
    admin_default_view_key: getSettingText_('admin_default_view_key', 'view_admin'),
    navigation: navigation,
    compact_layout_preferred: getSettingBool_('compact_layout_preferred', true),
    narrow_boxes_preferred: getSettingBool_('narrow_boxes_preferred', true),
    prefer_emoji_over_wide_boxes: getSettingBool_('prefer_emoji_over_wide_boxes', true),
    role_defaults: roleDefaultsBool
  };
}

/** פריטי לוח שנה ליום אחד — rows ו-meetingsMap מחושבים פעם אחת לכל בקשת week/month */
function activityItemsForCalendarDate_(rows, meetingsMap, dateKey) {
  var indexed = buildCalendarIndexForDateRange_(rows, meetingsMap, dateKey, dateKey);
  var ids = indexed.by_date[dateKey] || [];
  return ids.map(function(id) {
    return indexed.items_by_id[id];
  }).filter(Boolean);
}

function buildCalendarIndexForDateRange_(rows, meetingsMap, fromDate, toDate) {
  var fromIso = text_(fromDate);
  var toIso = text_(toDate);
  var byDate = {};
  var itemsById = {};
  if (!fromIso || !toIso || fromIso > toIso) {
    return { by_date: byDate, items_by_id: itemsById };
  }

  rows.forEach(function(row) {
    var rowId = text_(row.RowID);
    if (!rowId) return;
    itemsById[rowId] = row;

    var seenDate = {};
    var addRowToDate = function(dateKey) {
      if (!dateKey || dateKey < fromIso || dateKey > toIso || seenDate[dateKey]) return;
      seenDate[dateKey] = true;
      if (!byDate[dateKey]) byDate[dateKey] = [];
      byDate[dateKey].push(rowId);
    };

    var meetingDates = meetingsMap && meetingsMap[rowId];
    if (isDataLongRow_(row)) {
      if (meetingDates && meetingDates.length) {
        meetingDates.forEach(addRowToDate);
        return;
      }
    }

    var startIso = normalizeDateTextToIso_(row.start_date);
    var endIso = normalizeDateTextToIso_(row.end_date) || startIso;
    eachIsoDateInIntersection_(startIso, endIso, fromIso, toIso, addRowToDate);
  });

  return {
    by_date: byDate,
    items_by_id: itemsById
  };
}

function eachIsoDateInIntersection_(startIso, endIso, minIso, maxIso, onDate) {
  var startKey = text_(startIso);
  var endKey = text_(endIso);
  if (!startKey) return;
  if (!endKey) endKey = startKey;

  var fromIso = startKey > minIso ? startKey : minIso;
  var toIso = endKey < maxIso ? endKey : maxIso;
  if (!fromIso || !toIso || fromIso > toIso) return;

  var cursor = dateFromIso_(fromIso);
  if (!cursor) return;
  while (true) {
    var key = formatDate_(cursor);
    if (key > toIso) break;
    onDate(key);
    cursor = shiftDate_(cursor, 1);
  }
}

function dateFromIso_(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text_(iso));
  if (!m) return null;
  return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
}

function isActivityActiveBySpec_(row, todayIso) {
  var st = text_(row.status).toLowerCase();
  if (settingYes_('use_status_with_dates') && st === 'ended') {
    return false;
  }
  var s = text_(row.start_date);
  var e = text_(row.end_date || row.start_date);
  if (!s) return false;
  return todayIso >= s && todayIso <= e;
}

function countActiveByType_(rows, todayIso, activityType) {
  return rows.filter(function(row) {
    return text_(row.activity_type) === activityType && isActivityActiveBySpec_(row, todayIso);
  }).length;
}

/* ── Admin Settings ────────────────────────────────────────────────────────── */
function actionAdminSettings_(user, payload) {
  requireAnyRole_(user, ['admin', 'operation_manager']);
  var rows = [];
  try {
    var sheet = getSpreadsheet_().getSheetByName(CONFIG.SHEETS.SETTINGS);
    if (sheet) {
      rows = readRows_(CONFIG.SHEETS.SETTINGS);
    }
  } catch(e) {}
  return { rows: rows };
}

/* ── Save Finance Row (status + notes) ─────────────────────────────────────── */
function actionSaveFinanceRow_(user, payload) {
  requireAnyRole_(user, ['admin', 'operation_manager']);
  var sourceRowId = text_(payload.source_row_id || payload.RowID);
  var sourceSheet = text_(payload.source_sheet || (sourceRowId.indexOf('LONG-') === 0 ? CONFIG.SHEETS.DATA_LONG : CONFIG.SHEETS.DATA_SHORT));
  if (!sourceRowId) throw new Error('source_row_id is required');
  var changes = {};
  if (payload.finance_status !== undefined) changes.finance_status = text_(payload.finance_status);
  if (payload.finance_notes !== undefined) changes.finance_notes = text_(payload.finance_notes);
  if (Object.keys(changes).length === 0) throw new Error('no changes provided');
  updateRowByKey_(sourceSheet, 'RowID', sourceRowId, changes);
  scriptCacheInvalidateDataViews_();
  runDataMaintenance_('actionSaveFinanceRow');
  return { saved: true, source_row_id: sourceRowId };
}

/* ── Sync Finance (refresh cache + return timestamp) ───────────────────────── */
function actionSyncFinance_(user, payload) {
  requireAnyRole_(user, ['admin', 'operation_manager']);
  scriptCacheInvalidateDataViews_();
  return { synced: true, timestamp: new Date().toISOString() };
}

/* ── Sync End Dates (admin-only manual full sync) ─────────────────────────── */
function actionSyncEndDates_(user, payload) {
  requireAnyRole_(user, ['admin']);
  var result = syncDataLongDatesFromMeetings_();
  scriptCacheInvalidateDataViews_();
  return {
    synced: true,
    updated: Number(result && result.updated) || 0,
    error: text_(result && result.error),
    timestamp: new Date().toISOString()
  };
}

/* ── List Sheets — diagnostic for admin ─────────────────────────────────────── */
function actionListSheets_(user) {
  requireAnyRole_(user, ['admin']);
  var ss = getSpreadsheet_();
  var allSheets = ss.getSheets();

  var EXPECTED_COLS = {
    data_short: ['RowID', 'activity_manager', 'authority', 'school', 'activity_type',
                 'grade', 'class_group', 'activity_no', 'activity_name', 'sessions', 'price', 'funding',
                 'start_time', 'end_time', 'emp_id', 'instructor_name',
                 'status', 'notes', 'finance_status', 'finance_notes'],
    data_long: ['RowID', 'activity_manager', 'authority', 'school', 'activity_type',
                'grade', 'class_group', 'activity_no', 'activity_name', 'sessions', 'price', 'funding',
                'start_time', 'end_time', 'emp_id', 'instructor_name',
                'status', 'notes', 'finance_status', 'finance_notes'],
    permissions: ['user_id', 'full_name', 'display_role', 'entry_code'],
    settings: ['setting_key', 'setting_value', 'active']
  };

  var sheets = allSheets.map(function(sheet) {
    var name = sheet.getName();
    var lastCol = sheet.getLastColumn();
    var lastRow = sheet.getLastRow();
    var headers = [];
    if (lastCol > 0) {
      headers = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, lastCol).getValues()[0].map(text_);
    }
    var expected = EXPECTED_COLS[name];
    var missingCols = [];
    var extraCols = [];
    if (expected) {
      missingCols = expected.filter(function(c) { return headers.indexOf(c) < 0; });
      extraCols = headers.filter(function(c) { return c && expected.indexOf(c) < 0; });
    }
    return {
      name: name,
      headers: headers,
      row_count: Math.max(0, lastRow - CONFIG.DATA_START_ROW),
      is_system_sheet: !!expected,
      missing_cols: missingCols,
      extra_cols: extraCols,
      ok: !!expected && missingCols.length === 0
    };
  });

  var requiredSheetNames = Object.values(CONFIG.SHEETS);
  var missingSheets = requiredSheetNames.filter(function(name) {
    return !allSheets.some(function(s) { return s.getName() === name; });
  });

  return {
    sheets: sheets,
    missing_required_sheets: missingSheets,
    data_start_row: getDataStartRow_(),
    activities_data_sources: configuredActivitiesSources_()
  };
}
