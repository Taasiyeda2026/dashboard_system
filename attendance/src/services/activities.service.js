/**
 * activities.service.js
 * Fetches scheduled activities for an instructor on a given date,
 * using the av2_get_instructor_activities_for_date SECURITY DEFINER RPC.
 *
 * Source of truth: date_1..date_35 in public.activities (NOT activity_meetings,
 * which was found to be nearly empty). Cancellations from course_meeting_cancellations
 * are already filtered inside the RPC.
 *
 * The RPC returns meeting_no pre-calculated as the 1-indexed ordinal of the date
 * among non-cancelled sessions up to (and including) the requested date.
 */

import { supabase } from '../api/client.js';

/**
 * Returns scheduled activities for the instructor on a specific date.
 * Each element includes everything needed to pre-fill the report form.
 *
 * @param {number} empId
 * @param {string} dateStr  ISO date "YYYY-MM-DD"
 * @returns {Promise<ActivitySuggestion[]>}
 *
 * ActivitySuggestion shape:
 *   id, row_id, activity_no, activity_name, activity_type, activity_season,
 *   program_name, start_time (HH:MM), end_time (HH:MM),
 *   authority_id, authority_name,
 *   school_link_status ('single_school'|'multiple_schools'|'authority_or_place_only'),
 *   single_school_id, single_semel_mosad, single_school_name,
 *   linked_schools_json,  ← array of {id, name, semel_mosad} for multiple_schools
 *   meeting_no            ← 1-indexed ordinal among non-cancelled sessions
 */
export async function getInstructorActivitiesForDate(empId, dateStr) {
  const { data, error } = await supabase.rpc('av2_get_instructor_activities_for_date', {
    p_emp_id: empId,
    p_date: dateStr
  });

  if (error) throw new Error(`שגיאה בטעינת פעילויות: ${error.message}`);
  // RPC returns jsonb; supabase-js parses it to JS already
  return Array.isArray(data) ? data : [];
}

/**
 * Build the school options list for a multi-school activity.
 * Returns an array of { id, name, semel_mosad } for the <select>.
 */
export function getSchoolOptions(activity) {
  if (activity.school_link_status === 'multiple_schools') {
    const raw = activity.linked_schools_json;
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
      try { return JSON.parse(raw); } catch { return []; }
    }
    return [];
  }
  if (activity.school_link_status === 'single_school' && activity.single_school_id) {
    return [{
      id: activity.single_school_id,
      name: activity.single_school_name || '',
      semel_mosad: activity.single_semel_mosad || null
    }];
  }
  return []; // authority_or_place_only
}

/**
 * Compute total_hours from HH:MM start and end times (strings).
 * Handles overnight crossing (end < start → add 24h).
 */
export function calcHours(startTime, endTime) {
  if (!startTime || !endTime) return 0;
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  let minutes = (eh * 60 + em) - (sh * 60 + sm);
  if (minutes < 0) minutes += 24 * 60;
  return Math.round((minutes / 60) * 100) / 100; // 2 decimal places
}
