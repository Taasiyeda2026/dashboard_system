import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  sharedPlanningAffectedCourseIds,
  pointMutationDependentCourseIds,
  shouldAutoRefreshPlanning,
  AUTO_PLANNING_REFRESH_MAX_IDS
} from '../frontend/src/screens/course-scheduling-planning-store.js';

const meeting = (date) => [{ date, start_time: '10:00', end_time: '11:30' }];

test('one instructor reassignment refreshes only true date/resource dependents', async () => {
  const oldStamp = '2026-09-29T20:00:00Z';
  const newStamp = '2026-09-29T21:00:00Z';
  const shared = {
    workspace: { revision: 1 },
    rows: [
      { activityId: 'a', activityUpdatedAt: oldStamp, needsRecalc: true, row: { kind: 'proposal', instructorEmpId: '1', meetings: meeting('2026-10-11') } },
      { activityId: 'b', activityUpdatedAt: oldStamp, needsRecalc: false, row: { kind: 'proposal', instructorEmpId: '1', meetings: meeting('2026-10-11') } },
      { activityId: 'c', activityUpdatedAt: oldStamp, needsRecalc: false, row: { kind: 'proposal', instructorEmpId: '1', meetings: meeting('2026-10-18') } },
      { activityId: 'd', activityUpdatedAt: oldStamp, needsRecalc: false, row: { kind: 'proposal', instructorEmpId: '3', meetings: meeting('2026-10-11') } },
      { activityId: 'live', activityUpdatedAt: oldStamp, needsRecalc: false, row: { kind: 'live', instructorEmpId: '1', meetings: meeting('2026-10-11') } }
    ]
  };
  const activities = [
    { row_id: 'a', updated_at: newStamp, emp_id: '2', date_1: '2026-10-11', start_time: '10:00', end_time: '11:30' },
    { row_id: 'b', updated_at: oldStamp, date_1: '2026-10-11', start_time: '10:00', end_time: '11:30' },
    { row_id: 'c', updated_at: oldStamp, date_1: '2026-10-18', start_time: '10:00', end_time: '11:30' },
    { row_id: 'd', updated_at: oldStamp, date_1: '2026-10-11', start_time: '10:00', end_time: '11:30' },
    { row_id: 'live', updated_at: oldStamp, emp_id: '1', date_1: '2026-10-11', start_time: '10:00', end_time: '11:30' }
  ];
  const affected = sharedPlanningAffectedCourseIds({
    shared,
    activities,
    currentCourseIds: activities.map((row) => row.row_id)
  }).sort();
  assert.deepEqual(affected, ['a', 'b']);

  const dependents = pointMutationDependentCourseIds({
    shared,
    activities,
    activityId: 'a',
    oldInstructorIds: ['1'],
    newInstructorIds: ['2'],
    meetingDates: ['2026-10-11']
  }).sort();
  assert.ok(dependents.includes('a'));
  assert.ok(dependents.includes('b'));
  assert.ok(!dependents.includes('c'));
  assert.ok(!dependents.includes('d'));
  assert.ok(!dependents.includes('live'));
  assert.ok(shouldAutoRefreshPlanning(dependents));
  assert.ok(!shouldAutoRefreshPlanning(Array.from({ length: AUTO_PLANNING_REFRESH_MAX_IDS + 1 }, (_, i) => String(i))));
});

test('point planning invalidation queues automatic scoped refresh without a manual update button', async () => {
  const source = await readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
  const handler = source.slice(source.indexOf('const onPlanningNeedsRecalc'), source.indexOf('const attachActivePlanningRunUi'));
  assert.match(handler, /autoRefresh !== true/);
  assert.match(handler, /scheduleBackgroundPlanning\(\{ forceFull: false, reuseSnapshot: true \}\)/);
  assert.match(source, /data-run-full-course-planning/);
  assert.match(source, /const endFacts = await loadSchedulingPlanningPreflight\(scope\)/);
  assert.equal(AUTO_PLANNING_REFRESH_MAX_IDS >= 1, true);
});
