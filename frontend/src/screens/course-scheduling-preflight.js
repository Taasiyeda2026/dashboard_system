import { planningPerfCount, planningPerfEvent, planningPerfTimer } from './course-scheduling-perf.js';

export const PLANNING_LEASE_HEARTBEAT_MS = 15_000;
export const PLANNING_LEASE_TTL_SECONDS = 120;

export class PlanningLeaseLostError extends Error {
  constructor(reason = 'planning_run_ownership_lost') {
    super(reason);
    this.code = 'planning_run_ownership_lost';
  }
}

// No snapshot, fingerprint, route, or planner callback can run through this gate.
export async function runPlanningPreflight({ load, acquire, scope, runId, engineVersion, forceFull = false }) {
  const stop = planningPerfTimer('preflight');
  try {
    planningPerfCount('preflightReads');
    const facts = await load(scope);
    if (facts?.schemaVersion !== 1 || facts.sourceRevision == null) throw new Error('planning_preflight_migration_required');
    if (facts.activeLease) return { decision: 'blocked', facts, lease: facts.activeLease };
    const current = facts.workspace && facts.workspace.engineVersion === engineVersion
      && facts.workspace.validatedSourceRevision != null
      && String(facts.workspace.validatedSourceRevision) === String(facts.sourceRevision)
      && Number(facts.dirtyCount) === 0;
    if (!forceFull && current) return { decision: 'no-op', facts };
    const lease = await acquire({ ...scope, runId, ttlSeconds: PLANNING_LEASE_TTL_SECONDS });
    return { decision: lease?.acquired === true ? 'run' : 'blocked', facts, lease };
  } finally { stop(); }
}

export function planningLeaseWaitMessage(lease = {}, now = Date.now()) {
  const expires = Date.parse(lease.retry_at || lease.expires_at || '');
  const seconds = Number.isFinite(expires) ? Math.max(1, Math.ceil((expires - now) / 1000)) : null;
  const wait = seconds == null ? 'לאחר סיום הריצה הפעילה' : seconds < 60
    ? `בעוד ${seconds} שניות` : `בעוד ${Math.ceil(seconds / 60)} דקות`;
  return `תכנון זה כבר רץ במקביל עבור אותו מחוז/תקופה. ניתן לבדוק שוב ${wait}.`;
}

// Serialize heartbeats and treat an authoritative rejected renewal as loss of
// ownership. Transport timeouts are retryable because the DB fences every
// checkpoint/commit by run_id + expires_at, including after a suspended tab wakes.
export function startPlanningLeaseHeartbeat({ renew, onLost, intervalMs = PLANNING_LEASE_HEARTBEAT_MS,
  setTimer = setInterval, clearTimer = clearInterval, timeoutMs = 10_000, onTransient = () => {} }) {
  let stopped = false;
  let inFlight = null;
  let timeout = null;
  const heartbeat = () => {
    if (stopped) return Promise.resolve(null);
    if (inFlight) return inFlight;
    const deadline = new Promise((_, reject) => { timeout = setTimeout(() => reject(new PlanningLeaseLostError('heartbeat_timeout')), timeoutMs); });
    inFlight = Promise.race([Promise.resolve().then(() => stopped ? null : renew()), deadline]).then(result => {
      if (stopped) return null;
      planningPerfCount('leaseHeartbeats');
      if (result?.ok !== true) throw new PlanningLeaseLostError(result?.reason);
      planningPerfEvent('lease-heartbeat', { expiresAt: result.expires_at });
      return result;
    }).catch(error => {
      if (stopped) return null;
      if (error instanceof PlanningLeaseLostError && error.message !== 'heartbeat_timeout') {
        onLost(error);
        return null;
      }
      // A background Chromium tab can defer promise/timer continuations well
      // beyond the nominal timeout even when PostgREST already returned 200.
      // Treat transport/time-budget failures as transient: the DB remains the
      // authority and fences every checkpoint/commit by run_id + expires_at.
      // A later authoritative {ok:false} renewal, or a fenced write, ends the run.
      planningPerfEvent('lease-heartbeat-transient', { reason: String(error?.message || error || 'transport') });
      onTransient(error);
      return null;
    }).finally(() => { clearTimeout(timeout); inFlight = null; });
    return inFlight;
  };
  const timer = setTimer(() => { void heartbeat(); }, intervalMs);
  return { heartbeat, stop() { stopped = true; clearTimer(timer); clearTimeout(timeout); } };
}

export function throwIfPlanningRunInvalidated(error) {
  const reason = String(error?.message || error?.code || error || '');
  if (reason.includes('planning_run_ownership_lost')) throw new PlanningLeaseLostError();
  if (reason.includes('planning_source_revision_conflict') || reason.includes('planning_revision_conflict')) throw error;
}
