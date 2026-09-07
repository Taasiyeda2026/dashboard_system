import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  isActivitySchedulingEligible,
  isSchedulingBlockingAssignment,
  schedulingActivityTypeCategory
} from '../frontend/src/screens/shared/activity-scheduling-eligibility.js';
import { isOpenSchool2027Course } from '../frontend/src/screens/course-scheduling-distance-build.js';

const activity = (activity_type, overrides = {}) => ({
  row_id: `${activity_type}-1`, activity_season: 'school_2027', activity_type,
  status: 'פתוח', ...overrides
});

test('scheduling eligibility accepts course, workshop and tour aliases only while excluding assigned activities', () => {
  for (const type of ['course', 'קורס', 'workshop', 'סדנה', 'tour', 'סיור']) {
    assert.equal(isActivitySchedulingEligible(activity(type)), true, type);
  }
  assert.equal(isActivitySchedulingEligible(activity('lecture')), false);
  assert.equal(isActivitySchedulingEligible(activity('workshop', { emp_id: '42' })), false);
  assert.equal(isActivitySchedulingEligible(activity('tour', { instructor_name: 'נעה' })), false);
});

test('assigned workshops and tours block the shared instructor calendar', () => {
  assert.equal(isSchedulingBlockingAssignment(activity('workshop', { emp_id: '42' })), true);
  assert.equal(isSchedulingBlockingAssignment(activity('tour', { instructor_name: 'נעה' })), true);
});

test('workshops and tours participate in scheduling readiness and route preparation', () => {
  assert.equal(isOpenSchool2027Course(activity('workshop')), true);
  assert.equal(isOpenSchool2027Course(activity('tour')), true);
  assert.equal(isOpenSchool2027Course(activity('lecture')), false);
});

test('activity type filter normalizes English and Hebrew values', () => {
  assert.equal(schedulingActivityTypeCategory('קורסים'), 'course');
  assert.equal(schedulingActivityTypeCategory('סדנאות'), 'workshop');
  assert.equal(schedulingActivityTypeCategory('סיורים'), 'tour');
  assert.equal(schedulingActivityTypeCategory('lecture'), '');
});

test('migration expands active scheduling RPC predicates without weakening their other checks', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260907190000_expand_activity_scheduling_types.sql', import.meta.url), 'utf8');
  assert.match(sql, /pg_get_functiondef/);
  assert.match(sql, /'course'[\s\S]*'workshop'[\s\S]*'tour'/);
  assert.match(sql, /assign_activity_instructor/);
  assert.match(sql, /%course_assignment%/);
  assert.doesNotMatch(sql, /drop function|disable trigger|row level security/i);
});
