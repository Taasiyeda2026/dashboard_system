const HISTORICAL_BASE_TRAINING_DATES = new Set(['2026-09-15', '2026-09-16', '2026-09-17']);
const HISTORICAL_BASE_TRAINING_NAME = 'הכשרת בסיס';
const HISTORICAL_BASE_TRAINING_LOCATION = 'Greenwork, יקום';
const HISTORICAL_BASE_TRAINING_ADDRESS = '6RVR+XM, יקום';

export function normalizeScheduledTraining(row = {}) {
  const historicalBaseTraining = String(row.course_name || '').trim() === HISTORICAL_BASE_TRAINING_NAME
    && HISTORICAL_BASE_TRAINING_DATES.has(String(row.training_date || '').slice(0, 10));
  return {
    row_id: `training:${row.id}`,
    training_schedule_id: row.id,
    activity_name: row.course_name,
    program_name: row.course_name,
    activity_type: 'training',
    start_time: row.start_time,
    end_time: row.end_time,
    is_online: row.is_online === true,
    training_location_name: row.location_name || (historicalBaseTraining ? HISTORICAL_BASE_TRAINING_LOCATION : ''),
    training_location_address: row.location_address || (historicalBaseTraining ? HISTORICAL_BASE_TRAINING_ADDRESS : ''),
    __attendanceTrainingSchedule: true,
  };
}

export function scheduledTrainingReportFields(activity) {
  if (activity?.__attendanceTrainingSchedule !== true) return {};
  const online = activity.is_online === true;
  const fields = {
    training_schedule_id: activity.training_schedule_id,
    training_mode: online ? 'online' : 'physical',
    authority_id: null,
    authority_name_snapshot: online ? null : (activity.training_location_name || null),
    school_id: null,
    school_name_snapshot: null,
    semel_mosad: null,
    destination_address_snapshot: online ? null : (activity.training_location_address || null),
  };
  if (online) {
    fields.roundtrip_km = 0;
    fields.public_transport = false;
    fields.public_transport_cost = 0;
  }
  return fields;
}
