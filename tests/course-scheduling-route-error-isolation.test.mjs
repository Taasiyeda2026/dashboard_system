import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptSinglePairRouteInvoke, createRouteClient, calculateCandidateTravel } from '../frontend/src/screens/course-scheduling-travel.js';
import { buildDynamicCoursePlan } from '../frontend/src/screens/course-scheduling-planning.js';

const pair = (id, destination) => [{ course: { row_id: id, school_address: destination },
  candidate: { instructor: { emp_id: '1', address: 'home' } } }];

test('a failed route does not poison later courses using the same route client', async () => {
  const client = createRouteClient({
    invoke: adaptSinglePairRouteInvoke(async ({ origin, destination }) => (
      origin === 'bad-school' || destination === 'bad-school'
        ? { data: { calculated: false, reason: 'route_not_found' }, error: null }
        : { data: { calculated: true, distance_km: 5, duration_minutes: 10 }, error: null }
    ))
  });
  const failed = await calculateCandidateTravel(pair('bad', 'bad-school'), [], client);
  assert.equal(failed.unavailableReason, 'route_not_found');
  const healthy = await calculateCandidateTravel(pair('good', 'good-school'), [], client);
  assert.equal(healthy.unavailableReason, '');
  assert.equal(healthy.travel.good['1'].home.duration_minutes, 10);
  assert.equal(healthy.travel.good['1'].homeReturn.duration_minutes, 10);
  const repeatedFailure = await calculateCandidateTravel(pair('bad', 'bad-school'), [], client);
  assert.equal(repeatedFailure.unavailableReason, 'route_not_found');
});

test('a missing route for one instructor retains a verified instructor in the same planning batch', async () => {
  const activity = { row_id: 'mixed', activity_season: 'school_2027', activity_type: 'course', status: 'פתוח',
    activity_name: 'ביומימיקרי', school: 'בית ספר', authority: 'רשות', district: 'מרכז', calendar_sector: 'general', required_instructor_gender: 'any', school_id: 1, school_address: 'school', instruction_language: 'he',
    sessions: 1, start_time: '08:00', end_time: '09:30', date_1: '2026-10-11' };
  const instructors = [1, 2].map(emp_id => ({ emp_id, full_name: `Instructor ${emp_id}`, active: 'yes', address: `home${emp_id}` }));
  const profiles = Object.fromEntries(instructors.map(i => [i.emp_id, { emp_id: i.emp_id, instruction_languages: ['he'], gender: 'male' }]));
  const rules = Object.fromEntries(instructors.map(i => [i.emp_id, [{ emp_id: i.emp_id, weekday: 0, available: true, start_time: '07:00', end_time: '18:00' }]]));
  const client = createRouteClient({
    invoke: adaptSinglePairRouteInvoke(async ({ origin, destination }) => ({
      data: [origin, destination].includes('home1')
        ? { calculated: false, reason: 'route_not_found' }
        : { calculated: true, distance_km: 5, duration_minutes: 10 },
      error: null
    }))
  });
  const result = await buildDynamicCoursePlan({ activities: [activity], instructors, profiles, rules,
    exceptions: {}, schoolCalendar: [], today: '2026-09-29', routeClient: client, allowGlobalRepair: false });
  assert.equal(result.rows[0].instructorEmpId, '2', JSON.stringify(result.rows[0]));
  assert.equal(result.rows[0].diagnostics.routeVerified, true);
  assert.ok(result.rows[0].options.every(o => o.instructorEmpId === '2' && o.routeVerified));
});
