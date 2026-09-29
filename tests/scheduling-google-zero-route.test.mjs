import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGoogleRouteMetrics } from '../supabase/functions/scheduling-route/route-metrics.js';
test('Google omitted zero distance requires explicit duration and matching resolved coordinates', () => {
  const point = { latLng: { latitude: 32.69, longitude: 35.05 } };
  assert.deepEqual(parseGoogleRouteMetrics({ duration: '0s', legs: [{ startLocation: point, endLocation: point }] }),
    { distance_km: 0, duration_minutes: 0, provider: 'google_verified_zero' });
  assert.equal(parseGoogleRouteMetrics({ duration: '0s' }), null);
  assert.equal(parseGoogleRouteMetrics({ duration: '0s', legs: [{ startLocation: point, endLocation: { latLng: { latitude: 32.7, longitude: 35.05 } } }] }), null);
  assert.equal(parseGoogleRouteMetrics(null), null);
  assert.equal(parseGoogleRouteMetrics({ duration: '10s' }), null);
  assert.deepEqual(parseGoogleRouteMetrics({ duration: '120s', distanceMeters: 500 }),
    { distance_km: .5, duration_minutes: 2, provider: 'google' });
});
