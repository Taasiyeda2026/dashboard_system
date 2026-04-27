/**
 * Central maintenance pipeline for data consistency after write operations.
 * Order:
 * 1) Sync data_long start/end from activity_meetings
 * 2) Bump read-model cache version
 * 3) Refresh dashboard snapshots
 * 4) Ensure dashboard_refresh_control reflects latest status
 */
function runDataMaintenance_(reason) {
  var messageReason = text_(reason || 'write_operation');
  var syncResult = { updated: 0 };
  var snapshotResult = null;
  var status = 'ok';
  var message = 'maintenance completed';

  try {
    syncResult = syncDataLongDatesFromMeetings_() || { updated: 0 };
    bumpDataViewsCacheVersion_();
    snapshotResult = refreshDashboardSnapshots_() || {};

    if (snapshotResult && snapshotResult.skipped) {
      status = 'pending';
      message = 'snapshot refresh skipped: ' + text_(snapshotResult.reason || 'already_running');
      updateDashboardRefreshControl_(status, message);
    }
  } catch (err) {
    status = 'error';
    message = 'maintenance failed: ' + text_(err && err.message ? err.message : err);
    try {
      updateDashboardRefreshControl_(status, message);
    } catch (_ignored) {}
    return {
      ok: false,
      reason: messageReason,
      status: status,
      message: message,
      sync: syncResult,
      snapshots: snapshotResult
    };
  }

  return {
    ok: true,
    reason: messageReason,
    status: status,
    message: message,
    sync: syncResult,
    snapshots: snapshotResult
  };
}
