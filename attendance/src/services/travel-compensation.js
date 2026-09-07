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
