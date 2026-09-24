import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  PlanningCancelledError,
  buildDynamicCoursePlan,
  createPlanningCheckpoint
} from '../frontend/src/screens/course-scheduling-planning.js';
import { createRouteClient } from '../frontend/src/screens/course-scheduling-travel.js';

const screenSource = await readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');

const activity = {
  row_id: 'course-1',
  activity_season: 'school_2027',
  activity_type: 'course',
  activity_family: 'program',
  status: 'פתוח',
  activity_name: 'תוכנית בדיקה',
  activity_no: '100',
  authority: 'רשות',
  school: 'בית ספר',
  school_id: 'school-1',
  school_address: 'כתובת בית ספר',
  sessions: 2,
  instruction_language: 'he',
  required_instructor_gender: 'any'
};

const instructors = [
  { emp_id: '1', full_name: 'מדריך א', active: 'yes', address: 'כתובת א' },
  { emp_id: '2', full_name: 'מדריך ב', active: 'yes', address: 'כתובת ב' }
];
const profiles = {
  1: { emp_id: '1', gender: 'male', instruction_languages: ['he'], friday_allowed: false },
  2: { emp_id: '2', gender: 'male', instruction_languages: ['he'], friday_allowed: false }
};
const rules = Object.fromEntries(instructors.map(({ emp_id }) => [emp_id, [0, 1, 2, 3, 4].map((weekday) => ({
  emp_id,
  weekday,
  available: true,
  start_time: '07:00',
  end_time: '18:00'
}))]));
const catalog = [{ activity_no: '100', activity_name: 'תוכנית בדיקה', meetings_count: 2, hours_count: 3 }];

function routeClient() {
  return {
    request: async () => ({ distance_km: 5, duration_minutes: 10, cached: true }),
    unavailableReason: '',
    googleCalls: 0,
    cacheHits: 0,
    requests: []
  };
}

function planningInput(checkpoint) {
  return {
    activities: [activity],
    instructors,
    profiles,
    rules,
    exceptions: {},
    schoolCalendar: [],
    catalog,
    today: '2026-10-06',
    routeClient: routeClient(),
    checkpoint
  };
}

test('cooperative planner yielding preserves deterministic planning output', async () => {
  let aggressiveCheckpoints = 0;
  const baseline = await buildDynamicCoursePlan(planningInput(async () => {}));
  const yielded = await buildDynamicCoursePlan(planningInput(async () => { aggressiveCheckpoints += 1; }));

  assert.ok(aggressiveCheckpoints > 1, 'one heavy course must expose multiple cooperative boundaries');
  assert.deepEqual(yielded, baseline);
});

test('planning checkpoint enforces and resets the eight millisecond CPU budget', async () => {
  let clock = 0;
  let yields = 0;
  const checkpoint = createPlanningCheckpoint({
    budgetMs: 8,
    now: () => clock,
    yieldControl: async () => { yields += 1; }
  });

  assert.equal(await checkpoint(), false);
  clock = 7;
  assert.equal(await checkpoint(), false);
  clock = 8;
  assert.equal(await checkpoint(), true);
  assert.equal(yields, 1);
  clock = 15;
  assert.equal(await checkpoint(), false);
  clock = 16;
  assert.equal(await checkpoint(), true);
  assert.equal(yields, 2);
});

test('cancelled planning stops at a cooperative boundary', async () => {
  let checkpoints = 0;
  await assert.rejects(
    buildDynamicCoursePlan(planningInput(async () => {
      checkpoints += 1;
      if (checkpoints === 4) throw new PlanningCancelledError();
    })),
    (error) => error?.code === 'planning_cancelled'
  );
  assert.equal(checkpoints, 4);
});

test('leaving scheduling cancels a pending automatic planning startup', async () => {
  globalThis.sessionStorage ||= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.localStorage ||= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const { courseSchedulingScreen, scheduleCoursePlanningStart } = await import('../frontend/src/screens/course-scheduling.js');
  let idleCallback = null;
  let starts = 0;
  const state = { courseSchedulingPlanningLoading: false, courseSchedulingPlanningProgress: null };
  scheduleCoursePlanningStart({
    start: () => { starts += 1; },
    isActive: () => true,
    requestIdle: (callback) => { idleCallback = callback; return 7; }
  });

  courseSchedulingScreen.onLeave({ state });
  idleCallback();

  assert.equal(starts, 0);
  assert.equal(state.courseSchedulingPlanningLoading, false);
  assert.equal(state.courseSchedulingPlanningProgress, null);
});

test('travel queue stops dequeuing after cancellation while its in-flight request may finish', async () => {
  const controller = new AbortController();
  let resolveFirst;
  const firstResponse = new Promise((resolve) => { resolveFirst = resolve; });
  const invoked = [];
  const client = createRouteClient({
    concurrency: 1,
    signal: controller.signal,
    invoke: async (payload) => {
      invoked.push(payload);
      return invoked.length === 1 ? firstResponse : { data: { calculated: true, distance_km: 2, duration_minutes: 3 }, error: null };
    }
  });

  const requests = [
    client.request('א', 'ב'),
    client.request('ג', 'ד'),
    client.request('ה', 'ו')
  ];
  controller.abort();
  resolveFirst({ data: { calculated: true, distance_km: 1, duration_minutes: 2 }, error: null });
  const results = await Promise.allSettled(requests);

  assert.equal(invoked.length, 1);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.equal(results[2].status, 'rejected');
});

test('incremental cooperative planning evaluates only the affected activity', async () => {
  const unaffectedActivity = { ...activity, row_id: 'course-2', school_id: 'school-2', school: 'בית ספר ב', school_address: 'כתובת בית ספר ב' };
  const unaffectedRow = {
    courseId: 'course-2',
    kind: 'proposal',
    status: 'מועד מומלץ לבית הספר',
    instructorEmpId: '2',
    instructorName: 'מדריך ב',
    startDate: '2026-11-01',
    endDate: '2026-11-08',
    startTime: '09:00',
    endTime: '10:30',
    meetings: [{ date: '2026-11-01', start_time: '09:00', end_time: '10:30' }],
    options: []
  };
  const progressCourseIds = [];
  let routeRequests = 0;
  const result = await buildDynamicCoursePlan({
    ...planningInput(async () => {}),
    activities: [activity, unaffectedActivity],
    existingRows: [unaffectedRow],
    targetCourseIds: ['course-1'],
    routeClient: {
      ...routeClient(),
      request: async () => {
        routeRequests += 1;
        return { distance_km: 5, duration_minutes: 10, cached: true };
      }
    },
    onProgress: ({ courseId }) => { if (courseId) progressCourseIds.push(courseId); }
  });

  assert.deepEqual([...new Set(progressCourseIds)], ['course-1']);
  assert.ok(routeRequests > 0);
  const reused = result.rows.find((row) => row.courseId === 'course-2');
  assert.equal(reused.instructorEmpId, unaffectedRow.instructorEmpId);
  assert.deepEqual(reused.meetings, unaffectedRow.meetings);
});

test('run ownership guards stale snapshot save, state application, toast and final rerender', () => {
  const run = screenSource.slice(screenSource.indexOf('const runCoursePlanning = async'), screenSource.indexOf('const clonePlanningOption'));
  const saveIndex = run.indexOf('await saveSharedPlanningSnapshot');
  assert.ok(saveIndex > 0);
  assert.ok(run.lastIndexOf('assertRunOwnership()', saveIndex) > 0, 'ownership must be asserted immediately before save');
  assert.match(run, /if \(isPlanningCancellationError\(error\) \|\| !ownsRun\(\)\) return;/);
  assert.match(run, /if \(!ownsRun\(\)\) return;[\s\S]*?rerenderPreservingWorkboardScroll\(\)/);
  assert.ok(run.indexOf('assertRunOwnership()', saveIndex + 1) > saveIndex, 'save result must not apply after ownership is lost');
});
