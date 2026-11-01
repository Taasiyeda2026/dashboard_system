import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  cacheKey,
  createRouteMetrics,
  createRouteSingleflight,
  filterPairsByDemandLinks,
  filterSchoolPairsByDemandSchools,
  demandSchoolIdSet,
  isSuspectBlocked,
  isUsableCachedRoute,
  noteCacheHit,
  noteCacheMiss,
  noteGoogleCall,
  routeFlightKey
} from '../supabase/functions/_shared/travel-cache-contract.js';

const schedulingRoute = await readFile(new URL('../supabase/functions/scheduling-route/index.ts', import.meta.url), 'utf8');
const attendanceTravel = await readFile(new URL('../supabase/functions/attendance-travel-compensation/index.ts', import.meta.url), 'utf8');
const baseTraining = await readFile(new URL('../supabase/functions/attendance-base-training-routes/index.ts', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');

test('shared contract rejects suspect and unverified zero routes', () => {
  assert.equal(isSuspectBlocked({ location_suspect: true }), true);
  assert.equal(
    isUsableCachedRoute({
      location_suspect: true,
      distance_km: 12,
      duration_minutes: 20,
      origin_address: 'א',
      destination_address: 'ב'
    }, 'א', 'ב'),
    false
  );
  assert.equal(
    isUsableCachedRoute({
      distance_km: 0,
      duration_minutes: 0,
      provider: 'google',
      origin_address: 'א',
      destination_address: 'ב'
    }, 'א', 'ב'),
    false
  );
  assert.equal(
    isUsableCachedRoute({
      distance_km: 8.5,
      duration_minutes: 14,
      origin_address: 'בית 1',
      destination_address: 'בית ספר 2'
    }, 'בית 1', 'בית ספר 2'),
    true
  );
  assert.equal(
    isUsableCachedRoute({
      distance_km: 8.5,
      duration_minutes: 14,
      origin_address: 'כתובת ישנה',
      destination_address: 'בית ספר 2'
    }, 'כתובת חדשה', 'בית ספר 2'),
    false
  );
});

test('acceptance: usable cached route never triggers Google worker', async () => {
  let googleCalls = 0;
  const metrics = createRouteMetrics('test');
  const cached = {
    distance_km: 4,
    duration_minutes: 9,
    origin_address: 'מוצא',
    destination_address: 'יעד'
  };
  assert.equal(isUsableCachedRoute(cached, 'מוצא', 'יעד'), true);
  noteCacheHit(metrics);
  if (!isUsableCachedRoute(cached, 'מוצא', 'יעד')) {
    noteCacheMiss(metrics);
    noteGoogleCall(metrics);
    googleCalls += 1;
  }
  assert.equal(googleCalls, 0);
  assert.equal(metrics.cache_hits, 1);
  assert.equal(metrics.google_calls, 0);
});

test('acceptance: missing route calculates once and reuses cache on repeat', async () => {
  const store = new Map();
  const singleflight = createRouteSingleflight();
  const metrics = createRouteMetrics('test');
  let googleCalls = 0;

  async function resolve(origin, destination) {
    const originKey = cacheKey(origin);
    const destinationKey = cacheKey(destination);
    const existing = store.get(routeFlightKey(originKey, destinationKey));
    if (isUsableCachedRoute(existing, origin, destination)) {
      noteCacheHit(metrics);
      return existing;
    }
    noteCacheMiss(metrics);
    return singleflight(routeFlightKey(originKey, destinationKey), async () => {
      const again = store.get(routeFlightKey(originKey, destinationKey));
      if (isUsableCachedRoute(again, origin, destination)) {
        noteCacheHit(metrics);
        return again;
      }
      noteGoogleCall(metrics);
      googleCalls += 1;
      const row = {
        origin_address: origin,
        destination_address: destination,
        distance_km: 11,
        duration_minutes: 17
      };
      store.set(routeFlightKey(originKey, destinationKey), row);
      return row;
    });
  }

  const first = await resolve('A', 'B');
  const second = await resolve('A', 'B');
  assert.equal(first.distance_km, 11);
  assert.equal(second.duration_minutes, 17);
  assert.equal(googleCalls, 1);
  assert.equal(metrics.google_calls, 1);
  assert.ok(metrics.cache_hits >= 1);
});

test('acceptance: parallel requests for the same route share one Google call', async () => {
  const singleflight = createRouteSingleflight();
  let googleCalls = 0;
  const worker = () => singleflight('home=>school', async () => {
    googleCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { distance_km: 3, duration_minutes: 5 };
  });
  const [a, b, c] = await Promise.all([worker(), worker(), worker()]);
  assert.equal(googleCalls, 1);
  assert.equal(a.distance_km, 3);
  assert.equal(b.duration_minutes, 5);
  assert.equal(c.distance_km, 3);
});

test('acceptance: real address change invalidates only the affected pair', () => {
  const oldRow = {
    distance_km: 10,
    duration_minutes: 15,
    origin_address: 'רחוב ישן 1',
    destination_address: 'בית ספר'
  };
  const otherRow = {
    distance_km: 20,
    duration_minutes: 25,
    origin_address: 'מדריך אחר',
    destination_address: 'בית ספר'
  };
  assert.equal(isUsableCachedRoute(oldRow, 'רחוב חדש 1', 'בית ספר'), false);
  assert.equal(isUsableCachedRoute(otherRow, 'מדריך אחר', 'בית ספר'), true);
});

test('acceptance: suspect route is blocked without Google', () => {
  const suspect = {
    location_suspect: true,
    distance_km: 9,
    duration_minutes: 12,
    origin_address: 'א',
    destination_address: 'ב'
  };
  assert.equal(isSuspectBlocked(suspect), true);
  assert.equal(isUsableCachedRoute(suspect, 'א', 'ב'), false);
});

test('demand filters remove cartesian instructor×all-schools pairs', () => {
  const pairs = [
    { origin_instructor_emp_id: 1, destination_school_id: 10 },
    { origin_instructor_emp_id: 1, destination_school_id: 20 },
    { origin_instructor_emp_id: 2, destination_school_id: 10 }
  ];
  const demand = [{ emp_id: 1, school_id: 10 }];
  const filtered = filterPairsByDemandLinks(pairs, demand);
  assert.deepEqual(filtered, [{ origin_instructor_emp_id: 1, destination_school_id: 10 }]);
  const schoolPairs = [
    { origin_school_id: 10, destination_school_id: 20 },
    { origin_school_id: 10, destination_school_id: 30 }
  ];
  const demandSchools = demandSchoolIdSet([{ emp_id: 1, school_id: 10 }, { emp_id: 1, school_id: 20 }]);
  assert.deepEqual(
    filterSchoolPairsByDemandSchools(schoolPairs, demandSchools),
    [{ origin_school_id: 10, destination_school_id: 20 }]
  );
});

test('scheduling-route wires Database-First contract, demand build, metrics and singleflight', () => {
  assert.match(schedulingRoute, /travel-cache-contract\.js/);
  assert.match(schedulingRoute, /computeRouteDeduped/);
  assert.match(schedulingRoute, /withRouteSingleflight/);
  assert.match(schedulingRoute, /loadDemandInstructorSchoolLinks/);
  assert.match(schedulingRoute, /filterPairsByDemandLinks/);
  assert.match(schedulingRoute, /filterSchoolPairsByDemandSchools/);
  assert.match(schedulingRoute, /route_metrics/);
  assert.match(schedulingRoute, /noteCacheHit/);
  assert.match(schedulingRoute, /isSuspectBlocked/);
  assert.doesNotMatch(
    schedulingRoute.split('instructorPairs = (scope === \'instructor_school\' || scope === \'all\')')[1]
      ?.slice(0, 280) || '',
    /dedupeTravelPairs\(buildInstructorSchoolPairs\(instructors, deduped\.schools\)\)\s*:/
  );
});

test('attendance travel uses shared cache contract and singleflight before Google', () => {
  assert.match(attendanceTravel, /travel-cache-contract\.js/);
  assert.match(attendanceTravel, /isUsableCachedRoute/);
  assert.match(attendanceTravel, /withRouteSingleflight/);
  assert.match(attendanceTravel, /noteGoogleCall/);
  assert.match(attendanceTravel, /route_metrics/);
  assert.match(attendanceTravel, /location_review_required/);
});

test('base training routes share the same Database-First contract', () => {
  assert.match(baseTraining, /travel-cache-contract\.js/);
  assert.match(baseTraining, /isUsableCachedRoute/);
  assert.match(baseTraining, /withRouteSingleflight/);
  assert.match(baseTraining, /route_metrics/);
});

test('attendance control never auto-invokes build_cache', () => {
  const fn = apiSource.match(/attendanceControlDashboardSources: async \([\s\S]*?\n  [a-zA-Z]/);
  assert.ok(fn, 'attendanceControlDashboardSources not found');
  const body = apiSource.slice(
    apiSource.indexOf('attendanceControlDashboardSources: async'),
    apiSource.indexOf('const activitySelect', apiSource.indexOf('attendanceControlDashboardSources: async')) + 40
  );
  assert.match(body, /skipRouteBuild = true/);
  assert.doesNotMatch(body, /mode: 'build_cache'/);
  assert.doesNotMatch(body, /functions\.invoke\('scheduling-route'/);
});
