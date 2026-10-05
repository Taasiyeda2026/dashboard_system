import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import {
  PLANNING_RUN_PHASES,
  PLANNING_RUN_TYPES,
  canCommitValidatedCheckpoint,
  decodeCheckpointPayload,
  encodeCheckpointRows,
  isCheckpointResumable,
  resolvePlanningRunPlan
} from '../frontend/src/screens/course-scheduling-run-plan.js';
import {
  PlanningCancelledError,
  optimizeSchoolDayPackingPassCooperatively,
  createPlanningCheckpoint
} from '../frontend/src/screens/course-scheduling-planning.js';
import {
  planningEngineUpgradeExecutionScopes,
  planningEngineUpgradeOptimizationScopes
} from '../frontend/src/screens/course-scheduling-planning-store.js';

const option = (emp, date, start, end) => ({
  instructorEmpId: emp,
  instructorName: emp,
  startDate: date,
  endDate: date,
  startTime: start,
  endTime: end,
  meetings: [{ date, start_time: start, end_time: end }]
});

function heavySchoolRows(schoolId = 'school-heavy', count = 6, optionsPerRow = 18) {
  const rowsById = new Map();
  const activities = [];
  for (let index = 0; index < count; index += 1) {
    const courseId = `${schoolId}-${index}`;
    const packingOptions = [];
    for (let opt = 0; opt < optionsPerRow; opt += 1) {
      const day = 12 + (opt % 5);
      const hour = 8 + (opt % 6);
      packingOptions.push(option(
        opt % 2 === 0 ? '1537' : '1529',
        `2026-10-${String(day).padStart(2, '0')}`,
        `${String(hour).padStart(2, '0')}:00`,
        `${String(hour + 1).padStart(2, '0')}:30`
      ));
    }
    rowsById.set(courseId, {
      courseId,
      schoolId,
      school: 'Heavy School',
      courseName: `Course ${index}`,
      kind: 'proposal',
      instructorEmpId: '1537',
      instructorName: 'Guide',
      startDate: '2026-10-13',
      endDate: '2026-12-08',
      startTime: '12:00',
      endTime: '13:30',
      meetings: [{ date: '2026-10-13', start_time: '12:00', end_time: '13:30' }],
      packingOptions
    });
    activities.push({
      row_id: courseId,
      school_id: schoolId,
      school: 'Heavy School',
      activity_type: 'course'
    });
  }
  return { rowsById, activities };
}

function workspaceScaleFixture({
  schools = 40,
  rows = 261,
  heavySchoolId = 'school-2991',
  heavyCount = 6
} = {}) {
  const sharedRows = [];
  const activities = [];
  let created = 0;
  // Heavy packing school first (like production school 2991).
  for (let index = 0; index < heavyCount; index += 1) {
    const activityId = `heavy-${index}`;
    const packingOptions = Array.from({ length: 20 }, (_, opt) => option(
      opt % 2 === 0 ? '1537' : '1529',
      `2026-10-${String(12 + (opt % 5)).padStart(2, '0')}`,
      `${String(8 + (opt % 6)).padStart(2, '0')}:00`,
      `${String(9 + (opt % 6)).padStart(2, '0')}:30`
    ));
    sharedRows.push({
      activityId,
      needsRecalc: false,
      lockedOption: null,
      activityUpdatedAt: '2026-10-01T00:00:00Z',
      row: {
        courseId: activityId,
        kind: index % 5 === 0 ? 'recruitment' : 'proposal',
        schoolId: heavySchoolId,
        instructorEmpId: index % 5 === 0 ? '' : '1537',
        meetings: [{ date: '2026-10-13', start_time: '12:00', end_time: '13:30' }],
        packingOptions,
        scheduleOptions: packingOptions.slice(0, 4).map((item) => ({
          meetings: item.meetings,
          startDate: item.startDate,
          endDate: item.endDate,
          startTime: item.startTime,
          endTime: item.endTime
        }))
      }
    });
    activities.push({
      row_id: activityId,
      school_id: heavySchoolId,
      updated_at: '2026-10-01T00:00:00Z',
      activity_type: 'course',
      status: 'פתוח'
    });
    created += 1;
  }
  while (created < rows) {
    const schoolIndex = created % Math.max(1, schools - 1);
    const schoolId = `school-${schoolIndex}`;
    const activityId = `row-${created}`;
    const kind = created % 7 === 0 ? 'recruitment' : (created % 11 === 0 ? 'live' : 'proposal');
    sharedRows.push({
      activityId,
      needsRecalc: false,
      lockedOption: null,
      activityUpdatedAt: '2026-10-01T00:00:00Z',
      row: {
        courseId: activityId,
        kind,
        schoolId: kind === 'live' ? schoolId : schoolId,
        instructorEmpId: kind === 'recruitment' ? '' : String(1000 + (created % 30)),
        meetings: kind === 'live' ? [] : [{ date: '2026-11-02', start_time: '09:00', end_time: '10:30' }],
        packingOptions: kind === 'proposal' ? [
          option(String(1000 + (created % 30)), '2026-11-02', '09:00', '10:30'),
          option(String(1000 + ((created + 1) % 30)), '2026-11-03', '09:00', '10:30')
        ] : [],
        scheduleOptions: kind === 'recruitment' ? [{
          meetings: [{ date: '2026-11-02', start_time: '09:00', end_time: '10:30' }],
          startDate: '2026-11-02',
          endDate: '2026-11-02',
          startTime: '09:00',
          endTime: '10:30'
        }] : []
      }
    });
    activities.push({
      row_id: activityId,
      school_id: schoolId,
      updated_at: '2026-10-01T00:00:00Z',
      activity_type: 'course',
      status: 'פתוח',
      emp_id: kind === 'live' ? String(1000 + (created % 30)) : ''
    });
    created += 1;
  }
  return {
    shared: {
      workspace: {
        engineVersion: 'planning-v27-20261004-school-first-economic-alternatives-self-invalidation',
        revision: 11740
      },
      rows: sharedRows
    },
    activities,
    currentEngine: 'planning-v28-20261004-anchor-safe-global-reassignment-self-invalidation'
  };
}

test('run plan: matching engine and no dirty rows is a true no-op', () => {
  const plan = resolvePlanningRunPlan({
    shared: { workspace: { engineVersion: 'planning-v28-x', revision: 1 }, rows: [{ activityId: 'a', row: { courseId: 'a' } }] },
    currentCourseIds: ['a'],
    regularAffectedIds: [],
    engineUpgradeAffectedIds: [],
    storedEngineVersion: 'planning-v28-x',
    currentEngineVersion: 'planning-v28-x'
  });
  assert.equal(plan.runType, PLANNING_RUN_TYPES.NO_OP);
  assert.deepEqual(plan.baseRecalculationIds, []);
  assert.deepEqual(plan.schoolPackingCourseIds, []);
  assert.deepEqual(plan.recruitmentRecoveryCourseIds, []);
  assert.deepEqual(plan.workdayConsolidationCourseIds, []);
  assert.equal(plan.persistServerCheckpoints, false);
  assert.equal(plan.preloadRouteCache, false);
});

test('run plan: one dirty activity stays incremental and does not preload routes', () => {
  const plan = resolvePlanningRunPlan({
    shared: { workspace: { engineVersion: 'planning-v28-x', revision: 1 }, rows: [{ activityId: 'a' }, { activityId: 'b' }] },
    currentCourseIds: ['a', 'b'],
    regularAffectedIds: ['a'],
    engineUpgradeAffectedIds: [],
    storedEngineVersion: 'planning-v28-x',
    currentEngineVersion: 'planning-v28-x'
  });
  assert.equal(plan.runType, PLANNING_RUN_TYPES.INCREMENTAL);
  assert.deepEqual(plan.baseRecalculationIds, ['a']);
  assert.deepEqual(plan.affectedIds, ['a']);
  assert.equal(plan.persistServerCheckpoints, false);
  assert.equal(plan.preloadRouteCache, false);
});

test('run plan: v27→v28 is engine-upgrade without base rebuild', () => {
  const fixture = workspaceScaleFixture();
  const scopes = planningEngineUpgradeOptimizationScopes({
    shared: fixture.shared,
    activities: fixture.activities,
    storedEngineVersion: fixture.shared.workspace.engineVersion,
    currentEngineVersion: fixture.currentEngine
  });
  const execution = planningEngineUpgradeExecutionScopes({
    regularAffectedIds: [],
    engineUpgradeAffectedIds: scopes.affectedIds,
    storedEngineVersion: fixture.shared.workspace.engineVersion,
    currentEngineVersion: fixture.currentEngine
  });
  const plan = resolvePlanningRunPlan({
    shared: fixture.shared,
    currentCourseIds: fixture.activities.map((row) => row.row_id),
    regularAffectedIds: [],
    engineUpgradeAffectedIds: scopes.affectedIds,
    upgradeOptimizationScopes: scopes,
    upgradeExecution: execution,
    storedEngineVersion: fixture.shared.workspace.engineVersion,
    currentEngineVersion: fixture.currentEngine
  });
  assert.equal(plan.runType, PLANNING_RUN_TYPES.ENGINE_UPGRADE);
  assert.equal(plan.baseRecalculationIds.length, 0);
  assert.ok(plan.schoolPackingCourseIds.length >= 6);
  assert.ok(plan.affectedIds.length < fixture.activities.length);
  assert.equal(plan.persistServerCheckpoints, true);
  assert.equal(plan.preloadRouteCache, false);
});

test('checkpoint envelope resume requires matching revision/engine/phase', () => {
  const rows = encodeCheckpointRows(
    [{ courseId: 'a', kind: 'proposal' }],
    {
      runType: PLANNING_RUN_TYPES.ENGINE_UPGRADE,
      phase: PLANNING_RUN_PHASES.VALIDATED,
      workspaceRevision: 11740,
      engineTo: 'planning-v28-x',
      dataFingerprint: 'data',
      contextFingerprint: 'ctx'
    }
  );
  const decoded = decodeCheckpointPayload({ rows, completedActivityIds: ['a'] });
  assert.equal(decoded.rows.length, 1);
  assert.equal(decoded.meta.phase, PLANNING_RUN_PHASES.VALIDATED);
  assert.equal(isCheckpointResumable({
    checkpoint: decoded,
    workspaceRevision: 11740,
    engineVersion: 'planning-v28-x',
    dataFingerprint: 'data',
    contextFingerprint: 'ctx',
    runType: PLANNING_RUN_TYPES.ENGINE_UPGRADE
  }), true);
  assert.equal(isCheckpointResumable({
    checkpoint: decoded,
    workspaceRevision: 1,
    engineVersion: 'planning-v28-x',
    dataFingerprint: 'data',
    contextFingerprint: 'ctx',
    runType: PLANNING_RUN_TYPES.ENGINE_UPGRADE
  }), false);
  assert.equal(isCheckpointResumable({
    checkpoint: { rows: [{ courseId: 'a' }], completedActivityIds: ['a'], meta: null },
    workspaceRevision: 11740,
    engineVersion: 'planning-v28-x',
    dataFingerprint: 'data',
    contextFingerprint: 'ctx',
    runType: PLANNING_RUN_TYPES.ENGINE_UPGRADE
  }), false);
});

test('resolvePlanningRunPlan rejects resume when current fingerprints differ from checkpoint', () => {
  const checkpointRows = encodeCheckpointRows(
    [{ courseId: 'a', kind: 'proposal' }, { courseId: 'b', kind: 'proposal' }],
    {
      runType: PLANNING_RUN_TYPES.ENGINE_UPGRADE,
      phase: PLANNING_RUN_PHASES.VALIDATED,
      workspaceRevision: 10,
      engineTo: 'planning-v29-x',
      dataFingerprint: 'old-data',
      contextFingerprint: 'old-ctx',
      baseRecalculationIds: [],
      schoolPackingCourseIds: ['a'],
      recruitmentRecoveryCourseIds: [],
      workdayConsolidationCourseIds: []
    }
  );
  const checkpoint = decodeCheckpointPayload({
    rows: checkpointRows,
    completedActivityIds: ['a', 'b']
  });
  const shared = {
    workspace: { engineVersion: 'planning-v28-x', revision: 10 },
    rows: [{ activityId: 'a', row: { courseId: 'a', kind: 'proposal' } }, { activityId: 'b', row: { courseId: 'b', kind: 'proposal' } }]
  };
  const staleData = resolvePlanningRunPlan({
    shared,
    currentCourseIds: ['a', 'b'],
    regularAffectedIds: [],
    engineUpgradeAffectedIds: ['a'],
    upgradeOptimizationScopes: { schoolPackingCourseIds: ['a'], affectedIds: ['a'] },
    upgradeExecution: {
      affectedIds: ['a'],
      baseRecalculationIds: [],
      upgradeOptimizationIds: ['a'],
      v28OptimizationUpgrade: true
    },
    storedEngineVersion: 'planning-v28-x',
    currentEngineVersion: 'planning-v29-x',
    currentDataFingerprint: 'live-data',
    currentContextFingerprint: 'old-ctx',
    resumableCheckpoint: checkpoint
  });
  assert.equal(staleData.runType, PLANNING_RUN_TYPES.ENGINE_UPGRADE);
  assert.equal(staleData.resume, null);

  const staleContext = resolvePlanningRunPlan({
    shared,
    currentCourseIds: ['a', 'b'],
    regularAffectedIds: [],
    engineUpgradeAffectedIds: ['a'],
    upgradeOptimizationScopes: { schoolPackingCourseIds: ['a'], affectedIds: ['a'] },
    upgradeExecution: {
      affectedIds: ['a'],
      baseRecalculationIds: [],
      upgradeOptimizationIds: ['a'],
      v28OptimizationUpgrade: true
    },
    storedEngineVersion: 'planning-v28-x',
    currentEngineVersion: 'planning-v29-x',
    currentDataFingerprint: 'old-data',
    currentContextFingerprint: 'live-ctx',
    resumableCheckpoint: checkpoint
  });
  assert.equal(staleContext.resume, null);

  const matching = resolvePlanningRunPlan({
    shared,
    currentCourseIds: ['a', 'b'],
    regularAffectedIds: [],
    engineUpgradeAffectedIds: ['a'],
    upgradeOptimizationScopes: { schoolPackingCourseIds: ['a'], affectedIds: ['a'] },
    upgradeExecution: {
      affectedIds: ['a'],
      baseRecalculationIds: [],
      upgradeOptimizationIds: ['a'],
      v28OptimizationUpgrade: true
    },
    storedEngineVersion: 'planning-v28-x',
    currentEngineVersion: 'planning-v29-x',
    currentDataFingerprint: 'old-data',
    currentContextFingerprint: 'old-ctx',
    resumableCheckpoint: checkpoint
  });
  assert.equal(matching.resume, checkpoint);
});

test('engine_marker_only advances once then becomes a true matching no-op', () => {
  const shared = {
    workspace: { engineVersion: 'planning-v28-x', revision: 5 },
    rows: [
      { activityId: 'live-1', row: { courseId: 'live-1', kind: 'live' } },
      { activityId: 'fixed-1', row: { courseId: 'fixed-1', kind: 'fixed' } }
    ]
  };
  const first = resolvePlanningRunPlan({
    shared,
    currentCourseIds: ['live-1', 'fixed-1'],
    regularAffectedIds: [],
    engineUpgradeAffectedIds: [],
    upgradeExecution: {
      affectedIds: [],
      baseRecalculationIds: [],
      upgradeOptimizationIds: [],
      v28OptimizationUpgrade: false
    },
    storedEngineVersion: 'planning-v28-x',
    currentEngineVersion: 'planning-v29-x',
    currentDataFingerprint: 'fp',
    currentContextFingerprint: 'ctx'
  });
  assert.equal(first.runType, PLANNING_RUN_TYPES.NO_OP);
  assert.equal(first.engineChanged, true);
  assert.equal(first.advanceEngineMarker, true);
  assert.deepEqual(first.affectedIds, []);
  assert.deepEqual(first.schoolPackingCourseIds, []);
  assert.equal(first.preloadRouteCache, false);
  assert.equal(first.reasons[0]?.code, 'engine_marker_only');

  const second = resolvePlanningRunPlan({
    shared: {
      ...shared,
      workspace: { ...shared.workspace, engineVersion: 'planning-v29-x', revision: 6 }
    },
    currentCourseIds: ['live-1', 'fixed-1'],
    regularAffectedIds: [],
    engineUpgradeAffectedIds: [],
    storedEngineVersion: 'planning-v29-x',
    currentEngineVersion: 'planning-v29-x',
    currentDataFingerprint: 'fp',
    currentContextFingerprint: 'ctx'
  });
  assert.equal(second.runType, PLANNING_RUN_TYPES.NO_OP);
  assert.equal(second.engineChanged, false);
  assert.equal(second.advanceEngineMarker, false);
  assert.equal(second.reasons[0]?.code, 'already_current');
});

test('screen commits engine_marker_only through empty incremental snapshot without planning work', async () => {
  const source = await readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
  assert.match(source, /advanceEngineMarker === true/);
  assert.match(source, /engine-marker-only/);
  assert.match(source, /saveSharedPlanningIncrementalSnapshot\(\{[\s\S]*?rows:\s*\[\]/);
  assert.match(source, /currentDataFingerprint:\s*startFingerprint/);
  assert.match(source, /currentContextFingerprint:\s*startContextStorage/);
  assert.doesNotMatch(source, /runPlan\.resume = null/);
  assert.match(source, /canCommitValidatedCheckpoint\(/);
});

test('validated checkpoint cannot commit when rows/meta/fingerprints diverge', () => {
  const baseMeta = {
    runType: PLANNING_RUN_TYPES.ENGINE_UPGRADE,
    phase: PLANNING_RUN_PHASES.VALIDATED,
    workspaceRevision: 20,
    engineTo: 'planning-v29-x',
    dataFingerprint: 'data-v1',
    contextFingerprint: 'ctx-v1',
    baseRecalculationIds: [],
    schoolPackingCourseIds: ['a', 'b'],
    recruitmentRecoveryCourseIds: ['c'],
    workdayConsolidationCourseIds: ['d']
  };
  const checkpoint = decodeCheckpointPayload({
    rows: encodeCheckpointRows(
      [
        { courseId: 'a', kind: 'proposal' },
        { courseId: 'b', kind: 'proposal' },
        { courseId: 'c', kind: 'recruitment' },
        { courseId: 'd', kind: 'proposal' }
      ],
      baseMeta
    ),
    completedActivityIds: ['a', 'b', 'c', 'd']
  });
  const okArgs = {
    checkpoint,
    workspaceRevision: 20,
    engineVersion: 'planning-v29-x',
    dataFingerprint: 'data-v1',
    contextFingerprint: 'ctx-v1',
    runType: PLANNING_RUN_TYPES.ENGINE_UPGRADE,
    requiredCourseIds: ['a', 'b', 'c', 'd'],
    expectedScope: {
      baseRecalculationIds: [],
      schoolPackingCourseIds: ['a', 'b'],
      recruitmentRecoveryCourseIds: ['c'],
      workdayConsolidationCourseIds: ['d']
    }
  };
  assert.equal(canCommitValidatedCheckpoint(okArgs), true);

  assert.equal(canCommitValidatedCheckpoint({
    ...okArgs,
    requiredCourseIds: ['a', 'b', 'c', 'd', 'missing']
  }), false, 'missing required rows must block commit');

  assert.equal(canCommitValidatedCheckpoint({
    ...okArgs,
    workspaceRevision: 21
  }), false, 'revision change must block commit');

  assert.equal(canCommitValidatedCheckpoint({
    ...okArgs,
    dataFingerprint: 'data-stale'
  }), false, 'data fingerprint change must block commit');

  assert.equal(canCommitValidatedCheckpoint({
    ...okArgs,
    contextFingerprint: 'ctx-stale'
  }), false, 'context fingerprint change must block commit');

  assert.equal(canCommitValidatedCheckpoint({
    ...okArgs,
    engineVersion: 'planning-v30-x'
  }), false, 'engine target change must block commit');

  assert.equal(canCommitValidatedCheckpoint({
    ...okArgs,
    runType: PLANNING_RUN_TYPES.FULL_MAINTENANCE
  }), false, 'run type mismatch must block commit');

  assert.equal(canCommitValidatedCheckpoint({
    ...okArgs,
    expectedScope: {
      ...okArgs.expectedScope,
      schoolPackingCourseIds: ['a', 'b', 'zzz']
    }
  }), false, 'scope/meta mismatch must block commit');

  const runningOnly = decodeCheckpointPayload({
    rows: encodeCheckpointRows(
      [{ courseId: 'a', kind: 'proposal' }],
      { ...baseMeta, phase: PLANNING_RUN_PHASES.RUNNING, schoolPackingCourseIds: ['a'], recruitmentRecoveryCourseIds: [], workdayConsolidationCourseIds: [] }
    ),
    completedActivityIds: ['a']
  });
  assert.equal(canCommitValidatedCheckpoint({
    ...okArgs,
    checkpoint: runningOnly,
    requiredCourseIds: ['a'],
    expectedScope: {
      baseRecalculationIds: [],
      schoolPackingCourseIds: ['a'],
      recruitmentRecoveryCourseIds: [],
      workdayConsolidationCourseIds: []
    }
  }), false, 'non-validated phase must not commit');
});

test('cooperative packing yields inside a heavy school group and stays under long-task budget', async () => {
  const { rowsById, activities } = heavySchoolRows('school-2991', 6, 16);
  let yields = 0;
  let maxSyncSlice = 0;
  let sliceStarted = performance.now();
  const result = await optimizeSchoolDayPackingPassCooperatively({
    rowsById,
    activities,
    maxExactNodes: 1000,
    yieldEveryNodes: 16,
    checkpoint: async () => {
      const now = performance.now();
      maxSyncSlice = Math.max(maxSyncSlice, now - sliceStarted);
      yields += 1;
      await new Promise((resolve) => setTimeout(resolve, 0));
      sliceStarted = performance.now();
    }
  });
  assert.equal(result.groups, 1);
  assert.ok(yields >= 4, `expected inner yields, got ${yields}`);
  assert.ok(maxSyncSlice < 200, `expected sync slices under 200ms in CI, got ${maxSyncSlice}`);
  assert.ok((result.longestSliceMs || 0) < 200 || yields >= 4);
});

test('cancellation aborts during packing inside a school group', async () => {
  const { rowsById, activities } = heavySchoolRows('school-cancel', 6, 14);
  let yields = 0;
  await assert.rejects(
    optimizeSchoolDayPackingPassCooperatively({
      rowsById,
      activities,
      maxExactNodes: 1000,
      yieldEveryNodes: 8,
      checkpoint: async () => {
        yields += 1;
        if (yields >= 3) throw new PlanningCancelledError();
      }
    }),
    (error) => error?.code === 'planning_cancelled'
  );
  assert.ok(yields >= 3);
  assert.ok(yields < 200, 'cancel must not wait for the whole school search to finish');
});

test('workspace-scale engine-upgrade scope stays far below national rebuild', () => {
  const fixture = workspaceScaleFixture();
  const scopes = planningEngineUpgradeOptimizationScopes({
    shared: fixture.shared,
    activities: fixture.activities,
    storedEngineVersion: fixture.shared.workspace.engineVersion,
    currentEngineVersion: fixture.currentEngine
  });
  const execution = planningEngineUpgradeExecutionScopes({
    regularAffectedIds: [],
    engineUpgradeAffectedIds: scopes.affectedIds,
    storedEngineVersion: fixture.shared.workspace.engineVersion,
    currentEngineVersion: fixture.currentEngine
  });
  assert.equal(execution.v28OptimizationUpgrade, true);
  assert.equal(execution.baseRecalculationIds.length, 0);
  assert.ok(scopes.schoolPackingCourseIds.length >= 6);
  assert.ok(scopes.affectedIds.length < fixture.activities.length, `upgrade scope ${scopes.affectedIds.length} must stay below national ${fixture.activities.length}`);
  assert.ok(scopes.affectedIds.length <= fixture.activities.length - 20, 'upgrade must leave a meaningful set of untouched rows');
});

test('createPlanningCheckpoint still cancels through cooperative packing', async () => {
  const { rowsById, activities } = heavySchoolRows('school-signal', 5, 12);
  const controller = new AbortController();
  let yields = 0;
  const checkpoint = createPlanningCheckpoint({
    budgetMs: 0,
    signal: controller.signal,
    yieldControl: async () => {
      yields += 1;
      if (yields >= 2) controller.abort();
    }
  });
  await assert.rejects(
    optimizeSchoolDayPackingPassCooperatively({
      rowsById,
      activities,
      maxExactNodes: 800,
      yieldEveryNodes: 4,
      checkpoint
    }),
    (error) => error?.code === 'planning_cancelled'
  );
});

test('legacy validity audit never persists while engine/validation version is behind', async () => {
  const source = await readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
  assert.match(source, /persist:\s*!data\._is_stale\s*&&\s*!validationChanged/);
  assert.doesNotMatch(source, /void validationChanged/);
  assert.match(source, /!isPlanningValidationCurrent\(storedEngineVersion\)/);
  assert.doesNotMatch(source, /\.includes\(PLANNING_VALIDATION_VERSION\)/);
});

test('matching PLANNING_ENGINE_VERSION is validation-current (no bogus includes SoT)', async () => {
  const {
    PLANNING_ENGINE_VERSION,
    PLANNING_VALIDATION_VERSION,
    isPlanningValidationCurrent
  } = await import('../frontend/src/screens/course-scheduling-planning.js');
  assert.equal(isPlanningValidationCurrent(PLANNING_ENGINE_VERSION), true);
  assert.equal(
    String(PLANNING_ENGINE_VERSION || '').includes(PLANNING_VALIDATION_VERSION),
    false,
    'engine token must not be assumed to contain the validation token'
  );
  assert.equal(isPlanningValidationCurrent('planning-v27-anything'), false);
  assert.equal(isPlanningValidationCurrent(''), false);
});

test('engine-upgrade refuses reused UI/session snapshot and validates the end source token', async () => {
  const source = await readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
  assert.match(source, /allowReuseSnapshot = String\(data\._planningSourceRevision\)/);
  assert.match(source, /&& reuseSnapshot === true/);
  assert.match(source, /!engineMismatchForSnapshot/);
  assert.match(source, /snapshot-source/);
  assert.match(source, /const endFacts = await loadSchedulingPlanningPreflight\(scope\)/);
  const updateHandlerStart = source.indexOf("root.querySelector('[data-run-course-planning]')?.addEventListener");
  const updateHandlerEnd = source.indexOf("root.querySelector('[data-refresh-shared-planning]')", updateHandlerStart);
  const updateHandler = source.slice(updateHandlerStart, updateHandlerEnd);
  assert.match(updateHandler, /const reuseSnapshot = !engineMismatch/);
});

test('VALIDATED checkpoint is written only after authoritative end fingerprint validation', async () => {
  const source = await readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
  const endCheck = source.indexOf('if (String(endFacts.sourceRevision)');
  const validatedWrite = source.indexOf('phase: PLANNING_RUN_PHASES.VALIDATED', endCheck);
  assert.ok(endCheck >= 0, 'expected end fingerprint gate');
  assert.ok(validatedWrite > endCheck, 'VALIDATED must come after end fingerprint check');
  // No VALIDATED write may appear before the end fingerprint gate inside the run.
  const runStart = source.indexOf('const runCoursePlanning = async');
  const prematureValidated = source.slice(runStart, endCheck).includes('phase: PLANNING_RUN_PHASES.VALIDATED');
  assert.equal(prematureValidated, false, 'must not stamp VALIDATED before end validation');
  assert.match(source, /planning_source_revision_conflict/);
});

test('production recovery from v27/rev11741/dirty113 rejects stale checkpoint and stays engine-upgrade', () => {
  const fixture = workspaceScaleFixture();
  // Mirror the live failed-upgrade workspace: revision already bumped, dirty rows present.
  const dirtyIds = fixture.activities.slice(0, 113).map((row) => row.row_id);
  const shared = {
    workspace: {
      engineVersion: fixture.shared.workspace.engineVersion,
      revision: 11741
    },
    rows: fixture.shared.rows.map((entry) => ({
      ...entry,
      needsRecalc: dirtyIds.includes(entry.activityId)
    }))
  };
  const scopes = planningEngineUpgradeOptimizationScopes({
    shared,
    activities: fixture.activities,
    storedEngineVersion: shared.workspace.engineVersion,
    currentEngineVersion: fixture.currentEngine
  });
  const execution = planningEngineUpgradeExecutionScopes({
    regularAffectedIds: dirtyIds,
    engineUpgradeAffectedIds: scopes.affectedIds,
    storedEngineVersion: shared.workspace.engineVersion,
    currentEngineVersion: fixture.currentEngine
  });
  const staleCheckpoint = decodeCheckpointPayload({
    rows: encodeCheckpointRows(
      dirtyIds.slice(0, 5).map((courseId) => ({ courseId, kind: 'proposal' })),
      {
        runType: PLANNING_RUN_TYPES.ENGINE_UPGRADE,
        phase: PLANNING_RUN_PHASES.VALIDATED,
        workspaceRevision: 11740,
        engineTo: fixture.currentEngine,
        dataFingerprint: 'old',
        contextFingerprint: 'old',
        baseRecalculationIds: [],
        schoolPackingCourseIds: scopes.schoolPackingCourseIds.slice(0, 3),
        recruitmentRecoveryCourseIds: [],
        workdayConsolidationCourseIds: []
      }
    ),
    completedActivityIds: dirtyIds.slice(0, 5)
  });

  const plan = resolvePlanningRunPlan({
    shared,
    currentCourseIds: fixture.activities.map((row) => row.row_id),
    regularAffectedIds: dirtyIds,
    engineUpgradeAffectedIds: scopes.affectedIds,
    upgradeOptimizationScopes: scopes,
    upgradeExecution: execution,
    storedEngineVersion: shared.workspace.engineVersion,
    currentEngineVersion: fixture.currentEngine,
    currentDataFingerprint: 'live-data',
    currentContextFingerprint: 'live-ctx',
    resumableCheckpoint: staleCheckpoint
  });

  assert.equal(plan.runType, PLANNING_RUN_TYPES.ENGINE_UPGRADE);
  assert.notEqual(plan.runType, PLANNING_RUN_TYPES.FULL_MAINTENANCE);
  assert.equal(plan.resume, null, 'checkpoint for rev 11740 must be rejected against workspace 11741');
  assert.ok(plan.baseRecalculationIds.length >= 1, 'dirty rows must drive incremental base work');
  assert.ok(plan.baseRecalculationIds.length <= dirtyIds.length);
  assert.ok(plan.affectedIds.length < fixture.activities.length, 'recovery must not become national rebuild');
  assert.equal(plan.preloadRouteCache, false);

  const afterSuccess = resolvePlanningRunPlan({
    shared: {
      workspace: { engineVersion: fixture.currentEngine, revision: 11742 },
      rows: shared.rows.map((entry) => ({ ...entry, needsRecalc: false }))
    },
    currentCourseIds: fixture.activities.map((row) => row.row_id),
    regularAffectedIds: [],
    engineUpgradeAffectedIds: [],
    storedEngineVersion: fixture.currentEngine,
    currentEngineVersion: fixture.currentEngine,
    currentDataFingerprint: 'live-data',
    currentContextFingerprint: 'live-ctx'
  });
  assert.equal(afterSuccess.runType, PLANNING_RUN_TYPES.NO_OP);
  assert.equal(afterSuccess.advanceEngineMarker, false);
  assert.deepEqual(afterSuccess.baseRecalculationIds, []);
  assert.deepEqual(afterSuccess.schoolPackingCourseIds, []);
  assert.deepEqual(afterSuccess.recruitmentRecoveryCourseIds, []);
  assert.deepEqual(afterSuccess.workdayConsolidationCourseIds, []);
  assert.equal(afterSuccess.persistServerCheckpoints, false);
  assert.equal(afterSuccess.preloadRouteCache, false);
});

test('acceptance: recovery to dirty=0 + matching engine stays audit-clean and true no-op', async () => {
  const {
    PLANNING_ENGINE_VERSION,
    isPlanningValidationCurrent
  } = await import('../frontend/src/screens/course-scheduling-planning.js');
  const {
    auditStoredPlanningHardGates
  } = await import('../frontend/src/screens/course-scheduling-date-adjustments.js');

  assert.equal(isPlanningValidationCurrent(PLANNING_ENGINE_VERSION), true);

  // Simulate post-incremental workspace: engine current, dirty cleared.
  const date = '2027-01-04'; // Monday UTC
  const activityId = 'act-clean';
  const shared = {
    workspace: { engineVersion: PLANNING_ENGINE_VERSION, revision: 11748 },
    rows: [
      {
        activityId,
        needsRecalc: false,
        row: {
          kind: 'proposal',
          courseId: activityId,
          schoolId: '2215',
          instructorEmpId: '100',
          meetings: [{ date, start_time: '09:00', end_time: '10:00' }]
        }
      }
    ]
  };
  const activities = [{
    row_id: activityId,
    sessions: 1,
    school_id: 2215,
    calendar_sector: 'druze',
    instruction_language: 'he',
    required_instructor_gender: 'any'
  }];
  const schoolCalendar = [
    {
      calendar_sector: 'arab',
      blocks_scheduling: true,
      is_active: true,
      start_date: date,
      end_date: date,
      title: 'חופשה ערבית שאינה חלה על דרוזי'
    },
    {
      calendar_sector: 'jewish',
      blocks_scheduling: true,
      is_active: true,
      start_date: date,
      end_date: date,
      title: 'חופשה יהודית שאינה חלה על דרוזי'
    }
  ];
  const rules = {
    100: [0, 1, 2, 3, 4, 5].map((weekday) => ({
      weekday,
      available: true,
      start_time: '08:00',
      end_time: '16:00'
    }))
  };

  // Reload validity audit must not invent dirty rows when the plan is sector-correct.
  const audit = auditStoredPlanningHardGates({
    shared,
    activities,
    instructors: [{ emp_id: '100', active: 'yes' }],
    profiles: { 100: { gender: 'female', instruction_languages: ['he'] } },
    rules,
    exceptions: {},
    schoolCalendar
  });
  assert.deepEqual(audit.invalidActivityIds, []);
  assert.equal(audit.hardGateInvalidCount, 0);
  assert.equal(shared.rows.filter((row) => row.needsRecalc).length, 0);

  // Second run with matching engine + dirty=0 is a true no-op: no recalc/packing/routes/checkpoint.
  const plan = resolvePlanningRunPlan({
    shared,
    currentCourseIds: [activityId],
    regularAffectedIds: [],
    engineUpgradeAffectedIds: [],
    storedEngineVersion: PLANNING_ENGINE_VERSION,
    currentEngineVersion: PLANNING_ENGINE_VERSION,
    currentDataFingerprint: 'fp',
    currentContextFingerprint: 'ctx'
  });
  assert.equal(plan.runType, PLANNING_RUN_TYPES.NO_OP);
  assert.equal(plan.advanceEngineMarker, false);
  assert.deepEqual(plan.baseRecalculationIds, []);
  assert.deepEqual(plan.schoolPackingCourseIds, []);
  assert.deepEqual(plan.recruitmentRecoveryCourseIds, []);
  assert.deepEqual(plan.workdayConsolidationCourseIds, []);
  assert.deepEqual(plan.affectedIds, []);
  assert.equal(plan.persistServerCheckpoints, false);
  assert.equal(plan.preloadRouteCache, false);
});

test('real source change fences every canonical commit before a validated checkpoint', async () => {
  const source = await readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
  assert.match(source, /throw new Error\('planning_source_revision_conflict'\)/);
  assert.match(source, /throw new Error\('planning_revision_conflict'\)/);
  // Full VALIDATED+commit path is gated by matching fingerprints.
  const endGate = source.indexOf('if (String(endFacts.sourceRevision)');
  const validated = source.indexOf('phase: PLANNING_RUN_PHASES.VALIDATED', endGate);
  const commit = source.indexOf('const commitExpectedRevision', validated);
  assert.ok(validated > endGate);
  assert.ok(commit > validated);
});
