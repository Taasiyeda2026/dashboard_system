/**
 * Single source of truth for scheduling planning run classification and scope.
 * Run types are mutually exclusive from the caller's perspective:
 *   no-op | incremental | engine-upgrade | full-maintenance
 */

const text = (value) => String(value ?? '').trim();

export const PLANNING_RUN_TYPES = Object.freeze({
  NO_OP: 'no-op',
  INCREMENTAL: 'incremental',
  ENGINE_UPGRADE: 'engine-upgrade',
  FULL_MAINTENANCE: 'full-maintenance'
});

export const PLANNING_RUN_PHASES = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  CALCULATED: 'calculated',
  VALIDATED: 'validated',
  COMMITTED: 'committed',
  FAILED_RESUMABLE: 'failed-resumable'
});

/**
 * Progress inside one RUNNING checkpoint. Phase says where the run is in its
 * lifecycle (running → validated → committed); stage says how far planning
 * itself got. Row count alone is never proof that planning finished:
 * 253/253 rows exist long before the existing-staff rescue, school packing,
 * workday consolidation, gap compaction and final validation have run.
 *   rows    – base rows are being produced / optimization passes in flight
 *   planned – buildDynamicCoursePlan returned: every pass, recruitment
 *             profiles, hard validation and local repair have completed
 */
export const PLANNING_RUN_STAGES = Object.freeze({
  ROWS: 'rows',
  PLANNED: 'planned'
});

const ASSIGNED_PLANNING_KINDS = new Set(['proposal', 'fixed-proposal', 'planning-locked', 'live']);

/**
 * Rows of an interrupted checkpoint that must re-enter base planning on resume.
 * Unassigned rows may still be waiting for the deferred existing-staff rescue
 * (instructor-hours maximisation), so they are never accepted as finished.
 */
export function planningResumeReopenIds(rows = []) {
  return [...new Set((rows || [])
    .filter((row) => {
      if (!text(row?.courseId)) return false;
      if (row?.diagnostics?.rescueDeferred === true || row?.diagnostics?.searchIncomplete === true) return true;
      return !ASSIGNED_PLANNING_KINDS.has(text(row?.kind));
    })
    .map((row) => text(row.courseId)))];
}

/**
 * A "rows" checkpoint can be internally inconsistent. If it cannot pass the
 * hard whole-plan validator, never keep using those proposals as incumbents.
 * Restart a NON-FULL run from the separately committed workspace, recomputing
 * the original dirty base scope plus any newly added courses. Existing engine
 * upgrade optimization scopes are retained by the caller. No DB reset/write.
 *
 * A requested full-maintenance run must not be secretly restarted over the
 * entire country: the caller should fail closed and request explicit action.
 */
export function planSafeRestartFromCommittedWorkspace({
  committedRows = [],
  currentCourseIds = [],
  baseRecalculationIds = [],
  fullRun = false
} = {}) {
  if (fullRun || !Array.isArray(committedRows) || !committedRows.length) return null;
  const currentIds = [...new Set((currentCourseIds || []).map(text).filter(Boolean))];
  if (!currentIds.length) return null;
  const currentSet = new Set(currentIds);
  const cleanRows = committedRows.filter((row) => currentSet.has(text(row?.courseId)));
  if (!cleanRows.length) return null;
  const savedIds = new Set(cleanRows.map((row) => text(row.courseId)));
  const scope = new Set((baseRecalculationIds || []).map(text).filter((id) => currentSet.has(id)));
  for (const id of currentIds) if (!savedIds.has(id)) scope.add(id);
  return {
    existingRows: cleanRows,
    targetCourseIds: [...scope],
    // Restore original, not the reduced resume-only, optimization scope.
    optimizationScopeCourseIds: undefined,
    resumeFromCheckpoint: false,
    missingFromCommittedIds: currentIds.filter((id) => !savedIds.has(id))
  };
}

export const CHECKPOINT_META_KEY = '__planningRunMeta';
export const PLANNING_ROUTE_CACHE_PRELOAD_MIN_IDS = 12;

function shouldPreloadPlanningRouteCache(ids = []) {
  return [...new Set((ids || []).map(text).filter(Boolean))].length >= PLANNING_ROUTE_CACHE_PRELOAD_MIN_IDS;
}

export function encodeCheckpointRows(rows = [], meta = null) {
  const list = Array.isArray(rows) ? rows.filter((row) => row && row[CHECKPOINT_META_KEY] !== true) : [];
  if (!meta || typeof meta !== 'object') return list;
  return [{ [CHECKPOINT_META_KEY]: true, ...meta }, ...list];
}

export function decodeCheckpointPayload(payload = null) {
  const rawRows = Array.isArray(payload?.rows) ? payload.rows : [];
  const metaRow = rawRows.find((row) => row && row[CHECKPOINT_META_KEY] === true) || null;
  const rows = rawRows.filter((row) => !(row && row[CHECKPOINT_META_KEY] === true));
  const meta = metaRow
    ? Object.fromEntries(Object.entries(metaRow).filter(([key]) => key !== CHECKPOINT_META_KEY))
    : null;
  return {
    ...payload,
    rows,
    meta
  };
}

function sameIdList(left = [], right = []) {
  const a = [...new Set((left || []).map(text).filter(Boolean))].sort();
  const b = [...new Set((right || []).map(text).filter(Boolean))].sort();
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function checkpointRowIds(checkpoint = null) {
  return [...new Set((checkpoint?.rows || []).map((row) => text(row?.courseId)).filter(Boolean))];
}

/**
 * A checkpoint is resumable only when it belongs to the same workspace revision,
 * current fingerprints, and target engine, and has reached a safe phase.
 * Engine version on the workspace is NOT advanced by the mere existence of a checkpoint.
 *
 * Fingerprints MUST be the live run fingerprints — never the checkpoint's own copies.
 */
export function isCheckpointResumable({
  checkpoint = null,
  workspaceRevision = 0,
  engineVersion = '',
  dataFingerprint = '',
  contextFingerprint = '',
  sourceRevision = null,
  runType = ''
} = {}) {
  if (!checkpoint) return false;
  const meta = checkpoint.meta || null;
  if (sourceRevision != null && (!meta || String(meta.sourceRevision) !== String(sourceRevision))) return false;
  // Legacy checkpoints (no meta envelope) may resume full-maintenance course
  // progress only. The RPC already matched engine+fingerprints to return them.
  if (!meta) {
    return runType === PLANNING_RUN_TYPES.FULL_MAINTENANCE
      && Array.isArray(checkpoint.rows)
      && checkpoint.rows.length > 0
      && Array.isArray(checkpoint.completedActivityIds)
      && checkpoint.completedActivityIds.length > 0;
  }
  if (!text(meta.engineTo) || text(meta.engineTo) !== text(engineVersion)) return false;
  if (meta.workspaceRevision == null || Number(meta.workspaceRevision) !== Number(workspaceRevision)) return false;
  if (!text(meta.dataFingerprint) || text(meta.dataFingerprint) !== text(dataFingerprint)) return false;
  if (!text(meta.contextFingerprint) || text(meta.contextFingerprint) !== text(contextFingerprint)) return false;
  if (runType && text(meta.runType) && text(meta.runType) !== text(runType)) return false;
  const phase = text(meta.phase);
  return phase === PLANNING_RUN_PHASES.CALCULATED
    || phase === PLANNING_RUN_PHASES.VALIDATED
    || phase === PLANNING_RUN_PHASES.FAILED_RESUMABLE
    || phase === PLANNING_RUN_PHASES.RUNNING;
}

function checkpointMatchesRunScope({
  checkpoint = null,
  workspaceRevision = 0,
  engineVersion = '',
  dataFingerprint = '',
  contextFingerprint = '',
  sourceRevision = null,
  runType = '',
  requiredCourseIds = null,
  expectedScope = null,
  phase = ''
} = {}) {
  if (!isCheckpointResumable({
    checkpoint,
    workspaceRevision,
    engineVersion,
    dataFingerprint,
    contextFingerprint,
    sourceRevision,
    runType
  })) return false;
  const meta = checkpoint?.meta || null;
  if (!meta || text(meta.phase) !== phase) return false;
  if (runType && text(meta.runType) !== text(runType)) return false;

  const haveIds = new Set(checkpointRowIds(checkpoint));
  if (!haveIds.size) return false;
  const required = [...new Set((requiredCourseIds || []).map(text).filter(Boolean))];
  if (required.length && required.some((courseId) => !haveIds.has(courseId))) return false;

  if (expectedScope && typeof expectedScope === 'object') {
    if (expectedScope.baseRecalculationIds
      && !sameIdList(meta.baseRecalculationIds, expectedScope.baseRecalculationIds)) {
      return false;
    }
    if (expectedScope.schoolPackingCourseIds
      && !sameIdList(meta.schoolPackingCourseIds, expectedScope.schoolPackingCourseIds)) {
      return false;
    }
    if (expectedScope.recruitmentRecoveryCourseIds
      && !sameIdList(meta.recruitmentRecoveryCourseIds, expectedScope.recruitmentRecoveryCourseIds)) {
      return false;
    }
    if (expectedScope.workdayConsolidationCourseIds
      && !sameIdList(meta.workdayConsolidationCourseIds, expectedScope.workdayConsolidationCourseIds)) {
      return false;
    }
  }
  return true;
}

/**
 * Validated checkpoints may skip recalculation and go straight to canonical commit
 * only when they still match the live run and contain every required row.
 */
export function canCommitValidatedCheckpoint(input = {}) {
  return checkpointMatchesRunScope({ ...input, phase: PLANNING_RUN_PHASES.VALIDATED });
}

/**
 * A RUNNING checkpoint whose planner already finished (stage=planned: rows,
 * rescue, every optimization pass and final validation) and that holds a row
 * for every required activity must not restart planning — e.g. the tab closed
 * between the planner returning and the VALIDATED write. It may only proceed
 * to whole-plan validation, and from there to a fenced commit. It is never
 * committed directly. A checkpoint that merely reached 253/253 rows without
 * stage=planned is NOT eligible: its optimization passes may be unfinished.
 */
export function canValidateCompletedRunningCheckpoint({ requiredCourseIds = null, ...input } = {}) {
  const required = [...new Set((requiredCourseIds || []).map(text).filter(Boolean))];
  if (!required.length) return false;
  if (text(input.checkpoint?.meta?.planningStage) !== PLANNING_RUN_STAGES.PLANNED) return false;
  const completed = new Set((input.checkpoint?.completedActivityIds || []).map(text).filter(Boolean));
  if (required.some((courseId) => !completed.has(courseId))) return false;
  return checkpointMatchesRunScope({ ...input, requiredCourseIds: required, phase: PLANNING_RUN_PHASES.RUNNING });
}

function resumeFromCheckpoint({
  resumableCheckpoint,
  workspaceRevision,
  engineVersion,
  dataFingerprint,
  contextFingerprint,
  sourceRevision,
  runType
}) {
  return isCheckpointResumable({
    checkpoint: resumableCheckpoint,
    workspaceRevision,
    engineVersion,
    dataFingerprint,
    contextFingerprint,
    sourceRevision,
    runType
  }) ? resumableCheckpoint : null;
}

export function resolvePlanningRunPlan({
  forceFull = false,
  shared = null,
  currentCourseIds = [],
  regularAffectedIds = [],
  engineUpgradeAffectedIds = [],
  upgradeOptimizationScopes = null,
  upgradeExecution = null,
  unrecoverableGlobalContextChange = false,
  sourceValidationRequired = false,
  storedEngineVersion = '',
  currentEngineVersion = '',
  currentDataFingerprint = '',
  currentContextFingerprint = '',
  sourceRevision = null,
  resumableCheckpoint = null
} = {}) {
  const reasons = [];
  const workspace = shared?.workspace || null;
  const existingRows = Array.isArray(shared?.rows) ? shared.rows : [];
  const regular = [...new Set((regularAffectedIds || []).map(text).filter(Boolean))];
  const upgradeIds = [...new Set((engineUpgradeAffectedIds || []).map(text).filter(Boolean))];
  const execution = upgradeExecution || {
    affectedIds: [...new Set([...regular, ...upgradeIds])],
    baseRecalculationIds: regular,
    upgradeOptimizationIds: upgradeIds,
    v28OptimizationUpgrade: false
  };
  const workspaceRevision = Number(workspace?.revision) || 0;
  const dataFingerprint = text(currentDataFingerprint);
  const contextFingerprint = text(currentContextFingerprint);

  if (sourceValidationRequired) reasons.push({ code: 'source_validation_bootstrap', detail: 'source journal has no validated cursor for this workspace' });
  if (forceFull) {
    reasons.push({ code: 'force_full', detail: 'explicit maintenance rebuild' });
  }
  if (!workspace) reasons.push({ code: 'missing_workspace', detail: 'no shared planning workspace' });
  if (!existingRows.length) reasons.push({ code: 'empty_rows', detail: 'workspace has no planning rows' });
  if (unrecoverableGlobalContextChange) {
    reasons.push({ code: 'unrecoverable_context', detail: 'global context change requires full rebuild' });
  }

  const fullMaintenance = forceFull === true
    || sourceValidationRequired === true
    || !workspace
    || !existingRows.length
    || unrecoverableGlobalContextChange === true;

  if (fullMaintenance) {
    return {
      runType: PLANNING_RUN_TYPES.FULL_MAINTENANCE,
      reasons,
      baseRecalculationIds: [...currentCourseIds],
      upgradeOptimizationIds: [],
      schoolPackingCourseIds: [],
      recruitmentRecoveryCourseIds: [],
      workdayConsolidationCourseIds: [],
      gapCompactionCourseIds: null,
      affectedIds: [...currentCourseIds],
      persistServerCheckpoints: true,
      preloadRouteCache: true,
      engineChanged: text(storedEngineVersion) !== text(currentEngineVersion),
      advanceEngineMarker: false,
      resume: resumeFromCheckpoint({
        resumableCheckpoint,
        workspaceRevision,
        engineVersion: currentEngineVersion,
        dataFingerprint,
        contextFingerprint,
        sourceRevision,
        runType: PLANNING_RUN_TYPES.FULL_MAINTENANCE
      })
    };
  }

  const engineChanged = !!workspace
    && text(storedEngineVersion)
    && text(storedEngineVersion) !== text(currentEngineVersion);
  const optimizationUpgrade = execution?.v28OptimizationUpgrade === true
    || (engineChanged && upgradeIds.length > 0 && (execution?.baseRecalculationIds || []).length === regular.length);

  if (engineChanged && (optimizationUpgrade || upgradeIds.length > 0 || regular.length === 0)) {
    const scopes = upgradeOptimizationScopes || {};
    const schoolPackingCourseIds = [...new Set((scopes.schoolPackingCourseIds || upgradeIds).map(text).filter(Boolean))];
    const recruitmentRecoveryCourseIds = [...new Set((scopes.recruitmentRecoveryCourseIds || []).map(text).filter(Boolean))];
    const workdayConsolidationCourseIds = [...new Set((scopes.workdayConsolidationCourseIds || []).map(text).filter(Boolean))];
    const baseRecalculationIds = [...new Set((execution.baseRecalculationIds || regular).map(text).filter(Boolean))];
    const upgradeOptimizationIds = [...new Set((execution.upgradeOptimizationIds || upgradeIds).map(text).filter(Boolean))];
    if (!upgradeOptimizationIds.length && !baseRecalculationIds.length) {
      return {
        runType: PLANNING_RUN_TYPES.NO_OP,
        reasons: [{ code: 'engine_marker_only', detail: 'engine string differs but no scoped work remains' }],
        baseRecalculationIds: [],
        upgradeOptimizationIds: [],
        schoolPackingCourseIds: [],
        recruitmentRecoveryCourseIds: [],
        workdayConsolidationCourseIds: [],
        gapCompactionCourseIds: [],
        affectedIds: [],
        persistServerCheckpoints: false,
        preloadRouteCache: false,
        engineChanged: true,
        // Marker-only: no planning work, but the canonical workspace must advance
        // the engine string once so the next entry is a true matching no-op.
        advanceEngineMarker: true,
        resume: null
      };
    }
    reasons.push({
      code: 'engine_upgrade',
      detail: `${text(storedEngineVersion)} → ${text(currentEngineVersion)}`,
      baseRecalculationIds,
      upgradeOptimizationIds
    });
    return {
      runType: PLANNING_RUN_TYPES.ENGINE_UPGRADE,
      reasons,
      baseRecalculationIds,
      upgradeOptimizationIds,
      schoolPackingCourseIds,
      recruitmentRecoveryCourseIds,
      workdayConsolidationCourseIds,
      gapCompactionCourseIds: baseRecalculationIds,
      affectedIds: [...new Set([...baseRecalculationIds, ...upgradeOptimizationIds])],
      persistServerCheckpoints: true,
      preloadRouteCache: shouldPreloadPlanningRouteCache([
        ...baseRecalculationIds,
        ...upgradeOptimizationIds
      ]),
      engineChanged: true,
      advanceEngineMarker: false,
      resume: resumeFromCheckpoint({
        resumableCheckpoint,
        workspaceRevision,
        engineVersion: currentEngineVersion,
        dataFingerprint,
        contextFingerprint,
        sourceRevision,
        runType: PLANNING_RUN_TYPES.ENGINE_UPGRADE
      })
    };
  }

  if (!regular.length) {
    return {
      runType: PLANNING_RUN_TYPES.NO_OP,
      reasons: [{ code: 'already_current', detail: 'no dirty rows and engine matches' }],
      baseRecalculationIds: [],
      upgradeOptimizationIds: [],
      schoolPackingCourseIds: [],
      recruitmentRecoveryCourseIds: [],
      workdayConsolidationCourseIds: [],
      gapCompactionCourseIds: [],
      affectedIds: [],
      persistServerCheckpoints: false,
      preloadRouteCache: false,
      engineChanged: false,
      advanceEngineMarker: false,
      resume: null
    };
  }

  reasons.push({ code: 'dirty_rows', detail: `${regular.length} affected activities`, ids: regular.slice(0, 20) });
  return {
    runType: PLANNING_RUN_TYPES.INCREMENTAL,
    reasons,
    baseRecalculationIds: regular,
    upgradeOptimizationIds: [],
    schoolPackingCourseIds: regular,
    recruitmentRecoveryCourseIds: regular,
    workdayConsolidationCourseIds: regular,
    gapCompactionCourseIds: regular,
    affectedIds: regular,
    persistServerCheckpoints: false,
    preloadRouteCache: shouldPreloadPlanningRouteCache(regular),
    engineChanged: false,
    advanceEngineMarker: false,
    resume: null
  };
}

/** Bound checkpoint requests by both activity count and encoded request bytes.
 * A single large activity may use up to 1 MiB; larger payloads fail explicitly.
 * Only the last chunk can expose the requested final phase. */
/**
 * Stage snapshots are unvalidated, best-effort crash recovery. The same
 * 253-row national snapshot used to be re-uploaded once per optimization
 * phase (26+ RPC calls each), even when only one row changed. Persist the
 * first eligible stage and, subsequently, only changed rows at a bounded
 * interval; the mandatory PLANNED/VALIDATED final flush is not throttled.
 *
 * Returns rows, not a boolean, so callers cannot accidentally upload the
 * full snapshot after a successful throttle decision.
 */
export function planningStageCheckpointDelta({
  rows = [],
  persistedRows = new Map(),
  lastSavedAt = 0,
  now = Date.now(),
  minIntervalMs = 120_000,
  serialize = JSON.stringify
} = {}) {
  const alreadySaved = persistedRows instanceof Map && persistedRows.size > 0;
  if (alreadySaved && now - lastSavedAt < minIntervalMs) return [];
  const changed = [];
  for (const row of rows || []) {
    const id = text(row?.courseId);
    if (!id) continue;
    const previous = persistedRows?.get?.(id);
    if (!previous || serialize(previous) !== serialize(row)) changed.push(row);
  }
  return changed;
}

export function* planningCheckpointChunks({rows = [], meta = null, rpcArgs = {}, maxRows = 10, maxBytes = 256 * 1024} = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const encoder = new TextEncoder();
  let offset = 0;
  while (offset < Math.max(1, list.length)) {
    const chunk = [];
    const runningMeta = meta ? {...meta, phase:'running'} : null;
    while (offset + chunk.length < list.length && chunk.length < maxRows) {
      chunk.push(list[offset + chunk.length]);
      const bytes = encoder.encode(JSON.stringify({...rpcArgs,p_rows:encodeCheckpointRows(chunk,runningMeta)})).length;
      if (bytes > maxBytes && chunk.length > 1) { chunk.pop(); break; }
    }
    const last = offset + chunk.length >= list.length;
    const args = {...rpcArgs,p_rows:encodeCheckpointRows(chunk,last ? meta : runningMeta)};
    if (encoder.encode(JSON.stringify(args)).length > 1024 * 1024) throw new Error('planning_checkpoint_payload_too_large');
    yield args;
    offset += Math.max(1,chunk.length);
  }
}
