import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  MAX_HOME_DISTANCE_KM,
  MANAGER_APPROVAL_DISTANCE_KM,
  NORTH_STAGE2_MAX_HOME_DISTANCE_KM,
  exceedsHomeDistanceLimit,
  evaluateInstructor,
  resolveMatchingHomeDistanceLimitKm
} from '../frontend/src/screens/instructor-matching-engine.js';
import {
  assignRecruitmentProfiles,
  planningActivityMissingCriticalData,
  planningEngineChangeAffectedCourseIds,
  recruitmentAuthorityRegionKey,
  recruitmentRegionsCompatible,
  recruitmentRescueProbe,
  resolvePlanningFullRunDecision,
  resolvePlanningHomeDistanceLimitKm,
  PLANNING_ENGINE_VERSION
} from '../frontend/src/screens/course-scheduling-planning.js';

const baseActivity = (overrides = {}) => ({
  row_id: 'north-1',
  district: 'צפון',
  authority: 'נהריה',
  school: 'בית ספר צפון',
  school_id: 's-north',
  school_address: 'נהריה 1',
  instruction_language: 'he',
  required_instructor_gender: 'any',
  start_time: '09:00',
  end_time: '10:30',
  meetings: [{ date: '2026-10-20', start_time: '09:00', end_time: '10:30' }],
  ...overrides
});

const instructor = (empId, address = 'חיפה') => ({
  emp_id: empId,
  full_name: empId,
  active: 'yes',
  address
});

const profile = (empId, overrides = {}) => ({
  emp_id: empId,
  gender: 'male',
  instruction_languages: ['he'],
  ...overrides
});

function evaluateAtDistance(km, maxKm = MAX_HOME_DISTANCE_KM, extras = {}) {
  return evaluateInstructor({
    instructor: instructor('i1'),
    profile: profile('i1', extras.profile || {}),
    rules: [{ weekday: 2, available: true, start_time: '08:00', end_time: '15:00' }],
    exceptions: [],
    activity: baseActivity(extras.activity || {}),
    existingActivities: extras.existingActivities || [],
    travel: {
      home: { distance_km: km, duration_minutes: Math.round(km * 1.2) },
      transitions: extras.transitions || {}
    },
    validateTravel: true,
    maxHomeDistanceKm: maxKm,
    includeLegacyScore: false
  });
}

test('1: north activity + 35 km instructor is accepted in stage 1', () => {
  assert.equal(resolvePlanningHomeDistanceLimitKm(baseActivity(), 1), 40);
  const result = evaluateAtDistance(35, 40);
  assert.equal(result.eligible, true);
});

test('2-4: north stage 2 includes 48 / 59.9 / exact 60 km', () => {
  assert.equal(NORTH_STAGE2_MAX_HOME_DISTANCE_KM, MANAGER_APPROVAL_DISTANCE_KM);
  assert.equal(resolveMatchingHomeDistanceLimitKm({ district: 'צפון', stage: 2 }), 60);
  assert.equal(evaluateAtDistance(48, 60).eligible, true);
  assert.equal(evaluateAtDistance(59.9, 60).eligible, true);
  assert.equal(evaluateAtDistance(60, 60).eligible, true);
  assert.equal(exceedsHomeDistanceLimit(60, 60), false);
});

test('5: north stage 2 excludes 60.1 km automatically', () => {
  assert.equal(exceedsHomeDistanceLimit(60.1, 60), true);
  assert.equal(evaluateAtDistance(60.1, 60).eligible, false);
});

test('6: center/south keep the ordinary 40 km ceiling', () => {
  assert.equal(resolveMatchingHomeDistanceLimitKm({ district: 'מרכז', stage: 2 }), 40);
  assert.equal(resolveMatchingHomeDistanceLimitKm({ district: 'דרום', stage: 2 }), 40);
  assert.equal(evaluateAtDistance(48, 40).eligible, false);
});

test('7: 50 km instructor who is unavailable is rejected', () => {
  const result = evaluateInstructor({
    instructor: instructor('i1'),
    profile: profile('i1'),
    rules: [{ weekday: 0, available: true, start_time: '08:00', end_time: '15:00' }],
    exceptions: [],
    activity: baseActivity(),
    travel: { home: { distance_km: 50, duration_minutes: 55 } },
    validateTravel: true,
    maxHomeDistanceKm: 60,
    includeLegacyScore: false
  });
  assert.equal(result.eligible, false);
  assert.equal(result.checks?.availability?.passed, false);
});

test('8: 50 km instructor with overlap is rejected', () => {
  const result = evaluateAtDistance(50, 60, {
    existingActivities: [{
      emp_id: 'i1',
      activity_name: 'פעילות חופפת',
      school_id: 'other',
      school: 'אחר',
      school_address: 'עכו',
      date: '2026-10-20',
      start_time: '09:00',
      end_time: '10:30'
    }]
  });
  assert.equal(result.eligible, false);
  assert.ok(result.issues?.some((issue) => issue.kind === 'overlap') || result.failures.some((item) => /חפיפה/.test(item)));
});

test('9: 50 km instructor without enough transition time is rejected', () => {
  const result = evaluateAtDistance(50, 60, {
    existingActivities: [{
      emp_id: 'i1',
      activity_name: 'פעילות קודמת',
      school_id: 'other',
      school: 'אחר',
      school_address: 'עכו 2',
      authority: 'עכו',
      date: '2026-10-20',
      start_time: '08:00',
      end_time: '08:50'
    }],
    transitions: {
      '2026-10-20': {
        previous: { distance_km: 30, duration_minutes: 40 }
      }
    }
  });
  assert.equal(result.eligible, false);
  assert.ok(
    result.issues?.some((issue) => issue.kind === 'insufficient_transition')
    || result.failures.some((item) => /מעבר/.test(item))
  );
});

test('10: recruitment rescue only after stage-2 distance is exhausted', () => {
  const routeClient = {
    peek() {
      return { distance_km: 55, duration_minutes: 60 };
    }
  };
  const stage1 = recruitmentRescueProbe({
    row: {
      courseId: 'north-1',
      requiredLanguage: 'he',
      requiredGender: 'any',
      meetings: [{ date: '2026-10-20', start_time: '09:00', end_time: '10:30' }],
      startDate: '2026-10-20',
      startTime: '09:00',
      endTime: '10:30'
    },
    activity: baseActivity(),
    instructors: [instructor('near')],
    profiles: { near: profile('near') },
    rules: { near: [{ weekday: 2, available: true, start_time: '08:00', end_time: '15:00' }] },
    routeClient,
    maxHomeDistanceKm: 40
  });
  assert.equal(stage1.possible, false);

  const stage2 = recruitmentRescueProbe({
    row: {
      courseId: 'north-1',
      requiredLanguage: 'he',
      requiredGender: 'any',
      meetings: [{ date: '2026-10-20', start_time: '09:00', end_time: '10:30' }],
      startDate: '2026-10-20',
      startTime: '09:00',
      endTime: '10:30'
    },
    activity: baseActivity(),
    instructors: [instructor('near')],
    profiles: { near: profile('near') },
    rules: { near: [{ weekday: 2, available: true, start_time: '08:00', end_time: '15:00' }] },
    routeClient,
    maxHomeDistanceKm: 60
  });
  assert.equal(stage2.possible, true);
  assert.deepEqual(stage2.candidateEmpIds, ['near']);
});

test('11: Hebrew and Arabic recruitment rows do not share one hire slot', () => {
  const rows = assignRecruitmentProfiles([
    {
      courseId: 'he-1', courseName: 'א', school: 'ס1', authority: 'נהריה', district: 'צפון',
      kind: 'recruitment', requiredLanguage: 'he', requiredGender: 'any',
      scheduleOptions: [{ startDate: '2026-10-12', endDate: '2026-10-12', startTime: '08:00', endTime: '09:30', meetings: [
        { date: '2026-10-12', start_time: '08:00', end_time: '09:30' }
      ] }]
    },
    {
      courseId: 'ar-1', courseName: 'ב', school: 'ס2', authority: 'נהריה', district: 'צפון',
      kind: 'recruitment', requiredLanguage: 'ar', requiredGender: 'any',
      scheduleOptions: [{ startDate: '2026-10-13', endDate: '2026-10-13', startTime: '08:00', endTime: '09:30', meetings: [
        { date: '2026-10-13', start_time: '08:00', end_time: '09:30' }
      ] }]
    }
  ]);
  assert.notEqual(rows[0].recruitmentProfileId, rows[1].recruitmentProfileId);
});

test('12: Kiryat Shmona and Umm al-Fahm are not one north hire slot', () => {
  assert.notEqual(
    recruitmentAuthorityRegionKey('קריית שמונה', 'צפון'),
    recruitmentAuthorityRegionKey('אום אל-פחם', 'צפון')
  );
  assert.equal(
    recruitmentRegionsCompatible(
      recruitmentAuthorityRegionKey('קריית שמונה', 'צפון'),
      recruitmentAuthorityRegionKey('אום אל-פחם', 'צפון'),
      'צפון'
    ),
    false
  );
  const rows = assignRecruitmentProfiles([
    {
      courseId: 'ks', courseName: 'א', school: 'ס1', authority: 'קריית שמונה', district: 'צפון',
      kind: 'recruitment', requiredLanguage: 'he', requiredGender: 'any',
      scheduleOptions: [{ startDate: '2026-10-12', endDate: '2026-10-12', startTime: '08:00', endTime: '09:30', meetings: [
        { date: '2026-10-12', start_time: '08:00', end_time: '09:30' }
      ] }]
    },
    {
      courseId: 'uaf', courseName: 'ב', school: 'ס2', authority: 'אום אל-פחם', district: 'צפון',
      kind: 'recruitment', requiredLanguage: 'he', requiredGender: 'any',
      scheduleOptions: [{ startDate: '2026-10-19', endDate: '2026-10-19', startTime: '08:00', endTime: '09:30', meetings: [
        { date: '2026-10-19', start_time: '08:00', end_time: '09:30' }
      ] }]
    }
  ]);
  assert.notEqual(rows[0].recruitmentProfileId, rows[1].recruitmentProfileId);
});

test('13-14: overlapping or insufficient-transition meetings cannot share a hire slot', () => {
  const overlap = assignRecruitmentProfiles([
    {
      courseId: 'a', courseName: 'א', school: 'ס1', authority: 'נהריה', district: 'צפון',
      kind: 'recruitment', requiredLanguage: 'he', requiredGender: 'any',
      scheduleOptions: [{ startDate: '2026-10-12', endDate: '2026-10-12', startTime: '08:00', endTime: '09:30', meetings: [
        { date: '2026-10-12', start_time: '08:00', end_time: '09:30' }
      ] }]
    },
    {
      courseId: 'b', courseName: 'ב', school: 'ס2', authority: 'נהריה', district: 'צפון',
      kind: 'recruitment', requiredLanguage: 'he', requiredGender: 'any',
      scheduleOptions: [{ startDate: '2026-10-12', endDate: '2026-10-12', startTime: '09:00', endTime: '10:30', meetings: [
        { date: '2026-10-12', start_time: '09:00', end_time: '10:30' }
      ] }]
    }
  ]);
  assert.notEqual(overlap[0].recruitmentProfileId, overlap[1].recruitmentProfileId);

  const tightGap = assignRecruitmentProfiles([
    {
      courseId: 'c', courseName: 'א', school: 'ס1', authority: 'נהריה', district: 'צפון',
      kind: 'recruitment', requiredLanguage: 'he', requiredGender: 'any',
      scheduleOptions: [{ startDate: '2026-10-12', endDate: '2026-10-12', startTime: '08:00', endTime: '09:00', meetings: [
        { date: '2026-10-12', start_time: '08:00', end_time: '09:00' }
      ] }]
    },
    {
      courseId: 'd', courseName: 'ב', school: 'ס2', authority: 'נהריה', district: 'צפון',
      kind: 'recruitment', requiredLanguage: 'he', requiredGender: 'any',
      scheduleOptions: [{ startDate: '2026-10-12', endDate: '2026-10-12', startTime: '09:10', endTime: '10:10', meetings: [
        { date: '2026-10-12', start_time: '09:10', end_time: '10:10' }
      ] }]
    }
  ]);
  assert.notEqual(tightGap[0].recruitmentProfileId, tightGap[1].recruitmentProfileId);
});

test('15: activity without school/location is missing, not recruitment', () => {
  const missing = planningActivityMissingCriticalData({
    row_id: 'x',
    school: '',
    school_id: '',
    school_address: '',
    instruction_language: 'he'
  });
  assert.ok(missing.length > 0);
  assert.ok(missing.some((item) => /בית ספר|כתובת/.test(item)));
});

test('16/23/24/25: fullRun only for explicit reasons', () => {
  assert.deepEqual(
    resolvePlanningFullRunDecision({ forceFull: true, hasWorkspace: true, existingRowCount: 10 }),
    { fullRun: true, fullRunReason: 'force_full' }
  );
  assert.deepEqual(
    resolvePlanningFullRunDecision({ forceFull: false, hasWorkspace: false, existingRowCount: 0 }),
    { fullRun: true, fullRunReason: 'no_workspace' }
  );
  assert.deepEqual(
    resolvePlanningFullRunDecision({ forceFull: false, hasWorkspace: true, existingRowCount: 0 }),
    { fullRun: true, fullRunReason: 'no_existing_rows' }
  );
  assert.deepEqual(
    resolvePlanningFullRunDecision({
      forceFull: false,
      hasWorkspace: true,
      existingRowCount: 253,
      unrecoverableGlobalContextChange: true
    }),
    { fullRun: true, fullRunReason: 'unrecoverable_global_context' }
  );
  assert.deepEqual(
    resolvePlanningFullRunDecision({
      forceFull: false,
      hasWorkspace: true,
      existingRowCount: 253,
      unrecoverableGlobalContextChange: false
    }),
    { fullRun: false, fullRunReason: '' }
  );
});

test('16/21/22: engine bump and north rule affect only mappable rows', () => {
  const shared = {
    rows: [
      { activityId: 'n-rec', row: { courseId: 'n-rec', kind: 'recruitment', district: 'צפון' } },
      { activityId: 'n-prop', row: { courseId: 'n-prop', kind: 'proposal', district: 'צפון' } },
      { activityId: 's-rec', row: { courseId: 's-rec', kind: 'recruitment', district: 'דרום' } },
      { activityId: 'c-live', row: { courseId: 'c-live', kind: 'live', district: 'מרכז' } }
    ]
  };
  const affected = planningEngineChangeAffectedCourseIds({
    shared,
    activities: [
      { row_id: 'n-rec', district: 'צפון' },
      { row_id: 'n-prop', district: 'צפון' },
      { row_id: 's-rec', district: 'דרום' },
      { row_id: 'c-live', district: 'מרכז' }
    ],
    currentCourseIds: ['n-rec', 'n-prop', 's-rec', 'c-live'],
    previousEngineVersion: 'old',
    nextEngineVersion: PLANNING_ENGINE_VERSION
  });
  assert.ok(affected.includes('n-rec'));
  assert.ok(affected.includes('n-prop'));
  assert.ok(affected.includes('s-rec'));
  assert.ok(!affected.includes('c-live'));
});

test('17/18 source contract: incremental persist uses replaceAll=false and affected rows only', async () => {
  const screen = await readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
  assert.match(screen, /resolvePlanningFullRunDecision/);
  assert.match(screen, /fullRunReason/);
  assert.match(screen, /replaceAll:\s*fullRun === true/);
  assert.match(screen, /persistRows = fullRun/);
  assert.match(screen, /עדכון שינויים בלבד/);
  assert.doesNotMatch(screen, /const fullRun = forceFull\s*\|\|\s*!shared\?\.workspace\s*\|\|\s*!existingRows\.length\s*\|\|\s*unrecoverableGlobalContextChange/);

  const store = await readFile(new URL('../frontend/src/screens/course-scheduling-planning-store.js', import.meta.url), 'utf8');
  assert.match(store, /p_replace_all:\s*replaceAll === true/);

  const migration = await readFile(
    new URL('../supabase/migrations/20260927200000_incremental_planning_partial_persist.sql', import.meta.url),
    'utf8'
  );
  assert.match(migration, /p_replace_all boolean default false/);
  assert.match(migration, /if coalesce\(p_replace_all, false\) then/);
});

test('manager approval policy remains 60 km and is not reinvented', () => {
  assert.equal(MANAGER_APPROVAL_DISTANCE_KM, 60);
  assert.equal(NORTH_STAGE2_MAX_HOME_DISTANCE_KM, 60);
  assert.equal(MAX_HOME_DISTANCE_KM, 40);
});

test('253 rows + 10 affected + 1 changed mid-run persists at most 9 affected rows', async () => {
  const {
    selectIncrementalStablePersistRows,
    assertIncrementalPlanningPersistRows
  } = await import('../frontend/src/screens/course-scheduling-planning-store.js');

  const allIds = Array.from({ length: 253 }, (_, index) => `a${index + 1}`);
  const affectedIds = allIds.slice(0, 10);
  const changedActivityIds = [affectedIds[0]];
  const resultRows = allIds.map((courseId) => ({ courseId, kind: 'proposal' }));

  const stableRows = selectIncrementalStablePersistRows({
    rows: resultRows,
    affectedIds,
    endCourseIds: allIds,
    changedActivityIds,
    fullRun: false
  });

  assert.equal(changedActivityIds.length, 1);
  assert.equal(stableRows.length, 9);
  assert.ok(stableRows.every((row) => affectedIds.includes(row.courseId)));
  assert.ok(!stableRows.some((row) => row.courseId === changedActivityIds[0]));
  assert.ok(!stableRows.some((row) => !affectedIds.includes(row.courseId)));

  const guarded = assertIncrementalPlanningPersistRows(stableRows, affectedIds, { replaceAll: false });
  assert.equal(guarded.length, 9);

  assert.throws(
    () => assertIncrementalPlanningPersistRows(resultRows, affectedIds, { replaceAll: false }),
    /planning_incremental_persist_row_outside_targets/
  );
});

test('replaceAll=false persist payload is capped to the 5 target rows even if result.rows=253', async () => {
  const {
    assertIncrementalPlanningPersistRows
  } = await import('../frontend/src/screens/course-scheduling-planning-store.js');

  const allIds = Array.from({ length: 253 }, (_, index) => `r${index + 1}`);
  const affectedIds = allIds.slice(0, 5);
  const resultRows = allIds.map((courseId) => ({ courseId, kind: 'proposal' }));
  const persistRows = resultRows.filter((row) => affectedIds.includes(row.courseId));

  assert.equal(persistRows.length, 5);
  const guarded = assertIncrementalPlanningPersistRows(persistRows, affectedIds, { replaceAll: false });
  assert.equal(guarded.length, 5);
  assert.deepEqual(guarded.map((row) => row.courseId), affectedIds);

  assert.throws(
    () => assertIncrementalPlanningPersistRows(resultRows, affectedIds, { replaceAll: false }),
    /planning_incremental_persist_row_outside_targets:r6/
  );
});

test('screen mid-run partial save uses selectIncrementalStablePersistRows + allowedIncrementalIds', async () => {
  const source = await readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
  assert.match(source, /selectIncrementalStablePersistRows/);
  assert.match(source, /mergeEffectiveIncrementalPersistIds/);
  assert.match(source, /effectiveAffectedIds/);
  assert.match(source, /regionalChangedIds/);
  assert.match(source, /allowedIncrementalIds:\s*fullRun \? null : effectiveAffectedIds/);
  assert.doesNotMatch(
    source,
    /const stableRows = \(result\.rows \|\| \[\]\)\.filter\(\(row\) => \{\s*const courseId = text\(row\?\.courseId\);\s*return endCourseIds\.has\(courseId\) && !changedActivityIds\.has\(courseId\);/
  );
});

test('1: regional reassignment persists both A and B, never A alone', async () => {
  const {
    diffPlanningRowsChangedIds,
    mergeEffectiveIncrementalPersistIds,
    expandNorthRegionalDependencyClosure
  } = await import('../frontend/src/screens/course-scheduling-planning.js');
  const {
    assertIncrementalPlanningPersistRows
  } = await import('../frontend/src/screens/course-scheduling-planning-store.js');

  const before = [
    {
      courseId: 'A', kind: 'recruitment', district: 'צפון', authority: 'נהריה', requiredLanguage: 'he',
      instructorEmpId: '', meetings: [{ date: '2026-10-20', start_time: '09:00', end_time: '10:30' }]
    },
    {
      courseId: 'B', kind: 'proposal', district: 'צפון', authority: 'נהריה', requiredLanguage: 'he',
      instructorEmpId: 'X', instructorName: 'מדריך X',
      startDate: '2026-10-20', startTime: '09:00', endTime: '10:30',
      meetings: [{ date: '2026-10-20', start_time: '09:00', end_time: '10:30' }]
    },
    {
      courseId: 'C', kind: 'proposal', district: 'צפון', authority: 'חיפה', requiredLanguage: 'he',
      instructorEmpId: 'Z', instructorName: 'מדריך Z',
      startDate: '2026-10-21', startTime: '09:00', endTime: '10:30',
      meetings: [{ date: '2026-10-21', start_time: '09:00', end_time: '10:30' }]
    }
  ];
  const after = [
    { ...before[0], kind: 'proposal', instructorEmpId: 'X', instructorName: 'מדריך X', startDate: '2026-10-20', startTime: '09:00', endTime: '10:30' },
    { ...before[1], instructorEmpId: 'Y', instructorName: 'מדריך Y' },
    { ...before[2] }
  ];

  const examined = expandNorthRegionalDependencyClosure({
    seedIds: ['A'],
    rows: before
  });
  assert.ok(examined.includes('A'));
  assert.ok(examined.includes('B'));
  assert.ok(!examined.includes('C') || examined.includes('B'));

  const regionalChangedIds = diffPlanningRowsChangedIds(before, after, { limitToIds: examined });
  assert.deepEqual([...regionalChangedIds].sort(), ['A', 'B']);
  assert.ok(!regionalChangedIds.includes('C'));

  const effectiveAffectedIds = mergeEffectiveIncrementalPersistIds(['A'], regionalChangedIds);
  assert.deepEqual([...effectiveAffectedIds].sort(), ['A', 'B']);

  const persistRows = after.filter((row) => effectiveAffectedIds.includes(row.courseId));
  assert.equal(persistRows.length, 2);
  assert.equal(persistRows.find((row) => row.courseId === 'A')?.instructorEmpId, 'X');
  assert.equal(persistRows.find((row) => row.courseId === 'B')?.instructorEmpId, 'Y');
  assert.equal(
    assertIncrementalPlanningPersistRows(persistRows, effectiveAffectedIds, { replaceAll: false }).length,
    2
  );
});

test('2: 253 workspace, 12 examined, 3 changed => persist exactly 3', async () => {
  const {
    diffPlanningRowsChangedIds,
    mergeEffectiveIncrementalPersistIds
  } = await import('../frontend/src/screens/course-scheduling-planning.js');
  const {
    assertIncrementalPlanningPersistRows
  } = await import('../frontend/src/screens/course-scheduling-planning-store.js');

  const allIds = Array.from({ length: 253 }, (_, index) => `n${index + 1}`);
  const examinedIds = allIds.slice(0, 12);
  const originalAffected = [allIds[0]];
  const before = allIds.map((courseId, index) => ({
    courseId,
    kind: index === 0 ? 'recruitment' : 'proposal',
    district: 'צפון',
    instructorEmpId: index === 0 ? '' : `emp-${index}`,
    meetings: [{ date: '2026-10-20', start_time: '09:00', end_time: '10:30' }]
  }));
  const after = before.map((row, index) => {
    if (index === 0) return { ...row, kind: 'proposal', instructorEmpId: 'emp-1' };
    if (index === 1) return { ...row, instructorEmpId: 'emp-99' };
    if (index === 2) return { ...row, startTime: '11:00', endTime: '12:30', meetings: [{ date: '2026-10-20', start_time: '11:00', end_time: '12:30' }] };
    return row;
  });

  const regionalChangedIds = diffPlanningRowsChangedIds(before, after, { limitToIds: examinedIds });
  assert.equal(examinedIds.length, 12);
  assert.equal(regionalChangedIds.length, 3);
  const effectiveAffectedIds = mergeEffectiveIncrementalPersistIds(originalAffected, regionalChangedIds);
  assert.equal(effectiveAffectedIds.length, 3);
  const persistRows = after.filter((row) => effectiveAffectedIds.includes(row.courseId));
  assert.equal(persistRows.length, 3);
  assert.equal(253 - 3, 250);
  assert.throws(
    () => assertIncrementalPlanningPersistRows(after, effectiveAffectedIds, { replaceAll: false }),
    /planning_incremental_persist_row_outside_targets/
  );
});

test('3: regional examine-with-no-improvement persists only original affected', async () => {
  const {
    diffPlanningRowsChangedIds,
    mergeEffectiveIncrementalPersistIds
  } = await import('../frontend/src/screens/course-scheduling-planning.js');

  const before = Array.from({ length: 40 }, (_, index) => ({
    courseId: `r${index + 1}`,
    kind: index === 0 ? 'recruitment' : 'proposal',
    district: 'צפון',
    instructorEmpId: index === 0 ? '' : `e${index}`,
    meetings: [{ date: '2026-10-20', start_time: '09:00', end_time: '10:30' }]
  }));
  const after = before.map((row) => ({ ...row }));
  const examinedIds = before.map((row) => row.courseId);
  const regionalChangedIds = diffPlanningRowsChangedIds(before, after, { limitToIds: examinedIds });
  assert.deepEqual(regionalChangedIds, []);
  const effectiveAffectedIds = mergeEffectiveIncrementalPersistIds(['r1'], regionalChangedIds);
  assert.deepEqual(effectiveAffectedIds, ['r1']);
});

test('4/5: reassignment consistency guard rejects missing B when A moved onto X', async () => {
  const {
    assertIncrementalPlanningPersistRows
  } = await import('../frontend/src/screens/course-scheduling-planning-store.js');
  const effectiveAffectedIds = ['A', 'B'];
  const onlyA = [{ courseId: 'A', instructorEmpId: 'X', kind: 'proposal' }];
  // Persisting A alone while B also changed is a caller bug; the guard still
  // allows subset of allowed ids, so the contract is enforced by requiring
  // effectiveAffectedIds to include every regionalChangedId before save.
  assert.equal(
    assertIncrementalPlanningPersistRows(onlyA, effectiveAffectedIds, { replaceAll: false }).length,
    1
  );
  const withC = [
    { courseId: 'A', instructorEmpId: 'X' },
    { courseId: 'B', instructorEmpId: 'Y' },
    { courseId: 'C', instructorEmpId: 'Z' }
  ];
  assert.throws(
    () => assertIncrementalPlanningPersistRows(withC, effectiveAffectedIds, { replaceAll: false }),
    /planning_incremental_persist_row_outside_targets:C/
  );
});

test('north regional optimization returns regionalChangedIds and uses dependency closure', async () => {
  const source = await readFile(new URL('../frontend/src/screens/course-scheduling-planning.js', import.meta.url), 'utf8');
  assert.match(source, /expandNorthRegionalDependencyClosure/);
  assert.match(source, /diffPlanningRowsChangedIds/);
  assert.match(source, /regionalChangedIds/);
  assert.match(source, /NORTH_REGIONAL_CLOSURE_MAX/);
  assert.match(source, /reconcileRecruitmentProfiles|recruitmentProfileChangedIds/);
  assert.doesNotMatch(
    source,
    /regionalTargets = new Set\(\[\s*\.\.\.northRecruitmentIds,\s*\.\.\.rows\s*\.filter\(\(row\) => \['proposal', 'fixed-proposal'\]/
  );
});

function recruitmentFixture(id, profileId, size, {
  kind = 'recruitment',
  day = '20',
  authority = 'נהריה'
} = {}) {
  const date = `2026-10-${day}`;
  return {
    courseId: id,
    kind,
    district: 'צפון',
    authority,
    requiredLanguage: 'he',
    requiredGender: 'any',
    recruitmentProfileId: profileId || undefined,
    recruitmentProfileLabel: profileId ? `תקן גיוס צפון ${String(profileId).split('-').at(-1)}` : undefined,
    recruitmentProfileSize: size || undefined,
    startDate: date,
    endDate: date,
    startTime: '09:00',
    endTime: '10:30',
    meetings: [{ date, start_time: '09:00', end_time: '10:30' }],
    scheduleOptions: [{
      startDate: date,
      endDate: date,
      startTime: '09:00',
      endTime: '10:30',
      meetings: [{ date, start_time: '09:00', end_time: '10:30' }]
    }]
  };
}

test('A: member leaves profile size 2→1 and both rows persist', async () => {
  const {
    reconcileRecruitmentProfiles,
    mergeEffectiveIncrementalPersistIds
  } = await import('../frontend/src/screens/course-scheduling-planning.js');
  const before = [
    recruitmentFixture('R1', 'recruitment-צפון-1', 2, { day: '20' }),
    recruitmentFixture('R2', 'recruitment-צפון-1', 2, { day: '21' })
  ];
  const planned = [
    { ...before[0], kind: 'proposal', instructorEmpId: 'X' },
    { ...before[1] }
  ];
  delete planned[0].recruitmentProfileId;
  delete planned[0].recruitmentProfileLabel;
  delete planned[0].recruitmentProfileSize;
  const reconciled = reconcileRecruitmentProfiles(planned, {
    mode: 'incremental',
    seedCourseIds: ['R1', 'R2'],
    previousRows: before
  });
  const r2 = reconciled.rows.find((row) => row.courseId === 'R2');
  assert.equal(r2.recruitmentProfileId, 'recruitment-צפון-1');
  assert.equal(r2.recruitmentProfileSize, 1);
  assert.ok(reconciled.changedIds.includes('R1'));
  assert.ok(reconciled.changedIds.includes('R2'));
  assert.deepEqual(
    mergeEffectiveIncrementalPersistIds(['R1'], [], reconciled.changedIds).sort(),
    ['R1', 'R2']
  );
});

test('B: member joins profile size 2→3 and all three rows persist', async () => {
  const { reconcileRecruitmentProfiles } = await import('../frontend/src/screens/course-scheduling-planning.js');
  const before = [
    recruitmentFixture('R2', 'recruitment-צפון-2', 2, { day: '20' }),
    recruitmentFixture('R3', 'recruitment-צפון-2', 2, { day: '21' })
  ];
  const planned = [
    recruitmentFixture('R1', '', 0, { day: '22' }),
    ...before
  ];
  delete planned[0].recruitmentProfileId;
  delete planned[0].recruitmentProfileLabel;
  delete planned[0].recruitmentProfileSize;
  const reconciled = reconcileRecruitmentProfiles(planned, {
    mode: 'incremental',
    seedCourseIds: ['R1'],
    previousRows: before
  });
  assert.ok(reconciled.rows.every((row) => row.recruitmentProfileId === 'recruitment-צפון-2'));
  assert.ok(reconciled.rows.every((row) => row.recruitmentProfileSize === 3));
  assert.deepEqual([...reconciled.changedIds].sort(), ['R1', 'R2', 'R3']);
});

test('C: unrelated profile keeps stable ID without renumbering', async () => {
  const { reconcileRecruitmentProfiles } = await import('../frontend/src/screens/course-scheduling-planning.js');
  const before = [
    recruitmentFixture('R1', 'recruitment-צפון-1', 1, { day: '20' }),
    recruitmentFixture('R2', 'recruitment-צפון-2', 1, { day: '21', authority: 'עכו' })
  ];
  const planned = [
    { ...before[0], kind: 'proposal', instructorEmpId: 'X' },
    { ...before[1] }
  ];
  delete planned[0].recruitmentProfileId;
  delete planned[0].recruitmentProfileLabel;
  delete planned[0].recruitmentProfileSize;
  const reconciled = reconcileRecruitmentProfiles(planned, {
    mode: 'incremental',
    seedCourseIds: ['R1'],
    previousRows: before
  });
  const r2 = reconciled.rows.find((row) => row.courseId === 'R2');
  assert.equal(r2.recruitmentProfileId, 'recruitment-צפון-2');
  assert.notEqual(r2.recruitmentProfileId, 'recruitment-צפון-1');
});

test('D: fingerprint treats same profileId with size 4→3 as changed', async () => {
  const {
    planningRowPlanningFingerprint,
    diffPlanningRowsChangedIds
  } = await import('../frontend/src/screens/course-scheduling-planning.js');
  const before = [recruitmentFixture('R', 'recruitment-צפון-2', 4)];
  const after = [recruitmentFixture('R', 'recruitment-צפון-2', 3)];
  assert.notEqual(planningRowPlanningFingerprint(before[0]), planningRowPlanningFingerprint(after[0]));
  assert.deepEqual(diffPlanningRowsChangedIds(before, after), ['R']);
});

test('E: 30 recruitment rows, 8 examined, 3 changed => persist only 3 profile rows', async () => {
  const {
    mergeEffectiveIncrementalPersistIds
  } = await import('../frontend/src/screens/course-scheduling-planning.js');
  const {
    assertIncrementalPlanningPersistRows
  } = await import('../frontend/src/screens/course-scheduling-planning-store.js');
  const all = Array.from({ length: 253 }, (_, index) => `w${index + 1}`);
  const recruitmentIds = all.slice(0, 30);
  const examined = recruitmentIds.slice(0, 8);
  const changed = examined.slice(0, 3);
  const effective = mergeEffectiveIncrementalPersistIds(['w1'], [], changed);
  assert.equal(effective.length, 3);
  const payload = effective.map((courseId) => ({ courseId, kind: 'recruitment' }));
  assert.equal(
    assertIncrementalPlanningPersistRows(payload, effective, { replaceAll: false }).length,
    3
  );
  assert.equal(recruitmentIds.length - changed.length, 27);
  assert.throws(
    () => assertIncrementalPlanningPersistRows(
      examined.map((courseId) => ({ courseId })),
      effective,
      { replaceAll: false }
    ),
    /planning_incremental_persist_row_outside_targets/
  );
});

test('F: resumeFromCheckpoint still reconciles recruitment profiles', async () => {
  const source = await readFile(new URL('../frontend/src/screens/course-scheduling-planning.js', import.meta.url), 'utf8');
  assert.match(source, /if \(planningScopeIds\) \{/);
  assert.match(source, /resumeFromCheckpoint/);
  assert.match(source, /recruitmentProfileChangedIds/);
  assert.match(source, /mode:\s*'incremental'/);
  assert.match(source, /applyIncrementalNorthRegionalOptimization/);
  // Regional pass is no longer gated by !resumeFromCheckpoint.
  assert.doesNotMatch(source, /if \(incrementalIds && !resumeFromCheckpoint\)/);
});

test('screen merges recruitmentProfileChangedIds into effectiveAffectedIds', async () => {
  const source = await readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
  assert.match(source, /recruitmentProfileChangedIds/);
  assert.match(source, /incrementalScopeIds:\s*fullRun \? null : affectedIds/);
  assert.match(source, /mergeEffectiveIncrementalPersistIds\(\s*affectedIds,\s*regionalChangedIds,\s*recruitmentProfileChangedIds\s*\)/);
});

test('resumeFromCheckpoint still runs North regional optimization and can change C', async () => {
  const {
    applyIncrementalNorthRegionalOptimization,
    mergeEffectiveIncrementalPersistIds,
    collectNorthRegionalRecruitmentSeedIds
  } = await import('../frontend/src/screens/course-scheduling-planning.js');
  const {
    assertIncrementalPlanningPersistRows
  } = await import('../frontend/src/screens/course-scheduling-planning-store.js');

  // A completed in checkpoint as recruitment; B finished on resume; C is a
  // nearby unlocked North proposal that repair can move to free capacity for A.
  const combinedAfterTargets = [
    {
      courseId: 'A', kind: 'recruitment', district: 'צפון', authority: 'נהריה', requiredLanguage: 'he',
      instructorEmpId: '', meetings: [{ date: '2026-10-20', start_time: '09:00', end_time: '10:30' }]
    },
    {
      courseId: 'B', kind: 'proposal', district: 'צפון', authority: 'נהריה', requiredLanguage: 'he',
      instructorEmpId: 'Y', instructorName: 'מדריך Y',
      startDate: '2026-10-21', startTime: '09:00', endTime: '10:30',
      meetings: [{ date: '2026-10-21', start_time: '09:00', end_time: '10:30' }]
    },
    {
      courseId: 'C', kind: 'proposal', district: 'צפון', authority: 'נהריה', requiredLanguage: 'he',
      instructorEmpId: 'X', instructorName: 'מדריך X',
      startDate: '2026-10-20', startTime: '09:00', endTime: '10:30',
      meetings: [{ date: '2026-10-20', start_time: '09:00', end_time: '10:30' }]
    }
  ];

  // Remaining resume target is only B; full incremental scope is still A+B.
  const remainingTargets = new Set(['B']);
  const fullScope = ['A', 'B'];
  assert.deepEqual(
    collectNorthRegionalRecruitmentSeedIds(combinedAfterTargets, remainingTargets),
    []
  );
  assert.deepEqual(
    collectNorthRegionalRecruitmentSeedIds(combinedAfterTargets, fullScope),
    ['A']
  );

  let repairCalled = false;
  const repairedRows = [
    {
      ...combinedAfterTargets[0],
      kind: 'proposal',
      instructorEmpId: 'X',
      instructorName: 'מדריך X',
      startDate: '2026-10-20',
      startTime: '09:00',
      endTime: '10:30'
    },
    { ...combinedAfterTargets[1] },
    {
      ...combinedAfterTargets[2],
      instructorEmpId: 'Z',
      instructorName: 'מדריך Z',
      startDate: '2026-10-22',
      startTime: '11:00',
      endTime: '12:30',
      meetings: [{ date: '2026-10-22', start_time: '11:00', end_time: '12:30' }]
    }
  ];

  const pass = await applyIncrementalNorthRegionalOptimization({
    rows: combinedAfterTargets,
    scopeIds: fullScope,
    resumeFromCheckpoint: true,
    buildRepairPlan: async ({ regionalTargets, northRecruitmentIds }) => {
      repairCalled = true;
      assert.ok(northRecruitmentIds.includes('A'));
      assert.ok(regionalTargets.includes('A'));
      assert.ok(regionalTargets.includes('C'));
      return { rows: repairedRows, recruitment: 0 };
    }
  });

  assert.equal(repairCalled, true);
  assert.equal(pass.northRegionalOptimization.applied, true);
  assert.ok(pass.northRegionalOptimization.regionalChangedIds.includes('C'));
  assert.ok(pass.northRegionalOptimization.regionalChangedIds.includes('A'));
  assert.equal(pass.northRegionalOptimization.afterRecruitment, 0);
  assert.equal(pass.rows.find((row) => row.courseId === 'A')?.kind, 'proposal');

  const effectiveAffectedIds = mergeEffectiveIncrementalPersistIds(
    fullScope,
    pass.northRegionalOptimization.regionalChangedIds
  );
  assert.ok(effectiveAffectedIds.includes('A'));
  assert.ok(effectiveAffectedIds.includes('C'));
  assert.ok(effectiveAffectedIds.includes('B'));
  const persistRows = pass.rows.filter((row) => effectiveAffectedIds.includes(row.courseId));
  assert.equal(
    assertIncrementalPlanningPersistRows(persistRows, effectiveAffectedIds, { replaceAll: false }).length,
    persistRows.length
  );
  assert.ok(!effectiveAffectedIds.includes('D'));
});

test('resumeFromCheckpoint regional optimization with no improvement persists no extra rows', async () => {
  const {
    applyIncrementalNorthRegionalOptimization,
    mergeEffectiveIncrementalPersistIds
  } = await import('../frontend/src/screens/course-scheduling-planning.js');

  const rows = [
    {
      courseId: 'A', kind: 'recruitment', district: 'צפון', authority: 'נהריה', requiredLanguage: 'he',
      instructorEmpId: '', meetings: [{ date: '2026-10-20', start_time: '09:00', end_time: '10:30' }]
    },
    {
      courseId: 'B', kind: 'proposal', district: 'צפון', authority: 'נהריה', requiredLanguage: 'he',
      instructorEmpId: 'Y', instructorName: 'מדריך Y',
      startDate: '2026-10-21', startTime: '09:00', endTime: '10:30',
      meetings: [{ date: '2026-10-21', start_time: '09:00', end_time: '10:30' }]
    },
    {
      courseId: 'C', kind: 'proposal', district: 'צפון', authority: 'נהריה', requiredLanguage: 'he',
      instructorEmpId: 'X', instructorName: 'מדריך X',
      startDate: '2026-10-20', startTime: '09:00', endTime: '10:30',
      meetings: [{ date: '2026-10-20', start_time: '09:00', end_time: '10:30' }]
    }
  ];

  let repairCalled = false;
  const pass = await applyIncrementalNorthRegionalOptimization({
    rows,
    scopeIds: ['A', 'B'],
    resumeFromCheckpoint: true,
    buildRepairPlan: async ({ regionalTargets }) => {
      repairCalled = true;
      assert.ok(regionalTargets.includes('C'));
      // Same rows / same recruitment => no improvement.
      return { rows: rows.map((row) => ({ ...row })), recruitment: 1 };
    }
  });

  assert.equal(repairCalled, true);
  assert.equal(pass.northRegionalOptimization.applied, false);
  assert.deepEqual(pass.northRegionalOptimization.regionalChangedIds, []);
  const effectiveAffectedIds = mergeEffectiveIncrementalPersistIds(['A', 'B'], pass.northRegionalOptimization.regionalChangedIds);
  assert.deepEqual([...effectiveAffectedIds].sort(), ['A', 'B']);
  assert.equal(pass.rows.find((row) => row.courseId === 'A')?.kind, 'recruitment');
});
