import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildGoogleAddressQuery,
  buildInstructorSchoolPairs,
  buildSchoolSchoolPairs,
  shouldRenewCacheForAddressChange,
  shouldSkipValidCacheEntry,
  translateSchedulingRouteError,
  runDistanceBuildLoop,
  emptyDistanceBuildStats,
  mergeDistanceBuildStats
} from '../frontend/src/screens/course-scheduling-distance-build.js';

const schemaUrl = new URL('../supabase/migrations/20260802220000_course_scheduling_interface_schema.sql', import.meta.url);
const readinessMigrationUrl = new URL('../supabase/migrations/20260803193000_course_scheduling_travel_cache_production_readiness.sql', import.meta.url);
const edgeFunctionUrl = new URL('../supabase/functions/scheduling-route/index.ts', import.meta.url);

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

test('production-readiness migration adds provenance metadata without changing the primary key', async () => {
  const sql = await readFile(readinessMigrationUrl, 'utf8');
  for (const column of ['origin_type', 'destination_type', 'origin_instructor_emp_id', 'query_origin_address', 'query_destination_address']) {
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

test('build scopes cover instructor_school, school_school and all', async () => {
  const ts = await readFile(edgeFunctionUrl, 'utf8');
  assert.match(ts, /'instructor_school' \| 'school_school' \| 'all'/);
  assert.match(ts, /buildInstructorSchoolPairs/);
  assert.match(ts, /buildSchoolSchoolPairs/);
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
  assert.deepEqual(
    pairs.map((pair) => `${pair.origin_school_id}->${pair.destination_school_id}`).sort(),
    ['10->11', '11->10']
  );
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
  assert.deepEqual(pairs.map((pair) => pair.destination_school_id).sort(), [10, 11]);
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

test('edge function responses do not include instructor street addresses in failures', async () => {
  const ts = await readFile(edgeFunctionUrl, 'utf8');
  const failureFn = ts.split('function failureForPair')[1].split('function cacheRowPayload')[0];
  assert.doesNotMatch(failureFn, /origin_address|destination_address|query_origin|query_destination/);
  assert.match(failureFn, /entity_type/);
  assert.match(failureFn, /entity_id/);
  assert.match(failureFn, /reason/);
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
