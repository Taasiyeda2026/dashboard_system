/** Workbook scaffold / repair / diagnostics. */

function ensureSystemWorkbookScaffold_() {
  var ss = getSpreadsheet_();
  var report = { createdSheets: [], scaffoldedSheets: [] };
  Object.keys(getSystemSheetSchema_()).forEach(function(name) {
    var spec = getSystemSheetSchema_()[name];
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
      var extraCols = sheet.getLastColumn() - headerLen;
      if (spec.preserveExistingData === false) {
        sheet.getRange(1, headerLen + 1, sheet.getMaxRows(), extraCols).clearContent();
      } else {
        sheet.getRange(CONFIG.HEADER_ROW, headerLen + 1, 2, extraCols).clearContent();
      }
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
  report.repairs = [];
  [
    { fn: 'refreshDataViews_', label: 'data_views' },
    { fn: 'refreshActivitiesSnapshot_', label: 'activities_snapshot' },
    { fn: 'refreshDashboardSnapshots_', label: 'dashboard_snapshots' },
    { fn: 'refreshAllReadModels_', label: 'read_models' }
  ].forEach(function(step) {
    if (typeof this[step.fn] !== 'function') {
      report.repairs.push({ step: step.label, skipped: true, reason: 'missing_function_' + step.fn });
      return;
    }
    try {
      var outcome = this[step.fn]();
      report.repairs.push({ step: step.label, ok: true, outcome: outcome || null });
    } catch (e) {
      report.repairs.push({ step: step.label, skipped: true, reason: String(e && e.message ? e.message : e) });
    }
  });
  return report;
}

function diagnosticsSheetStructure() {
  var ss = getSpreadsheet_();
  var expected = Object.keys(getSystemSheetSchema_()).map(function(k){ return getSystemSheetSchema_()[k]; }).filter(function(s){ return s.required; });
  var missingSheets = expected.filter(function(spec){ return !ss.getSheetByName(spec.sheetName); }).map(function(s){ return s.sheetName; });
  var expectedMap = {};
  expected.forEach(function(spec){ expectedMap[spec.sheetName] = true; });
  var extraSheets = ss.getSheets().map(function(sh){ return sh.getName(); }).filter(function(name){ return !expectedMap[name] && name !== 'אפיון'; });
  var blankHeadersBySheet = {};
  var extraColumnsBySheet = {};
  var row2ContainsDataWarnings = {};
  var financeLegacyWarnings = {};
  var snapshotStructureWarnings = {};
  var duplicateHeadersBySheet = {};
  var missingHeadersBySheet = {};
  expected.forEach(function(spec) {
    if (!spec.headers || !spec.headers.length) return;
    var sh = ss.getSheetByName(spec.sheetName);
    if (!sh) return;
    var hdr = sh.getRange(1, 1, 1, spec.headers.length).getValues()[0].map(text_);
    var blanks = hdr.filter(function(h){ return !text_(h); });
    if (blanks.length) blankHeadersBySheet[spec.sheetName] = blanks.length;
    if (spec.allowExtraColumns === false && sh.getLastColumn() > spec.headers.length) {
      extraColumnsBySheet[spec.sheetName] = sh.getLastColumn() - spec.headers.length;
    }
    var row2 = sh.getRange(2, 1, 1, Math.max(spec.headers.length, sh.getLastColumn())).getValues()[0];
    var row2DataCols = row2.map(text_).filter(function(v){ return !!v && spec.headers.indexOf(v) < 0; });
    if (row2DataCols.length) row2ContainsDataWarnings[spec.sheetName] = row2DataCols.length;
    if (spec.type === 'snapshot' && spec.headers.some(function(h){ return /^finance_/i.test(h); })) {
      snapshotStructureWarnings[spec.sheetName] = ['finance_columns_detected_in_snapshot_schema'];
    }
    if (spec.legacyFinanceColumns) financeLegacyWarnings[spec.sheetName] = 'legacy_finance_enabled';
    var dup = hdr.filter(function(h, i){ return h && hdr.indexOf(h) !== i; });
    if (dup.length) duplicateHeadersBySheet[spec.sheetName] = dup;
    var missing = spec.headers.filter(function(h){ return hdr.indexOf(h) < 0; });
    if (missing.length) missingHeadersBySheet[spec.sheetName] = missing;
  });
  return {
    missingSheets: missingSheets,
    extraSheets: extraSheets,
    row2ContainsDataWarnings: row2ContainsDataWarnings,
    financeLegacyWarnings: financeLegacyWarnings,
    snapshotStructureWarnings: snapshotStructureWarnings,
    readModelCoverageByMonth: {},
    snapshotVsReadModelMismatches: [],
    extraColumnsBySheet: extraColumnsBySheet,
    blankHeadersBySheet: blankHeadersBySheet,
    duplicateHeadersBySheet: duplicateHeadersBySheet,
    missingHeadersBySheet: missingHeadersBySheet,
    activitySnapshotExists: !!ss.getSheetByName('activities_snapshot'),
    recommendations: missingSheets.length ? ['run repairSystemWorkbookStructure_'] : ['structure looks healthy; run repairSystemWorkbookStructure_ if snapshot/read_model drift appears']
  };
}
