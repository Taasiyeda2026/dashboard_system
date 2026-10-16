/**
 * Authoritative scheduling computation entrypoint for a dedicated server worker.
 *
 * This module has no Supabase client, browser globals, UI state or assignment
 * mutations. The *backend adapter* must load an atomic, authenticated snapshot
 * with current source/workspace revisions, verified travel routes and protected
 * assignments, then persist only validated plan proposals through the existing
 * fenced/lease-protected planning RPCs. This pure boundary cannot commit work.
 */
import {
  buildDynamicCoursePlan,
  PLANNING_ENGINE_VERSION,
  createPlanningCheckpoint
} from '../../frontend/src/screens/course-scheduling-planning.js';

import {applyPlanningIntents} from './planning-intents.mjs';

export class AgentPlanningInputError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AgentPlanningInputError';
    this.code = code;
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertNonEmptyRevision(value, field) {
  if (!/^\d+$/.test(String(value ?? ''))) {
    throw new AgentPlanningInputError(`invalid_${field}`);
  }
}

export function verifyAgentPlanningInput({
  snapshot,
  sourceRevision,
  workspaceRevision,
  mode = 'incremental',
  targetCourseIds = [],
  routeClient
} = {}) {
  if (!isObject(snapshot)) throw new AgentPlanningInputError('snapshot_required');
  for (const name of ['activities', 'instructors', 'profiles', 'rules', 'exceptions', 'schoolCalendar', 'catalog']) {
    if (!Array.isArray(snapshot[name]) && !isObject(snapshot[name])) {
      throw new AgentPlanningInputError(`missing_${name}`);
    }
  }
  assertNonEmptyRevision(sourceRevision, 'source_revision');
  assertNonEmptyRevision(workspaceRevision, 'workspace_revision');
  if (mode !== 'incremental' && mode !== 'full') {
    throw new AgentPlanningInputError('unsupported_planning_mode');
  }
  if (mode === 'incremental' && (!Array.isArray(targetCourseIds) || targetCourseIds.length === 0)) {
    throw new AgentPlanningInputError('incremental_affected_courses_required');
  }
  if (!Array.isArray(targetCourseIds) || targetCourseIds.some(id => typeof id !== 'string' || !id.trim())) {
    throw new AgentPlanningInputError('invalid_affected_courses');
  }
  if (!routeClient || typeof routeClient.peek !== 'function' || typeof routeClient.request !== 'function') {
    throw new AgentPlanningInputError('authoritative_route_client_required');
  }
  return Object.freeze({
    sourceRevision: String(sourceRevision),
    workspaceRevision: String(workspaceRevision),
    engineVersion: PLANNING_ENGINE_VERSION,
    mode,
    targetCourseIds: [...new Set(targetCourseIds)]
  });
}

/**
 * Calculate but NEVER write or confirm assignments.
 *
 * A runner must:
 * 1. authenticate caller and own a database lease;
 * 2. gather one consistent live snapshot and travel route cache;
 * 3. call this function;
 * 4. independently validate source/workspace revision and lease ownership;
 * 5. commit only planning rows atomically through the existing audited RPC.
 */
export function assertNoUnlocatedCourseAssignments(rows=[],missingSchoolCourseIds=[]) {
  const unresolved=new Set((missingSchoolCourseIds||[]).map(String));
  for (const row of rows) {
    if(!unresolved.has(String(row?.courseId||'')))continue;
    // Unlocated school can be a reported exception/recruitment requirement,
    // NEVER a firm or suggested instructor/route assignment.
    const assignmentPresent=Boolean(row?.instructorEmpId)
      || ['options','packingOptions','scheduleOptions'].some(k=>
         (Array.isArray(row?.[k])?row[k]:[]).some(o=>o?.instructorEmpId));
    if(assignmentPresent)throw new AgentPlanningInputError('unlocated_school_assignment_forbidden');
  }
}

export async function computeAgentSchedulingPlan({
  snapshot,
  sourceRevision,
  workspaceRevision,
  mode = 'incremental',
  targetCourseIds = [],
  routeClient,
  signal,
  checkpoint,
  onProgress
} = {}) {
  const metadata = verifyAgentPlanningInput({
    snapshot, sourceRevision, workspaceRevision, mode, targetCourseIds, routeClient
  });
  if (signal?.aborted) throw new AgentPlanningInputError('planning_cancelled');

  const intents = applyPlanningIntents(snapshot);
  const result = await buildDynamicCoursePlan({
    ...intents.snapshot,
    periodKey: 'year',
    district: '',
    routeClient,
    signal,
    checkpoint: checkpoint || createPlanningCheckpoint({signal}),
    onProgress,
    _nationalRun: mode === 'full',
    targetCourseIds: mode === 'full' ? null : metadata.targetCourseIds,
    allowGlobalRepair: mode === 'full'
  });

  if (result?.finalPlanValidation?.valid !== true) {
    throw new AgentPlanningInputError('planning_final_validation_failed');
  }
  if (!Array.isArray(result?.rows)) {
    throw new AgentPlanningInputError('planning_rows_missing');
  }
  result.rows.push(...intents.rows);
  assertNoUnlocatedCourseAssignments(result.rows,snapshot.missingSchoolCourseIds||[]);
  // Caller must still verify the same source and workspace revisions under the
  // database lease BEFORE attempting the existing fenced planning snapshot RPC.
  return {
    ...metadata,
    rows: result.rows,
    diagnostics: {
      finalPlanValid: true,
      rowCount: result.rows.length,
      optimization: result.optimization ?? null,
      recruitment: result.recruitment ?? null
    }
  };
}
