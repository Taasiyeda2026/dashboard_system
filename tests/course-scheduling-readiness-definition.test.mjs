import test from 'node:test';
import assert from 'node:assert/strict';
import {
  courseReadinessMissingFields,
  courseReadinessRows,
  instructorReadinessMissingFields
} from '../frontend/src/screens/course-scheduling-distance-build.js';
import { availabilityHours, instructorLoad, calculateCourseSchedule } from '../frontend/src/screens/course-scheduling-engine.js';
import { evaluateInstructor } from '../frontend/src/screens/instructor-matching-engine.js';

const readyCourse = {
  row_id: 'c1', activity_season: 'school_2027', activity_type: 'program', status: 'פתוח',
  activity_name: 'רובוטיקה', authority: 'רשות', school: 'בית ספר', school_address: 'רחוב 1',
  grade: '', start_time: '09:00', end_time: '10:00', date_1: '2027-01-04',
  instruction_language: '', required_instructor_gender: '', activity_manager: ''
};
const rules = [{ emp_id: 1, weekday: 1, available: true, start_time: '08:00', end_time: '14:00' }];
const primaryCandidate = (result) => result.recommended || result.bestAvailable;
const matchingProfile = { gender: 'female', instruction_languages: ['he'], weekly_max_hours: 1, preferred_work_days: 1, max_fixed_courses: 0 };
const instructor = { emp_id: 1, full_name: 'מדריכה', active: 'yes', address: 'בית' };

test('course readiness ignores age fields and manager is not mandatory', () => {
  assert.deepEqual(courseReadinessMissingFields(readyCourse), []);
  assert.equal(courseReadinessRows([readyCourse, { ...readyCourse, row_id: 'closed', status: 'סגור', school: '' }]).length, 0);
  assert.deepEqual(courseReadinessMissingFields({ ...readyCourse, education_level: '', grade: '' }), []);
  const missing = courseReadinessMissingFields({ ...readyCourse, school_address: '', start_time: '', activity_manager: '', education_level: '', grade: '' });
  assert.deepEqual(missing, ['כתובת בית ספר תקינה', 'שעת התחלה']);
  assert.ok(!missing.includes('מנהל פעילות'));
});

test('instructor readiness ignores manual workload quota fields', () => {
  const missing = instructorReadinessMissingFields(instructor, { ...matchingProfile, weekly_target_hours: null, weekly_max_hours: null, preferred_work_days: null, max_fixed_courses: null }, rules);
  assert.deepEqual(missing, []);
  assert.deepEqual(instructorReadinessMissingFields(instructor, { ...matchingProfile, course_restriction_mode: 'allow_only', course_ids: [] }, rules), []);
  assert.deepEqual(instructorReadinessMissingFields(instructor, { ...matchingProfile }, rules), []);
  assert.deepEqual(instructorReadinessMissingFields(instructor, { ...matchingProfile, education_levels: [] }, rules), []);
  assert.deepEqual(instructorReadinessMissingFields(instructor, { ...matchingProfile, gender: null }, rules), ['מגדר']);
});

test('language and gender are absolute gates and rejected candidates are not alternatives', () => {
  const result = calculateCourseSchedule({
    activities: [{ ...readyCourse, required_instructor_gender: 'female', instruction_language: 'ar' }],
    instructors: [instructor, { ...instructor, emp_id: 2, full_name: 'מדריך' }],
    profiles: { 1: { ...matchingProfile, instruction_languages: ['ar'] }, 2: { ...matchingProfile, gender: 'male', instruction_languages: ['ar'] } },
    rules: { 1: rules, 2: [{ ...rules[0], emp_id: 2 }] }, exceptions: {}, travel: {}, routeMatrix: {}, preliminary: true
  })[0];
  assert.equal(primaryCandidate(result).instructor.emp_id, 1);
  assert.deepEqual(result.alternatives.map((candidate) => candidate.instructor.emp_id), []);
  assert.match(result.checked.find((candidate) => candidate.instructor.emp_id === 2).failures.join(' '), /דורש מדריכה/);
});

test('manual workload quotas are not readiness or scoring inputs; actual assignments drive load', () => {
  assert.equal(availabilityHours({ weekly_max_hours: 1 }, rules), 6);
  const noQuota = evaluateInstructor({ instructor, profile: { ...matchingProfile, max_fixed_courses: null, preferred_work_days: null }, rules, activity: readyCourse, workloadRatio: 0.1, fixedCourseCount: 99, weeklyWorkDayCount: 7 });
  const withQuota = evaluateInstructor({ instructor, profile: matchingProfile, rules, activity: readyCourse, workloadRatio: 0.1, fixedCourseCount: 99, weeklyWorkDayCount: 7 });
  assert.equal(withQuota.scoreBreakdown.workload.points, noQuota.scoreBreakdown.workload.points);
  assert.equal(instructorLoad([{ ...readyCourse, row_id: 'assigned' }], {}, rules).meetings, 1);
});
