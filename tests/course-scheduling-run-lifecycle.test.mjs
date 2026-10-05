import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  PLANNING_RUN_PHASES,
  PLANNING_RUN_TYPES,
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
