/**
 * sync-end-dates.gs
 *
 * מקור אמת לתאריכי data_long הוא activity_meetings (רק active=yes).
 * הקובץ מסנכרן בפועל את העמודות start_date + end_date בגיליון data_long.
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

/**
 * סנכרון מרכזי: ממלא/מעדכן data_long.start_date + data_long.end_date
 * לפי min/max של meeting_date הפעילים ב-activity_meetings.
 */
function syncDataLongDatesFromMeetings_() {
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
  if (rowIdIdx < 0 || startDateIdx < 0 || endDateIdx < 0) {
    return { updated: 0, error: 'missing_RowID_or_start_date_or_end_date_column' };
  }

  var meetingDatesMap = buildActiveMeetingDatesMap_();
  var numRows = lastRow - dataStart + 1;
  var values = sheet.getRange(dataStart, 1, numRows, lastCol).getValues();
  var startWrites = [];
  var endWrites = [];

  values.forEach(function(row, offset) {
    var rowId = text_(row[rowIdIdx]);
    if (!rowId) return;
    var meetingDates = meetingDatesMap[rowId] || [];
    if (!meetingDates.length) return;

    var nextStart = meetingDates[0];
    var nextEnd = meetingDates[meetingDates.length - 1];
    var currentStart = normalizeDateTextToIso_(row[startDateIdx]);
    var currentEnd = normalizeDateTextToIso_(row[endDateIdx]);

    if (nextStart !== currentStart) {
      startWrites.push({ row: dataStart + offset, value: nextStart });
    }
    if (nextEnd !== currentEnd) {
      endWrites.push({ row: dataStart + offset, value: nextEnd });
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

  return {
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

function onEditSyncEndDates_(e) {
  var sheet = e && e.range && e.range.getSheet();
  if (!sheet || sheet.getName() !== CONFIG.SHEETS.MEETINGS) return;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(8000)) return;
  try {
    beginRequestCache_();
    syncDataLongDatesFromMeetings_();
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
