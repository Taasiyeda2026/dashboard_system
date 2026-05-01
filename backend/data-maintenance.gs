/**
 * Central maintenance pipeline for data consistency after write operations.
 * Order:
 * 1) Sync data_long start/end from activity_meetings
 * 2) Refresh data views (view_activity_meetings, view_dashboard_monthly,
 *    view_activities_summary) — includes internal bumpDataViewsCacheVersion_
 * 3) Refresh dashboard snapshots (reads from the freshly-written views)
 * 4) Ensure dashboard_refresh_control reflects latest status
 *
 * dashboard_refresh_control is marked ok only after BOTH steps 2 and 3
 * complete successfully.  If refreshDataViews_ fails the pipeline aborts
 * immediately and marks the control as error without running snapshots.
 */
function runDataMaintenance_(reason) {
  var messageReason = text_(reason || 'write_operation');
  var syncResult    = { updated: 0 };
  var viewsResult   = null;
  var snapshotResult = null;
  var status  = 'ok';
  var message = 'maintenance completed';

  try {
    // Step 1 – sync long-activity dates from meetings sheet
    syncResult = syncDataLongDatesFromMeetings_() || { updated: 0 };

    // Step 2 – rebuild all three data views; bumpDataViewsCacheVersion_ is
    // called inside refreshDataViews_ so we do NOT call it separately here.
    viewsResult = refreshDataViews_();

    if (!viewsResult || !viewsResult.ok) {
      status  = 'error';
      message = 'refreshDataViews failed' +
                (viewsResult && viewsResult.error ? ': ' + text_(viewsResult.error) : '');
      updateDashboardRefreshControl_(status, message);
      return {
        ok: false,
        reason: messageReason,
        status: status,
        message: message,
        sync: syncResult,
        views: viewsResult,
        snapshots: null
      };
    }

    // Step 3 – rebuild dashboard snapshots from the now-fresh views
    snapshotResult = refreshDashboardSnapshots_() || {};

    if (snapshotResult && snapshotResult.skipped) {
      status  = 'pending';
      message = 'snapshot refresh skipped: ' +
                text_(snapshotResult.reason || 'already_running');
      updateDashboardRefreshControl_(status, message);
    }
    // When snapshots run to completion refreshDashboardSnapshots_ already
    // calls updateDashboardRefreshControl_ internally with 'ok'/'partial'.

  } catch (err) {
    status  = 'error';
    message = 'maintenance failed: ' +
              text_(err && err.message ? err.message : err);
    try {
      updateDashboardRefreshControl_(status, message);
    } catch (_ignored) {}
    return {
      ok: false,
      reason: messageReason,
      status: status,
      message: message,
      sync: syncResult,
      views: viewsResult,
      snapshots: snapshotResult
    };
  }

  return {
    ok: true,
    reason: messageReason,
    status: status,
    message: message,
    sync: syncResult,
    views: viewsResult,
    snapshots: snapshotResult
  };
}
