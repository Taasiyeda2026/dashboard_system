import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildPlanningOverviewRows,
  buildDynamicCoursePlan,
  buildWeeklyPlanningMeetings,
  canonicalPlanningActivityNo,
  generatePlanningScenarios,
  hasOfficialPlanningSchedule,
  inferPlanningCourseSpec,
  latestFeasiblePlanningStart,
  planningDataFingerprint,
  planningRowsHtml
} from '../frontend/src/screens/course-scheduling-planning.js';

const instructor = { emp_id: 1, full_name: 'מדריך', active: 'yes', address: 'כתובת מדריך' };
const profileMap = { 1: { emp_id: 1, gender: 'male', instruction_languages: ['he'], friday_allowed: false } };
const ruleMap = { 1: [0, 1, 2, 3, 4].map((weekday) => ({ emp_id: 1, weekday, available: true, start_time: '07:00', end_time: '18:00' })) };
const routeClient = (leg) => ({ request: async () => leg, googleCalls: leg ? 1 : 0, cacheHits: 0, unavailableReason: leg ? '' : 'route_service_unavailable' });

const catalog = [{
  activity_name: 'ביומימיקרי – המצאות בהשראה מן הטבע',
  meetings_count: 11,
  hours_count: 16.5,
  unit_duration: ''
}];

const baseCourse = {
  row_id: 'c1',
  activity_season: 'school_2027',
  activity_type: 'course',
  status: 'פתוח',
  activity_name: 'ביומימיקרי – המצאות בהשראה מן הטבע',
  authority: 'רשות',
  school: 'בית ספר',
  district: 'מרכז',
  calendar_sector: 'general',
  instruction_language: 'he',
  required_instructor_gender: 'any'
};

test('planning spec derives meeting count and duration from catalog without changing the activity', () => {
  const spec = inferPlanningCourseSpec(baseCourse, catalog);
  assert.equal(spec.sessions, 11);
  assert.equal(spec.durationMinutes, 90);
  assert.equal(spec.complete, true);
  assert.equal(baseCourse.start_time, undefined);
});

test('legacy 82835 biomimicry identifier resolves to canonical 53828 catalog duration', () => {
  const canonicalCatalog = [{
    activity_no: '53828',
    gefen_number: '53828',
    pricing_key: '53828',
    activity_name: 'ביומימיקרי – חדשנות סביבתית-טכנולוגית בהשראה מן הטבע',
    meetings_count: 10,
    hours_count: 15,
    unit_duration: ''
  }];
  const activity = {
    ...baseCourse,
    activity_name: 'ביומימיקרי',
    activity_no: '82835',
    sessions: 11
  };
  assert.equal(canonicalPlanningActivityNo('82835'), '53828');
  const spec = inferPlanningCourseSpec(activity, canonicalCatalog);
  assert.equal(spec.sessions, 11);
  assert.equal(spec.durationMinutes, 90);
  assert.equal(spec.complete, true);
});

test('Planning does not guess a catalog program when an activity has no reliable identifier or exact name', () => {
  const spec = inferPlanningCourseSpec({
    ...baseCourse,
    activity_name: 'בינה מלאכותית-יזמות פרימיום',
    activity_no: null,
    sessions: 15
  }, [{
    activity_no: '52279',
    activity_name: 'אופק יזמות פרימיום בתעשייה',
    meetings_count: 14,
    hours_count: 21
  }]);
  assert.equal(spec.sessions, 15);
  assert.equal(spec.durationMinutes, null);
  assert.equal(spec.complete, false);
});

test('weekly planning keeps every meeting inside first half and rejects a start that finishes too late', () => {
  const valid = buildWeeklyPlanningMeetings({
    activity: baseCourse,
    startDate: '2026-10-04',
    startTime: '08:00',
    durationMinutes: 90,
    sessions: 11,
    schoolCalendar: []
  });
  assert.equal(valid.meetings.length, 11);
  assert.equal(valid.startDate, '2026-10-04');
  assert.ok(valid.endDate <= '2027-01-29');

  const tooLate = buildWeeklyPlanningMeetings({
    activity: baseCourse,
    startDate: '2026-12-06',
    startTime: '08:00',
    durationMinutes: 90,
    sessions: 11,
    schoolCalendar: []
  });
  assert.equal(tooLate, null);
});

test('planning scenarios offer dynamic dates and hours while respecting first-half completion', () => {
  const instructors = [{ emp_id: 1, full_name: 'מדריכה', active: 'yes' }];
  const rules = {
    1: [0, 1, 2, 3, 4].map((weekday) => ({
      emp_id: 1,
      weekday,
      available: true,
      start_time: '08:00',
      end_time: '16:00'
    }))
  };
  const generated = generatePlanningScenarios({
    activity: baseCourse,
    catalog,
    instructors,
    rules,
    activities: [],
    schoolCalendar: [],
    today: '2026-09-22'
  });
  assert.ok(generated.scenarios.length > 0);
  assert.ok(generated.startRange?.min >= '2026-09-22');
  assert.ok(generated.startRange?.max <= '2027-01-29');
  for (const scenario of generated.scenarios) {
    assert.equal(scenario.meetings.length, 11);
    assert.ok(scenario.endDate <= '2027-01-29');
    assert.ok(scenario.startTime);
    assert.ok(scenario.endTime);
  }
});

test('official schedules are synchronized into Planning as live data and missing schedules remain proposals only', () => {
  const live = {
    ...baseCourse,
    row_id: 'live',
    sessions: 2,
    emp_id: 10,
    instructor_name: 'מדריך קיים',
    start_time: '08:00',
    end_time: '09:30',
    date_1: '2026-10-04',
    date_2: '2026-10-11'
  };
  const missing = { ...baseCourse, row_id: 'missing' };
  assert.equal(hasOfficialPlanningSchedule(live), true);
  assert.equal(hasOfficialPlanningSchedule(missing), false);

  const rows = buildPlanningOverviewRows({ activities: [live, missing], catalog });
  assert.equal(rows.find((row) => row.courseId === 'live')?.kind, 'live');
  assert.equal(rows.find((row) => row.courseId === 'live')?.instructorName, 'מדריך קיים');
  assert.equal(rows.find((row) => row.courseId === 'missing')?.kind, 'missing');
  assert.equal(rows.find((row) => row.courseId === 'missing')?.status, 'נדרש טיפול');
});

test('exact latest start searches backward around blocked school weeks', () => {
  const latest = latestFeasiblePlanningStart({
    activity: baseCourse,
    targetWeekday: 0,
    startTime: '08:00',
    durationMinutes: 90,
    sessions: 3,
    schoolCalendar: [{ start_date: '2027-01-24', end_date: '2027-01-24', blocks_scheduling: true, is_active: true }]
  });
  const built = buildWeeklyPlanningMeetings({
    activity: baseCourse, startDate: latest, startTime: '08:00', durationMinutes: 90, sessions: 3,
    schoolCalendar: [{ start_date: '2027-01-24', end_date: '2027-01-24', blocks_scheduling: true, is_active: true }]
  });
  assert.ok(built);
  assert.ok(built.endDate <= '2027-01-29');
  assert.equal(latest, '2027-01-03');
});

test('planning fingerprint covers instructor, availability, calendar and catalog dependencies', () => {
  const base = { activities: [baseCourse], instructors: [{ emp_id: 1, active: 'yes', address: 'א' }], profiles: [{ emp_id: 1, friday_allowed: false }], rules: [], exceptions: [], schoolCalendar: [], catalog };
  const fingerprint = planningDataFingerprint(base);
  for (const changed of [
    { ...base, instructors: [{ emp_id: 1, active: 'yes', address: 'ב' }] },
    { ...base, profiles: [{ emp_id: 1, friday_allowed: true }] },
    { ...base, rules: [{ emp_id: 1, weekday: 0, available: true, start_time: '08:00', end_time: '10:00' }] },
    { ...base, exceptions: [{ emp_id: 1, exception_date: '2026-10-04', available: false }] },
    { ...base, schoolCalendar: [{ start_date: '2026-10-04', blocks_scheduling: true }] },
    { ...base, catalog: [{ ...catalog[0], meetings_count: 12 }] }
  ]) assert.notEqual(planningDataFingerprint(changed), fingerprint);
});

test('fixed schedules never move and a fixed holiday requires treatment', async () => {
  const fixed = { ...baseCourse, row_id: 'fixed', school_id: 1, school_address: 'כתובת בית ספר', sessions: 2, start_time: '08:00', end_time: '09:30', date_1: '2026-10-04', date_2: '2026-10-11' };
  const original = structuredClone(fixed);
  const result = await buildDynamicCoursePlan({
    activities: [fixed], instructors: [instructor], profiles: profileMap, rules: ruleMap,
    schoolCalendar: [{ calendar_sector: 'general', start_date: '2026-10-04', end_date: '2026-10-04', blocks_scheduling: true, is_active: true }],
    today: '2026-09-22', routeClient: routeClient({ distance_km: 5, duration_minutes: 10 })
  });
  assert.equal(result.rows[0].status, 'נדרש טיפול');
  assert.equal(result.rows[0].startDate, '2026-10-04');
  assert.equal(result.rows[0].startTime, '08:00');
  assert.deepEqual(fixed, original);
});

test('route failure never produces a valid planning proposal', async () => {
  const fixed = { ...baseCourse, row_id: 'fixed-route', school_id: 1, school_address: 'כתובת בית ספר', sessions: 1, start_time: '08:00', end_time: '09:30', date_1: '2026-10-04' };
  const result = await buildDynamicCoursePlan({
    activities: [fixed], instructors: [instructor], profiles: profileMap, rules: ruleMap,
    today: '2026-09-22', routeClient: routeClient(null)
  });
  assert.equal(result.rows[0].status, 'נדרש טיפול');
  assert.equal(result.rows[0].instructorEmpId, '');
  assert.equal(result.rows[0].options.length, 0);
});

test('planning fingerprint changes when live scheduling data changes', () => {
  const first = planningDataFingerprint([{
    ...baseCourse,
    row_id: 'live',
    emp_id: 10,
    start_time: '08:00',
    end_time: '09:30',
    date_1: '2026-10-04'
  }]);
  const second = planningDataFingerprint([{
    ...baseCourse,
    row_id: 'live',
    emp_id: 10,
    start_time: '09:30',
    end_time: '11:00',
    date_1: '2026-10-04'
  }]);
  assert.notEqual(first, second);
});

test('first-half Planning excludes courses scheduled only in second half', () => {
  const firstHalf = {
    ...baseCourse,
    row_id: 'first-half',
    start_time: '08:00',
    end_time: '09:30',
    date_1: '2026-11-01'
  };
  const secondHalf = {
    ...baseCourse,
    row_id: 'second-half',
    start_time: '08:00',
    end_time: '09:30',
    date_1: '2027-02-07'
  };
  const rows = buildPlanningOverviewRows({ activities: [firstHalf, secondHalf], catalog });
  assert.deepEqual(rows.map((row) => row.courseId), ['first-half']);
});

test('planning fingerprint follows saved draft proposed dates and hours', () => {
  const draft = {
    ...baseCourse,
    row_id: 'draft',
    draft_emp_id: '10',
    start_time: '08:00',
    end_time: '09:30',
    draft_proposed_meetings: [{ date: '2026-10-04', start_time: '08:00', end_time: '09:30' }]
  };
  const first = planningDataFingerprint([draft]);
  const second = planningDataFingerprint([{
    ...draft,
    draft_proposed_meetings: [{ date: '2026-10-11', start_time: '08:00', end_time: '09:30' }]
  }]);
  assert.notEqual(first, second);
});

test('drafts that extend beyond first half remain blockers and are clearly marked as overflow', () => {
  const draft = {
    ...baseCourse,
    row_id: 'draft-overflow',
    sessions: 14,
    draft_emp_id: '10',
    draft_instructor_name: 'מדריך טיוטה',
    start_time: '13:30',
    end_time: '15:00',
    draft_proposed_meetings: [
      { date: '2026-10-18', start_time: '13:30', end_time: '15:00' },
      { date: '2027-02-07', start_time: '13:30', end_time: '15:00' }
    ]
  };
  const row = buildPlanningOverviewRows({ activities: [draft], catalog })[0];
  assert.equal(row.status, 'טיוטת שיבוץ קיימת');
  assert.equal(row.halfOverflow, true);
  assert.match(row.reason, /לאחר סוף מחצית א׳/);
  assert.match(planningRowsHtml([row]), /חורגת ממחצית א׳/);
});

test('dynamic Planning exposes partial rows through progress while the run is still calculating', async () => {
  const unresolved = {
    ...baseCourse,
    row_id: 'partial-progress',
    activity_name: 'תוכנית ללא קטלוג',
    sessions: 5
  };
  const snapshots = [];
  await buildDynamicCoursePlan({
    activities: [unresolved],
    instructors: [],
    profiles: {},
    rules: {},
    exceptions: {},
    schoolCalendar: [],
    catalog: [],
    today: '2026-09-23',
    routeClient: routeClient(null),
    onProgress: (progress) => {
      if (Array.isArray(progress.rows)) snapshots.push(progress.rows);
    }
  });
  assert.ok(snapshots.length >= 1);
  assert.equal(snapshots.at(-1)[0].courseId, 'partial-progress');
  assert.equal(snapshots.at(-1)[0].status, 'נדרש טיפול');
});

test('Planning is a separate non-destructive workspace tab using scheduling permission', async () => {
  const [nav, capabilities, screen, planning] = await Promise.all([
    readFile(new URL('../frontend/src/screens/shared/instructors-workspace-nav.js', import.meta.url), 'utf8'),
    readFile(new URL('../frontend/src/capability-registry.js', import.meta.url), 'utf8'),
    readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8'),
    readFile(new URL('../frontend/src/screens/course-scheduling-planning.js', import.meta.url), 'utf8')
  ]);
  assert.match(nav, /id: 'planning', label: 'תכנון', route: 'course-scheduling'/);
  assert.match(nav, /courseSchedulingTab = 'planning'/);
  assert.match(capabilities, /id: 'instructors\.planning'[\s\S]*permission: 'view_operations_scheduling'/);
  assert.match(screen, /planningTabHtml/);
  assert.match(screen, /proposal_activity_pricing/);
  assert.doesNotMatch(planning, /supabase\.rpc|save_course_assignment|assign_activity_instructor|update\s+public\.activities/i);
});
