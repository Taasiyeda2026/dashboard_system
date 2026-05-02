/** Workbook scaffold / repair / diagnostics. */

function ensureSystemWorkbookScaffold_() {
  var ss = getSpreadsheet_();
  var report = { createdSheets: [], scaffoldedSheets: [] };
  Object.keys(SYSTEM_SHEET_SCHEMA_).forEach(function(name) {
    var spec = SYSTEM_SHEET_SCHEMA_[name];
    if (!spec || spec.required !== true) return;
    var sheet = ss.getSheetByName(spec.sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(spec.sheetName);
      report.createdSheets.push(spec.sheetName);
    }
    if (!spec.headers || !spec.headers.length) return;
    var headerLen = spec.headers.length;
    sheet.getRange(CONFIG.HEADER_ROW, 1, 1, headerLen).setValues([spec.headers]);
    sheet.getRange(CONFIG.HEADER_ROW + 1, 1, 1, headerLen).setValues([spec.hebrewLabels || []]);
    if (spec.allowExtraColumns === false && sheet.getLastColumn() > headerLen) {
      sheet.getRange(CONFIG.HEADER_ROW, headerLen + 1, 2, sheet.getLastColumn() - headerLen).clearContent();
    }
    if (spec.type === 'snapshot') {
      var monthIdx = spec.headers.indexOf('month_ym');
      if (monthIdx >= 0) {
        var numRows = Math.max(1, sheet.getMaxRows() - CONFIG.DATA_START_ROW + 1);
        sheet.getRange(CONFIG.DATA_START_ROW, monthIdx + 1, numRows, 1).setNumberFormat('@');
      }
    }
    report.scaffoldedSheets.push(spec.sheetName);
  });
  return report;
}

function repairSystemWorkbookStructure_() {
  var report = ensureSystemWorkbookScaffold_();
  refreshDashboardSnapshot_();
  refreshActivitiesSnapshot_();
  try { refreshReadModelManifest_(); } catch (_e) {}
  report.rebuilt = ['dashboard_summary_snapshot', 'dashboard_by_manager_snapshot', 'activities_snapshot', 'read_models'];
  return report;
}

function diagnosticsSheetStructure() {
  var ss = getSpreadsheet_();
  var expected = Object.keys(SYSTEM_SHEET_SCHEMA_).map(function(k){ return SYSTEM_SHEET_SCHEMA_[k]; }).filter(function(s){ return s.required; });
  var missingSheets = expected.filter(function(spec){ return !ss.getSheetByName(spec.sheetName); }).map(function(s){ return s.sheetName; });
  var expectedMap = {};
  expected.forEach(function(spec){ expectedMap[spec.sheetName] = true; });
  var extraSheets = ss.getSheets().map(function(sh){ return sh.getName(); }).filter(function(name){ return !expectedMap[name] && name !== 'אפיון'; });
  var blankHeadersBySheet = {};
  var duplicateHeadersBySheet = {};
  var missingHeadersBySheet = {};
  expected.forEach(function(spec) {
    if (!spec.headers || !spec.headers.length) return;
    var sh = ss.getSheetByName(spec.sheetName);
    if (!sh) return;
    var hdr = sh.getRange(1, 1, 1, spec.headers.length).getValues()[0].map(text_);
    var blanks = hdr.filter(function(h){ return !text_(h); });
    if (blanks.length) blankHeadersBySheet[spec.sheetName] = blanks.length;
    var dup = hdr.filter(function(h, i){ return h && hdr.indexOf(h) !== i; });
    if (dup.length) duplicateHeadersBySheet[spec.sheetName] = dup;
    var missing = spec.headers.filter(function(h){ return hdr.indexOf(h) < 0; });
    if (missing.length) missingHeadersBySheet[spec.sheetName] = missing;
  });
  return {
    missingSheets: missingSheets,
    extraSheets: extraSheets,
    blankHeadersBySheet: blankHeadersBySheet,
    duplicateHeadersBySheet: duplicateHeadersBySheet,
    missingHeadersBySheet: missingHeadersBySheet,
    activitySnapshotExists: !!ss.getSheetByName('activities_snapshot'),
    recommendations: missingSheets.length ? ['run repairSystemWorkbookStructure_'] : []
  };
}
