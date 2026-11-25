/**
 * Manager attendance overview: a read-only projection of verified server data.
 * This module never approves, edits or persists attendance.
 */
const text = (value) => String(value ?? '').trim();

const number = (value) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
};

/** Which managers need a decision now, versus an instructor follow-up or no action. */
export function managerAttendancePriorityRows(roster = [], summary = {}, resolveOverview) {
  if (typeof resolveOverview !== 'function') throw new Error('Missing attendance status resolver');
  const entries = (Array.isArray(roster) ? roster : []).map((row) => {
    const employeeId = text(row?.emp_id);
    const recordCount = summary.recordCounts?.get(employeeId) || 0;
    const overview = resolveOverview({
      workflow: summary.workflowByEmployee?.get(employeeId) || {},
      recordCount
    });
    const auditCount = number(summary.auditByEmployee?.get(employeeId));
    const submitted = overview.status === 'submitted';
    const recordsToReview = submitted ? number(summary.pendingRecordsByEmployee?.get(employeeId)) : 0;
    const travelToReview = submitted ? number(summary.pendingTravelByEmployee?.get(employeeId)) : 0;

    // An approved month with edits after sign-off is a higher-priority audit exception.
    const priority = auditCount > 0 ? 0
      : submitted ? 1
        : overview.status === 'reopened' || overview.status === 'awaiting_employee' ? 2
          : overview.status === 'no_report' ? 3
            : 4;

    return {
      row, employeeId, recordCount, overview, auditCount,
      recordsToReview, travelToReview, priority,
      needsAttention: priority < 4
    };
  });
  return entries.sort((a, b) => a.priority - b.priority
    || text(a.row?.full_name).localeCompare(text(b.row?.full_name), 'he')
    || a.employeeId.localeCompare(b.employeeId));
}

export function managerAttendanceAttentionTotals(rows = []) {
  return rows.reduce((totals, item) => {
    totals.instructors += 1;
    if (item.overview.status === 'submitted') {
      totals.awaitingManager += 1;
      totals.pendingRecords += item.recordsToReview;
      totals.pendingTravel += item.travelToReview;
    } else if (item.overview.status === 'no_report'
      || item.overview.status === 'awaiting_employee'
      || item.overview.status === 'reopened') {
      totals.awaitingInstructor += 1;
    }
    totals.postApprovalChanges += item.auditCount;
    if (item.needsAttention) totals.attentionCount += 1;
    return totals;
  }, {
    instructors: 0,
    awaitingManager: 0,
    pendingRecords: 0,
    pendingTravel: 0,
    awaitingInstructor: 0,
    postApprovalChanges: 0,
    attentionCount: 0
  });
}
