import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import {
  PLANNING_RUN_PHASES,
  PLANNING_RUN_STAGES,
  PLANNING_RUN_TYPES,
  canCommitValidatedCheckpoint,
  canValidateCompletedRunningCheckpoint,
  planningResumeReopenIds
} from '../frontend/src/screens/course-scheduling-run-plan.js';
import { buildDynamicCoursePlan, createPlanningLocalRepairDeadlineCheckpoint, recoverPlanningOverlapFromCommittedProposals, validateResumedPlanningRows } from '../frontend/src/screens/course-scheduling-planning.js';
import {
  planningRebaseAffectedCourseIds,
  planningRowReflaggedDuringRun
} from '../frontend/src/screens/course-scheduling-planning-store.js';

const screenSource = await readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
const plannerSource = await readFile(new URL('../frontend/src/screens/course-scheduling-planning.js', import.meta.url), 'utf8');

const ids = Array.from({ length: 253 }, (_, index) => `course-${index + 1}`);
const scope = {
  baseRecalculationIds: ids.slice(0, 104),
  schoolPackingCourseIds: ids.slice(0, 104),
  recruitmentRecoveryCourseIds: [],
  workdayConsolidationCourseIds: []
};
const live = {
  workspaceRevision: 11946,
  engineVersion: 'planning-v35',
  dataFingerprint: 'data-fp',
  contextFingerprint: 'context-fp',
  sourceRevision: 239,
  runType: PLANNING_RUN_TYPES.ENGINE_UPGRADE
};

function checkpoint({
  phase = PLANNING_RUN_PHASES.RUNNING,
  completed = ids,
  sourceRevision = 239,
  planningStage = PLANNING_RUN_STAGES.PLANNED
} = {}) {
  return {
    completedActivityIds: completed,
    rows: completed.map((courseId) => ({ courseId, kind: 'proposal' })),
    meta: {
      ...scope,
      phase,
      planningStage,
      runType: PLANNING_RUN_TYPES.ENGINE_UPGRADE,
      sourceRevision,
      workspaceRevision: 11946,
      engineTo: 'planning-v35',
      dataFingerprint: 'data-fp',
      contextFingerprint: 'context-fp'
    }
  };
}

test('253/253 RUNNING checkpoint goes to validation instead of a fresh run, never straight to commit', () => {
  const input = { ...live, requiredCourseIds: ids, expectedScope: scope };
  assert.equal(canValidateCompletedRunningCheckpoint({ ...input, checkpoint: checkpoint() }), true);
  // Still not committable without validation.
  assert.equal(canCommitValidatedCheckpoint({ ...input, checkpoint: checkpoint() }), false);
  // A VALIDATED checkpoint keeps the existing direct-commit path.
  assert.equal(canCommitValidatedCheckpoint({ ...input, checkpoint: checkpoint({ phase: PLANNING_RUN_PHASES.VALIDATED }) }), true);
  assert.equal(canValidateCompletedRunningCheckpoint({ ...input, checkpoint: checkpoint({ phase: PLANNING_RUN_PHASES.VALIDATED }) }), false);
});

test('253/253 rows alone never skip unfinished optimization passes', () => {
  const input = { ...live, requiredCourseIds: ids, expectedScope: scope };
  // Production shape: every row present, but no proof the planner finished.
  assert.equal(canValidateCompletedRunningCheckpoint({ ...input, checkpoint: checkpoint({ planningStage: null }) }), false);
  assert.equal(canValidateCompletedRunningCheckpoint({ ...input, checkpoint: checkpoint({ planningStage: PLANNING_RUN_STAGES.ROWS }) }), false);
  assert.equal(canValidateCompletedRunningCheckpoint({ ...input, checkpoint: checkpoint({ planningStage: PLANNING_RUN_STAGES.PLANNED }) }), true);
});

test('partial resume re-opens unassigned rows so the existing-staff rescue runs again', () => {
  const reopened = planningResumeReopenIds([
    { courseId: 'p', kind: 'proposal', instructorEmpId: '1' },
    { courseId: 'fp', kind: 'fixed-proposal', instructorEmpId: '1' },
    { courseId: 'lock', kind: 'planning-locked', instructorEmpId: '1' },
    { courseId: 'live', kind: 'live', instructorEmpId: '1' },
    { courseId: 'm', kind: 'missing' },
    { courseId: 'r', kind: 'recruitment' },
    { courseId: 'f', kind: 'fixed' },
    { courseId: 'deferred', kind: 'missing', diagnostics: { rescueDeferred: true } },
    { courseId: 'incomplete', kind: 'proposal', diagnostics: { searchIncomplete: true } }
  ]);
  assert.deepEqual(reopened.sort(), ['deferred', 'f', 'incomplete', 'm', 'r']);
});

test('partial or stale RUNNING checkpoints are not treated as complete', () => {
  const input = { ...live, requiredCourseIds: ids, expectedScope: scope };
  assert.equal(canValidateCompletedRunningCheckpoint({ ...input, checkpoint: checkpoint({ completed: ids.slice(0, 200) }) }), false);
  assert.equal(canValidateCompletedRunningCheckpoint({ ...input, checkpoint: checkpoint({ sourceRevision: 238 }) }), false);
  assert.equal(canValidateCompletedRunningCheckpoint({ ...input, dataFingerprint: 'changed', checkpoint: checkpoint() }), false);
  assert.equal(canValidateCompletedRunningCheckpoint({ ...input, workspaceRevision: 11947, checkpoint: checkpoint() }), false);
  assert.equal(canValidateCompletedRunningCheckpoint({
    ...input,
    expectedScope: { ...scope, baseRecalculationIds: ids.slice(0, 105) },
    checkpoint: checkpoint()
  }), false);
  assert.equal(canValidateCompletedRunningCheckpoint({ ...input, requiredCourseIds: [], checkpoint: checkpoint() }), false);
});

const activity = (rowId, extra = {}) => ({
  row_id: rowId,
  activity_season: 'school_2027',
  activity_type: 'course',
  activity_family: 'program',
  status: 'פתוח',
  activity_name: 'תוכנית בדיקה',
  activity_no: '100',
  authority: 'רשות',
  school: `בית ספר ${rowId}`,
  school_id: `school-${rowId}`,
  school_address: `כתובת ${rowId}`,
  sessions: 2,
  date_1: '2026-11-02',
  date_2: '2026-11-09',
  start_time: '09:00',
  end_time: '10:30',
  instruction_language: 'he',
  required_instructor_gender: 'any',
  updated_at: '2026-10-01T00:00:00Z',
  ...extra
});
const proposal = (courseId, empId, date = '2026-11-02') => ({
  courseId,
  kind: 'proposal',
  instructorEmpId: empId,
  schoolId: `school-${courseId}`,
  meetings: [{ date, start_time: '09:00', end_time: '10:30', instructor_emp_id: empId }]
});

test('mid-run source change rebases only the changed activity and its instructor/date dependents', () => {
  const start = [activity('a'), activity('b'), activity('c'), activity('d')];
  const now = [activity('a', { updated_at: '2026-10-09T00:00:00Z' }), activity('b'), activity('c'), activity('d')];
  const resultRows = [proposal('a', '1'), proposal('b', '1'), proposal('c', '2'), proposal('d', '3', '2026-12-07')];
  const delta = planningRebaseAffectedCourseIds({
    resultRows,
    startActivities: start,
    activities: now,
    currentCourseIds: ['a', 'b', 'c', 'd'],
    startShared: { rows: [] },
    currentShared: { rows: [] }
  });
  // b shares instructor 1 on the same date; c (instructor 2) and d are untouched.
  assert.deepEqual(delta.sort(), ['a', 'b']);
});

test('rebase includes rows newly flagged needs_recalc but not rows already dirty when the run started', () => {
  const acts = [activity('a'), activity('b'), activity('c')];
  const delta = planningRebaseAffectedCourseIds({
    resultRows: [proposal('a', '1'), proposal('b', '2'), proposal('c', '3')],
    startActivities: acts,
    activities: acts,
    currentCourseIds: ['a', 'b', 'c'],
    startShared: { rows: [{ activityId: 'a', needsRecalc: true }] },
    currentShared: { rows: [
      { activityId: 'a', needsRecalc: true, needsRecalcMarkedAt: '2026-10-08T20:00:00.000Z' },
      { activityId: 'c', needsRecalc: true, needsRecalcMarkedAt: '2026-10-09T01:10:00.000Z' }
    ] },
    runStartedAt: '2026-10-09T01:00:00.000Z'
  });
  assert.deepEqual(delta, ['c']);
});

test('instructor availability change during a run rebases only rows that depend on that instructor', () => {
  const acts = [activity('a'), activity('b'), activity('c')];
  const delta = planningRebaseAffectedCourseIds({
    resultRows: [proposal('a', '1'), proposal('b', '2'), proposal('c', '3')],
    startActivities: acts,
    activities: acts,
    currentCourseIds: ['a', 'b', 'c'],
    contextDiff: { changedAvailabilityInstructorIds: ['2'] },
    startShared: { rows: [] },
    currentShared: { rows: [] }
  });
  assert.deepEqual(delta, ['b']);
});

test('a row dirty at start and flagged again during the run is rechecked', () => {
  const acts = [activity('a'), activity('b'), activity('c')];
  const startedAt = '2026-10-09T01:00:00.000Z';
  const base = {
    resultRows: [proposal('a', '1'), proposal('b', '2'), proposal('c', '3', '2026-12-07')],
    startActivities: acts,
    activities: acts,
    currentCourseIds: ['a', 'b', 'c'],
    startShared: { rows: ['a', 'b', 'c'].map((activityId) => ({ activityId, needsRecalc: true })) },
    runStartedAt: startedAt
  };
  const delta = planningRebaseAffectedCourseIds({
    ...base,
    currentShared: { rows: [
      // route / substitution / approval stamp after the run started
      { activityId: 'a', needsRecalc: true, needsRecalcMarkedAt: '2026-10-09T01:20:00.000Z' },
      // flagged long before the run: this run already recalculated it
      { activityId: 'b', needsRecalc: true, needsRecalcMarkedAt: '2026-10-08T20:00:00.000Z' },
      // no flag time at all: cannot be proven current, so it is rechecked
      { activityId: 'c', needsRecalc: true, needsRecalcMarkedAt: '' }
    ] }
  });
  assert.deepEqual(delta.sort(), ['a', 'c']);
  // Server without flag times: cannot prove freshness, so every still-dirty row is rechecked.
  const conservative = planningRebaseAffectedCourseIds({
    ...base,
    currentShared: { rows: ['a', 'b', 'c'].map((activityId) => ({ activityId, needsRecalc: true, needsRecalcMarkedAt: null })) }
  });
  assert.deepEqual(conservative.sort(), ['a', 'b', 'c']);
});

test('flag-time comparison keeps a safety margin and fails closed', () => {
  const startedAt = '2026-10-09T01:00:00.000Z';
  assert.equal(planningRowReflaggedDuringRun({ needsRecalc: false, needsRecalcMarkedAt: null }, startedAt), false);
  assert.equal(planningRowReflaggedDuringRun({ needsRecalc: true, needsRecalcMarkedAt: null }, startedAt), true);
  assert.equal(planningRowReflaggedDuringRun({ needsRecalc: true, needsRecalcMarkedAt: '' }, startedAt), true);
  assert.equal(planningRowReflaggedDuringRun({ needsRecalc: true, needsRecalcMarkedAt: 'not-a-date' }, startedAt), true);
  assert.equal(planningRowReflaggedDuringRun({ needsRecalc: true }, startedAt), true);
  assert.equal(planningRowReflaggedDuringRun({ needsRecalc: true, needsRecalcMarkedAt: '2026-10-09T00:59:00.000Z' }, startedAt), true);
  assert.equal(planningRowReflaggedDuringRun({ needsRecalc: true, needsRecalcMarkedAt: '2026-10-09T00:50:00.000Z' }, startedAt), false);
  assert.equal(planningRowReflaggedDuringRun({ needsRecalc: true, needsRecalcMarkedAt: '2026-10-09T00:50:00.000Z' }, ''), true);
});

test('no detected change keeps the whole calculated plan (empty delta)', () => {
  const acts = [activity('a'), activity('b')];
  const delta = planningRebaseAffectedCourseIds({
    resultRows: [proposal('a', '1'), proposal('b', '2')],
    startActivities: acts,
    activities: acts,
    currentCourseIds: ['a', 'b'],
    startShared: { rows: [] },
    currentShared: { rows: [] }
  });
  assert.deepEqual(delta, []);
});

const instructors = [
  { emp_id: '1', full_name: 'מדריך א', active: 'yes', address: 'כתובת א' },
  { emp_id: '2', full_name: 'מדריך ב', active: 'yes', address: 'כתובת ב' }
];
const profiles = {
  1: { emp_id: '1', gender: 'male', instruction_languages: ['he'], friday_allowed: false },
  2: { emp_id: '2', gender: 'male', instruction_languages: ['he'], friday_allowed: false }
};
const rules = Object.fromEntries(instructors.map(({ emp_id }) => [emp_id, [0, 1, 2, 3, 4].map((weekday) => ({
  emp_id, weekday, available: true, start_time: '07:00', end_time: '18:00'
}))]));
const catalog = [{ activity_no: '100', activity_name: 'תוכנית בדיקה', meetings_count: 2, hours_count: 3 }];
const routeClient = () => ({
  request: async () => ({ distance_km: 5, duration_minutes: 10, cached: true }),
  unavailableReason: '',
  googleCalls: 0,
  cacheHits: 0,
  requests: []
});

const resumedProposal = (courseId, empId, d1, d2) => ({
  courseId,
  kind: 'proposal',
  schoolId: `school-${courseId}`,
  instructorEmpId: empId,
  instructorName: `מדריך ${empId}`,
  startDate: d1,
  endDate: d2,
  startTime: '09:00',
  endTime: '10:30',
  meetings: [
    { date: d1, start_time: '09:00', end_time: '10:30' },
    { date: d2, start_time: '09:00', end_time: '10:30' }
  ],
  options: []
});
const resumeBase = {
  activities: [activity('a'), activity('b'), activity('c', { date_1: '2026-12-07', date_2: '2026-12-14' })],
  instructors, profiles, rules, exceptions: {}, schoolCalendar: [], catalog
};

test('resumed complete checkpoint is validated without re-planning and keeps every row', async () => {
  const rows = [
    resumedProposal('a', '1', '2026-11-02', '2026-11-09'),
    resumedProposal('b', '2', '2026-11-02', '2026-11-09'),
    resumedProposal('c', '2', '2026-12-07', '2026-12-14')
  ];
  const startedAt = performance.now();
  const resumed = await validateResumedPlanningRows({ ...resumeBase, rows, routeClient: routeClient() });
  const elapsed = performance.now() - startedAt;
  assert.equal(resumed.valid, true);
  assert.deepEqual(resumed.repairCourseIds, []);
  assert.deepEqual(
    resumed.rows.map((row) => [row.courseId, row.kind, row.instructorEmpId]),
    rows.map((row) => [row.courseId, row.kind, row.instructorEmpId])
  );
  assert.ok(elapsed < 2000, `validation-only resume took ${elapsed}ms`);
});

test('resumed checkpoint with a hard conflict reports only a bounded repair delta', async () => {
  const rows = [
    resumedProposal('a', '1', '2026-11-02', '2026-11-09'),
    resumedProposal('b', '1', '2026-11-02', '2026-11-09'),
    resumedProposal('c', '2', '2026-12-07', '2026-12-14')
  ];
  const resumed = await validateResumedPlanningRows({ ...resumeBase, rows, routeClient: routeClient() });
  assert.equal(resumed.valid, false);
  assert.ok(resumed.failures.some((failure) => failure.reason === 'overlap'));
  assert.deepEqual(resumed.repairCourseIds.sort(), ['a', 'b']);
  assert.ok(!resumed.repairCourseIds.includes('c'), 'unrelated activity must not be replanned');
});

test('resume with no unfinished rows still runs gap compaction over the original scope', async () => {
  const rows = [
    resumedProposal('a', '1', '2026-11-02', '2026-11-09'),
    resumedProposal('b', '2', '2026-11-02', '2026-11-09'),
    resumedProposal('c', '2', '2026-12-07', '2026-12-14')
  ];
  const phasesFor = async (extra) => {
    const phases = [];
    await buildDynamicCoursePlan({
      ...resumeBase,
      today: '2026-10-06',
      routeClient: routeClient(),
      existingRows: rows,
      targetCourseIds: [],
      planningProfile: 'fast',
      allowGlobalRepair: false,
      onProgress: ({ phase }) => { phases.push(phase); },
      ...extra
    });
    return phases;
  };
  // Old resume: the scope collapsed to the unfinished rows, so the pass vanished.
  assert.equal((await phasesFor({})).includes('צמצום חלונות הושלם'), false);
  // Resume now keeps the original scope for every optimization pass.
  assert.equal((await phasesFor({ optimizationScopeCourseIds: ['a', 'b'] })).includes('צמצום חלונות הושלם'), true);
});

test('interrupted run: unassigned rows re-enter base planning (staff rescue) and every optimization pass runs on the original scope', async () => {
  const interrupted = [
    resumedProposal('a', '1', '2026-11-02', '2026-11-09'),
    resumedProposal('b', '2', '2026-11-02', '2026-11-09'),
    { courseId: 'c', kind: 'missing', schoolId: 'school-c', diagnostics: { rescueDeferred: true, searchIncomplete: true } }
  ];
  const reopened = planningResumeReopenIds(interrupted);
  assert.deepEqual(reopened, ['c']);
  const evaluated = new Set();
  const phases = [];
  await buildDynamicCoursePlan({
    ...resumeBase,
    today: '2026-10-06',
    routeClient: routeClient(),
    existingRows: interrupted,
    targetCourseIds: reopened,
    optimizationScopeCourseIds: ['a', 'b', 'c'],
    planningProfile: 'fast',
    allowGlobalRepair: false,
    onProgress: ({ phase, courseId }) => {
      phases.push(phase);
      if (phase === 'בדיקת מדריכים' && courseId) evaluated.add(courseId);
    }
  });
  // Instructor-hours path: the unassigned row is searched again; assigned rows are reused.
  assert.deepEqual([...evaluated], ['c']);
  // Utilization passes are not skipped by the interruption.
  for (const phase of ['אריזת בתי ספר הושלמה', 'ריכוז ימי עבודה הושלם', 'צמצום חלונות הושלם', 'בקרת תקינות סופית']) {
    assert.ok(phases.includes(phase), `missing pass: ${phase}`);
  }
});

test('run wiring: planner completion is recorded explicitly and resume keeps optimization scope', () => {
  const run = screenSource.slice(screenSource.indexOf('const runCoursePlanning = async'), screenSource.indexOf('const clonePlanningOption'));
  assert.match(run, /planningStage: resumeCompletedRunning \? PLANNING_RUN_STAGES\.PLANNED : PLANNING_RUN_STAGES\.ROWS/);
  assert.match(run, /optimizationScopeCourseIds: resumeOptimizationScopeIds/);
  assert.match(run, /planningResumeReopenIds\(resumableRows\)/);
  const plannedMark = run.indexOf('checkpointMetaBase.planningStage = PLANNING_RUN_STAGES.PLANNED;\n          if (persistServerCheckpoints');
  const mainPlanner = run.indexOf('result = await buildDynamicPlanWithCommittedRecovery({');
  const endGate = run.indexOf('const endFacts = await loadSchedulingPlanningPreflight(scope);');
  const validated = run.indexOf('phase: PLANNING_RUN_PHASES.VALIDATED,');
  assert.ok(mainPlanner > 0 && plannedMark > mainPlanner, 'planned stage only after the planner returns');
  assert.ok(endGate > plannedMark && validated > endGate, 'stage → end validation → VALIDATED → commit');
  assert.match(run, /runStartedAt: rebaseBaseStartedAt/);
});

test('run wiring: completed RUNNING checkpoint skips the planner and source conflicts rebase instead of aborting', () => {
  const run = screenSource.slice(screenSource.indexOf('const runCoursePlanning = async'), screenSource.indexOf('const clonePlanningOption'));
  assert.match(run, /if \(resumeCompletedRunning\) \{[\s\S]*?validateResumedPlanningRows\(/);
  assert.match(run, /const resumeFromCheckpoint = !resumeValidatedCommit\s*&& !resumeCompletedRunning/);
  // Checkpoint save conflicts mark the checkpoint stale instead of aborting the run.
  assert.match(run, /if \(isSourceRevisionConflict\(error\)\) \{ checkpointSourceStale = true; return; \}\s*throwIfPlanningRunInvalidated\(error\)/);
  // End gate rebases a bounded delta, re-fences the new source revision, and still
  // refuses workspace-revision conflicts and repeated churn.
  const endGate = run.indexOf('if (String(endFacts.sourceRevision) === String(run.sourceRevision)) break;');
  assert.ok(endGate > 0);
  const gate = run.slice(endGate - 600, run.indexOf('assertRunOwnership();\n        // Source is still valid'));
  assert.match(gate, /throw new Error\('planning_revision_conflict'\)/);
  assert.match(gate, /if \(rebaseAttempt >= 2\) throw new Error\('planning_source_revision_conflict'\)/);
  assert.match(gate, /planningRebaseAffectedCourseIds\(/);
  assert.match(gate, /run\.sourceRevision = endFacts\.sourceRevision/);
  assert.match(gate, /persistedCheckpointRows\.clear\(\)/);
});

test('period/district filter change keeps the loaded shared plan and an active run on screen', () => {
  const handler = screenSource.slice(
    screenSource.indexOf('const onPlanningScopeFilterChange'),
    screenSource.indexOf("root.querySelector('[data-planning-period-filter]')")
  );
  assert.match(handler, /state\.courseSchedulingPlanningLoading\s*\|\| \(state\.courseSchedulingPlanningSharedLoaded && data\._planningSharedLoadedKey === scope\.key\)/);
  assert.match(handler, /rerenderPreservingWorkboardScroll\(\);\s*return;/);
});


test('real-world overlap recovery keeps the prior conflict-free instructor instead of discarding all 253 proposals', async () => {
  const dates = ['2026-11-02', '2026-11-09'];
  const a = resumedProposal('a', '1', ...dates);
  const b = resumedProposal('b', '1', ...dates);
  const c = resumedProposal('c', '2', '2026-12-07', '2026-12-14');
  const failure = {
    code: 'planning_final_validation_failed',
    rows: [a, b, c],
    failures: [{ reason: 'overlap', date: dates[0], empId: '1', firstCourseId: 'a', secondCourseId: 'b' }]
  };
  const committedRows = [a, resumedProposal('b', '2', ...dates), c];
  const fixed = await recoverPlanningOverlapFromCommittedProposals({
    ...resumeBase, error: failure, committedRows, routeClient: routeClient()
  });
  assert.ok(fixed, 'a validated saved proposal should resolve the new overlap');
  assert.deepEqual(fixed.restoredCourseIds, ['b'], 'only the conflicting changed proposal should be restored');
  assert.equal(fixed.rows.find((row) => row.courseId === 'a').instructorEmpId, '1');
  assert.equal(fixed.rows.find((row) => row.courseId === 'b').instructorEmpId, '2');
  assert.equal(fixed.rows.length, 3, 'unrelated rows are retained');
});

test('overlap recovery never overrides a locked plan or invents an unverified alternative', async () => {
  const dates = ['2026-11-02', '2026-11-09'];
  const a = resumedProposal('a', '1', ...dates);
  const lockedB = { ...resumedProposal('b', '1', ...dates), kind: 'planning-locked' };
  const result = await recoverPlanningOverlapFromCommittedProposals({
    ...resumeBase,
    routeClient: routeClient(),
    error: {
      code: 'planning_final_validation_failed',
      rows: [a, lockedB],
      failures: [{ reason: 'overlap', empId: '1', date: dates[0], firstCourseId: 'a', secondCourseId: 'b' }]
    },
    committedRows: [a, resumedProposal('b', '2', ...dates)]
  });
  assert.equal(result, null, 'a locked proposal must not be replaced by a previous movable option');
});

test('screen uses the whole-plan validated fallback for both normal and delta planning', () => {
  const run = screenSource.slice(screenSource.indexOf('const runCoursePlanning = async'), screenSource.indexOf('const clonePlanningOption'));
  assert.match(run, /recoverPlanningOverlapFromCommittedProposals\(/);
  assert.match(run, /const runDeltaRepairPlan = [\s\S]*?buildDynamicPlanWithCommittedRecovery\(/);
  assert.match(run, /result = await buildDynamicPlanWithCommittedRecovery\(/);
});


test('nested local overlap repairs have one cooperative deadline that cannot restart', async () => {
  let time = 0;
  const checkpoint = () => { time += 24; };
  const bounded = createPlanningLocalRepairDeadlineCheckpoint({
    checkpoint,
    deadlineAt: 75,
    now: () => time
  });
  await bounded();
  await bounded();
  await bounded();
  await assert.rejects(bounded(), (error) => error?.code === 'planning_local_repair_timeout');
  assert.equal(time, 96);
  assert.throws(
    () => createPlanningLocalRepairDeadlineCheckpoint({ checkpoint, deadlineAt: 0, now: () => time }),
    /planning_local_repair_deadline_missing/
  );
});

test('on whole-plan overlap, saved incumbent is verified before 75s nested repair', () => {
  const start = plannerSource.indexOf('const finalPlanValidation = await validatePlanningPlanCoherenceCooperatively');
  const end = plannerSource.indexOf('const summarize = (selectedRows', start);
  const section = plannerSource.slice(start, end);
  assert.ok(start > 0 && end > start);
  const firstRecovery = section.indexOf('recoverPlanningOverlapFromCommittedProposals({');
  const nestedRetry = section.indexOf('return await buildDynamicCoursePlan({');
  assert.ok(firstRecovery > 0 && nestedRetry > firstRecovery, 'try validated saved proposal first');
  assert.match(section, /if \(safe\) \{[\s\S]*?return \{[\s\S]*?recoveredCommittedCourseIds:/);
  assert.match(section, /Date\.now\(\) \+ 75_000/);
  assert.match(section, /_finalValidationRepairDeadlineAt: deadlineAt/);
  assert.match(section, /checkpoint: repairCheckpoint/);
  const screen = screenSource.slice(screenSource.indexOf('const buildDynamicPlanWithCommittedRecovery'), screenSource.indexOf('const runDeltaRepair = async'));
  assert.match(screen, /buildDynamicCoursePlan\(\{ \.\.\.preparedInput, committedRows: existingRows \}\)/);
  assert.match(section, /if \(error\?\.code !== 'planning_local_repair_timeout'\) throw error/);
  assert.match(section, /const error = new Error\('planning_final_validation_failed'\)/);
});


test('checkpoint recovery covers more than eight intersecting courses and can safely fall back to committed missing rows', async () => {
  const courseIds = Array.from({ length: 12 }, (_, index) => 'collision-' + index);
  const conflictingRows = courseIds.map((id) =>
    resumedProposal(id, '1', '2026-11-02', '2026-11-09')
  );
  const committedRows = conflictingRows.map((row, index) => index === 0
    ? row
    : { courseId: row.courseId, kind: 'missing', schoolId: row.schoolId, meetings: [], instructorEmpId: '' });
  const failures = [];
  for (let i = 0; i < courseIds.length; i += 1) {
    for (let j = i + 1; j < courseIds.length; j += 1) {
      failures.push({
        reason: 'overlap', date: '2026-11-02', empId: '1',
        firstCourseId: courseIds[i], secondCourseId: courseIds[j]
      });
    }
  }
  const saved = await recoverPlanningOverlapFromCommittedProposals({
    ...resumeBase,
    activities: courseIds.map((id) => activity(id)),
    error: { code: 'planning_final_validation_failed', rows: conflictingRows, failures },
    committedRows,
    routeClient: routeClient()
  });
  assert.ok(saved, 'the whole conflicting checkpoint must be recoverable');
  assert.equal(saved.rows.length, courseIds.length);
  assert.equal(saved.restoredCourseIds.length, 11, 'keep the one valid assigned incumbent');
  assert.equal(saved.rows.filter((row) => row.kind === 'proposal').length, 1);
  assert.equal(saved.rows.find((row) => row.courseId === courseIds[0]).instructorEmpId, '1');
});

test('a dirty rows checkpoint is checked for overlap before any resumed planning can trust its incumbents', () => {
  const screen = screenSource.slice(
    screenSource.indexOf('const buildDynamicPlanWithCommittedRecovery = async'),
    screenSource.indexOf('const runDeltaRepair = async')
  );
  const validationAt = screen.indexOf('const checkpointValidation = await validateResumedPlanningRows');
  const recoveryAt = screen.indexOf('const rescuedCheckpoint = await recoverPlanningOverlapFromCommittedProposals');
  const planningAt = screen.indexOf('return await buildDynamicCoursePlan');
  assert.ok(validationAt > 0 && recoveryAt > validationAt && planningAt > recoveryAt);
  assert.match(screen, /preparedInput = \{ \.\.\.input, existingRows: rescuedCheckpoint.rows \}/);
  assert.match(screen, /planning_checkpoint_overlap_unrecoverable/);
});
