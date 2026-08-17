/**
 * activities.service.js
 * Fetches scheduled activities for an instructor on a given date,
 * using the av2_get_instructor_activities_for_date SECURITY DEFINER RPC.
 *
 * Also provides authority/school list (for manual form dropdowns) via
 * av2_get_authority_school_list RPC.
 */

import { supabase } from '../api/client.js';

// ── Activity type mapping (English DB values → Hebrew display) ─────────────
const ACTIVITY_TYPE_MAP = {
  after_school: 'צהרון',
  course:       'קורס',
  escape_room:  'חדר בריחה',
  tour:         'סיור',
  workshop:     'סדנה',
};

/** Hebrew activity type labels — exact list, alphabetical order, used in the form select. */
export const HEBREW_ACTIVITY_TYPES = [
  'ביטול זמן',
  'הכשרה',
  'חדר בריחה',
  'סדנה',
  'סדנאות קיץ',
  'סיור',
  'קורס',
  'תפעול',
];

/**
 * Convert an English DB activity type to the matching Hebrew label.
 * Returns the value unchanged when it is already Hebrew.
 */
export function toHebrewType(dbType) {
  if (!dbType) return '';
  return ACTIVITY_TYPE_MAP[dbType] || dbType;
}

// ── Instructor activities for a specific date ──────────────────────────────

/**
 * Returns scheduled activities for the instructor on a specific date.
 *
 * @param {number} empId
 * @param {string} dateStr  ISO date "YYYY-MM-DD"
 * @returns {Promise<ActivitySuggestion[]>}
 */
export async function getInstructorActivitiesForDate(empId, dateStr) {
  const { data, error } = await supabase.rpc('av2_get_instructor_activities_for_date', {
    p_emp_id: empId,
    p_date:   dateStr,
  });
  if (error) throw new Error(`שגיאה בטעינת פעילויות: ${error.message}`);
  return Array.isArray(data) ? data : [];
}

// ── Authority / School list (for manual-form dropdowns) ────────────────────

/**
 * Returns all authorities (+ their schools) linked to the instructor's
 * activities.  Sourced via the av2_get_authority_school_list SECURITY
 * DEFINER RPC — no manual list, always in sync with dashboard data.
 *
 * Shape: Array<{
 *   authority_id:   number,
 *   authority_name: string,
 *   schools: Array<{ id: number, name: string, semel_mosad: number|null }>
 * }>
 */
export async function getAuthoritySchoolList(empId) {
  const { data, error } = await supabase.rpc('av2_get_authority_school_list', {
    p_emp_id: empId,
  });
  if (error) throw new Error(`שגיאה בטעינת רשויות: ${error.message}`);
  return Array.isArray(data) ? data : [];
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build the school options list for a multi-school activity.
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
      id:          activity.single_school_id,
      name:        activity.single_school_name || '',
      semel_mosad: activity.single_semel_mosad || null,
    }];
  }
  return [];
}

/**
 * Compute total_hours from HH:MM start and end times (strings).
 * Handles overnight crossing.
 */
export function calcHours(startTime, endTime) {
  if (!startTime || !endTime) return 0;
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  let minutes = (eh * 60 + em) - (sh * 60 + sm);
  if (minutes < 0) minutes += 24 * 60;
  return Math.round((minutes / 60) * 100) / 100;
}
