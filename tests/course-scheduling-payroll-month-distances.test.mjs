import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildInstructorSchoolPairs,
  buildSchoolSchoolPairs,
  loadDistanceCoverage,
  runDistanceBuildLoop,
  travelCacheRouteState
} from '../frontend/src/screens/course-scheduling-distance-build.js';
import {
  assignedPayrollEmpIds,
  buildPayrollMonthDistancePlan,
  classifyPayrollMonthCoverage,
  collectPayrollMonthMeetings,
  isRemotePayrollActivity,
  parsePayrollMonth,
  resolvePayrollActivitySchool,
  buildPayrollSchoolCatalog
} from '../frontend/src/screens/course-scheduling-payroll-month-distances.js';

const edgeFunctionUrl = new URL('../supabase/functions/scheduling-route/index.ts', import.meta.url);
const schedulingScreenUrl = new URL('../frontend/src/screens/course-scheduling.js', import.meta.url);

const MONTH = '2026-04';
const schoolA = { id: 10, school_name: 'אלון', authority: 'חיפה', authority_id: 1, institution_address: 'רחוב אלון 1' };
const schoolB = { id: 20, school_name: 'ברוש', authority: 'תל אביב', authority_id: 2, institution_address: 'רחוב ברוש 2' };
const schoolC = { id: 30, school_name: 'אורן', authority: 'חיפה', authority_id: 1, institution_address: 'רחוב אורן 3' };
const instructorA = { emp_id: 101, address: 'בית מדריך 101' };
const instructorB = { emp_id: 202, address: 'בית מדריך 202' };
const unusedInstructor = { emp_id: 999, address: 'בית מדריך שלא שובץ' };

function activity(overrides = {}) {
  return {
    row_id: 'act-1',
    emp_id: 101,
    school: 'אלון',
    school_id: 10,
    authority: 'חיפה',
    activity_name: 'קורס',
    start_time: '10:00',
    status: 'פתוח',
    date_1: '2026-04-07',
    ...overrides
  };
}

function plan(overrides = {}) {
  return buildPayrollMonthDistancePlan({
    month: MONTH,
    activities: [activity()],
    schools: [schoolA, schoolB, schoolC],
    instructors: [instructorA, instructorB, unusedInstructor],
    ...overrides
  });
}

test('parsePayrollMonth accepts YYYY-MM and rejects invalid values', () => {
  assert.equal(parsePayrollMonth('2026-05'), '2026-05');
  assert.equal(parsePayrollMonth('2026-13'), '');
  assert.equal(parsePayrollMonth('05-2026'), '');
});

test('activity with a meeting inside the month is included', () => {
  const meetings = collectPayrollMonthMeetings([
    activity({ date_1: '2026-03-31', date_2: '2026-04-01', date_3: '2026-05-01' })
  ], MONTH);
  assert.equal(meetings.length, 1);
  assert.equal(meetings[0].date, '2026-04-01');
});

test('activity without a meeting in the month is excluded', () => {
  const meetings = collectPayrollMonthMeetings([
    activity({ date_1: '2026-03-30', date_2: '2026-05-01', start_date: '2026-04-01' })
  ], MONTH);
  assert.equal(meetings.length, 0);
});

test('assigned instructor in a month meeting is included', () => {
  const result = plan();
  assert.equal(result.relevant_instructor_count, 1);
  assert.ok(result.pairs.some((pair) => pair.origin_instructor_emp_id === 101));
});

test('instructor not assigned in the month is excluded', () => {
  const result = plan();
  assert.equal(result.pairs.filter((pair) => pair.origin_instructor_emp_id === 999).length, 0);
  assert.equal(result.pairs.filter((pair) => pair.origin_instructor_emp_id === 202).length, 0);
});

test('emp_id_2 is included', () => {
  const result = plan({
    activities: [activity({ emp_id: 101, emp_id_2: '202' })]
  });
  assert.deepEqual(assignedPayrollEmpIds(activity({ emp_id: 101, emp_id_2: '202' })).sort(), [101, 202]);
  assert.equal(result.relevant_instructor_count, 2);
  assert.ok(result.pairs.some((pair) => pair.origin_instructor_emp_id === 202));
});

test('activity with school_id uses the linked catalog school', () => {
  const catalog = buildPayrollSchoolCatalog([schoolA, schoolB]);
  const resolved = resolvePayrollActivitySchool(activity({ school_id: 10, school: 'שם שגוי', authority: 'אחר' }), catalog);
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.school.school_id, 10);
  assert.equal(resolved.school.address, 'רחוב אלון 1');
});

test('activity without school_id is resolved only on an unambiguous catalog match', () => {
  const catalog = buildPayrollSchoolCatalog([schoolA, schoolB]);
  const resolved = resolvePayrollActivitySchool(activity({ school_id: null, school: 'אלון', authority: 'חיפה' }), catalog);
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.school.school_id, 10);
});

test('activity without school_id and no catalog match is unresolved', () => {
  const catalog = buildPayrollSchoolCatalog([schoolA]);
  const resolved = resolvePayrollActivitySchool(activity({ school_id: null, school: 'לא קיים', authority: 'חיפה' }), catalog);
  assert.equal(resolved.status, 'unresolved');
});

test('activity without school_id and multiple catalog matches is ambiguous', () => {
  const catalog = buildPayrollSchoolCatalog([
    schoolA,
    { ...schoolA, id: 11, institution_address: 'כתובת אחרת 9' }
  ]);
  const resolved = resolvePayrollActivitySchool(activity({ school_id: null, school: 'אלון', authority: 'חיפה' }), catalog);
  assert.equal(resolved.status, 'ambiguous');
});

test('Zoom activity does not create a route pair', () => {
  assert.equal(isRemotePayrollActivity(activity({ school: 'זום', activity_name: 'הכשרה' })), true);
  const result = plan({
    activities: [activity({ row_id: 'zoom-1', school: 'זום', school_id: null, activity_name: 'Zoom' })]
  });
  assert.equal(result.pairs.length, 0);
  assert.equal(result.relevant_meeting_count, 1);
});

test('a day with one school creates only the required home segments', () => {
  const result = plan();
  assert.equal(result.pairs.length, 1);
  assert.equal(result.pairs[0].pair_kind, 'instructor_school');
  assert.equal(result.pairs[0].destination_school_id, 10);
});

test('a day with two schools creates school->school in activity order only', () => {
  const result = plan({
    activities: [
      activity({ row_id: 'a', school_id: 10, school: 'אלון', start_time: '09:00', date_1: '2026-04-07' }),
      activity({ row_id: 'b', school_id: 20, school: 'ברוש', authority: 'תל אביב', start_time: '12:00', date_1: '2026-04-07' })
    ]
  });
  const schoolPairs = result.pairs.filter((pair) => pair.pair_kind === 'school_school');
  assert.equal(schoolPairs.length, 1);
  assert.equal(schoolPairs[0].origin_school_id, 10);
  assert.equal(schoolPairs[0].destination_school_id, 20);
  assert.equal(result.pairs.filter((pair) => pair.origin_school_id === 20 && pair.destination_school_id === 10).length, 0);
  assert.ok(result.pairs.some((pair) => pair.pair_kind === 'instructor_school' && pair.destination_school_id === 10));
  assert.ok(result.pairs.some((pair) => pair.pair_kind === 'instructor_school' && pair.destination_school_id === 20));
});

test('does not create every school combination', () => {
  const result = plan({
    activities: [
      activity({ row_id: 'a', school_id: 10, start_time: '09:00', date_1: '2026-04-07' }),
      activity({ row_id: 'b', school_id: 20, school: 'ברוש', authority: 'תל אביב', start_time: '12:00', date_1: '2026-04-07' })
    ]
  });
  assert.equal(result.pairs.filter((pair) => pair.destination_school_id === 30 || pair.origin_school_id === 30).length, 0);
  assert.equal(result.pairs.filter((pair) => pair.pair_kind === 'school_school').length, 1);
  assert.equal(result.pairs.length, 3);
});

test('does not create routes for every instructor in the system', () => {
  const result = plan();
  const involved = new Set(result.pairs.map((pair) => pair.origin_instructor_emp_id).filter(Boolean));
  assert.deepEqual([...involved], [101]);
  assert.equal(result.relevant_instructor_count, 1);
  assert.equal(result.pairs.filter((pair) => pair.origin_instructor_emp_id === 999).length, 0);
});

test('existing instructor_school and school_school builders keep their cartesian behavior', () => {
  const schools = [
    { school_id: 10, school_name: 'אלון', authority_id: 1, authority_name: 'חיפה', address: 'רחוב אלון 1' },
    { school_id: 20, school_name: 'ברוש', authority_id: 2, authority_name: 'תל אביב', address: 'רחוב ברוש 2' },
    { school_id: 30, school_name: 'אורן', authority_id: 1, authority_name: 'חיפה', address: 'רחוב אורן 3' }
  ];
  const instructorPairs = buildInstructorSchoolPairs([instructorA, unusedInstructor], schools);
  assert.equal(instructorPairs.length, 6);
  const schoolPairs = buildSchoolSchoolPairs(schools);
  assert.equal(schoolPairs.length, 2);
  assert.ok(schoolPairs.every((pair) => pair.authority_id === 1));
});

test('valid cached route is marked existing', () => {
  const result = plan();
  const pair = result.pairs[0];
  const now = Date.parse('2026-04-15T00:00:00Z');
  const cached = {
    origin_key: pair.origin_key,
    destination_key: pair.destination_key,
    origin_address: pair.origin_address,
    destination_address: pair.destination_address,
    origin_entity_key: pair.origin_entity_key,
    destination_entity_key: pair.destination_entity_key,
    distance_km: 12.5,
    duration_minutes: 20,
    expires_at: '2026-12-01T00:00:00.000Z'
  };
  assert.equal(travelCacheRouteState(cached, pair.origin_address, pair.destination_address, now), 'existing');
  const coverage = classifyPayrollMonthCoverage(result, [cached], now);
  assert.equal(coverage.existing_count, 1);
  assert.equal(coverage.missing_count, 0);
  assert.equal(coverage.refresh_required_count, 0);
});

test('expired cached route is marked refresh_required', () => {
  const result = plan();
  const pair = result.pairs[0];
  const now = Date.parse('2026-04-15T00:00:00Z');
  const cached = {
    origin_key: pair.origin_key,
    destination_key: pair.destination_key,
    origin_address: pair.origin_address,
    destination_address: pair.destination_address,
    origin_entity_key: pair.origin_entity_key,
    destination_entity_key: pair.destination_entity_key,
    distance_km: 12.5,
    duration_minutes: 20,
    expires_at: '2026-01-01T00:00:00.000Z'
  };
  assert.equal(travelCacheRouteState(cached, pair.origin_address, pair.destination_address, now), 'refresh_required');
  const coverage = classifyPayrollMonthCoverage(result, [cached], now);
  assert.equal(coverage.refresh_required_count, 1);
  assert.equal(coverage.existing_count, 1);
  assert.equal(coverage.missing_count, 0);
});

test('missing cached route is marked missing', () => {
  const result = plan();
  const coverage = classifyPayrollMonthCoverage(result, [], Date.parse('2026-04-15T00:00:00Z'));
  assert.equal(coverage.missing_count, 1);
  assert.equal(coverage.existing_count, 0);
});

test('instructor without address is reported and does not stop the run', () => {
  const result = plan({
    instructors: [{ emp_id: 101, address: '' }, instructorB],
    activities: [
      activity({ row_id: 'a', emp_id: 101, school_id: 10, start_time: '09:00' }),
      activity({ row_id: 'b', emp_id: 202, school_id: 20, school: 'ברוש', authority: 'תל אביב', start_time: '12:00' })
    ]
  });
  assert.equal(result.missing_instructor_address_count, 1);
  assert.ok(result.exceptions.some((row) => row.reason === 'missing_instructor_address'));
  assert.ok(result.pairs.some((pair) => pair.origin_instructor_emp_id === 202));
  assert.equal(result.pairs.filter((pair) => pair.origin_instructor_emp_id === 101).length, 0);
});

test('cancelled meetings are omitted from payroll routes', () => {
  const cancelled = new Map([['act-1', ['2026-04-07']]]);
  const result = plan({ cancelledByActivity: cancelled });
  assert.equal(result.relevant_meeting_count, 0);
  assert.equal(result.pairs.length, 0);
});

test('maintenance UI can choose payroll month without replacing scheduling coverage', async () => {
  const source = await readFile(schedulingScreenUrl, 'utf8');
  const maintenanceCard = source.split('function maintenanceTabHtml')[1].split('function calendarTabHtml')[0];
  assert.match(maintenanceCard, /עדכון מרחקים עבור/);
  assert.match(maintenanceCard, /שיבוצים/);
  assert.match(maintenanceCard, /בקרת שכר לפי חודש/);
  assert.match(maintenanceCard, /data-distance-month/);
  assert.match(source, /scope: distanceTarget/);
  assert.match(source, /payroll_month/);
  assert.doesNotMatch(maintenanceCard, /2026-05/);
});

test('edge function adds payroll_month without changing existing scopes', async () => {
  const ts = await readFile(edgeFunctionUrl, 'utf8');
  assert.match(ts, /scopeRaw === 'payroll_month'/);
  assert.match(ts, /\['instructor_school', 'school_school', 'all'\]/);
  assert.match(ts, /async function loadPayrollMonthPairs/);
  assert.match(ts, /rpc\('scheduling_active_instructor_locations'\)/);
  assert.match(ts, /from\('contacts_instructors'\)/);
  assert.match(ts, /\.select\('emp_id, address'\)/);
  const payrollFn = ts.split('async function loadPayrollMonthPairs')[1].split('async function mapWithConcurrency')[0];
  assert.doesNotMatch(payrollFn, /computeRoute/);
  assert.doesNotMatch(payrollFn, /from\('scheduling_travel_cache'\)/);
  assert.doesNotMatch(payrollFn, /full_name|mobile|phone|email/);
  const coverageDispatch = ts.split("if (mode === 'coverage')")[1].split('if (!key)')[0];
  assert.match(coverageDispatch, /runBuildCache/);
  assert.doesNotMatch(coverageDispatch, /computeRoute/);
});

test('runDistanceBuildLoop forwards payroll month on coverage and build', async () => {
  const calls = [];
  const invoke = async (body) => {
    calls.push(body);
    return {
      data: {
        calculated: true,
        build: true,
        coverage: body.mode === 'coverage',
        done: true,
        next_cursor: null,
        required_count: 0,
        existing_count: 0,
        missing_count: 0
      },
      error: null
    };
  };
  await loadDistanceCoverage(invoke, 'payroll_month', { month: '2026-05' });
  await runDistanceBuildLoop({ invoke, scope: 'payroll_month', month: '2026-05', limit: 25 });
  assert.ok(calls.every((body) => body.scope === 'payroll_month' && body.month === '2026-05'));
  assert.ok(calls.some((body) => body.mode === 'coverage'));
  assert.ok(calls.some((body) => body.mode === 'build_cache'));
});
