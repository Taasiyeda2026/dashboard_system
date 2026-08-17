import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildGoogleAddressQuery,
  buildInstructorSchoolPairs,
  buildSchoolSchoolPairs,
  calculateTravelCoverage,
  classifyTravelCachePair,
  dedupeAuthoritySchools,
  dedupeDistanceBuildFailures,
  formatDistanceBuildProgress,
  schoolEntityKey,
  shouldRenewCacheForAddressChange,
  shouldSkipValidCacheEntry,
  simulateConsecutiveTravelBuilds,
  translateSchedulingRouteError,
  runDistanceBuildLoop,
  emptyDistanceBuildStats,
  mergeDistanceBuildStats
} from '../frontend/src/screens/course-scheduling-distance-build.js';

const schemaUrl = new URL('../supabase/migrations/20260802220000_course_scheduling_interface_schema.sql', import.meta.url);
const readinessMigrationUrl = new URL('../supabase/migrations/20260803193000_course_scheduling_travel_cache_production_readiness.sql', import.meta.url);
const edgeFunctionUrl = new URL('../supabase/functions/scheduling-route/index.ts', import.meta.url);
const durableRouteMigrationUrl = new URL('../supabase/migrations/20260809170000_keep_usable_scheduling_routes.sql', import.meta.url);
const schedulingScreenUrl = new URL('../frontend/src/screens/course-scheduling.js', import.meta.url);

test('maintenance card loads and displays route coverage without opening another window', async () => {
  const source = await readFile(schedulingScreenUrl, 'utf8');
  const maintenanceCard = source.split('function maintenanceTabHtml')[1].split('function calendarTabHtml')[0];
  assert.match(maintenanceCard, /מרחקים קיימים:.*existing_count.*מתוך.*required_count/s);
  assert.match(maintenanceCard, /חסרים:.*missing_count/s);
  assert.match(maintenanceCard, /דורשים רענון:.*refresh_required_count/s);
  assert.match(maintenanceCard, /data-update-distances/);
  assert.doesNotMatch(maintenanceCard, /cache|TTL|batch|expiration|מטמון|מנות/i);

  const automaticLoad = source.split("if (activeTab(state) === 'maintenance'")[1].split('const openMissingCourse')[0];
  assert.match(automaticLoad, /loadDistanceCoverage/);
  assert.match(automaticLoad, /courseSchedulingDistanceStats = coverage/);
  assert.doesNotMatch(source, /distanceMaintenanceDialogHtml/);
});

test('the travel cache gains authority/school/address columns instead of a duplicate table', async () => {
  const sql = await readFile(schemaUrl, 'utf8');
  assert.match(sql, /alter table public\.scheduling_travel_cache/);
  for (const column of ['authority_id', 'origin_school_id', 'destination_school_id', 'origin_address', 'destination_address']) {
    assert.match(sql, new RegExp(`add column if not exists ${column}`));
  }
  assert.doesNotMatch(sql, /create table.*scheduling_travel_cache/);
});

test('production-readiness migration grants required privileges without widening RLS', async () => {
  const sql = await readFile(readinessMigrationUrl, 'utf8');
  assert.match(sql, /grant execute on function public\.scheduling_authority_school_locations\(\) to service_role/i);
  assert.match(sql, /grant select, insert, update, delete on public\.scheduling_travel_cache to service_role/i);
  assert.match(sql, /grant select on public\.course_meeting_cancellations to authenticated/i);
  assert.match(sql, /grant select on public\.course_meeting_instructor_history to authenticated/i);
  assert.doesNotMatch(sql, /using\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(sql, /drop policy/i);
});

test('instructor address RPC is service_role-only and does not broaden contacts_instructors grants', async () => {
  const sql = await readFile(readinessMigrationUrl, 'utf8');
  assert.match(sql, /create or replace function public\.scheduling_active_instructor_locations\(\)/i);
  assert.match(sql, /returns table\(emp_id bigint, address text\)/i);
  assert.match(sql, /security definer/i);
  assert.match(sql, /revoke all on function public\.scheduling_active_instructor_locations\(\) from public/i);
  assert.match(sql, /revoke all on function public\.scheduling_active_instructor_locations\(\) from anon/i);
  assert.match(sql, /revoke all on function public\.scheduling_active_instructor_locations\(\) from authenticated/i);
  assert.match(sql, /grant execute on function public\.scheduling_active_instructor_locations\(\) to service_role/i);
  assert.doesNotMatch(sql, /grant select on public\.contacts_instructors/i);
  assert.doesNotMatch(sql, /full_name|mobile|phone|email/i);
});

test('edge function reads instructor addresses via the narrow RPC only', async () => {
  const ts = await readFile(edgeFunctionUrl, 'utf8');
  assert.match(ts, /rpc\('scheduling_active_instructor_locations'\)/);
  assert.doesNotMatch(ts, /from\('contacts_instructors'\)/);
  assert.doesNotMatch(ts, /\.select\('emp_id, address, active'\)/);
});

test('production-readiness migration adds provenance metadata without changing the primary key', async () => {
  const sql = await readFile(readinessMigrationUrl, 'utf8');
  for (const column of [
    'origin_type',
    'destination_type',
    'origin_instructor_emp_id',
    'query_origin_address',
    'query_destination_address',
    'origin_entity_key',
    'destination_entity_key'
  ]) {
    assert.match(sql, new RegExp(`add column if not exists ${column}`));
  }
  assert.doesNotMatch(sql, /primary key\s*\(/i);
  assert.doesNotMatch(sql, /drop table/i);
  assert.match(sql, /Existing PK on origin_key\+destination_key is unchanged/);
});

test('the authority-school-locations helper only looks at school_2027 courses and reuses the existing address resolver', async () => {
  const sql = await readFile(schemaUrl, 'utf8');
  assert.match(sql, /create or replace function public\.scheduling_authority_school_locations/);
  assert.match(sql, /a\.activity_season = 'school_2027'/);
  assert.match(sql, /public\.scheduling_school_location\(a\.school_id, a\.school, a\.authority_id, a\.authority\)/);
});

test('build_cache mode is explicit and keeps the single-pair candidate lookup', async () => {
  const ts = await readFile(edgeFunctionUrl, 'utf8');
  assert.match(ts, /mode === 'build_cache'/);
  assert.match(ts, /async function runBuildCache/);
  assert.match(ts, /const origin = text\(payload\.origin\);/);
  assert.match(ts, /\['admin', 'operation_manager'\]\.includes/);
});

test('school dedup collapses duplicate school_id rows and prefers authority_id plus fuller address', () => {
  const result = dedupeAuthoritySchools([
    { school_id: 10, school_name: 'א', authority_id: null, authority_name: 'חיפה', address: 'רחוב' },
    { school_id: 10, school_name: 'א', authority_id: 7, authority_name: 'חיפה', address: 'רחוב 12' },
    { school_id: 11, school_name: 'ב', authority_id: 7, authority_name: 'חיפה', address: 'אחר' }
  ]);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.uniqueCount, 2);
  assert.equal(result.schools.find((school) => school.school_id === 10)?.authority_id, 7);
  assert.equal(result.schools.find((school) => school.school_id === 10)?.address, 'רחוב 12');
});

test('total_count after dedup does not inflate from duplicate source rows', () => {
  const instructors = [{ emp_id: 1, address: 'בית 1' }];
  const schools = [
    { school_id: 10, school_name: 'א', authority_id: null, authority_name: 'חיפה', address: 'רחוב' },
    { school_id: 10, school_name: 'א', authority_id: 7, authority_name: 'חיפה', address: 'רחוב 12' },
    { school_id: 11, school_name: 'ב', authority_id: 7, authority_name: 'חיפה', address: 'אחר' }
  ];
  const pairs = buildInstructorSchoolPairs(instructors, schools);
  assert.equal(pairs.length, 2);
  assert.deepEqual(pairs.map((pair) => pair.destination_school_id).sort(), [10, 11]);
});

test('school-school pairs stay inside one authority group and never pair a school with itself', () => {
  const schools = [
    { authority_id: 1, authority_name: 'חיפה', school_id: 10, school_name: 'א', address: 'רחוב 1' },
    { authority_id: 1, authority_name: 'חיפה', school_id: 11, school_name: 'ב', address: 'רחוב 2' },
    { authority_id: 2, authority_name: 'תל אביב', school_id: 20, school_name: 'ג', address: 'רחוב 3' }
  ];
  const pairs = buildSchoolSchoolPairs(schools);
  assert.equal(pairs.length, 2);
  assert.ok(pairs.every((pair) => pair.authority_id === 1));
  assert.ok(pairs.every((pair) => pair.origin_school_id !== pair.destination_school_id));
});

test('instructor-school pairs skip empty instructor addresses and keep both entity ids', () => {
  const instructors = [
    { emp_id: 1, address: 'בית 1' },
    { emp_id: 2, address: '' },
    { emp_id: 3, address: '   ' }
  ];
  const schools = [
    { school_id: 10, school_name: 'א', address: 'רחוב 1', authority_name: 'חיפה' },
    { school_id: 11, school_name: 'ב', address: 'רחוב 2', authority_name: 'חיפה' }
  ];
  const pairs = buildInstructorSchoolPairs(instructors, schools);
  assert.equal(pairs.length, 2);
  assert.ok(pairs.every((pair) => pair.origin_instructor_emp_id === 1));
  assert.ok(pairs.every((pair) => pair.origin_entity_key === 'instructor:1'));
});

test('schools without school_id use a stable alternate entity key', () => {
  const school = { school_id: null, school_name: 'בית ספר ללא מזהה', authority_name: 'נצרת', address: 'שכונת הנוצרים' };
  const key = schoolEntityKey(school);
  assert.match(key, /^school_ref\|/);
  assert.match(key, /נצרת|בית ספר ללא מזהה|שכונת הנוצרים/);
  assert.doesNotMatch(key, /^unknown$/);
  const pairs = buildInstructorSchoolPairs([{ emp_id: 9, address: 'בית' }], [school]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].destination_school_id, null);
  assert.equal(pairs[0].destination_entity_key, key);
});

test('two consecutive builds mark a null school_id pair as already_valid without a second maps call', () => {
  const pair = buildInstructorSchoolPairs(
    [{ emp_id: 5, address: 'כתובת מדריך' }],
    [{ school_id: null, school_name: 'בית ספר', authority_name: 'רשות', address: 'כתובת חלקית בלי מספר' }]
  )[0];
  const { runs } = simulateConsecutiveTravelBuilds([pair]);
  assert.equal(runs[0].stats.inserted_count, 1);
  assert.equal(runs[0].stats.already_valid_count, 0);
  assert.equal(runs[0].mapsCalls, 1);
  assert.equal(runs[1].stats.inserted_count, 0);
  assert.equal(runs[1].stats.renewed_count, 0);
  assert.equal(runs[1].stats.already_valid_count, 1);
  assert.equal(runs[1].mapsCalls, 0);
  assert.equal(classifyTravelCachePair(runs[1] ? [{
    origin_entity_key: pair.origin_entity_key,
    destination_entity_key: pair.destination_entity_key,
    origin_address: pair.origin_address,
    destination_address: pair.destination_address,
    distance_km: 1.5,
    duration_minutes: 8,
    expires_at: new Date(Date.now() + 86400000).toISOString()
  }] : [], pair).action, 'already_valid');
});

test('edge function never equals null school ids and prefers entity keys', async () => {
  const ts = await readFile(edgeFunctionUrl, 'utf8');
  assert.doesNotMatch(ts, /\.eq\('destination_school_id',\s*null\)/);
  assert.doesNotMatch(ts, /\.eq\('origin_school_id',\s*null\)/);
  assert.match(ts, /origin_entity_key/);
  assert.match(ts, /destination_entity_key/);
  assert.match(ts, /Never call \.eq\('\*_school_id', null\)/);
});

test('partial school addresses without a house number still produce a Google query', () => {
  const query = buildGoogleAddressQuery({
    schoolName: 'בית ספר הגליל',
    address: 'שכונת הנוצרים',
    authorityName: 'נצרת'
  });
  assert.match(query, /בית ספר הגליל/);
  assert.match(query, /שכונת הנוצרים/);
  assert.match(query, /נצרת/);
  assert.match(query, /ישראל/);
});

test('valid address-matched cache entries are skipped and address changes force renewal', () => {
  const cached = {
    origin_address: 'א',
    destination_address: 'ב',
    distance_km: 3,
    duration_minutes: 12,
    expires_at: new Date(Date.now() + 86400000).toISOString()
  };
  assert.equal(shouldSkipValidCacheEntry(cached, 'א', 'ב'), true);
  assert.equal(shouldRenewCacheForAddressChange(cached, 'א-חדש', 'ב'), true);
  assert.equal(shouldSkipValidCacheEntry(cached, 'א-חדש', 'ב'), false);
});

test('edge function counts inserted/renewed only after upsert and continues after a single route failure', async () => {
  const ts = await readFile(edgeFunctionUrl, 'utf8');
  assert.match(ts, /Count inserted\/renewed only after a successful upsert/);
  assert.match(ts, /Never persist a failure as a valid cache row/);
  assert.match(ts, /outcome\.inserted/);
  assert.match(ts, /failed_count/);
  assert.match(ts, /next_cursor/);
  assert.match(ts, /remaining_count/);
});

test('coverage distinguishes missing routes from usable routes requiring refresh', () => {
  const now = Date.now();
  const pairs = [
    { origin_address: 'א', destination_address: 'ב' },
    { origin_address: 'ג', destination_address: 'ד' },
    { origin_address: 'ה', destination_address: 'ו' }
  ];
  const cacheRows = [
    { origin_key: 'א', destination_key: 'ב', origin_address: 'א', destination_address: 'ב', distance_km: 3, duration_minutes: 8, expires_at: new Date(now + 1000).toISOString() },
    { origin_key: 'ג', destination_key: 'ד', origin_address: 'ג', destination_address: 'ד', distance_km: 4, duration_minutes: 9, expires_at: new Date(now - 1000).toISOString() }
  ];
  assert.deepEqual(calculateTravelCoverage(pairs, cacheRows, now), {
    required_count: 3,
    existing_count: 2,
    missing_count: 1,
    refresh_required_count: 1
  });
});

test('coverage rejects null, negative, and improper zero metrics without counting historical rows', () => {
  const pairs = [{ origin_address: 'א', destination_address: 'ב' }];
  for (const row of [
    { distance_km: null, duration_minutes: 5 },
    { distance_km: 5, duration_minutes: null },
    { distance_km: -1, duration_minutes: 5 },
    { distance_km: 5, duration_minutes: -1 },
    { distance_km: 0, duration_minutes: 5 },
    { distance_km: 5, duration_minutes: 0 }
  ]) {
    const coverage = calculateTravelCoverage(pairs, [{ origin_key: 'א', destination_key: 'ב', origin_address: 'א', destination_address: 'ב', expires_at: new Date(Date.now() + 10000).toISOString(), ...row }]);
    assert.equal(coverage.missing_count, 1);
    assert.equal(coverage.existing_count, 0);
  }
  const withHistorical = calculateTravelCoverage(pairs, [
    { origin_key: 'ישן', destination_key: 'מסלול', origin_address: 'ישן', destination_address: 'מסלול', distance_km: 2, duration_minutes: 5 },
    { origin_key: 'א', destination_key: 'ב', origin_address: 'א', destination_address: 'ב', distance_km: 2, duration_minutes: 5 }
  ]);
  assert.equal(withHistorical.required_count, 1);
  assert.equal(withHistorical.existing_count, 1);
});

test('address replacement persists the new route before deleting the obsolete key', async () => {
  const ts = await readFile(edgeFunctionUrl, 'utf8');
  const replace = ts.split('async function replaceCacheRow')[1].split('async function loadAuthoritySchools')[0];
  assert.ok(replace.indexOf(".upsert(row)") < replace.indexOf(".delete()"));
  assert.match(replace, /failed Google call or failed upsert therefore cannot erase/);
});

test('durable-route migration keeps usable expired rows and validates route metrics', async () => {
  const sql = await readFile(durableRouteMigrationUrl, 'utf8');
  assert.match(sql, /create or replace function public\.scheduling_cached_travel_distance_km/);
  assert.doesNotMatch(sql, /expires_at\s*>\s*now\(\)/i);
  assert.match(sql, /distance_km is not null/);
  assert.match(sql, /duration_minutes is not null/);
  assert.match(sql, /distance_km >= 0/);
  assert.match(sql, /duration_minutes >= 0/);
});

test('edge function responses do not include instructor street addresses in failures', async () => {
  const ts = await readFile(edgeFunctionUrl, 'utf8');
  const failureFn = ts.split('function failureForPair')[1].split('function cacheRowPayload')[0];
  assert.doesNotMatch(failureFn, /origin_address|destination_address|query_origin|query_destination/);
  assert.match(failureFn, /entity_type/);
  assert.match(failureFn, /entity_id/);
  assert.match(failureFn, /reason/);
});

test('edge function counts active instructors with null address as missing_address skips', async () => {
  const ts = await readFile(edgeFunctionUrl, 'utf8');
  assert.match(ts, /skipped_instructors_missing_address_count/);
  assert.match(ts, /reason: 'missing_address'/);
  assert.match(ts, /entity_type: 'instructor'/);
  assert.match(ts, /instructorEntityKey\(empId\)/);
  const processPair = ts.split('async function processPair')[1].split('async function runBuildCache')[0];
  const validCheck = processPair.indexOf('isCacheValid(matching, pair)');
  const sameKeyUpsert = processPair.indexOf("'same_school'");
  assert.ok(validCheck > -1 && sameKeyUpsert > validCheck, 'same-address pairs must check valid cache before upsert');
});

test('stable cursor pagination is encoded as phase:offset', async () => {
  const ts = await readFile(edgeFunctionUrl, 'utf8');
  assert.match(ts, /return `\$\{cursor\.phase\}:\$\{cursor\.offset\}`/);
  assert.match(ts, /instructor_school\|school_school/);
  assert.match(ts, /encodeCursor/);
  assert.match(ts, /decodeCursor/);
});

test('distance build loop continues with next_cursor until done and can stop safely', async () => {
  const calls = [];
  const invoke = async (body) => {
    calls.push(body);
    if (calls.length === 1) {
      return {
        data: {
          calculated: true,
          build: true,
          total_count: 50,
          processed_count: 25,
          inserted_count: 10,
          renewed_count: 5,
          already_valid_count: 8,
          skipped_count: 1,
          failed_count: 1,
          remaining_count: 25,
          done: false,
          next_cursor: 'instructor_school:25',
          failures: [{ entity_type: 'school_school', entity_id: '1->2', reason: 'route_not_found' }]
        },
        error: null
      };
    }
    return {
      data: {
        calculated: true,
        build: true,
        total_count: 50,
        processed_count: 25,
        inserted_count: 20,
        renewed_count: 0,
        already_valid_count: 5,
        skipped_count: 1,
        failed_count: 0,
        remaining_count: 0,
        done: true,
        next_cursor: null,
        failures: []
      },
      error: null
    };
  };
  const result = await runDistanceBuildLoop({ invoke, scope: 'all', limit: 25 });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].cursor, 'instructor_school:25');
  assert.equal(result.done, true);
  assert.equal(result.stats.processed_count, 50);
  assert.equal(result.stats.inserted_count, 30);
  assert.equal(result.stats.failed_count, 1);
});

test('upsert-style merge never counts a failed batch body as inserted success', () => {
  const stats = mergeDistanceBuildStats(emptyDistanceBuildStats(), {
    total_count: 10,
    processed_count: 2,
    inserted_count: 0,
    renewed_count: 0,
    already_valid_count: 0,
    skipped_count: 0,
    failed_count: 2,
    remaining_count: 8,
    failures: [{ entity_type: 'instructor_school', entity_id: '1->2', reason: 'cache_write_failed' }]
  });
  assert.equal(stats.inserted_count, 0);
  assert.equal(stats.failed_count, 2);
});

test('Edge Function status errors are translated to Hebrew guidance', () => {
  assert.match(translateSchedulingRouteError('Edge Function returned a non-2xx status code'), /שירות חישוב המרחקים/);
  assert.match(translateSchedulingRouteError('authority_school_lookup_failed'), /בתי הספר/);
  assert.match(translateSchedulingRouteError('cache_write_failed'), /מטמון/);
  assert.match(translateSchedulingRouteError('google_key_not_configured'), /Google Maps/);
  assert.match(translateSchedulingRouteError('scheduling_permission_denied'), /הרשאה/);
  assert.match(translateSchedulingRouteError('authentication_required'), /התחבר/);
});

test('batch endpoint still requires the admin/operation_manager role before build runs', async () => {
  const ts = await readFile(edgeFunctionUrl, 'utf8');
  const roleCheckIndex = ts.indexOf("['admin', 'operation_manager'].includes");
  const buildDispatchIndex = ts.indexOf('runBuildCache(db, key, payload)');
  assert.ok(roleCheckIndex > -1 && buildDispatchIndex > roleCheckIndex, 'role check must happen before build mode can run');
});

test('merge keeps a stable skipped_instructors_missing_address_count across batches', () => {
  let stats = emptyDistanceBuildStats();
  stats = mergeDistanceBuildStats(stats, {
    total_count: 10,
    processed_count: 5,
    inserted_count: 5,
    renewed_count: 0,
    already_valid_count: 0,
    skipped_count: 8,
    skipped_instructors_missing_address_count: 1,
    failed_count: 0,
    remaining_count: 5,
    failures: [{ entity_type: 'instructor', entity_id: 'instructor:1525', reason: 'missing_address' }]
  });
  stats = mergeDistanceBuildStats(stats, {
    total_count: 10,
    processed_count: 5,
    inserted_count: 5,
    renewed_count: 0,
    already_valid_count: 0,
    skipped_count: 8,
    skipped_instructors_missing_address_count: 1,
    failed_count: 1,
    remaining_count: 0,
    failures: [{ entity_type: 'instructor', entity_id: 'instructor:1525', reason: 'missing_address' }]
  });
  assert.equal(stats.skipped_instructors_missing_address_count, 1);
  assert.equal(stats.skipped_count, 8);
  assert.equal(stats.failures.length, 1);
  assert.equal(stats.failures[0].entity_id, 'instructor:1525');
});

test('failure dedupe collapses duplicate instructor missing_address alerts', () => {
  const failures = dedupeDistanceBuildFailures([
    { entity_type: 'instructor', entity_id: 'instructor:1525', reason: 'missing_address' },
    { entity_type: 'instructor', entity_id: 'instructor:1525', reason: 'missing_address' },
    { entity_type: 'school_school', entity_id: 'a->b', reason: 'route_not_found' }
  ]);
  assert.equal(failures.length, 2);
  assert.equal(failures.filter((row) => row.entity_id === 'instructor:1525').length, 1);
});

test('distance build progress texts cover success, failures, and stopped states', () => {
  const success = formatDistanceBuildProgress({
    total_count: 10,
    processed_count: 10,
    inserted_count: 8,
    renewed_count: 1,
    already_valid_count: 1,
    skipped_count: 3,
    skipped_instructors_missing_address_count: 1,
    failed_count: 0,
    remaining_count: 0,
    failures: []
  }, { done: true });
  assert.match(success, /הושלמה בהצלחה/);
  assert.match(success, /מדריכים פעילים ללא כתובת: 1/);
  assert.match(success, /דולגו מסיבות אחרות: 2/);
  assert.doesNotMatch(success, /דולגו: /);

  const withFailures = formatDistanceBuildProgress({
    total_count: 10,
    processed_count: 10,
    inserted_count: 7,
    renewed_count: 0,
    already_valid_count: 0,
    skipped_count: 1,
    skipped_instructors_missing_address_count: 1,
    failed_count: 2,
    remaining_count: 0,
    failures: [{ entity_type: 'instructor', entity_id: 'instructor:1525', reason: 'missing_address' }]
  }, { done: true });
  assert.match(withFailures, /הושלמה עם כשלים/);
  assert.match(withFailures, /instructor:1525/);
  assert.doesNotMatch(withFailures, /full_name|mobile|phone|email|רחוב/);

  const stopped = formatDistanceBuildProgress({
    total_count: 10,
    processed_count: 4,
    inserted_count: 2,
    renewed_count: 0,
    already_valid_count: 0,
    skipped_count: 1,
    skipped_instructors_missing_address_count: 1,
    failed_count: 0,
    remaining_count: 6,
    failures: []
  }, { stopped: true, done: false });
  assert.match(stopped, /נעצרה וניתן להמשיך בהרצה נוספת/);
});

test('course scheduling distance UI exposes only simple coverage and progress copy', async () => {
  const source = await readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
  assert.match(source, /function distanceDoneMessage/);
  assert.match(source, /מרחקים קיימים:/);
  assert.match(source, /חסרים:/);
  assert.match(source, /דורשים רענון:/);
  assert.match(source, /מעדכן \$\{processed\} מתוך \$\{total\}/);
  assert.match(source, /כל המרחקים מעודכנים/);
  assert.match(source, /נותרו \$\{remaining\} מסלולים לעדכון/);
  const card = source.split('function maintenanceTabHtml')[1].split('function calendarTabHtml')[0];
  assert.doesNotMatch(card, /cache|TTL|batch|expiration|מטמון|מנות|פרטים/i);
  assert.match(source, /state\.courseSchedulingDistanceError = info\.error/);
});
