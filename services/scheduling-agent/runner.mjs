/**
 * Durable-worker orchestration, independent of the dashboard/UI.
 *
 * The injected backend adapter is deliberately mandatory: nothing in this file
 * owns an admin credential, accepts a user-supplied plan, or writes a schedule.
 * Live integration MUST implement fenced DB calls with a dedicated machine
 * identity; until then this module cannot operate in production.
 */
import {randomUUID} from 'node:crypto';
import {computeAgentSchedulingPlan} from './compute-plan.mjs';
import {PLANNING_ENGINE_VERSION} from '../../frontend/src/screens/course-scheduling-planning.js';

const REQUIRED_BACKEND = Object.freeze([
  'claimJob','acquireLease','loadSnapshot','readPreflight','heartbeatLease',
  'persistProposals','finishJob','releaseLease'
]);

export class SchedulingAgentRunError extends Error {
  constructor(code) {
    super(code);
    this.name='SchedulingAgentRunError';
    this.code=code;
  }
}

function requireBackend(backend) {
  if (!backend || REQUIRED_BACKEND.some(method=>typeof backend[method]!=='function')) {
    throw new SchedulingAgentRunError('secure_backend_adapter_required');
  }
}

function validRevision(value) {
  return /^\d+$/.test(String(value??''));
}

function validatedPreflight(facts) {
  if (!facts || typeof facts!=='object') {
    throw new SchedulingAgentRunError('planning_preflight_unavailable');
  }
  const src=facts.sourceRevision;
  const work=facts.workspace?.revision;
  if (!validRevision(src) || !validRevision(work)) {
    throw new SchedulingAgentRunError('planning_preflight_invalid');
  }
  return {
    sourceRevision:String(src),
    workspaceRevision:String(work),
    validatedSourceRevision:String(facts.workspace?.validatedSourceRevision??''),
    engineVersion:String(facts.workspace?.engineVersion??''),
    dirtyCount:Number(facts.dirtyCount)
  };
}

function assertRevision(snapshot, facts, code='planning_revision_conflict') {
  if (String(snapshot.sourceRevision)!==facts.sourceRevision
      || String(snapshot.workspaceRevision)!==facts.workspaceRevision) {
    throw new SchedulingAgentRunError(code);
  }
}

function assertInput(snapshot, job) {
  if (!snapshot || typeof snapshot!=='object'
      || !validRevision(snapshot.sourceRevision)
      || !validRevision(snapshot.workspaceRevision)
      || !snapshot.snapshot || !snapshot.routeClient) {
    throw new SchedulingAgentRunError('trusted_snapshot_unavailable');
  }
  if (!/^[0-9a-f-]{36}$/i.test(String(job.jobId||'')) ||
      !['incremental','full'].includes(job.mode)) {
    throw new SchedulingAgentRunError('invalid_claimed_job');
  }
  if (job.mode==='incremental' &&
     !Array.isArray(snapshot.targetCourseIds)) {
    throw new SchedulingAgentRunError('incremental_scope_unavailable');
  }
  if (!snapshot.dataFingerprint || !snapshot.contextFingerprint) {
    throw new SchedulingAgentRunError('planning_fingerprint_unavailable');
  }
}

/** One invocation makes at most one attempt. A service loop may call it repeatedly.
 * The lease, queue claim, and snapshot provider MUST be backed by authenticated
 * server-side gates with ownership fencing. Client-supplied snapshots are forbidden.
 */
export async function runOneSchedulingAgentJob({
  backend, computePlan=computeAgentSchedulingPlan, heartbeatIntervalMs=30000,
  createRunId=randomUUID, onProgress=()=>{}
}={}) {
  requireBackend(backend);
  if (typeof computePlan!=='function') throw new SchedulingAgentRunError('engine_required');
  const runId=createRunId();
  const job=await backend.claimJob({runId});
  if (!job || job.claimed!==true) return {status:'idle'};
  const jobId=String(job.jobId||'');
  let lease=false, timer=null, heartbeatFailure=null;
  const controller=new AbortController();
  const heartbeat=async()=>{
    try {
      const response=await backend.heartbeatLease({jobId,runId,ttlSeconds:120});
      if (!response || response.ok!==true)
        throw new SchedulingAgentRunError('planning_lease_lost');
    } catch (error) {
      heartbeatFailure=error;
      controller.abort();
    }
  };
  try {
    if (!/^[0-9a-f-]{36}$/i.test(jobId)||!['incremental','full'].includes(job.mode)
        ||(job.runId&&job.runId!==runId)) {
      throw new SchedulingAgentRunError('invalid_claimed_job');
    }
    const acquired=await backend.acquireLease({jobId,runId,ttlSeconds:120});
    if (acquired?.acquired!==true) {
      throw new SchedulingAgentRunError('planning_lease_unavailable');
    }
    lease=true;
    timer=setInterval(()=>{void heartbeat()},heartbeatIntervalMs);
    timer.unref?.();

    // The machine adapter must authenticate and load a consistent frozen input;
    // the ChatGPT tool must never supply activity rows or precomputed options.
    const input=await backend.loadSnapshot({jobId,runId,mode:job.mode});
    assertInput(input,job);
    const initial=validatedPreflight(await backend.readPreflight({jobId,runId}));
    assertRevision(input,initial,'snapshot_stale_before_computation');
    if (initial.engineVersion===undefined) {
      throw new SchedulingAgentRunError('planning_engine_version_missing');
    }
    const validationOnly=job.mode==='incremental'&&input.targetCourseIds.length===0;
    if(validationOnly&&(initial.dirtyCount!==0||initial.engineVersion!==PLANNING_ENGINE_VERSION))
      throw new SchedulingAgentRunError('incremental_scope_unavailable');
    // The existing incremental SQL saver validates the entire stored workspace,
    // even with an empty patch. It alone may advance the validated source stamp.
    const output=validationOnly?{engineVersion:PLANNING_ENGINE_VERSION,
      diagnostics:{finalPlanValid:true},rows:[]}:await computePlan({
      ...input, mode:job.mode, signal:controller.signal,
      onProgress:progress=>onProgress({jobId,phase:progress?.phase||'computing'})
    });
    if (controller.signal.aborted||heartbeatFailure) {
      throw new SchedulingAgentRunError('planning_lease_lost');
    }
    if (!output || output.diagnostics?.finalPlanValid!==true ||
        !Array.isArray(output.rows) || !output.engineVersion) {
      throw new SchedulingAgentRunError('planning_engine_result_invalid');
    }
    const current=validatedPreflight(await backend.readPreflight({jobId,runId}));
    assertRevision(input,current,'snapshot_stale_before_commit');
    // The persistence adapter MUST assert the same revisions, current engine,
    // and lease owner *inside the database transaction*. This read is only an
    // early fail-fast check, never a substitute for DB fencing.
    const persisted=await backend.persistProposals({
      jobId,runId,mode:job.mode,
      validationOnly,
      sourceRevision:input.sourceRevision,
      workspaceRevision:input.workspaceRevision,
      dataFingerprint:input.dataFingerprint,
      contextFingerprint:input.contextFingerprint,
      engineVersion:output.engineVersion,
      rows:output.rows,
      activities:input.snapshot.activities
    });
    // New server contract: validation, receipt and completion commit together.
    // Later source changes are a new invalidation, not a failed committed job.
    if(persisted?.status!=='completed'||persisted.jobId!==jobId||persisted.runId!==runId)
      throw new SchedulingAgentRunError('worker_receipt_required');
    return {status:'completed',jobId,engineVersion:output.engineVersion,rowCount:output.rows.length,
      sourceRevision:String(persisted.sourceRevision??input.sourceRevision),
      workspaceRevision:String(persisted.revision??''),validationOnly};
  } catch (error) {
    const errorCode=String(error?.code||'planning_server_run_failed').slice(0,120);
    // Never report success. If owner fencing has expired, the backend must
    // reject this finish too; leave the job for lease-expiry recovery.
    const finished=await backend.finishJob({jobId,runId,success:false,failureCode:errorCode});
    // A lost persist response must not turn an already committed receipt into failure.
    if(finished?.status==='completed'&&finished.jobId===jobId&&finished.runId===runId)
      return {status:'completed',jobId,recoveredReceipt:true};
    return {status:'failed',jobId,failureCode:errorCode};
  } finally {
    if (timer) clearInterval(timer);
    controller.abort();
    if (lease) await backend.releaseLease({jobId,runId}).catch(()=>{});
  }
}
