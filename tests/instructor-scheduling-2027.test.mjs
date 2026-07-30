import test from 'node:test';
import assert from 'node:assert/strict';
import { isActivitySchedulingEligible } from '../frontend/src/screens/shared/activity-scheduling-eligibility.js';
import { evaluateInstructor } from '../frontend/src/screens/instructor-matching-engine.js';

const instructor = { emp_id: '10', full_name: 'נועה', active: 'yes', address: 'חיפה' };
const profile = { gender: 'female', instruction_languages: ['ar'], course_restriction_mode: 'all' };
const base = { activity_name: 'מדעים', activity_type: 'קורס', start_time: '10:00', end_time: '11:00', meetings: [{ date: '2027-01-03', start_time: '10:00', end_time: '11:00' }] };
const rules = [{ weekday: 0, available: true, start_time: '08:00', end_time: '16:00' }];

test('new scheduling is strictly limited to open canonical school_2027 activities', () => {
  assert.equal(isActivitySchedulingEligible({ activity_season: 'school_2027', activity_type: 'קורס', status: 'פתוח' }), true);
  for (const status of ['סגור', 'closed', 'בוטל', 'cancelled', 'canceled', 'נמחק', 'deleted']) assert.equal(isActivitySchedulingEligible({ activity_season: 'school_2027', activity_type: 'קורס', status }), false);
  assert.equal(isActivitySchedulingEligible({ activity_season: 'school_2027', activity_type: 'סדנה', status: 'פתוח' }), false);
  assert.equal(isActivitySchedulingEligible({ activity_season: 'school_2027', activity_type: 'קורס', status: 'פתוח', emp_id: '10' }), false);
  assert.equal(isActivitySchedulingEligible({ activity_season: 'regular', title: 'פעילות 2027', status: 'פתוח' }), false);
  assert.equal(isActivitySchedulingEligible({ activity_season: '', start_date: '2027-01-01', status: 'פתוח' }), false);
});

test('empty language and gender do not filter or add matching explanations', () => {
  const result = evaluateInstructor({ instructor, profile, rules, activity: { ...base, instruction_language: null, required_instructor_gender: 'any' } });
  assert.equal(result.eligible, true);
  assert.doesNotMatch(result.explanation, /שפה|עברית|מגדר/);
});

test('education level is a hard matching constraint', () => {
  const result = evaluateInstructor({ instructor, profile: { ...profile, education_levels: ['elementary'] }, rules, activity: { ...base, education_level: 'high_school' } });
  assert.equal(result.eligible, false);
  assert.match(result.failures.join(' '), /שכבת/);
});

test('blocked and allow-only activity lists remain hard constraints', () => {
  assert.equal(evaluateInstructor({ instructor, profile, rules, activity: { ...base, blocked_instructor_ids: ['10'] } }).eligible, false);
  assert.equal(evaluateInstructor({ instructor, profile, rules, activity: { ...base, allowed_instructor_ids: ['11'] } }).eligible, false);
});
