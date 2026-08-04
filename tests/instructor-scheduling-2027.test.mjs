import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isActivitySchedulingEligible } from '../frontend/src/screens/shared/activity-scheduling-eligibility.js';
import { evaluateInstructor } from '../frontend/src/screens/instructor-matching-engine.js';

const instructor = { emp_id: '10', full_name: 'נועה', active: 'yes', address: 'חיפה' };
const profile = { gender: 'female', instruction_languages: ['ar'], course_restriction_mode: 'all' };
const base = { activity_name: 'מדעים', activity_type: 'קורס', start_time: '10:00', end_time: '11:00', meetings: [{ date: '2027-01-03', start_time: '10:00', end_time: '11:00' }] };
const rules = [{ weekday: 0, available: true, start_time: '08:00', end_time: '16:00' }];
const workflow = fs.readFileSync(new URL('../frontend/src/screens/instructor-scheduling-workflow.js', import.meta.url), 'utf8');

test('new scheduling is strictly limited to open canonical school_2027 activities', () => {
  assert.equal(isActivitySchedulingEligible({ activity_season: 'school_2027', activity_type: 'קורס', status: 'פתוח' }), true);
  for (const status of ['סגור', 'closed', 'בוטל', 'cancelled', 'canceled', 'נמחק', 'deleted']) assert.equal(isActivitySchedulingEligible({ activity_season: 'school_2027', activity_type: 'קורס', status }), false);
  assert.equal(isActivitySchedulingEligible({ activity_season: 'school_2027', activity_type: 'סדנה', status: 'פתוח' }), false);
  assert.equal(isActivitySchedulingEligible({ activity_season: 'school_2027', activity_type: 'קורס', status: 'פתוח', emp_id: '10' }), false);
  assert.equal(isActivitySchedulingEligible({ activity_season: 'regular', title: 'פעילות 2027', status: 'פתוח' }), false);
  assert.equal(isActivitySchedulingEligible({ activity_season: '', start_date: '2027-01-01', status: 'פתוח' }), false);
});

test('empty language defaults to Hebrew and still enforces instructor language match', () => {
  const arabicOnly = evaluateInstructor({ instructor, profile, rules, activity: { ...base, instruction_language: null, required_instructor_gender: 'any' } });
  assert.equal(arabicOnly.eligible, false);
  assert.match(arabicOnly.failures.join('|'), /עברית/);

  const hebrewSpeaker = evaluateInstructor({
    instructor,
    profile: { ...profile, instruction_languages: ['he'] },
    rules,
    activity: { ...base, instruction_language: '', required_instructor_gender: 'any' }
  });
  assert.equal(hebrewSpeaker.eligible, true);
  assert.doesNotMatch(hebrewSpeaker.explanation, /מגדר/);
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

test('requirements modal keeps activity summary and only three editable fields', () => {
  assert.match(workflow, /schedulingActivitySummaryHtml/);
  assert.match(workflow, /בית ספר:/);
  assert.match(workflow, /רשות:/);
  assert.match(workflow, /scheduling-time-range/);
  assert.match(workflow, /מגדר המדריך/);
  assert.match(workflow, /שפת הדרכה/);
  assert.match(workflow, /resolveInstructionLanguage/);
  assert.match(workflow, /שכבת גיל/);
  assert.match(workflow, /value="any"[^>]*>כולם</);
  assert.match(workflow, /value="he"[^>]*>עברית</);
  assert.match(workflow, /value=""[^>]*>יש לבחור</);
  assert.match(workflow, /elementary|middle_school|high_school/);
  assert.match(workflow, /EDUCATION_LEVELS\.has\(requirements\.education_level\)/);
  assert.doesNotMatch(workflow, /deriveEducationLevel/);
});

test('requirements modal never triggers matching, routing or assignment', () => {
  assert.doesNotMatch(workflow, /rankInstructors|candidateTravel|scheduling-route|assign_activity_instructor|contacts_instructors|instructor_scheduling_profiles/);
  assert.doesNotMatch(workflow, /blocked_instructor_ids|allowed_instructor_ids|scheduling_note/);
  assert.match(workflow, /דרישות השיבוץ נשמרו בהצלחה/);
  assert.match(workflow, /p_education_level/);
});