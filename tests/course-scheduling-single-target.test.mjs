import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateCourseSchedule } from '../frontend/src/screens/course-scheduling-engine.js';
import { runDistrictSchedulingSimulation } from '../frontend/src/screens/course-scheduling-district-simulation.js';
import { routeMatrixKey } from '../frontend/src/screens/course-scheduling-travel.js';

const rules = Array.from({ length: 5 }, (_, weekday) => ({
  weekday,
  available: true,
  start_time: '08:00',
  end_time: '16:00'
}));

const instructors = [
  { emp_id: '100', full_name: 'ראשונה', active: 'yes', address: 'בית א' },
  { emp_id: '200', full_name: 'שנייה', active: 'yes', address: 'בית ב' }
];

function course(id, extra = {}) {
  const meetings = extra.meetings || [{ date: '2026-09-07', start_time: '12:00', end_time: '13:00' }];
  return {
    row_id: id,
    activity_no: id,
    activity_name: `קורס ${id}`,
    activity_type: 'קורס',
    activity_season: 'school_2027',
    status: 'פתוח',
    school: `בית ספר ${id}`,
    school_id: String(1000 + [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0)),
    school_address: `כתובת ${id}`,
    authority: 'נתניה',
    district: 'מרכז',
    instruction_language: 'he',
    start_date: meetings[0].date,
    start_time: meetings[0].start_time,
    end_time: meetings[0].end_time,
    meetings,
    ...extra
  };
}

function input(activities, extra = {}) {
  const travel = Object.fromEntries(activities.map((activity) => [activity.row_id, Object.fromEntries(
    instructors.map((instructor, index) => [instructor.emp_id, {
      home: { distance_km: 5 + index, duration_minutes: 10 + index },
      homeReturn: { distance_km: 5 + index, duration_minutes: 10 + index },
      transitions: {}
    }])
  )]));
  return {
    activities,
    instructors,
    profiles: Object.fromEntries(instructors.map(({ emp_id }) => [emp_id, { instruction_languages: ['he'] }])),
    rules: Object.fromEntries(instructors.map(({ emp_id }) => [emp_id, rules])),
    exceptions: {},
    travel,
    referenceDate: '2026-09-01',
    ...extra
  };
}

test('single-course entry point passes the selected course as the only target', async () => {
  const source = await readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
  assert.match(source, /targetCourseId:\s*selectedCourseId/);

  const selected = course('selected');
  const other = course('other', { meetings: [{ date: '2026-09-08', start_time: '12:00', end_time: '13:00' }] });
  const results = calculateCourseSchedule(input([selected, other], { targetCourseId: 'selected' }));
  assert.deepEqual(results.map((result) => result.course.row_id), ['selected']);
});

test('saved context assignment and overlap still block the selected target', () => {
  const selected = course('selected', { meetings: [{ date: '2026-09-07', start_time: '10:30', end_time: '11:30' }] });
  const draft = course('draft', {
    draft_emp_id: '100',
    draft_proposed_meetings: [{ date: '2026-09-07', start_time: '10:00', end_time: '11:00' }],
    meetings: [{ date: '2026-09-07', start_time: '10:00', end_time: '11:00' }]
  });
  const [result] = calculateCourseSchedule(input([selected, draft], { targetCourseId: 'selected' }));
  const blocked = result.checked.find((candidate) => candidate.instructor.emp_id === '100');
  assert.equal(blocked.eligible, false);
  assert.match(blocked.failures.join(' '), /חפיפה/);
  assert.equal(blocked.existingMeetings.length, 1, 'saved context draft must remain in persisted workload context');
});

test('context transition remains a blocker and target instructor ranking is unchanged', () => {
  const selected = course('selected', { meetings: [{ date: '2026-09-07', start_time: '11:15', end_time: '12:15' }] });
  const assigned = course('assigned', {
    emp_id: '100',
    instructor_assignment_locked: true,
    status: 'שובץ',
    school_address: 'כתובת קודמת',
    meetings: [{ date: '2026-09-07', start_time: '10:00', end_time: '11:00' }]
  });
  const routeMatrix = {
    [routeMatrixKey('כתובת קודמת', 'כתובת selected')]: { distance_km: 12, duration_minutes: 30 }
  };
  const shared = input([selected, assigned], { assignments: { 100: [assigned] }, routeMatrix });
  const baseline = calculateCourseSchedule(shared).find((result) => result.course.row_id === 'selected');
  const [targeted] = calculateCourseSchedule({ ...shared, targetCourseId: 'selected' });
  const blocked = targeted.checked.find((candidate) => candidate.instructor.emp_id === '100');
  assert.equal(blocked.eligible, false);
  assert.match(blocked.failures.join(' '), /מעבר|transition_insufficient/);
  assert.deepEqual(
    targeted.checked.map((candidate) => [candidate.instructor.emp_id, candidate.eligible, candidate.rank, candidate.score]),
    baseline.checked.map((candidate) => [candidate.instructor.emp_id, candidate.eligible, candidate.rank, candidate.score])
  );
});

test('district simulation ignores single-target fields and still returns multiple courses', () => {
  const first = course('first');
  const second = course('second', { meetings: [{ date: '2026-09-08', start_time: '12:00', end_time: '13:00' }] });
  const simulation = runDistrictSchedulingSimulation(input([first, second], {
    district: 'מרכז',
    periodKey: 'first',
    targetCourseId: 'first'
  }));
  assert.equal(simulation.ok, true);
  assert.deepEqual(new Set(simulation.results.map((result) => result.course.row_id)), new Set(['first', 'second']));
});
