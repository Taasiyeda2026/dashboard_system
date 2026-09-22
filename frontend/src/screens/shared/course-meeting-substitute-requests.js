import { supabase } from '../../supabase-client.js';

export const COURSE_MEETING_SUBSTITUTE_REQUEST_TYPE = 'course_meeting_substitution';

const text = (value) => String(value ?? '').trim();

function firstRpcRow(data) {
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}

export function substituteRequestErrorMessage(error) {
  const raw = text(error?.message || error);
  const messages = {
    scheduling_request_permission_denied: 'אין הרשאה לבצע שינוי ישיר. יש להגיש בקשה לעדכון.',
    scheduling_permission_denied: 'רק אדמין או תפעול רשאים לאשר ולבצע את השינוי.',
    scheduling_meeting_date_required: 'יש לבחור מפגש',
    scheduling_meeting_not_found: 'המפגש שנבחר אינו קיים בלוח הפעילות',
    scheduling_no_existing_assignment: 'לפעילות אין מדריך משובץ',
    scheduling_single_substitution_missing: 'לא קיימת החלפה חד־פעמית במפגש זה',
    scheduling_substitute_already_assigned: 'המדריך שנבחר כבר משויך למפגש הזה',
    substitute_instructor_required: 'יש לבחור מדריך מחליף',
    instructor_not_found: 'המדריך לא נמצא במאגר',
    instructor_inactive: 'המדריך אינו פעיל',
    edit_request_already_reviewed: 'הבקשה כבר טופלה',
    edit_request_not_found: 'הבקשה לא נמצאה'
  };
  for (const [code, message] of Object.entries(messages)) {
    if (raw.includes(code)) return message;
  }
  return raw || 'הפעולה נכשלה';
}

export async function submitCourseMeetingSubstituteRequest({
  activityId,
  meetingDate,
  substituteEmpId = null,
  action = 'set'
} = {}) {
  if (!supabase) throw new Error('Supabase אינו זמין');
  const { data, error } = await supabase.rpc('submit_course_meeting_substitute_request', {
    p_activity_id: text(activityId),
    p_meeting_date: text(meetingDate),
    p_substitute_emp_id: substituteEmpId == null ? null : Number(substituteEmpId),
    p_action: text(action) || 'set'
  });
  if (error) throw new Error(substituteRequestErrorMessage(error));
  return firstRpcRow(data);
}

export async function loadCourseMeetingSubstituteRequestGroups({ canApprove = false } = {}) {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('course_meeting_substitute_requests');
  if (error) {
    if (String(error.code || '') === '42501') return [];
    throw new Error(substituteRequestErrorMessage(error));
  }

  const rows = Array.isArray(data) ? data : [];
  const activityIds = [...new Set(rows.map((row) => text(row?.source_row_id)).filter(Boolean))];
  let activitiesById = new Map();
  if (activityIds.length) {
    const { data: activities, error: activitiesError } = await supabase
      .from('activities')
      .select('row_id,activity_type,activity_name,school,authority,activity_manager,start_date,end_date,date_1,start_time,end_time')
      .in('row_id', activityIds);
    if (activitiesError) throw new Error(substituteRequestErrorMessage(activitiesError));
    activitiesById = new Map((activities || []).map((activity) => [text(activity.row_id), activity]));
  }

  return rows.map((row) => {
    const payload = row?.requested_payload && typeof row.requested_payload === 'object'
      ? row.requested_payload
      : {};
    const action = text(payload.action) || 'set';
    const oldInstructor = text(payload.expected_current_instructor_name) || text(payload.expected_current_emp_id);
    const newInstructor = action === 'clear'
      ? 'החזרה למדריך הקבוע'
      : (text(payload.substitute_instructor_name) || text(payload.substitute_emp_id));
    return {
      ...row,
      request_type: COURSE_MEETING_SUBSTITUTE_REQUEST_TYPE,
      requested_payload: payload,
      can_approve: !!canApprove,
      activity: {
        ...(activitiesById.get(text(row?.source_row_id)) || {}),
        row_id: row?.source_row_id
      },
      fields: [
        { field_name: 'substitute_meeting_date', old_value: '', new_value: payload.meeting_date || '' },
        { field_name: 'substitute_current_instructor', old_value: '', new_value: oldInstructor },
        { field_name: 'substitute_requested_instructor', old_value: '', new_value: newInstructor }
      ]
    };
  });
}

export async function reviewCourseMeetingSubstituteRequest(requestId, status) {
  if (!supabase) throw new Error('Supabase אינו זמין');
  const { data, error } = await supabase.rpc('review_course_meeting_substitute_request', {
    p_request_id: text(requestId),
    p_status: text(status)
  });
  if (error) throw new Error(substituteRequestErrorMessage(error));
  return firstRpcRow(data);
}
