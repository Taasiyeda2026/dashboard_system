function actionBootstrap_(user) {
  var permission = getPermissionRow_(user.user_id);
  var routes = effectiveRoutesForUser_(permission, user.display_role);
  var preferred = text_(permission.default_view) || defaultRouteForRole_(user.display_role);
  var defaultRoute = resolveDefaultRoute_(preferred, routes, user.display_role);

  return {
    role: user.display_role,
    default_route: defaultRoute,
    routes: routes,
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
  if (!text_(row.emp_id) && !text_(row.emp_id_2)) out.push('missing_instructor');
  if (!text_(row.start_date)) out.push('missing_start_date');
  if (text_(row.end_date) > getLateEndDateCutoff_()) out.push('late_end_date');
  return out;
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
  if (value === null || value === undefined || value === '') return '';
  var t = text_(value);
  if (!t) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  var m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(t);
  if (m) {
    var d = ('0' + parseInt(m[1], 10)).slice(-2);
    var mo = ('0' + parseInt(m[2], 10)).slice(-2);
    var y = m[3];
    var iso = y + '-' + mo + '-' + d;
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  }
  return '';
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

function activityStartDateFromRow_(row) {
  var src = getSettingText_('activity_start_date_source', 'Date1');
  var fromSrc = normalizeDateTextToIso_(row[src]);
  return fromSrc || normalizeDateTextToIso_(row.start_date) || '';
}

function activityEndDateFromRow_(row) {
  var rule = getSettingText_('activity_end_date_rule', 'last_valid_date_from_date_columns');
  var dates = activityDateColumnsFromRow_(row);
  if (rule === 'last_valid_date_from_date_columns') {
    // לפי ה-settings: תאריך סיום = התאריך האחרון התקין מבין עמודות Date1-Date35.
    // אין fallback לעמודת end_date — אם אין עמודות תאריך תקינות, תאריך הסיום ריק.
    if (!dates.length) return '';
    dates.sort();
    return dates[dates.length - 1];
  }
  // כלל אחר / לאחורה תואם
  if (!dates.length) return normalizeDateTextToIso_(row.end_date) || '';
  dates.sort();
  return dates[dates.length - 1];
}

function appendDateColumnsToMappedRow_(mapped, sourceRow) {
  for (var i = 1; i <= 35; i++) {
    var key = 'Date' + i;
    mapped[key] = normalizeDateTextToIso_(sourceRow[key]);
  }
  mapped.start_date = activityStartDateFromRow_(sourceRow);
  mapped.end_date = activityEndDateFromRow_(sourceRow);
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
  requireAnyRole_(user, ['admin', 'operations_reviewer', 'authorized_user']);

  var permission = getPermissionRow_(user.user_id);
  var canViewFinance = user.display_role === 'admin' ||
    yesNo_(permission.view_finance) === 'yes';

  var ym = dashboardPayloadYm_(payload || {});

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

  // תוכניות פעילות: סטטוס פתוח (לא סגור), ועם מפגש בחודש זה או תאריך סיום >= היום.
  // "ללא מדריך" ו"ללא תאריך התחלה" = לא פעיל → לא נכנסות לספירה.
  // "מפגש אחרי late_end_date_cutoff" = פעיל → נכנסת לספירה.
  // בודקים את כל סוגי החריגות של השורה (לא רק הראשית), כדי שתוכנית עם
  // missing_instructor ו-late_end_date גם יחד תיחשב כ"לא פעיל".
  var INACTIVE_EXCEPTION_TYPES = ['missing_instructor', 'missing_start_date'];
  var todayIso = formatDate_(new Date());
  var activeLongRows = longRows.filter(function(row) {
    if (text_(row.status) === 'סגור') return false;
    var allExcTypes = rowExceptionTypes_(row);
    var hasInactiveExc = allExcTypes.some(function(e) {
      return INACTIVE_EXCEPTION_TYPES.indexOf(e) >= 0;
    });
    if (hasInactiveExc) return false;
    var rowDates = dashMeetingsMap[text_(row.RowID)];
    var normalizedDates = [];
    if (rowDates && Array.isArray(rowDates)) {
      normalizedDates = rowDates.map(function(d) { return text_(d); }).filter(Boolean);
    }
    var hasSessionInYm = normalizedDates.some(function(d) { return d.slice(0, 7) === ym; });
    var endOnOrAfterToday = text_(row.end_date) >= todayIso;
    return hasSessionInYm || endOnOrAfterToday;
  });

  var byManager = {};
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
    var t = text_(row.activity_type);
    if (oneDayTypes.indexOf(t) >= 0) {
      byManager[manager].total_short += 1;
      byManager[manager].total += 1;
    } else if (programTypes.indexOf(t) >= 0) {
      byManager[manager].total_long += 1;
      byManager[manager].total += 1;
    }
  });

  // Compute per-manager extended stats
  Object.keys(byManager).forEach(function(manager) {
    var mShort = shortRows.filter(function(r) { return (text_(r.activity_manager) || 'unassigned') === manager; });
    var mLong = longRows.filter(function(r) { return (text_(r.activity_manager) || 'unassigned') === manager; });
    var mCombined = mShort.concat(mLong);
    byManager[manager].num_instructors = countUniqueOperationalInstructors_(mCombined);
    byManager[manager].course_endings = mLong.filter(function(r) {
      return text_(r.activity_type) === 'course' && text_(r.end_date).slice(0, 7) === ym;
    }).length;
    if (canViewFinance) {
      byManager[manager].finance_open = mCombined.filter(function(r) {
        return normalizeFinance_(r.finance_status) === 'open';
      }).length;
    }
    byManager[manager].exceptions = mLong.filter(function(r) {
      return !!primaryExceptionForRow_(r);
    }).length;
    // תוכניות פעילות: לפי ההגדרה החדשה (סטטוס פתוח, ללא חריגות, מפגש בחודש או סיום >= היום)
    byManager[manager].total_long = activeLongRows.filter(function(r) {
      return (text_(r.activity_manager) || 'unassigned') === manager;
    }).length;
  });

  var courseEndings = longRows.filter(function(row) {
    return text_(row.activity_type) === 'course' && text_(row.end_date).slice(0, 7) === ym;
  }).length;

  var financeOpenCount = canViewFinance ? combined.filter(function(row) {
    return normalizeFinance_(row.finance_status) === 'open';
  }).length : 0;

  var exceptionSum = 0;
  longRows.forEach(function(row) {
    if (primaryExceptionForRow_(row)) exceptionSum += 1;
  });

  var kpi_cards_all = [
    { id: 'short', action: 'kpi|short', title: String(shortRows.length), subtitle: 'חד-יומי', value: shortRows.length },
    { id: 'long', action: 'kpi|long', title: String(activeLongRows.length), subtitle: 'תוכניות', value: activeLongRows.length },
    {
      id: 'active_courses',
      action: 'kpi|active_courses',
      title: String(countActiveByTypeInYm_(combined, ym, 'course')),
      subtitle: 'קורסים פעילים',
      value: countActiveByTypeInYm_(combined, ym, 'course')
    },
    {
      id: 'active_workshops',
      action: 'kpi|active_workshops',
      title: String(countActiveByTypeInYm_(combined, ym, 'workshop')),
      subtitle: 'סדנאות פעילות',
      value: countActiveByTypeInYm_(combined, ym, 'workshop')
    },
    {
      id: 'active_tours',
      action: 'kpi|active_tours',
      title: String(countActiveByTypeInYm_(combined, ym, 'tour')),
      subtitle: 'סיורים פעילים',
      value: countActiveByTypeInYm_(combined, ym, 'tour')
    },
    {
      id: 'active_after_school',
      action: 'kpi|active_after_school',
      title: String(countActiveByTypeInYm_(combined, ym, 'after_school')),
      subtitle: 'אפטרסקול פעיל',
      value: countActiveByTypeInYm_(combined, ym, 'after_school')
    },
    {
      id: 'active_escape_room',
      action: 'kpi|active_escape_room',
      title: String(countActiveByTypeInYm_(combined, ym, 'escape_room')),
      subtitle: 'חדרי בריחה פעילים',
      value: countActiveByTypeInYm_(combined, ym, 'escape_room')
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
    kpi_cards: kpi_cards,
    show_only_nonzero_kpis: settingYes_('show_only_nonzero_kpis')
  };
  return result;
}

function actionActivities_(user, payload) {
  requireAnyRole_(user, ['admin', 'operations_reviewer', 'authorized_user']);

  var allRows = allActivitiesSummary_();
  var today = formatDate_(new Date());
  var typeKeys = listValuesForName_('activity_type');
  if (!typeKeys.length) {
    typeKeys = configuredProgramActivityTypes_().concat(configuredOneDayActivityTypes_());
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
    if (family === 'short' && configuredOneDayActivityTypes_().indexOf(text_(row.activity_type)) < 0) return false;
    if (family === 'long' && configuredProgramActivityTypes_().indexOf(text_(row.activity_type)) < 0) return false;
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
    filters: {
      activity_types: activityTypesForFilters_(),
      finance_statuses: financeStatusesForFilters_()
    }
  };
}

function mapActivitySummaryRowForList_(row, user, noteMap, meetingsMap, today) {
  var noteKey = row.source_sheet + '|' + row.RowID;
  var noteRow = noteMap[noteKey];
  var meetingsFromSheet = meetingsMap[text_(row.RowID)];
  var meetingDates = (meetingsFromSheet && meetingsFromSheet.length
    ? meetingsFromSheet.slice()
    : activityDateColumnsFromRow_(row).filter(function(v, i, arr) {
      return !!v && arr.indexOf(v) === i;
    }).sort());
  var dateRange = meetingDateRangeFromList_(meetingDates);
  var computedStartDate = dateRange.start || normalizeDateTextToIso_(row.Date1);
  var computedEndDate = dateRange.end || '';
  return {
    RowID: row.RowID,
    source_sheet: row.source_sheet,
    activity_manager: row.activity_manager,
    authority: row.authority,
    school: row.school,
    activity_type: row.activity_type,
    activity_name: row.activity_name,
    emp_id: row.emp_id,
    emp_id_2: row.emp_id_2,
    start_date: computedStartDate,
    end_date: computedEndDate,
    status: row.status,
    finance_status: row.finance_status,
    meetings_total: meetingDates.length,
    meetings_done: meetingDates.filter(function(dateKey) { return dateKey <= today; }).length,
    meetings_remaining: meetingDates.filter(function(dateKey) { return dateKey > today; }).length,
    private_note: user.display_role === 'operations_reviewer' && noteRow && yesNo_(noteRow.active) === 'yes'
      ? text_(noteRow.note_text)
      : ''
  };
}

function mapActivityDetailRowForDrawer_(row, user) {
  var noteMap = buildPrivateNotesMap_();
  var meetingsMap = buildMeetingsMap_();
  var today = formatDate_(new Date());
  var summary = mapActivitySummaryRowForList_(row, user, noteMap, meetingsMap, today);
  var meetingsFromSheet = meetingsMap[text_(row.RowID)];
  var meetingDates = (meetingsFromSheet && meetingsFromSheet.length
    ? meetingsFromSheet.slice()
    : activityDateColumnsFromRow_(row).filter(function(v, i, arr) {
      return !!v && arr.indexOf(v) === i;
    }).sort());
  var meetingSchedule = meetingDates.map(function(dateKey) {
    return { date: dateKey, performed: dateKey <= today ? 'yes' : 'no' };
  });
  var detail = {
    RowID: summary.RowID,
    source_sheet: summary.source_sheet,
    activity_manager: summary.activity_manager,
    authority: summary.authority,
    school: summary.school,
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
  requireAnyRole_(user, ['admin', 'operations_reviewer', 'authorized_user']);
  var sourceRowId = text_((payload || {}).source_row_id || (payload || {}).RowID);
  var sourceSheet = text_((payload || {}).source_sheet);
  var row = findActivityRowById_(sourceRowId, sourceSheet);
  return { row: mapActivityDetailRowForDrawer_(row, user) };
}

function actionWeek_(user, payload) {
  requireAnyRole_(user, ['admin', 'operations_reviewer', 'authorized_user', 'instructor']);

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

  return {
    days: days,
    items_by_id: itemsById,
    week_starts_on: startDay,
    show_shabbat: showSat,
    week_hide_saturday_column: hideSatColumn,
    week_offset: weekOffset
  };
}

function actionMonth_(user, payload) {
  requireAnyRole_(user, ['admin', 'operations_reviewer', 'authorized_user', 'instructor']);

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

function actionExceptions_(user) {
  requireAnyRole_(user, ['admin', 'operations_reviewer', 'authorized_user']);

  // enrichRowsWithMeetings_ מעדכן end_date לתאריך המפגש האחרון האמיתי מגיליון activity_meetings,
  // כך שבדיקת late_end_date תזהה נכון קורסים עם מפגשים מעבר ל-late_end_date_cutoff.
  var rows = enrichRowsWithMeetings_(buildLongRows_().slice());
  var counts = {
    missing_instructor: 0,
    missing_start_date: 0,
    late_end_date: 0
  };
  var result = [];

  rows.forEach(function(row) {
    var exceptionType = primaryExceptionForRow_(row);
    if (!exceptionType) return;

    counts[exceptionType] += 1;
    result.push({
      RowID:              row.RowID,
      activity_name:     row.activity_name,
      activity_manager:  row.activity_manager,
      activity_type:     row.activity_type,
      activity_no:       row.activity_no,
      authority:         row.authority,
      school:            row.school,
      emp_id:            row.emp_id,
      instructor_name:   row.instructor_name,
      emp_id_2:          row.emp_id_2,
      instructor_name_2: row.instructor_name_2,
      status:            row.status,
      start_date:        row.start_date,
      end_date:          row.end_date,
      sessions:          row.sessions,
      notes:             row.notes,
      exception_type:    exceptionType
    });
  });

  return {
    rows: result,
    counts: counts,
    priority: configuredExceptionPriority_()
  };
}

function actionFinance_(user, payload) {
  requireAnyRole_(user, ['admin', 'operations_reviewer', 'authorized_user']);

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
  if (dateFrom && !DATE_RE.test(dateFrom)) dateFrom = '';
  if (dateTo && !DATE_RE.test(dateTo)) dateTo = '';

  var rows = allActivitiesSummary_().filter(function(row) {
    if (rule === 'ended_until_today') {
      var e = text_(row.end_date || row.start_date);
      return !!e && e <= today;
    }
    return true;
  });

  if (dateFrom || dateTo) {
    rows = rows.filter(function(row) {
      var d = text_(row.end_date || row.start_date);
      if (!d) return false;
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
      return true;
    });
  }

  if (monthYm && /^\d{4}-\d{2}$/.test(monthYm)) {
    var p = monthYm.split('-');
    var yy = parseInt(p[0], 10);
    var mm = parseInt(p[1], 10);
    var prev = new Date(yy, mm - 2, 1);
    var prevYm = Utilities.formatDate(prev, Session.getScriptTimeZone(), 'yyyy-MM');
    rows = rows.filter(function(row) {
      var ym = text_(row.end_date || '').slice(0, 7);
      return ym === monthYm || ym === prevYm;
    });
  }

  rows = rows.filter(function(row) {
    var isArchived = text_(row.is_archived || row.archive).toLowerCase();
    if (tab === 'active' && (isArchived === 'yes' || isArchived === 'true' || isArchived === '1')) return false;
    if (tab === 'archive' && !(isArchived === 'yes' || isArchived === 'true' || isArchived === '1')) return false;
    if (statusFilter && text_(normalizeFinance_(row.finance_status)) !== statusFilter) return false;
    if (search) {
      var hay = [
        row.RowID, row.activity_name, row.school, row.activity_manager,
        row.funding, row.authority, row.Payer
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
  requireAnyRole_(user, ['admin', 'operations_reviewer', 'authorized_user']);
  var sourceRowId = text_((payload || {}).source_row_id || (payload || {}).RowID);
  var sourceSheet = text_((payload || {}).source_sheet);
  var row = findActivityRowById_(sourceRowId, sourceSheet);
  var mapped = mapActivityDetailRowForDrawer_(row, user);
  mapped.finance_status = normalizeFinance_(mapped.finance_status);
  return { row: mapped };
}

function actionInstructors_(user) {
  requireAnyRole_(user, ['admin', 'operations_reviewer', 'authorized_user']);

  return {
    rows: buildOperationalInstructorsPayloadRows_()
  };
}

function actionContacts_(user) {
  requireAnyRole_(user, ['admin', 'operations_reviewer', 'authorized_user']);
  var permission = getPermissionRow_(user.user_id);
  if (!schoolContactsViewYes_(permission)) {
    throw new Error('Forbidden');
  }

  var schoolRows = readRows_(configuredSchoolContactsSourceSheet_()).map(function(row) {
    return {
      kind: 'school',
      emp_id: '',
      full_name: '',
      authority: text_(row.authority),
      school: text_(row.school),
      contact_name: text_(row.contact_name),
      phone: text_(row.phone),
      mobile: text_(row.mobile),
      email: text_(row.email)
    };
  });

  return { rows: schoolRows };
}

function actionInstructorContacts_(user) {
  requireAnyRole_(user, ['admin', 'operations_reviewer', 'authorized_user']);
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
  requireAnyRole_(user, ['admin', 'operations_reviewer', 'authorized_user']);
  var permission = getPermissionRow_(user.user_id);
  if (!endDatesViewYes_(permission)) {
    throw new Error('Forbidden');
  }

  var longRows = enrichRowsWithMeetings_(buildLongRows_().slice());
  var rows = longRows
    .filter(function(row) {
      return !!text_(row.end_date);
    })
    .map(function(row) {
      return {
        RowID: row.RowID,
        activity_name: row.activity_name,
        activity_type: text_(row.activity_type),
        activity_manager: text_(row.activity_manager),
        authority: text_(row.authority),
        school: text_(row.school),
        start_date: text_(row.start_date),
        end_date: text_(row.end_date),
        status: text_(row.status),
        source_sheet: row.source_sheet
      };
    });

  rows.sort(function(a, b) {
    return text_(a.end_date).localeCompare(text_(b.end_date));
  });

  return { rows: rows };
}

function actionMyData_(user) {
  requireAnyRole_(user, ['admin', 'operations_reviewer', 'authorized_user', 'instructor']);
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
  requireAnyRole_(user, ['admin', 'operations_reviewer', 'authorized_user']);
  var permission = getPermissionRow_(user.user_id);
  if (yesNo_(permission.view_operations_data) !== 'yes' && user.display_role !== 'admin') {
    throw new Error('Forbidden');
  }
  var search = text_((payload || {}).search || '').toLowerCase();
  var activityType = text_((payload || {}).activity_type || '');
  var rows = allActivitiesSummary_().filter(function(row) {
    if (activityType && text_(row.activity_type) !== activityType) return false;
    if (search) {
      var hay = [row.RowID, row.activity_name, row.activity_type, row.start_date, row.end_date].map(text_).join(' ').toLowerCase();
      if (hay.indexOf(search) < 0) return false;
    }
    return true;
  }).map(function(row) {
    return {
      RowID: row.RowID,
      source_sheet: row.source_sheet,
      activity_name: row.activity_name,
      start_date: row.start_date,
      end_date: row.end_date,
      activity_type: row.activity_type
    };
  });
  return { rows: rows };
}

function actionOperationsDetail_(user, payload) {
  requireAnyRole_(user, ['admin', 'operations_reviewer', 'authorized_user']);
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
  requireAnyRole_(user, ['admin', 'operations_reviewer', 'authorized_user']);
  var permission = getPermissionRow_(user.user_id);
  var canReview = user.display_role === 'admin' ||
    (user.display_role === 'operations_reviewer' && yesNo_(permission.can_review_requests) === 'yes');

  var rows = readRows_(CONFIG.SHEETS.EDIT_REQUESTS).filter(function(r) {
    return yesNo_(r.active) === 'yes';
  });

  if (!canReview) {
    var myId = text_(user.user_id);
    rows = rows.filter(function(r) {
      return text_(r.requested_by_user_id) === myId;
    });
  }

  var groups = {};
  var order = [];
  rows.forEach(function(r) {
    var rid = text_(r.request_id);
    if (!groups[rid]) {
      groups[rid] = {
        request_id: rid,
        source_sheet: text_(r.source_sheet),
        source_row_id: text_(r.source_row_id),
        requested_by_user_id: text_(r.requested_by_user_id),
        requested_by_name: text_(r.requested_by_name),
        requested_at: text_(r.requested_at),
        status: text_(r.status),
        reviewed_at: text_(r.reviewed_at),
        reviewed_by: text_(r.reviewed_by),
        reviewer_notes: text_(r.reviewer_notes),
        fields: []
      };
      order.push(rid);
    }
    groups[rid].fields.push({
      field_name: text_(r.field_name),
      old_value: text_(r.old_value),
      new_value: text_(r.new_value)
    });
  });

  var result = order.map(function(rid) { return groups[rid]; });
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
 * Returns { operations_reviewer: {...}, authorized_user: {...}, instructor: {} }
 * where each value is a flag-name → 'yes'/'no' object.
 */
function computeNonAdminRoleDefaults_() {
  var defaults = {
    operations_reviewer: {
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
  var nonAdminRoles = ['operations_reviewer', 'authorized_user', 'instructor'];
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
  requireAnyRole_(user, ['admin', 'operations_reviewer']);
  var permission = getPermissionRow_(user.user_id);
  // Admin always has access; for operations_reviewer require explicit flag
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

  var common = {
    RowID: rowId,
    activity_manager: text_(activity.activity_manager),
    authority: text_(activity.authority),
    school: text_(activity.school),
    activity_type: text_(activity.activity_type),
    activity_no: text_(activity.activity_no),
    activity_name: text_(activity.activity_name),
    sessions: text_(activity.sessions),
    price: text_(activity.price),
    funding: text_(activity.funding),
    start_time: text_(activity.start_time),
    end_time: text_(activity.end_time),
    emp_id: text_(activity.emp_id),
    instructor_name: text_(activity.instructor_name),
    status: text_(activity.status || 'active'),
    notes: text_(activity.notes),
    finance_status: normalizeFinance_(activity.finance_status),
    finance_notes: text_(activity.finance_notes)
  };
  var dateCols = dateColumnsPatchFromActivityPayload_(activity);

  if (targetSheet === CONFIG.SHEETS.DATA_SHORT) {
    appendRow_(targetSheet, {
      RowID: common.RowID,
      activity_manager: common.activity_manager,
      authority: common.authority,
      school: common.school,
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
      emp_id_2: text_(activity.emp_id_2),
      instructor_name_2: text_(activity.instructor_name_2),
      Date1: dateCols.Date1 || '',
      Date2: dateCols.Date2 || '',
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
      Date1: dateCols.Date1 || '',
      status: common.status,
      notes: common.notes,
      finance_status: common.finance_status,
      finance_notes: common.finance_notes,
      Date2: dateCols.Date2 || '',
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

  scriptCacheInvalidateDataViews_();
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

  if (!sourceRowId) throw new Error('source_row_id is required');

  var permission = getPermissionRow_(user.user_id);
  if (user.display_role === 'instructor') {
    throw new Error('Forbidden');
  }
  var datePatch = dateColumnsPatchFromChanges_(changes);
  Object.keys(datePatch).forEach(function(k) {
    changes[k] = datePatch[k];
  });
  if (!effectiveCanEditDirect_(permission, user.display_role)) {
    return actionSubmitEditRequest_(user, {
      source_sheet: sourceSheet,
      source_row_id: sourceRowId,
      changes: changes
    });
  }

  updateRowByKey_(sourceSheet, 'RowID', sourceRowId, changes);

  scriptCacheInvalidateDataViews_();
  return {
    updated: true,
    source_sheet: sourceSheet,
    source_row_id: sourceRowId
  };
}

function actionSubmitEditRequest_(user, payload) {
  requireAnyRole_(user, ['authorized_user']);
  if (user.display_role === 'instructor') {
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

  Object.keys(changes).forEach(function(fieldName) {
    appendRow_(CONFIG.SHEETS.EDIT_REQUESTS, {
      request_id: requestId,
      source_sheet: sourceSheet,
      source_row_id: sourceRowId,
      field_name: fieldName,
      old_value: text_(currentRow[fieldName]),
      new_value: text_(changes[fieldName]),
      requested_by_user_id: text_(user.user_id),
      requested_by_name: text_(user.full_name),
      requested_at: new Date().toISOString(),
      status: 'pending',
      reviewed_at: '',
      reviewed_by: '',
      reviewer_notes: '',
      active: 'yes'
    });
  });

  return {
    created: true,
    request_id: requestId
  };
}

function actionReviewEditRequest_(user, payload) {
  var permission = getPermissionRow_(user.user_id);
  var approvalTarget = getSettingText_('approval_target_role', 'operations_reviewer');
  if (approvalTarget && text_(user.display_role) !== approvalTarget) {
    throw new Error('Forbidden');
  }
  if (yesNo_(permission.can_review_requests) !== 'yes') {
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

  if (status === 'approved') {
    var sourceSheet = text_(requestRows[0].source_sheet);
    var sourceRowId = text_(requestRows[0].source_row_id);
    var changes = {};

    requestRows.forEach(function(row) {
      changes[text_(row.field_name)] = text_(row.new_value);
    });

    updateRowByKey_(sourceSheet, 'RowID', sourceRowId, changes);

    if (sourceSheet === CONFIG.SHEETS.DATA_LONG && (changes.start_date || changes.end_date)) {
      setMeetingsFromRange_(sourceRowId, text_(changes.start_date), text_(changes.end_date));
    }
  }

  updateEditRequestRows_(requestId, {
    status: status,
    reviewed_at: new Date().toISOString(),
    reviewed_by: text_(user.user_id),
    reviewer_notes: reviewerNotes
  });

  scriptCacheInvalidateDataViews_();
  return {
    reviewed: true,
    request_id: requestId,
    status: status
  };
}

function actionSavePermission_(user, payload) {
  requireAnyRole_(user, ['admin', 'operations_reviewer']);

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
  if (yesNo_(permission.can_review_requests) !== 'yes' || user.display_role !== 'operations_reviewer') {
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
    var dates = meetingsMap[text_(row.RowID)];
    if (dates && dates.length) {
      var range = meetingDateRangeFromList_(dates);
      row.start_date = range.start;
      // שימור ה-end_date המקורי אם הוא מאוחר יותר מהמפגש האחרון,
      // כדי שקורס עם תאריך סיום מאוחר לא יאבד את החריגה late_end_date
      // רק בגלל שהמפגשים הרשומים עדיין לא הגיעו לאותו תאריך.
      var origEnd = text_(row.end_date);
      row.end_date = (range.end > origEnd) ? range.end : origEnd;
    }
  });
  return rows;
}

function meetingDateRangeFromList_(dates) {
  var list = (dates || []).map(function(v) { return text_(v); }).filter(Boolean);
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
  var out = {
    source_sheet: sheetName,
    RowID: text_(row.RowID),
    activity_manager: text_(row.activity_manager),
    authority: text_(row.authority),
    school: text_(row.school),
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
    start_date: normalizeDateTextToIso_(row.start_date) || normalizeDateTextToIso_(row.Date1),
    end_date: normalizeDateTextToIso_(row.end_date) || normalizeDateTextToIso_(row.start_date) || normalizeDateTextToIso_(row.Date1),
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
      return {
        source_sheet: sheetName,
        RowID: text_(row.RowID),
        activity_manager: text_(row.activity_manager),
        authority: text_(row.authority),
        school: text_(row.school),
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
        start_date: normalizeDateTextToIso_(row.start_date) || normalizeDateTextToIso_(row.Date1),
        end_date: normalizeDateTextToIso_(row.end_date) || normalizeDateTextToIso_(row.start_date) || normalizeDateTextToIso_(row.Date1),
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
    var date = text_(row.meeting_date);
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

  scriptCachePutJson_(cacheKey, map, CONFIG.SCRIPT_CACHE_SECONDS || 120);
  if (__rqCache_) {
    __rqCache_.meetingsMap = map;
  }
  return map;
}

function setMeetings_(sourceRowId, meetings) {
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

function buildDropdownOptionsMap_() {
  var rows = readRows_(configuredDropdownSourceSheet_());
  var out = {};
  rows.forEach(function(row) {
    var listName = text_(row.list_name);
    var value = text_(row.value || row.display_value || row.val);
    if (!listName || !value) return;
    if (!out[listName]) out[listName] = [];
    if (out[listName].indexOf(value) < 0) out[listName].push(value);
  });
  return out;
}

function buildClientSettingsPayload_() {
  var m = readActiveSettingsMap_();
  var navigation = buildNavigationSettings_();
  var roleDefaults = computeNonAdminRoleDefaults_();
  var roleDefaultsBool = {
    operations_reviewer: {
      can_edit_direct: (roleDefaults.operations_reviewer || {}).can_edit_direct === 'yes',
      can_add_activity: (roleDefaults.operations_reviewer || {}).can_add_activity === 'yes'
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
    approval_target_role: getSettingText_('approval_target_role', 'operations_reviewer'),
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
    if (meetingDates && meetingDates.length) {
      meetingDates.forEach(addRowToDate);
      return;
    }

    var dlist = activityDateColumnsFromRow_(row);
    if (dlist.length) {
      dlist.forEach(addRowToDate);
      return;
    }

    var startIso = text_(row.start_date) || normalizeDateTextToIso_(row.Date1);
    var endIso = text_(row.end_date) || activityEndDateFromRow_(row);
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
  requireAnyRole_(user, ['admin', 'operations_reviewer']);
  var rows = [];
  try {
    var sheet = getSpreadsheet_().getSheetByName(CONFIG.SHEETS.SETTINGS);
    if (sheet) {
      rows = readRows_(CONFIG.SHEETS.SETTINGS);
    }
  } catch(e) {}
  return { rows: rows };
}

/* ── Admin Lists ────────────────────────────────────────────────────────────── */
function actionAdminLists_(user, payload) {
  requireAnyRole_(user, ['admin', 'operations_reviewer']);
  var rows = [];
  try {
    var sheet = getSpreadsheet_().getSheetByName(configuredDropdownSourceSheet_());
    if (sheet) {
      rows = readRows_(configuredDropdownSourceSheet_());
    }
  } catch(e) {}

  /* If rows have a list_name column, group by it; otherwise return raw rows */
  var hasListName = rows.length > 0 && rows[0].hasOwnProperty('list_name');
  if (hasListName) {
    var grouped = {};
    rows.forEach(function(r) {
      var listName = text_(r.list_name).toLowerCase();
      var val = text_(r.value || r.display_value || r.val || '');
      if (!listName || !val) return;
      if (!grouped[listName]) grouped[listName] = [];
      grouped[listName].push(val);
    });
    return {
      schools: grouped['schools'] || grouped['school'] || [],
      fundings: grouped['fundings'] || grouped['funding'] || [],
      authorities: grouped['authorities'] || grouped['authority'] || [],
      activity_types: grouped['activity_types'] || grouped['activity_type'] || [],
      managers: grouped['managers'] || grouped['manager'] || [],
      raw: rows
    };
  }
  return { rows: rows, raw: rows };
}

/* ── Save Finance Row (status + notes) ─────────────────────────────────────── */
function actionSaveFinanceRow_(user, payload) {
  requireAnyRole_(user, ['admin', 'operations_reviewer']);
  var sourceRowId = text_(payload.source_row_id || payload.RowID);
  var sourceSheet = text_(payload.source_sheet || (sourceRowId.indexOf('LONG-') === 0 ? CONFIG.SHEETS.DATA_LONG : CONFIG.SHEETS.DATA_SHORT));
  if (!sourceRowId) throw new Error('source_row_id is required');
  var changes = {};
  if (payload.finance_status !== undefined) changes.finance_status = text_(payload.finance_status);
  if (payload.finance_notes !== undefined) changes.finance_notes = text_(payload.finance_notes);
  if (Object.keys(changes).length === 0) throw new Error('no changes provided');
  updateRowByKey_(sourceSheet, 'RowID', sourceRowId, changes);
  scriptCacheInvalidateDataViews_();
  return { saved: true, source_row_id: sourceRowId };
}

/* ── Sync Finance (refresh cache + return timestamp) ───────────────────────── */
function actionSyncFinance_(user, payload) {
  requireAnyRole_(user, ['admin', 'operations_reviewer']);
  scriptCacheInvalidateDataViews_();
  return { synced: true, timestamp: new Date().toISOString() };
}

/* ── List Sheets — diagnostic for admin ─────────────────────────────────────── */
function actionListSheets_(user) {
  requireAnyRole_(user, ['admin']);
  var ss = getSpreadsheet_();
  var allSheets = ss.getSheets();

  var EXPECTED_COLS = {
    data_short: ['RowID', 'activity_manager', 'authority', 'school', 'activity_type',
                 'activity_no', 'activity_name', 'sessions', 'price', 'funding',
                 'start_time', 'end_time', 'emp_id', 'instructor_name',
                 'status', 'notes', 'finance_status', 'finance_notes'],
    data_long: ['RowID', 'activity_manager', 'authority', 'school', 'activity_type',
                'activity_no', 'activity_name', 'sessions', 'price', 'funding',
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
