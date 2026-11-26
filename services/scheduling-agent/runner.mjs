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

const TRANSIENT_ERRORS = new Set(['worker_transport_failed','worker_api_unavailable','worker_database_retry']);

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
  backend, computePlan=computeAgentSchedulingPlan, heartbeatIntervalMs=15000,
  createRunId=randomUUID, onProgress=()=>{}
}={}) {
  requireBackend(backend);
  if (typeof computePlan!=='function') throw new SchedulingAgentRunError('engine_required');
  const runId=createRunId();
  const job=await backend.claimJob({runId});
  if (job?.status === 'completed' && job.noOp === true) {
    return {status:'completed', jobId:job.jobId, engineVersion:job.engineVersion,
      sourceRevision:job.sourceRevision, workspaceRevision:job.revision, rowCount:0, noOp:true};
  }
  if (!job || job.claimed!==true) return {status:'idle'};
  const jobId=String(job.jobId||'');
  let lease=false, timer=null, heartbeatFailure=null;
  const controller=new AbortController();
  let heartbeatInFlight = false;
  let lastHeartbeat = 0;
  let leaseHeartbeats = 0;
  const heartbeat=async()=>{
    if (heartbeatInFlight || controller.signal.aborted) return;
    heartbeatInFlight = true;
    try {
      const response=await backend.heartbeatLease({jobId,runId,ttlSeconds:120});
      if (!response || response.ok!==true)
        throw new SchedulingAgentRunError('planning_lease_lost');
      lastHeartbeat = performance.now();
      leaseHeartbeats++;
    } catch (error) {
      if (TRANSIENT_ERRORS.has(error?.code) && performance.now() - lastHeartbeat < 60_000) return;
      heartbeatFailure=error;
      controller.abort();
    } finally {
      heartbeatInFlight = false;
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
    lastHeartbeat = performance.now();
    timer=setInterval(()=>{void heartbeat()},heartbeatIntervalMs);
    timer.unref?.();

    // The machine adapter must authenticate and load a consistent frozen input;
    // the ChatGPT tool must never supply activity rows or precomputed options.
    const input=await backend.loadSnapshot({jobId,runId,mode:job.mode});
    assertInput(input,job);
    const initial=validatedPreflight(input.preflight || await backend.readPreflight({jobId,runId}));
    assertRevision(input,initial,'snapshot_stale_before_computation');
    if (controller.signal.aborted) throw new SchedulingAgentRunError('planning_lease_lost');
    const validationOnly=job.mode==='incremental'&&input.targetCourseIds.length===0;
    if(validationOnly&&(initial.dirtyCount!==0||initial.engineVersion!==PLANNING_ENGINE_VERSION))
      throw new SchedulingAgentRunError('incremental_scope_unavailable');
    // The existing incremental SQL saver validates the entire stored workspace,
    // even with an empty patch. It alone may advance the validated source stamp.
    const checkpointIdentity = {
      jobId,runId,sourceRevision:input.sourceRevision,workspaceRevision:input.workspaceRevision,
      dataFingerprint:input.dataFingerprint,contextFingerprint:input.contextFingerprint,
      planningDate:input.snapshot.today
    };
    const canCheckpoint = job.mode === 'full' && typeof backend.saveCheckpoint === 'function'
      && typeof backend.loadCheckpoint === 'function';
    const resumeRows = canCheckpoint && input.preflight?.checkpoint
      ? await backend.loadCheckpoint(checkpointIdentity) : null;
    const pending = new Map();
    let checkpointSaves = 0;
    let lastSave = performance.now();
    const saveProgress = async total => {
      const chunk = [];
      let bytes = 0;
      for (const row of pending.values()) {
        const rowBytes = Buffer.byteLength(JSON.stringify(row));
        if (rowBytes > 900_000) {
          // An oversized row can be recomputed on resume.
          pending.delete(row.courseId);
          continue;
        }
        if (chunk.length >= 10 || (chunk.length && bytes + rowBytes > 256_000)) break;
        chunk.push(row);
        bytes += rowBytes;
      }
      if (!chunk.length) return false;
      lastSave = performance.now();
      try {
        await backend.saveCheckpoint({...checkpointIdentity,total,rows:chunk});
      } catch (error) {
        if (!TRANSIENT_ERRORS.has(error?.code)) throw error;
        return false;
      }
      for (const row of chunk) pending.delete(row.courseId);
      checkpointSaves++;
      return true;
    };
    const progress = async update => {
      await onProgress({jobId,phase:update?.phase||'computing',completed:update?.completed,total:update?.total});
      if (!canCheckpoint) return;
      const row = update?.row;
      if (row?.instructorEmpId) pending.set(row.courseId, row);
      if (!pending.size) return;
      if (update.total > 0 && update.completed === update.total) {
        while (pending.size && await saveProgress(update.total)) { /* flush bounded chunks */ }
      } else if (row && (pending.size >= 10 || performance.now() - lastSave >= 15_000)) {
        await saveProgress(update.total);
      }
    };
    const output=validationOnly?{engineVersion:PLANNING_ENGINE_VERSION,
      diagnostics:{finalPlanValid:true},rows:[]}:await computePlan({
      ...input, mode:job.mode, signal:controller.signal,
      resumeRows:Array.isArray(resumeRows) ? resumeRows : [], onProgress:progress
    });
    if (controller.signal.aborted||heartbeatFailure) {
      throw new SchedulingAgentRunError('planning_lease_lost');
    }
    if (!output || output.diagnostics?.finalPlanValid!==true ||
        !Array.isArray(output.rows) || !output.engineVersion) {
      throw new SchedulingAgentRunError('planning_engine_result_invalid');
    }
    const current=validatedPreflight(await backend.readPreflight({jobId,runId}));
    if (controller.signal.aborted) throw new SchedulingAgentRunError('planning_lease_lost');
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
      workspaceRevision:String(persisted.revision??''),validationOnly,
      performance:{...input.snapshotMetrics,...output.diagnostics.metrics,checkpointSaves,leaseHeartbeats,
        cacheHits:input.routeClient.cacheHits,googleCalls:input.routeClient.googleCalls}};
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
