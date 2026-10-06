import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { buildDynamicCoursePlan } from '../frontend/src/screens/course-scheduling-planning.js';
import { createRouteClient } from '../frontend/src/screens/course-scheduling-travel.js';
import { sharedPlanningAffectedCourseIds } from '../frontend/src/screens/course-scheduling-planning-store.js';
import {
  flushPlanningPerfReport,
  resetPlanningPerfReport,
  setPlanningPerfEnabled
} from '../frontend/src/screens/course-scheduling-perf.js';

const instructorRows = (count = 8) => Array.from({ length: count }, (_, index) => ({
  emp_id: String(index + 1),
  full_name: `Instructor ${index + 1}`,
  active: 'yes',
  address: `home${index + 1}`
}));

const profileRows = (instructors) => Object.fromEntries(instructors.map((instructor) => [
  instructor.emp_id,
  { emp_id: instructor.emp_id, instruction_languages: ['he'], gender: 'female' }
]));

const ruleRows = (instructors) => Object.fromEntries(instructors.map((instructor) => [
  instructor.emp_id,
  Array.from({ length: 7 }, (_, weekday) => ({
    emp_id: instructor.emp_id,
    weekday,
    available: true,
    start_time: '08:00',
    end_time: '18:00'
  }))
]));

const activity = (id, date = '2026-10-11') => ({
  row_id: id,
  activity_season: 'school_2027',
  activity_type: 'course',
  status: 'פתוח',
  activity_name: 'ביומימיקרי',
  school: 'בית ספר מדידה',
  authority: 'רשות מדידה',
  district: 'מרכז',
  calendar_sector: 'general',
  required_instructor_gender: 'any',
  school_id: 1,
  school_address: 'school',
  instruction_language: 'he',
  sessions: 1,
  date_1: date,
  updated_at: '2026-09-29T20:00:00Z'
});

const warmRows = (instructors) => instructors.flatMap((instructor) => ([
  {
    origin_key: instructor.address,
    destination_key: 'school',
    origin_address: instructor.address,
    destination_address: 'school',
    distance_km: 5,
    duration_minutes: 10
  },
  {
    origin_key: 'school',
    destination_key: instructor.address,
    origin_address: 'school',
    destination_address: instructor.address,
    distance_km: 5,
    duration_minutes: 10
  }
]));

async function measured(label, fn) {
  setPlanningPerfEnabled(true);
  resetPlanningPerfReport(label);
  const started = performance.now();
  try {
    const value = await fn();
    const wallMs = Math.round((performance.now() - started) * 10) / 10;
    const report = flushPlanningPerfReport({ log: false });
    const summary = { label, wallMs, counters: report.counters, timers: report.timers };
    console.log(`PLANNING_PERF_SCENARIO ${JSON.stringify(summary)}`);
    return { value, report, wallMs };
  } finally {
    setPlanningPerfEnabled(false);
  }
}

test('planning perf harness: no-op reopen does zero engine work', async () => {
  const activities = [activity('noop')];
  const shared = {
    workspace: { engineVersion: 'current' },
    rows: [{
      activityId: 'noop',
      activityUpdatedAt: activities[0].updated_at,
      needsRecalc: false,
      row: { courseId: 'noop', kind: 'proposal', instructorEmpId: '1', meetings: [] }
    }]
  };
  const measuredResult = await measured('noop-reopen', async () => sharedPlanningAffectedCourseIds({
    shared,
    activities,
    currentCourseIds: ['noop']
  }));
  assert.deepEqual(measuredResult.value, []);
  assert.equal(measuredResult.report.counters.scheduleCalls, 0);
  assert.equal(measuredResult.report.counters.activitiesComputed, 0);
  assert.equal(measuredResult.report.counters.candidateEvals, 0);
  assert.equal(measuredResult.report.counters.routeCacheRequests, 0);
  assert.equal(measuredResult.report.counters.googleCalls, 0);
  assert.equal(measuredResult.report.counters.checkpointSaves, 0);
  assert.equal(measuredResult.report.counters.checkpointPayloadBytes, 0);
});

test('planning perf harness: one dirty activity with warm routes', async () => {
  const instructors = instructorRows(8);
  const target = activity('single');
  const routeClient = createRouteClient({
    preloadedRows: warmRows(instructors),
    invoke: async () => {
      throw new Error('warm-cache scenario must not call route service');
    }
  });
  const measuredResult = await measured('single-dirty', () => buildDynamicCoursePlan({
    activities: [target],
    instructors,
    profiles: profileRows(instructors),
    rules: ruleRows(instructors),
    exceptions: {},
    schoolCalendar: [],
    catalog: [{ activity_name: 'ביומימיקרי', meetings_count: 1, hours_count: 1.5 }],
    today: '2026-09-29',
    routeClient,
    targetCourseIds: ['single'],
    existingRows: [],
    allowGlobalRepair: false,
    planningProfile: 'fast'
  }));
  assert.equal(measuredResult.value.rows.length, 1);
  assert.equal(measuredResult.report.counters.activitiesComputed, 1);
  assert.equal(routeClient.googleCalls, 0);
  assert.equal(measuredResult.report.counters.googleCalls, 0);
  assert.equal(measuredResult.report.counters.checkpointSaves, 0);
  assert.ok(measuredResult.report.counters.scheduleCalls > 0);
  assert.ok(measuredResult.report.counters.candidateEvals > 0);
});

test('planning perf harness: five dirty activities with warm routes', async () => {
  const instructors = instructorRows(8);
  const activities = Array.from({ length: 5 }, (_, index) => activity(
    `dirty-${index + 1}`,
    `2026-10-${String(11 + index).padStart(2, '0')}`
  ));
  const routeClient = createRouteClient({
    preloadedRows: warmRows(instructors),
    invoke: async () => {
      throw new Error('warm-cache scenario must not call route service');
    }
  });
  const measuredResult = await measured('five-dirty-warm-cache', () => buildDynamicCoursePlan({
    activities,
    instructors,
    profiles: profileRows(instructors),
    rules: ruleRows(instructors),
    exceptions: {},
    schoolCalendar: [],
    catalog: [{ activity_name: 'ביומימיקרי', meetings_count: 1, hours_count: 1.5 }],
    today: '2026-09-29',
    routeClient,
    targetCourseIds: activities.map((row) => row.row_id),
    existingRows: [],
    allowGlobalRepair: false,
    planningProfile: 'fast'
  }));
  assert.equal(measuredResult.value.rows.length, 5);
  assert.equal(measuredResult.report.counters.activitiesComputed, 5);
  assert.equal(routeClient.googleCalls, 0);
  assert.equal(measuredResult.report.counters.googleCalls, 0);
  assert.ok(measuredResult.report.counters.scheduleCalls >= 5);
  assert.ok(measuredResult.report.counters.candidateEvals > 0);
});

test('planning fast search prunes hard-ineligible instructors before scenario evaluation', async () => {
  const instructors = instructorRows(24);
  const profiles = profileRows(instructors);
  for (const instructor of instructors.slice(1)) {
    profiles[instructor.emp_id] = { emp_id: instructor.emp_id, instruction_languages: ['ar'], gender: 'male' };
  }
  const target = { ...activity('static-shortlist'), date_1: '', required_instructor_gender: 'female' };
  const routeClient = createRouteClient({
    preloadedRows: warmRows(instructors),
    invoke: async () => { throw new Error('warm-cache scenario must not call route service'); }
  });
  const measuredResult = await measured('static-shortlist', () => buildDynamicCoursePlan({
    activities: [target],
    instructors,
    profiles,
    rules: ruleRows(instructors),
    exceptions: {},
    schoolCalendar: [],
    catalog: [{ activity_name: 'ביומימיקרי', meetings_count: 1, hours_count: 1.5 }],
    today: '2026-09-29',
    routeClient,
    targetCourseIds: ['static-shortlist'],
    existingRows: [],
    allowGlobalRepair: false,
    planningProfile: 'fast'
  }));
  assert.equal(measuredResult.value.rows.length, 1);
  assert.equal(measuredResult.report.counters.staticCandidatePruned, 23);
  assert.ok(measuredResult.report.counters.candidateEvals < 24, 'the 23 impossible instructors must not enter expensive candidate evaluation');
});

test('full maintenance defers recruitment rescue until the fast base plan is complete', async () => {
  const instructors = instructorRows(8);
  const profiles = Object.fromEntries(instructors.map((instructor) => [
    instructor.emp_id,
    { emp_id: instructor.emp_id, instruction_languages: ['ar'], gender: 'male' }
  ]));
  const target = { ...activity('deferred-rescue'), date_1: '', required_instructor_gender: 'female' };
  const routeClient = createRouteClient({
    preloadedRows: warmRows(instructors),
    invoke: async () => { throw new Error('warm-cache scenario must not call route service'); }
  });
  const phases = [];
  const measuredResult = await measured('deferred-full-rescue', () => buildDynamicCoursePlan({
    activities: [target],
    instructors,
    profiles,
    rules: ruleRows(instructors),
    exceptions: {},
    schoolCalendar: [],
    catalog: [{ activity_name: 'ביומימיקרי', meetings_count: 1, hours_count: 1.5 }],
    today: '2026-09-29',
    routeClient,
    existingRows: [],
    allowGlobalRepair: true,
    planningProfile: 'fast',
    onProgress: async ({ phase }) => phases.push(phase)
  }));
  const baseDone = phases.indexOf('בניית תוכנית');
  const rescueStarted = phases.indexOf('מיצוי צוות קיים לפני גיוס');
  assert.ok(baseDone >= 0 && rescueStarted > baseDone, 'full maintenance rescue must run after the base activity loop');
  assert.equal(measuredResult.report.counters.rescueDeferred, 1);
  assert.equal(measuredResult.report.counters.rescueProcessed, 1);
  assert.equal(measuredResult.value.rows[0].kind, 'recruitment');
});
