import { supabase } from '../supabase-client.js';

const text = (value) => String(value ?? '').trim();
const idOf = (row) => text(row?.row_id || row?.RowID || row?.id);

function activityVersion(activity = {}) {
  return text(activity?.updated_at);
}

function instructorIdsFromPlanningEntry(entry = {}) {
  const ids = new Set();
  const add = (value) => {
    const id = text(value);
    if (id) ids.add(id);
  };
  add(entry?.lockedOption?.instructorEmpId);
  add(entry?.row?.instructorEmpId);
  for (const option of entry?.row?.options || []) add(option?.instructorEmpId);
  return ids;
}

function instructorIdsFromActivity(activity = {}) {
  return new Set([
    text(activity?.emp_id),
    text(activity?.emp_id_2),
    text(activity?.draft_emp_id)
  ].filter(Boolean));
}

export async function loadSharedPlanningWorkspace({ periodKey = 'year', district = '' } = {}) {
  const { data, error } = await supabase.rpc('get_scheduling_planning_workspace', {
    p_period_key: text(periodKey) || 'year',
    p_district: text(district)
  });
  if (error) throw error;
  const rawRows = Array.isArray(data?.rows) ? data.rows : [];
  return {
    workspace: data?.workspace || null,
    rows: rawRows.map((item) => ({
      activityId: text(item?.activityId),
      row: item?.row && typeof item.row === 'object' ? item.row : {},
      activityUpdatedAt: text(item?.activityUpdatedAt),
      lockedOption: item?.lockedOption && typeof item.lockedOption === 'object' ? item.lockedOption : null,
      lockedAt: text(item?.lockedAt),
      lockedBy: text(item?.lockedBy),
      needsRecalc: item?.needsRecalc === true
    })).filter((item) => item.activityId)
  };
}

export function sharedPlanningLocks(shared = {}) {
  const locks = {};
  for (const item of shared?.rows || []) {
    if (item?.activityId && item?.lockedOption) locks[item.activityId] = item.lockedOption;
  }
  return locks;
}

export function sharedPlanningAffectedCourseIds({
  shared = {},
  activities = [],
  currentCourseIds = [],
  contextChanged = false
} = {}) {
  const currentIds = new Set((currentCourseIds || []).map(text).filter(Boolean));
  if (contextChanged) return [...currentIds];

  const activityById = new Map((activities || []).map((activity) => [idOf(activity), activity]));
  const sharedById = new Map((shared?.rows || []).map((entry) => [text(entry.activityId), entry]));
  const changed = new Set(
    (shared?.rows || [])
      .filter((entry) => entry?.needsRecalc === true)
      .map((entry) => text(entry.activityId))
      .filter((courseId) => currentIds.has(courseId))
  );
  const affectedInstructorIds = new Set();

  for (const courseId of currentIds) {
    const activity = activityById.get(courseId);
    const entry = sharedById.get(courseId);
    if (!activity || !entry || activityVersion(activity) !== text(entry.activityUpdatedAt)) {
      changed.add(courseId);
      for (const empId of instructorIdsFromActivity(activity)) affectedInstructorIds.add(empId);
      for (const empId of instructorIdsFromPlanningEntry(entry)) affectedInstructorIds.add(empId);
    }
  }

  if (!affectedInstructorIds.size) return [...changed];

  for (const entry of shared?.rows || []) {
    const courseId = text(entry.activityId);
    if (!courseId || !currentIds.has(courseId) || changed.has(courseId)) continue;
    const ids = instructorIdsFromPlanningEntry(entry);
    if ([...ids].some((id) => affectedInstructorIds.has(id))) changed.add(courseId);
  }

  return [...changed];
}

export async function saveSharedPlanningSnapshot({
  periodKey = 'year',
  district = '',
  engineVersion = '',
  dataFingerprint = '',
  contextFingerprint = '',
  rows = [],
  activities = [],
  expectedRevision = null
} = {}) {
  const activityById = new Map((activities || []).map((activity) => [idOf(activity), activity]));
  const payloadRows = (rows || []).map((row) => {
    const activityId = text(row?.courseId);
    const activity = activityById.get(activityId);
    return {
      activityId,
      row,
      activityUpdatedAt: activityVersion(activity) || null
    };
  }).filter((item) => item.activityId);

  const { data, error } = await supabase.rpc('save_scheduling_planning_snapshot', {
    p_period_key: text(periodKey) || 'year',
    p_district: text(district),
    p_engine_version: text(engineVersion),
    p_data_fingerprint: text(dataFingerprint),
    p_context_fingerprint: text(contextFingerprint),
    p_rows: payloadRows,
    p_expected_revision: Number.isFinite(Number(expectedRevision)) ? Number(expectedRevision) : null
  });
  if (error) throw error;
  return data || null;
}

export async function saveSharedPlanningLock({
  periodKey = 'year',
  district = '',
  activityId = '',
  option = null,
  expectedRevision = null
} = {}) {
  const { data, error } = await supabase.rpc('set_scheduling_planning_lock', {
    p_period_key: text(periodKey) || 'year',
    p_district: text(district),
    p_activity_id: text(activityId),
    p_option: option,
    p_expected_revision: Number.isFinite(Number(expectedRevision)) ? Number(expectedRevision) : null
  });
  if (error) throw error;
  return data || null;
}

export async function clearSharedPlanningWorkspace({
  periodKey = 'year',
  district = '',
  expectedRevision = null
} = {}) {
  const { data, error } = await supabase.rpc('clear_scheduling_planning_workspace', {
    p_period_key: text(periodKey) || 'year',
    p_district: text(district),
    p_expected_revision: Number.isFinite(Number(expectedRevision)) ? Number(expectedRevision) : null
  });
  if (error) throw error;
  return data || null;
}

export function planningStoreErrorMessage(error, fallback = 'שמירת התכנון נכשלה') {
  const raw = text(error?.message || error);
  if (raw.includes('planning_revision_conflict')) return 'התכנון עודכן במקביל על ידי משתמש אחר. רעננו את התכנון המשותף ונסו שוב.';
  if (raw.includes('planning_activity_changed')) return 'נתוני הפעילויות השתנו בזמן החישוב. המערכת לא דרסה את השינויים — יש לעדכן רק את הפעילויות שהשתנו.';
  if (raw.includes('scheduling_permission_denied')) return 'אין הרשאה לעדכן את התכנון המשותף.';
  return raw ? `${fallback}: ${raw}` : fallback;
}
