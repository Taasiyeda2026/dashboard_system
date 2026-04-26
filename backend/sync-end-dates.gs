/**
 * sync-end-dates.gs
 *
 * מסנכרן את עמודת end_date בגיליון data_long עם תאריך המפגש האחרון מגיליון activity_meetings.
 *
 * לוגיקה לכל שורה ב-data_long:
 *   end_date = max( תאריכים ב-activity_meetings לאותו RowID , תאריכים ב-Date1-Date35 )
 *
 * נקודות כניסה:
 *   • syncLongDataEndDates_()          — סנכרון מלא של כל השורות (הפעלה ידנית / trigger)
 *   • syncEndDateForRow_(sourceRowId)  — עדכון שורה אחת (נקרא מ-setMeetings_ אוטומטית)
 *   • onEditSyncEndDates_(e)           — installable trigger לעריכות ישירות בגיליון activity_meetings
 *   • installEndDateSyncTrigger_()     — התקנת ה-trigger (הפעל פעם אחת מ-Apps Script Editor)
 *   • uninstallEndDateSyncTrigger_()   — הסרת ה-trigger
 */

// ─── A. מפה source_row_id → תאריך סיום מגיליון activity_meetings ─────────────

function buildMeetingEndDateMap_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.SHEETS.MEETINGS);
  if (!sheet) return {};

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var dataStart = CONFIG.DATA_START_ROW;
  if (lastRow < dataStart || !lastCol) return {};

  var headers = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, lastCol).getValues()[0].map(text_);
  var srcIdx    = headers.indexOf('source_row_id');
  var dateIdx   = headers.indexOf('meeting_date');
  var activeIdx = headers.indexOf('active');
  if (srcIdx < 0 || dateIdx < 0) return {};

  var values = sheet.getRange(dataStart, 1, lastRow - dataStart + 1, lastCol).getValues();
  var endMap = {};
  values.forEach(function(row) {
    if (activeIdx >= 0 && yesNo_(row[activeIdx]) === 'no') return;
    var srcId   = text_(row[srcIdx]);
    var dateStr = normalizeDateTextToIso_(row[dateIdx]);
    if (!srcId || !dateStr) return;
    if (!endMap[srcId] || dateStr > endMap[srcId]) {
      endMap[srcId] = dateStr;
    }
  });
  return endMap;
}

// ─── B. סנכרון מלא ───────────────────────────────────────────────────────────

/**
 * עובר על כל שורות data_long ומעדכן end_date לפי:
 *   max( activity_meetings , Date1-Date35 )
 * מחזיר { updated: N }.
 */
function syncLongDataEndDates_() {
  var ss = getSpreadsheet_();

  var meetingEndMap = buildMeetingEndDateMap_();

  var longSheet = ss.getSheetByName(CONFIG.SHEETS.DATA_LONG);
  if (!longSheet) return { updated: 0, error: 'missing_data_long' };

  var lastRow  = longSheet.getLastRow();
  var lastCol  = longSheet.getLastColumn();
  var dataStart = CONFIG.DATA_START_ROW;
  if (lastRow < dataStart || !lastCol) return { updated: 0 };

  var headers    = longSheet.getRange(CONFIG.HEADER_ROW, 1, 1, lastCol).getValues()[0].map(text_);
  var rowIdIdx   = headers.indexOf('RowID');
  var endDateIdx = headers.indexOf('end_date');
  if (rowIdIdx < 0 || endDateIdx < 0) {
    return { updated: 0, error: 'missing_RowID_or_end_date_column' };
  }

  var dateColIndexes = [];
  for (var i = 1; i <= 35; i++) {
    var idx = headers.indexOf('Date' + i);
    if (idx >= 0) dateColIndexes.push(idx);
  }

  var numRows = lastRow - dataStart + 1;
  var values  = longSheet.getRange(dataStart, 1, numRows, lastCol).getValues();
  var updatedCount = 0;

  values.forEach(function(row, offset) {
    var rowId = text_(row[rowIdIdx]);
    if (!rowId) return;

    var maxFromDateCols = '';
    dateColIndexes.forEach(function(ci) {
      var d = normalizeDateTextToIso_(row[ci]);
      if (d && d > maxFromDateCols) maxFromDateCols = d;
    });

    var fromMeetings = meetingEndMap[rowId] || '';
    var newEndDate   = fromMeetings > maxFromDateCols ? fromMeetings : maxFromDateCols;
    if (!newEndDate) return;

    var currentEndDate = normalizeDateTextToIso_(row[endDateIdx]);
    if (newEndDate === currentEndDate) return;

    longSheet.getRange(dataStart + offset, endDateIdx + 1).setValue(newEndDate);
    updatedCount++;
  });

  if (updatedCount > 0) {
    bumpDataViewsCacheVersion_();
  }

  return { updated: updatedCount };
}

// ─── C. עדכון שורה בודדת ─────────────────────────────────────────────────────

/**
 * מעדכן end_date עבור שורה יחידה ב-data_long לאחר שמירת מפגשים.
 * נקרא מ-setMeetings_() אוטומטית.
 */
function syncEndDateForRow_(sourceRowId) {
  if (!sourceRowId) return;
  var ss = getSpreadsheet_();

  var meetingsSheet = ss.getSheetByName(CONFIG.SHEETS.MEETINGS);
  var fromMeetings  = '';
  if (meetingsSheet) {
    var mLastRow  = meetingsSheet.getLastRow();
    var mLastCol  = meetingsSheet.getLastColumn();
    var mDataStart = CONFIG.DATA_START_ROW;
    if (mLastRow >= mDataStart && mLastCol > 0) {
      var mHeaders  = meetingsSheet.getRange(CONFIG.HEADER_ROW, 1, 1, mLastCol).getValues()[0].map(text_);
      var srcIdx    = mHeaders.indexOf('source_row_id');
      var dateIdx   = mHeaders.indexOf('meeting_date');
      var activeIdx = mHeaders.indexOf('active');
      if (srcIdx >= 0 && dateIdx >= 0) {
        var mValues = meetingsSheet.getRange(mDataStart, 1, mLastRow - mDataStart + 1, mLastCol).getValues();
        mValues.forEach(function(row) {
          if (text_(row[srcIdx]) !== text_(sourceRowId)) return;
          if (activeIdx >= 0 && yesNo_(row[activeIdx]) === 'no') return;
          var d = normalizeDateTextToIso_(row[dateIdx]);
          if (d && d > fromMeetings) fromMeetings = d;
        });
      }
    }
  }

  var longSheet = ss.getSheetByName(CONFIG.SHEETS.DATA_LONG);
  if (!longSheet) return;

  var lastRow  = longSheet.getLastRow();
  var lastCol  = longSheet.getLastColumn();
  var dataStart = CONFIG.DATA_START_ROW;
  if (lastRow < dataStart || !lastCol) return;

  var headers    = longSheet.getRange(CONFIG.HEADER_ROW, 1, 1, lastCol).getValues()[0].map(text_);
  var rowIdIdx   = headers.indexOf('RowID');
  var endDateIdx = headers.indexOf('end_date');
  if (rowIdIdx < 0 || endDateIdx < 0) return;

  var dateColIndexes = [];
  for (var i = 1; i <= 35; i++) {
    var ci = headers.indexOf('Date' + i);
    if (ci >= 0) dateColIndexes.push(ci);
  }

  var numRows = lastRow - dataStart + 1;
  var values  = longSheet.getRange(dataStart, 1, numRows, lastCol).getValues();

  for (var offset = 0; offset < values.length; offset++) {
    var row = values[offset];
    if (text_(row[rowIdIdx]) !== text_(sourceRowId)) continue;

    var maxFromDateCols = '';
    dateColIndexes.forEach(function(ci) {
      var d = normalizeDateTextToIso_(row[ci]);
      if (d && d > maxFromDateCols) maxFromDateCols = d;
    });

    var newEndDate = fromMeetings > maxFromDateCols ? fromMeetings : maxFromDateCols;
    if (!newEndDate) break;

    var currentEndDate = normalizeDateTextToIso_(row[endDateIdx]);
    if (newEndDate !== currentEndDate) {
      longSheet.getRange(dataStart + offset, endDateIdx + 1).setValue(newEndDate);
      bumpDataViewsCacheVersion_();
    }
    break;
  }
}

// ─── D. Trigger – עריכה ישירה בגיליון activity_meetings ──────────────────────

/**
 * Installable onEdit trigger.
 * מופעל אוטומטית כשהמשתמש עורך ישירות את גיליון activity_meetings.
 * דורש הרשאות — הפעל installEndDateSyncTrigger_() פעם אחת להתקנה.
 */
function onEditSyncEndDates_(e) {
  var sheet = e && e.range && e.range.getSheet();
  if (!sheet || sheet.getName() !== CONFIG.SHEETS.MEETINGS) return;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(8000)) return;
  try {
    beginRequestCache_();
    syncLongDataEndDates_();
  } catch (_err) {
    // שמור שגיאות בשקט
  } finally {
    __rqCache_ = null;
    lock.releaseLock();
  }
}

// ─── E. התקנה / הסרה של ה-trigger ───────────────────────────────────────────

/**
 * מתקין installable onEdit trigger עבור onEditSyncEndDates_.
 * הפעל פעם אחת:
 *   Apps Script Editor → Run → installEndDateSyncTrigger_
 */
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

/**
 * מסיר את ה-trigger של onEditSyncEndDates_.
 */
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
