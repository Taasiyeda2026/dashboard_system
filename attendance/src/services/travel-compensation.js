export function calculateTravelCancellationMinutes(outboundMinutes, returnMinutes) {
  const outbound = Math.max(0, Math.round(Number(outboundMinutes) || 0) - 45);
  const returning = Math.max(0, Math.round(Number(returnMinutes) || 0) - 45);
  return outbound + returning;
}

export function isGeneratedTravelCancellation(record = {}) {
  return record.generation_kind === 'travel_time_cancellation' && !!record.source_attendance_record_id;
}

export function sourceAttendanceRecords(records = []) {
  return records.filter((record) => !isGeneratedTravelCancellation(record));
}

/** One-way distance threshold (km) for the instructor travel-report reminder. */
export const TRAVEL_REPORT_REMINDER_ONE_WAY_KM = 40;

export function shouldRemindTravelReport(oneWayDistanceKm) {
  const km = Number(oneWayDistanceKm);
  return Number.isFinite(km) && km > TRAVEL_REPORT_REMINDER_ONE_WAY_KM;
}

export function maxOneWayDistanceKm(outboundKm, returnKm) {
  const out = Number(outboundKm);
  const ret = Number(returnKm);
  const values = [out, ret].filter((value) => Number.isFinite(value) && value >= 0);
  if (!values.length) return null;
  return Math.max(...values);
}

/** Review statuses that still block manager month finalize. */
export const OPEN_TRAVEL_REVIEW_STATUSES = Object.freeze([
  'awaiting_report',
  'auto_matched',
  'pending_review',
]);

export function isOpenTravelReviewStatus(status) {
  return OPEN_TRAVEL_REVIEW_STATUSES.includes(String(status || ''));
}

/** Statuses that may contribute approved minutes to payroll. */
export function isPayrollApprovedTravelReview(status) {
  return status === 'approved' || status === 'corrected';
}

/**
 * Instructor-safe compensation shape. Never include system route estimates.
 */
export function toInstructorTravelCompensationView(row = {}) {
  const reportedOutbound = row.reported_outbound_minutes;
  const reportedReturn = row.reported_return_minutes;
  const hasReport = reportedOutbound != null && reportedReturn != null;
  return {
    source_attendance_record_id: row.source_attendance_record_id,
    calculation_status: row.calculation_status || null,
    reported_outbound_minutes: reportedOutbound ?? null,
    reported_return_minutes: reportedReturn ?? null,
    reported_at: row.reported_at || null,
    requested_cancellation_minutes: row.requested_cancellation_minutes ??
      (hasReport ? calculateTravelCancellationMinutes(reportedOutbound, reportedReturn) : null),
    reported_before_cancellation_minutes: row.reported_before_cancellation_minutes ?? null,
    reported_after_cancellation_minutes: row.reported_after_cancellation_minutes ?? null,
    report_kind: row.report_kind || 'travel_minutes',
    review_status: row.review_status || 'none',
    approved_cancellation_minutes: row.approved_cancellation_minutes ?? null,
    show_travel_report_reminder: row.show_travel_report_reminder === true,
    eligible: row.eligible !== false,
  };
}

export function computeTravelReviewStatus({
  reportedOutbound,
  reportedReturn,
  systemCancelMinutes,
  systemDistanceKm,
  calculationStatus,
  existingReviewStatus = null,
} = {}) {
  if (['approved', 'corrected', 'rejected'].includes(existingReviewStatus)) {
    return existingReviewStatus;
  }
  const hasReport = reportedOutbound != null && reportedReturn != null;
  if (!hasReport) {
    if (
      calculationStatus === 'resolved'
      && (Number(systemCancelMinutes) > 0 || shouldRemindTravelReport(systemDistanceKm))
    ) {
      return 'awaiting_report';
    }
    return 'none';
  }
  if (calculationStatus !== 'resolved') return 'pending_review';
  const requested = calculateTravelCancellationMinutes(reportedOutbound, reportedReturn);
  if (requested === Math.max(0, Math.round(Number(systemCancelMinutes) || 0))) {
    return 'auto_matched';
  }
  return 'pending_review';
}
