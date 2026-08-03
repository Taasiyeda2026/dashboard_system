import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildInstructorSchoolPairs,
  buildSchoolSchoolPairs,
  dedupeAuthoritySchools,
  enrichActivitiesWithSchoolAddresses,
  resolveCanonicalSchoolAddress,
  resolveSinglePairFromTravelCache,
  simulateConsecutiveTravelBuilds,
  schoolEntityKey,
  translateSchedulingRouteError
} from '../frontend/src/screens/course-scheduling-distance-build.js';
import { calculateCandidateTravel, createRouteClient, activityPlace } from '../frontend/src/screens/course-scheduling-travel.js';
import { preliminaryCourseCandidates } from '../frontend/src/screens/course-scheduling-engine.js';

const edgeFunctionUrl = new URL('../supabase/functions/scheduling-route/index.ts', import.meta.url);
const readinessMigrationUrl = new URL('../supabase/migrations/20260803193000_course_scheduling_travel_cache_production_readiness.sql', import.meta.url);

const schoolRows = [
  { school_id: 10, school_name: 'בית ספר א', authority_id: 1, authority_name: 'חיפה', address: 'רחוב הנביאים 12, חיפה' },
  { school_id: 10, school_name: 'בית ספר א', authority_id: null, authority_name: 'חיפה', address: 'רחוב' },
  { school_id: 11, school_name: 'בית ספר ב', authority_id: 1, authority_name: 'חיפה', address: 'שדרות הציונות 5, חיפה' },
  { school_id: null, school_name: 'בית ספר ללא מזהה', authority_id: 2, authority_name: 'נצרת', address: 'שכונת הנוצרים, נצרת' }
];

test('activity is enriched with canonical school_address by school_id', () => {
  const { activities } = enrichActivitiesWithSchoolAddresses([
    { row_id: 'a1', school_id: 10, school: 'בית ספר א', authority: 'חיפה' }
  ], schoolRows);
  assert.equal(activities[0].school_address, 'רחוב הנביאים 12, חיפה');
  assert.equal(activities[0].school_address_missing, false);
});

test('activity without school_id is enriched by authority and school name', () => {
  const address = resolveCanonicalSchoolAddress(
    { school_id: null, school: 'בית ספר ללא מזהה', authority: 'נצרת' },
    enrichActivitiesWithSchoolAddresses([], schoolRows).lookup
  );
  assert.equal(address, 'שכונת הנוצרים, נצרת');
});

test('enrichment prefers deduped row with authority_id and fuller address', () => {
  const deduped = dedupeAuthoritySchools(schoolRows);
  assert.equal(deduped.duplicateCount, 1);
  assert.equal(deduped.uniqueCount, 3);
  const { activities } = enrichActivitiesWithSchoolAddresses([
    { row_id: 'a1', school_id: 10, school: 'בית ספר א', authority: 'חיפה' }
  ], schoolRows);
  assert.equal(activities[0].school_address, 'רחוב הנביאים 12, חיפה');
});

test('activityPlace never treats the school display name as a verified address', () => {
  assert.equal(activityPlace({ school: 'בית ספר א', school_address: '' }), '');
  assert.equal(activityPlace({ school: 'בית ספר א', school_address: 'רחוב הנביאים 12, חיפה' }), 'רחוב הנביאים 12, חיפה');
});

test('unresolved school address stays missing and is not replaced by school name', () => {
  const { activities, missingCount } = enrichActivitiesWithSchoolAddresses([
    { row_id: 'missing', school_id: 999, school: 'לא קיים', authority: 'חיפה' }
  ], schoolRows);
  assert.equal(activities[0].school_address, '');
  assert.equal(activities[0].school_address_missing, true);
  assert.equal(missingCount, 1);
  assert.notEqual(activities[0].school_address, activities[0].school);
});

test('instructor→school cache hit uses canonical address and avoids a Google call', async () => {
  const instructorAddress = 'בית המדריך 1, חיפה';
  const schoolAddress = 'רחוב הנביאים 12, חיפה';
  const pair = buildInstructorSchoolPairs(
    [{ emp_id: 100, address: instructorAddress }],
    [schoolRows[0]]
  )[0];
  assert.equal(pair.destination_address, schoolAddress);

  const cacheRows = [{
    origin_key: pair.origin_address.toLowerCase(),
    destination_key: pair.destination_address.toLowerCase(),
    origin_address: instructorAddress,
    destination_address: schoolAddress,
    distance_km: 4.2,
    duration_minutes: 11,
    expires_at: new Date(Date.now() + 86400000).toISOString()
  }];

  const activity = {
    row_id: 'course-1',
    activity_season: 'school_2027',
    activity_type: 'קורס',
    status: 'פתוח',
    school_id: 10,
    school: 'בית ספר א',
    authority: 'חיפה',
    start_date: '2026-09-01',
    start_time: '10:00',
    end_time: '11:00',
    instruction_language: 'he',
    education_level: 'elementary',
    meetings: [{ date: '2026-09-01', start_time: '10:00', end_time: '11:00' }]
  };
  const { activities } = enrichActivitiesWithSchoolAddresses([activity], schoolRows);
  assert.equal(activities[0].school_address, schoolAddress);

  let googleCalls = 0;
  const invoke = async ({ origin, destination }) => {
    const resolved = resolveSinglePairFromTravelCache(cacheRows, origin, destination);
    if (resolved.mapsCall) googleCalls += 1;
    return { data: resolved, error: null };
  };
  const client = createRouteClient({ invoke });
  const preliminary = [{
    course: activities[0],
    candidate: { instructor: { emp_id: '100', address: instructorAddress, active: 'yes', full_name: 'נועה' }, eligible: true, score: 80, missingProfileData: [], failures: [] }
  }];
  const routed = await calculateCandidateTravel(preliminary, activities, client);

  assert.equal(client.requests.length, 1);
  assert.equal(client.requests[0].destination, schoolAddress);
  assert.notEqual(client.requests[0].destination, 'בית ספר א');
  assert.equal(client.requests[0].origin, instructorAddress);
  assert.equal(routed.cacheHits, 1);
  assert.equal(routed.googleCalls, 0);
  assert.equal(googleCalls, 0);
  assert.equal(routed.travel['course-1']['100'].home.distance_km, 4.2);
});

test('school→school cache hit uses canonical addresses after enrichment', async () => {
  const schools = [
    { school_id: 10, school_name: 'בית ספר א', authority_id: 1, authority_name: 'חיפה', address: 'רחוב הנביאים 12, חיפה' },
    { school_id: 11, school_name: 'בית ספר ב', authority_id: 1, authority_name: 'חיפה', address: 'שדרות הציונות 5, חיפה' }
  ];
  const pair = buildSchoolSchoolPairs(schools).find((row) => row.origin_school_id === 10 && row.destination_school_id === 11);
  assert.ok(pair);
  const cacheRows = [{
    origin_key: pair.origin_address.toLowerCase(),
    destination_key: pair.destination_address.toLowerCase(),
    origin_address: pair.origin_address,
    destination_address: pair.destination_address,
    distance_km: 2.1,
    duration_minutes: 7,
    expires_at: new Date(Date.now() + 86400000).toISOString()
  }];

  const first = {
    row_id: 'c1',
    activity_season: 'school_2027',
    activity_type: 'קורס',
    status: 'פתוח',
    school_id: 10,
    school: 'בית ספר א',
    authority: 'חיפה',
    start_date: '2026-09-01',
    start_time: '08:00',
    end_time: '09:00',
    instruction_language: 'he',
    education_level: 'elementary',
    meetings: [{ date: '2026-09-01', start_time: '08:00', end_time: '09:00' }]
  };
  const second = {
    ...first,
    row_id: 'c2',
    school_id: 11,
    school: 'בית ספר ב',
    start_time: '10:00',
    end_time: '11:00',
    meetings: [{ date: '2026-09-01', start_time: '10:00', end_time: '11:00' }]
  };
  const { activities } = enrichActivitiesWithSchoolAddresses([first, second], schools);
  const instructor = { emp_id: '7', address: 'בית', active: 'yes', full_name: 'נועה' };
  const preliminary = [
    { course: activities[0], candidate: { instructor, eligible: true, score: 80, missingProfileData: [], failures: [] } },
    { course: activities[1], candidate: { instructor, eligible: true, score: 80, missingProfileData: [], failures: [] } }
  ];

  let schoolSchoolGoogleCalls = 0;
  const invoke = async ({ origin, destination }) => {
    const resolved = resolveSinglePairFromTravelCache(cacheRows, origin, destination);
    const isSchoolSchoolPair = (
      (origin === pair.origin_address && destination === pair.destination_address)
      || (origin === pair.destination_address && destination === pair.origin_address)
    );
    if (isSchoolSchoolPair && resolved.mapsCall) schoolSchoolGoogleCalls += 1;
    if (resolved.calculated) return { data: resolved, error: null };
    // Home legs are outside the school→school cache proof; treat them as already cached.
    return {
      data: { calculated: true, cached: true, distance_km: 9, duration_minutes: 20 },
      error: null
    };
  };
  const client = createRouteClient({ invoke });
  const routed = await calculateCandidateTravel(preliminary, activities, client);
  const schoolSchoolRequest = client.requests.find((row) => (
    row.origin === 'רחוב הנביאים 12, חיפה' && row.destination === 'שדרות הציונות 5, חיפה'
  ));
  assert.ok(schoolSchoolRequest, 'expected a school→school request with canonical addresses');
  assert.ok(!client.requests.some((row) => row.origin === 'בית ספר א' || row.destination === 'בית ספר ב'));
  assert.ok(routed.cacheHits >= 1);
  assert.equal(resolveSinglePairFromTravelCache(cacheRows, pair.origin_address, pair.destination_address).cached, true);
  assert.equal(resolveSinglePairFromTravelCache(cacheRows, pair.origin_address, pair.destination_address).mapsCall, false);
  assert.equal(schoolSchoolGoogleCalls, 0);
});

test('same-address pair is already_valid on the second build without renewal', () => {
  const pair = {
    origin_address: 'אותה כתובת',
    destination_address: 'אותה כתובת',
    origin_entity_key: 'school_id:1',
    destination_entity_key: 'school_id:1'
  };
  const { runs } = simulateConsecutiveTravelBuilds([pair], {
    routeFactory: () => ({ distance_km: 0, duration_minutes: 0 })
  });
  assert.equal(runs[0].stats.inserted_count, 1);
  assert.equal(runs[1].stats.already_valid_count, 1);
  assert.equal(runs[1].stats.inserted_count, 0);
  assert.equal(runs[1].stats.renewed_count, 0);
  assert.equal(runs[1].mapsCalls, 0);
});

test('active instructor without address is counted as a skip failure without exposing PII', async () => {
  const ts = await readFile(edgeFunctionUrl, 'utf8');
  assert.match(ts, /skipped_instructors_missing_address_count/);
  assert.match(ts, /reason: 'missing_address'/);
  assert.match(ts, /entity_type: 'instructor'/);
  assert.match(ts, /instructorEntityKey\(empId\)/);
  assert.doesNotMatch(ts, /full_name|mobile|phone|email/);
  assert.match(translateSchedulingRouteError('missing_address'), /חסרה כתובת למדריך/);
});

test('instructor RPC returns active instructors including null addresses and only emp_id/address', async () => {
  const sql = await readFile(readinessMigrationUrl, 'utf8');
  assert.match(sql, /returns table\(emp_id bigint, address text\)/i);
  assert.match(sql, /nullif\(btrim\(coalesce\(ci\.address, ''\)\), ''\) as address/i);
  assert.doesNotMatch(sql, /and nullif\(btrim\(coalesce\(ci\.address, ''\)\), ''\) is not null/);
  assert.doesNotMatch(sql, /full_name|mobile|phone|email/i);
});

test('edge function checks valid cache before upserting same-address pairs', async () => {
  const ts = await readFile(edgeFunctionUrl, 'utf8');
  const processPair = ts.split('async function processPair')[1].split('async function runBuildCache')[0];
  const validCheck = processPair.indexOf('isCacheValid(matching, pair)');
  const sameKeyUpsert = processPair.indexOf("provider: 'same_school'");
  assert.ok(validCheck > -1 && sameKeyUpsert > validCheck);
});

test('total_count is computed from deduped schools dynamically', () => {
  const instructors = [
    { emp_id: 1, address: 'א' },
    { emp_id: 2, address: 'ב' }
  ];
  const schools = [
    { school_id: 10, school_name: 'א', authority_id: 1, authority_name: 'חיפה', address: 'כתובת א' },
    { school_id: 10, school_name: 'א', authority_id: null, authority_name: 'חיפה', address: 'קצר' },
    { school_id: 11, school_name: 'ב', authority_id: 1, authority_name: 'חיפה', address: 'כתובת ב' }
  ];
  const deduped = dedupeAuthoritySchools(schools);
  const instructorPairs = buildInstructorSchoolPairs(instructors, schools);
  const schoolPairs = buildSchoolSchoolPairs(schools);
  const total = instructorPairs.length + schoolPairs.length;
  assert.equal(deduped.uniqueCount, 2);
  assert.equal(deduped.duplicateCount, 1);
  assert.equal(instructorPairs.length, 2 * 2);
  assert.equal(schoolPairs.length, 2);
  assert.equal(total, 6);
  assert.equal(schoolEntityKey(schools[0]), 'school_id:10');
});

test('preliminary candidates receive enriched school_address before travel calculation', () => {
  const raw = [{
    row_id: 'p1',
    activity_season: 'school_2027',
    activity_type: 'קורס',
    status: 'פתוח',
    school_id: 10,
    school: 'בית ספר א',
    authority: 'חיפה',
    start_date: '2026-09-01',
    start_time: '10:00',
    end_time: '11:00',
    instruction_language: 'עברית',
    education_level: 'יסודי',
    meetings: [{ date: '2026-09-01', start_time: '10:00', end_time: '11:00' }]
  }];
  const { activities } = enrichActivitiesWithSchoolAddresses(raw, schoolRows);
  const preliminary = preliminaryCourseCandidates({
    activities,
    instructors: [{ emp_id: '1', full_name: 'נועה', active: 'yes', address: 'בית' }],
    profiles: { 1: { gender: 'female', instruction_languages: ['עברית'], education_levels: ['יסודי'], course_restriction_mode: 'all' } },
    rules: { 1: [{ weekday: 2, available: true, start_time: '08:00', end_time: '16:00' }] },
    exceptions: {}
  });
  assert.ok(preliminary.length);
  assert.equal(preliminary[0].course.school_address, 'רחוב הנביאים 12, חיפה');
});
