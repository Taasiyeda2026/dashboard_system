import test from 'node:test';
import assert from 'node:assert/strict';
import { runDistrictSchedulingSimulation } from '../frontend/src/screens/course-scheduling-district-simulation.js';
import { routeMatrixKey } from '../frontend/src/screens/course-scheduling-travel.js';

const mondays = [
  '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28',
  '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26',
  '2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30',
  '2026-12-07', '2026-12-14', '2026-12-21', '2026-12-28',
  '2027-01-04', '2027-01-11', '2027-01-18', '2027-01-25'
];

const instructor = {
  emp_id: '100',
  full_name: 'מדריך יחיד',
  active: 'yes',
  address: 'בית המדריך'
};

const mondayRules = [{
  weekday: 1,
  available: true,
  start_time: '08:00',
  end_time: '16:00'
}];

function course(id, {
  school = 'בית ספר א',
  schoolId = '1000',
  schoolAddress = 'כתובת א',
  start = '09:00',
  end = '10:00'
} = {}) {
  const meetings = mondays.map((date) => ({ date, start_time: start, end_time: end }));
  return {
    row_id: id,
    activity_no: id,
    activity_name: `קורס ${id}`,
    activity_type: 'קורס',
    activity_season: 'school_2027',
    status: 'פתוח',
    school,
    school_id: schoolId,
    school_address: schoolAddress,
    authority: 'נתניה',
    district: 'מרכז',
    instruction_language: 'he',
    required_instructor_gender: 'any',
    start_date: meetings[0].date,
    start_time: start,
    end_time: end,
    meetings
  };
}

function simulationInput(activities, extra = {}) {
  return {
    activities,
    instructors: [instructor],
    profiles: {
      100: { instruction_languages: ['he'], gender: 'male' }
    },
    rules: { 100: mondayRules },
    exceptions: {},
    travel: Object.fromEntries(activities.map((activity) => [activity.row_id, {
      100: {
        home: { distance_km: 5, duration_minutes: 10 },
        homeReturn: { distance_km: 5, duration_minutes: 10 },
        transitions: {}
      }
    }])),
    routeMatrix: {},
    referenceDate: '2026-09-01',
    district: 'מרכז',
    periodKey: 'first',
    ...extra
  };
}

function candidateFor(result, empId = '100') {
  return (result?.checked || []).find((candidate) => String(candidate?.instructor?.emp_id) === empId);
}

test('district simulation does not propose the same instructor for overlapping in-memory drafts', () => {
  const first = course('a-base');
  const second = course('z-overlap');
  const simulation = runDistrictSchedulingSimulation(simulationInput([first, second]));

  assert.equal(simulation.ok, true);
  const proposedToInstructor = simulation.rows.filter((row) => row.proposedInstructorEmpId === '100');
  assert.equal(proposedToInstructor.length, 1, 'only one overlapping proposal may reserve the instructor');

  const secondResult = simulation.results.find((result) => result.course.row_id === 'z-overlap');
  const blocked = candidateFor(secondResult);
  assert.equal(blocked?.eligible, false);
  assert.match([...(blocked?.failures || []), ...(blocked?.issues || []).map((issue) => issue.message)].join(' '), /חפיפה/);
});

test('district simulation applies transition time against proposals created earlier in the same run', () => {
  const first = course('a-base', {
    school: 'בית ספר א',
    schoolId: '1000',
    schoolAddress: 'כתובת א',
    start: '09:00',
    end: '10:00'
  });
  const second = course('z-transition', {
    school: 'בית ספר ב',
    schoolId: '2000',
    schoolAddress: 'כתובת ב',
    start: '10:20',
    end: '11:20'
  });
  const routeMatrix = {
    [routeMatrixKey('כתובת א', 'כתובת ב')]: { distance_km: 12, duration_minutes: 30 },
    [routeMatrixKey('כתובת ב', 'כתובת א')]: { distance_km: 12, duration_minutes: 30 }
  };
  const simulation = runDistrictSchedulingSimulation(simulationInput([first, second], { routeMatrix }));

  assert.equal(simulation.ok, true);
  const proposedToInstructor = simulation.rows.filter((row) => row.proposedInstructorEmpId === '100');
  assert.equal(proposedToInstructor.length, 1, 'insufficient transition time must prevent the second proposal');

  const secondResult = simulation.results.find((result) => result.course.row_id === 'z-transition');
  const blocked = candidateFor(secondResult);
  assert.equal(blocked?.eligible, false);
  assert.match([...(blocked?.failures || []), ...(blocked?.issues || []).map((issue) => issue.message)].join(' '), /מעבר/);
});
