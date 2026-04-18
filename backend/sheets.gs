function getSpreadsheet_() {
  if (CONFIG.SPREADSHEET_ID === 'REPLACE_WITH_SPREADSHEET_ID') {
    throw new Error('Set CONFIG.SPREADSHEET_ID first');
  }
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

function getSheet_(sheetName) {
  var sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) throw new Error('Missing sheet: ' + sheetName);
  return sheet;
}

function getHeaders_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (!lastCol) throw new Error('Missing headers in sheet: ' + sheet.getName());
  return sheet.getRange(CONFIG.HEADER_ROW, 1, 1, lastCol).getValues()[0].map(text_);
}

function getRows_(sheetName) {
  return readRows_(sheetName);
}

function readRows_(sheetName) {
  var sheet = getSheet_(sheetName);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < CONFIG.DATA_START_ROW) return [];

  var headers = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, lastCol).getValues()[0].map(text_);
  var values = sheet.getRange(CONFIG.DATA_START_ROW, 1, lastRow - CONFIG.DATA_START_ROW + 1, lastCol).getValues();

  return values.filter(function(row) {
    return row.some(function(cell) { return text_(cell) !== ''; });
  }).map(function(row) {
    var item = {};
    headers.forEach(function(header, idx) {
      item[header] = row[idx];
    });
    return item;
  });
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

  var rowNumber = CONFIG.DATA_START_ROW + index;
  var values = headers.map(function(header) { return updated[header]; });
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([values]);
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

  var rowNumber = CONFIG.DATA_START_ROW + index;
  var values = headers.map(function(header) { return updated[header]; });
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([values]);
}

function deleteRowsByKey_(sheetName, keyField, keyValue) {
  var sheet = getSheet_(sheetName);
  var headers = getHeaders_(sheet);
  var keyIndex = headers.indexOf(keyField);
  if (keyIndex < 0) throw new Error('Key field not found: ' + keyField);

  var lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.DATA_START_ROW) return;

  for (var rowNum = lastRow; rowNum >= CONFIG.DATA_START_ROW; rowNum--) {
    var value = text_(sheet.getRange(rowNum, keyIndex + 1).getValue());
    if (value === text_(keyValue)) {
      sheet.deleteRow(rowNum);
    }
  }
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
