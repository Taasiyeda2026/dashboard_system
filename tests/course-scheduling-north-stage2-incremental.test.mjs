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
  assert.match(source, /allowedIncrementalIds:\s*fullRun \? currentCourseIds : affectedIds/);
  assert.match(source, /allowedIncrementalIds:\s*fullRun \? null : affectedIds/);
  assert.doesNotMatch(
    source,
    /const stableRows = \(result\.rows \|\| \[\]\)\.filter\(\(row\) => \{\s*const courseId = text\(row\?\.courseId\);\s*return endCourseIds\.has\(courseId\) && !changedActivityIds\.has\(courseId\);/
  );
});
