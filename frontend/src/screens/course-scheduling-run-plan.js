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
 * A RUNNING checkpoint that already holds a row for every required activity
 * (e.g. 253/253 after the tab closed during the optimization passes) must not
 * restart planning. It may only proceed to whole-plan validation, and from
 * there to a fenced commit or a delta repair of the failing rows. It is never
 * committed directly: the caller must validate it first.
 */
export function canValidateCompletedRunningCheckpoint({ requiredCourseIds = null, ...input } = {}) {
  const required = [...new Set((requiredCourseIds || []).map(text).filter(Boolean))];
  if (!required.length) return false;
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
