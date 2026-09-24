import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeSchedulingInstructors,
  isActiveSchedulingInstructor
} from '../frontend/src/screens/shared/course-scheduling-instructors.js';

test('scheduling accepts only explicitly active instructors', () => {
  assert.equal(isActiveSchedulingInstructor({ active: 'yes' }), true);
  assert.equal(isActiveSchedulingInstructor({ active: true }), true);
  assert.equal(isActiveSchedulingInstructor({ active: 1 }), true);
  assert.equal(isActiveSchedulingInstructor({ active: 'no' }), false);
  assert.equal(isActiveSchedulingInstructor({ active: false }), false);
  assert.equal(isActiveSchedulingInstructor({ active: 0 }), false);
  assert.equal(isActiveSchedulingInstructor({}), false);
});

test('inactive instructors never enter the scheduling candidate pool', () => {
  const rows = [
    { emp_id: 1547, full_name: 'שון פדידה', active: 'no' },
    { emp_id: 1600, full_name: 'מדריכה פעילה', active: 'yes' }
  ];
  assert.deepEqual(
    activeSchedulingInstructors(rows).map((row) => row.emp_id),
    [1600]
  );
});
