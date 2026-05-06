function runProductionSmokeTest_() {
  var result = {
    ok: true,
    checks: {
      read_models: {},
      week: {},
      month: {},
      activities: {},
      activity_detail: {},
      save_path: {}
    },
    failures: [],
    warnings: []
  };

  var addFailure = function(msg) {
    result.failures.push(text_(msg));
    result.ok = false;
  };
  var addWarning = function(msg) {
    result.warnings.push(text_(msg));
  };

  var nowYm = formatDate_(new Date()).slice(0, 7);

  var manifest = null;
  try {
    manifest = actionReadModelManifest_(READ_MODEL_ADMIN_USER_);
  } catch (eManifest) {
    addFailure('read_models: failed to load manifest: ' + text_(eManifest && eManifest.message ? eManifest.message : eManifest));
    manifest = {};
  }

  var requiredKeys = [
    'activities',
    'week?week_offset=0',
    'month?ym=' + nowYm,
    'exceptions?month=' + nowYm,
    'end-dates'
  ];
  var storageRequiredKeys = {};
  requiredKeys.forEach(function(k) { storageRequiredKeys[k] = true; });
  var rows = readModelRowsFast_();
  var rowMap = {};
  (rows || []).forEach(function(r) {
    rowMap[text_(r && r.key)] = r || {};
  });

  var readModelsCheck = {
    now_month: nowYm,
    required_keys: requiredKeys,
    keys: {}
  };
  requiredKeys.forEach(function(key) {
    var m = manifest && manifest[key] ? manifest[key] : null;
    var row = rowMap[key] || {};
    var status = text_(m && m.status ? m.status : 'missing');
    var storageRef = text_(row.storage_ref || '');
    var storageType = text_(row.storage_type || '');
    readModelsCheck.keys[key] = {
      status: status,
      has_storage_ref: !!storageRef,
      storage_type: storageType
    };
    if (!m) addFailure('read_models: missing manifest key ' + key);
    if (status !== 'fresh') addFailure('read_models: key ' + key + ' status is ' + status + ' (expected fresh)');
    if (storageRequiredKeys[key] && !storageRef) {
      addFailure('read_models: key ' + key + ' missing storage_ref');
    }
  });
  result.checks.read_models = readModelsCheck;

  var weekPayload = null;
  try {
    weekPayload = actionWeek_(READ_MODEL_ADMIN_USER_, { week_offset: 0, allow_foreground_rebuild: 'no' }) || {};
  } catch (eWeek) {
    addFailure('week: actionWeek failed: ' + text_(eWeek && eWeek.message ? eWeek.message : eWeek));
    weekPayload = {};
  }
  var weekDays = Array.isArray(weekPayload.days) ? weekPayload.days : [];
  var weekItems = weekPayload.items_by_id && typeof weekPayload.items_by_id === 'object' ? weekPayload.items_by_id : {};
  var weekItemsCount = Object.keys(weekItems).length;
  var weekDaysWithItems = weekDays.filter(function(day) {
    return Array.isArray(day && day.item_ids) && day.item_ids.length > 0;
  }).length;
  var weekDebug = weekPayload.debug && typeof weekPayload.debug === 'object' ? weekPayload.debug : {};

  result.checks.week = {
    has_days: Array.isArray(weekPayload.days),
    has_items_by_id: !!(weekPayload.items_by_id && typeof weekPayload.items_by_id === 'object'),
    days_count: weekDays.length,
    items_count: weekItemsCount,
    days_with_items: weekDaysWithItems,
    week_start: text_(weekDebug.week_start || ''),
    week_end: text_(weekDebug.week_end || ''),
    total_source_rows: Number(weekDebug.total_source_rows) || 0,
    rows_with_any_date: Number(weekDebug.rows_with_any_date) || 0,
    rows_with_date_in_week: Number(weekDebug.rows_with_date_in_week) || 0,
    fallback_rebuild_used: !!weekDebug.fallback_rebuild_used,
    fallback_rebuild_allowed: !!weekDebug.fallback_rebuild_allowed
  };

  if (!Array.isArray(weekPayload.days)) addFailure('week: missing days array');
  if (!(weekPayload.items_by_id && typeof weekPayload.items_by_id === 'object')) addFailure('week: missing items_by_id object');
  if ((Number(weekDebug.rows_with_date_in_week) || 0) > 0 && weekItemsCount === 0) {
    addFailure('week: source has dates in week but items_count=0');
  }

  var monthPayload = null;
  try {
    monthPayload = actionMonth_(READ_MODEL_ADMIN_USER_, { ym: nowYm }) || {};
  } catch (eMonth) {
    addFailure('month: actionMonth failed: ' + text_(eMonth && eMonth.message ? eMonth.message : eMonth));
    monthPayload = {};
  }
  var monthCells = Array.isArray(monthPayload.cells) ? monthPayload.cells : [];
  var monthItems = monthPayload.items_by_id && typeof monthPayload.items_by_id === 'object' ? monthPayload.items_by_id : {};
  var monthItemsCount = Object.keys(monthItems).length;
  var monthCellsWithItems = monthCells.filter(function(cell) {
    return Array.isArray(cell && cell.item_ids) && cell.item_ids.length > 0;
  }).length;
  var monthDebug = monthPayload.debug && typeof monthPayload.debug === 'object' ? monthPayload.debug : {};

  result.checks.month = {
    has_month: !!text_(monthPayload.month || ''),
    has_cells: Array.isArray(monthPayload.cells),
    has_items_by_id: !!(monthPayload.items_by_id && typeof monthPayload.items_by_id === 'object'),
    cells_count: monthCells.length,
    items_count: monthItemsCount,
    cells_with_items: monthCellsWithItems,
    total_source_rows: Number(monthDebug.total_source_rows) || 0,
    rows_with_dates: Number(monthDebug.rows_with_dates) || 0,
    month: text_(monthPayload.month || nowYm)
  };

  if (!text_(monthPayload.month || '')) addFailure('month: missing month field');
  if (!Array.isArray(monthPayload.cells)) addFailure('month: missing cells array');
  if (!(monthPayload.items_by_id && typeof monthPayload.items_by_id === 'object')) addFailure('month: missing items_by_id object');
  if ((Number(monthDebug.rows_with_dates) || 0) > 0 && monthItemsCount === 0) {
    addFailure('month: source has dates in month but items_count=0');
  }

  var activitiesPayload = null;
  try {
    activitiesPayload = actionActivitiesSnapshotFirst_(READ_MODEL_ADMIN_USER_, { activity_type: 'all' }) || {};
  } catch (eAct) {
    addFailure('activities: failed to load activities: ' + text_(eAct && eAct.message ? eAct.message : eAct));
    activitiesPayload = {};
  }
  var activitiesRows = Array.isArray(activitiesPayload.rows) ? activitiesPayload.rows : [];
  var warningText = text_(activitiesPayload.warning || '');
  var legacyReason = text_(activitiesPayload._activities_fallback_reason || '');
  var snapshotUsed = !!activitiesPayload._is_snapshot;
  var fallbackUsed = !!activitiesPayload._activities_fallback_used;
  var usedReadModel = !!activitiesPayload.used_read_model;

  result.checks.activities = {
    rows_count: activitiesRows.length,
    fallback_used: fallbackUsed,
    legacy_fallback_reason: legacyReason,
    snapshot_used: snapshotUsed,
    used_read_model: usedReadModel,
    warning: warningText
  };

  if (fallbackUsed || !snapshotUsed) addFailure('activities: legacy foreground/fallback detected');
  if (warningText.indexOf('read_model_get_failed_auto_fallback') >= 0) {
    addFailure('activities: read_model_get_failed_auto_fallback detected');
  }

  var detailDurationMs = null;
  var detailStatus = 'skipped';
  if (activitiesRows.length > 0) {
    var first = activitiesRows[0] || {};
    var rowId = text_(first.RowID || first.source_row_id);
    var sourceSheet = text_(first.source_sheet || (rowId.indexOf('LONG-') === 0 ? configuredLongActivitiesSheet_() : configuredShortActivitiesSheet_()));
    var d0 = perfNowMs_();
    try {
      var detailOut = actionActivityDetail_(READ_MODEL_ADMIN_USER_, { source_row_id: rowId, source_sheet: sourceSheet });
      detailDurationMs = Math.round(Math.max(0, perfNowMs_() - d0));
      detailStatus = detailOut && typeof detailOut === 'object' ? 'ok' : 'empty';
    } catch (eDetail) {
      detailDurationMs = Math.round(Math.max(0, perfNowMs_() - d0));
      detailStatus = 'error';
      addFailure('activity_detail: failed for RowID ' + rowId + ': ' + text_(eDetail && eDetail.message ? eDetail.message : eDetail));
    }
    result.checks.activity_detail = {
      picked_row_id: rowId,
      source_sheet: sourceSheet,
      duration_ms: detailDurationMs,
      status: detailStatus
    };
    if (detailDurationMs !== null && detailDurationMs > 10000) {
      addFailure('activity_detail: duration ' + detailDurationMs + 'ms exceeds 10000ms');
    } else if (detailDurationMs !== null && detailDurationMs > 3000) {
      addWarning('activity_detail: duration ' + detailDurationMs + 'ms exceeds 3000ms');
    }
  } else {
    result.checks.activity_detail = {
      picked_row_id: '',
      source_sheet: '',
      duration_ms: null,
      status: 'skipped_no_activities'
    };
    addWarning('activity_detail: skipped because activities rows are empty');
  }

  var saveFnSource = String(actionSaveActivity_ || '');
  var heavyPatterns = ['refreshAllReadModels_', 'refreshActivitiesSnapshot_', 'actionActivitiesLegacy_'];
  var detected = [];
  heavyPatterns.forEach(function(name) {
    if (saveFnSource.indexOf(name) >= 0) detected.push(name);
  });
  result.checks.save_path = {
    save_path_heavy_refresh_detected: detected.length > 0,
    detected_calls: detected
  };
  if (detected.length > 0) {
    addFailure('save_path: heavy synchronous refresh calls detected in actionSaveActivity_: ' + detected.join(', '));
  }

  return result;
}

function runProductionSmokeTest() {
  var out = runProductionSmokeTest_();
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}
