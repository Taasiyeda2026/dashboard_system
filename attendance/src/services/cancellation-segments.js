/**
 * Cancellation segments are the instructor's requested NON-WORK time before and
 * after a physical activity. They are not activity clock times or trip durations.
 * Null/null means the instructor has not submitted a cancellation request.
 */
export function formatCancellationDuration(minutes) {
  if (minutes == null) return '0:00';
  const value = Math.max(0, Math.trunc(Number(minutes) || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

export function parseCancellationDuration(value) {
  const input = String(value ?? '').trim();
  if (!/^\d{1,3}:[0-5]\d$/.test(input)) return null;
  const [hours, minutes] = input.split(':').map(Number);
  const total = hours * 60 + minutes;
  return total <= 1440 ? total : null;
}

export function canReportInlineCancellation({ activityType = '', online = false } = {}) {
  return Boolean(activityType) && activityType !== 'ביטול זמן' && !online;
}

export function cancellationRequestedMinutes(record = {}) {
  const before = record.cancellation_before_minutes;
  const after = record.cancellation_after_minutes;
  if (before == null || after == null) return null;
  return Number(before) + Number(after);
}
