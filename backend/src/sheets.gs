function getSpreadsheet_() {
  if (CONFIG.SPREADSHEET_ID === 'REPLACE_WITH_SPREADSHEET_ID') {
    throw new Error('Set CONFIG.SPREADSHEET_ID first');
  }
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

function getSheet_(name) {
  var sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error('Missing sheet: ' + name);
  return sheet;
}

function getSheetData_(sheetName) {
  var sheet = getSheet_(sheetName);
  var values = sheet.getDataRange().getValues();

  if (!values || values.length === 0) {
    return { internal_headers: [], display_headers: [], rows: [] };
  }

  var internalHeaders = values[0].map(function (value) { return String(value || '').trim(); });
  var displayHeaders = values.length > 1
    ? values[1].map(function (value) { return String(value || '').trim(); })
    : internalHeaders;

  var rows = values.slice(2).map(function (row) {
    var obj = {};
    internalHeaders.forEach(function (header, index) {
      obj[header] = row[index] === undefined ? '' : row[index];
    });
    return obj;
  });

  return {
    internal_headers: internalHeaders,
    display_headers: displayHeaders,
    rows: rows
  };
}

function getRows_(sheetName) {
  return getSheetData_(sheetName).rows;
}

function getSheetSchema_(sheetName) {
  var data = getSheetData_(sheetName);
  return {
    internal_headers: data.internal_headers,
    display_headers: data.display_headers
  };
}

function validateRequiredSheets_() {
  var ss = getSpreadsheet_();
  var names = Object.keys(CONFIG.SHEETS);
  var missing = names.filter(function (name) { return !ss.getSheetByName(name); });
  return { ok: missing.length === 0, missing: missing };
}
