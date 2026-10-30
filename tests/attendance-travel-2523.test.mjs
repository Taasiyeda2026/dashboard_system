import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { reportedKilometers } from '../attendance/src/services/reported-kilometers.js';
import { applyAttendanceDayRouteKilometers, travelCompensationDisplay } from '../frontend/src/screens/attendance-control.js';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const edgeSource = await read('supabase/functions/attendance-travel-compensation/index.ts');
const sourceId = '11111111-1111-4111-8111-111111111111';

test('physical km claims distinguish blank from explicit zero, without replacing reported amounts', () => {
  for (const value of ['', ' ', null, undefined]) assert.equal(reportedKilometers(value), null);
  assert.equal(reportedKilometers('0'), 0);
  assert.equal(reportedKilometers(0), 0);
  assert.equal(reportedKilometers('26.5'), 26.5);
  for (const value of ['-1', 'NaN', 'Infinity']) assert.equal(reportedKilometers(value), null);
  assert.equal(reportedKilometers('', { activityType: 'ביטול זמן' }), 0);
  assert.equal(reportedKilometers('99', { online: true }), 0);
  assert.equal(reportedKilometers('', { publicTransport: true }), 0);
});

test('both create and edit validate km before saving and retain a saved explicit zero', async () => {
  for (const file of ['new-report-screen.js', 'my-reports-screen.js']) {
    const source = await read('attendance/src/screens/' + file);
    assert.match(source, /reportedKilometers\(kmField\.input\.value/);
    assert.match(source, /roundtrip_km:\s+kmValue/);
    assert.match(source, /roundtrip_km != null/);
    assert.match(source, /kmValue == null/);
  }
});

test('online training and online operations do not invalidate a mixed physical workday', () => {
  for (const activityType of ['הכשרה', 'תפעול']) {
    const rows = [{ employeeId: '1', date: '2026-10-25', activityId: 'course', schoolId: 10, kilometers: null }];
    const reports = [
      { employeeId: '1', date: '2026-10-25', startTime: '08:00', activityType, program: 'שם בלי המילה זום', isRemoteDestination: true },
      { employeeId: '1', date: '2026-10-25', startTime: '10:00', activityId: 'course', activityType: 'קורס', originAddress: 'home', destinationAddress: 'school', destinationEntityKey: 'school_id:10' },
    ];
    const before = structuredClone(reports);
    applyAttendanceDayRouteKilometers(rows, reports, [
      { origin_address: 'home', destination_address: 'school', distance_km: 26.522 },
      { origin_address: 'school', destination_address: 'home', distance_km: 12.339 },
    ]);
    assert.equal(rows[0].kilometers, 38.86);
    assert.deepEqual(reports, before, 'calculation does not rewrite employee reports');
  }
});

test('cancellation errors require a claim or review context, including an explicit zero claim', () => {
  const failure = { travelCalculationStatus: 'unavailable', travelFailureCode: 'reconcile_failed', reviewStatus: 'none' };
  assert.deepEqual(travelCompensationDisplay(failure), []);
  assert.deepEqual(travelCompensationDisplay({ ...failure, reportedCancellationBeforeMinutes: 0 }),
    [['ביטול זמן', 'שמירת חישוב זמן הנסיעה נכשלה']]);
  assert.deepEqual(travelCompensationDisplay({ ...failure, reviewStatus: 'pending_review' }),
    [['ביטול זמן', 'שמירת חישוב זמן הנסיעה נכשלה']]);
  assert.deepEqual(travelCompensationDisplay({ ...failure, reviewStatus: 'pending_review', isRemoteDestination: true }), []);
  const resolved = travelCompensationDisplay({ travelCalculationStatus: 'resolved', reviewStatus: 'none', calculatedCancellationMinutes: 0 });
  assert.equal(resolved.some(([label]) => label === 'ביטול זמן'),false);
  assert.ok(resolved.some(([label]) => label === 'זמן נסיעה הלוך'),'keep valid route information available to control');
  assert.ok(travelCompensationDisplay({ travelCalculationStatus: 'resolved', reviewStatus: 'awaiting_report', calculatedCancellationMinutes: 20 }).length);
});

test('return cache loading uses the same scoped read RPC as the manager snapshot', async () => {
  const api = await read('frontend/src/api.js');
  const block = api.split('attendanceControlDashboardSources: async')[1].split('\n  },\n  activities: async')[0];
  const routes = [
    {origin_key:'home',destination_key:'school',distance_km:26.522},
    {origin_key:'school',destination_key:'home',distance_km:12.339},
  ];
  const calls=[];
  const db={rpc:async(name,args)=>{calls.push({name,args});return {data:routes,error:null};},from:table=>{
    const query={select:()=>query,eq:()=>query,gte:()=>query,lte:()=>query,in:()=>query,
      then:(resolve,reject)=>Promise.resolve({data:[],error:null}).then(resolve,reject)};
    return query;
  }};
  const context=vm.createContext({supabase:db,assertPermission:()=>{},
    ACTIVITY_OPERATIONS_COLUMNS:'',ACTIVITY_SEASON_REGULAR:'',ACTIVITY_SEASON_SUMMER_2026:'',ACTIVITY_SEASON_SCHOOL_2027:'',
    readAllActivitiesRowsSupabase:async()=>[],readAuthoritySchoolCatalog:async()=>({}),readProposalGroupAliasesFromSupabase:async()=>[]});
  const fn=vm.runInContext('(async '+block+'\n})',context);
  const result=await fn({employeeIds:['1550'],fromDate:'2026-10-01',toDate:'2026-10-31',skipRouteBuild:true});
  assert.equal(result.travelCache.length,2);
  assert.equal(result.travelCache.find(r=>r.destination_key==='home').distance_km,12.339);
  assert.equal(result.travelSourceAvailable,true);
  assert.equal(JSON.stringify(calls),JSON.stringify([{name:'get_payroll_attendance_route_cache',args:{p_employee_ids:[1550],p_from_date:'2026-10-01',p_to_date:'2026-10-31'}}]));
});

async function invokeEdge({ reconcileError = false, cacheError = null, suspect = false, provider = null, contextError = null } = {}) {
  const calls = [], errors = [];
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: sourceId } } }) },
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === 'av2_prepare_attendance_travel') return { data: { eligible: true, origin_address: 'home', destination_address: 'school', fingerprint: 'fp', emp_id: 1, context_error: contextError } };
      if (name === 'av2_reconcile_attendance_travel' && args.p_failure_code == null && reconcileError) return { error: { code: '23514', message: 'private row and address must not be logged' } };
      return { data: { review_status: 'none' } };
    },
    from: () => {
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({
        data: provider ? null : { duration_minutes: 30, distance_km: 26.522, location_suspect: suspect }, error: cacheError,
      }), upsert: async () => ({ error: null }) };
      return query;
    },
  };
  let handler;
  const context = vm.createContext({
    createClient: () => db, Request, Response,
    console: { error: (...args) => errors.push(args) },
    fetch: async () => {
      if (provider === 'network') throw new TypeError('network failure');
      return new Response(JSON.stringify(provider === 'empty' ? { routes: [] } : provider === 'invalid' ? { routes: [{ distanceMeters: -1, duration: 'bad' }] } : {}), { status: provider === 'http' ? 503 : 200 });
    },
    Deno: { env: { get: () => 'test-only' }, serve: fn => { handler = fn; } },
  });
  vm.runInContext(stripTypeScriptTypes(edgeSource.replace(/^import .*\n/, '').replace(/^export /gm, '')), context);
  const result = await handler(new Request('https://test.invalid', { method: 'POST', headers: { Authorization: 'Bearer test-only' }, body: JSON.stringify({ source_attendance_record_id: sourceId }) }));
  return { status: result.status, body: await result.json(), calls, errors };
}

test('Edge reports a failed save distinctly, without queuing working routes or logging private details', async () => {
  const r = await invokeEdge({ reconcileError: true });
  assert.equal(r.status, 500);
  assert.equal(r.body.failure_code, 'reconcile_failed');
  assert.equal(r.calls.filter(c => c.name === 'scheduling_queue_missing_route').length, 0);
  assert.equal(r.calls.at(-1).args.p_failure_code, 'reconcile_failed');
  assert.match(JSON.stringify(r.errors), /23514/);
  assert.doesNotMatch(JSON.stringify(r.errors), /private row|home|school/);
});

test('Edge distinguishes provider, invalid route data, missing route, cache and location failures', async () => {
  for (const [options, reason, status, queued] of [
    [{ provider: 'http' }, 'route_service_unavailable', 503, 2],
    [{ provider: 'network' }, 'route_service_unavailable', 503, 2],
    [{ provider: 'empty' }, 'route_not_found', 422, 2],
    [{ provider: 'invalid' }, 'route_data_invalid', 502, 2],
    [{ cacheError: { code: 'XX000' } }, 'cache_read_failed', 500, 0],
    [{ suspect: true }, 'location_review_required', 422, 0],
    [{ contextError: 'instructor_address_missing' }, 'instructor_address_missing', 422, 0],
  ]) {
    const r = await invokeEdge(options);
    assert.equal(r.status, status, reason);
    assert.equal(r.body.failure_code, reason);
    assert.equal(r.calls.filter(c => c.name === 'scheduling_queue_missing_route').length, queued);
  }
});

test('successful cached calculation keeps estimates server-side and uses the distance only for review', async () => {
  const r = await invokeEdge();
  assert.equal(r.body.status, 'resolved');
  const saved = r.calls.find(c => c.name === 'av2_reconcile_attendance_travel');
  assert.equal(saved.args.p_distance_km, 26.522);
  assert.equal(saved.args.p_outbound, 30);
  assert.doesNotMatch(JSON.stringify(r.body), /distance_km|travel_minutes|roundtrip_km/);
});
