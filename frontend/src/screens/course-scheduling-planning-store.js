import { supabase } from '../supabase-client.js';
import { schedulingCalendarMeetings } from './instructor-scheduling-load.js';
import {
  auditStoredPlanningHardGates,
  expectedPlanningMeetingCount
} from './course-scheduling-date-adjustments.js';
import { normalizeCalendarSector } from './shared/school-calendar-logic.js';

const text = (value) => String(value ?? '').trim();
const idOf = (row) => text(row?.row_id || row?.RowID || row?.id);

/** Activity fields that affect shared course planning / instructor matching. */
export const PLANNING_SCHEDULING_FIELD_KEYS = Object.freeze([
  'required_instructor_gender',
  'instruction_language',
  'start_date',
  'end_date',
  'start_time',
  'end_time',
  'sessions',
  'school',
  'school_id',
  'authority',
  'authority_id',
  'activity_name',
  'activity_no',
  'gefen_number',
  'status',
  'emp_id',
  'emp_id_2',
  'instructor_name',
  'instructor_name_2',
  'draft_emp_id'
]);

export function isPlanningSchedulingFieldKey(key = '') {
  const name = text(key);
  return PLANNING_SCHEDULING_FIELD_KEYS.includes(name) || /^date_(?:[1-9]|[12]\d|3[0-5])$/.test(name);
}

/**
 * Detect whether a full row or a changes-payload touches scheduling-sensitive fields.
 * When `before` is null/undefined, any scheduling key present in `afterOrChanges` counts.
 */
export function activitySchedulingFieldsChanged(before = null, afterOrChanges = {}) {
  const next = afterOrChanges && typeof afterOrChanges === 'object' ? afterOrChanges : {};
  const keys = Object.keys(next).filter(isPlanningSchedulingFieldKey);
  if (!keys.length) return false;
  if (!before || typeof before !== 'object') return true;
  return keys.some((key) => text(before[key]) !== text(next[key]));
}
const ACTIVITY_NO_ALIASES = Object.freeze({ '82835': '53828' });
function canonicalPlanningActivityNo(value) {
  const raw = text(value);
  return ACTIVITY_NO_ALIASES[raw] || raw;
}

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
  for (const meeting of entry?.lockedOption?.meetings || []) add(meeting?.substituteEmpId);
  for (const meeting of entry?.row?.meetings || []) add(meeting?.substituteEmpId);
  for (const option of entry?.row?.options || []) {
    add(option?.instructorEmpId);
    for (const meeting of option?.meetings || []) add(meeting?.substituteEmpId);
  }
  for (const row of entry?.lockedOption?.singleMeetingSubstitutions || []) add(row?.substituteEmpId);
  for (const row of entry?.row?.singleMeetingSubstitutions || []) add(row?.substituteEmpId);
  return ids;
}

function instructorIdsFromActivity(activity = {}) {
  return new Set([
    text(activity?.emp_id),
    text(activity?.emp_id_2),
    text(activity?.draft_emp_id)
  ].filter(Boolean));
}

function meetingsFromPlanningEntry(entry = {}, activity = null) {
  const meetings = [];
  const push = (list = []) => {
    for (const meeting of list || []) {
      const date = text(meeting?.date).slice(0, 10);
      if (!date) continue;
      meetings.push({
        date,
        start: text(meeting?.start_time || activity?.start_time).slice(0, 5),
        end: text(meeting?.end_time || activity?.end_time).slice(0, 5)
      });
    }
  };
  push(entry?.lockedOption?.meetings);
  if (!meetings.length) push(entry?.row?.meetings);
  if (!meetings.length && activity) {
    push(schedulingCalendarMeetings(activity).map((meeting) => ({
      date: meeting?.date,
      start_time: meeting?.start_time || activity.start_time,
      end_time: meeting?.end_time || activity.end_time
    })));
  }
  return meetings;
}

function slotKey(meeting = {}) {
  return [text(meeting.date).slice(0, 10), text(meeting.start).slice(0, 5), text(meeting.end).slice(0, 5)]
    .filter(Boolean)
    .join('|');
}

function activityProgramKeys(activity = {}) {
  return [
    canonicalPlanningActivityNo(activity?.activity_no),
    text(activity?.pricing_key),
    canonicalPlanningActivityNo(activity?.gefen_number),
    text(activity?.activity_name || activity?.program_name)
  ].map(text).filter(Boolean);
}

function datesOverlapWindow(dates = [], window = {}) {
  const start = text(window?.start).slice(0, 10);
  const end = text(window?.end || window?.start).slice(0, 10);
  if (!start) return false;
  const endBound = end || start;
  return (dates || []).some((date) => date >= start && date <= endBound);
}

function sectorMatchesActivity(window = {}, activity = {}) {
  const windowSector = normalizeCalendarSector(window?.sector) || 'general';
  if (!windowSector || windowSector === 'general') return true;
  const activitySector = normalizeCalendarSector(activity?.calendar_sector);
  return !activitySector || activitySector === windowSector;
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
  contextDiff = null,
  unrecoverableGlobalContextChange = false,
  contextChanged = false
} = {}) {
  const currentIds = new Set((currentCourseIds || []).map(text).filter(Boolean));
  // Structural fallback only when the impact scope cannot be recovered safely.
  // A plain contextChanged flag must never expand to a full run by itself.
  if (unrecoverableGlobalContextChange === true) return [...currentIds];
  void contextChanged;

  const activityById = new Map((activities || []).map((activity) => [idOf(activity), activity]));
  const sharedById = new Map((shared?.rows || []).map((entry) => [text(entry.activityId), entry]));
  const changed = new Set(
    (shared?.rows || [])
      .filter((entry) => entry?.needsRecalc === true)
      .map((entry) => text(entry.activityId))
      .filter((courseId) => currentIds.has(courseId))
  );

  const directActivityIds = new Set();
  const affectedInstructorIds = new Set();
  const affectedSlotKeys = new Set();
  const affectedDatesByInstructor = new Map();

  const rememberInstructorDates = (empIds, meetings) => {
    for (const empId of empIds || []) {
      if (!empId) continue;
      affectedInstructorIds.add(empId);
      const bucket = affectedDatesByInstructor.get(empId) || new Set();
      for (const meeting of meetings || []) {
        const date = text(meeting?.date).slice(0, 10);
        if (date) bucket.add(date);
      }
      affectedDatesByInstructor.set(empId, bucket);
    }
  };

  for (const courseId of currentIds) {
    const activity = activityById.get(courseId);
    const entry = sharedById.get(courseId);
    if (!activity || !entry || activityVersion(activity) !== text(entry.activityUpdatedAt)) {
      changed.add(courseId);
      directActivityIds.add(courseId);
      const meetings = meetingsFromPlanningEntry(entry, activity);
      for (const meeting of meetings) {
        const key = slotKey(meeting);
        if (key) affectedSlotKeys.add(key);
      }
      rememberInstructorDates(instructorIdsFromActivity(activity), meetings);
      rememberInstructorDates(instructorIdsFromPlanningEntry(entry), meetings);
    }
  }

  const diff = contextDiff && typeof contextDiff === 'object' ? contextDiff : null;
  if (diff) {
    for (const empId of [
      ...(diff.changedInstructorProfileIds || []),
      ...(diff.changedAvailabilityInstructorIds || []),
      ...(diff.changedExceptionInstructorIds || [])
    ].map(text).filter(Boolean)) {
      affectedInstructorIds.add(empId);
    }
  }

  if (affectedInstructorIds.size) {
    for (const entry of shared?.rows || []) {
      const courseId = text(entry.activityId);
      if (!courseId || !currentIds.has(courseId)) continue;
      const activity = activityById.get(courseId);
      const ids = new Set([
        ...instructorIdsFromPlanningEntry(entry),
        ...instructorIdsFromActivity(activity)
      ]);
      if (![...ids].some((id) => affectedInstructorIds.has(id))) continue;
      changed.add(courseId);
      // Instructor context changes only invalidate rows that reference that instructor.
      // Same-slot expansion is reserved for direct activity edits below.
      if (directActivityIds.has(courseId)) {
        const meetings = meetingsFromPlanningEntry(entry, activity);
        for (const meeting of meetings) {
          const key = slotKey(meeting);
          if (key) affectedSlotKeys.add(key);
        }
        rememberInstructorDates(ids, meetings);
      }
    }
  }

  if (diff?.changedCalendarWindows?.length) {
    for (const entry of shared?.rows || []) {
      const courseId = text(entry.activityId);
      if (!courseId || !currentIds.has(courseId) || changed.has(courseId)) continue;
      const activity = activityById.get(courseId);
      const meetings = meetingsFromPlanningEntry(entry, activity);
      const dates = meetings.map((meeting) => meeting.date);
      const hit = (diff.changedCalendarWindows || []).some((window) =>
        sectorMatchesActivity(window, activity) && datesOverlapWindow(dates, window)
      );
      if (hit) changed.add(courseId);
    }
  }

  if (diff?.changedCatalogKeys?.length) {
    const catalogKeys = new Set((diff.changedCatalogKeys || []).map(text).filter(Boolean));
    for (const courseId of currentIds) {
      if (changed.has(courseId)) continue;
      const activity = activityById.get(courseId);
      if (!activity) continue;
      if (activityProgramKeys(activity).some((key) => catalogKeys.has(key))) changed.add(courseId);
    }
  }

  // Same-instructor same-day / same-slot dependents of directly changed activities only.
  if (directActivityIds.size) {
    for (const entry of shared?.rows || []) {
      const courseId = text(entry.activityId);
      if (!courseId || !currentIds.has(courseId) || changed.has(courseId)) continue;
      const activity = activityById.get(courseId);
      const meetings = meetingsFromPlanningEntry(entry, activity);
      if (meetings.some((meeting) => affectedSlotKeys.has(slotKey(meeting)))) {
        changed.add(courseId);
        continue;
      }
      const ids = new Set([
        ...instructorIdsFromPlanningEntry(entry),
        ...instructorIdsFromActivity(activity)
      ]);
      for (const empId of ids) {
        const dates = affectedDatesByInstructor.get(empId);
        if (!dates?.size) continue;
        if (meetings.some((meeting) => dates.has(meeting.date))) {
          changed.add(courseId);
          break;
        }
      }
    }
  }

  return [...changed];
}

export async function loadSharedPlanningCheckpoint({
  periodKey = 'year',
  district = '',
  engineVersion = '',
  dataFingerprint = '',
  contextFingerprint = ''
} = {}) {
  const { data, error } = await supabase.rpc('get_scheduling_planning_checkpoint', {
    p_period_key: text(periodKey) || 'year',
    p_district: text(district),
    p_engine_version: text(engineVersion),
    p_data_fingerprint: text(dataFingerprint),
    p_context_fingerprint: text(contextFingerprint)
  });
  if (error) throw error;
  if (!data) return null;
  return {
    completedCount: Math.max(0, Number(data.completedCount) || 0),
    totalCount: Math.max(0, Number(data.totalCount) || 0),
    completedActivityIds: Array.isArray(data.completedActivityIds)
      ? data.completedActivityIds.map(text).filter(Boolean)
      : [],
    rows: Array.isArray(data.rows) ? data.rows : [],
    updatedAt: text(data.updatedAt)
  };
}

export async function saveSharedPlanningCheckpoint({
  periodKey = 'year',
  district = '',
  engineVersion = '',
  dataFingerprint = '',
  contextFingerprint = '',
  completedCount = 0,
  totalCount = 0,
  completedActivityIds = [],
  rows = []
} = {}) {
  const { data, error } = await supabase.rpc('save_scheduling_planning_checkpoint', {
    p_period_key: text(periodKey) || 'year',
    p_district: text(district),
    p_engine_version: text(engineVersion),
    p_data_fingerprint: text(dataFingerprint),
    p_context_fingerprint: text(contextFingerprint),
    p_completed_count: Math.max(0, Number(completedCount) || 0),
    p_total_count: Math.max(0, Number(totalCount) || 0),
    p_completed_activity_ids: (completedActivityIds || []).map(text).filter(Boolean),
    p_rows: Array.isArray(rows) ? rows : []
  });
  if (error) throw error;
  return data || null;
}

export async function clearSharedPlanningCheckpoint({
  periodKey = 'year',
  district = ''
} = {}) {
  const { data, error } = await supabase.rpc('clear_scheduling_planning_checkpoint', {
    p_period_key: text(periodKey) || 'year',
    p_district: text(district)
  });
  if (error) throw error;
  return data === true;
}

export async function upgradeSharedPlanningContextFingerprint({
  periodKey = 'year',
  district = '',
  contextFingerprint = '',
  expectedRevision = null
} = {}) {
  const { data, error } = await supabase.rpc('upgrade_scheduling_planning_context_fingerprint', {
    p_period_key: text(periodKey) || 'year',
    p_district: text(district),
    p_context_fingerprint: text(contextFingerprint),
    p_expected_revision: expectedRevision == null
      ? null
      : (Number.isFinite(Number(expectedRevision)) ? Number(expectedRevision) : null)
  });
  if (error) throw error;
  return data || null;
}

export async function saveSharedPlanningSnapshot({
  periodKey = 'year',
  district = '',
  engineVersion = '',
  dataFingerprint = '',
  contextFingerprint = '',
  rows = [],
  activities = [],
  expectedRevision = null,
  replaceAll = false
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
    p_expected_revision: expectedRevision == null
      ? null
      : (Number.isFinite(Number(expectedRevision)) ? Number(expectedRevision) : null),
    p_replace_all: replaceAll === true
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

export async function confirmSharedPlanningDraft({
  periodKey = 'year',
  district = '',
  activityId = '',
  expectedRevision = null
} = {}) {
  const { data, error } = await supabase.rpc('confirm_scheduling_planning_draft', {
    p_period_key: text(periodKey) || 'year',
    p_district: text(district),
    p_activity_id: text(activityId),
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
  if (raw.includes('planning_draft_missing')) return 'הטיוטה כבר השתנתה או בוטלה. המערכת תרענן את ההצעות.';
  if (raw.includes('planning_draft_stale_needs_recalc')) return 'התכנון השמור אינו תקף מול הנתונים החיים. יש לעדכן את הפעילות לפני אישור.';
  if (raw.includes('scheduling_draft_exists')) return 'כבר קיימת טיוטת שיבוץ לפעילות. יש לפתוח אותה לפני אישור תכנון אחר.';
  if (raw.includes('planning_draft_variable_hours_unsupported')) return 'בטיוטה שנבחרה יש שעות שונות בין המפגשים ולכן נדרשת בדיקה ידנית.';
  if (raw.includes('planning_option_invalid_meetings')) return 'לא ניתן לשמור הצעה עם מפגש שאינו עומד בתנאי הסף של המדריך בפועל.';
  if (raw.includes('scheduling_permission_denied')) return 'אין הרשאה לעדכן את התכנון המשותף.';
  return raw ? `${fallback}: ${raw}` : fallback;
}

export function applyLocalPlanningNeedsRecalc(targetState = null, { activityIds = [] } = {}) {
  const localState = targetState;
  if (!localState) return [];
  const ids = [...new Set((activityIds || []).map(text).filter(Boolean))];
  if (!ids.length) return [...(localState.courseSchedulingPlanningAffectedIds || [])];

  const pending = new Set((localState.courseSchedulingPlanningAffectedIds || []).map(text).filter(Boolean));
  for (const activityId of ids) pending.add(activityId);
  localState.courseSchedulingPlanningAffectedIds = [...pending];

  const shared = localState.courseSchedulingPlanningShared;
  if (shared && Array.isArray(shared.rows)) {
    for (const entry of shared.rows) {
      if (ids.includes(text(entry?.activityId))) entry.needsRecalc = true;
    }
  }

  if (Array.isArray(localState.courseSchedulingPlanningRows)) {
    for (const row of localState.courseSchedulingPlanningRows) {
      if (!ids.includes(text(row?.courseId))) continue;
      if (row?.planningLocked) {
        row.planningLocked = false;
        row.kind = row.kind || 'proposal';
        row.status = 'ממתין לעדכון תכנון';
        row.reason = row.reason || 'נתוני הפעילות השתנו. הפעילות תתעדכן בהרצה המצומצמת הבאה.';
      }
    }
  }

  return localState.courseSchedulingPlanningAffectedIds;
}

export function notifyPlanningNeedsRecalc({
  activityId = '',
  affectedActivityIds = [],
  source = 'activity-save',
  state: targetState = null
} = {}) {
  const ids = [...new Set([text(activityId), ...(affectedActivityIds || []).map(text)].filter(Boolean))];
  if (targetState) applyLocalPlanningNeedsRecalc(targetState, { activityIds: ids });
  try {
    document.dispatchEvent(new CustomEvent('app:planning-needs-recalc', {
      detail: {
        activityId: text(activityId),
        affectedActivityIds: ids,
        source: text(source) || 'activity-save'
      }
    }));
  } catch {
    /* non-DOM environments (tests) still get optional local state updates */
  }
  return ids;
}

export { auditStoredPlanningHardGates, expectedPlanningMeetingCount };

export async function markSharedPlanningNeedsRecalcMany(activityIds = [], {
  requirePermission = true,
  notify = true,
  source = 'validity-audit',
  state: targetState = null
} = {}) {
  const ids = [...new Set((activityIds || []).map(text).filter(Boolean))];
  if (!ids.length) {
    return { markedActivityIds: [], affectedCount: 0, rowsTouched: 0, workspaceCount: 0 };
  }

  const { data, error } = await supabase.rpc('mark_scheduling_planning_needs_recalc_many', {
    p_activity_ids: ids,
    p_require_permission: requirePermission !== false
  });
  if (error) throw error;

  const markedActivityIds = Array.isArray(data?.markedActivityIds)
    ? data.markedActivityIds.map(text).filter(Boolean)
    : ids;
  const payload = {
    markedActivityIds: markedActivityIds.length ? markedActivityIds : ids,
    affectedCount: Math.max(0, Number(data?.affectedCount) || markedActivityIds.length || 0),
    rowsTouched: Math.max(0, Number(data?.rowsTouched) || 0),
    workspaceCount: Math.max(0, Number(data?.workspaceCount) || 0)
  };

  if (notify) {
    notifyPlanningNeedsRecalc({
      activityId: payload.markedActivityIds[0] || '',
      affectedActivityIds: payload.markedActivityIds,
      source,
      state: targetState
    });
  }
  return payload;
}

/**
 * Run the lightweight hard-gate audit on stored shared rows.
 * Marks only invalid rows dirty (local + optional DB), never the full workspace.
 */
export function applyStoredPlanningValidityAudit(targetState = null, {
  shared = null,
  activities = [],
  instructors = [],
  profiles = {},
  rules = {},
  exceptions = {},
  schoolCalendar = [],
  assignments = {},
  persist = false
} = {}) {
  const sharedState = shared || targetState?.courseSchedulingPlanningShared || { rows: [] };
  const audit = auditStoredPlanningHardGates({
    shared: sharedState,
    activities,
    instructors,
    profiles,
    rules,
    exceptions,
    schoolCalendar,
    assignments
  });
  const invalidIds = audit.invalidActivityIds || [];
  if (invalidIds.length && Array.isArray(sharedState?.rows)) {
    for (const entry of sharedState.rows) {
      if (invalidIds.includes(text(entry?.activityId))) entry.needsRecalc = true;
    }
  }
  if (targetState && invalidIds.length) {
    applyLocalPlanningNeedsRecalc(targetState, { activityIds: invalidIds });
  }
  if (persist && invalidIds.length) {
    void markSharedPlanningNeedsRecalcMany(invalidIds, {
      source: 'validity-audit',
      state: targetState,
      notify: false
    }).catch(() => {
      /* local dirty state already applied */
    });
  }
  if (targetState) {
    targetState.courseSchedulingPlanningHardGateInvalidIds = invalidIds;
    targetState.courseSchedulingPlanningHardGateInvalidCount = invalidIds.length;
  }
  return audit;
}

export async function markSharedPlanningNeedsRecalc(activityId = '', {
  requirePermission = true,
  notify = true,
  source = 'activity-save',
  state: targetState = null
} = {}) {
  const id = text(activityId);
  if (!id) return { activityId: '', markedActivityIds: [], affectedCount: 0 };

  const { data, error } = await supabase.rpc('mark_scheduling_planning_needs_recalc', {
    p_activity_id: id,
    p_require_permission: requirePermission !== false
  });
  if (error) throw error;

  const markedActivityIds = Array.isArray(data?.markedActivityIds)
    ? data.markedActivityIds.map(text).filter(Boolean)
    : (id ? [id] : []);
  const payload = {
    activityId: text(data?.activityId) || id,
    markedActivityIds: markedActivityIds.length ? markedActivityIds : (id ? [id] : []),
    affectedCount: Math.max(0, Number(data?.affectedCount) || markedActivityIds.length || 0),
    rowsTouched: Math.max(0, Number(data?.rowsTouched) || 0),
    workspaceCount: Math.max(0, Number(data?.workspaceCount) || 0)
  };

  if (notify) {
    notifyPlanningNeedsRecalc({
      activityId: payload.activityId,
      affectedActivityIds: payload.markedActivityIds,
      source,
      state: targetState
    });
  }
  return payload;
}

/**
 * After a successful activity save that touched scheduling fields, invalidate
 * shared planning immediately (DB + local UI state). Never triggers a full recalculation.
 */
export async function invalidatePlanningAfterActivitySchedulingSave(activityId = '', {
  before = null,
  afterOrChanges = null,
  source = 'activity-save',
  state: targetState = null
} = {}) {
  const id = text(activityId);
  if (!id) return null;
  if (afterOrChanges != null && !activitySchedulingFieldsChanged(before, afterOrChanges)) {
    return null;
  }
  try {
    return await markSharedPlanningNeedsRecalc(id, { source, state: targetState });
  } catch (error) {
    // Optimistic local pending state even if the RPC is briefly unavailable;
    // the DB trigger (when present) still marks rows server-side.
    notifyPlanningNeedsRecalc({
      activityId: id,
      affectedActivityIds: [id],
      source,
      state: targetState
    });
    error.planningInvalidationFallback = true;
    throw error;
  }
}
