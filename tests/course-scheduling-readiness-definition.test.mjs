import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isCourseSchedulingInterfaceEligible,
  isSchedulingReadyActivity,
  isSchedulingReadyInstructor
} from '../frontend/src/screens/shared/activity-scheduling-eligibility.js';
import { calculateCourseSchedule, schedulingCourses, schedulingInstructors } from '../frontend/src/screens/course-scheduling-engine.js';
import { SCORE_WEIGHTS } from '../frontend/src/screens/course-scheduling-score.js';
import { enrichActivitiesWithSchoolAddresses } from '../frontend/src/screens/course-scheduling-distance-build.js';

const readyCourse = {
  row_id: 'c1', activity_season: 'school_2027', activity_type: 'program', status: 'פתוח',
  activity_name: 'רובוטיקה', school_id: 101, school: 'בית ספר', school_address: 'רחוב 1',
  start_time: '09:00', end_time: '10:00', date_1: '2027-01-04', instruction_language: 'he'
};
const instructor = { emp_id: '1', full_name: 'מדריכה', active: 'yes', address: 'בית' };
const profile = { gender: 'female', instruction_languages: ['he'] };
const rules = [{ emp_id: '1', weekday: 1, available: true, start_time: '08:00', end_time: '14:00' }];

const activityCases = [
  ['ללא תאריך', { date_1: '' }],
  ['ללא שעת התחלה', { start_time: '' }],
  ['ללא שעת סיום', { end_time: '' }],
  ['עם שעות שוות', { end_time: '09:00' }],
  ['עם שעות הפוכות', { end_time: '08:59' }],
  ['עם שעה לא חוקית', { start_time: '25:00' }],
  ['עם דקות לא חוקיות', { end_time: '10:75' }],
  ['ללא מזהה בית ספר', { school_id: null }],
  ['ללא כתובת בית ספר', { school_address: '' }],
  ['ללא שפת הדרכה', { instruction_language: '' }]
];

test('stage 1 activity readiness admits only complete valid courses to both UI and engine', () => {
  assert.equal(isSchedulingReadyActivity(readyCourse), true);
  assert.equal(isCourseSchedulingInterfaceEligible(readyCourse), true);
  assert.deepEqual(schedulingCourses([readyCourse]).map((row) => row.row_id), ['c1']);
  for (const [label, override] of activityCases) {
    const row = { ...readyCourse, ...override, row_id: label };
    assert.equal(isSchedulingReadyActivity(row), false, label);
    assert.equal(isCourseSchedulingInterfaceEligible(row), false, label);
    assert.equal(schedulingCourses([row]).length, 0, label);
  }
});

test('school readiness resolves address by school_id only and rejects a name-only match', () => {
  const schools = [{ school_id: 101, school_name: 'בית ספר', authority_name: 'רשות', address: 'רחוב 1' }];
  const byId = enrichActivitiesWithSchoolAddresses([{ ...readyCourse, school: '' }], schools).activities[0];
  assert.equal(isSchedulingReadyActivity(byId), true);
  const byNameOnly = enrichActivitiesWithSchoolAddresses([{ ...readyCourse, school_id: null, authority: 'רשות' }], schools).activities[0];
  assert.equal(byNameOnly.school_address, '');
  assert.equal(isSchedulingReadyActivity(byNameOnly), false);
});

test('a course with every meeting cancelled is excluded', () => {
  const cancelled = { ...readyCourse, cancelled_meeting_dates: ['2027-01-04'] };
  assert.equal(isSchedulingReadyActivity(cancelled), false);
  assert.deepEqual(schedulingCourses([cancelled]), []);
});

test('stage 1 instructor readiness admits only active complete profiles with valid availability', () => {
  assert.equal(isSchedulingReadyInstructor(instructor, profile, rules), true);
  assert.deepEqual(schedulingInstructors([instructor], { 1: profile }, { 1: rules }).map((row) => row.emp_id), ['1']);
  const cases = [
    ['לא פעיל', { ...instructor, active: 'no' }, profile, rules],
    ['ללא כתובת', { ...instructor, address: '' }, profile, rules],
    ['ללא שפה', instructor, { ...profile, instruction_languages: [] }, rules],
    ['ללא מגדר', instructor, { ...profile, gender: '' }, rules],
    ['ללא זמינות', instructor, profile, []],
    ['עם זמינות הפוכה', instructor, profile, [{ ...rules[0], start_time: '15:00', end_time: '14:00' }]],
    ['עם יום שבוע חסר', instructor, profile, [{ ...rules[0], weekday: null }]],
    ['עם יום שבוע לא חוקי', instructor, profile, [{ ...rules[0], weekday: 7 }]],
    ['עם דקות לא חוקיות', instructor, profile, [{ ...rules[0], end_time: '14:99' }]]
  ];
  for (const [label, row, candidateProfile, candidateRules] of cases) {
    assert.equal(isSchedulingReadyInstructor(row, candidateProfile, candidateRules), false, label);
    assert.equal(schedulingInstructors([row], { 1: candidateProfile }, { 1: candidateRules }).length, 0, label);
  }
});

test('readiness filtering is immutable and does not alter scoring or matching constants', () => {
  const activities = [readyCourse, { ...readyCourse, row_id: 'invalid', end_time: '08:00' }];
  const instructors = [instructor, { ...instructor, emp_id: '2', active: 'no' }];
  const before = structuredClone({ activities, instructors, profile, rules, weights: SCORE_WEIGHTS });
  const results = calculateCourseSchedule({ activities, instructors, profiles: { 1: profile }, rules: { 1: rules }, exceptions: {}, preliminary: true });
  assert.deepEqual({ activities, instructors, profile, rules, weights: SCORE_WEIGHTS }, before);
  assert.deepEqual(results.map((row) => row.course.row_id), ['c1']);
  assert.deepEqual(results[0].checked.map((candidate) => candidate.instructor.emp_id), ['1']);
});

test('scheduling UI contains no missing-data completion lists or readiness drawer', async () => {
  const source = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8'));
  assert.doesNotMatch(source, /\$\{dataReadinessDrawerHtml\(data, state\)\}/);
  assert.doesNotMatch(source, /data-open-readiness-drawer/);
  assert.doesNotMatch(source, /summary-card--missing/);
});
