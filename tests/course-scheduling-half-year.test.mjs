import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCourseSchedule, instructorLoad, schedulingCourses } from '../frontend/src/screens/course-scheduling-engine.js';
import { filterMeetingsByCourseSchedulingPeriod } from '../frontend/src/screens/course-scheduling-periods.js';

const course = (id, extra = {}) => ({
  row_id: id,
  activity_name: id,
  activity_type: 'קורס',
  activity_season: 'school_2027',
  status: 'פתוח',
  school: 'בית ספר א',
  school_address: 'כתובת בית ספר א',
  authority: 'רשות א',
  instruction_language: 'he',
  required_instructor_gender: 'any',
  start_time: '10:00',
  end_time: '12:00',
  meetings: [
    { date: '2026-09-08', start_time: '10:00', end_time: '12:00' },
    { date: '2027-02-02', start_time: '10:00', end_time: '12:00' }
  ],
  ...extra
});
const instructors = [
  { emp_id: '1', full_name: 'אור', active: 'yes', address: 'בית 1' },
  { emp_id: '2', full_name: 'בר', active: 'yes', address: 'בית 2', seniority_years: 3 }
];
const profiles = {
  1: { gender: 'male', instruction_languages: ['he'], seniority_years: 0 },
  2: { gender: 'male', instruction_languages: ['he'], seniority_years: 3 }
};
const rules = {
  1: [{ emp_id: '1', weekday: 2, available: true, start_time: '08:00', end_time: '16:00' }],
  2: [{ emp_id: '2', weekday: 2, available: true, start_time: '08:00', end_time: '16:00' }]
};
const travel = {
  c: { 1: { home: { distance_km: 5, duration_minutes: 10 } }, 2: { home: { distance_km: 5, duration_minutes: 10 } } },
  cross: { 1: { home: { distance_km: 5, duration_minutes: 10 } }, 2: { home: { distance_km: 5, duration_minutes: 10 } } }
};

test('filters meetings to first and second half-year without assigning 2027-01-30', () => {
  const meetings = [
    { date: '2026-09-01' }, { date: '2027-01-29' }, { date: '2027-01-30' }, { date: '2027-01-31' }, { date: '2027-06-30' }
  ];
  assert.deepEqual(filterMeetingsByCourseSchedulingPeriod(meetings, 'first').map((m) => m.date), ['2026-09-01', '2027-01-29']);
  assert.deepEqual(filterMeetingsByCourseSchedulingPeriod(meetings, 'second').map((m) => m.date), ['2027-01-31', '2027-06-30']);
});

test('cross-half course remains one course and contributes only selected-half hours', () => {
  const cross = course('cross', { emp_id: '1' });
  assert.equal(schedulingCourses([cross], { periodKey: 'first' }).length, 0, 'assigned courses do not re-enter the engine');
  assert.equal(instructorLoad([cross], profiles[1], rules[1], { periodKey: 'first' }).hours, 2);
  assert.equal(instructorLoad([cross], profiles[1], rules[1], { periodKey: 'second' }).hours, 2);
});

test('authority filter limits engine courses and half A load does not affect half B scoring', () => {
  const firstHalfLoad = course('load-a', { emp_id: '1', authority: 'רשות ב', meetings: [{ date: '2026-09-08', start_time: '10:00', end_time: '14:00' }] });
  const target = course('c', { meetings: [{ date: '2027-02-02', start_time: '10:00', end_time: '12:00' }] });
  const otherAuthority = course('other', { authority: 'רשות אחרת', meetings: [{ date: '2027-02-02', start_time: '10:00', end_time: '12:00' }] });
  const results = calculateCourseSchedule({ activities: [firstHalfLoad, target, otherAuthority], instructors, profiles, rules, exceptions: {}, periodKey: 'second', authority: 'רשות א', travel, routeMatrix: {} });
  assert.deepEqual(results.map((result) => result.course.row_id), ['c']);
  assert.equal(results[0].recommended.load.hours, 2);
});

test('load score is split into 12 total half hours and 8 course-week hours with equal-load fallback', () => {
  const target = course('c', { meetings: [{ date: '2027-02-02', start_time: '10:00', end_time: '12:00' }] });
  const results = calculateCourseSchedule({ activities: [target], instructors, profiles, rules, exceptions: {}, periodKey: 'second', authority: 'רשות א', travel, routeMatrix: {} });
  assert.equal(results[0].status, 'הצעה מוכנה');
  assert.equal(results[0].recommended.scoreBreakdown.workload.totalHoursPoints, 12);
  assert.equal(results[0].recommended.scoreBreakdown.workload.courseWeeksPoints, 8);
});
