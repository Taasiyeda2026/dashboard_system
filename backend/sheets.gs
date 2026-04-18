/** One object per HTTP invocation; cleared between requests in router. */
var __rqCache_ = null;

function beginRequestCache_() {
  __rqCache_ = {
    ss: null,
    sheetByName: {},
    readRows: {},
    headers: {}
  };
}

function invalidateReadRowsCache_(sheetName) {
  if (!__rqCache_ || !sheetName) return;
  if (__rqCache_.readRows) {
    delete __rqCache_.readRows[sheetName];
  }
  delete __rqCache_.meetingsMap;
  delete __rqCache_.buildLongRows;
  delete __rqCache_.allActivities;
}

function getSpreadsheet_() {
  if (CONFIG.SPREADSHEET_ID === 'REPLACE_WITH_SPREADSHEET_ID') {
    throw new Error('Set CONFIG.SPREADSHEET_ID first');
  }
  if (__rqCache_ && __rqCache_.ss) {
    return __rqCache_.ss;
  }
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  if (__rqCache_) {
    __rqCache_.ss = ss;
  }
  return ss;
}

/**
 * קורא את גיליון settings בשורת נתונים קבועה (3) בלי לעבור דרך readRows_,
 * כדי למנוע רקורסיה עם getDataStartRow_.
 */
function readActiveSettingsMap_() {
  if (__rqCache_ && __rqCache_.settingsMap) {
    return __rqCache_.settingsMap;
  }
  var map = {};
  try {
    var sheet = getSpreadsheet_().getSheetByName(CONFIG.SHEETS.SETTINGS);
    if (!sheet) {
      if (__rqCache_) {
        __rqCache_.settingsMap = map;
      }
      return map;
    }
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < CONFIG.DATA_START_ROW || !lastCol) {
      if (__rqCache_) {
        __rqCache_.settingsMap = map;
      }
      return map;
    }
    var headers = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, lastCol).getValues()[0].map(text_);
    var values = sheet.getRange(CONFIG.DATA_START_ROW, 1, lastRow, lastCol).getValues();
    var keyIdx = headers.indexOf('setting_key');
    var valIdx = headers.indexOf('setting_value');
    var actIdx = headers.indexOf('active');
    if (keyIdx < 0 || valIdx < 0) {
      if (__rqCache_) {
        __rqCache_.settingsMap = map;
      }
      return map;
    }
    values.forEach(function(row) {
      var k = text_(row[keyIdx]);
      if (!k) return;
      if (actIdx >= 0 && yesNo_(row[actIdx]) === 'no') return;
      map[k] = row[valIdx];
    });
  } catch (err) {
    // eslint-disable-line no-empty
  }
  if (__rqCache_) {
    __rqCache_.settingsMap = map;
  }
  return map;
}

function getDataStartRow_() {
  if (__rqCache_ && __rqCache_.effectiveDataStart) {
    return __rqCache_.effectiveDataStart;
  }
  var m = readActiveSettingsMap_();
  var n = parseInt(text_(m.data_start_row), 10);
  var d = !isNaN(n) && n > 0 ? n : CONFIG.DATA_START_ROW;
  if (__rqCache_) {
    __rqCache_.effectiveDataStart = d;
  }
  return d;
}

function getSheet_(sheetName) {
  var key = sheetName;
  if (__rqCache_ && __rqCache_.sheetByName[key]) {
    return __rqCache_.sheetByName[key];
  }
  var sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) throw new Error('Missing sheet: ' + sheetName);
  if (__rqCache_) {
    __rqCache_.sheetByName[key] = sheet;
  }
  return sheet;
}

function getHeaders_(sheet) {
  var sheetKey = sheet.getName();
  if (__rqCache_ && __rqCache_.headers[sheetKey]) {
    return __rqCache_.headers[sheetKey];
  }
  var lastCol = sheet.getLastColumn();
  if (!lastCol) throw new Error('Missing headers in sheet: ' + sheet.getName());
  var headers = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, lastCol).getValues()[0].map(text_);
  if (__rqCache_) {
    __rqCache_.headers[sheetKey] = headers;
  }
  return headers;
}

function getRows_(sheetName) {
  return readRows_(sheetName);
}

function readRows_(sheetName) {
  var cacheKey = sheetName;
  if (__rqCache_ && __rqCache_.readRows[cacheKey]) {
    return __rqCache_.readRows[cacheKey];
  }

  var sheet = getSheet_(sheetName);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var dataStart = getDataStartRow_();
  if (lastRow < dataStart) {
    if (__rqCache_) {
      __rqCache_.readRows[cacheKey] = [];
    }
    return [];
  }

  var headers = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, lastCol).getValues()[0].map(text_);
  var values = sheet.getRange(dataStart, 1, lastRow - dataStart + 1, lastCol).getValues();

  var result = values.filter(function(row) {
    return row.some(function(cell) { return text_(cell) !== ''; });
  }).map(function(row) {
    var item = {};
    headers.forEach(function(header, idx) {
      item[header] = row[idx];
    });
    return item;
  });

  if (__rqCache_) {
    __rqCache_.readRows[cacheKey] = result;
  }
  return result;
}

function validateRequiredSheets_() {
  var ss = getSpreadsheet_();
  var names = Object.keys(CONFIG.SHEETS).map(function(key) {
    return CONFIG.SHEETS[key];
  });
  var missing = names.filter(function(name) {
    return !ss.getSheetByName(name);
  });
  return { ok: missing.length === 0, missing: missing };
}

function appendRow_(sheetName, rowObj) {
  var sheet = getSheet_(sheetName);
  var headers = getHeaders_(sheet);
  var row = headers.map(function(header) {
    return Object.prototype.hasOwnProperty.call(rowObj, header) ? rowObj[header] : '';
  });
  sheet.appendRow(row);
  invalidateReadRowsCache_(sheetName);
}

function getRowByKey_(sheetName, keyField, keyValue) {
  var rows = readRows_(sheetName);
  var match = rows.find(function(row) {
    return text_(row[keyField]) === text_(keyValue);
  });
  if (!match) throw new Error('Row not found: ' + keyValue);
  return match;
}

function updateRowByKey_(sheetName, keyField, keyValue, changes) {
  var sheet = getSheet_(sheetName);
  var headers = getHeaders_(sheet);
  var rows = readRows_(sheetName);
  var index = rows.findIndex(function(row) {
    return text_(row[keyField]) === text_(keyValue);
  });

  if (index < 0) throw new Error('Row not found: ' + keyValue);

  var updated = {};
  headers.forEach(function(header) {
    updated[header] = Object.prototype.hasOwnProperty.call(changes, header)
      ? changes[header]
      : rows[index][header];
  });

  var rowNumber = getDataStartRow_() + index;
  var values = headers.map(function(header) { return updated[header]; });
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([values]);
  invalidateReadRowsCache_(sheetName);
}

function upsertRowByKey_(sheetName, keyField, rowObj) {
  var sheet = getSheet_(sheetName);
  var headers = getHeaders_(sheet);
  var rows = readRows_(sheetName);
  var index = rows.findIndex(function(row) {
    return text_(row[keyField]) === text_(rowObj[keyField]);
  });

  if (index < 0) {
    appendRow_(sheetName, rowObj);
    return;
  }

  var updated = {};
  headers.forEach(function(header) {
    updated[header] = Object.prototype.hasOwnProperty.call(rowObj, header) ? rowObj[header] : rows[index][header];
  });

  var rowNumber = getDataStartRow_() + index;
  var values = headers.map(function(header) { return updated[header]; });
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([values]);
  invalidateReadRowsCache_(sheetName);
}

function deleteRowsByKey_(sheetName, keyField, keyValue) {
  var sheet = getSheet_(sheetName);
  var headers = getHeaders_(sheet);
  var keyIndex = headers.indexOf(keyField);
  if (keyIndex < 0) throw new Error('Key field not found: ' + keyField);

  var lastRow = sheet.getLastRow();
  var dataStart = getDataStartRow_();
  if (lastRow < dataStart) {
    invalidateReadRowsCache_(sheetName);
    return;
  }

  for (var rowNum = lastRow; rowNum >= dataStart; rowNum--) {
    var value = text_(sheet.getRange(rowNum, keyIndex + 1).getValue());
    if (value === text_(keyValue)) {
      sheet.deleteRow(rowNum);
    }
  }
  invalidateReadRowsCache_(sheetName);
}

function nextId_(sheetName, prefix) {
  var rows = readRows_(sheetName);
  var max = 0;

  rows.forEach(function(row) {
    var raw = text_(row.RowID);
    if (raw.indexOf(prefix) !== 0) return;
    var n = parseInt(raw.replace(prefix, ''), 10);
    if (!isNaN(n) && n > max) max = n;
  });

  return prefix + ('000' + (max + 1)).slice(-3);
}
