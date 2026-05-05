/**
 * Apps Script entrypoint file.
 *
 * Keep `doGet` / `doPost` here so repository setup is explicit and
 * consistent with Apps Script deployment expectations.
 *
 * Ops: POST action `health_check` (admin / operation_manager) returns rollup
 * metrics from `ops_health.gs` without debug_perf.
 */
function doGet() {
  return handleGet_();
}

function doPost(e) {
  return handlePost_(e);
}

/**
 * Warmup entrypoint for time-driven trigger.
 * Keeps Apps Script runtime warm without any data mutation.
 */
function keepWarm() {
  try {
    getSpreadsheet_();
  } catch (e) {
    // warmup only — intentionally ignored
  }
  try {
    ensureDashboardSnapshotTrigger_();
  } catch (_e) {
    // trigger self-heal — failure is non-fatal
  }
}

/**
 * One-time trigger handler: rebuilds dashboard snapshots as soon as possible
 * after a data mutation so the next read gets a fresh snapshot.
 * Does NOT acquire its own lock — refreshDashboardSnapshots_() has its own
 * script lock internally; a second outer lock would cause it to see the lock
 * as busy and return { skipped: true } without actually rebuilding.
 * Self-cleans all same-handler triggers after running (including any duplicates).
 */
function scheduledSnapshotRebuildTrigger() {
  try {
    refreshDashboardSnapshots_();
  } finally {
    var triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(function(t) {
      if (t.getHandlerFunction && t.getHandlerFunction() === 'scheduledSnapshotRebuildTrigger') {
        try { ScriptApp.deleteTrigger(t); } catch (_e) {}
      }
    });
  }
}

function refreshDashboardSnapshots() {
  return refreshDashboardSnapshots_();
}

/**
 * Public entrypoint: ensures the 10-minute dashboard snapshot trigger is installed.
 * Callable from onOpen, custom menus, or admin setup flows.
 */
function ensureDashboardSnapshotTrigger() {
  return ensureDashboardSnapshotTrigger_();
}

function refreshDataViews() {
  return refreshDataViews_();
}

function refreshActivitiesSnapshot() {
  return refreshActivitiesSnapshot_();
}

function ensureSystemWorkbookScaffold() {
  return ensureSystemWorkbookScaffold_();
}

function repairSystemWorkbookStructure() {
  return repairSystemWorkbookStructure_();
}

/**
 * Time-driven trigger entrypoint for rebuilding dashboard snapshots.
 * Set up as a separate trigger — do not add snapshot logic inside keepWarm.
 */
function refreshDashboardSnapshotsTrigger() {
  // Do NOT acquire an outer script lock here — refreshDashboardSnapshots_() owns its own
  // non-reentrant LockService.getScriptLock() internally. Wrapping it in a second outer lock
  // causes the inner tryLock to see the lock as busy and return { skipped: true } without rebuilding.
  return refreshDashboardSnapshots_();
}

/**
 * Admin repair function for snapshot trigger cadence drift.
 * ensureDashboardSnapshotTrigger_() skips reinstall when the PropertiesService marker is already set.
 * Call this after manual trigger deletion or when the 10-minute cadence is suspected to have drifted.
 * Clears the marker then delegates to ensureDashboardSnapshotTrigger_() for a clean reinstall.
 */
function repairDashboardSnapshotTrigger() {
  PropertiesService.getScriptProperties().deleteProperty('dashboard_snapshot_trigger_cadence_v1');
  return ensureDashboardSnapshotTrigger_();
}

function refreshDataViewsTrigger() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { skipped: true, reason: 'lock_busy' };
  try {
    return refreshDataViews_();
  } finally {
    lock.releaseLock();
  }
}

function refreshActivitiesSnapshotTrigger() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { skipped: true, reason: 'lock_busy' };
  try {
    return refreshActivitiesSnapshot_();
  } finally {
    lock.releaseLock();
  }
}

function getSnapshotRefreshDiagnostics() {
  return getSnapshotRefreshDiagnostics_();
}

function runDataMaintenance() {
  return runDataMaintenance_('manual');
}

/**
 * טריגר תחזוקה יומי — מריץ רק את הסנכרון הייחודי (sync end dates).
 *
 * Views ו-Snapshots מכוסים כבר על ידי טריגרים נפרדים:
 *   refreshDataViewsTrigger        — כל שעה
 *   refreshDashboardSnapshotsTrigger — כל 10 דקות
 *
 * Guard: עוצר אחרי 5 דקות ומדווח על כל שלב.
 * שלבים נוספים (Drive cleanup) מבוצעים רק אם נשאר budget.
 */
function runDataMaintenanceTrigger() {
  var MAX_MS = 5 * 60 * 1000;
  var startMs = Date.now();
  var results = { started_at: new Date().toISOString(), steps: [] };

  function elapsed() { return Date.now() - startMs; }
  function hasTime(reserveMs) { return elapsed() < MAX_MS - (reserveMs || 30000); }

  function runStep(label, fn, reserveMs) {
    if (!hasTime(reserveMs)) {
      results.steps.push({ step: label, skipped: true, reason: 'time_budget_exhausted', elapsed_ms: elapsed() });
      return;
    }
    try {
      var r = fn();
      results.steps.push({ step: label, ok: true, result: r || null, elapsed_ms: elapsed() });
    } catch (err) {
      results.steps.push({ step: label, error: String(err), elapsed_ms: elapsed() });
    }
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) {
    Logger.log('[runDataMaintenanceTrigger] skipped: lock busy');
    return { skipped: true, reason: 'lock_busy' };
  }

  try {
    beginRequestCache_();

    // שלב 1: סנכרון תאריכי סיום מגיליון activity_meetings → data_long
    // זהו השלב הייחודי לטריגר זה — views/snapshots מכוסים בטריגרים נפרדים.
    runStep('sync_end_dates', function() {
      return syncDataLongDatesFromMeetings_();
    }, 120000);

    // שלב 2: ניקוי cache ישן של script (קל)
    runStep('script_cache_cleanup', function() {
      if (typeof pruneExpiredScriptCache_ === 'function') return pruneExpiredScriptCache_();
      return { skipped: true, reason: 'function_not_available' };
    }, 60000);

  } finally {
    try { __rqCache_ = null; } catch (_e) {}
    lock.releaseLock();
  }

  results.elapsed_ms = elapsed();
  Logger.log('[runDataMaintenanceTrigger] completed: ' + JSON.stringify(results));
  return results;
}

function syncEndDatesTrigger() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    console.info('[end_dates] skipped: lock busy');
    return { skipped: true, reason: 'lock_busy' };
  }
  try {
    if (typeof actionSyncEndDates_ === 'function') {
      return actionSyncEndDates_({ user_id: 'end_dates_trigger', display_role: 'admin' }, {});
    }
    if (typeof refreshEndDatesReadModel_ === 'function') {
      return refreshEndDatesReadModel_();
    }
    return { skipped: true, reason: 'no_end_dates_refresh_function' };
  } finally {
    lock.releaseLock();
  }
}

function installDataMaintenanceTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) {
    if (t.getHandlerFunction && t.getHandlerFunction() === 'runDataMaintenanceTrigger') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('runDataMaintenanceTrigger')
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .create();
  return { status: 'installed', frequency: 'daily_03:00' };
}

function installProductionAutomation() {
  var targets = [
    { handler: 'keepWarm', frequency: 'every_5_minutes', install: function() {
      ScriptApp.newTrigger('keepWarm').timeBased().everyMinutes(5).create();
    }},
    { handler: 'runDataMaintenanceTrigger', frequency: 'daily_03:00', install: function() {
      ScriptApp.newTrigger('runDataMaintenanceTrigger').timeBased().everyDays(1).atHour(3).create();
    }},
    { handler: 'refreshAllReadModelsTrigger', frequency: 'hourly', install: function() {
      ScriptApp.newTrigger('refreshAllReadModelsTrigger').timeBased().everyHours(1).create();
    }},
    { handler: 'refreshDataViewsTrigger', frequency: 'hourly', install: function() {
      ScriptApp.newTrigger('refreshDataViewsTrigger').timeBased().everyHours(1).create();
    }},
    { handler: 'refreshActivitiesSnapshotTrigger', frequency: 'every_10_minutes', install: function() {
      ScriptApp.newTrigger('refreshActivitiesSnapshotTrigger').timeBased().everyMinutes(10).create();
    }},
    { handler: 'refreshDashboardSnapshotsTrigger', frequency: 'every_10_minutes', install: function() {
      ScriptApp.newTrigger('refreshDashboardSnapshotsTrigger').timeBased().everyMinutes(10).create();
    }},
    { handler: 'syncEndDatesTrigger', frequency: 'hourly', install: function() {
      ScriptApp.newTrigger('syncEndDatesTrigger').timeBased().everyHours(1).create();
    }}
  ];
  var existing = ScriptApp.getProjectTriggers();
  var byHandler = {};
  existing.forEach(function(t) {
    var handler = t.getHandlerFunction ? t.getHandlerFunction() : '';
    if (!byHandler[handler]) byHandler[handler] = [];
    byHandler[handler].push(t);
  });

  var result = {
    scaffold: null,
    repair: null,
    initialRefresh: [],
    installed: [],
    replaced: [],
    skipped: [],
    triggers: []
  };
  if (typeof ensureSystemWorkbookScaffold_ === 'function') {
    try { result.scaffold = ensureSystemWorkbookScaffold_(); } catch (e) { result.scaffold = { skipped: true, reason: String(e) }; }
  } else {
    result.scaffold = { skipped: true, reason: 'missing_function_ensureSystemWorkbookScaffold_' };
  }
  if (typeof repairSystemWorkbookStructure_ === 'function') {
    try { result.repair = repairSystemWorkbookStructure_(); } catch (e2) { result.repair = { skipped: true, reason: String(e2) }; }
  } else {
    result.repair = { skipped: true, reason: 'missing_function_repairSystemWorkbookStructure_' };
  }
  [
    { fn: 'refreshDataViews_', label: 'data_views' },
    { fn: 'refreshActivitiesSnapshot_', label: 'activities_snapshot' },
    { fn: 'refreshDashboardSnapshots_', label: 'dashboard_snapshots' },
    { fn: 'refreshAllReadModels_', label: 'read_models' }
  ].forEach(function(step) {
    if (typeof this[step.fn] !== 'function') {
      result.initialRefresh.push({ step: step.label, skipped: true, reason: 'missing_function_' + step.fn });
      return;
    }
    try { result.initialRefresh.push({ step: step.label, ok: true, outcome: this[step.fn]() || null }); }
    catch (e3) { result.initialRefresh.push({ step: step.label, skipped: true, reason: String(e3) }); }
  });

  targets.forEach(function(target) {
    var current = byHandler[target.handler] || [];
    current.forEach(function(t) {
      ScriptApp.deleteTrigger(t);
    });
    if (current.length > 0) {
      result.replaced.push({
        handler: target.handler,
        deleted_count: current.length
      });
    }
    target.install();
    result.installed.push({
      handler: target.handler,
      frequency: target.frequency
    });
  });

  var updated = ScriptApp.getProjectTriggers();
  result.triggers = updated.map(function(t) {
    return {
      id: t.getUniqueId ? t.getUniqueId() : '',
      handler: t.getHandlerFunction ? t.getHandlerFunction() : '',
      event_type: t.getEventType ? String(t.getEventType()) : ''
    };
  });

  // Confirm dashboard snapshot trigger cadence via PropertiesService so keepWarm
  // self-healing can detect and repair any cadence drift on subsequent runs.
  try {
    result.snapshotTrigger = ensureDashboardSnapshotTrigger_();
  } catch (e) {
    result.snapshotTrigger = { skipped: true, reason: String(e) };
  }

  return result;
}

function ensureProductionAutomationTriggers_() {
  return installProductionAutomation();
}

function getProductionAutomationStatus() {
  var triggers = ScriptApp.getProjectTriggers();
  var byHandler = {};
  triggers.forEach(function(t) {
    var handler = t.getHandlerFunction ? t.getHandlerFunction() : '';
    if (!byHandler[handler]) byHandler[handler] = [];
    byHandler[handler].push(t);
  });

  function summarize(handler, expectedFrequency) {
    var list = byHandler[handler] || [];
    return {
      exists: list.length > 0,
      count: list.length,
      duplicate: list.length > 1,
      expected_frequency: expectedFrequency,
      trigger_ids: list.map(function(t) { return t.getUniqueId ? t.getUniqueId() : ''; }),
      event_types: list.map(function(t) { return t.getEventType ? String(t.getEventType()) : ''; })
    };
  }

  var keepWarm = summarize('keepWarm', 'every_5_minutes');
  var maintenance = summarize('runDataMaintenanceTrigger', 'daily_03:00');
  var readModels = summarize('refreshAllReadModelsTrigger', 'hourly');
  var dataViews = summarize('refreshDataViewsTrigger', 'hourly');
  var activitiesSnapshot = summarize('refreshActivitiesSnapshotTrigger', 'every_10_minutes');
  var dashboardSnapshots = summarize('refreshDashboardSnapshotsTrigger', 'every_10_minutes');
  var endDates = summarize('syncEndDatesTrigger', 'hourly');
  var workbookRepair = summarize('repairSystemWorkbookStructureTrigger', 'daily_optional');
  var hasDuplicates =
    keepWarm.duplicate || maintenance.duplicate || readModels.duplicate ||
    dataViews.duplicate || activitiesSnapshot.duplicate || dashboardSnapshots.duplicate ||
    endDates.duplicate || workbookRepair.duplicate;
  var missing = [];
  if (!keepWarm.exists) missing.push('keepWarm');
  if (!maintenance.exists) missing.push('runDataMaintenanceTrigger');
  if (!readModels.exists) missing.push('refreshAllReadModelsTrigger');
  if (!dataViews.exists) missing.push('refreshDataViewsTrigger');
  if (!activitiesSnapshot.exists) missing.push('refreshActivitiesSnapshotTrigger');
  if (!dashboardSnapshots.exists) missing.push('refreshDashboardSnapshotsTrigger');
  if (!endDates.exists) missing.push('syncEndDatesTrigger');

  var recommendation = missing.length === 0 && !hasDuplicates
    ? 'automation_is_healthy'
    : 'run installProductionAutomation() to repair missing/duplicate triggers';

  return {
    keepWarm: keepWarm,
    runDataMaintenanceTrigger: maintenance,
    refreshAllReadModelsTrigger: readModels,
    refreshDataViewsTrigger: dataViews,
    refreshActivitiesSnapshotTrigger: activitiesSnapshot,
    refreshDashboardSnapshotsTrigger: dashboardSnapshots,
    syncEndDatesTrigger: endDates,
    repairSystemWorkbookStructureTrigger: workbookRepair,
    duplicates_detected: hasDuplicates,
    missing_handlers: missing,
    recommendation: recommendation
  };
}

/**
 * Manual entrypoint for rebuilding the new performance views.
 *
 * Use this from the Apps Script function dropdown.
 * It rebuilds:
 * - view_activity_meetings
 * - view_dashboard_monthly
 * - view_activities_summary
 */
function runRefreshDataViewsManually() {
  return refreshDataViews_();
}

function refreshAllReadModels() {
  return refreshAllReadModels_();
}

/**
 * Ensures a single clock trigger calls refreshAllReadModelsTrigger every hour.
 * - 0 triggers: creates one hourly trigger.
 * - 1 trigger: left as-is (schedule cannot be read back from Trigger; use installReadModelsTriggers() to force hourly).
 * - 2+ triggers: removes all and creates one hourly (fixes duplicates or legacy multi-clock installs).
 */
function ensureReadModelsRefreshTrigger_() {
  var handler = 'refreshAllReadModelsTrigger';
  var mine = ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction && t.getHandlerFunction() === handler;
  });
  if (mine.length === 0) {
    ScriptApp.newTrigger(handler)
      .timeBased()
      .everyHours(1)
      .create();
    return { status: 'installed', action: 'created_hourly', count: 1 };
  }
  if (mine.length > 1) {
    mine.forEach(function(t) {
      try {
        ScriptApp.deleteTrigger(t);
      } catch (_e) {}
    });
    ScriptApp.newTrigger(handler)
      .timeBased()
      .everyHours(1)
      .create();
    return {
      status: 'installed',
      action: 'replaced_with_single_hourly',
      previous_count: mine.length,
      count: 1
    };
  }
  return { status: 'ok', action: 'none', count: 1 };
}

function refreshAllReadModelsTrigger() {
  var ensured = ensureReadModelsRefreshTrigger_();
  try {
    console.info('[read_models] trigger_start', JSON.stringify({ trigger_ensure: ensured }));
  } catch (_e) {}
  var outcome = refreshAllReadModels_();
  try {
    if (outcome && outcome.skipped) {
      console.info('[read_models] trigger_skipped', JSON.stringify(outcome));
    } else {
      console.info(
        '[read_models] trigger_done',
        JSON.stringify({
          duration_ms: outcome && outcome.duration_ms,
          failure_count: outcome && outcome.failure_count,
          trigger_ensure: ensured
        })
      );
    }
  } catch (_e2) {}
}

/**
 * Normalizes read-model triggers to exactly one hourly run (run once from the Apps Script editor after deploy).
 */
function installReadModelsTriggers() {
  var targetHandler = 'refreshAllReadModelsTrigger';
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction && t.getHandlerFunction() === targetHandler) {
      try {
        ScriptApp.deleteTrigger(t);
      } catch (_e) {}
    }
  });
  ScriptApp.newTrigger(targetHandler)
    .timeBased()
    .everyHours(1)
    .create();
  return { status: 'installed', frequency: 'hourly' };
}
