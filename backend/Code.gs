/**
 * Apps Script entrypoint file.
 *
 * Keep `doGet` / `doPost` here so repository setup is explicit and
 * consistent with Apps Script deployment expectations.
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
}

function refreshDashboardSnapshots() {
  return refreshDashboardSnapshots_();
}

/**
 * Time-driven trigger entrypoint for rebuilding dashboard snapshots.
 * Set up as a separate trigger — do not add snapshot logic inside keepWarm.
 */
function refreshDashboardSnapshotsTrigger() {
  refreshDashboardSnapshots_();
}

function getSnapshotRefreshDiagnostics() {
  return getSnapshotRefreshDiagnostics_();
}

function runDataMaintenance() {
  return runDataMaintenance_('manual');
}

function runDataMaintenanceTrigger() {
  runDataMaintenance_('time_trigger');
}

function installDataMaintenanceTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  var exists = triggers.some(function(t) {
    return t.getHandlerFunction && t.getHandlerFunction() === 'runDataMaintenanceTrigger';
  });
  if (exists) return { status: 'already_installed' };

  ScriptApp.newTrigger('runDataMaintenanceTrigger')
    .timeBased()
    .everyHours(1)
    .create();

  return { status: 'installed', frequency: 'hourly' };
}

function installProductionAutomation() {
  var targets = [
    { handler: 'keepWarm', frequency: 'every_10_minutes', install: function() {
      ScriptApp.newTrigger('keepWarm').timeBased().everyMinutes(10).create();
    }},
    { handler: 'runDataMaintenanceTrigger', frequency: 'hourly', install: function() {
      ScriptApp.newTrigger('runDataMaintenanceTrigger').timeBased().everyHours(1).create();
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
    installed: [],
    replaced: [],
    skipped: [],
    triggers: []
  };

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

  result.skipped.push({
    handler: 'refreshAllReadModelsTrigger',
    reason: 'READ_MODELS_ENABLED is false by default in frontend/src/api.js'
  });

  var updated = ScriptApp.getProjectTriggers();
  result.triggers = updated.map(function(t) {
    return {
      id: t.getUniqueId ? t.getUniqueId() : '',
      handler: t.getHandlerFunction ? t.getHandlerFunction() : '',
      event_type: t.getEventType ? String(t.getEventType()) : ''
    };
  });

  return result;
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

  var keepWarm = summarize('keepWarm', 'every_10_minutes');
  var maintenance = summarize('runDataMaintenanceTrigger', 'hourly');
  var hasDuplicates = keepWarm.duplicate || maintenance.duplicate;
  var missing = [];
  if (!keepWarm.exists) missing.push('keepWarm');
  if (!maintenance.exists) missing.push('runDataMaintenanceTrigger');

  var recommendation = missing.length === 0 && !hasDuplicates
    ? 'automation_is_healthy'
    : 'run installProductionAutomation() to repair missing/duplicate triggers';

  return {
    keepWarm: keepWarm,
    runDataMaintenanceTrigger: maintenance,
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

function refreshAllReadModelsTrigger() {
  refreshAllReadModels_();
}

function installReadModelsTriggers() {
  var targetHandler = 'refreshAllReadModelsTrigger';
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction && t.getHandlerFunction() === targetHandler) {
      ScriptApp.deleteTrigger(t);
    }
  });
  [7, 13, 19].forEach(function(hour) {
    ScriptApp.newTrigger(targetHandler)
      .timeBased()
      .atHour(hour)
      .everyDays(1)
      .create();
  });
  return { status: 'installed', hours: [7, 13, 19] };
}
