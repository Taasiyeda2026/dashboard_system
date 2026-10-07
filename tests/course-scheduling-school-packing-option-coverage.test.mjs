import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { optimizeSchoolDayPackingPass } from '../frontend/src/screens/course-scheduling-planning.js';
import {
  planningEngineUpgradeAffectedCourseIds,
  planningEngineUpgradeOptimizationScopes,
  planningEngineUpgradeExecutionScopes
} from '../frontend/src/screens/course-scheduling-planning-store.js';

function option(emp, date, start, end) {
  return {
    instructorEmpId: emp,
    instructorName: emp,
    startDate: date,
    endDate: date,
    startTime: start,
    endTime: end,
    routeVerified: true,
    meetings: [{ date, start_time: start, end_time: end }]
  };
}

test('school packing uses hidden coverage options, not only the three UI alternatives', () => {
  const activities = [
    { row_id: 'a', school_id: 'school-1', school: 'School', activity_type: 'course' },
    { row_id: 'b', school_id: 'school-1', school: 'School', activity_type: 'course' }
  ];
  const rowsById = new Map([
    ['a', {
      courseId: 'a',
      schoolId: 'school-1',
      school: 'School',
      kind: 'proposal',
      instructorEmpId: '1',
      instructorName: '1',
      startDate: '2026-10-12',
      startTime: '10:00',
      endTime: '11:30',
      meetings: [{ date: '2026-10-12', start_time: '10:00', end_time: '11:30' }],
      options: [option('1', '2026-10-12', '10:00', '11:30')],
      packingOptions: [
        option('1', '2026-10-12', '10:00', '11:30'),
        option('1', '2026-10-13', '10:00', '11:30')
      ]
    }],
    ['b', {
      courseId: 'b',
      schoolId: 'school-1',
      school: 'School',
      kind: 'proposal',
      instructorEmpId: '1',
      instructorName: '1',
      startDate: '2026-10-14',
      startTime: '12:00',
      endTime: '13:30',
      meetings: [{ date: '2026-10-14', start_time: '12:00', end_time: '13:30' }],
      options: [option('1', '2026-10-14', '12:00', '13:30')],
      packingOptions: [
        option('1', '2026-10-14', '12:00', '13:30'),
        option('1', '2026-10-13', '12:00', '13:30')
      ]
    }]
  ]);

  const result = optimizeSchoolDayPackingPass({ rowsById, activities });
  assert.equal(result.moved, 2);
  assert.equal(rowsById.get('a').startDate, '2026-10-13');
  assert.equal(rowsById.get('b').startDate, '2026-10-13');
  assert.equal(rowsById.get('a').schoolPlanning.minimumFeasibleWeekdays, 1);
  assert.equal(rowsById.get('a').schoolPlanning.packingStatus, 'packed');
});

test('school-first packs recruitment timetable with existing-staff activity before recruitment profiling', () => {
  const activities = [
    { row_id: 'staff', school_id: 'school-1', school: 'School', activity_type: 'course' },
    { row_id: 'hire', school_id: 'school-1', school: 'School', activity_type: 'course' }
  ];
  const rowsById = new Map([
    ['staff', {
      courseId: 'staff',
      schoolId: 'school-1',
      school: 'School',
      courseName: 'Existing staff',
      kind: 'proposal',
      instructorEmpId: '1',
      instructorName: 'One',
      startDate: '2026-10-11',
      endDate: '2026-12-20',
      startTime: '10:00',
      endTime: '11:30',
      meetings: [{ date: '2026-10-11', start_time: '10:00', end_time: '11:30' }],
      packingOptions: [option('1', '2026-10-11', '10:00', '11:30')]
    }],
    ['hire', {
      courseId: 'hire',
      schoolId: 'school-1',
      school: 'School',
      courseName: 'Needs hire',
      kind: 'recruitment',
      instructorEmpId: '',
      instructorName: '',
      diagnostics: { recruitmentCertified: true, searchIncomplete: false },
      startDate: '2026-10-12',
      endDate: '2026-12-21',
      startTime: '08:00',
      endTime: '09:30',
      meetings: [{ date: '2026-10-12', start_time: '08:00', end_time: '09:30' }],
      scheduleOptions: [
        {
          startDate: '2026-10-12', endDate: '2026-12-21', startTime: '08:00', endTime: '09:30',
          meetings: [{ date: '2026-10-12', start_time: '08:00', end_time: '09:30' }]
        },
        {
          startDate: '2026-10-11', endDate: '2026-12-20', startTime: '08:00', endTime: '09:30',
          meetings: [{ date: '2026-10-11', start_time: '08:00', end_time: '09:30' }]
        }
      ]
    }]
  ]);

  const result = optimizeSchoolDayPackingPass({ rowsById, activities });
  assert.ok(result.moved >= 1);
  assert.equal(rowsById.get('hire').kind, 'recruitment');
  assert.equal(rowsById.get('hire').instructorEmpId, '');
  assert.equal(rowsById.get('hire').startDate, '2026-10-11');
  assert.equal(rowsById.get('staff').schoolPlanning.packingStatus, 'packed');
  assert.equal(rowsById.get('staff').schoolPlanning.minimumFeasibleWeekdays, 1);
  assert.ok(rowsById.get('staff').schoolPlanning.alternativeCount >= 1);
});

test('school-first prefers fewer instructors at the same school even when day count is already minimal', () => {
  const activities = ['a', 'b', 'c'].map((row_id) => ({
    row_id, school_id: 'school-1', school: 'School', activity_type: 'course'
  }));
  const rowsById = new Map([
    ['a', {
      courseId: 'a', schoolId: 'school-1', school: 'School', courseName: 'A', kind: 'proposal',
      instructorEmpId: '1', instructorName: 'One', startDate: '2026-10-12', startTime: '08:00', endTime: '09:30',
      meetings: [{ date: '2026-10-12', start_time: '08:00', end_time: '09:30' }],
      packingOptions: [option('1', '2026-10-12', '08:00', '09:30')]
    }],
    ['b', {
      courseId: 'b', schoolId: 'school-1', school: 'School', courseName: 'B', kind: 'proposal',
      instructorEmpId: '2', instructorName: 'Two', startDate: '2026-10-12', startTime: '10:00', endTime: '11:30',
      meetings: [{ date: '2026-10-12', start_time: '10:00', end_time: '11:30' }],
      packingOptions: [
        option('2', '2026-10-12', '10:00', '11:30'),
        option('1', '2026-10-12', '10:00', '11:30')
      ]
    }],
    ['c', {
      courseId: 'c', schoolId: 'school-1', school: 'School', courseName: 'C', kind: 'proposal',
      instructorEmpId: '3', instructorName: 'Three', startDate: '2026-10-12', startTime: '12:00', endTime: '13:30',
      meetings: [{ date: '2026-10-12', start_time: '12:00', end_time: '13:30' }],
      packingOptions: [
        option('3', '2026-10-12', '12:00', '13:30'),
        option('1', '2026-10-12', '12:00', '13:30')
      ]
    }]
  ]);

  optimizeSchoolDayPackingPass({ rowsById, activities });
  assert.deepEqual(
    new Set([...rowsById.values()].map((row) => row.instructorEmpId)),
    new Set(['1'])
  );
  assert.equal(rowsById.get('a').schoolPlanning.actualWeekdays.length, 1);
});

test('school-first stores several feasible school timetable alternatives instead of taking the first weekday set', () => {
  const activities = [
    { row_id: 'a', school_id: 'school-1', school: 'School', activity_type: 'course' },
    { row_id: 'b', school_id: 'school-1', school: 'School', activity_type: 'course' }
  ];
  const rowsById = new Map([
    ['a', {
      courseId: 'a', schoolId: 'school-1', school: 'School', courseName: 'A', kind: 'proposal',
      instructorEmpId: '1', instructorName: 'One', startDate: '2026-10-11', startTime: '08:00', endTime: '09:30',
      meetings: [{ date: '2026-10-11', start_time: '08:00', end_time: '09:30' }],
      packingOptions: [
        option('1', '2026-10-11', '08:00', '09:30'),
        option('1', '2026-10-12', '08:00', '09:30')
      ]
    }],
    ['b', {
      courseId: 'b', schoolId: 'school-1', school: 'School', courseName: 'B', kind: 'proposal',
      instructorEmpId: '1', instructorName: 'One', startDate: '2026-10-11', startTime: '10:00', endTime: '11:30',
      meetings: [{ date: '2026-10-11', start_time: '10:00', end_time: '11:30' }],
      packingOptions: [
        option('1', '2026-10-11', '10:00', '11:30'),
        option('1', '2026-10-12', '10:00', '11:30')
      ]
    }]
  ]);

  optimizeSchoolDayPackingPass({ rowsById, activities });
  const planning = rowsById.get('a').schoolPlanning;
  assert.equal(planning.minimumFeasibleWeekdays, 1);
  assert.ok(planning.alternativeCount >= 2);
  assert.deepEqual(new Set(planning.alternatives.map((alt) => alt.weekdays[0])), new Set([0, 1]));
});

test('five-row school conflict never invents recruitment when existing staff cannot cover the full bundle', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const activities = ids.map((row_id) => ({
    row_id, school_id: 'school-379', school: 'מקיף ערבי', activity_type: 'course'
  }));
  const rowsById = new Map(ids.map((courseId) => [courseId, {
    courseId,
    schoolId: 'school-379',
    school: 'מקיף ערבי',
    courseName: 'בינה מלאכותית',
    kind: 'proposal',
    instructorEmpId: '1537',
    instructorName: 'יארא',
    startDate: '2026-10-13',
    endDate: '2026-12-08',
    startTime: '12:00',
    endTime: '13:30',
    meetings: [{ date: '2026-10-13', start_time: '12:00', end_time: '13:30' }],
    packingOptions: [
      option('1537', '2026-10-13', '12:00', '13:30'),
      option('1529', '2026-10-17', '08:00', '09:30'),
      option('1529', '2026-10-17', '08:30', '10:00')
    ],
    scheduleOptions: [
      { startDate: '2026-10-12', endDate: '2026-12-07', startTime: '10:00', endTime: '11:30', meetings: [{ date: '2026-10-12', start_time: '10:00', end_time: '11:30' }] },
      { startDate: '2026-10-13', endDate: '2026-12-08', startTime: '12:00', endTime: '13:30', meetings: [{ date: '2026-10-13', start_time: '12:00', end_time: '13:30' }] }
    ]
  }]));

  optimizeSchoolDayPackingPass({ rowsById, activities });
  const proposals = [...rowsById.values()].filter((row) => row.kind === 'proposal');
  const recruitments = [...rowsById.values()].filter((row) => row.kind === 'recruitment');
  const incomplete = [...rowsById.values()].filter((row) => row.kind === 'missing');
  assert.equal(recruitments.length, 0);
  assert.ok(incomplete.length >= 1);
  for (const row of incomplete) {
    assert.equal(row.status, 'בדיקת התאמה נמשכת');
    assert.equal(row.diagnostics?.searchIncomplete, true);
    assert.equal(row.diagnostics?.recruitmentCertified, false);
  }
  assert.equal(rowsById.get('a').schoolPlanning.staffBundleComplete, false);
  assert.equal(rowsById.get('a').schoolPlanning.staffConflictFallbackCount, incomplete.length);

  for (let i = 0; i < proposals.length; i += 1) {
    for (let j = i + 1; j < proposals.length; j += 1) {
      const first = proposals[i];
      const second = proposals[j];
      if (first.instructorEmpId !== second.instructorEmpId) continue;
      const a = first.meetings[0];
      const b = second.meetings[0];
      if (a.date !== b.date) continue;
      const overlap = a.start_time < b.end_time && b.start_time < a.end_time;
      assert.equal(overlap, false, `${first.courseId} overlaps ${second.courseId}`);
    }
  }
});

test('incremental updates scope gap compaction to incremental ids instead of scanning all proposals', async () => {
  const source = await readFile(new URL('../frontend/src/screens/course-scheduling-planning.js', import.meta.url), 'utf8');
  assert.match(source, /const gapCompactionTargetIds = incrementalIds === null[\s\S]*?new Set\(incrementalIds\)/);
  assert.match(source, /targetCourseIds:\s*gapCompactionTargetIds \? \[\.\.\.gapCompactionTargetIds\] : null/);
  assert.doesNotMatch(source, /\.\.\.\(upgradeSchoolPackingIds \|\| \[\]\)[\s\S]*?\.\.\.\(upgradeWorkdayConsolidationIds \|\| \[\]\)/);
});

test('v27 upgrade rebuilds both flexible proposals and recruitment rows for school-first optimization', () => {
  const shared = {
    rows: [
      { activityId: 'a', row: { courseId: 'a', schoolId: 's1', kind: 'proposal' } },
      { activityId: 'b', row: { courseId: 'b', schoolId: 's1', kind: 'recruitment' } },
      { activityId: 'locked', lockedOption: { instructorEmpId: '1' }, row: { courseId: 'locked', schoolId: 's1', kind: 'proposal' } },
      { activityId: 'live', row: { courseId: 'live', schoolId: 's1', kind: 'live' } }
    ]
  };
  const ids = planningEngineUpgradeAffectedCourseIds({
    shared,
    activities: [],
    storedEngineVersion: 'planning-v26-20261003-coherent-school-first-separate-trip-distance-self-invalidation',
    currentEngineVersion: 'planning-v27-20261004-school-first-economic-alternatives-self-invalidation'
  });
  assert.deepEqual(new Set(ids), new Set(['a', 'b']));
});

test('v27 to v28 scopes school bundles, singleton reassignment and recruitment recovery without touching anchors', () => {
  const shared = {
    rows: [
      { activityId: 'proposal', row: { courseId: 'proposal', schoolId: 's1', kind: 'proposal', instructorEmpId: 'a', meetings: [{ date: '2026-11-02' }] } },
      { activityId: 'recruitment', row: { courseId: 'recruitment', schoolId: 's1', kind: 'recruitment', scheduleOptions: [{ meetings: [{ date: '2026-11-03', start_time: '10:00', end_time: '11:00' }] }] } },
      { activityId: 'single', row: { courseId: 'single', schoolId: 's2', kind: 'proposal', instructorEmpId: 'a', meetings: [{ date: '2026-11-04' }] } },
      { activityId: 'candidate-day', row: { courseId: 'candidate-day', schoolId: 's3', kind: 'live', instructorEmpId: 'b', meetings: [{ date: '2026-11-05' }] } },
      { activityId: 'unaffected', row: { courseId: 'unaffected', schoolId: 's4', kind: 'proposal', instructorEmpId: 'b', meetings: [{ date: '2026-11-12' }] } },
      { activityId: 'dated', row: { courseId: 'dated', schoolId: 's1', kind: 'proposal', schoolDateAnchored: true } },
      { activityId: 'source-date', row: { courseId: 'source-date', schoolId: 's1', kind: 'proposal', instructorEmpId: 'a', meetings: [{ date: '2026-11-20' }] } },
      { activityId: 'locked', lockedOption: { instructorEmpId: '1' }, row: { courseId: 'locked', schoolId: 's1', kind: 'proposal' } },
      { activityId: 'planning-locked', row: { courseId: 'planning-locked', schoolId: 's1', kind: 'proposal', planningLocked: true } },
      { activityId: 'live', row: { courseId: 'live', schoolId: 's1', kind: 'live' } }
    ]
  };
  const ids = planningEngineUpgradeAffectedCourseIds({
    shared,
    activities: [{ row_id: 'source-date', school_id: 's1', start_date: '2026-11-20' }],
    storedEngineVersion: 'planning-v27-20261004-school-first-economic-alternatives-self-invalidation',
    currentEngineVersion: 'planning-v28-20261004-anchor-safe-global-reassignment-self-invalidation'
  });
  assert.deepEqual(new Set(ids), new Set(['proposal', 'recruitment', 'single']));
});

test('v28 upgrade includes a single-school-row proposal with a cross-instructor workday dependency', () => {
  const ids = planningEngineUpgradeAffectedCourseIds({
    shared: { rows: [
      { activityId: 'singleton', row: { courseId: 'singleton', schoolId: 'only-here', kind: 'proposal', instructorEmpId: 'a', meetings: [{ date: '2026-11-02' }] } },
      { activityId: 'existing-day', row: { courseId: 'existing-day', schoolId: 'elsewhere', kind: 'live', instructorEmpId: 'b', meetings: [{ date: '2026-11-03' }] } }
    ] },
    storedEngineVersion: 'planning-v27-20261004-school-first-economic-alternatives-self-invalidation',
    currentEngineVersion: 'planning-v28-20261004-anchor-safe-global-reassignment-self-invalidation'
  });
  assert.deepEqual(ids, ['singleton']);
});

test('v28 upgrade includes singleton recruitment with a saved recovery schedule', () => {
  const ids = planningEngineUpgradeAffectedCourseIds({
    shared: { rows: [{
      activityId: 'recruitment-singleton',
      row: {
        courseId: 'recruitment-singleton',
        schoolId: 'only-here',
        kind: 'recruitment',
        scheduleOptions: [{ meetings: [{ date: '2026-11-03', start_time: '09:00', end_time: '10:30' }] }]
      }
    }] },
    storedEngineVersion: 'planning-v27-20261004-school-first-economic-alternatives-self-invalidation',
    currentEngineVersion: 'planning-v28-20261004-anchor-safe-global-reassignment-self-invalidation'
  });
  assert.deepEqual(ids, ['recruitment-singleton']);
});

test('v28 upgrade keeps an unaffected singleton proposal on its saved snapshot', () => {
  const ids = planningEngineUpgradeAffectedCourseIds({
    shared: { rows: [{
      activityId: 'stable-singleton',
      row: { courseId: 'stable-singleton', schoolId: 'only-here', kind: 'proposal', instructorEmpId: 'a', meetings: [{ date: '2026-11-02' }] }
    }] },
    storedEngineVersion: 'planning-v27-20261004-school-first-economic-alternatives-self-invalidation',
    currentEngineVersion: 'planning-v28-20261004-anchor-safe-global-reassignment-self-invalidation'
  });
  assert.deepEqual(ids, []);
});

test('v28 execution keeps ordinary dirty rows out of the engine-upgrade base queue', () => {
  const engineUpgradeAffectedIds = Array.from({ length: 136 }, (_, index) => `upgrade-${index}`);
  const scopes = planningEngineUpgradeExecutionScopes({
    regularAffectedIds: ['actually-dirty'],
    engineUpgradeAffectedIds,
    storedEngineVersion: 'planning-v27-20261004-school-first-economic-alternatives-self-invalidation',
    currentEngineVersion: 'planning-v28-20261004-anchor-safe-global-reassignment-self-invalidation'
  });
  assert.deepEqual(scopes.baseRecalculationIds, ['actually-dirty']);
  assert.equal(scopes.upgradeOptimizationIds.length, 136);
  assert.equal(scopes.affectedIds.length, 137);
  assert.equal(scopes.v28OptimizationUpgrade, true);
});

test('v28 optimization keeps school packing, recruitment rescue and workday reassignment in separate scopes', () => {
  const shared = { rows: [
    { activityId: 'pack-a', row: { courseId: 'pack-a', schoolId: 'pack', kind: 'proposal', instructorEmpId: 'a', meetings: [{ date: '2026-11-02' }] } },
    { activityId: 'pack-b', row: { courseId: 'pack-b', schoolId: 'pack', kind: 'proposal', instructorEmpId: 'a', meetings: [{ date: '2026-11-02' }] } },
    { activityId: 'rescue', row: { courseId: 'rescue', schoolId: 'rescue-school', kind: 'recruitment', scheduleOptions: [{ meetings: [{ date: '2026-11-03', start_time: '10:00', end_time: '11:00' }] }] } },
    { activityId: 'reassign', row: { courseId: 'reassign', schoolId: 'single', kind: 'proposal', instructorEmpId: 'a', meetings: [{ date: '2026-11-04' }] } },
    { activityId: 'open-day', row: { courseId: 'open-day', schoolId: 'live', kind: 'live', instructorEmpId: 'b', meetings: [{ date: '2026-11-05' }] } }
  ] };
  const scopes = planningEngineUpgradeOptimizationScopes({
    shared,
    storedEngineVersion: 'planning-v27-20261004-school-first-economic-alternatives-self-invalidation',
    currentEngineVersion: 'planning-v28-20261004-anchor-safe-global-reassignment-self-invalidation'
  });
  assert.deepEqual(new Set(scopes.schoolPackingCourseIds), new Set(['pack-a', 'pack-b']));
  assert.deepEqual(scopes.recruitmentRecoveryCourseIds, ['rescue']);
  assert.ok(scopes.workdayConsolidationCourseIds.includes('reassign'));
  assert.ok(!scopes.workdayConsolidationCourseIds.includes('rescue'));
});

test('a workspace that skipped v27 uses base recalculation instead of v28 optimization-only migration', () => {
  const shared = { rows: [
    { activityId: 'proposal', row: { courseId: 'proposal', schoolId: 's1', kind: 'proposal' } },
    { activityId: 'recruitment', row: { courseId: 'recruitment', schoolId: 's2', kind: 'recruitment' } },
    { activityId: 'anchored', row: { courseId: 'anchored', schoolId: 's3', kind: 'proposal', schoolDateAnchored: true } }
  ] };
  const ids = planningEngineUpgradeAffectedCourseIds({
    shared,
    storedEngineVersion: 'planning-v26-20261003-coherent-school-first-self-invalidation',
    currentEngineVersion: 'planning-v28-20261004-anchor-safe-global-reassignment-self-invalidation'
  });
  const scopes = planningEngineUpgradeExecutionScopes({
    engineUpgradeAffectedIds: ids,
    storedEngineVersion: 'planning-v26-20261003-coherent-school-first-self-invalidation',
    currentEngineVersion: 'planning-v28-20261004-anchor-safe-global-reassignment-self-invalidation'
  });
  assert.deepEqual(new Set(ids), new Set(['proposal', 'recruitment']));
  assert.deepEqual(new Set(scopes.baseRecalculationIds), new Set(['proposal', 'recruitment']));
  assert.deepEqual(scopes.upgradeOptimizationIds, []);
  assert.equal(scopes.v28OptimizationUpgrade, false);
});

test('v24 to v25 upgrade targets only multi-proposal schools', () => {
  const activities = [
    { row_id: 'a', school_id: 'school-1' },
    { row_id: 'b', school_id: 'school-1' },
    { row_id: 'c', school_id: 'school-2' }
  ];
  const shared = {
    rows: [
      { activityId: 'a', row: { courseId: 'a', schoolId: 'school-1', kind: 'proposal' } },
      { activityId: 'b', row: { courseId: 'b', schoolId: 'school-1', kind: 'proposal' } },
      { activityId: 'c', row: { courseId: 'c', schoolId: 'school-2', kind: 'proposal' } }
    ]
  };

  const ids = planningEngineUpgradeAffectedCourseIds({
    shared,
    activities,
    storedEngineVersion: 'planning-v24-20261003-school-day-packing-self-invalidation',
    currentEngineVersion: 'planning-v25-20261003-school-packing-option-coverage'
  });

  assert.deepEqual(new Set(ids), new Set(['a', 'b']));
});

test('fast UI alternatives no longer cap school-packing coverage at three options', async () => {
  const source = await readFile(new URL('../frontend/src/screens/course-scheduling-planning.js', import.meta.url), 'utf8');
  assert.match(source, /MAX_SCHOOL_PACKING_OPTIONS\s*=\s*24/);
  assert.match(source, /packingCoverage/);
  assert.match(source, /packingOptions/);
  assert.match(source, /row\?\.packingOptions\?\.length\s*\?\s*row\.packingOptions\s*:\s*row\?\.options/);
});

test('multi-activity school candidate pools ignore provisional same-school plans before bundling', async () => {
  const source = await readFile(new URL('../frontend/src/screens/course-scheduling-planning.js', import.meta.url), 'utf8');
  assert.match(source, /useIndependentSchoolCandidatePool/);
  assert.match(source, /startsWith\('planning-block:'\)/);
  assert.match(source, /text\(contextActivity\?\.school_id\) === activitySchoolId/);
  assert.match(source, /contextActivities: candidateContext/);
  assert.match(source, /preparedContext: candidatePreparedContext/);
});

test('planning progress names the current phase instead of presenting phase resets as a new run', async () => {
  const source = await readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
  const start = source.indexOf('const updatePlanningStatusInPlace');
  const end = source.indexOf('const onPlanningNeedsRecalc', start);
  const block = source.slice(start, end);
  assert.match(block, /const phaseLabel = phase/);
  assert.match(block, /זה שלב בתוך אותה ריצה; החישוב לא התחיל מחדש/);
  assert.doesNotMatch(block, /pending > 0 && !\/מלא\//);
});

test('v32 utilization upgrade recalculates all movable outcomes but preserves user locks/live rows', () => {
  const shared = { rows: [
    { activityId: 'live', row: { courseId: 'live', kind: 'live', schoolDateAnchored: true } },
    { activityId: 'anchored', row: { courseId: 'anchored', kind: 'fixed-proposal', schoolDateAnchored: true } },
    { activityId: 'flex', row: { courseId: 'flex', kind: 'proposal' } },
    { activityId: 'missing', row: { courseId: 'missing', kind: 'missing' } },
    { activityId: 'recruit', row: { courseId: 'recruit', kind: 'recruitment' } },
    { activityId: 'locked', lockedOption: { instructorEmpId: '1' }, row: { courseId: 'locked', kind: 'proposal', planningLocked: true } }
  ] };
  const ids = planningEngineUpgradeAffectedCourseIds({
    shared,
    activities: [],
    storedEngineVersion: 'planning-v31-20261006-self-invalidation-bounded-bulk-rescue',
    currentEngineVersion: 'planning-v32-20261007-self-invalidation-maximize-staff-utilization'
  }).sort();
  assert.deepEqual(ids, ['anchored', 'flex', 'missing', 'recruit']);
});
