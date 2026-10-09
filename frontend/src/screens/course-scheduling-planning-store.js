import { compactPlanningWorkspace } from './course-scheduling-display-data.js';
import { planningPerfCount, planningPerfTimer } from './course-scheduling-perf.js';
import { supabase } from '../supabase-client.js';
import { activityMeetings, schedulingCalendarMeetings } from './instructor-scheduling-load.js';
import {
  auditStoredPlanningHardGates,
  expectedPlanningMeetingCount
} from './course-scheduling-date-adjustments.js';
import { normalizeCalendarSector } from './shared/school-calendar-logic.js';
import {
  decodeCheckpointPayload,
  planningCheckpointChunks
} from './course-scheduling-run-plan.js';

const text = (value) => String(value ?? '').trim();
const idOf = (row) => text(row?.row_id || row?.RowID || row?.id);
async function planningRpc(name, args) {
  planningPerfCount('dbRpcCalls');
  const stop = planningPerfTimer(`rpc:${name}`);
  try { return await supabase.rpc(name, args); } finally { stop(); }
}


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
  for (const id of entry?.row?.dependencyInstructorIds || []) add(id);
  for (const meeting of entry?.lockedOption?.meetings || []) add(meeting?.substituteEmpId);
  for (const meeting of entry?.row?.meetings || []) add(meeting?.substituteEmpId);
  for (const option of entry?.row?.options || []) {
    add(option?.instructorEmpId);
    for (const meeting of option?.meetings || []) add(meeting?.substituteEmpId);
  }
  for (const option of entry?.row?.packingOptions || []) {
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
  push(entry?.row?.meetings);
  push(entry?.row?.dependencySlots);
  for (const option of entry?.row?.options || []) push(option?.meetings);
  for (const option of entry?.row?.packingOptions || []) push(option?.meetings);
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

export async function loadSchedulingPlanningPreflight({ periodKey = 'year', district = '' } = {}) {
  const { data, error } = await planningRpc('get_scheduling_planning_preflight', {
    p_period_key: text(periodKey) || 'year', p_district: text(district)
  });
  if (error) throw error;
  return data;
}

export async function acquireSchedulingPlanningRunLease({
  periodKey = 'year',
  district = '',
  runId = '',
  ttlSeconds = 120
} = {}) {
  const run_id = text(runId);
  if (!run_id) throw new Error('planning_run_id_required');
  const { data, error } = await planningRpc('acquire_scheduling_planning_run_lease', {
    p_period_key: text(periodKey) || 'year',
    p_district: text(district),
    p_run_id: run_id,
    p_ttl_seconds: Number.isFinite(Number(ttlSeconds)) ? Number(ttlSeconds) : 120
  });
  if (error) throw error;
  return data && typeof data === 'object' ? data : { acquired: false };
}

export async function heartbeatSchedulingPlanningRunLease({
  periodKey = 'year',
  district = '',
  runId = '',
  ttlSeconds = 120
} = {}) {
  const run_id = text(runId);
  if (!run_id) return { ok: false, reason: 'planning_run_id_required' };
  const { data, error } = await planningRpc('heartbeat_scheduling_planning_run_lease', {
    p_period_key: text(periodKey) || 'year',
    p_district: text(district),
    p_run_id: run_id,
    p_ttl_seconds: Number.isFinite(Number(ttlSeconds)) ? Number(ttlSeconds) : 120
  });
  if (error) throw error;
  return data && typeof data === 'object' ? data : { ok: false };
}

export async function releaseSchedulingPlanningRunLease({
  periodKey = 'year',
  district = '',
  runId = ''
} = {}) {
  const run_id = text(runId);
  if (!run_id) return { released: false, reason: 'planning_run_id_required' };
  const { data, error } = await planningRpc('release_scheduling_planning_run_lease', {
    p_period_key: text(periodKey) || 'year',
    p_district: text(district),
    p_run_id: run_id
  });
  if (error) throw error;
  return data && typeof data === 'object' ? data : { released: false };
}

export async function loadSharedPlanningWorkspace({ periodKey = 'year', district = '' } = {}) {
  const { data, error } = await planningRpc('get_scheduling_planning_workspace', {
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
      needsRecalc: item?.needsRecalc === true,
      // null = server does not report flag time (pre-migration); '' = never stamped.
      needsRecalcMarkedAt: Object.prototype.hasOwnProperty.call(item || {}, 'needsRecalcMarkedAt')
        ? text(item.needsRecalcMarkedAt)
        : null
    })).filter((item) => item.activityId)
  };
}

/** Display reads use a read-only RPC; calculations always retain the full loader above. */
export async function loadSharedPlanningDisplayWorkspace({ periodKey = 'year', district = '' } = {}) {
  const { data, error } = await planningRpc('get_scheduling_planning_display_workspace', {
    p_period_key: text(periodKey) || 'year', p_district: text(district)
  });
  if (error) {
    // Safe compatibility before separately-approved migration deployment.
    if (!['PGRST202', '42883'].includes(error.code)) throw error;
    return compactPlanningWorkspace(await loadSharedPlanningWorkspace({ periodKey, district }));
  }
  return { ...data, displayOnly: true };
}
/** Read the RLS-protected version; use after a multi-request snapshot load. */
export async function assertSharedPlanningWorkspaceRevision({ workspaceId, expectedRevision } = {}) {
  const result = await supabase.from('scheduling_planning_workspaces').select('revision').eq('id', workspaceId).single();
  if (result.error) throw result.error;
  if (Number(result.data?.revision) !== Number(expectedRevision)) throw new Error('planning_revision_conflict');
}
export async function loadSharedPlanningRowDetails({ workspaceId, activityId, expectedRevision } = {}) {
  const { data, error } = await planningRpc('get_scheduling_planning_row_details', {
    p_workspace_id: workspaceId, p_activity_id: text(activityId), p_expected_revision: Number(expectedRevision)
  });
  if (error) {
    if (!['PGRST202', '42883'].includes(error.code)) throw error;
    // RLS-protected fallback; verify the workspace revision before and after.
    const revision = () => assertSharedPlanningWorkspaceRevision({ workspaceId, expectedRevision });
    await revision();
    const result = await supabase.from('scheduling_planning_rows').select('row_data').eq('workspace_id', workspaceId).eq('activity_id', text(activityId)).single();
    if (result.error) throw result.error;
    await revision();
    return result.data.row_data;
  }
  return data;
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
  // Incremental runs are driven only by explicit invalidation. Historical
  // route diagnostics are row metadata, not a reason to requeue the same missing
  // activities on every refresh. A deliberate full rebuild remains available.
  const changed = new Set(
    (shared?.rows || [])
      .filter((entry) => entry?.needsRecalc === true)
      .map((entry) => text(entry.activityId))
      .filter((courseId) => currentIds.has(courseId))
  );

  const directActivityIds = new Set();
  const contextInstructorIds = new Set();
  const affectedSlotKeys = new Set();
  const affectedDatesByInstructor = new Map();

  const rememberInstructorDates = (empIds, meetings) => {
    for (const empId of empIds || []) {
      if (!empId) continue;
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
      const meetings = [
        ...meetingsFromPlanningEntry(entry, activity),
        ...meetingsFromPlanningEntry({}, activity)
      ];
      const resourceIds = new Set([
        ...instructorIdsFromActivity(activity),
        ...instructorIdsFromPlanningEntry(entry)
      ]);
      rememberInstructorDates(resourceIds, meetings);
      // An unassigned row does not occupy a resource. Its provisional dates must
      // not invalidate every other unassigned row with the same default dates.
      if (resourceIds.size) {
        for (const meeting of meetings) affectedSlotKeys.add(slotKey(meeting));
      }
    }
  }

  const diff = contextDiff && typeof contextDiff === 'object' ? contextDiff : null;
  if (diff) {
    for (const empId of [
      ...(diff.changedInstructorProfileIds || []),
      ...(diff.changedAvailabilityInstructorIds || []),
      ...(diff.changedExceptionInstructorIds || [])
    ].map(text).filter(Boolean)) {
      contextInstructorIds.add(empId);
    }
  }

  // Profile/availability edits can affect every draft for that instructor.
  // Activity edits below only affect drafts on the instructor's old/new dates.
  if (contextInstructorIds.size) {
    for (const entry of shared?.rows || []) {
      const courseId = text(entry.activityId);
      if (!courseId || !currentIds.has(courseId) || entry?.row?.kind === 'live') continue;
      const activity = activityById.get(courseId);
      const ids = new Set([
        ...instructorIdsFromPlanningEntry(entry),
        ...instructorIdsFromActivity(activity)
      ]);
      if ([...ids].some((id) => contextInstructorIds.has(id))) changed.add(courseId);
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

  // Shared dates alone do not create a resource dependency between unrelated instructors.
  if (directActivityIds.size) {
    for (const entry of shared?.rows || []) {
      const courseId = text(entry.activityId);
      if (!courseId || !currentIds.has(courseId) || changed.has(courseId) || entry?.row?.kind === 'live') continue;
      const activity = activityById.get(courseId);
      const meetings = meetingsFromPlanningEntry(entry, activity);
      const ids = new Set([
        ...instructorIdsFromPlanningEntry(entry),
        ...instructorIdsFromActivity(activity)
      ]);
      // No saved candidates: retain the conservative retry when an actual
      // instructor resource changed in this slot.
      if (!ids.size && meetings.some((meeting) => affectedSlotKeys.has(slotKey(meeting)))) {
        changed.add(courseId);
        continue;
      }
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

  return expandPlanningAffectedIdsBySchool({
    affectedIds: [...changed],
    shared,
    activities,
    currentCourseIds: [...currentIds]
  });
}

// Flags stamped this long before the run's server start time still count as
// "during the run": covers transactions that began before the preflight read.
export const PLANNING_REBASE_FLAG_MARGIN_MS = 120_000;

/**
 * True when a row that was already dirty at run start may have been flagged
 * again while the run was calculating (route change, meeting substitution,
 * approval upload, cancellation, school change…). Only a valid server flag
 * time that predates the run start (minus the safety margin) proves the run's
 * result is current. A missing, empty or unparsable flag time, or an unknown
 * run start, fails closed: the row is rechecked.
 */
export function planningRowReflaggedDuringRun(entry = null, runStartedAt = '') {
  if (entry?.needsRecalc !== true) return false;
  const markedAt = Date.parse(text(entry?.needsRecalcMarkedAt));
  const startedAt = Date.parse(text(runStartedAt));
  if (!Number.isFinite(markedAt) || !Number.isFinite(startedAt)) return true;
  return markedAt >= startedAt - PLANNING_REBASE_FLAG_MARGIN_MS;
}

/**
 * Source changed while a planning run was calculating. Instead of discarding
 * the whole result, derive the minimal dependency closure of what changed
 * between the run's start snapshot and the current one: activity versions,
 * instructor/availability/calendar/catalog context diff, rows the database
 * newly flagged needs_recalc, and rows that were dirty at start but flagged
 * again during the run (their result was built from inputs that are now stale).
 */
export function planningRebaseAffectedCourseIds({
  resultRows = [],
  startActivities = [],
  activities = [],
  currentCourseIds = [],
  contextDiff = null,
  startShared = null,
  currentShared = null,
  runStartedAt = ''
} = {}) {
  const startVersionById = new Map((startActivities || []).map((activity) => [idOf(activity), activityVersion(activity)]));
  const startDirty = new Set((startShared?.rows || [])
    .filter((entry) => entry?.needsRecalc === true)
    .map((entry) => text(entry.activityId)));
  const currentEntryById = new Map((currentShared?.rows || []).map((entry) => [text(entry?.activityId), entry]));
  const rows = (resultRows || [])
    .map((row) => {
      const activityId = text(row?.courseId);
      if (!activityId || !startVersionById.has(activityId)) return null;
      const current = currentEntryById.get(activityId);
      return {
        activityId,
        row,
        activityUpdatedAt: startVersionById.get(activityId),
        lockedOption: current?.lockedOption || null,
        needsRecalc: current?.needsRecalc === true
          && (!startDirty.has(activityId) || planningRowReflaggedDuringRun(current, runStartedAt))
      };
    })
    .filter(Boolean);
  return sharedPlanningAffectedCourseIds({
    shared: { workspace: currentShared?.workspace || null, rows },
    activities,
    currentCourseIds,
    contextDiff,
    unrecoverableGlobalContextChange: false
  });
}

export function expandPlanningAffectedIdsBySchool({
  affectedIds = [],
  shared = {},
  activities = [],
  currentCourseIds = null
} = {}) {
  const allowed = Array.isArray(currentCourseIds)
    ? new Set(currentCourseIds.map(text).filter(Boolean))
    : null;
  const activityById = new Map((activities || []).map((activity) => [idOf(activity), activity]));
  const entryById = new Map((shared?.rows || []).map((entry) => [text(entry?.activityId), entry]));
  const result = new Set((affectedIds || []).map(text).filter((id) => id && (!allowed || allowed.has(id))));
  // Close school + instructor/date edges transitively. A school peer may
  // introduce a different instructor whose activities are in another school.
  const metadata = new Map(), schools = new Map(), resources = new Map();
  const index = (map, key, id) => { if (!map.has(key)) map.set(key, new Set()); map.get(key).add(id); };
  for (const courseId of new Set([...entryById.keys(), ...activityById.keys()])) {
    const entry = entryById.get(courseId) || {};
    if (allowed && !allowed.has(courseId)) continue;
    const activity = activityById.get(courseId), row = entry.row || {};
    const school = text(activity?.school_id || row.schoolId);
    const ids = new Set([...instructorIdsFromActivity(activity), ...instructorIdsFromPlanningEntry(entry)]);
    const dates = new Set(meetingsFromPlanningEntry(entry, activity).map(m => m.date));
    const immutable = !!text(activity?.emp_id) || !!entry.lockedOption || row.planningLocked === true || row.schoolDateAnchored === true
      || ['live', 'fixed', 'fixed-proposal'].includes(text(row.kind));
    const keys = [...ids].flatMap(id => dates.size ? [...dates].map(date => id + '|' + date) : [id + '|*']);
    metadata.set(courseId, { school, keys, immutable });
    if (school) index(schools, school, courseId);
    for (const key of keys) index(resources, key, courseId);
    for (const id of ids) index(resources, id + '|all', courseId);
  }
  const queue = [...result];
  const visited = new Set(result);
  const include = (id) => {
    if (visited.has(id)) return;
    visited.add(id); queue.push(id);
    // Immutable rows remain dependency bridges, never movable work targets.
    if (!metadata.get(id)?.immutable) result.add(id);
  };
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const item = metadata.get(queue[cursor]);
    if (!item) continue;
    for (const id of schools.get(item.school) || []) include(id);
    for (const key of item.keys) {
      const empId = key.split('|')[0];
      const matches = key.endsWith('|*') ? resources.get(empId + '|all') : resources.get(key);
      for (const id of matches || []) include(id);
      for (const id of resources.get(empId + '|*') || []) include(id);
    }
  }
  return [...result];
}

export async function loadSharedPlanningCheckpoint({
  periodKey = 'year',
  district = '',
  engineVersion = '',
  dataFingerprint = '',
  contextFingerprint = ''
} = {}) {
  const { data, error } = await planningRpc('get_scheduling_planning_checkpoint', {
    p_period_key: text(periodKey) || 'year',
    p_district: text(district),
    p_engine_version: text(engineVersion),
    p_data_fingerprint: text(dataFingerprint),
    p_context_fingerprint: text(contextFingerprint)
  });
  if (error) throw error;
  if (!data) return null;
  return decodeCheckpointPayload({
    completedCount: Math.max(0, Number(data.completedCount) || 0),
    totalCount: Math.max(0, Number(data.totalCount) || 0),
    completedActivityIds: Array.isArray(data.completedActivityIds)
      ? data.completedActivityIds.map(text).filter(Boolean)
      : [],
    rows: Array.isArray(data.rows) ? data.rows : [],
    updatedAt: text(data.updatedAt)
  });
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
  rows = [],
  meta = null,
  assertActive = null,
  runId = null, sourceRevision = null
} = {}) {
  const rpcArgs = {
    p_run_id: runId || null,
    p_source_revision: sourceRevision == null ? null : String(sourceRevision),
    p_period_key: text(periodKey) || 'year', p_district: text(district),
    p_engine_version: text(engineVersion), p_data_fingerprint: text(dataFingerprint),
    p_context_fingerprint: text(contextFingerprint),
    p_completed_count: Math.max(0, Number(completedCount) || 0),
    p_total_count: Math.max(0, Number(totalCount) || 0),
    p_completed_activity_ids: (completedActivityIds || []).map(text).filter(Boolean)
  };
  let saved = null;
  for (const args of planningCheckpointChunks({rows,meta,rpcArgs})) {
    assertActive?.();
    const { data, error } = await planningRpc('save_scheduling_planning_checkpoint', args);
    if (error) throw error;
    assertActive?.();
    planningPerfCount('checkpointChunks');
    planningPerfCount('checkpointWireBytes', new TextEncoder().encode(JSON.stringify(args)).length);
    saved = data || null;
  }
  return saved;
}

export async function clearSharedPlanningCheckpoint({
  periodKey = 'year',
  district = '',
  runId = null, sourceRevision = null
} = {}) {
  const { data, error } = await planningRpc('clear_scheduling_planning_checkpoint', {
    p_period_key: text(periodKey) || 'year',
    p_district: text(district),
    p_run_id: runId || null, p_source_revision: sourceRevision == null ? null : String(sourceRevision)
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
  const { data, error } = await planningRpc('upgrade_scheduling_planning_context_fingerprint', {
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

export async function saveSharedPlanningIncrementalSnapshot({
  periodKey = 'year',
  district = '',
  engineVersion = '',
  dataFingerprint = '',
  contextFingerprint = '',
  rows = [],
  removedActivityIds = [],
  activities = [],
  expectedRevision = null,
  runId = null, sourceRevision = null
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

  const { data, error } = await planningRpc('save_scheduling_planning_incremental_snapshot', {
    p_run_id: runId || null,
    p_source_revision: sourceRevision == null ? null : String(sourceRevision),
    p_period_key: text(periodKey) || 'year',
    p_district: text(district),
    p_engine_version: text(engineVersion),
    p_data_fingerprint: text(dataFingerprint),
    p_context_fingerprint: text(contextFingerprint),
    p_rows: payloadRows,
    p_removed_activity_ids: [...new Set((removedActivityIds || []).map(text).filter(Boolean))],
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
  runId = null, sourceRevision = null
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

  const { data, error } = await planningRpc('save_scheduling_planning_snapshot', {
    p_run_id: runId || null,
    p_source_revision: sourceRevision == null ? null : String(sourceRevision),
    p_period_key: text(periodKey) || 'year',
    p_district: text(district),
    p_engine_version: text(engineVersion),
    p_data_fingerprint: text(dataFingerprint),
    p_context_fingerprint: text(contextFingerprint),
    p_rows: payloadRows,
    p_expected_revision: expectedRevision == null
      ? null
      : (Number.isFinite(Number(expectedRevision)) ? Number(expectedRevision) : null)
  });
  if (error) throw error;
  return data || null;
}

export async function commitSharedPlanningCheckpoint({
  periodKey = 'year',
  district = '',
  engineVersion = '',
  dataFingerprint = '',
  contextFingerprint = '',
  expectedRevision = null,
  runId = null,
  sourceRevision = null
} = {}) {
  const { data, error } = await planningRpc('commit_scheduling_planning_checkpoint', {
    p_period_key: text(periodKey) || 'year',
    p_district: text(district),
    p_engine_version: text(engineVersion),
    p_data_fingerprint: text(dataFingerprint),
    p_context_fingerprint: text(contextFingerprint),
    p_expected_revision: expectedRevision == null
      ? null
      : (Number.isFinite(Number(expectedRevision)) ? Number(expectedRevision) : null),
    p_run_id: runId || null,
    p_source_revision: sourceRevision == null ? null : String(sourceRevision)
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
  const { data, error } = await planningRpc('set_scheduling_planning_lock', {
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
  const { data, error } = await planningRpc('confirm_scheduling_planning_draft', {
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
  const { data, error } = await planningRpc('clear_scheduling_planning_workspace', {
    p_period_key: text(periodKey) || 'year',
    p_district: text(district),
    p_expected_revision: Number.isFinite(Number(expectedRevision)) ? Number(expectedRevision) : null
  });
  if (error) throw error;
  return data || null;
}

export function planningStoreErrorMessage(error, fallback = 'שמירת התכנון נכשלה') {
  const code = text(error?.code);
  const message = text(error?.message || error);
  const raw = code ? `${code}|${message}` : message;
  if (raw.includes('planning_final_validation_failed')) {
    const failure = Array.isArray(error?.failures) ? error.failures[0] : null;
    const reasonLabels = {
      overlap: 'חפיפה',
      full_day_tour_conflict: 'סיור יום מלא מתנגש בפעילות אחרת',
      availability_exception: 'חסימת תאריך של מדריך',
      weekly_unavailable: 'המדריך אינו זמין בשעה שנבחרה',
      transition_insufficient: 'אין מספיק זמן מעבר',
      transition_distance_exceeded: 'המרחק בין הפעילויות גדול מהמותר',
      school_calendar_blocked: 'תאריך חסום בלוח בית הספר',
      saturday_blocked: 'שבת אינה מותרת לפעילות'
    };
    if (failure) {
      const label = reasonLabels[text(failure.reason)] || text(failure.reason) || 'סתירה תפעולית';
      const parts = [
        label,
        text(failure.date),
        text(failure.empId) ? `מדריך ${text(failure.empId)}` : '',
        text(failure.firstCourseId) && text(failure.secondCourseId)
          ? `${text(failure.firstCourseId)} מול ${text(failure.secondCourseId)}`
          : text(failure.courseId)
      ].filter(Boolean);
      return `התכנון לא נשמר: ${parts.join(' · ')}`;
    }
    return 'התכנון לא נשמר כי בדיקת התוכנית המלאה מצאה סתירה תפעולית.';
  }
  if (raw.includes('planning_snapshot_incomplete') || raw.includes('school_calendar_unavailable') || raw.includes('school_calendar_session_missing')) return 'לא ניתן היה לקרוא את כל נתוני השיבוץ. יש לרענן את הנתונים ולנסות שוב.';
  if (raw.includes('planning_preflight_migration_required') || raw.includes('get_scheduling_planning_preflight')) return 'נדרשת התקנת עדכון מסד הנתונים של מנוע התכנון לפני הריצה.';
  if (raw.includes('planning_checkpoint_overlap_unrecoverable')) return 'נתוני השחזור של התכנון מכילים חפיפות שלא ניתן לתקן בבטחה. ההצעות השמורות נשמרו; יש לבדוק את מצב התכנון לפני הרצה נוספת.';
  if (raw.includes('planning_run_deadline_exceeded')) return 'חישוב התכנון חרג מחמש דקות ונעצר באופן בטוח. ההצעות השמורות לא נמחקו; נדרש טיפול ממוקד לפני הרצה נוספת.';
  if (raw.includes('planning_run_ownership_lost')) return 'הריצה איבדה בעלות על התכנון. התוצאה לא נשמרה; ניתן לבדוק שוב את מצב התכנון.';
  if (raw.includes('planning_source_revision_conflict')) return 'נתוני השיבוץ השתנו בזמן החישוב. התוצאה לא נשמרה; יש לעדכן את השינויים.';
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
      row.needsRecalc = true;
      row.planningLocked = false;
      row.kind = row.kind || 'proposal';
      row.status = 'נדרש עדכון תכנון';
      row.reason = 'ההצעה השמורה אינה עדכנית. יש לעדכן את התכנון לפני בחירה או אישור.';
    }
  }

  return localState.courseSchedulingPlanningAffectedIds;
}

/** Auto-refresh is only for small point/scoped sets — never a silent full rebuild. */
export const AUTO_PLANNING_REFRESH_MAX_IDS = 12;


function planningClockMinutes(value = '') {
  const match = text(value).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  return hours * 60 + minutes;
}

function planningMeetingWeekdays(row = {}) {
  const days = new Set();
  for (const meeting of row?.meetings || []) {
    const date = text(meeting?.date).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (Number.isInteger(day)) days.add(day);
  }
  return days;
}

function planningRecruitmentHasRescueSchedule(row = {}) {
  const sources = Array.isArray(row?.scheduleOptions) && row.scheduleOptions.length
    ? row.scheduleOptions
    : [row];
  return sources.some((option) => (option?.meetings || []).some((meeting) => {
    const start = planningClockMinutes(meeting?.start_time || option?.startTime);
    const end = planningClockMinutes(meeting?.end_time || option?.endTime);
    return /^\d{4}-\d{2}-\d{2}$/.test(text(meeting?.date).slice(0, 10))
      && start != null
      && end != null
      && end > start;
  }));
}

function planningActivityHasSourceDate(activity = {}) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(text(activity?.start_date).slice(0, 10))) return true;
  if ((activity?.meetings || []).some((meeting) => /^\d{4}-\d{2}-\d{2}$/.test(text(meeting?.date).slice(0, 10)))) return true;
  return Object.entries(activity || {}).some(([key, value]) =>
    /^date_\d+$/.test(key)
    && /^\d{4}-\d{2}-\d{2}$/.test(text(value).slice(0, 10))
  );
}

/**
 * A large engine upgrade is saved in two independently validated commits:
 * a hard-gate-valid base plan, then optional workload optimizations.
 * The engine marker is intentionally NOT current until stage two commits,
 * and must not be treated as a v35 -> v35 no-op.
 */
export const PLANNING_BASE_STAGE_PENDING_SUFFIX = '--base-saved-opt-pending';
export function planningBaseStageEngineVersion(currentEngineVersion = '') {
  return text(currentEngineVersion) + PLANNING_BASE_STAGE_PENDING_SUFFIX;
}
export function isPlanningBaseStagePending(storedEngineVersion = '', currentEngineVersion = '') {
  return !!text(currentEngineVersion)
    && text(storedEngineVersion) === planningBaseStageEngineVersion(currentEngineVersion);
}
export function shouldStageLargePlanningUpgrade({
  engineChanged = false,
  storedEngineVersion = '',
  currentEngineVersion = '',
  runType = '',
  baseRecalculationCount = 0,
  minCourses = 40
} = {}) {
  return engineChanged === true
    && runType === 'engine-upgrade'
    && !isPlanningBaseStagePending(storedEngineVersion, currentEngineVersion)
    && Number(baseRecalculationCount) >= minCourses;
}

export function planningEngineUpgradeOptimizationScopes({
  shared = {},
  activities = [],
  storedEngineVersion = '',
  currentEngineVersion = ''
} = {}) {
  const previous = text(storedEngineVersion);
  const current = text(currentEngineVersion);
  if (isPlanningBaseStagePending(previous, current)) {
    // Only movable rows are eligible for stage-two improvements. This is
    // deliberately a separate transaction over the VALIDATED saved base.
    // Already-live, anchored and manually locked classes are immutable.
    const activityById = new Map((activities || []).map((a) => [idOf(a), a]));
    const flexible = (shared?.rows || []).filter((entry) => {
      const row = entry?.row || {};
      const kind = text(row.kind);
      const activity = activityById.get(text(entry?.activityId)) || {};
      return ['proposal','missing','recruitment'].includes(kind)
        && !entry?.lockedOption && row?.planningLocked !== true
        && row?.schoolDateAnchored !== true
        && !planningActivityHasSourceDate(activity);
    });
    const bySchool = new Map();
    const schoolPackingCourseIds = new Set();
    const recruitmentRecoveryCourseIds = new Set();
    const workdayConsolidationCourseIds = new Set();
    for (const entry of flexible) {
      const row = entry.row || {};
      const id = text(entry.activityId || row.courseId);
      if (!id) continue;
      const schoolId = text(row.schoolId || activityById.get(id)?.school_id);
      if (schoolId) {
        if (!bySchool.has(schoolId)) bySchool.set(schoolId, []);
        bySchool.get(schoolId).push(id);
      }
      if (['missing','recruitment'].includes(text(row.kind))) recruitmentRecoveryCourseIds.add(id);
      if (text(row.kind) === 'proposal' && text(row.instructorEmpId)) workdayConsolidationCourseIds.add(id);
    }
    for (const ids of bySchool.values()) if (ids.length > 1) {
      for (const id of ids) schoolPackingCourseIds.add(id);
    }
    const affectedIds = new Set([
      ...schoolPackingCourseIds, ...recruitmentRecoveryCourseIds, ...workdayConsolidationCourseIds
    ]);
    return {
      affectedIds: [...affectedIds],
      schoolPackingCourseIds: [...schoolPackingCourseIds],
      recruitmentRecoveryCourseIds: [...recruitmentRecoveryCourseIds],
      workdayConsolidationCourseIds: [...workdayConsolidationCourseIds]
    };
  }
  const v28FromV27 = current.includes('planning-v28-20261004-anchor-safe-global-reassignment')
    && previous.includes('planning-v27-20261004-school-first-economic-alternatives');
  if (!v28FromV27) return null;

  const activityById = new Map((activities || []).map((activity) => [idOf(activity), activity]));
  const storedRows = (shared?.rows || []).map((entry) => ({ entry, row: entry?.row || {} }));
  const openDaysByInstructor = new Map();
  for (const { row } of storedRows) {
    const empId = text(row?.instructorEmpId);
    if (!empId) continue;
    const days = openDaysByInstructor.get(empId) || new Set();
    for (const day of planningMeetingWeekdays(row)) days.add(day);
    openDaysByInstructor.set(empId, days);
  }

  const movableBySchool = new Map();
  const recruitmentRecoveryIds = new Set();
  const workdayConsolidationIds = new Set();
  for (const { entry, row } of storedRows) {
    const courseId = text(entry?.activityId || row?.courseId);
    const activity = activityById.get(courseId) || {};
    const schoolId = text(row?.schoolId || activity?.school_id);
    if (!courseId || !['proposal', 'recruitment'].includes(text(row?.kind))) continue;
    if (
      entry?.lockedOption
      || row?.planningLocked === true
      || row?.schoolDateAnchored === true
      || planningActivityHasSourceDate(activity)
    ) continue;
    if (schoolId) {
      const bucket = movableBySchool.get(schoolId) || [];
      bucket.push(courseId);
      movableBySchool.set(schoolId, bucket);
    }

    if (text(row?.kind) === 'recruitment') {
      if (planningRecruitmentHasRescueSchedule(row)) recruitmentRecoveryIds.add(courseId);
      continue;
    }

    const empId = text(row?.instructorEmpId);
    const courseDays = planningMeetingWeekdays(row);
    if (!empId || !courseDays.size) continue;
    const sameInstructorDaysElsewhere = new Set();
    for (const { entry: otherEntry, row: other } of storedRows) {
      const otherCourseId = text(otherEntry?.activityId || other?.courseId);
      if (otherCourseId === courseId || text(other?.instructorEmpId) !== empId) continue;
      for (const day of planningMeetingWeekdays(other)) sameInstructorDaysElsewhere.add(day);
    }
    const opensOnlyNewDays = [...courseDays].every((day) => !sameInstructorDaysElsewhere.has(day));
    const hasExistingOpenDay = [...openDaysByInstructor.entries()].some(([candidateEmpId, days]) =>
      (candidateEmpId !== empId || days.size > courseDays.size)
      && days.size > 0
    );
    if (opensOnlyNewDays && hasExistingOpenDay) workdayConsolidationIds.add(courseId);
  }

  const schoolPackingIds = new Set();
  for (const ids of movableBySchool.values()) {
    if (ids.length >= 2) ids.forEach((courseId) => schoolPackingIds.add(courseId));
  }
  const affectedIds = new Set([
    ...schoolPackingIds,
    ...recruitmentRecoveryIds,
    ...workdayConsolidationIds
  ]);
  return {
    affectedIds: [...affectedIds],
    schoolPackingCourseIds: [...schoolPackingIds],
    recruitmentRecoveryCourseIds: [...recruitmentRecoveryIds],
    workdayConsolidationCourseIds: [...workdayConsolidationIds]
  };
}

/**
 * Engine upgrades must not silently become national recalculations.
 *
 * Each known optimization-only upgrade declares the smallest stored-row scope
 * that can actually benefit. v22 -> v23 only adds intra-day idle-gap
 * compaction, so only flexible proposals that share at least one calendar day
 * with another activity of the same instructor need re-evaluation.
 */
export function planningEngineUpgradeAffectedCourseIds({
  shared = {},
  activities = [],
  storedEngineVersion = '',
  currentEngineVersion = ''
} = {}) {
  const previous = text(storedEngineVersion);
  const current = text(currentEngineVersion);
  if (!previous || !current || previous === current) return [];

  const previousMajor = Number(previous.match(/planning-v(\d+)/)?.[1]) || 0;
  const currentMajor = Number(current.match(/planning-v(\d+)/)?.[1]) || 0;

  // v36 repairs proven official date/time drift. Valid incumbents require an explicit
  // validation-only marker upgrade, not a fresh national candidate search.
  if (currentMajor === 36 && previousMajor > 0 && previousMajor < 36) {
    const byId = new Map(activities.map(a => [idOf(a), a]));
    const affected = [];
    for (const entry of shared.rows || []) {
      const row = entry.row || {}, id = text(entry.activityId || row.courseId);
      if (!['fixed-proposal', 'proposal'].includes(row.kind) || entry.lockedOption || row.planningLocked || row.schoolDateAnchored) continue;
      const activity = byId.get(id);
      if (!activity || text(activity.emp_id)) continue;
      for (const [index, original] of activityMeetings(activity).entries()) {
        const number = Number(original.meeting_no) || index + 1;
        const meeting = (row.meetings || []).find((m,i) => (Number(m.meeting_no) || i+1) === number);
        const date = text(original.date).slice(0, 10);
        const start = text(original.start_time || activity.start_time).slice(0, 5);
        const end = text(original.end_time || activity.end_time).slice(0, 5);
        if (!meeting || text(meeting.date).slice(0,10) !== date
          || (start && text(meeting.start_time || row.startTime).slice(0,5) !== start)
          || (end && text(meeting.end_time || row.endTime).slice(0,5) !== end)) {
          affected.push(id); break;
        }
      }
    }
    return expandPlanningAffectedIdsBySchool({ affectedIds: affected, shared, activities });
  }

  // v29 changes outcome semantics, not the schedule of already-valid proposals:
  // recruitment is now a certified terminal result, while timed-out / bounded
  // searches remain unresolved. Re-evaluate only rows whose terminal outcome can
  // change instead of forcing a national rebuild of valid proposals and live rows.
  const certifiedOutcomeV29Upgrade = currentMajor === 29 && previousMajor > 0 && previousMajor < 29;
  if (certifiedOutcomeV29Upgrade) {
    return (shared?.rows || [])
      .filter((entry) => {
        const row = entry?.row || {};
        if (!['recruitment', 'missing'].includes(text(row?.kind))) return false;
        if (entry?.lockedOption || row?.planningLocked === true) return false;
        return !!text(entry?.activityId || row?.courseId);
      })
      .map((entry) => text(entry?.activityId || entry?.row?.courseId))
      .filter(Boolean);
  }

  // v30 closes the remaining outcome hole in school-first packing. The packing
  // optimizer is allowed to improve dates/instructor combinations, but it may
  // never manufacture a terminal recruitment result. Re-run only unresolved
  // rows and legacy recruitment rows that lack an explicit certification.
  const certifiedSchoolPackingV30Upgrade = currentMajor === 30 && previousMajor === 29;
  if (certifiedSchoolPackingV30Upgrade) {
    return (shared?.rows || [])
      .filter((entry) => {
        const row = entry?.row || {};
        const kind = text(row?.kind);
        if (kind !== 'missing' && kind !== 'recruitment') return false;
        if (kind === 'recruitment' && row?.diagnostics?.recruitmentCertified === true) return false;
        if (entry?.lockedOption || row?.planningLocked === true) return false;
        return !!text(entry?.activityId || row?.courseId);
      })
      .map((entry) => text(entry?.activityId || entry?.row?.courseId))
      .filter(Boolean);
  }

  // v31 bounds expensive rescue work once an incremental/upgrade run contains
  // many unresolved rows. Revisit only unresolved or uncertified outcomes; the
  // planner itself applies one shared rescue budget for the whole batch.
  const boundedBulkRescueV31Upgrade = currentMajor === 31
    && previousMajor >= 29
    && previousMajor < 31;
  if (boundedBulkRescueV31Upgrade) {
    return (shared?.rows || [])
      .filter((entry) => {
        const row = entry?.row || {};
        const kind = text(row?.kind);
        if (kind !== 'missing' && kind !== 'recruitment') return false;
        if (kind === 'recruitment' && row?.diagnostics?.recruitmentCertified === true) return false;
        if (entry?.lockedOption || row?.planningLocked === true) return false;
        return !!text(entry?.activityId || row?.courseId);
      })
      .map((entry) => text(entry?.activityId || entry?.row?.courseId))
      .filter(Boolean);
  }

  // v32 changes the objective from workload balancing to maximum use of
  // each instructor's declared availability. Re-evaluate every non-live,
  // non-user-locked outcome. Rows with source dates are included: their dates
  // remain hard anchors while instructor allocation is recalculated around them.
  const maximizeAvailabilityV32Upgrade = currentMajor === 32
    && previousMajor > 0
    && previousMajor < 32;
  if (maximizeAvailabilityV32Upgrade) {
    return (shared?.rows || [])
      .filter((entry) => {
        const row = entry?.row || {};
        const kind = text(row?.kind);
        if (!['proposal', 'fixed-proposal', 'recruitment', 'missing', 'fixed'].includes(kind)) return false;
        if (entry?.lockedOption || row?.planningLocked === true) return false;
        return !!text(entry?.activityId || row?.courseId);
      })
      .map((entry) => text(entry?.activityId || entry?.row?.courseId))
      .filter(Boolean);
  }

  const manualExceptionHandlingV33Upgrade = currentMajor === 33
    && previousMajor > 0
    && previousMajor < 33;
  if (manualExceptionHandlingV33Upgrade) {
    return (shared?.rows || [])
      .filter((entry) => {
        const row = entry?.row || {};
        const kind = text(row?.kind);
        if (!['proposal', 'fixed-proposal', 'recruitment', 'missing', 'fixed'].includes(kind)) return false;
        if (entry?.lockedOption || row?.planningLocked === true) return false;
        if (kind === 'recruitment' || kind === 'missing' || kind === 'fixed') return true;
        if ((row?.singleMeetingSubstitutions || []).length) return true;
        if ((row?.unresolvedInstructorExceptionDates || []).length) return true;
        return (row?.meetings || []).some((meeting) =>
          !!text(meeting?.substituteEmpId)
          || text(meeting?.constraintKind) === 'instructor_exception'
          || text(meeting?.constraintKind) === 'instructor_exception_manual'
        );
      })
      .map((entry) => text(entry?.activityId || entry?.row?.courseId))
      .filter(Boolean);
  }

  // v34 replaces manual exception handling with weekly cascade recovery.
  // Revisit every non-live, non-user-locked planning outcome once so skipped
  // v32/v33 upgrades also inherit the utilization objective and the new date rule.
  const weeklyExceptionShiftV34Upgrade = currentMajor === 34
    && previousMajor > 0
    && previousMajor < 34;
  if (weeklyExceptionShiftV34Upgrade) {
    return (shared?.rows || [])
      .filter((entry) => {
        const row = entry?.row || {};
        const kind = text(row?.kind);
        if (!['proposal', 'fixed-proposal', 'recruitment', 'missing', 'fixed'].includes(kind)) return false;
        if (entry?.lockedOption || row?.planningLocked === true) return false;
        return !!text(entry?.activityId || row?.courseId);
      })
      .map((entry) => text(entry?.activityId || entry?.row?.courseId))
      .filter(Boolean);
  }

  // v35 preserves still-valid incumbent proposals whenever a replacement
  // search is bounded/incomplete. Revisit all movable outcomes once so older
  // engine snapshots cannot retain the v34 coverage-loss behavior.
  const incumbentFallbackV35Upgrade = currentMajor === 35
    && previousMajor > 0
    && previousMajor < 35;
  if (incumbentFallbackV35Upgrade) {
    return (shared?.rows || [])
      .filter((entry) => {
        const row = entry?.row || {};
        const kind = text(row?.kind);
        if (!['proposal', 'fixed-proposal', 'recruitment', 'missing', 'fixed'].includes(kind)) return false;
        if (entry?.lockedOption || row?.planningLocked === true) return false;
        return !!text(entry?.activityId || row?.courseId);
      })
      .map((entry) => text(entry?.activityId || entry?.row?.courseId))
      .filter(Boolean);
  }

  const skippedStructuralUpgrade = currentMajor >= 27 && previousMajor > 0 && previousMajor < 27;
  if (skippedStructuralUpgrade) {
    return (shared?.rows || [])
      .filter((entry) => {
        const row = entry?.row || {};
        if (!['proposal', 'recruitment'].includes(text(row?.kind))) return false;
        if (entry?.lockedOption || row?.planningLocked === true || row?.schoolDateAnchored === true) return false;
        return !!text(entry?.activityId || row?.courseId);
      })
      .map((entry) => text(entry?.activityId || entry?.row?.courseId))
      .filter(Boolean);
  }

  const v28Scopes = planningEngineUpgradeOptimizationScopes({
    shared,
    activities,
    storedEngineVersion,
    currentEngineVersion
  });
  if (v28Scopes) return v28Scopes.affectedIds;

  const schoolFirstEconomicV27Upgrade = current.includes('planning-v27-20261004-school-first-economic-alternatives')
    && !previous.includes('planning-v27-20261004-school-first-economic-alternatives');
  if (schoolFirstEconomicV27Upgrade) {
    return (shared?.rows || [])
      .filter((entry) => {
        const row = entry?.row || {};
        if (!['proposal', 'recruitment'].includes(text(row?.kind))) return false;
        if (entry?.lockedOption || row?.planningLocked === true || row?.schoolDateAnchored === true) return false;
        return !!text(entry?.activityId || row?.courseId);
      })
      .map((entry) => text(entry?.activityId || entry?.row?.courseId))
      .filter(Boolean);
  }

  const coherentV26Upgrade = current.includes('planning-v26-20261003-coherent-school-first')
    && !previous.includes('planning-v26-20261003-coherent-school-first');
  if (coherentV26Upgrade) {
    return (shared?.rows || [])
      .filter((entry) => {
        const row = entry?.row || {};
        if (text(row?.kind) !== 'proposal') return false;
        if (entry?.lockedOption || row?.planningLocked === true || row?.schoolDateAnchored === true) return false;
        return !!text(entry?.activityId || row?.courseId);
      })
      .map((entry) => text(entry?.activityId || entry?.row?.courseId))
      .filter(Boolean);
  }

  const schoolPackingUpgrade = (
    previous.includes('planning-v23-20261001-idle-gap-compaction')
      && current.includes('planning-v24-20261003-school-day-packing')
  ) || (
    previous.includes('planning-v24-20261003-school-day-packing')
      && current.includes('planning-v25-20261003-school-packing-option-coverage')
  );
  if (schoolPackingUpgrade) {
    const activityById = new Map((activities || []).map((activity) => [idOf(activity), activity]));
    const flexibleBySchool = new Map();
    for (const entry of shared?.rows || []) {
      const row = entry?.row || {};
      const courseId = text(entry?.activityId || row?.courseId);
      const schoolId = text(row?.schoolId || activityById.get(courseId)?.school_id);
      if (!courseId || !schoolId || text(row?.kind) !== 'proposal') continue;
      if (entry?.lockedOption || row?.planningLocked === true || row?.schoolDateAnchored === true) continue;
      const bucket = flexibleBySchool.get(schoolId) || [];
      bucket.push(courseId);
      flexibleBySchool.set(schoolId, bucket);
    }
    return [...flexibleBySchool.values()].filter((ids) => ids.length >= 2).flat();
  }

  const idleGapUpgrade = previous.includes('planning-v22-20261001-workday-consolidation')
    && current.includes('planning-v23-20261001-idle-gap-compaction');
  if (!idleGapUpgrade) return [];

  const meetingsByInstructorDate = new Map();
  for (const entry of shared?.rows || []) {
    const row = entry?.row || {};
    const empId = text(row?.instructorEmpId);
    const courseId = text(entry?.activityId || row?.courseId);
    if (!empId || !courseId) continue;
    for (const meeting of row?.meetings || []) {
      const date = text(meeting?.date).slice(0, 10);
      const start = planningClockMinutes(meeting?.start_time);
      const end = planningClockMinutes(meeting?.end_time);
      if (!date || start == null || end == null || end <= start) continue;
      const key = `${empId}|${date}`;
      const bucket = meetingsByInstructorDate.get(key) || [];
      bucket.push({ courseId, start, end });
      meetingsByInstructorDate.set(key, bucket);
    }
  }

  const affected = new Set();
  for (const entry of shared?.rows || []) {
    const row = entry?.row || {};
    const courseId = text(entry?.activityId || row?.courseId);
    const empId = text(row?.instructorEmpId);
    if (!courseId || !empId) continue;
    if (text(row?.kind) !== 'proposal') continue;
    if (entry?.lockedOption || row?.planningLocked === true || row?.schoolDateAnchored === true) continue;

    for (const meeting of row?.meetings || []) {
      const date = text(meeting?.date).slice(0, 10);
      const start = planningClockMinutes(meeting?.start_time);
      const end = planningClockMinutes(meeting?.end_time);
      if (!date || start == null || end == null) continue;
      const neighbors = meetingsByInstructorDate.get(`${empId}|${date}`) || [];
      const hasClockGap = neighbors.some((neighbor) =>
        neighbor.courseId !== courseId
        && (
          (neighbor.end <= start && start - neighbor.end > 0)
          || (neighbor.start >= end && neighbor.start - end > 0)
        )
      );
      if (hasClockGap) {
        affected.add(courseId);
        break;
      }
    }
  }
  return [...affected];
}

export function planningEngineUpgradeExecutionScopes({
  regularAffectedIds = [],
  engineUpgradeAffectedIds = [],
  storedEngineVersion = '',
  currentEngineVersion = ''
} = {}) {
  const regular = [...new Set((regularAffectedIds || []).map(text).filter(Boolean))];
  const upgrade = [...new Set((engineUpgradeAffectedIds || []).map(text).filter(Boolean))];
  const affectedIds = [...new Set([...regular, ...upgrade])];
  const previous = text(storedEngineVersion);
  const current = text(currentEngineVersion);
  const v28OptimizationUpgrade = isPlanningBaseStagePending(previous, current)
    || (current.includes('planning-v28-20261004-anchor-safe-global-reassignment')
      && previous.includes('planning-v27-20261004-school-first-economic-alternatives'));

  // v28 changed optimization passes over an already valid snapshot. Treating
  // those rows as ordinary dirty activities would regenerate every proposal
  // before the optimizer even runs. Keep true source/context changes in the
  // base queue and let the v28 passes operate directly on the saved rows.
  return {
    affectedIds,
    baseRecalculationIds: v28OptimizationUpgrade ? regular : affectedIds,
    upgradeOptimizationIds: v28OptimizationUpgrade ? upgrade : [],
    v28OptimizationUpgrade
  };
}

export function shouldAutoRefreshPlanning(affectedIds = []) {
  const ids = [...new Set((affectedIds || []).map(text).filter(Boolean))];
  return ids.length > 0 && ids.length <= AUTO_PLANNING_REFRESH_MAX_IDS;
}

/**
 * True dependents for a point mutation (assign / reassign / lock).
 * Draft/proposal rows that share the old/new instructor on overlapping dates only.
 */
export function pointMutationDependentCourseIds({
  shared = {},
  activities = [],
  activityId = '',
  oldInstructorIds = [],
  newInstructorIds = [],
  meetingDates = null
} = {}) {
  const sourceId = text(activityId);
  const resourceIds = new Set([
    ...((oldInstructorIds || []).map(text).filter(Boolean)),
    ...((newInstructorIds || []).map(text).filter(Boolean))
  ]);
  const activityById = new Map((activities || []).map((activity) => [idOf(activity), activity]));
  const sourceActivity = activityById.get(sourceId) || null;
  if (sourceActivity) {
    for (const empId of instructorIdsFromActivity(sourceActivity)) resourceIds.add(empId);
  }
  const sourceEntry = (shared?.rows || []).find((entry) => text(entry?.activityId) === sourceId) || null;
  if (sourceEntry) {
    for (const empId of instructorIdsFromPlanningEntry(sourceEntry)) resourceIds.add(empId);
  }

  const dates = new Set(
    (Array.isArray(meetingDates) ? meetingDates : [])
      .map((value) => text(value).slice(0, 10))
      .filter(Boolean)
  );
  if (!dates.size) {
    for (const meeting of meetingsFromPlanningEntry(sourceEntry, sourceActivity)) {
      if (meeting.date) dates.add(meeting.date);
    }
    if (sourceActivity) {
      for (const meeting of schedulingCalendarMeetings(sourceActivity)) {
        const date = text(meeting?.date).slice(0, 10);
        if (date) dates.add(date);
      }
    }
  }

  const dependents = new Set();
  if (sourceId) dependents.add(sourceId);
  if (!resourceIds.size) return expandPlanningAffectedIdsBySchool({
    affectedIds: [...dependents], shared, activities
  });

  for (const entry of shared?.rows || []) {
    const courseId = text(entry?.activityId);
    if (!courseId || courseId === sourceId) continue;
    if (text(entry?.row?.kind) === 'live') continue;
    if (entry?.lockedOption) continue;
    const activity = activityById.get(courseId);
    const ids = new Set([
      ...instructorIdsFromPlanningEntry(entry),
      ...instructorIdsFromActivity(activity)
    ]);
    if (![...ids].some((empId) => resourceIds.has(empId))) continue;
    const meetings = meetingsFromPlanningEntry(entry, activity);
    if (!dates.size || meetings.some((meeting) => dates.has(meeting.date))) {
      dependents.add(courseId);
    }
  }
  return expandPlanningAffectedIdsBySchool({
    affectedIds: [...dependents], shared, activities
  });
}

export function notifyPlanningNeedsRecalc({
  activityId = '',
  affectedActivityIds = [],
  source = 'activity-save',
  autoRefresh = null,
  state: targetState = null
} = {}) {
  const ids = [...new Set([text(activityId), ...(affectedActivityIds || []).map(text)].filter(Boolean))];
  if (targetState) applyLocalPlanningNeedsRecalc(targetState, { activityIds: ids });
  const refresh = autoRefresh == null ? shouldAutoRefreshPlanning(ids) : !!autoRefresh;
  try {
    document.dispatchEvent(new CustomEvent('app:planning-needs-recalc', {
      detail: {
        activityId: text(activityId),
        affectedActivityIds: ids,
        source: text(source) || 'activity-save',
        autoRefresh: refresh
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
  const activities = targetState?.courseSchedulingActivities || targetState?.activities || [];
  const ids = targetState?.courseSchedulingPlanningShared
    ? expandPlanningAffectedIdsBySchool({
        affectedIds: activityIds,
        shared: targetState.courseSchedulingPlanningShared,
        activities
      })
    : [...new Set((activityIds || []).map(text).filter(Boolean))];
  if (!ids.length) {
    return { markedActivityIds: [], affectedCount: 0, rowsTouched: 0, workspaceCount: 0 };
  }

  const { data, error } = await planningRpc('mark_scheduling_planning_needs_recalc_many', {
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

  const { data, error } = await planningRpc('mark_scheduling_planning_needs_recalc', {
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
 * shared planning immediately (DB + local UI state). Small point mutations
 * request auto incremental refresh via the planning screen listener.
 */
export async function invalidatePlanningAfterActivitySchedulingSave(activityId = '', {
  before = null,
  afterOrChanges = null,
  source = 'activity-save',
  state: targetState = null,
  shared = null
} = {}) {
  const id = text(activityId);
  if (!id) return null;
  if (afterOrChanges != null && !activitySchedulingFieldsChanged(before, afterOrChanges)) {
    return null;
  }
  const sharedState = shared || targetState?.courseSchedulingPlanningShared || null;
  const activities = targetState?.courseSchedulingActivities
    || targetState?.activities
    || [];
  const oldInstructorIds = before ? [...instructorIdsFromActivity(before)] : [];
  const newInstructorIds = afterOrChanges && typeof afterOrChanges === 'object'
    ? [...instructorIdsFromActivity({ ...(before || {}), ...afterOrChanges })]
    : [];
  const dependents = sharedState
    ? pointMutationDependentCourseIds({
      shared: sharedState,
      activities,
      activityId: id,
      oldInstructorIds,
      newInstructorIds
    })
    : [id];

  try {
    const payload = await markSharedPlanningNeedsRecalc(id, {
      source,
      state: targetState,
      notify: false
    });
    const marked = [...new Set([
      ...(payload?.markedActivityIds || []),
      ...dependents
    ].map(text).filter(Boolean))];
    const additionallyDirty = marked.filter((courseId) => !(payload?.markedActivityIds || []).includes(courseId));
    if (additionallyDirty.length) {
      await markSharedPlanningNeedsRecalcMany(additionallyDirty, {
        source: `${source}-school-siblings`,
        state: targetState,
        notify: false
      });
    }
    notifyPlanningNeedsRecalc({
      activityId: id,
      affectedActivityIds: marked,
      source,
      autoRefresh: shouldAutoRefreshPlanning(marked),
      state: targetState
    });
    return { ...payload, markedActivityIds: marked, affectedCount: marked.length };
  } catch (error) {
    notifyPlanningNeedsRecalc({
      activityId: id,
      affectedActivityIds: dependents,
      source,
      autoRefresh: shouldAutoRefreshPlanning(dependents),
      state: targetState
    });
    error.planningInvalidationFallback = true;
    throw error;
  }
}
