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

function getRows_(sheetName) {
  var sheet = getSheet_(sheetName);
  var values = sheet.getDataRange().getValues();
  if (!values || values.length < 2) return [];

  var headers = values[0].map(String);
  return values.slice(1).map(function (row) {
    var obj = {};
    headers.forEach(function (header, index) {
      obj[header] = row[index] === undefined ? '' : row[index];
    });
    return obj;
  });
}

function validateRequiredSheets_() {
  var ss = getSpreadsheet_();
  var names = Object.keys(CONFIG.SHEETS);
  var missing = names.filter(function (name) { return !ss.getSheetByName(name); });
  return { ok: missing.length === 0, missing: missing };
}
