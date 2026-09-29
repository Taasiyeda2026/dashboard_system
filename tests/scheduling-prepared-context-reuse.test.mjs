import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCourseSchedule,
  prepareSchedulingRunContext
} from '../frontend/src/screens/course-scheduling-engine.js';
import {
  flushPlanningPerfReport,
  resetPlanningPerfReport,
  setPlanningPerfEnabled
} from '../frontend/src/screens/course-scheduling-perf.js';

const instructors = Array.from({ length: 4 }, (_, index) => ({
  emp_id: String(index + 1),
  full_name: `Instructor ${index + 1}`,
  active: 'yes',
  address: `home${index + 1}`
}));
const profiles = Object.fromEntries(instructors.map((row) => [row.emp_id, { gender: 'female', instruction_languages: ['he'] }]));
const rules = Object.fromEntries(instructors.map((row) => [row.emp_id, [{ weekday: 0, available: true, start_time: '08:00', end_time: '18:00' }]]));
const course = {
  row_id: 'prepared-one',
  activity_season: 'school_2027',
  activity_type: 'course',
  status: 'פתוח',
  school: 'בית ספר',
  school_id: 1,
  school_address: 'school',
  authority: 'רשות',
  district: 'מרכז',
  calendar_sector: 'general',
  activity_name: 'ביומימיקרי',
  instruction_language: 'he',
  required_instructor_gender: 'any',
  sessions: 1,
  date_1: '2026-10-11',
  start_time: '10:00',
  end_time: '11:30'
};

test('prepared scheduling context is built once and reused across targeted evaluations', () => {
  setPlanningPerfEnabled(true);
  resetPlanningPerfReport('prepared-context-reuse');
  try {
    const preparedContext = prepareSchedulingRunContext({
      activities: [course], instructors, profiles, rules, exceptions: {}, schoolCalendar: [], periodKey: 'year'
    });
    for (let index = 0; index < 3; index += 1) {
      calculateCourseSchedule({
        activities: [course],
        targetCourse: course,
        targetCourseId: course.row_id,
        instructors,
        profiles,
        rules,
        exceptions: {},
        schoolCalendar: [],
        periodKey: 'year',
        preliminary: true,
        preparedContext
      });
    }
    const report = flushPlanningPerfReport({ log: false });
    assert.equal(report.counters.contextRebuilds, 1);
    assert.equal(report.counters.scheduleCalls, 3);
    assert.ok(report.counters.candidateEvals <= instructors.length);
  } finally {
    setPlanningPerfEnabled(false);
  }
});
