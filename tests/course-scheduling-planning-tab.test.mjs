import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  PLANNING_OPERATIONAL_START_DATE,
  buildPlanningOverviewRows,
  buildDynamicCoursePlan,
  buildFixedDatePlanningMeetings,
  buildWeeklyPlanningMeetings,
  canonicalPlanningActivityNo,
  generatePlanningScenarios,
  hasOfficialPlanningSchedule,
  inferPlanningCourseSpec,
  latestFeasiblePlanningStart,
  planningDataFingerprint,
  planningEffectivePeriod,
  planningInstructorSchedules,
  planningRowsHtml,
  planningTabHtml,
  planningWorkspaceCourses
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

test('weekly planning starts on or after 6 October, stays inside first half and rejects late starts', () => {
  assert.equal(PLANNING_OPERATIONAL_START_DATE, '2026-10-06');
  assert.equal(planningEffectivePeriod('first').start, '2026-10-06');
  assert.equal(buildWeeklyPlanningMeetings({
    activity: baseCourse,
    startDate: '2026-10-04',
    startTime: '08:00',
    durationMinutes: 90,
    sessions: 11,
    schoolCalendar: [],
    periodKey: 'first'
  }), null);

  const valid = buildWeeklyPlanningMeetings({
    activity: baseCourse,
    startDate: '2026-10-11',
    startTime: '08:00',
    durationMinutes: 90,
    sessions: 11,
    schoolCalendar: [],
    periodKey: 'first'
  });
  assert.equal(valid.meetings.length, 11);
  assert.equal(valid.startDate, '2026-10-11');
  assert.ok(valid.endDate <= '2027-01-29');

  const tooLate = buildWeeklyPlanningMeetings({
    activity: baseCourse,
    startDate: '2026-12-06',
    startTime: '08:00',
    durationMinutes: 90,
    sessions: 11,
    schoolCalendar: [],
    periodKey: 'first'
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
    today: '2026-09-22',
    periodKey: 'first'
  });
  assert.ok(generated.scenarios.length > 0);
  assert.ok(generated.startRange?.min >= '2026-10-06');
  assert.ok(generated.startRange?.max <= '2027-01-29');
  for (const scenario of generated.scenarios) {
    assert.equal(scenario.meetings.length, 11);
    assert.ok(scenario.startDate >= '2026-10-06');
    assert.ok(scenario.endDate <= '2027-01-29');
    assert.ok(scenario.startTime);
    assert.ok(scenario.endTime);
  }
  assert.deepEqual(
    [...new Set(generated.scenarios.map((scenario) => new Date(`${scenario.startDate}T12:00:00Z`).getUTCDay()))].sort(),
    [0, 1, 2, 3, 4]
  );
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
    date_1: '2026-10-11',
    date_2: '2026-10-18'
  };
  const missing = { ...baseCourse, row_id: 'missing' };
  assert.equal(hasOfficialPlanningSchedule(live), true);
  assert.equal(hasOfficialPlanningSchedule(missing), false);

  const rows = buildPlanningOverviewRows({ activities: [live, missing], catalog });
  assert.equal(rows.find((row) => row.courseId === 'live')?.kind, 'live');
  assert.equal(rows.find((row) => row.courseId === 'live')?.instructorName, 'מדריך קיים');
  assert.equal(rows.find((row) => row.courseId === 'live')?.startDate, '2026-10-11');
  assert.equal(rows.find((row) => row.courseId === 'live')?.sessions, 1);
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
    schoolCalendar: [{ start_date: '2027-01-24', end_date: '2027-01-24', blocks_scheduling: true, is_active: true }],
    periodKey: 'first'
  });
  const built = buildWeeklyPlanningMeetings({
    activity: baseCourse, startDate: latest, startTime: '08:00', durationMinutes: 90, sessions: 3,
    schoolCalendar: [{ start_date: '2027-01-24', end_date: '2027-01-24', blocks_scheduling: true, is_active: true }],
    periodKey: 'first'
  });
  assert.ok(built);
  assert.ok(built.endDate <= '2027-01-29');
  assert.equal(latest, '2027-01-03');
});

test('full-year Planning includes every supported open activity type, including second-half work', () => {
  const rows = planningWorkspaceCourses([
    { ...baseCourse, row_id: 'course-a', date_1: '2026-11-01' },
    { ...baseCourse, row_id: 'course-b', date_1: '2027-03-01' },
    { ...baseCourse, row_id: 'workshop-a', activity_type: 'workshop', date_1: '2027-04-01' },
    { ...baseCourse, row_id: 'tour-a', activity_type: 'tour', date_1: '2027-05-01' }
  ]);
  assert.deepEqual(rows.map((row) => row.row_id), ['course-a', 'course-b', 'workshop-a', 'tour-a']);
});

test('Planning excludes activities completed before 6 October but keeps undated and future activities', () => {
  const rows = planningWorkspaceCourses([
    { ...baseCourse, row_id: 'past-workshop', activity_type: 'workshop', date_1: '2026-09-30' },
    { ...baseCourse, row_id: 'undated' },
    { ...baseCourse, row_id: 'future', date_1: '2026-10-06' }
  ]);
  assert.deepEqual(rows.map((row) => row.row_id), ['undated', 'future']);
});

test('one-day workshops and tours derive a plannable single meeting from catalog duration', () => {
  const workshop = inferPlanningCourseSpec({
    ...baseCourse,
    row_id: 'workshop',
    activity_type: 'workshop',
    activity_name: 'אופטיקה ואשליות',
    activity_no: '37',
    sessions: ''
  }, [{ activity_no: '37', activity_name: 'אופטיקה ואשליות', unit_duration: '45 דקות' }]);
  const tour = inferPlanningCourseSpec({
    ...baseCourse,
    row_id: 'tour',
    activity_type: 'tour',
    activity_name: 'התנסות בתעשייה',
    activity_no: '13990',
    sessions: ''
  }, [{ activity_no: '13990', activity_name: 'התנסות בתעשייה', hours_count: 2 }]);
  assert.equal(workshop.sessions, 1);
  assert.equal(workshop.durationMinutes, 45);
  assert.equal(workshop.complete, true);
  assert.equal(tour.sessions, 1);
  assert.equal(tour.durationMinutes, 120);
  assert.equal(tour.complete, true);
});

test('Planning preserves school-provided date and start-time constraints while completing missing meetings', () => {
  const constrained = {
    ...baseCourse,
    row_id: 'constrained',
    sessions: 2,
    start_date: '2026-10-11',
    date_1: '2026-10-11',
    start_time: '10:00',
    end_time: null
  };
  const generated = generatePlanningScenarios({
    activity: constrained,
    catalog,
    instructors: [{ emp_id: 1, full_name: 'מדריכה', active: 'yes' }],
    rules: ruleMap,
    profiles: profileMap,
    activities: [],
    schoolCalendar: [],
    today: '2026-09-23',
    periodKey: 'first'
  });
  assert.ok(generated.scenarios.length > 0);
  assert.ok(generated.scenarios.every((scenario) => scenario.startDate === '2026-10-11'));
  assert.ok(generated.scenarios.every((scenario) => scenario.startTime === '10:00'));
  assert.ok(generated.scenarios.every((scenario) => scenario.meetings[0].date === '2026-10-11'));
});

test('fixed-date Planning changes only the missing hour and keeps every school date intact', () => {
  const fixedDates = {
    ...baseCourse,
    row_id: 'fixed-dates',
    sessions: 2,
    date_1: '2026-10-04',
    date_2: '2026-10-11'
  };
  const built = buildFixedDatePlanningMeetings({
    activity: fixedDates,
    startTime: '09:30',
    durationMinutes: 90,
    schoolCalendar: [],
    periodKey: 'first'
  });
  assert.deepEqual(built.meetings.map((meeting) => meeting.date), ['2026-10-11', '2026-10-18']);
  assert.ok(built.meetings.every((meeting) => meeting.start_time === '09:30' && meeting.end_time === '11:00'));
});

test('Planning builds a complete meeting-level work schedule for each instructor', () => {
  const schedules = planningInstructorSchedules([
    {
      courseId: 'a', courseName: 'קורס א', activityType: 'קורס', school: 'א', authority: 'רשות',
      kind: 'proposal', instructorEmpId: '1', instructorName: 'מדריך',
      meetings: [{ date: '2026-10-11', start_time: '10:00', end_time: '11:30' }]
    },
    {
      courseId: 'b', courseName: 'סדנה ב', activityType: 'סדנה', school: 'ב', authority: 'רשות',
      kind: 'live', instructorEmpId: '1', instructorName: 'מדריך',
      meetings: [{ date: '2026-10-07', start_time: '08:00', end_time: '08:45' }]
    }
  ]);
  assert.equal(schedules.length, 1);
  assert.equal(schedules[0].activityCount, 2);
  assert.deepEqual(schedules[0].meetings.map((meeting) => meeting.date), ['2026-10-07', '2026-10-11']);
  assert.deepEqual(schedules[0].meetings.map((meeting) => meeting.source), ['שיבוץ קיים', 'הצעת מערכת']);
});

test('Planning UI defaults to the full school year and exposes period selection', () => {
  const html = planningTabHtml({ rows: [], periodKey: 'year' });
  assert.match(html, /data-planning-period-filter/);
  assert.match(html, /שנת הלימודים/);
  assert.match(html, /06\.10\.2026/);
  assert.match(html, /בנה מערכת הדרכות מלאה/);
  assert.match(html, /קורסים, סדנאות וסיורים/);
});

test('planning fingerprint covers instructor, availability, calendar and catalog dependencies', () => {
  const base = { activities: [baseCourse], instructors: [{ emp_id: 1, active: 'yes', address: 'א' }], profiles: [{ emp_id: 1, friday_allowed: false }], rules: [], exceptions: [], schoolCalendar: [], catalog };
  const fingerprint = planningDataFingerprint(base);
  for (const changed of [
    { ...base, instructors: [{ emp_id: 1, active: 'yes', address: 'ב' }] },
    { ...base, profiles: [{ emp_id: 1, friday_allowed: true }] },
    { ...base, rules: [{ emp_id: 1, weekday: 0, available: true, start_time: '08:00', end_time: '10:00' }] },
    { ...base, exceptions: [{ emp_id: 1, exception_date: '2026-10-11', available: false }] },
    { ...base, schoolCalendar: [{ start_date: '2026-10-11', blocks_scheduling: true }] },
    { ...base, catalog: [{ ...catalog[0], meetings_count: 12 }] }
  ]) assert.notEqual(planningDataFingerprint(changed), fingerprint);
});

test('fixed schedules never move and a fixed holiday requires treatment', async () => {
  const fixed = { ...baseCourse, row_id: 'fixed', school_id: 1, school_address: 'כתובת בית ספר', sessions: 2, start_time: '08:00', end_time: '09:30', date_1: '2026-10-11', date_2: '2026-10-18' };
  const original = structuredClone(fixed);
  const result = await buildDynamicCoursePlan({
    activities: [fixed], instructors: [instructor], profiles: profileMap, rules: ruleMap,
    schoolCalendar: [{ calendar_sector: 'general', start_date: '2026-10-11', end_date: '2026-10-11', blocks_scheduling: true, is_active: true }],
    today: '2026-09-22', routeClient: routeClient({ distance_km: 5, duration_minutes: 10 })
  });
  assert.equal(result.rows[0].status, 'נדרש טיפול');
  assert.equal(result.rows[0].startDate, '2026-10-11');
  assert.equal(result.rows[0].startTime, '08:00');
  assert.deepEqual(fixed, original);
});

test('route failure never produces a valid planning proposal', async () => {
  const fixed = { ...baseCourse, row_id: 'fixed-route', school_id: 1, school_address: 'כתובת בית ספר', sessions: 1, start_time: '08:00', end_time: '09:30', date_1: '2026-10-11' };
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
    date_1: '2026-10-11'
  }]);
  const second = planningDataFingerprint([{
    ...baseCourse,
    row_id: 'live',
    emp_id: 10,
    start_time: '09:30',
    end_time: '11:00',
    date_1: '2026-10-11'
  }]);
  assert.notEqual(first, second);
});

test('assigned activities remain fixed even when school hours are incomplete', () => {
  const assignedIncomplete = {
    ...baseCourse,
    row_id: 'assigned-incomplete',
    emp_id: 10,
    instructor_name: 'מדריך קיים',
    date_1: '2026-10-04',
    start_time: '08:00',
    end_time: null
  };
  const row = buildPlanningOverviewRows({ activities: [assignedIncomplete], catalog })[0];
  assert.equal(row.kind, 'live');
  assert.equal(row.instructorName, 'מדריך קיים');
  assert.equal(row.status, 'מעודכן בפועל');
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
  const rows = buildPlanningOverviewRows({ activities: [firstHalf, secondHalf], catalog, periodKey: 'first' });
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
  const row = buildPlanningOverviewRows({ activities: [draft], catalog, periodKey: 'first' })[0];
  assert.equal(row.status, 'טיוטת שיבוץ קיימת');
  assert.equal(row.halfOverflow, true);
  assert.match(row.reason, /לאחר סוף תקופת התכנון/);
  assert.match(planningRowsHtml([row]), /חורגת מתקופת התכנון/);
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
