/**
 * activities.service.js
 * Instructor activity lists for the new-report form.
 */

import { supabase } from '../api/client.js';
import {
  HEBREW_TO_DB_TYPE,
  getDbTypesForReportType,
  currentAttendanceActivitySeasons,
  normalizeDbActivityType,
  TRAINING_REPORT_TYPE,
} from './activities-report.helpers.js';
import { normalizeScheduledTraining } from './training-schedule.helpers.js';
import {
  getPreviewActivities,
  getPreviewAuthorities,
  isAdminPreviewRequested,
} from '../preview/preview-mode.js';
import {
  activityMatchesReportType,
  activitySearchHaystack,
} from './activities-report.helpers.js';
const ACTIVITY_CACHE_TTL_MS = 60_000;
const DIRECTORY_CACHE_TTL_MS = 5 * 60_000;
const activityCache = new Map();

function readActivityCache(key, ttl = ACTIVITY_CACHE_TTL_MS) {
  const entry = activityCache.get(key);
  if (!entry || Date.now() - entry.at > ttl) {
    if (entry) activityCache.delete(key);
    return null;
  }
  return entry.value;
}

function writeActivityCache(key, value) {
  activityCache.set(key, { at: Date.now(), value });
  return value;
}

export {
  ONLINE_REPORT_TYPE,
  TRAINING_REPORT_TYPE,
  OPERATIONS_REPORT_TYPE,
  NO_ACTIVITY_NAME_REPORT_TYPES,
  OPEN_FIELD_REPORT_TYPES,
  HEBREW_TO_DB_TYPE,
  HEBREW_ACTIVITY_TYPES,
  TRAINING_DB_ACTIVITY_TYPES,
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
  attendanceTimesFromActivity,
} from './activities-report.helpers.js';

function isTrainingSearch(reportType) {
  return String(reportType || '').trim() === TRAINING_REPORT_TYPE;
}

function canonicalRowMatchesReportType(activity, reportType) {
  const dbTypes = getDbTypesForReportType(reportType);
  if (dbTypes === null) return true;
  if (!dbTypes.length) return false;
  return dbTypes.includes(normalizeDbActivityType(activity?.activity_type));
}

function toTrainingCatalogRows(rows = [], reportType = '') {
  if (!isTrainingSearch(reportType)) return Array.isArray(rows) ? rows : [];

  const seenNames = new Set();
  const result = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const name = String(row?.activity_name || row?.program_name || '').trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase('he-IL');
    if (seenNames.has(key)) continue;
    seenNames.add(key);

    // Training is selected by course/tour content name, not by a specific school assignment.
    // Use a synthetic row identity so the new-report screen never resolves the instructor's
    // assigned activity instance and therefore never imports that instance's location metadata.
    result.push({
      ...row,
      id: null,
      row_id: `training-catalog:${key}`,
      activity_name: name,
      program_name: String(row?.program_name || name).trim() || name,
      activity_no: null,
      authority_id: null,
      authority_name: '',
      authority: '',
      single_school_id: null,
      single_school_name: '',
      single_semel_mosad: null,
      school: '',
      school_link_status: 'authority_or_place_only',
      linked_schools_json: [],
      start_time: '',
      end_time: '',
      __attendanceTrainingCatalog: true,
    });
  }
  return result;
}

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
  if (isAdminPreviewRequested()) return getPreviewActivities();

  const seasons = currentAttendanceActivitySeasons(referenceDateStr);
  const key = `instructor|${empId}|${seasons.join(',')}`;
  const cached = readActivityCache(key);
  if (cached) return cached;

  try {
    const { data, error } = await supabase.rpc('av2_get_instructor_activities', {
      p_emp_id: empId,
      p_activity_seasons: seasons,
    });
    if (!error && Array.isArray(data)) return writeActivityCache(key, data);
  } catch {
    // RPC not deployed yet
  }
  return writeActivityCache(key, await aggregateActivitiesFromDateRpc(empId, seasons));
}

export async function searchCanonicalActivities({
  query = '',
  reportType = '',
  referenceDateStr,
  limit = 50,
} = {}) {
  const trainingSearch = isTrainingSearch(reportType);
  const effectiveLimit = trainingSearch ? Math.max(Number(limit) || 0, 1000) : limit;

  if (isAdminPreviewRequested()) {
    const q = String(query || '').trim().toLowerCase();
    const rows = getPreviewActivities()
      .filter((activity) => canonicalRowMatchesReportType(activity, reportType))
      .filter((activity) => !q || activitySearchHaystack(activity).includes(q));
    return toTrainingCatalogRows(rows, reportType).slice(0, effectiveLimit);
  }

  const dbTypes = getDbTypesForReportType(reportType);
  const seasons = currentAttendanceActivitySeasons(referenceDateStr);
  try {
    const { data, error } = await supabase.rpc('av2_search_canonical_activities', {
      p_query: query,
      p_activity_types: dbTypes,
      p_activity_seasons: seasons,
      p_limit: effectiveLimit,
    });
    if (!error && Array.isArray(data)) {
      return toTrainingCatalogRows(data, reportType).slice(0, effectiveLimit);
    }
  } catch {
    // RPC not deployed yet
  }
  return [];
}

export async function getInstructorActivitiesForDate(empId, dateStr) {
  if (isAdminPreviewRequested()) return getPreviewActivities();

  const key = `date|${empId}|${dateStr}`;
  const cached = readActivityCache(key);
  if (cached) return cached;

  const { data, error } = await supabase.rpc('av2_get_instructor_activities_for_date', {
    p_emp_id: empId,
    p_date:   dateStr,
  });
  if (error) throw new Error(`שגיאה בטעינת פעילויות: ${error.message}`);
  return writeActivityCache(key, Array.isArray(data) ? data : []);
}

export async function getTrainingScheduleForDate(empId, dateStr) {
  if (!empId || !dateStr || isAdminPreviewRequested()) return [];
  const { data, error } = await supabase
    .from('instructor_training_schedule')
    .select('id,training_date,course_id,course_name,start_time,end_time,is_online,location_name,location_address,participant_scope')
    .eq('training_date', dateStr)
    .eq('is_active', true)
    .or(`emp_id.eq.${Number(empId)},participant_scope.eq.open`);
  if (error) throw new Error(`שגיאה בטעינת הכשרות: ${error.message}`);
  return (data || []).map(normalizeScheduledTraining);
}

export async function getMeetingNoForActivityOnDate(empId, activityRowId, dateStr) {
  if (!empId || !activityRowId || !dateStr) return null;
  if (isAdminPreviewRequested()) {
    const match = getPreviewActivities().find(
      (row) => String(row?.row_id || '').trim() === String(activityRowId).trim(),
    );
    return match?.meeting_no ?? null;
  }
  try {
    const rows = await getInstructorActivitiesForDate(empId, dateStr);
    const match = rows.find((row) => String(row?.row_id || '').trim() === String(activityRowId).trim());
    return match?.meeting_no ?? null;
  } catch {
    return null;
  }
}

export async function getAuthoritySchoolList(empId) {
  if (isAdminPreviewRequested()) return getPreviewAuthorities();

  const { data, error } = await supabase.rpc('av2_get_authority_school_list', {
    p_emp_id: empId,
  });
  if (error) throw new Error(`שגיאה בטעינת רשויות: ${error.message}`);
  return Array.isArray(data) ? data : [];
}

export async function getAllAuthoritySchoolList(empId) {
  if (isAdminPreviewRequested()) return getPreviewAuthorities();

  const key = `authorities|${empId}`;
  const cached = readActivityCache(key, DIRECTORY_CACHE_TTL_MS);
  if (cached) return cached;

  try {
    const { data, error } = await supabase.rpc('av2_get_all_authority_school_list');
    if (!error && Array.isArray(data) && data.length > 0) return writeActivityCache(key, data);
  } catch {}
  return writeActivityCache(key, await getAuthoritySchoolList(empId));
}

export async function getActivityNamesByType(hebrewType) {
  if (!hebrewType) return [];
  const dbType = HEBREW_TO_DB_TYPE[hebrewType];
  if (!dbType) return [];

  if (isAdminPreviewRequested()) {
    const seen = new Set();
    return getPreviewActivities()
      .filter((row) => String(row.activity_type || '') === dbType)
      .map((row) => row.activity_name || '')
      .filter((name) => name && !seen.has(name) && seen.add(name))
      .map((name) => ({ value: name, label: name }));
  }

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
