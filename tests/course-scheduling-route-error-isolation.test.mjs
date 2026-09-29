import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouteClient, calculateCandidateTravel } from '../frontend/src/screens/course-scheduling-travel.js';

const pair = (id, destination) => [{ course: { row_id: id, school_address: destination },
  candidate: { instructor: { emp_id: '1', address: 'home' } } }];

test('a failed route does not poison later courses using the same route client', async () => {
  const client = createRouteClient({ invoke: async ({ origin, destination }) =>
    origin === 'bad-school' || destination === 'bad-school'
      ? { data: { calculated: false, reason: 'route_not_found' }, error: null }
      : { data: { calculated: true, distance_km: 5, duration_minutes: 10 }, error: null }
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
