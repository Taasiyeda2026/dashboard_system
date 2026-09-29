import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sharedPlanningAffectedCourseIds } from '../frontend/src/screens/course-scheduling-planning-store.js';

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
});

test('point planning invalidation queues automatic scoped refresh without a manual update button', async () => {
  const source = await readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
  const handler = source.slice(source.indexOf('const onPlanningNeedsRecalc'), source.indexOf('const attachActivePlanningRunUi'));
  assert.match(handler, /scheduleBackgroundPlanning\(\{ forceFull: false, reuseSnapshot: true \}\)/);
  assert.doesNotMatch(handler, /data-run-course-planning|עדכן רק את השינויים/);
});
