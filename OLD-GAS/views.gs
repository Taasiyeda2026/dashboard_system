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

/**
 * Collects all ISO date strings from a source row's Date1–Date35 fields.
 * Falls back to start_date if none found.
 *
 * A date is not a meeting identity: Date2 and Date3 may legitimately contain
 * the same date. Preserve one item per populated meeting column and keep column
 * order so downstream effective RowIDs remain tied to meeting number.
 */
function collectActivityDatesFromSourceRow_(row) {
  var dates = [];
  for (var i = 1; i <= 35; i++) {
    var d = normalizeDateToIsoFlexible_(row['Date' + i]);
    if (d) dates.push(d);
  }
  if (!dates.length) {
    var start = normalizeDateToIsoFlexible_(row.start_date);
    if (start) dates.push(start);
  }
  return dates;
}

/**
 * Builds one meeting-view row object from a source activity row + a meeting date.
 * Used for both MEETINGS-sheet-based rows and Date1–Date35-based rows.
 */
function buildMeetingViewRow_(effectiveRowId, sourceRowId, sourceSheet, meetingDate, activityRow, privateNote) {
  return {
    RowID: effectiveRowId,
    source_sheet: sourceSheet,
    source_row_id: sourceRowId,
    month_ym: meetingDate.slice(0, 7),
    meeting_date: meetingDate,
    activity_type: text_(activityRow.activity_type),
    activity_name: text_(activityRow.activity_name),
    activity_manager: text_(activityRow.activity_manager),
    authority: text_(activityRow.authority),
    school: text_(activityRow.school),
    funding: text_(activityRow.funding),
    grade: text_(activityRow.grade),
    class_group: text_(activityRow.class_group),
    start_date: normalizeDateToIsoFlexible_(activityRow.start_date),
    end_date: normalizeDateToIsoFlexible_(activityRow.end_date) || normalizeDateToIsoFlexible_(activityRow.start_date),
    status: text_(activityRow.status),
    emp_id: text_(activityRow.emp_id),
    instructor_name: text_(activityRow.instructor_name),
    emp_id_2: text_(activityRow.emp_id_2),
    instructor_name_2: text_(activityRow.instructor_name_2),
    start_time: text_(activityRow.start_time),
    end_time: text_(activityRow.end_time),
    activity_no: text_(activityRow.activity_no),
    private_note: text_(privateNote)
  };
}

/**
 * Builds view_activity_meetings rows from three sources:
 *  1. activity_meetings sheet — explicit meeting records for long activities
 *  2. data_short rows — Date1–Date35 / start_date (not in activity_meetings)
 *  3. data_long rows that have no activity_meetings entries — Date1–Date35 fallback
 */
function buildViewActivityMeetingsRows_(meetingsRows, sourceMap, privateNotesMap, shortRows, longRows) {
  var out = [];

  // --- 1. activity_meetings sheet (primary source for long/course activities) ---
  var hasExplicitMeetings = {};
  (meetingsRows || []).forEach(function(meeting) {
    if (yesNo_(meeting.active || 'yes') === 'no') return;
    var meetingDate = normalizeDateToIsoFlexible_(meeting.meeting_date);
    if (!meetingDate) return;

    var sourceRowId = text_(meeting.source_row_id || meeting.RowID);
    if (!sourceRowId) return;
    hasExplicitMeetings[sourceRowId] = true;

    var meetingNo = text_(meeting.meeting_no);
    var effectiveRowId = meetingNo ? (sourceRowId + '-' + meetingNo) : sourceRowId;

    var sourceSheet = text_(meeting.source_sheet);
    if (!sourceSheet) sourceSheet = inferSourceSheetForView_(sourceRowId, sourceMap);

    var sourceRow = sourceMap.bySourceAndRowId[sourceSheet + '|' + sourceRowId] || sourceMap.byRowId[sourceRowId] || {};
    var noteKey = sourceSheet + '|' + sourceRowId;
    var privateNote = text_(privateNotesMap[noteKey] || sourceRow.private_note || '');

    var merged = {
      activity_type: text_(meeting.activity_type || sourceRow.activity_type),
      activity_name: text_(meeting.activity_name || sourceRow.activity_name),
      activity_manager: text_(meeting.activity_manager || sourceRow.activity_manager),
      authority: text_(meeting.authority || sourceRow.authority),
      school: text_(meeting.school || sourceRow.school),
      funding: text_(meeting.funding || sourceRow.funding),
      grade: text_(meeting.grade || sourceRow.grade),
      class_group: text_(meeting.class_group || sourceRow.class_group),
      start_date: meeting.start_date || sourceRow.start_date,
      end_date: meeting.end_date || sourceRow.end_date || sourceRow.start_date,
      status: text_(meeting.status || sourceRow.status),
      emp_id: text_(meeting.emp_id || sourceRow.emp_id),
      instructor_name: text_(meeting.instructor_name || sourceRow.instructor_name),
      emp_id_2: text_(meeting.emp_id_2 || sourceRow.emp_id_2),
      instructor_name_2: text_(meeting.instructor_name_2 || sourceRow.instructor_name_2),
      start_time: text_(meeting.start_time || sourceRow.start_time),
      end_time: text_(meeting.end_time || sourceRow.end_time),
      activity_no: text_(meeting.activity_no || sourceRow.activity_no)
    };
    out.push(buildMeetingViewRow_(effectiveRowId, sourceRowId, sourceSheet, meetingDate, merged, privateNote));
  });

  // --- 2. data_short rows — dates from Date1–Date35 / start_date ---
  var shortSheet = configuredShortActivitiesSheet_();
  (shortRows || []).forEach(function(row) {
    var sourceRowId = text_(row.RowID);
    if (!sourceRowId || hasExplicitMeetings[sourceRowId]) return;
    var noteKey = shortSheet + '|' + sourceRowId;
    var privateNote = text_(privateNotesMap[noteKey] || '');
    var dates = collectActivityDatesFromSourceRow_(row);
    dates.forEach(function(meetingDate, idx) {
      var effectiveRowId = sourceRowId + '-d' + (idx + 1);
      out.push(buildMeetingViewRow_(effectiveRowId, sourceRowId, shortSheet, meetingDate, row, privateNote));
    });
  });

  // --- 3. data_long rows with no activity_meetings entries — Date1–Date35 fallback ---
  var longSheet = configuredLongActivitiesSheet_();
  (longRows || []).forEach(function(row) {
    var sourceRowId = text_(row.RowID);
    if (!sourceRowId || hasExplicitMeetings[sourceRowId]) return;
    var noteKey = longSheet + '|' + sourceRowId;
    var privateNote = text_(privateNotesMap[noteKey] || '');
    var dates = collectActivityDatesFromSourceRow_(row);
    dates.forEach(function(meetingDate, idx) {
      var effectiveRowId = sourceRowId + '-d' + (idx + 1);
      out.push(buildMeetingViewRow_(effectiveRowId, sourceRowId, longSheet, meetingDate, row, privateNote));
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
    map[rowId].sort();
  });
  return map;
}

function buildViewActivitiesSummaryRows_(shortRows, longRows, meetingsViewRows, privateNotesMap) {
  var nowIso = new Date().toISOString();
  var meetingsByRowId = {};
  (meetingsViewRows || []).forEach(function(row) {
    var rowIdRaw = text_(row.RowID);
    var baseRowId = rowIdRaw.split('-').slice(0, 2).join('-');
    if (!baseRowId) return;
    if (!meetingsByRowId[baseRowId]) meetingsByRowId[baseRowId] = [];
    meetingsByRowId[baseRowId].push(baseRowId);
  });
  var all = [];

  (shortRows || []).forEach(function(row) {
    all.push(mapShortRow_(row));
  });
  (longRows || []).forEach(function(row) {
    all.push(mapLongRow_(row));
  });

  var byMonthType = {};
  all.forEach(function(row) {
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

    var key = monthYm + '|' + text_(row.activity_type);
    if (!monthYm || !text_(row.activity_type)) return;
    byMonthType[key] = (byMonthType[key] || 0) + 1;
  });

  return Object.keys(byMonthType).sort().map(function(key) {
    var parts = key.split('|');
    return {
      month_ym: parts[0],
      activity_type: parts[1],
      total: byMonthType[key],
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
  var rows = readRows_(CONFIG.SHEETS.DASHBOARD_SUMMARY_SNAPSHOT);
  var out = [];
  (rows || []).forEach(function(row) {
    var ym = normalizeMonthYmFlexible_(row.month_ym);
    if (!ym) return;
    Object.keys(row).forEach(function(key) {
      if (key === 'month_ym' || key === 'month_label' || key === 'updated_at') return;
      var rawValue = row[key];
      if (rawValue === '' || rawValue === null || rawValue === undefined) return;
      out.push({
        month_ym: ym,
        metric_key: key,
        metric_value: rawValue,
        updated_at: text_(row.updated_at) || nowIso
      });
    });
  });
  return out;
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
  var meetingsViewRows = buildViewActivityMeetingsRows_(meetingsRows, sourceMap, privateNotesMap, shortRows, longRows);
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
