export function normalizeScheduledTraining(row = {}) {
  return {
    row_id: `training:${row.id}`,
    training_schedule_id: row.id,
    activity_name: row.course_name,
    program_name: row.course_name,
    activity_type: 'training',
    start_time: row.start_time,
    end_time: row.end_time,
    is_online: row.is_online === true,
    training_location_name: row.location_name || '',
    training_location_address: row.location_address || '',
    __attendanceTrainingSchedule: true,
  };
}

export function scheduledTrainingReportFields(activity) {
  if (activity?.__attendanceTrainingSchedule !== true) return {};
  const online = activity.is_online === true;
  return {
    training_schedule_id: activity.training_schedule_id,
    training_mode: online ? 'online' : 'physical',
    authority_id: null,
    authority_name_snapshot: online ? null : (activity.training_location_name || null),
    school_id: null,
    school_name_snapshot: null,
    semel_mosad: null,
    destination_address_snapshot: online ? null : (activity.training_location_address || null),
    roundtrip_km: 0,
    public_transport: false,
    public_transport_cost: 0,
  };
}
