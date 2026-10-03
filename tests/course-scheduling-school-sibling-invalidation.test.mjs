import test from 'node:test';
import assert from 'node:assert/strict';
import {
  expandPlanningAffectedIdsBySchool,
  planningEngineUpgradeAffectedCourseIds,
  pointMutationDependentCourseIds
} from '../frontend/src/screens/course-scheduling-planning-store.js';

const activities = Array.from({ length: 7 }, (_, index) => ({
  row_id: index < 5 ? `school-a-${index}` : `other-${index}`,
  school_id: index < 5 ? 'school-a' : `school-${index}`
}));
const shared = { rows: activities.map((activity) => ({
  activityId: activity.row_id,
  row: { courseId: activity.row_id, schoolId: activity.school_id, kind: 'proposal', instructorEmpId: String(100 + activities.indexOf(activity)), meetings: [] }
})) };

test('H: one changed activity expands to five school siblings, not the workspace', () => {
  const ids = expandPlanningAffectedIdsBySchool({ affectedIds: ['school-a-0'], shared, activities });
  assert.deepEqual(new Set(ids), new Set(activities.slice(0, 5).map((row) => row.row_id)));
  assert.equal(ids.length, 5);
});

test('point mutation includes school siblings without a national rebuild', () => {
  const ids = pointMutationDependentCourseIds({ shared, activities, activityId: 'school-a-0' });
  assert.deepEqual(new Set(ids), new Set(activities.slice(0, 5).map((row) => row.row_id)));
});

test('v23 to v24 targets only multi-proposal schools and supports legacy rows via activities', () => {
  const legacyShared = { rows: shared.rows.map((entry) => ({ ...entry, row: { ...entry.row, schoolId: undefined } })) };
  const ids = planningEngineUpgradeAffectedCourseIds({
    shared: legacyShared,
    activities,
    storedEngineVersion: 'planning-v23-20261001-idle-gap-compaction-self-invalidation',
    currentEngineVersion: 'planning-v24-20261003-school-day-packing'
  });
  assert.deepEqual(new Set(ids), new Set(activities.slice(0, 5).map((row) => row.row_id)));
});
