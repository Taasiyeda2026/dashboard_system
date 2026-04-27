/**
 * sync-end-dates.gs
 *
 * מקור אמת לתאריכי data_long הוא activity_meetings (רק active=yes).
 * הקובץ מסנכרן בפועל את העמודות start_date + end_date בגיליון data_long.
 * כולל נקודות כניסה ידניות לאבחון/סנכרון מתוך Apps Script Editor.
 */

function buildActiveMeetingDatesMap_() {
  var rows = readRows_(CONFIG.SHEETS.MEETINGS);
  var out = {};
  rows.forEach(function(row) {
    if (yesNo_(row.active) !== 'yes') return;
    var sourceRowId = text_(row.source_row_id);
    var meetingDate = normalizeDateTextToIso_(row.meeting_date);
    if (!sourceRowId || !meetingDate) return;
    if (!out[sourceRowId]) out[sourceRowId] = [];
    out[sourceRowId].push(meetingDate);
  });

  Object.keys(out).forEach(function(sourceRowId) {
    var uniq = {};
    out[sourceRowId].forEach(function(d) { uniq[d] = true; });
    out[sourceRowId] = Object.keys(uniq).sort();
  });

  return out;
}

function buildMeetingsDiagnostics_() {
  var rows = readRows_(CONFIG.SHEETS.MEETINGS);
  var sourceIdSet = {};
  var activeSourceIdSet = {};
  var activeMeetingRows = 0;
  var validMeetingDates = 0;
  var activeDatesMap = {};

  rows.forEach(function(row) {
    var sourceRowId = text_(row.source_row_id);
    if (sourceRowId) sourceIdSet[sourceRowId] = true;
    if (yesNo_(row.active) !== 'yes') return;

    activeMeetingRows++;
    if (sourceRowId) activeSourceIdSet[sourceRowId] = true;
    var meetingDate = normalizeDateTextToIso_(row.meeting_date);
    if (!sourceRowId || !meetingDate) return;

    validMeetingDates++;
    if (!activeDatesMap[sourceRowId]) activeDatesMap[sourceRowId] = [];
    activeDatesMap[sourceRowId].push(meetingDate);
  });

  Object.keys(activeDatesMap).forEach(function(sourceRowId) {
    var uniq = {};
    activeDatesMap[sourceRowId].forEach(function(d) { uniq[d] = true; });
    activeDatesMap[sourceRowId] = Object.keys(uniq).sort();
  });

  return {
    rows: rows,
    source_id_set: sourceIdSet,
    active_source_id_set: activeSourceIdSet,
    active_meetings_rows: activeMeetingRows,
    valid_meeting_dates: validMeetingDates,
    active_dates_map: activeDatesMap
  };
}

function buildDataLongSheetSnapshot_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.SHEETS.DATA_LONG);
  if (!sheet) {
    return { error: 'missing_data_long', rows: [], headers: [], values: [], data_start: getDataStartRow_() };
  }
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var dataStart = getDataStartRow_();
  if (lastRow < dataStart || !lastCol) {
    return { sheet: sheet, rows: [], headers: [], values: [], data_start: dataStart };
  }
  var headers = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, lastCol).getValues()[0].map(text_);
  var values = sheet.getRange(dataStart, 1, lastRow - dataStart + 1, lastCol).getValues();
  return {
    sheet: sheet,
    headers: headers,
    values: values,
    data_start: dataStart
  };
}

function debugDataLongMeetingsSync_() {
  var snap = buildDataLongSheetSnapshot_();
  if (snap.error) {
    return { error: snap.error };
  }

  var headers = snap.headers;
  var values = snap.values;
  var rowIdIdx = headers.indexOf('RowID');
  var startDateIdx = headers.indexOf('start_date');
  var endDateIdx = headers.indexOf('end_date');
  if (rowIdIdx < 0 || startDateIdx < 0 || endDateIdx < 0) {
    return { error: 'missing_RowID_or_start_date_or_end_date_column' };
  }

  var longRowIds = [];
  var longRowIdSet = {};
  values.forEach(function(row) {
    var rowId = text_(row[rowIdIdx]);
    if (!rowId) return;
    longRowIds.push(rowId);
    longRowIdSet[rowId] = true;
  });

  var meetingsDiag = buildMeetingsDiagnostics_();
  var activeDatesMap = meetingsDiag.active_dates_map;

  var matchedLongRows = 0;
  var longRowsWithActiveMeetings = 0;
  var skippedNoMeetings = 0;
  var sampleNoMatchingMeetings = [];
  var sampleUpdated = null;
  var updatedRowsPotential = 0;

  values.forEach(function(row) {
    var rowId = text_(row[rowIdIdx]);
    if (!rowId) return;

    if (meetingsDiag.source_id_set[rowId]) matchedLongRows++;
    var dates = activeDatesMap[rowId] || [];
    if (dates.length) {
      longRowsWithActiveMeetings++;
      var nextStart = dates[0];
      var nextEnd = dates[dates.length - 1];
      var currentStart = normalizeDateTextToIso_(row[startDateIdx]);
      var currentEnd = normalizeDateTextToIso_(row[endDateIdx]);
      if (nextStart !== currentStart || nextEnd !== currentEnd) {
        updatedRowsPotential++;
      }
      if (!sampleUpdated) {
        sampleUpdated = {
          RowID: rowId,
          current_start_date: currentStart,
          current_end_date: currentEnd,
          computed_start_date: nextStart,
          computed_end_date: nextEnd,
          meeting_dates: dates.slice(0, 10)
        };
      }
      return;
    }

    skippedNoMeetings++;
    if (sampleNoMatchingMeetings.length < 5) sampleNoMatchingMeetings.push(rowId);
  });

  var orphanMeetings = [];
  Object.keys(meetingsDiag.source_id_set).forEach(function(sourceRowId) {
    if (longRowIdSet[sourceRowId]) return;
    if (orphanMeetings.length < 5) orphanMeetings.push(sourceRowId);
  });

  return {
    data_long_rows: longRowIds.length,
    activity_meetings_rows: meetingsDiag.rows.length,
    matched_long_rows: matchedLongRows,
    long_rows_with_active_meetings: longRowsWithActiveMeetings,
    active_meetings_rows: meetingsDiag.active_meetings_rows,
    valid_meeting_dates: meetingsDiag.valid_meeting_dates,
    updated_rows: updatedRowsPotential,
    skipped_no_meetings: skippedNoMeetings,
    sample_updated: sampleUpdated,
    sample_no_matching_meetings: sampleNoMatchingMeetings,
    sample_orphan_meetings: orphanMeetings
  };
}

/**
 * סנכרון מרכזי: ממלא/מעדכן data_long.start_date + data_long.end_date
 * לפי min/max של meeting_date הפעילים ב-activity_meetings.
 */
function syncDataLongDatesFromMeetings_() {
  var snap = buildDataLongSheetSnapshot_();
  if (snap.error) return { updated: 0, error: snap.error };

  var sheet = snap.sheet;
  var headers = snap.headers;
  var values = snap.values;
  var dataStart = snap.data_start;
  var rowIdIdx = headers.indexOf('RowID');
  var startDateIdx = headers.indexOf('start_date');
  var endDateIdx = headers.indexOf('end_date');
  if (rowIdIdx < 0 || startDateIdx < 0 || endDateIdx < 0) {
    return { updated: 0, error: 'missing_RowID_or_start_date_or_end_date_column' };
  }

  var meetingsDiag = buildMeetingsDiagnostics_();
  var meetingDatesMap = meetingsDiag.active_dates_map;
  var longRowIdSet = {};
  var dataLongRows = 0;
  var matchedLongRows = 0;
  var longRowsWithActiveMeetings = 0;
  var skippedNoMeetings = 0;
  var startWrites = [];
  var endWrites = [];
  var updatedRowsSet = {};
  var sampleUpdated = null;
  var sampleNoMatchingMeetings = [];

  values.forEach(function(row, offset) {
    var rowId = text_(row[rowIdIdx]);
    if (!rowId) return;
    dataLongRows++;
    longRowIdSet[rowId] = true;
    if (meetingsDiag.source_id_set[rowId]) matchedLongRows++;
    var meetingDates = meetingDatesMap[rowId] || [];
    if (!meetingDates.length) {
      skippedNoMeetings++;
      if (sampleNoMatchingMeetings.length < 5) sampleNoMatchingMeetings.push(rowId);
      return;
    }
    longRowsWithActiveMeetings++;

    var nextStart = meetingDates[0];
    var nextEnd = meetingDates[meetingDates.length - 1];
    var currentStart = normalizeDateTextToIso_(row[startDateIdx]);
    var currentEnd = normalizeDateTextToIso_(row[endDateIdx]);

    if (nextStart !== currentStart) {
      startWrites.push({ row: dataStart + offset, value: nextStart });
      updatedRowsSet[rowId] = true;
    }
    if (nextEnd !== currentEnd) {
      endWrites.push({ row: dataStart + offset, value: nextEnd });
      updatedRowsSet[rowId] = true;
    }
    if (!sampleUpdated && (nextStart !== currentStart || nextEnd !== currentEnd)) {
      sampleUpdated = {
        RowID: rowId,
        current_start_date: currentStart,
        current_end_date: currentEnd,
        computed_start_date: nextStart,
        computed_end_date: nextEnd,
        meeting_dates: meetingDates.slice(0, 10)
      };
    }
  });

  startWrites.forEach(function(item) {
    sheet.getRange(item.row, startDateIdx + 1).setValue(item.value);
  });
  endWrites.forEach(function(item) {
    sheet.getRange(item.row, endDateIdx + 1).setValue(item.value);
  });

  var updated = startWrites.length + endWrites.length;
  if (updated > 0) {
    invalidateReadRowsCache_(CONFIG.SHEETS.DATA_LONG);
    bumpDataViewsCacheVersion_();
  }

  var orphanMeetings = [];
  Object.keys(meetingsDiag.source_id_set).forEach(function(sourceRowId) {
    if (longRowIdSet[sourceRowId]) return;
    if (orphanMeetings.length < 5) orphanMeetings.push(sourceRowId);
  });

  var updatedRows = Object.keys(updatedRowsSet).length;
  return {
    data_long_rows: dataLongRows,
    activity_meetings_rows: meetingsDiag.rows.length,
    matched_long_rows: matchedLongRows,
    long_rows_with_active_meetings: longRowsWithActiveMeetings,
    active_meetings_rows: meetingsDiag.active_meetings_rows,
    valid_meeting_dates: meetingsDiag.valid_meeting_dates,
    updated_rows: updatedRows,
    skipped_no_meetings: skippedNoMeetings,
    sample_updated: sampleUpdated,
    sample_no_matching_meetings: sampleNoMatchingMeetings,
    sample_orphan_meetings: orphanMeetings,
    updated: updated,
    updated_start_date_cells: startWrites.length,
    updated_end_date_cells: endWrites.length
  };
}

function syncDataLongDatesForRowFromMeetings_(sourceRowId) {
  var wanted = text_(sourceRowId);
  if (!wanted) return { updated: 0 };

  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.SHEETS.DATA_LONG);
  if (!sheet) return { updated: 0, error: 'missing_data_long' };

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var dataStart = getDataStartRow_();
  if (lastRow < dataStart || !lastCol) return { updated: 0 };

  var headers = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, lastCol).getValues()[0].map(text_);
  var rowIdIdx = headers.indexOf('RowID');
  var startDateIdx = headers.indexOf('start_date');
  var endDateIdx = headers.indexOf('end_date');
  if (rowIdIdx < 0 || startDateIdx < 0 || endDateIdx < 0) return { updated: 0 };

  var meetingDates = buildActiveMeetingDatesMap_()[wanted] || [];
  if (!meetingDates.length) return { updated: 0 };

  var values = sheet.getRange(dataStart, 1, lastRow - dataStart + 1, lastCol).getValues();
  for (var offset = 0; offset < values.length; offset++) {
    var row = values[offset];
    if (text_(row[rowIdIdx]) !== wanted) continue;

    var nextStart = meetingDates[0];
    var nextEnd = meetingDates[meetingDates.length - 1];
    var currentStart = normalizeDateTextToIso_(row[startDateIdx]);
    var currentEnd = normalizeDateTextToIso_(row[endDateIdx]);
    var updated = 0;

    if (nextStart !== currentStart) {
      sheet.getRange(dataStart + offset, startDateIdx + 1).setValue(nextStart);
      updated++;
    }
    if (nextEnd !== currentEnd) {
      sheet.getRange(dataStart + offset, endDateIdx + 1).setValue(nextEnd);
      updated++;
    }

    if (updated > 0) {
      invalidateReadRowsCache_(CONFIG.SHEETS.DATA_LONG);
      bumpDataViewsCacheVersion_();
    }
    return { updated: updated };
  }

  return { updated: 0 };
}

// תאימות לאחור
function syncLongDataEndDates_() {
  return syncDataLongDatesFromMeetings_();
}

function syncEndDateForRow_(sourceRowId) {
  return syncDataLongDatesForRowFromMeetings_(sourceRowId);
}

function debugDataLongMeetingsSync() {
  var result = debugDataLongMeetingsSync_();
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function runSyncDataLongDates() {
  var result = syncDataLongDatesFromMeetings_();
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function onEditSyncEndDates_(e) {
  var sheet = e && e.range && e.range.getSheet();
  if (!sheet || sheet.getName() !== CONFIG.SHEETS.MEETINGS) return;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(8000)) return;
  try {
    beginRequestCache_();
    runDataMaintenance_('onEditSyncEndDates');
  } catch (_err) {
    // no-op
  } finally {
    __rqCache_ = null;
    lock.releaseLock();
  }
}

function installEndDateSyncTrigger_() {
  var triggers = ScriptApp.getProjectTriggers();
  var exists = triggers.some(function(t) {
    return t.getHandlerFunction() === 'onEditSyncEndDates_';
  });
  if (exists) return { status: 'already_installed' };

  ScriptApp.newTrigger('onEditSyncEndDates_')
    .forSpreadsheet(SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID))
    .onEdit()
    .create();

  return { status: 'installed' };
}

function installEndDateSyncTrigger() {
  return installEndDateSyncTrigger_();
}

function uninstallEndDateSyncTrigger_() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'onEditSyncEndDates_') {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  return { removed: removed };
}
