import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSchool2027CourseStatusContext,
  normalizeSchool2027CourseStatus
} from '../frontend/src/school-2027-course-status-policy.js';

test('2027 course context is recognized', () => {
  assert.equal(isSchool2027CourseStatusContext({ season: 'school_2027', activityType: 'course' }), true);
  assert.equal(isSchool2027CourseStatusContext({ season: 'school_2027', activityType: 'קורס' }), true);
  assert.equal(isSchool2027CourseStatusContext({ season: 'regular', activityType: 'course' }), false);
  assert.equal(isSchool2027CourseStatusContext({ season: 'school_2027', activityType: 'workshop' }), false);
});

test('only closed remains closed and every legacy stage becomes open', () => {
  assert.equal(normalizeSchool2027CourseStatus('סגור'), 'סגור');
  assert.equal(normalizeSchool2027CourseStatus('closed'), 'סגור');
  assert.equal(normalizeSchool2027CourseStatus('פתוח'), 'פתוח');
  assert.equal(normalizeSchool2027CourseStatus('בתהליך'), 'פתוח');
  assert.equal(normalizeSchool2027CourseStatus('מוכן לשיבוץ'), 'פתוח');
  assert.equal(normalizeSchool2027CourseStatus(''), 'פתוח');
});
