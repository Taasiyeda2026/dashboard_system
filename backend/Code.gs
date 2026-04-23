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
