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

/**
 * A checkpoint is resumable only when it belongs to the same workspace revision,
 * fingerprints, and target engine, and has reached a safe phase.
 * Engine version on the workspace is NOT advanced by the mere existence of a checkpoint.
 */
export function isCheckpointResumable({
  checkpoint = null,
  workspaceRevision = 0,
  engineVersion = '',
  dataFingerprint = '',
  contextFingerprint = '',
  runType = ''
} = {}) {
  if (!checkpoint) return false;
  const meta = checkpoint.meta || null;
  // Legacy checkpoints (no meta envelope) may resume full-maintenance course
  // progress only. The RPC already matched engine+fingerprints to return them.
  if (!meta) {
    return runType === PLANNING_RUN_TYPES.FULL_MAINTENANCE
      && Array.isArray(checkpoint.rows)
      && checkpoint.rows.length > 0
      && Array.isArray(checkpoint.completedActivityIds)
      && checkpoint.completedActivityIds.length > 0;
  }
  if (text(meta.engineTo) && text(meta.engineTo) !== text(engineVersion)) return false;
  if (meta.workspaceRevision != null && Number(meta.workspaceRevision) !== Number(workspaceRevision)) return false;
  if (text(meta.dataFingerprint) && text(meta.dataFingerprint) !== text(dataFingerprint)) return false;
  if (text(meta.contextFingerprint) && text(meta.contextFingerprint) !== text(contextFingerprint)) return false;
  if (runType && text(meta.runType) && text(meta.runType) !== text(runType)) return false;
  const phase = text(meta.phase);
  return phase === PLANNING_RUN_PHASES.CALCULATED
    || phase === PLANNING_RUN_PHASES.VALIDATED
    || phase === PLANNING_RUN_PHASES.FAILED_RESUMABLE
    || phase === PLANNING_RUN_PHASES.RUNNING;
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
  storedEngineVersion = '',
  currentEngineVersion = '',
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

  if (forceFull) {
    reasons.push({ code: 'force_full', detail: 'explicit maintenance rebuild' });
  }
  if (!workspace) reasons.push({ code: 'missing_workspace', detail: 'no shared planning workspace' });
  if (!existingRows.length) reasons.push({ code: 'empty_rows', detail: 'workspace has no planning rows' });
  if (unrecoverableGlobalContextChange) {
    reasons.push({ code: 'unrecoverable_context', detail: 'global context change requires full rebuild' });
  }

  const fullMaintenance = forceFull === true
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
      resume: isCheckpointResumable({
        checkpoint: resumableCheckpoint,
        workspaceRevision: Number(workspace?.revision) || 0,
        engineVersion: currentEngineVersion,
        dataFingerprint: text(resumableCheckpoint?.meta?.dataFingerprint || ''),
        contextFingerprint: text(resumableCheckpoint?.meta?.contextFingerprint || ''),
        runType: PLANNING_RUN_TYPES.FULL_MAINTENANCE
      }) ? resumableCheckpoint : null
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
      preloadRouteCache: false,
      engineChanged: true,
      resume: isCheckpointResumable({
        checkpoint: resumableCheckpoint,
        workspaceRevision: Number(workspace?.revision) || 0,
        engineVersion: currentEngineVersion,
        dataFingerprint: text(resumableCheckpoint?.meta?.dataFingerprint || ''),
        contextFingerprint: text(resumableCheckpoint?.meta?.contextFingerprint || ''),
        runType: PLANNING_RUN_TYPES.ENGINE_UPGRADE
      }) ? resumableCheckpoint : null
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
    preloadRouteCache: false,
    engineChanged: false,
    resume: null
  };
}
