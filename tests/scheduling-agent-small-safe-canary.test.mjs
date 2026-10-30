import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAgentSchedulingPlan } from '../services/scheduling-agent/compute-plan.mjs';
import { createRouteClient } from '../frontend/src/screens/course-scheduling-travel.js';

// Two fictitious courses and instructors: never reads or writes live Supabase.
const activity = (id, overrides = {}) => ({
  row_id: id, activity_season: 'school_2027', activity_type: 'קורס',
  activity_name: 'Canary only', status: 'פתוח',
  school_id: '1', school: 'Synthetic school',
  school_address: 'synthetic-school', calendar_sector: 'jewish',
  authority: 'Synthetic authority', instruction_language: 'he',
  required_instructor_gender: 'any', sessions: 1,
  start_time: '09:00', end_time: '10:00', date_1: '2026-11-02',
  ...overrides
});
function fixture() {
  const addresses = ['home-1', 'home-2', 'synthetic-school'];
  const routes = addresses.flatMap(origin => addresses
    .filter(destination => destination !== origin)
    .map(destination => ({origin_key: origin, destination_key: destination,
      distance_km: 5, duration_minutes: 10})));
  const snapshot = {
    activities: [
      activity('confirmed', {emp_id: '1', instructor_assignment_locked: true}),
      activity('unassigned')
    ],
    instructors: ['1', '2'].map(id => ({
      emp_id: id, full_name: 'Synthetic ' + id, active: 'yes', address: 'home-' + id
    })),
    profiles: Object.fromEntries(['1', '2'].map(id =>
      [id, {gender: 'female', instruction_languages: ['he'], friday_allowed: false}])),
    rules: Object.fromEntries(['1', '2'].map(id => [id,
      Array.from({length: 7}, (_, weekday) =>
        ({weekday, available: true, start_time: '08:00', end_time: '18:00'}))])),
    exceptions: {}, schoolCalendar: [], catalog: [], planningIntents: [],
    existingRows: [], committedRows: [], lockedOptions: {},
    today: '2026-10-30', planningProfile: 'fast', skipSoftOptimization: true
  };
  const routeClient = createRouteClient({
    preloadedRows: routes, invoke: async () => { throw Error('Network access forbidden in canary'); }
  });
  return {snapshot,routeClient};
}
test('small incremental canary finds one alternative without touching a confirmed instructor', async () => {
  const {snapshot,routeClient} = fixture();
  const original = JSON.stringify(snapshot);
  const output = await computeAgentSchedulingPlan({
    snapshot, routeClient, sourceRevision: '8', workspaceRevision: '1',
    mode: 'incremental', targetCourseIds: ['unassigned']
  });
  assert.equal(output.diagnostics.finalPlanValid, true);
  const approved = output.rows.find(row => row.courseId === 'confirmed');
  const suggested = output.rows.find(row => row.courseId === 'unassigned');
  assert.ok(approved && suggested);
  assert.equal(approved.kind, 'live');
  assert.equal(approved.instructorEmpId, '1');
  assert.equal(approved.meetings[0].date, '2026-11-02');
  assert.equal(suggested.instructorEmpId, '2', 'the protected instructor is already booked');
  assert.equal(suggested.meetings[0].date, '2026-11-02');
  assert.equal(JSON.stringify(snapshot), original, 'planning is read-only for source activities');
});
