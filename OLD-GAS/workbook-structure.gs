/** Workbook scaffold / repair / diagnostics. */

/**
 * ensureSystemWorkbookScaffold_
 *
 * מדיניות source sheets (preserveExistingData: true):
 *   - גיליון חדש (נוצר עכשיו) → כותב headers.
 *   - גיליון קיים עם שורת headers ריקה לחלוטין → כותב headers.
 *   - גיליון קיים עם headers קיימים → SKIP ומוסיף ל-headerSkipped (אל מול diagnostics).
 *
 * view / system / snapshot sheets (preserveExistingData: false):
 *   - תמיד כותב headers ומנקה עמודות עודפות.
 *
 * לתיקון active headers במצב mismatch: קרא repairSourceSheetHeaders_().
 */
function ensureSystemWorkbookScaffold_(opts) {
  var ss = getSpreadsheet_();
  var forceRepairSource = (opts && opts.repairSourceHeaders === true);
  var report = { createdSheets: [], scaffoldedSheets: [], headerSkipped: [], headerRepaired: [] };

  Object.keys(getSystemSheetSchema_()).forEach(function(name) {
    var spec = getSystemSheetSchema_()[name];
    if (!spec || spec.required !== true) return;
    if (!spec.headers || !spec.headers.length) return;

    var isNew = false;
    var sheet = ss.getSheetByName(spec.sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(spec.sheetName);
      report.createdSheets.push(spec.sheetName);
      isNew = true;
    }

    var headerLen = spec.headers.length;

    // --- Determine whether to write headers ---
    var writeHeaders = false;
    if (isNew) {
      writeHeaders = true;
    } else if (spec.preserveExistingData) {
      // Check if existing header row has any non-empty value
      var existingHdr = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, Math.max(headerLen, sheet.getLastColumn() || 1)).getValues()[0];
      var hasExistingHeaders = existingHdr.some(function(v) { return text_(v) !== ''; });
      if (!hasExistingHeaders) {
        writeHeaders = true;
      } else if (forceRepairSource) {
        writeHeaders = true;
        report.headerRepaired.push(spec.sheetName);
      } else {
        report.headerSkipped.push(spec.sheetName);
      }
    } else {
      writeHeaders = true;
    }

    if (writeHeaders) {
      sheet.getRange(CONFIG.HEADER_ROW, 1, 1, headerLen).setValues([spec.headers]);
      sheet.getRange(CONFIG.HEADER_ROW + 1, 1, 1, headerLen).setValues([spec.hebrewLabels || spec.headers]);
      report.scaffoldedSheets.push(spec.sheetName);
    }

    // --- Clean extra columns for strict sheets ---
    if (spec.allowExtraColumns === false && sheet.getLastColumn() > headerLen) {
      var extraCols = sheet.getLastColumn() - headerLen;
      if (spec.preserveExistingData === false) {
        sheet.getRange(1, headerLen + 1, sheet.getMaxRows(), extraCols).clearContent();
      } else {
        sheet.getRange(CONFIG.HEADER_ROW, headerLen + 1, 2, extraCols).clearContent();
      }
    }

    // --- Snapshot: format month_ym as text ---
    if (spec.type === 'snapshot') {
      var monthIdx = spec.headers.indexOf('month_ym');
      if (monthIdx >= 0) {
        var numRows = Math.max(1, sheet.getMaxRows() - CONFIG.DATA_START_ROW + 1);
        sheet.getRange(CONFIG.DATA_START_ROW, monthIdx + 1, numRows, 1).setNumberFormat('@');
      }
    }
  });

  return report;
}

/**
 * repairSourceSheetHeaders_
 * מתקן headers בגיליונות מקור (preserveExistingData: true) כאשר יש mismatch.
 * מופעל רק מ-repairSystemWorkbookStructure_ — לא בצורה אוטומטית.
 * אינו נוגע בשורות נתונים (dataStartRow ומעלה).
 */
function repairSourceSheetHeaders_() {
  var ss = getSpreadsheet_();
  var repaired = [];
  var skipped = [];
  var errors = [];
  Object.keys(getSystemSheetSchema_()).forEach(function(name) {
    var spec = getSystemSheetSchema_()[name];
    if (!spec || !spec.preserveExistingData || !spec.headers || !spec.headers.length) return;
    var sheet = ss.getSheetByName(spec.sheetName);
    if (!sheet) return;
    var headerLen = spec.headers.length;
    try {
      var existingLen = Math.max(sheet.getLastColumn() || 0, headerLen);
      var existingHdr = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, existingLen).getValues()[0].map(text_);
      // Detect mismatch: any position differs from schema
      var hasMismatch = spec.headers.some(function(h, i) { return existingHdr[i] !== h; });
      if (!hasMismatch) { skipped.push(spec.sheetName); return; }
      sheet.getRange(CONFIG.HEADER_ROW, 1, 1, headerLen).setValues([spec.headers]);
      sheet.getRange(CONFIG.HEADER_ROW + 1, 1, 1, headerLen).setValues([spec.hebrewLabels || spec.headers]);
      repaired.push(spec.sheetName);
    } catch (e) {
      errors.push({ sheet: spec.sheetName, error: text_(e && e.message ? e.message : String(e)) });
    }
  });
  return { repaired: repaired, skipped: skipped, errors: errors };
}

/**
 * deduplicateReadModelKeys_
 * מוחק שורות כפולות ב-read_models (שומר את העדכנית ביותר לכל key).
 * מוחק גם שורות עם keys של finance (finance?*).
 */
function deduplicateReadModelKeys_() {
  var ss = getSpreadsheet_();
  var rmSheet = ss.getSheetByName('read_models');
  if (!rmSheet) return { removed: 0, financeRemoved: 0 };

  var dataStart = getDataStartRow_();
  var lastRow = rmSheet.getLastRow();
  if (lastRow < dataStart) return { removed: 0, financeRemoved: 0 };

  var numRows = lastRow - dataStart + 1;
  var data = rmSheet.getRange(dataStart, 1, numRows, rmSheet.getLastColumn()).getValues();

  // Column index for key (col 1) and updated_at (col 2) — 0-indexed
  var keyCol = 0;
  var updatedCol = 1;

  // Track: latest row index per key, finance rows
  var latest = {};   // key → { rowIdx (0-based in data array), updated_at }
  var financeRows = [];  // row indices to delete (finance?*)

  data.forEach(function(row, idx) {
    var k = text_(row[keyCol]);
    if (!k) return;
    if (/^finance\?/.test(k)) {
      financeRows.push(idx);
      return;
    }
    var at = text_(row[updatedCol]);
    if (!latest[k]) {
      latest[k] = { idx: idx, at: at };
    } else {
      // Keep whichever has the more recent updated_at
      if (at > latest[k].at) {
        financeRows.push(latest[k].idx); // old one → remove
        latest[k] = { idx: idx, at: at };
      } else {
        financeRows.push(idx); // current one is older → remove
      }
    }
  });

  // Delete rows in reverse order to preserve indices
  var toDelete = financeRows.slice().sort(function(a, b) { return b - a; });
  var financeRemoved = 0;
  var dupRemoved = 0;

  toDelete.forEach(function(idx) {
    var sheetRow = dataStart + idx;
    if (/^finance\?/.test(text_(data[idx][keyCol]))) financeRemoved++;
    else dupRemoved++;
    rmSheet.deleteRow(sheetRow);
    // Adjust subsequent indices (already sorted in reverse, so no adjustment needed)
  });

  invalidateReadRowsCache_('read_models');
  return { removed: dupRemoved, financeRemoved: financeRemoved };
}

function repairSystemWorkbookStructure_() {
  var report = ensureSystemWorkbookScaffold_();
  report.repairs = [];

  // Step 0: deduplicate / clean read_models keys
  try {
    var dedupResult = deduplicateReadModelKeys_();
    report.repairs.push({ step: 'dedup_read_models', ok: true, outcome: dedupResult });
  } catch (e) {
    report.repairs.push({ step: 'dedup_read_models', skipped: true, reason: text_(e && e.message ? e.message : String(e)) });
  }

  // Step 1: repair source sheet headers if mismatched
  try {
    var repairHdrResult = repairSourceSheetHeaders_();
    report.repairs.push({ step: 'repair_source_headers', ok: true, outcome: repairHdrResult });
  } catch (e) {
    report.repairs.push({ step: 'repair_source_headers', skipped: true, reason: text_(e && e.message ? e.message : String(e)) });
  }

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
      report.repairs.push({ step: step.label, skipped: true, reason: text_(e && e.message ? e.message : String(e)) });
    }
  });

  return report;
}

/**
 * diagnosticsSheetStructure
 * מאבחן מבנה workbook ומחזיר דו"ח מפורט.
 * מזהה:
 *  - גיליונות חסרים / עודפים
 *  - blank headers
 *  - extra columns beyond schema (allowExtraColumns: false)
 *  - row2 mismatch warnings
 *  - duplicate headers בתוך גיליון
 *  - missing schema headers בגיליון
 *  - source header/data mismatch (schemas headers vs actual sheet headers)
 *  - duplicate keys ב-read_models
 *  - finance keys ב-read_models
 *  - used cells מעבר ל-schema (allowExtraColumns: false)
 */
function diagnosticsSheetStructure() {
  var ss = getSpreadsheet_();
  var expected = Object.keys(getSystemSheetSchema_()).map(function(k) {
    return getSystemSheetSchema_()[k];
  }).filter(function(s) { return s.required; });

  var missingSheets = expected.filter(function(spec) {
    return !ss.getSheetByName(spec.sheetName);
  }).map(function(s) { return s.sheetName; });

  var expectedMap = {};
  expected.forEach(function(spec) { expectedMap[spec.sheetName] = true; });
  var extraSheets = ss.getSheets().map(function(sh) { return sh.getName(); }).filter(function(name) {
    return !expectedMap[name] && name !== 'אפיון';
  });

  var blankHeadersBySheet = {};
  var extraColumnsBySheet = {};
  var row2ContainsDataWarnings = {};
  var financeLegacyWarnings = {};
  var snapshotStructureWarnings = {};
  var duplicateHeadersBySheet = {};
  var missingHeadersBySheet = {};
  var sourceHeaderMismatchBySheet = {};  // actual header differs from schema at same position
  var extraUsedColumnsBySheet = {};      // used range beyond schema (allowExtraColumns=false)

  expected.forEach(function(spec) {
    if (!spec.headers || !spec.headers.length) return;
    var sh = ss.getSheetByName(spec.sheetName);
    if (!sh) return;

    var headerLen = spec.headers.length;
    var actualLastCol = sh.getLastColumn();
    var readLen = Math.max(headerLen, actualLastCol || 1);

    var hdr = sh.getRange(CONFIG.HEADER_ROW, 1, 1, readLen).getValues()[0].map(text_);
    var hdrSlice = hdr.slice(0, headerLen);

    // Blank headers (within schema range)
    var blanks = hdrSlice.filter(function(h) { return !text_(h); });
    if (blanks.length) blankHeadersBySheet[spec.sheetName] = blanks.length;

    // Extra columns for strict sheets
    if (spec.allowExtraColumns === false && actualLastCol > headerLen) {
      extraColumnsBySheet[spec.sheetName] = actualLastCol - headerLen;
    }

    // Extra USED columns (any non-empty cell beyond schema) for strict sheets
    if (spec.allowExtraColumns === false && actualLastCol > headerLen) {
      var lastDataRow = sh.getLastRow();
      if (lastDataRow >= CONFIG.DATA_START_ROW) {
        var extraRange = sh.getRange(1, headerLen + 1, lastDataRow, actualLastCol - headerLen).getValues();
        var hasUsedExtra = extraRange.some(function(row) {
          return row.some(function(cell) { return text_(cell) !== ''; });
        });
        if (hasUsedExtra) extraUsedColumnsBySheet[spec.sheetName] = actualLastCol - headerLen;
      }
    }

    // Row 2 data warnings (values in row 2 that aren't part of schema labels)
    var row2 = sh.getRange(CONFIG.HEADER_ROW + 1, 1, 1, readLen).getValues()[0];
    var row2DataCols = row2.map(text_).filter(function(v) {
      return !!v && spec.headers.indexOf(v) < 0 && (spec.hebrewLabels || []).indexOf(v) < 0;
    });
    if (row2DataCols.length) row2ContainsDataWarnings[spec.sheetName] = row2DataCols.length;

    // Legacy finance flag
    if (spec.legacyFinanceColumns) financeLegacyWarnings[spec.sheetName] = 'legacy_finance_enabled';

    // Snapshot structure warnings
    if (spec.type === 'snapshot' && spec.headers.some(function(h) { return /^finance_/i.test(h); })) {
      snapshotStructureWarnings[spec.sheetName] = ['finance_columns_detected_in_snapshot_schema'];
    }

    // Duplicate headers
    var dup = hdrSlice.filter(function(h, i) { return h && hdrSlice.indexOf(h) !== i; });
    if (dup.length) duplicateHeadersBySheet[spec.sheetName] = dup;

    // Missing schema headers in sheet
    var missing = spec.headers.filter(function(h) { return hdrSlice.indexOf(h) < 0; });
    if (missing.length) missingHeadersBySheet[spec.sheetName] = missing;

    // Source header/data mismatch: check positional differences
    if (spec.type === 'source') {
      var mismatches = [];
      spec.headers.forEach(function(expectedH, i) {
        if (hdrSlice[i] !== expectedH) {
          mismatches.push({ col: i + 1, expected: expectedH, actual: hdrSlice[i] || '(empty)' });
        }
      });
      if (mismatches.length) sourceHeaderMismatchBySheet[spec.sheetName] = mismatches;
    }
  });

  // read_models: duplicate keys + finance keys
  var readModelDuplicateKeys = [];
  var readModelFinanceKeys = [];
  var rmSheet = ss.getSheetByName('read_models');
  if (rmSheet) {
    var dataStart = getDataStartRow_();
    var rmLast = rmSheet.getLastRow();
    if (rmLast >= dataStart) {
      var rmKeys = rmSheet.getRange(dataStart, 1, rmLast - dataStart + 1, 1).getValues().map(function(r) { return text_(r[0]); });
      var seen = {};
      rmKeys.forEach(function(k) {
        if (!k) return;
        if (/^finance\?/.test(k)) { readModelFinanceKeys.push(k); return; }
        if (seen[k]) {
          if (readModelDuplicateKeys.indexOf(k) < 0) readModelDuplicateKeys.push(k);
        } else {
          seen[k] = true;
        }
      });
    }
  }

  var recommendations = [];
  if (missingSheets.length) recommendations.push('run repairSystemWorkbookStructure_');
  if (Object.keys(sourceHeaderMismatchBySheet).length) recommendations.push('run repairSystemWorkbookStructure_ to fix source sheet headers (repairSourceSheetHeaders_)');
  if (readModelDuplicateKeys.length || readModelFinanceKeys.length) recommendations.push('run repairSystemWorkbookStructure_ to deduplicate read_models keys');
  if (!recommendations.length) recommendations.push('structure looks healthy');

  return {
    missingSheets: missingSheets,
    extraSheets: extraSheets,
    row2ContainsDataWarnings: row2ContainsDataWarnings,
    financeLegacyWarnings: financeLegacyWarnings,
    snapshotStructureWarnings: snapshotStructureWarnings,
    readModelCoverageByMonth: {},
    snapshotVsReadModelMismatches: [],
    extraColumnsBySheet: extraColumnsBySheet,
    extraUsedColumnsBySheet: extraUsedColumnsBySheet,
    blankHeadersBySheet: blankHeadersBySheet,
    duplicateHeadersBySheet: duplicateHeadersBySheet,
    missingHeadersBySheet: missingHeadersBySheet,
    sourceHeaderMismatchBySheet: sourceHeaderMismatchBySheet,
    readModelDuplicateKeys: readModelDuplicateKeys,
    readModelFinanceKeys: readModelFinanceKeys,
    activitySnapshotExists: !!ss.getSheetByName('activities_snapshot'),
    recommendations: recommendations
  };
}
