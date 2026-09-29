import test from 'node:test';
import assert from 'node:assert/strict';
import { sharedPlanningAffectedCourseIds } from '../frontend/src/screens/course-scheduling-planning-store.js';

test('unchanged second planning check returns zero affected ids', () => {
  const stamp = '2026-09-29T20:00:00Z';
  const activity = { row_id: 'stable', updated_at: stamp, date_1: '2026-10-11', start_time: '10:00', end_time: '11:30' };
  const shared = {
    workspace: { revision: 2, engineVersion: 'same' },
    rows: [{
      activityId: 'stable',
      activityUpdatedAt: stamp,
      needsRecalc: false,
      row: { kind: 'proposal', instructorEmpId: '1', meetings: [{ date: '2026-10-11', start_time: '10:00', end_time: '11:30' }] }
    }]
  };
  assert.deepEqual(sharedPlanningAffectedCourseIds({
    shared,
    activities: [activity],
    currentCourseIds: ['stable']
  }), []);
});
