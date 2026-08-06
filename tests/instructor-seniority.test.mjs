import test from 'node:test';
import assert from 'node:assert/strict';

import {
  INSTRUCTOR_SENIORITY_MIN,
  INSTRUCTOR_SENIORITY_MAX,
  instructorSeniorityValues,
  normalizeInstructorSeniority,
  formatInstructorSeniority
} from '../frontend/src/screens/instructor-seniority.js';

test('instructor seniority provides only whole years 1 through 20', () => {
  const values = instructorSeniorityValues();
  assert.equal(values.length, 20);
  assert.equal(values[0], INSTRUCTOR_SENIORITY_MIN);
  assert.equal(values.at(-1), INSTRUCTOR_SENIORITY_MAX);
  assert.deepEqual(values, Array.from({ length: 20 }, (_, index) => index + 1));
});

test('instructor seniority normalizes empty values to null', () => {
  assert.equal(normalizeInstructorSeniority(null), null);
  assert.equal(normalizeInstructorSeniority(''), null);
  assert.equal(normalizeInstructorSeniority('  '), null);
});

test('instructor seniority accepts valid values and rejects values outside the range', () => {
  assert.equal(normalizeInstructorSeniority('1'), 1);
  assert.equal(normalizeInstructorSeniority(20), 20);
  assert.throws(() => normalizeInstructorSeniority(0));
  assert.throws(() => normalizeInstructorSeniority(21));
  assert.throws(() => normalizeInstructorSeniority(2.5));
});

test('instructor seniority formats the profile label', () => {
  assert.equal(formatInstructorSeniority(null), 'לא הוגדר');
  assert.equal(formatInstructorSeniority(1), '1 שנה');
  assert.equal(formatInstructorSeniority(2), '2 שנים');
  assert.equal(formatInstructorSeniority(20), '20 שנים');
});
