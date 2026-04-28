function inferSourceSheetForView_(sourceRowId, sourceMap) {
  var rowId = text_(sourceRowId);
  if (!rowId) return '';
  if (sourceMap.shortById[rowId]) return CONFIG.SHEETS.DATA_SHORT;
  if (sourceMap.longById[rowId]) return CONFIG.SHEETS.DATA_LONG;
  if (rowId.indexOf('SHORT-') === 0) return CONFIG.SHEETS.DATA_SHORT;
  if (rowId.indexOf('LONG-') === 0) return CONFIG.SHEETS.DATA_LONG;
  return '';
}

function buildSourceMapForViews_(shortRows, longRows) {
  var map = {
    bySourceAndRowId: {},
    byRowId: {},
    shortById: {},
    longById: {}
  };
  (shortRows || []).forEach(function(row) {
    var rowId = text_(row.RowID);
    if (!rowId) return;
    var mapped = mapShortRow_(row);
    map.shortById[rowId] = mapped;
    map.byRowId[rowId] = mapped;
    map.bySourceAndRowId[CONFIG.SHEETS.DATA_SHORT + '|' + rowId] = mapped;
  });
  (longRows || []).forEach(function(row) {
    var rowId = text_(row.RowID);
    if (!rowId) return;
    var mapped = mapLongRow_(row);
    map.longById[rowId] = mapped;
    map.byRowId[rowId] = mapped;
    map.bySourceAndRowId[CONFIG.SHEETS.DATA_LONG + '|' + rowId] = mapped;
  });
  return map;
}

function buildPrivateNotesMapForViews_() {
  var rows = readRows_(CONFIG.SHEETS.PRIVATE_NOTES);
  var map = {};
  rows.forEach(function(row) {
    if (yesNo_(row.active) === 'no') return;
    var key = text_(row.source_sheet) + '|' + text_(row.source_row_id);
    if (!key || key === '|') return;
    map[key] = text_(row.note_text);
  });
  return map;
}

function writeRowsToViewSheet_(sheetName, rows) {
  var sheet = getSheet_(sheetName);
  var headers = getHeaders_(sheet);
  var dataStart = getDataStartRow_();
  var plainTextColumns = {
    month_ym: true,
    meeting_date: true,
    start_date: true,
    end_date: true,
    week_start_date: true,
    start_time: true,
    end_time: true
  };
  headers.forEach(function(header, idx) {
    if (!plainTextColumns[text_(header)]) return;
    sheet.getRange(dataStart, idx + 1, Math.max(sheet.getMaxRows() - dataStart + 1, 1), 1).setNumberFormat('@');
  });
  var lastRow = sheet.getLastRow();
  if (lastRow >= dataStart) {
    sheet.getRange(dataStart, 1, lastRow - dataStart + 1, headers.length).clearContent();
  }
  if (rows && rows.length) {
    var values = rows.map(function(row) {
      return headers.map(function(header) {
        return Object.prototype.hasOwnProperty.call(row, header) ? row[header] : '';
      });
    });
    sheet.getRange(dataStart, 1, values.length, headers.length).setValues(values);
  }
  invalidateReadRowsCache_(sheetName);
}

function buildViewActivityMeetingsRows_(meetingsRows, sourceMap, privateNotesMap) {
  var out = [];
  (meetingsRows || []).forEach(function(meeting) {
    if (yesNo_(meeting.active || 'yes') === 'no') return;
    var meetingDate = normalizeDateToIsoFlexible_(meeting.meeting_date);
    if (!meetingDate) return;

    var sourceRowId = text_(meeting.source_row_id || meeting.RowID);
    if (!sourceRowId) return;

    var sourceSheet = text_(meeting.source_sheet);
    if (!sourceSheet) sourceSheet = inferSourceSheetForView_(sourceRowId, sourceMap);

    var sourceRow = sourceMap.bySourceAndRowId[sourceSheet + '|' + sourceRowId] || sourceMap.byRowId[sourceRowId] || {};
    var noteKey = sourceSheet + '|' + sourceRowId;
    var privateNote = text_(privateNotesMap[noteKey] || sourceRow.private_note || '');

    out.push({
      month_ym: normalizeMonthYmFlexible_(meetingDate),
      meeting_date: meetingDate,
      source_sheet: sourceSheet,
      source_row_id: sourceRowId,
      activity_type: text_(meeting.activity_type || sourceRow.activity_type),
      activity_name: text_(meeting.activity_name || sourceRow.activity_name),
      activity_manager: text_(meeting.activity_manager || sourceRow.activity_manager),
      authority: text_(meeting.authority || sourceRow.authority),
      school: text_(meeting.school || sourceRow.school),
      funding: text_(meeting.funding || sourceRow.funding),
      grade: text_(meeting.grade || sourceRow.grade),
      class_group: text_(meeting.class_group || sourceRow.class_group),
      instructor_name: text_(meeting.instructor_name || sourceRow.instructor_name),
      instructor_name_2: text_(meeting.instructor_name_2 || sourceRow.instructor_name_2),
      emp_id: text_(meeting.emp_id || sourceRow.emp_id),
      emp_id_2: text_(meeting.emp_id_2 || sourceRow.emp_id_2),
      status: text_(meeting.status || sourceRow.status),
      start_time: normalizeTimeToTextFlexible_(meeting.start_time || sourceRow.start_time),
      end_time: normalizeTimeToTextFlexible_(meeting.end_time || sourceRow.end_time),
      start_date: normalizeDateToIsoFlexible_(meeting.start_date || sourceRow.start_date),
      end_date: normalizeDateToIsoFlexible_(meeting.end_date || sourceRow.end_date || sourceRow.start_date),
      activity_no: text_(meeting.activity_no || sourceRow.activity_no),
      private_note: privateNote
    });
  });

  out.sort(function(a, b) {
    if (a.meeting_date !== b.meeting_date) return a.meeting_date < b.meeting_date ? -1 : 1;
    if (a.source_row_id !== b.source_row_id) return a.source_row_id < b.source_row_id ? -1 : 1;
    return text_(a.source_sheet).localeCompare(text_(b.source_sheet));
  });
  return out;
}

function buildMeetingsByActivityMapFromView_(meetingViewRows) {
  var map = {};
  (meetingViewRows || []).forEach(function(row) {
    var rowId = text_(row.source_row_id);
    var d = normalizeDateToIsoFlexible_(row.meeting_date);
    if (!rowId || !d) return;
    if (!map[rowId]) map[rowId] = [];
    map[rowId].push(d);
  });
  Object.keys(map).forEach(function(rowId) {
    var uniq = {};
    map[rowId].forEach(function(d) { uniq[d] = true; });
    map[rowId] = Object.keys(uniq).sort();
  });
  return map;
}

function buildViewActivitiesSummaryRows_(shortRows, longRows, meetingsViewRows, privateNotesMap) {
  var nowIso = new Date().toISOString();
  var meetingsByRowId = buildMeetingsByActivityMapFromView_(meetingsViewRows);
  var all = [];

  (shortRows || []).forEach(function(row) {
    all.push(mapShortRow_(row));
  });
  (longRows || []).forEach(function(row) {
    all.push(mapLongRow_(row));
  });

  return all.map(function(row) {
    var rowId = text_(row.RowID);
    var meetingDates = (meetingsByRowId[rowId] || []).slice();
    var startDate = normalizeDateTextToIso_(row.start_date) || '';
    var endDate = normalizeDateTextToIso_(row.end_date) || startDate;
    if (!meetingDates.length && startDate) {
      meetingDates.push(startDate);
      if (endDate && endDate !== startDate) meetingDates.push(endDate);
    }
    var sessionsCount = meetingDates.length || (parseInt(text_(row.sessions), 10) || 0);
    var monthYm = (startDate || (meetingDates[0] || '')).slice(0, 7);
    var exceptionTypes = rowExceptionTypes_(row);
    var noteKey = text_(row.source_sheet) + '|' + rowId;

    return {
      source_sheet: text_(row.source_sheet),
      source_row_id: rowId,
      activity_type: text_(row.activity_type),
      activity_name: text_(row.activity_name),
      activity_manager: text_(row.activity_manager),
      authority: text_(row.authority),
      school: text_(row.school),
      funding: text_(row.funding),
      grade: text_(row.grade),
      class_group: text_(row.class_group),
      start_date: startDate,
      end_date: endDate,
      month_ym: monthYm,
      status: text_(row.status),
      instructor_name: text_(row.instructor_name),
      instructor_name_2: text_(row.instructor_name_2),
      emp_id: text_(row.emp_id),
      emp_id_2: text_(row.emp_id_2),
      activity_no: text_(row.activity_no),
      finance_status: normalizeFinance_(row.finance_status),
      sessions_count: sessionsCount,
      meeting_dates_json: JSON.stringify(meetingDates),
      private_note: text_(privateNotesMap[noteKey] || ''),
      has_missing_instructor: exceptionTypes.indexOf('missing_instructor') >= 0 ? 'yes' : 'no',
      has_missing_start_date: exceptionTypes.indexOf('missing_start_date') >= 0 ? 'yes' : 'no',
      has_late_end_date: exceptionTypes.indexOf('late_end_date') >= 0 ? 'yes' : 'no',
      exception_types_json: JSON.stringify(exceptionTypes),
      updated_at: nowIso
    };
  });
}

function monthActivityMeetingDatesList_(row) {
  try {
    var raw = JSON.parse(text_(row && row.meeting_dates_json || '[]'));
    if (!Array.isArray(raw)) return [];
    return raw.map(function(d) { return text_(d); }).filter(Boolean);
  } catch (_e) {
    return [];
  }
}

/** תוכנית ארוכה "פעילה" לדשבורד לחודש ym — מיושר ל־actionDashboard_ (מפגשים בחודש או סיום מהיום והלאה). */
function monthlyRowActiveLongForYm_(row, ym, programTypes, inactiveExcTypes, todayIso) {
  if (text_(row.source_sheet) !== CONFIG.SHEETS.DATA_LONG) return false;
  if (programTypes.indexOf(text_(row.activity_type)) < 0) return false;
  if (text_(row.status) === 'סגור') return false;
  var types = rowExceptionTypes_(row);
  var i;
  for (i = 0; i < types.length; i++) {
    if (inactiveExcTypes.indexOf(types[i]) >= 0) return false;
  }
  var dates = monthActivityMeetingDatesList_(row);
  var hasSessionInYm = false;
  for (i = 0; i < dates.length; i++) {
    if (text_(dates[i]).slice(0, 7) === ym) {
      hasSessionInYm = true;
      break;
    }
  }
  var endOnOrAfterToday = text_(row.end_date) >= todayIso;
  return hasSessionInYm || endOnOrAfterToday;
}

function buildViewDashboardMonthlyRows_(activitiesSummaryRows, meetingsViewRows) {
  var nowIso = new Date().toISOString();
  var programTypes = configuredProgramActivityTypes_();
  var inactiveExcTypes = ['missing_instructor', 'missing_start_date'];
  var todayIso = formatDate_(new Date());
  var months = {};
  (activitiesSummaryRows || []).forEach(function(row) {
    var ym = normalizeMonthYmFlexible_(row.month_ym);
    if (ym) months[ym] = true;
  });
  (meetingsViewRows || []).forEach(function(row) {
    var ym2 = normalizeMonthYmFlexible_(row.month_ym);
    if (ym2) months[ym2] = true;
  });

  return Object.keys(months).sort().map(function(ym) {
    var monthActivities = (activitiesSummaryRows || []).filter(function(row) {
      return normalizeMonthYmFlexible_(row.month_ym) === ym && text_(row.status) !== 'סגור';
    });
    var monthMeetings = (meetingsViewRows || []).filter(function(row) {
      return normalizeMonthYmFlexible_(row.month_ym) === ym;
    });

    var byManager = {};
    var instructors = {};
    var missingInstructorCount = 0;
    var missingStartDateCount = 0;
    var lateEndDateCount = 0;
    var managerInstructorSets = {};
    var managerExceptions = {};
    var managerCourseEndings = {};
    var managerFinanceOpen = {};
    var primaryExceptionRowCount = 0;

    monthActivities.forEach(function(row) {
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
      if (text_(row.source_sheet) === CONFIG.SHEETS.DATA_SHORT) byManager[manager].total_short += 1;
      if (text_(row.source_sheet) === CONFIG.SHEETS.DATA_LONG) byManager[manager].total_long += 1;
      byManager[manager].total += 1;

      var empA = text_(row.emp_id);
      var empB = text_(row.emp_id_2);
      if (empA) managerInstructorSets[manager][empA] = true;
      if (empB) managerInstructorSets[manager][empB] = true;

      var t = text_(row.activity_type);
      if (t === 'course') {
        if (yesNo_(row.has_missing_instructor) === 'yes') missingInstructorCount += 1;
        if (yesNo_(row.has_missing_start_date) === 'yes') missingStartDateCount += 1;
        if (yesNo_(row.has_late_end_date) === 'yes') lateEndDateCount += 1;
      }

      if (t === 'course' && text_(row.source_sheet) === CONFIG.SHEETS.DATA_LONG) {
        if (primaryExceptionForRow_(row)) {
          if (!managerExceptions[manager]) managerExceptions[manager] = 0;
          managerExceptions[manager] += 1;
          primaryExceptionRowCount += 1;
        }
        if (text_(row.end_date).slice(0, 7) === ym) {
          if (!managerCourseEndings[manager]) managerCourseEndings[manager] = 0;
          managerCourseEndings[manager] += 1;
        }
      }
      if (programTypes.indexOf(t) >= 0 && normalizeFinance_(row.finance_status) === 'open') {
        if (!managerFinanceOpen[manager]) managerFinanceOpen[manager] = 0;
        managerFinanceOpen[manager] += 1;
      }
    });

    monthMeetings.forEach(function(row) {
      var i1 = text_(row.instructor_name || row.emp_id);
      var i2 = text_(row.instructor_name_2 || row.emp_id_2);
      if (i1) instructors[i1] = true;
      if (i2) instructors[i2] = true;
    });

    monthActivities.forEach(function(row) {
      var n1 = text_(row.instructor_name);
      var n2 = text_(row.instructor_name_2);
      if (n1) instructors[n1] = true;
      if (n2) instructors[n2] = true;
    });

    var managerActiveLong = {};
    monthActivities.forEach(function(row) {
      var manager = text_(row.activity_manager) || 'unassigned';
      if (monthlyRowActiveLongForYm_(row, ym, programTypes, inactiveExcTypes, todayIso)) {
        managerActiveLong[manager] = (managerActiveLong[manager] || 0) + 1;
      }
    });

    Object.keys(byManager).forEach(function(mgr) {
      byManager[mgr].total_long = managerActiveLong[mgr] || 0;
      byManager[mgr].total = byManager[mgr].total_short + byManager[mgr].total_long;
      byManager[mgr].num_instructors = Object.keys(managerInstructorSets[mgr] || {}).length;
      byManager[mgr].course_endings = managerCourseEndings[mgr] || 0;
      byManager[mgr].exceptions = managerExceptions[mgr] || 0;
      byManager[mgr].finance_open = managerFinanceOpen[mgr] || 0;
    });

    var totalShort = monthActivities.filter(function(row) {
      return text_(row.source_sheet) === CONFIG.SHEETS.DATA_SHORT;
    }).length;
    var totalLongActive = monthActivities.filter(function(row) {
      return monthlyRowActiveLongForYm_(row, ym, programTypes, inactiveExcTypes, todayIso);
    }).length;

    var activeCourses = monthActivities.filter(function(row) { return text_(row.activity_type) === 'course'; }).length;
    var activeWorkshops = monthActivities.filter(function(row) { return text_(row.activity_type) === 'workshop'; }).length;
    var activeTours = monthActivities.filter(function(row) { return text_(row.activity_type) === 'tour'; }).length;
    var activeAfterSchool = monthActivities.filter(function(row) { return text_(row.activity_type) === 'after_school'; }).length;
    var activeEscapeRoom = monthActivities.filter(function(row) { return text_(row.activity_type) === 'escape_room'; }).length;

    var nextYm = shiftYm_(ym, 1);
    var nextMonthActivities = (activitiesSummaryRows || []).filter(function(row) {
      return normalizeMonthYmFlexible_(row.month_ym) === nextYm && text_(row.status) !== 'סגור';
    });
    var activeCoursesNextMonth = nextMonthActivities.filter(function(row) {
      return text_(row.activity_type) === 'course';
    }).length;

    var financeOpenTotal = 0;
    monthActivities.forEach(function(row) {
      var tx = text_(row.activity_type);
      if (programTypes.indexOf(tx) >= 0 && normalizeFinance_(row.finance_status) === 'open') {
        financeOpenTotal += 1;
      }
    });

    var shortActivitiesByType = {};
    monthActivities.forEach(function(row) {
      if (text_(row.source_sheet) !== CONFIG.SHEETS.DATA_SHORT) return;
      var k = text_(row.activity_type);
      if (!k) return;
      shortActivitiesByType[k] = (shortActivitiesByType[k] || 0) + 1;
    });
    var shortActivitiesSummary = Object.keys(shortActivitiesByType).sort().map(function(typeKey) {
      return { activity_type: typeKey, count: shortActivitiesByType[typeKey] };
    });

    var DISTRICT_MANAGER_MAP_ = {
      'גיל נאמן': 'מחוז צפון',
      'לינוי שמואל מזרחי': 'מחוז דרום'
    };
    var activeInstructorsByManager = {};
    Object.keys(DISTRICT_MANAGER_MAP_).forEach(function(mgr) {
      var district = DISTRICT_MANAGER_MAP_[mgr];
      var names = {};
      monthActivities.forEach(function(row) {
        if (text_(row.activity_manager) !== mgr) return;
        var n1 = text_(row.instructor_name);
        var n2 = text_(row.instructor_name_2);
        if (n1) names[n1] = true;
        if (n2) names[n2] = true;
      });
      activeInstructorsByManager[district] = Object.keys(names).sort();
    });

    var byManagerArr = Object.keys(byManager).sort().map(function(key) { return byManager[key]; });
    var activeInstructors = Object.keys(instructors).sort();

    var summary = {
      active_courses_current_month: activeCourses,
      ending_courses_current_month: monthActivities.filter(function(row) {
        return text_(row.activity_type) === 'course' && text_(row.end_date).slice(0, 7) === ym;
      }).length,
      active_courses_next_month: activeCoursesNextMonth,
      active_instructors: activeInstructors,
      active_instructors_by_manager: activeInstructorsByManager,
      missing_instructor_count: missingInstructorCount,
      missing_start_date_count: missingStartDateCount,
      late_end_date_count: lateEndDateCount,
      short_activities: shortActivitiesSummary,
      exceptions_count: primaryExceptionRowCount,
      finance_open_count: financeOpenTotal
    };

    var kpiCards = [
      { id: 'total_short_activities', title: String(totalShort), value: totalShort },
      { id: 'total_long_activities', title: String(totalLongActive), value: totalLongActive },
      { id: 'exceptions', title: String(primaryExceptionRowCount), value: primaryExceptionRowCount }
    ];

    return {
      month_ym: ym,
      total_short: totalShort,
      total_long_active: totalLongActive,
      active_courses: activeCourses,
      active_workshops: activeWorkshops,
      active_tours: activeTours,
      active_after_school: activeAfterSchool,
      active_escape_room: activeEscapeRoom,
      total_instructors: activeInstructors.length,
      course_endings: summary.ending_courses_current_month,
      missing_instructor_count: missingInstructorCount,
      missing_start_date_count: missingStartDateCount,
      late_end_date_count: lateEndDateCount,
      exceptions_count: primaryExceptionRowCount,
      active_instructors_json: JSON.stringify(activeInstructors),
      active_instructors_by_manager_json: JSON.stringify(activeInstructorsByManager),
      by_manager_json: JSON.stringify(byManagerArr),
      kpi_cards_json: JSON.stringify(kpiCards),
      summary_json: JSON.stringify(summary),
      updated_at: nowIso
    };
  });
}

function buildMonthPayloadMapFromMeetingViewRows_(meetingsViewRows) {
  var grouped = {};
  (meetingsViewRows || []).forEach(function(row) {
    var ym = normalizeMonthYmFlexible_(row.month_ym);
    if (!ym) return;
    if (!grouped[ym]) grouped[ym] = [];
    grouped[ym].push(row);
  });
  var payloadByMonth = {};
  Object.keys(grouped).forEach(function(ym) {
    var parts = ym.split('-');
    var year = parseInt(parts[0], 10);
    var month = parseInt(parts[1], 10) - 1;
    if (isNaN(year) || isNaN(month)) return;
    payloadByMonth[ym] = buildMonthResponseFromMeetingViewRows_(grouped[ym], year, month);
  });
  return payloadByMonth;
}

function warmMonthPayloadCacheFromMeetingRows_(meetingsViewRows) {
  var payloadByMonth = buildMonthPayloadMapFromMeetingViewRows_(meetingsViewRows);
  var months = Object.keys(payloadByMonth);
  var cachedCount = 0;
  var skippedCount = 0;
  months.forEach(function(ym) {
    var key = monthPayloadCacheKey_(ym);
    if (!key) return;
    var writeRes = scriptCachePutJson_(key, payloadByMonth[ym], 21600);
    if (writeRes && writeRes.ok) cachedCount += 1;
    else skippedCount += 1;
  });
  return {
    months_total: months.length,
    months_cached: cachedCount,
    months_skipped: skippedCount
  };
}

function refreshDataViews_() {
  markRequestPerf_('refreshDataViews:read:start');
  var readStartMs = perfNowMs_();
  var shortRows = readRows_(CONFIG.SHEETS.DATA_SHORT);
  var longRows = readRows_(CONFIG.SHEETS.DATA_LONG);
  var meetingsRows = readRows_(CONFIG.SHEETS.MEETINGS);
  var privateNotesMap = buildPrivateNotesMapForViews_();
  var sourceMap = buildSourceMapForViews_(shortRows, longRows);
  var readMs = perfNowMs_() - readStartMs;
  markRequestPerf_('refreshDataViews:read:end');

  markRequestPerf_('refreshDataViews:build:start');
  var buildStartMs = perfNowMs_();
  var meetingsViewRows = buildViewActivityMeetingsRows_(meetingsRows, sourceMap, privateNotesMap);
  var activitiesSummaryRows = buildViewActivitiesSummaryRows_(shortRows, longRows, meetingsViewRows, privateNotesMap);
  var dashboardMonthlyRows = buildViewDashboardMonthlyRows_(activitiesSummaryRows, meetingsViewRows);
  var buildMs = perfNowMs_() - buildStartMs;
  markRequestPerf_('refreshDataViews:build:end');

  markRequestPerf_('refreshDataViews:write:start');
  writeRowsToViewSheet_(CONFIG.SHEETS.VIEW_ACTIVITY_MEETINGS, meetingsViewRows);
  writeRowsToViewSheet_(CONFIG.SHEETS.VIEW_ACTIVITIES_SUMMARY, activitiesSummaryRows);
  writeRowsToViewSheet_(CONFIG.SHEETS.VIEW_DASHBOARD_MONTHLY, dashboardMonthlyRows);
  bumpDataViewsCacheVersion_();
  var monthPayloadCache = warmMonthPayloadCacheFromMeetingRows_(meetingsViewRows);
  markRequestPerf_('refreshDataViews:write:end');

  return {
    ok: true,
    read_ms: Math.round(readMs),
    build_ms: Math.round(buildMs),
    payload_rows: {
      view_activity_meetings: meetingsViewRows.length,
      view_activities_summary: activitiesSummaryRows.length,
      view_dashboard_monthly: dashboardMonthlyRows.length
    },
    month_payload_cache: monthPayloadCache,
    used_view: false,
    fallback_used: false
  };
}

function actionRefreshDataViews_(user) {
  requireAnyRole_(user, ['admin', 'operation_manager']);
  return refreshDataViews_();
}
