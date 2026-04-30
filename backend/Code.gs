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
