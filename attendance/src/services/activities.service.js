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

/** Reverse map: Hebrew form label → English 'lists' table activity_type value. */
export const HEBREW_TO_DB_TYPE = {
  'סדנה':        'workshop',
  'סדנאות קיץ': 'workshop',
  'קורס':        'course',
  'חדר בריחה':  'escape_room',
  'סיור':        'tour',
  'צהרון':       'after_school',
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

/**
 * Returns distinct activity names (program names) for a given Hebrew activity type,
 * sourced from the 'lists' table (category='activity_names') in the dashboard DB.
 * Used to populate the activity-name dropdown in the manual report form.
 *
 * @param {string} hebrewType  Hebrew label, e.g. 'סדנה', 'קורס'
 * @returns {Promise<{value: string, label: string}[]>}
 */
export async function getActivityNamesByType(hebrewType) {
  if (!hebrewType) return [];
  const dbType = HEBREW_TO_DB_TYPE[hebrewType];
  if (!dbType) return []; // Administrative types (הכשרה, ביטול זמן, תפעול …) have no catalog
  try {
    const { data, error } = await supabase
      .from('lists')
      .select('label, activity_name, value')
      .eq('category', 'activity_names')
      .eq('activity_type', dbType)
      .order('label');
    if (error || !data) return [];
    const seen = new Set();
    return data
      .map(row => {
        const name = row.label || row.activity_name || row.value || '';
        return { value: name, label: name };
      })
      .filter(o => {
        if (!o.label || seen.has(o.label)) return false;
        seen.add(o.label);
        return true;
      });
  } catch {
    return [];
  }
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

/**
 * Returns ALL authorities + their schools from the central DB (no instructor filter).
 * Used for manual form entry so the instructor isn't limited to their assigned activities.
 * Falls back to instructor-scoped list if the central RPC is unavailable.
 */
export async function getAllAuthoritySchoolList(empId) {
  try {
    const { data, error } = await supabase.rpc('av2_get_all_authority_school_list');
    if (!error && Array.isArray(data) && data.length > 0) return data;
  } catch {}
  // Fallback: use instructor-scoped list (migration 003 not yet applied)
  return getAuthoritySchoolList(empId);
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
 * Attendance reports are same-day only, so end must be strictly later than start.
 */
export function calcHours(startTime, endTime) {
  if (!startTime || !endTime) return 0;
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const minutes = (eh * 60 + em) - (sh * 60 + sm);
  if (minutes <= 0) return 0;
  return Math.round((minutes / 60) * 100) / 100;
}
