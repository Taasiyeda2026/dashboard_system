import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouteClient, calculateCandidateTravel } from '../frontend/src/screens/course-scheduling-travel.js';

test('warm scheduling route preload performs zero route-service calls', async () => {
  const instructor = { emp_id: '7', full_name: 'Instructor', address: 'home', active: 'yes' };
  const course = {
    row_id: 'warm',
    school: 'School',
    authority: 'Authority',
    school_id: 1,
    school_address: 'school',
    meetings: [{ date: '2026-10-11', start_time: '10:00', end_time: '11:30' }]
  };
  let invokes = 0;
  const client = createRouteClient({
    preloadedRows: [
      { origin_key: 'home', destination_key: 'school', origin_address: 'home', destination_address: 'school', distance_km: 5, duration_minutes: 10 },
      { origin_key: 'school', destination_key: 'home', origin_address: 'school', destination_address: 'home', distance_km: 5, duration_minutes: 10 }
    ],
    invoke: async () => { invokes += 1; return { data: { calculated: true, distance_km: 5, duration_minutes: 10 }, error: null }; }
  });
  const result = await calculateCandidateTravel([{ course, candidate: { instructor } }], [], client);
  assert.equal(invokes, 0);
  assert.equal(client.googleCalls, 0);
  assert.ok(client.cacheHits >= 2);
  assert.equal(result.travel.warm['7'].home.distance_km, 5);
});
