/**
 * Read-only canary using the existing authoritative compute boundary.
 * The caller must supply the same trusted snapshot used by the worker;
 * this module deliberately has no transport, queue or persistence methods.
 */
import {computeAgentSchedulingPlan} from './compute-plan.mjs';

export const CANARY_COURSE_IDS=Object.freeze([
  'school_2027_096',
  'ACT-6fb4456b-5d05-401d-904f-411c1d9562fb',
  'ACT-9c40feb7-e990-4aa3-a59e-29cc111f496c'
]);

export async function previewThreeCoursesReadOnly({
  input, computePlan=computeAgentSchedulingPlan
}={}) {
  if(!input?.snapshot || !Array.isArray(input.snapshot.activities)
      || !input.routeClient || typeof computePlan!=='function')
    throw new Error('trusted_planning_input_required');
  const present=new Set(input.snapshot.activities.map(a=>String(a.row_id)));
  if(CANARY_COURSE_IDS.some(id=>!present.has(id)))
    throw new Error('canary_course_missing_from_snapshot');
  const result=await computePlan({
    snapshot:input.snapshot,
    sourceRevision:input.sourceRevision,
    workspaceRevision:input.workspaceRevision,
    routeClient:input.routeClient,
    mode:'incremental',
    targetCourseIds:[...CANARY_COURSE_IDS]
  });
  if(result?.diagnostics?.finalPlanValid!==true || !Array.isArray(result.rows))
    throw new Error('canary_validation_failed');
  // This returns the three target rows only; protected assignments still
  // participate in full-calendar constraints during computation.
  const targets=new Set(CANARY_COURSE_IDS);
  return Object.freeze({
    status:'preview_only', saved:false,
    sourceRevision:String(input.sourceRevision),
    workspaceRevision:String(input.workspaceRevision),
    targets:result.rows.filter(row=>targets.has(String(row.courseId)))
  });
}
