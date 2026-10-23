/**
 * Cancellation segments are the instructor's requested NON-WORK time before and
 * after a physical activity. They are not activity clock times or trip durations.
 * Null/null means the instructor has not submitted a cancellation request.
 */
/** Instructor cancellation durations always round upward to five-minute steps. */
export function roundCancellationMinutesUp(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.ceil((value - 1e-9) / 5) * 5;
}

export function formatCancellationDuration(minutes) {
  if (minutes == null) return '0:00';
  const value = roundCancellationMinutesUp(minutes);
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

export function parseCancellationDuration(value) {
  const input = String(value ?? '').trim();
  if (!/^\d{1,3}:[0-5]\d$/.test(input)) return null;
  const [hours, minutes] = input.split(':').map(Number);
  const total = hours * 60 + minutes;
  return total <= 1440 ? roundCancellationMinutesUp(total) : null;
}

/** A display policy must not rewrite an already-reviewed historical request. */
export function cancellationMinutesForSave(value, originalRecord, field) {
  const parsed = parseCancellationDuration(value);
  const original = originalRecord?.[field];
  if (original != null
      && ['approved', 'corrected', 'rejected'].includes(originalRecord?.travel_compensation?.review_status)
      && parsed === roundCancellationMinutesUp(original)) return Number(original);
  return parsed;
}

export function canReportInlineCancellation({ activityType = '', online = false } = {}) {
  return Boolean(activityType) && activityType !== 'ביטול זמן' && !online;
}

export function cancellationRequestedMinutes(record = {}) {
  const before = record.cancellation_before_minutes;
  const after = record.cancellation_after_minutes;
  if (before == null || after == null) return null;
  return roundCancellationMinutesUp(before) + roundCancellationMinutesUp(after);
}

/**
 * Instructor-facing attendance reports round each submitted/requested duration
 * upward to five minutes, independently of manager approval and payroll fields.
 * Missing requests are null (unlike a reported 0:00).
 */
export function instructorReportedCancellationMinutes(record = {}) {
  const sourceBefore = record.cancellation_before_minutes;
  const sourceAfter = record.cancellation_after_minutes;
  if (sourceBefore != null && sourceAfter != null) {
    return roundCancellationMinutesUp(sourceBefore) + roundCancellationMinutesUp(sourceAfter);
  }
  const compensation = record.travel_compensation;
  if (!compensation) return null;
  const before = compensation.reported_before_cancellation_minutes;
  const after = compensation.reported_after_cancellation_minutes;
  if (before != null && after != null) {
    return roundCancellationMinutesUp(before) + roundCancellationMinutesUp(after);
  }
  const requested = compensation.requested_cancellation_minutes;
  return requested != null && Number.isFinite(Number(requested))
    ? roundCancellationMinutesUp(requested)
    : null;
}
