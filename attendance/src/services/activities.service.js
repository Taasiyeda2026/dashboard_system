/**
 * activities.service.js
 * Instructor activity lists for the new-report form.
 */

import { supabase } from '../api/client.js';
import {
  HEBREW_TO_DB_TYPE,
  getDbTypesForReportType,
  currentAttendanceActivitySeasons,
} from './activities-report.helpers.js';
export {
  ONLINE_REPORT_TYPE,
  TRAINING_REPORT_TYPE,
  OPERATIONS_REPORT_TYPE,
  NO_ACTIVITY_NAME_REPORT_TYPES,
  OPEN_FIELD_REPORT_TYPES,
  HEBREW_TO_DB_TYPE,
  HEBREW_ACTIVITY_TYPES,
  toHebrewType,
  normalizeDbActivityType,
  getDbTypesForReportType,
  activityMatchesReportType,
  filterActivitiesForReportType,
  currentAttendanceActivitySeasons,
  instructorActivityOptionLabel,
  activitySearchHaystack,
  instructorActivitySelectOptions,
  deriveAuthoritySchoolListFromActivities,
  getSchoolOptions,
  calcHours,
} from './activities-report.helpers.js';

async function aggregateActivitiesFromDateRpc(empId, seasons) {
  const seen = new Map();
  const today = new Date();
  for (let offset = -210; offset <= 210; offset += 7) {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    const dateStr = d.toISOString().slice(0, 10);
    try {
      const rows = await getInstructorActivitiesForDate(empId, dateStr);
      for (const row of rows) {
        const id = String(row?.row_id || '').trim();
        if (!id || seen.has(id)) continue;
        if (seasons?.length && row?.activity_season && !seasons.includes(row.activity_season)) continue;
        seen.set(id, row);
      }
    } catch {
      // ignore per-date failures
    }
  }
  return Array.from(seen.values());
}

export async function getInstructorActivities(empId, referenceDateStr) {
  const seasons = currentAttendanceActivitySeasons(referenceDateStr);
  try {
    const { data, error } = await supabase.rpc('av2_get_instructor_activities', {
      p_emp_id: empId,
      p_activity_seasons: seasons,
    });
    if (!error && Array.isArray(data)) return data;
  } catch {
    // RPC not deployed yet
  }
  return aggregateActivitiesFromDateRpc(empId, seasons);
}

export async function searchCanonicalActivities({
  query = '',
  reportType = '',
  referenceDateStr,
  limit = 50,
} = {}) {
  const dbTypes = getDbTypesForReportType(reportType);
  const seasons = currentAttendanceActivitySeasons(referenceDateStr);
  try {
    const { data, error } = await supabase.rpc('av2_search_canonical_activities', {
      p_query: query,
      p_activity_types: dbTypes,
      p_activity_seasons: seasons,
      p_limit: limit,
    });
    if (!error && Array.isArray(data)) return data;
  } catch {
    // RPC not deployed yet
  }
  return [];
}

export async function getInstructorActivitiesForDate(empId, dateStr) {
  const { data, error } = await supabase.rpc('av2_get_instructor_activities_for_date', {
    p_emp_id: empId,
    p_date:   dateStr,
  });
  if (error) throw new Error(`שגיאה בטעינת פעילויות: ${error.message}`);
  return Array.isArray(data) ? data : [];
}

export async function getMeetingNoForActivityOnDate(empId, activityRowId, dateStr) {
  if (!empId || !activityRowId || !dateStr) return null;
  try {
    const rows = await getInstructorActivitiesForDate(empId, dateStr);
    const match = rows.find((row) => String(row?.row_id || '').trim() === String(activityRowId).trim());
    return match?.meeting_no ?? null;
  } catch {
    return null;
  }
}

export async function getAuthoritySchoolList(empId) {
  const { data, error } = await supabase.rpc('av2_get_authority_school_list', {
    p_emp_id: empId,
  });
  if (error) throw new Error(`שגיאה בטעינת רשויות: ${error.message}`);
  return Array.isArray(data) ? data : [];
}

export async function getAllAuthoritySchoolList(empId) {
  try {
    const { data, error } = await supabase.rpc('av2_get_all_authority_school_list');
    if (!error && Array.isArray(data) && data.length > 0) return data;
  } catch {}
  return getAuthoritySchoolList(empId);
}

export async function getActivityNamesByType(hebrewType) {
  if (!hebrewType) return [];
  const dbType = HEBREW_TO_DB_TYPE[hebrewType];
  if (!dbType) return [];
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
      .map((row) => {
        const name = row.label || row.activity_name || row.value || '';
        return { value: name, label: name };
      })
      .filter((o) => {
        if (!o.label || seen.has(o.label)) return false;
        seen.add(o.label);
        return true;
      });
  } catch {
    return [];
  }
}
