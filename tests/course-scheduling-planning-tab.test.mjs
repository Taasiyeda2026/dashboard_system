import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  PLANNING_OPERATIONAL_START_DATE,
  PLANNING_OPTIMIZATION_WEIGHTS,
  GLOBAL_PLANNING_OBJECTIVE_WEIGHTS,
  GLOBAL_OPTIMIZATION_MIN_GAIN,
  buildPlanningCompletionRows,
  buildPlanningOverviewRows,
  buildDynamicCoursePlan,
  buildFixedDatePlanningMeetings,
  buildWeeklyPlanningMeetings,
  canonicalPlanningActivityNo,
  estimatedPlanningInstructorCount,
  generatePlanningScenarios,
  hasOfficialPlanningSchedule,
  inferPlanningCourseSpec,
  latestFeasiblePlanningStart,
  planningActivityDifficulty,
  planningActivityHasStarted,
  planningContextFingerprint,
  planningDataFingerprint,
  planningEffectivePeriod,
  planningPeriodKeyForActivity,
  normalizePlanningLockedOption,
  planningInstructorSchedules,
  planningInstructorCompletionOverview,
  planningFullWorkPlanCoverage,
  assignRecruitmentProfiles,
  planningCompletionOverviewHtml,
  planningOptimizationScore,
  planningPlanQuality,
  planningGlobalObjective,
  planningGlobalRepairPriorityIds,
  globalOptimizationImprovesPlan,
  comparePlanningPlanQuality,
  planningQualityAudit,
  planningQualityAuditHtml,
  planningRowsHtml,
  planningTabHtml,
  planningWorkspaceCourses
} from '../frontend/src/screens/course-scheduling-planning.js';
import { buildPlanningWorkbook, planningExportFilename, planningWorkbookRows } from '../frontend/src/screens/course-scheduling-planning-export.js';
import { courseSchedulingScreen, planningJointChoiceModel } from '../frontend/src/screens/course-scheduling.js';

const planningDraftConfirmMigrationUrl = new URL('../supabase/migrations/20260924205500_confirm_shared_planning_draft.sql', import.meta.url);

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

test('joint planning chooser cascades date to time to instructor using only validated combinations', () => {
  const planning = {
    startDate: '2026-10-11',
    startTime: '08:00',
    endTime: '09:30',
    instructorEmpId: '1',
    options: [
      {
        startDate: '2026-10-11', startTime: '08:00', endTime: '09:30',
        instructorEmpId: '1', instructorName: 'אחד',
        meetings: [{ date: '2026-10-11', start_time: '08:00', end_time: '09:30' }]
      },
      {
        startDate: '2026-10-11', startTime: '10:00', endTime: '11:30',
        instructorEmpId: '2', instructorName: 'שתיים',
        meetings: [{ date: '2026-10-11', start_time: '10:00', end_time: '11:30' }]
      },
      {
        startDate: '2026-10-12', startTime: '09:00', endTime: '10:30',
        instructorEmpId: '3', instructorName: 'שלוש',
        meetings: [{ date: '2026-10-12', start_time: '09:00', end_time: '10:30' }]
      }
    ]
  };

  const defaultChoice = planningJointChoiceModel(planning);
  assert.deepEqual(defaultChoice.dates, ['2026-10-11', '2026-10-12']);
  assert.deepEqual(defaultChoice.times.map((item) => item.key), ['08:00|09:30', '10:00|11:30']);
  assert.deepEqual(defaultChoice.instructors.map((item) => item.empId), ['1']);
  assert.equal(defaultChoice.optionIndex, 0);

  const changedDate = planningJointChoiceModel(planning, { date: '2026-10-12' });
  assert.deepEqual(changedDate.times.map((item) => item.key), ['09:00|10:30']);
  assert.deepEqual(changedDate.instructors.map((item) => item.empId), ['3']);
  assert.equal(changedDate.optionIndex, 2);
});

test('workboard exposes separate date time and instructor controls for planning alternatives', async () => {
  const source = await readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
  assert.match(source, /data-planning-choice-date/);
  assert.match(source, /data-planning-choice-time/);
  assert.match(source, /data-planning-choice-instructor/);
  assert.match(source, /בחר תאריך, שעה ומדריך/);
  assert.match(source, /מוצגים רק שילובים שעברו את תנאי הסף/);
});

test('main scheduling workboard exposes only open, draft and assigned business states', () => {
  const activities = [
    {
      ...baseCourse,
      row_id: 'open-plan',
      start_date: '2026-10-11',
      date_1: '2026-10-11',
      start_time: '08:00',
      end_time: '09:30'
    },
    {
      ...baseCourse,
      row_id: 'draft-plan',
      start_date: '2026-10-12',
      date_1: '2026-10-12',
      start_time: '10:00',
      end_time: '11:30'
    },
    {
      ...baseCourse,
      row_id: 'assigned-plan',
      start_date: '2026-10-13',
      date_1: '2026-10-13',
      start_time: '12:00',
      end_time: '13:30',
      emp_id: '3',
      instructor_name: 'מדריך משובץ',
      instructor_assignment_locked: true
    },
    {
      ...baseCourse,
      row_id: 'undated-plan',
      sessions: 10
    },
    {
      ...baseCourse,
      row_id: 'second-half-plan',
      start_date: '2027-02-07',
      date_1: '2027-02-07',
      start_time: '08:00',
      end_time: '09:30'
    }
  ];
  const state = {
    user: { role: 'admin' },
    courseSchedulingPlanningSharedLoaded: true,
    courseSchedulingPlanningCalculatedAt: '24.9.2026, 20:00',
    courseSchedulingPlanningRows: [
      {
        courseId: 'open-plan',
        kind: 'proposal',
        instructorEmpId: '1',
        instructorName: 'מדריך מוצע',
        startDate: '2026-10-11',
        startTime: '08:00',
        endTime: '09:30',
        meetings: [{ date: '2026-10-11', start_time: '08:00', end_time: '09:30' }],
        options: [{
          instructorEmpId: '1',
          instructorName: 'מדריך מוצע',
          startDate: '2026-10-11',
          startTime: '08:00',
          endTime: '09:30',
          meetings: [{ date: '2026-10-11', start_time: '08:00', end_time: '09:30' }],
          routeVerified: true
        }]
      },
      {
        courseId: 'draft-plan',
        kind: 'planning-locked',
        planningLocked: true,
        instructorEmpId: '2',
        instructorName: 'מדריכה בטיוטה',
        startDate: '2026-10-12',
        startTime: '10:00',
        endTime: '11:30',
        meetings: [{ date: '2026-10-12', start_time: '10:00', end_time: '11:30' }],
        options: [{
          instructorEmpId: '2',
          instructorName: 'מדריכה בטיוטה',
          startDate: '2026-10-12',
          startTime: '10:00',
          endTime: '11:30',
          meetings: [{ date: '2026-10-12', start_time: '10:00', end_time: '11:30' }],
          routeVerified: true
        }]
      }
    ]
  };
  const html = courseSchedulingScreen.render({
    activities,
    instructors: [],
    scheduling: {},
    planningCatalog: [],
    schoolCalendar: [],
    meetingState: { loaded: true, approvedDates: new Map(), cancelledDates: new Map(), error: '' }
  }, { state });

  assert.match(html, /data-cs-ui="simple-workboard-20260924-v1"/);
  assert.match(html, /<span>פתוח<\/span>/);
  assert.match(html, /<span>ממתין לאישור<\/span>/);
  assert.match(html, /<span>משובץ<\/span>/);
  assert.doesNotMatch(html, /הצעות מוכנות/);
  assert.doesNotMatch(html, /data-instructors-workspace-tab="planning"/);
  assert.match(html, /בחר הצעה/);
  assert.match(html, /data-confirm-planning-draft/);
  assert.match(html, /אשר שיבוץ/);
  assert.match(html, /התכנון שמור ומעודכן/);
  assert.match(html, /data-course-card="undated-plan"/);
  assert.doesNotMatch(html, /data-course-card="second-half-plan"/);
  assert.match(html, /data-planning-completion-overview/);
  assert.match(html, /תוכנית עבודה מלאה — מחצית א׳/);
  assert.match(html, /4 פעילויות =/);
  assert.match(html, /01\.09\.2026/);
});

test('planning draft confirmation is an atomic server-side promotion to final assignment', async () => {
  const sql = await readFile(planningDraftConfirmMigrationUrl, 'utf8');
  assert.match(sql, /create or replace function public\.confirm_scheduling_planning_draft/);
  assert.match(sql, /planning_revision_conflict/);
  assert.match(sql, /planning_row\.locked_option is null/);
  assert.match(sql, /target\.updated_at is distinct from planning_row\.activity_updated_at/);
  assert.match(sql, /scheduling_course_instructor_violations\(v_activity_id, v_emp_id, true\)/);
  assert.match(sql, /scheduling_assert_assignment_calendar\(v_activity_id, v_emp_id, canonical\)/);
  assert.match(sql, /public\.assign_activity_instructor\(/);
  assert.match(sql, /public\.set_scheduling_planning_lock\([\s\S]*?activity_id,[\s\S]*?null,/);
  assert.match(sql, /grant execute on function public\.confirm_scheduling_planning_draft/);
  assert.doesNotMatch(
    sql.split(') returns public.activities')[0],
    /p_emp_id|p_meetings/
  );
});

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

test('undated activities default to first half while explicit second-half dates stay in second half', () => {
  assert.equal(planningPeriodKeyForActivity(baseCourse, 'year'), 'first');
  assert.equal(planningPeriodKeyForActivity({ ...baseCourse, start_date: '2027-02-07' }, 'year'), 'second');
  assert.equal(planningPeriodKeyForActivity({ ...baseCourse, date_1: '2027-03-01' }, 'year'), 'second');

  const secondHalfRows = planningWorkspaceCourses([
    { ...baseCourse, row_id: 'undated' },
    { ...baseCourse, row_id: 'explicit-second', date_1: '2027-03-01' }
  ], '', 'second');
  assert.deepEqual(secondHalfRows.map((row) => row.row_id), ['explicit-second']);
});

test('full-year planning keeps an undated first-half course starting in first half and allows continuation through February', () => {
  const generated = generatePlanningScenarios({
    activity: { ...baseCourse, row_id: 'undated-year', sessions: 10 },
    catalog,
    instructors: [{ emp_id: 1, full_name: 'מדריכה', active: 'yes' }],
    rules: ruleMap,
    profiles: profileMap,
    activities: [],
    schoolCalendar: [],
    today: '2026-09-23',
    periodKey: 'year'
  });
  assert.ok(generated.scenarios.length > 0);
  for (const scenario of generated.scenarios) {
    assert.equal(scenario.meetings.length, 10);
    assert.ok(scenario.startDate >= '2026-10-06');
    assert.ok(scenario.endDate <= '2027-02-28');
  }

  assert.equal(buildWeeklyPlanningMeetings({
    activity: { ...baseCourse, sessions: 10 },
    startDate: '2027-02-07',
    startTime: '08:00',
    durationMinutes: 90,
    sessions: 10,
    schoolCalendar: [],
    periodKey: 'year'
  }), null);
});


test('Saturday planning is allowed for Arab-sector activities and blocked elsewhere', () => {
  const arab = buildWeeklyPlanningMeetings({
    activity: { ...baseCourse, calendar_sector: 'arab' },
    startDate: '2026-10-10',
    startTime: '08:00',
    durationMinutes: 90,
    sessions: 3,
    schoolCalendar: [],
    periodKey: 'first'
  });
  assert.ok(arab);
  assert.equal(arab.startDate, '2026-10-10');
  assert.equal(arab.meetings.length, 3);

  const jewish = buildWeeklyPlanningMeetings({
    activity: { ...baseCourse, calendar_sector: 'jewish' },
    startDate: '2026-10-10',
    startTime: '08:00',
    durationMinutes: 90,
    sessions: 3,
    schoolCalendar: [],
    periodKey: 'first'
  });
  assert.equal(jewish, null);
});

test('weekly planning starts on or after 6 October and may continue through February', () => {
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

  const februaryContinuation = buildWeeklyPlanningMeetings({
    activity: baseCourse,
    startDate: '2026-12-06',
    startTime: '08:00',
    durationMinutes: 90,
    sessions: 11,
    schoolCalendar: [],
    periodKey: 'first'
  });
  assert.ok(februaryContinuation);
  assert.ok(februaryContinuation.endDate <= '2027-02-28');

  const tooLate = buildWeeklyPlanningMeetings({
    activity: baseCourse,
    startDate: '2027-01-03',
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
    assert.ok(scenario.endDate <= '2027-02-28');
    assert.ok(scenario.startTime);
    assert.ok(scenario.endTime);
  }
  assert.deepEqual(
    [...new Set(generated.scenarios.map((scenario) => new Date(`${scenario.startDate}T12:00:00Z`).getUTCDay()))].sort(),
    [0, 1, 2, 3, 4, 5]
  );
});

test('school-provided date and time stay fixed, including a course that already started', async () => {
  const fixed = {
    ...baseCourse,
    row_id: 'started-fixed',
    sessions: 2,
    date_1: '2026-09-20',
    date_2: '2026-09-27',
    start_date: '2026-09-20',
    end_date: '2026-09-27',
    start_time: '10:00',
    end_time: '11:30',
    school_id: 'S1',
    school_address: 'כתובת בית ספר'
  };
  assert.equal(planningActivityHasStarted(fixed, '2026-09-25'), true);
  const result = await buildDynamicCoursePlan({
    activities: [fixed],
    instructors: [instructor],
    profiles: profileMap,
    rules: ruleMap,
    exceptions: {},
    schoolCalendar: [],
    catalog,
    today: '2026-09-25',
    periodKey: 'year',
    routeClient: routeClient({ distance_km: 5, duration_minutes: 10 })
  });
  const row = result.rows[0];
  assert.deepEqual(row.meetings.map((meeting) => meeting.date), ['2026-09-20', '2026-09-27']);
  assert.ok(row.meetings.every((meeting) => meeting.start_time === '10:00' && meeting.end_time === '11:30'));
  assert.equal(row.startDate, '2026-09-20');
});

test('an already-started activity with incomplete timing is never moved to a synthetic future schedule', async () => {
  const startedIncomplete = {
    ...baseCourse,
    row_id: 'started-incomplete',
    sessions: 10,
    date_1: '2026-09-20',
    start_date: '2026-09-20'
  };
  const result = await buildDynamicCoursePlan({
    activities: [startedIncomplete],
    instructors: [instructor],
    profiles: profileMap,
    rules: ruleMap,
    exceptions: {},
    schoolCalendar: [],
    catalog,
    today: '2026-09-25',
    periodKey: 'year',
    routeClient: routeClient({ distance_km: 5, duration_minutes: 10 })
  });
  const row = result.rows[0];
  assert.equal(row.kind, 'fixed');
  assert.equal(row.startDate, '2026-09-20');
  assert.match(row.reason, /כבר התחילה/);
});

test('Planning operational weights total 100 and prefer packed geography/continuity', () => {
  assert.equal(Object.values(PLANNING_OPTIMIZATION_WEIGHTS).reduce((sum, value) => sum + value, 0), 100);
  const packed = planningOptimizationScore({
    continuityMeetingCount: 10,
    sameSchoolMeetingCount: 8,
    sameAuthorityMeetingCount: 2,
    nearbyMeetingCount: 0,
    existingWorkDayMeetingCount: 0,
    scoreBreakdown: {
      continuityEfficiency: { points: 35 },
      gapsAndNewDays: { points: 5 },
      actualWorkload: { points: 15 },
      travelDistance: { points: 20 },
      originalSchedulePreservation: { points: 15 }
    }
  });
  const scattered = planningOptimizationScore({
    continuityMeetingCount: 10,
    sameSchoolMeetingCount: 0,
    sameAuthorityMeetingCount: 0,
    nearbyMeetingCount: 0,
    existingWorkDayMeetingCount: 0,
    scoreBreakdown: {
      continuityEfficiency: { points: 12 },
      gapsAndNewDays: { points: 0 },
      actualWorkload: { points: 20 },
      travelDistance: { points: 25 },
      originalSchedulePreservation: { points: 15 }
    }
  });
  assert.ok(packed.total > scattered.total);
});

test('Planning difficulty recognizes narrow instructor availability before flexible work', () => {
  const instructors = [
    { emp_id: 1, full_name: 'א', active: 'yes' },
    { emp_id: 2, full_name: 'ב', active: 'yes' }
  ];
  const rules = {
    1: [{ emp_id: 1, weekday: 1, available: true, start_time: '08:00', end_time: '16:00' }],
    2: [
      { emp_id: 2, weekday: 1, available: true, start_time: '08:00', end_time: '16:00' },
      { emp_id: 2, weekday: 2, available: true, start_time: '14:00', end_time: '16:00' }
    ]
  };
  const profiles = { 1: { friday_allowed: false }, 2: { friday_allowed: false } };
  const flexible = { ...baseCourse, row_id: 'flex', sessions: 2 };
  const narrow = {
    ...baseCourse,
    row_id: 'narrow',
    sessions: 2,
    date_1: '2026-10-13',
    start_time: '14:00',
    end_time: '15:30'
  };
  assert.equal(estimatedPlanningInstructorCount({
    activity: flexible,
    spec: inferPlanningCourseSpec(flexible, catalog),
    instructors,
    profiles,
    rules
  }), 2);
  assert.equal(estimatedPlanningInstructorCount({
    activity: narrow,
    spec: inferPlanningCourseSpec(narrow, catalog),
    instructors,
    profiles,
    rules
  }), 1);
  assert.ok(
    planningActivityDifficulty({ activity: narrow, catalog, instructors, profiles, rules }).estimatedInstructorCount
    < planningActivityDifficulty({ activity: flexible, catalog, instructors, profiles, rules }).estimatedInstructorCount
  );
});

test('Planning keeps scenario coverage for narrow instructor-day availability windows', () => {
  const instructors = [
    { emp_id: 1, full_name: 'בוקר', active: 'yes' },
    { emp_id: 2, full_name: 'צהריים', active: 'yes' }
  ];
  const rules = {
    1: [{ emp_id: 1, weekday: 2, available: true, start_time: '08:00', end_time: '10:00' }],
    2: [{ emp_id: 2, weekday: 2, available: true, start_time: '14:00', end_time: '16:00' }]
  };
  const generated = generatePlanningScenarios({
    activity: { ...baseCourse, sessions: 2 },
    catalog,
    instructors,
    rules,
    profiles: {
      1: { emp_id: 1, friday_allowed: false },
      2: { emp_id: 2, friday_allowed: false }
    },
    activities: [],
    schoolCalendar: [],
    today: '2026-09-23',
    periodKey: 'first'
  });
  const tuesdayTimes = generated.scenarios
    .filter((scenario) => new Date(`${scenario.startDate}T12:00:00Z`).getUTCDay() === 2)
    .map((scenario) => scenario.startTime);
  assert.ok(tuesdayTimes.some((time) => time >= '08:00' && time <= '08:30'));
  assert.ok(tuesdayTimes.some((time) => time >= '14:00' && time <= '14:30'));
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
  assert.equal(rows.find((row) => row.courseId === 'live')?.startDate, '2026-10-04');
  assert.equal(rows.find((row) => row.courseId === 'live')?.sessions, 2);
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
  assert.ok(built.startDate <= '2027-01-29');
  assert.ok(built.endDate <= '2027-02-28');
  assert.equal(latest, '2027-01-17');
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

test('Planning keeps school-fixed September activities visible while 6 October applies only to generated new dates', () => {
  const rows = planningWorkspaceCourses([
    { ...baseCourse, row_id: 'september-fixed', activity_type: 'workshop', date_1: '2026-09-30' },
    { ...baseCourse, row_id: 'undated' },
    { ...baseCourse, row_id: 'future', date_1: '2026-10-06' }
  ]);
  assert.deepEqual(rows.map((row) => row.row_id), ['september-fixed', 'undated', 'future']);
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

test('Planning keeps a school-provided hour and generates only dates on or after 6 October', () => {
  const constrained = {
    ...baseCourse,
    row_id: 'time-only',
    sessions: 3,
    start_time: '11:00',
    end_time: '12:30'
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
  assert.ok(generated.scenarios.every((scenario) => scenario.startDate >= '2026-10-06'));
  assert.ok(generated.scenarios.every((scenario) => scenario.startTime === '11:00'));
});


test('fixed-date Planning changes only the missing hour and keeps every school date intact', () => {
  const fixedDates = {
    ...baseCourse,
    row_id: 'fixed-dates',
    sessions: 2,
    date_1: '2026-10-11',
    date_2: '2026-10-18'
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

test('completion rows count first half from 1 September and exclude explicit second-half work', () => {
  const activities = [
    { ...baseCourse, row_id: 'sep1', activity_type: 'course', start_date: '2026-09-01', date_1: '2026-09-01', emp_id: '1', instructor_name: 'א' },
    { ...baseCourse, row_id: 'undated', activity_type: 'course', sessions: 10 },
    { ...baseCourse, row_id: 'sep14', activity_type: 'workshop', start_date: '2026-09-14', date_1: '2026-09-14', emp_id: '2', instructor_name: 'ב' },
    { ...baseCourse, row_id: 'second', activity_type: 'course', start_date: '2027-02-01', date_1: '2027-02-01' }
  ];
  const rows = buildPlanningCompletionRows({ activities, planningRows: [] });
  assert.deepEqual(rows.map((row) => row.courseId).sort(), ['sep1', 'sep14', 'undated']);
  const html = planningCompletionOverviewHtml(rows, { schoolYearTotal: 4 });
  assert.match(html, /תוכנית עבודה מלאה — מחצית א׳/);
  assert.match(html, /3 פעילויות = 2 לצוות הקיים \+ 0 לגיוס \+ 1 חריגים/);
  assert.match(html, /2<\/b><span>מתוכננות לצוות הקיים/);
  assert.match(html, /1<\/b><span>חסר נתון \/ פתרון/);
  assert.match(html, /01\/09\/2026/);
});

test('full work plan coverage accounts for team recruitment and unresolved activities', () => {
  const rows = [
    { courseId: 'team', kind: 'proposal', instructorEmpId: '1', instructorName: 'א', startDate: '2026-10-01' },
    { courseId: 'recruit', kind: 'recruitment', startDate: '2026-10-02' },
    { courseId: 'missing', kind: 'missing' }
  ];
  assert.deepEqual(planningFullWorkPlanCoverage(rows), {
    total: 3,
    team: 1,
    recruitment: 1,
    unresolved: 1,
    complete: true
  });
});

test('recruitment overview exposes workload language days and training need without assigning a real instructor', () => {
  const rows = assignRecruitmentProfiles([
    {
      courseId: 'r1',
      courseName: 'בינה מלאכותית',
      activityType: 'קורס',
      school: 'בית ספר',
      authority: 'אום אל פחם',
      kind: 'recruitment',
      requiredLanguage: 'ar',
      requiredGender: 'any',
      startDate: '2026-10-10',
      endDate: '2026-10-17',
      startTime: '08:00',
      endTime: '09:30',
      meetings: [
        { date: '2026-10-10', start_time: '08:00', end_time: '09:30' },
        { date: '2026-10-17', start_time: '08:00', end_time: '09:30' }
      ],
      scheduleOptions: [{
        startDate: '2026-10-10',
        endDate: '2026-10-17',
        startTime: '08:00',
        endTime: '09:30',
        meetings: [
          { date: '2026-10-10', start_time: '08:00', end_time: '09:30' },
          { date: '2026-10-17', start_time: '08:00', end_time: '09:30' }
        ]
      }]
    }
  ]);
  const html = planningCompletionOverviewHtml(rows);
  assert.match(html, /תכנון לגיוס ולהכשרה/);
  assert.match(html, /2 מפגשים · 3 ש׳/);
  assert.match(html, /שפה: ערבית/);
  assert.match(html, /שבת/);
  assert.doesNotMatch(html, /instructorEmpId/);
});

test('first-half completion overview includes live, drafts and proposals per instructor', () => {
  const rows = [
    {
      courseId: 'live-a', courseName: 'ביומימיקרי', activityType: 'קורס', school: 'א', authority: 'רשות',
      kind: 'live', instructorEmpId: '1', instructorName: 'מדריך א',
      startDate: '2026-10-07', endDate: '2026-12-16',
      meetings: [{ date: '2026-10-07', start_time: '08:00', end_time: '09:30' }]
    },
    {
      courseId: 'draft-a', courseName: 'פורצות דרך', activityType: 'קורס', school: 'ב', authority: 'רשות',
      kind: 'draft', instructorEmpId: '1', instructorName: 'מדריך א',
      startDate: '2026-10-12', endDate: '2027-01-20',
      meetings: [{ date: '2026-10-12', start_time: '10:00', end_time: '11:30' }]
    },
    {
      courseId: 'proposal-a', courseName: 'רוקחים עולם', activityType: 'קורס', school: 'ג', authority: 'רשות אחרת',
      kind: 'proposal', instructorEmpId: '2', instructorName: 'מדריכה ב',
      startDate: '2026-10-06', endDate: '2027-01-19',
      meetings: [{ date: '2026-10-06', start_time: '08:00', end_time: '09:30' }]
    },
    {
      courseId: 'second-half', courseName: 'קורס מחצית ב', activityType: 'קורס', school: 'ד', authority: 'רשות',
      kind: 'live', instructorEmpId: '1', instructorName: 'מדריך א',
      startDate: '2027-02-07', endDate: '2027-04-18',
      meetings: [{ date: '2027-02-07', start_time: '08:00', end_time: '09:30' }]
    }
  ];

  const overview = planningInstructorCompletionOverview(rows);
  assert.equal(overview.length, 2);
  assert.equal(overview[0].name, 'מדריך א');
  assert.equal(overview[0].courseCount, 2);
  assert.equal(overview[0].liveCount, 1);
  assert.equal(overview[0].draftCount, 1);
  assert.equal(overview[0].proposalCount, 0);
  assert.equal(overview[0].firstStart, '2026-10-07');
  assert.equal(overview[0].lastEnd, '2027-01-20');
  assert.equal(overview[0].meetingCount, 2);
  assert.equal(overview[0].teachingHours, 3);
  assert.equal(overview[0].averageWorkDaysPerWeek, 1);
  assert.equal(overview[0].peakWeekHours, 1.5);
  assert.deepEqual(overview[0].programs, ['ביומימיקרי', 'פורצות דרך']);

  const html = planningCompletionOverviewHtml(rows);
  assert.match(html, /תוכנית עבודה מלאה — מחצית א׳/);
  assert.doesNotMatch(html, /מחצית א׳ מתחילה ב־01\.09\.2026/);
  assert.doesNotMatch(html, /התמונה מבוססת על התכנון השמור כרגע/);
  assert.match(html, /תכנון לצוות הקיים/);
  assert.match(html, /מדריך א/);
  assert.match(html, /מדריכה ב/);
  assert.match(html, /ממתין לאישור/);
  assert.match(html, /בתכנון/);
  assert.match(html, /07\/10\/2026/);
  assert.match(html, /20\/01\/2027/);
  assert.match(html, /2<\/b> מפגשים · 3 ש׳/);
  assert.match(html, /שבוע שיא/);
  assert.match(html, /1<\/b> ימי עבודה · 1\.5 ש׳/);
  assert.doesNotMatch(html, /ימי עבודה\/שבוע/);
  assert.doesNotMatch(html, /קורס מחצית ב/);
});

test('first-half planned workload includes meetings that continue beyond the half', () => {
  const rows = [{
    courseId: 'continuation',
    courseName: 'קורס ממשיך',
    activityType: 'קורס',
    school: 'א',
    authority: 'רשות',
    kind: 'proposal',
    instructorEmpId: '1',
    instructorName: 'מדריך',
    startDate: '2027-01-28',
    endDate: '2027-02-04',
    meetings: [
      { date: '2027-01-28', start_time: '08:00', end_time: '09:30' },
      { date: '2027-02-04', start_time: '08:00', end_time: '09:30' }
    ]
  }];
  const overview = planningInstructorCompletionOverview(rows);
  assert.equal(overview[0].meetingCount, 2);
  assert.equal(overview[0].teachingHours, 3);
  assert.equal(overview[0].continuationCount, 1);
  const html = planningCompletionOverviewHtml(rows);
  assert.match(html, /2<\/b> מפגשים · 3 ש׳/);
  assert.match(html, /כולל המשך של פעילויות מעבר למחצית/);
  assert.match(html, /04\/02\/2027/);
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

test('national planning prefers an early first-half start for an undated 10-meeting course', async () => {
  const activity = {
    ...baseCourse,
    row_id: 'early-undated',
    sessions: 10,
    school_id: 1,
    school_address: 'כתובת בית ספר'
  };
  const result = await buildDynamicCoursePlan({
    activities: [activity],
    instructors: [instructor],
    profiles: profileMap,
    rules: ruleMap,
    exceptions: {},
    schoolCalendar: [],
    catalog,
    today: '2026-09-23',
    periodKey: 'year',
    routeClient: routeClient({ distance_km: 5, duration_minutes: 10 })
  });
  const row = result.rows[0];
  assert.equal(row.kind, 'proposal');
  assert.ok(row.startDate >= '2026-10-06');
  assert.ok(row.startDate < '2026-11-01');
  assert.ok(row.endDate <= '2027-01-29');
  assert.equal(row.meetings.length, 10);
});

test('Planning locks a selected option without writing to the activity and exposes it as a blocker', async () => {
  const activity = { ...baseCourse, row_id: 'locked-course', sessions: 2 };
  const locked = {
    instructorEmpId: '1',
    instructorName: 'מדריך',
    startDate: '2026-10-13',
    endDate: '2026-10-20',
    startTime: '08:00',
    endTime: '09:30',
    routeVerified: true,
    meetings: [
      { date: '2026-10-13', meeting_no: 1, start_time: '08:00', end_time: '09:30' },
      { date: '2026-10-20', meeting_no: 2, start_time: '08:00', end_time: '09:30' }
    ]
  };
  const original = structuredClone(activity);
  const result = await buildDynamicCoursePlan({
    activities: [activity],
    instructors: [instructor],
    profiles: profileMap,
    rules: ruleMap,
    exceptions: {},
    schoolCalendar: [],
    catalog,
    today: '2026-09-23',
    lockedOptions: { 'locked-course': locked },
    routeClient: routeClient({ distance_km: 5, duration_minutes: 10 })
  });
  assert.equal(result.rows[0].kind, 'planning-locked');
  assert.equal(result.rows[0].status, 'נקבע בתכנון');
  assert.equal(result.rows[0].planningLocked, true);
  assert.equal(result.rows[0].instructorEmpId, '1');
  assert.deepEqual(result.rows[0].meetings.map((meeting) => meeting.date), ['2026-10-13', '2026-10-20']);
  assert.equal(result.locked, 1);
  assert.deepEqual(activity, original);
});

test('Planning validates a locked option against the active planning period', () => {
  assert.equal(normalizePlanningLockedOption({
    instructorEmpId: '1',
    meetings: [{ date: '2026-10-13', start_time: '08:00', end_time: '09:30' }]
  }, 'first')?.startDate, '2026-10-13');
  assert.equal(normalizePlanningLockedOption({
    instructorEmpId: '1',
    meetings: [{ date: '2026-09-30', start_time: '08:00', end_time: '09:30' }]
  }, 'first'), null);
});

test('Planning rows expose one-click primary choice, alternatives and unlock state', () => {
  const row = {
    courseId: 'dynamic-course',
    courseName: 'ביומימיקרי',
    activityType: 'קורס',
    school: 'בית ספר',
    authority: 'רשות',
    sessions: 2,
    kind: 'proposal',
    status: 'מועד מומלץ לבית הספר',
    startDate: '2026-10-13',
    endDate: '2026-10-20',
    startTime: '08:00',
    endTime: '09:30',
    instructorName: 'מדריך',
    instructorEmpId: '1',
    reason: 'רצף יעיל',
    options: [
      {
        instructorEmpId: '1', instructorName: 'מדריך',
        startDate: '2026-10-13', endDate: '2026-10-20',
        startTime: '08:00', endTime: '09:30',
        meetings: [{ date: '2026-10-13', start_time: '08:00', end_time: '09:30' }]
      },
      {
        instructorEmpId: '2', instructorName: 'מדריכה',
        startDate: '2026-10-14', endDate: '2026-10-21',
        startTime: '10:00', endTime: '11:30',
        meetings: [{ date: '2026-10-14', start_time: '10:00', end_time: '11:30' }]
      }
    ]
  };
  const html = planningRowsHtml([row]);
  assert.match(html, /data-planning-pick-option/);
  assert.match(html, /data-planning-option-index="0"/);
  assert.match(html, /data-planning-option-index="1"/);
  assert.match(html, /בחר חלופה/);

  const lockedHtml = planningRowsHtml([{ ...row, kind: 'planning-locked', planningLocked: true, status: 'נקבע בתכנון', options: [row.options[1]] }]);
  assert.match(lockedHtml, /data-planning-unlock/);
  assert.match(lockedHtml, /שחרר לתכנון מחדש/);
  assert.doesNotMatch(lockedHtml, /בחר חלופה/);
});

test('Planning UI defaults to the full school year and exposes period selection', () => {
  const html = planningTabHtml({ rows: [], periodKey: 'year' });
  assert.match(html, /data-planning-period-filter/);
  assert.match(html, /שנת הלימודים/);
  assert.match(html, /06\/10\/2026/);
  assert.match(html, /בנה מערכת הדרכות מלאה/);
  assert.match(html, /נדרש גיוס/);
  assert.match(html, /תכנון עבודה מלא/);
  assert.doesNotMatch(html, /Supabase/);
  assert.doesNotMatch(html, /היקף נוכחי/);
  assert.doesNotMatch(html, /בדיקות מרחק/);
  assert.match(html, /data-refresh-shared-planning/);
  assert.match(html, /data-export-course-planning disabled/);
  assert.doesNotMatch(html, /מערכת מלאה לפי מדריך/);
});

test('Planning UI shows the first-half completion snapshot after calculation', () => {
  const row = {
    courseId: 'summary-course',
    courseName: 'ביומימיקרי',
    activityType: 'קורס',
    school: 'בית ספר',
    authority: 'רשות',
    sessions: 10,
    kind: 'draft',
    status: 'טיוטת שיבוץ קיימת',
    instructorEmpId: '1',
    instructorName: 'מדריך',
    startDate: '2026-10-11',
    endDate: '2027-01-17',
    startTime: '08:00',
    endTime: '09:30',
    meetings: [{ date: '2026-10-11', start_time: '08:00', end_time: '09:30' }],
    options: []
  };
  const html = planningTabHtml({
    rows: [row],
    periodKey: 'year',
    calculatedAt: '25.9.2026, 10:30',
    pendingChanges: 0
  });
  assert.match(html, /data-planning-completion-overview/);
  assert.match(html, /תוכנית עבודה מלאה — מחצית א׳/);
  assert.doesNotMatch(html, /פעילויות שממתינות לעדכון/);
  assert.match(html, /מערכת מלאה לפי מדריך ולפי מפגש/);
  assert.ok(html.indexOf('data-planning-completion-overview') < html.indexOf('data-planning-course="summary-course"'));
});

test('Planning batches selected options before expensive recalculation and blocks stale Excel export', () => {
  const row = {
    courseId: 'c1',
    courseName: 'ביומימיקרי',
    activityType: 'קורס',
    school: 'בית ספר',
    authority: 'רשות',
    sessions: 2,
    kind: 'planning-locked',
    status: 'נקבע בתכנון',
    instructorEmpId: '1',
    instructorName: 'מדריך',
    startDate: '2026-10-13',
    endDate: '2026-10-20',
    startTime: '08:00',
    endTime: '09:30',
    meetings: [{ date: '2026-10-13', start_time: '08:00', end_time: '09:30' }],
    options: []
  };
  const html = planningTabHtml({
    rows: [row],
    periodKey: 'year',
    calculatedAt: '24.9.2026, 10:00',
    pendingChanges: 2
  });
  assert.match(html, /עדכן רק 2 פעילויות שהשתנו/);
  assert.doesNotMatch(html, /יש 2 פעילויות שהושפעו/);
  assert.match(html, /data-export-course-planning disabled/);
});

test('Planning quality audit detects conflicts, unresolved rows and inefficient singleton days', () => {
  const rows = [
    {
      courseId: 'q1',
      courseName: 'קורס א',
      school: 'בית ספר א',
      authority: 'רשות',
      kind: 'proposal',
      instructorEmpId: '10',
      instructorName: 'מדריכה א',
      startDate: '2026-10-11',
      endDate: '2026-10-11',
      startTime: '08:00',
      endTime: '10:00',
      meetings: [{ date: '2026-10-11', start_time: '08:00', end_time: '10:00' }],
      diagnostics: { routeVerified: true },
      options: [{
        instructorEmpId: '10',
        instructorName: 'מדריכה א',
        startDate: '2026-10-11',
        startTime: '08:00',
        routeVerified: true,
        planningOptimization: { total: 88 },
        operationalMetrics: {
          sameSchoolMeetingCount: 1,
          sameAuthorityMeetingCount: 0,
          nearbyMeetingCount: 0,
          newWorkDayMeetingCount: 0
        }
      }]
    },
    {
      courseId: 'q2',
      courseName: 'קורס ב',
      school: 'בית ספר ב',
      authority: 'רשות',
      kind: 'planning-locked',
      instructorEmpId: '10',
      instructorName: 'מדריכה א',
      startDate: '2026-10-11',
      endDate: '2026-10-11',
      startTime: '09:30',
      endTime: '11:00',
      meetings: [{ date: '2026-10-11', start_time: '09:30', end_time: '11:00' }],
      diagnostics: { routeVerified: true },
      options: [{
        instructorEmpId: '10',
        instructorName: 'מדריכה א',
        startDate: '2026-10-11',
        startTime: '09:30',
        routeVerified: true,
        planningOptimization: { total: 82 },
        operationalMetrics: {
          sameSchoolMeetingCount: 0,
          sameAuthorityMeetingCount: 1,
          nearbyMeetingCount: 0,
          newWorkDayMeetingCount: 0
        }
      }]
    },
    {
      courseId: 'q3',
      courseName: 'קורס ג',
      school: 'בית ספר ג',
      authority: 'רשות',
      kind: 'proposal',
      instructorEmpId: '11',
      instructorName: 'מדריך ב',
      startDate: '2026-10-12',
      endDate: '2026-10-12',
      startTime: '12:00',
      endTime: '13:30',
      meetings: [{ date: '2026-10-12', start_time: '12:00', end_time: '13:30' }],
      diagnostics: { routeVerified: false },
      options: [{
        instructorEmpId: '11',
        instructorName: 'מדריך ב',
        startDate: '2026-10-12',
        startTime: '12:00',
        routeVerified: false,
        planningOptimization: { total: 70 },
        operationalMetrics: { newWorkDayMeetingCount: 1 }
      }]
    },
    {
      courseId: 'q4',
      courseName: 'קורס ד',
      school: 'בית ספר ד',
      authority: 'רשות',
      kind: 'missing',
      instructorEmpId: '',
      instructorName: '',
      meetings: [],
      options: []
    }
  ];
  const audit = planningQualityAudit(rows);
  assert.equal(audit.conflicts.length, 1);
  assert.equal(audit.unverifiedRows.length, 1);
  assert.equal(audit.unresolvedRows.length, 1);
  assert.equal(audit.coveragePercent, 75);
  assert.equal(audit.packedDays, 1);
  assert.equal(audit.singletonDays, 1);
  assert.equal(audit.averageOperationalScore, 80);
  assert.equal(audit.status, 'נדרשת בדיקה');
});

test('Planning quality audit shows operational readiness and instructor workload in the completed plan', () => {
  const rows = [{
    courseId: 'quality-course',
    courseName: 'ביומימיקרי',
    activityType: 'קורס',
    authority: 'רשות',
    school: 'בית ספר',
    status: 'מועד מומלץ לבית הספר',
    sessions: 2,
    kind: 'proposal',
    instructorEmpId: '10',
    instructorName: 'מדריכה א',
    startDate: '2026-10-11',
    endDate: '2026-10-18',
    startTime: '08:00',
    endTime: '09:30',
    meetings: [
      { date: '2026-10-11', start_time: '08:00', end_time: '09:30' },
      { date: '2026-10-18', start_time: '08:00', end_time: '09:30' }
    ],
    diagnostics: { routeVerified: true },
    options: [{
      instructorEmpId: '10',
      instructorName: 'מדריכה א',
      startDate: '2026-10-11',
      startTime: '08:00',
      routeVerified: true,
      planningOptimization: { total: 91 },
      operationalMetrics: {
        sameSchoolMeetingCount: 2,
        sameAuthorityMeetingCount: 0,
        nearbyMeetingCount: 0,
        newWorkDayMeetingCount: 0
      }
    }]
  }];
  const auditHtml = planningQualityAuditHtml(rows);
  assert.match(auditHtml, /בדיקת איכות התכנון/);
  assert.match(auditHtml, /מוכן לעבודה/);
  assert.match(auditHtml, /עומס ורציפות לפי מדריך/);
  assert.match(auditHtml, /91\/100/);

  const tabHtml = planningTabHtml({
    rows,
    calculatedAt: '24.9.2026, 18:30',
    pendingChanges: 0,
    sharedLoaded: true
  });
  assert.match(tabHtml, /data-planning-quality-audit/);
  assert.match(tabHtml, /פעילויות עם מדריך/);
  assert.match(tabHtml, /נסיעות לא מאומתות/);
});

test('Planning Excel includes recommended dates, possible instructors and instructor schedule', () => {
  const row = {
    courseId: 'export-course',
    courseName: 'ביומימיקרי',
    activityType: 'קורס',
    authority: 'רשות',
    school: 'בית ספר',
    status: 'מועד מומלץ לבית הספר',
    sessions: 2,
    kind: 'proposal',
    instructorEmpId: '10',
    instructorName: 'מדריכה א',
    startDate: '2026-10-11',
    endDate: '2026-10-18',
    startTime: '08:00',
    endTime: '09:30',
    meetings: [
      { date: '2026-10-11', start_time: '08:00', end_time: '09:30' },
      { date: '2026-10-18', start_time: '08:00', end_time: '09:30' }
    ],
    options: [
      {
        instructorEmpId: '10', instructorName: 'מדריכה א',
        startDate: '2026-10-11', endDate: '2026-10-18',
        startTime: '08:00', endTime: '09:30',
        meetings: [{ date: '2026-10-11', start_time: '08:00', end_time: '09:30' }]
      },
      {
        instructorEmpId: '11', instructorName: 'מדריך ב',
        startDate: '2026-10-12', endDate: '2026-10-19',
        startTime: '10:00', endTime: '11:30',
        meetings: [{ date: '2026-10-12', start_time: '10:00', end_time: '11:30' }]
      }
    ]
  };
  const exportRows = planningWorkbookRows([row]);
  assert.equal(exportRows.activities[0]['תאריך התחלה מוצע'], '11/10/2026');
  assert.equal(exportRows.activities[0]['מדריכים אפשריים'], 'מדריכה א | מדריך ב');
  assert.match(exportRows.activities[0]['חלופות נוספות'], /12\/10\/2026 10:00–11:30 — מדריך ב/);
  assert.deepEqual(buildPlanningWorkbook([row]).SheetNames, ['סידור עבודה', 'אפשרויות תכנון', 'מערכת לפי מדריך']);
  assert.equal(
    planningExportFilename(new Date('2026-09-24T07:00:00.000Z')),
    'סידור_עבודה_תכנון_2026-09-24.xlsx'
  );
});

test('background planning keeps the workboard scroll stable instead of rerendering on every progress tick', async () => {
  const screen = await readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
  const planningRunStart = screen.indexOf('const result = await buildDynamicCoursePlan({');
  const planningRunEnd = screen.indexOf('const freshEnd = await data.reloadPlanningSnapshot();', planningRunStart);
  const planningRun = screen.slice(planningRunStart, planningRunEnd);

  assert.match(screen, /const rerenderPreservingWorkboardScroll = \(\) =>/);
  assert.match(screen, /listTop: Number\(list\?\.scrollTop\)/);
  assert.match(screen, /window\.scrollTo\(\{ top: Number\(saved\.windowY\), behavior: 'auto' \}\)/);
  assert.match(screen, /const updatePlanningStatusInPlace = \(\) =>/);
  assert.match(screen, /scheduleCoursePlanningStart\(\{/);
  assert.match(screen, /pending\.idleId = requestIdle\(run, \{ timeout: 600 \}\)/);
  const ownsRunStart = screen.indexOf('const ownsRun = () => (');
  const ownsRunEnd = screen.indexOf(');', ownsRunStart);
  const ownsRun = screen.slice(ownsRunStart, ownsRunEnd);
  assert.match(ownsRun, /activePlanningRun === run/);
  assert.match(ownsRun, /run\.generation === planningRunGeneration/);
  assert.match(ownsRun, /state\.route === 'course-scheduling'/);
  assert.doesNotMatch(ownsRun, /root\.isConnected/);
  assert.match(planningRun, /onProgress: \(progress\) =>/);
  assert.match(planningRun, /updatePlanningStatusInPlace\(\)/);
  assert.doesNotMatch(planningRun, /rerender\(\)/);
});

test('travel-cache preload is memoized so repeated planning updates do not refetch thousands of rows', async () => {
  const travel = await readFile(new URL('../frontend/src/screens/course-scheduling-travel.js', import.meta.url), 'utf8');
  assert.match(travel, /TRAVEL_CACHE_ROWS_TTL_MS = 5 \* 60 \* 1000/);
  assert.match(travel, /const travelCacheRowsMemo = new Map\(\)/);
  assert.match(travel, /if \(!force && existing\?\.rows/);
  assert.match(travel, /if \(!force && existing\?\.promise\) return existing\.promise/);
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

test('planning context fingerprint ignores activity-only changes but tracks shared scheduling context', () => {
  const base = {
    activities: [{ ...baseCourse, row_id: 'a', status: 'פתוח' }],
    instructors: [{ emp_id: 1, active: 'yes', address: 'א' }],
    profiles: [{ emp_id: 1, friday_allowed: false }],
    rules: [],
    exceptions: [],
    schoolCalendar: [],
    catalog,
    periodKey: 'year'
  };
  const fingerprint = planningContextFingerprint(base);
  assert.equal(
    planningContextFingerprint({
      ...base,
      activities: [{ ...base.activities[0], emp_id: 999, updated_at: '2026-09-24T12:00:00Z' }]
    }),
    fingerprint
  );
  assert.notEqual(
    planningContextFingerprint({
      ...base,
      rules: [{ emp_id: 1, weekday: 0, available: true, start_time: '08:00', end_time: '10:00' }]
    }),
    fingerprint
  );
});

test('incremental Planning reuses unaffected shared rows without rerouting them', async () => {
  const activity = {
    ...baseCourse,
    row_id: 'reuse-course',
    sessions: 2,
    school_id: 1,
    school_address: 'כתובת בית ספר'
  };
  const existing = {
    courseId: 'reuse-course',
    courseName: activity.activity_name,
    activityType: 'קורס',
    school: activity.school,
    authority: activity.authority,
    sessions: 2,
    kind: 'proposal',
    status: 'מועד מומלץ לבית הספר',
    instructorEmpId: '1',
    instructorName: 'מדריך',
    startDate: '2026-10-13',
    endDate: '2026-10-20',
    startTime: '08:00',
    endTime: '09:30',
    meetings: [
      { date: '2026-10-13', meeting_no: 1, start_time: '08:00', end_time: '09:30' },
      { date: '2026-10-20', meeting_no: 2, start_time: '08:00', end_time: '09:30' }
    ],
    options: []
  };
  let routeCalls = 0;
  const result = await buildDynamicCoursePlan({
    activities: [activity],
    instructors: [instructor],
    profiles: profileMap,
    rules: ruleMap,
    exceptions: {},
    schoolCalendar: [],
    catalog,
    today: '2026-09-23',
    existingRows: [existing],
    targetCourseIds: [],
    routeClient: {
      request: async () => {
        routeCalls += 1;
        throw new Error('unaffected row must not be rerouted');
      },
      googleCalls: 0,
      cacheHits: 0,
      unavailableReason: ''
    }
  });
  assert.equal(routeCalls, 0);
  assert.equal(result.rows[0].courseId, 'reuse-course');
  assert.equal(result.rows[0].instructorEmpId, '1');
  assert.equal(result.rows[0].startDate, '2026-10-13');
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
  assert.equal(result.rows[0].kind, 'missing');
  assert.equal(result.rows[0].instructorEmpId, '');
  assert.equal(result.rows[0].options.length, 0);
  assert.match(result.rows[0].reason, /לא מסומן לגיוס|בדיקה נוספת/);
});

test('national repair pass can swap a flexible fixed-slot assignment to avoid unnecessary recruitment', async () => {
  const instructors = [
    { emp_id: '1', full_name: 'מדריך א', active: 'yes', address: 'בית א' },
    { emp_id: '2', full_name: 'מדריכה ב', active: 'yes', address: 'בית ב' }
  ];
  const profiles = {
    1: { emp_id: '1', gender: 'male', instruction_languages: ['he'], friday_allowed: false },
    2: { emp_id: '2', gender: 'female', instruction_languages: ['he'], friday_allowed: false }
  };
  const rules = {
    1: [{ emp_id: '1', weekday: 0, available: true, start_time: '07:00', end_time: '14:00' }],
    2: [{ emp_id: '2', weekday: 0, available: true, start_time: '07:00', end_time: '14:00' }]
  };
  const activities = [
    {
      ...baseCourse,
      row_id: 'a-flexible',
      sessions: 1,
      school_id: 'S1',
      school: 'בית ספר א',
      school_address: 'כתובת א',
      date_1: '2026-10-11',
      start_date: '2026-10-11',
      end_date: '2026-10-11',
      start_time: '08:00',
      end_time: '09:30',
      required_instructor_gender: 'any'
    },
    {
      ...baseCourse,
      row_id: 'z-male-only',
      sessions: 1,
      school_id: 'S2',
      school: 'בית ספר ב',
      school_address: 'כתובת ב',
      date_1: '2026-10-11',
      start_date: '2026-10-11',
      end_date: '2026-10-11',
      start_time: '08:00',
      end_time: '09:30',
      required_instructor_gender: 'male'
    }
  ];
  const result = await buildDynamicCoursePlan({
    activities,
    instructors,
    profiles,
    rules,
    exceptions: {},
    schoolCalendar: [],
    catalog,
    today: '2026-09-25',
    periodKey: 'year',
    routeClient: routeClient({ distance_km: 5, duration_minutes: 10 })
  });
  assert.equal(result.repairApplied, true);
  assert.equal(result.recruitment, 0);
  assert.equal(result.missing, 0);
  const flex = result.rows.find((row) => row.courseId === 'a-flexible');
  const constrained = result.rows.find((row) => row.courseId === 'z-male-only');
  assert.equal(constrained.instructorEmpId, '1');
  assert.equal(flex.instructorEmpId, '2');
  assert.equal(result.repairImprovement.before.recruitment, 1);
  assert.equal(result.repairImprovement.after.recruitment, 0);
});

test('plan-quality comparison prioritizes existing-team coverage and fewer hiring models', () => {
  const weaker = [
    { courseId: 'a', kind: 'proposal', instructorEmpId: '1', options: [] },
    { courseId: 'b', kind: 'recruitment', recruitmentProfileId: 'recruitment-1', options: [] }
  ];
  const stronger = [
    { courseId: 'a', kind: 'proposal', instructorEmpId: '1', options: [] },
    { courseId: 'b', kind: 'proposal', instructorEmpId: '2', options: [] }
  ];
  assert.equal(planningPlanQuality(weaker).uncovered, 1);
  assert.equal(planningPlanQuality(stronger).uncovered, 0);
  assert.ok(comparePlanningPlanQuality(stronger, weaker) < 0);
});

test('plan-quality comparison follows approved repair priorities after existing-team coverage ties', () => {
  const fewerNewInstructors = [
    { courseId: 'a', kind: 'missing', options: [] },
    { courseId: 'b', kind: 'recruitment', recruitmentProfileId: 'recruitment-1', options: [] }
  ];
  const moreNewInstructors = [
    { courseId: 'a', kind: 'recruitment', recruitmentProfileId: 'recruitment-1', options: [] },
    { courseId: 'b', kind: 'recruitment', recruitmentProfileId: 'recruitment-2', options: [] }
  ];
  const firstQuality = planningPlanQuality(fewerNewInstructors);
  const secondQuality = planningPlanQuality(moreNewInstructors);
  assert.equal(firstQuality.uncovered, secondQuality.uncovered);
  assert.equal(firstQuality.recruitmentProfiles, 1);
  assert.equal(secondQuality.recruitmentProfiles, 2);
  assert.ok(comparePlanningPlanQuality(fewerNewInstructors, moreNewInstructors) < 0);

  const unchangedDraft = {
    courseId: 'draft-same',
    kind: 'proposal',
    sourceHadDraft: true,
    previousDraftInstructorEmpId: '10',
    instructorEmpId: '10',
    previousDraftMeetings: [
      { date: '2026-10-11', start_time: '08:00', end_time: '09:30' }
    ],
    meetings: [
      { date: '2026-10-11', start_time: '08:00', end_time: '09:30' }
    ],
    options: []
  };
  const changedDraft = {
    ...unchangedDraft,
    courseId: 'draft-changed',
    instructorEmpId: '11'
  };
  assert.equal(planningPlanQuality([unchangedDraft]).changedDrafts, 0);
  assert.equal(planningPlanQuality([changedDraft]).changedDrafts, 1);
  assert.ok(comparePlanningPlanQuality([unchangedDraft], [changedDraft]) < 0);

  const lessTravel = [{
    courseId: 'travel-a',
    kind: 'proposal',
    instructorEmpId: '10',
    options: [{
      instructorEmpId: '10',
      operationalMetrics: { newWorkDayMeetingCount: 0, relevantTravelDistance: 12 },
      planningOptimization: { total: 80 }
    }]
  }];
  const moreTravel = [{
    courseId: 'travel-b',
    kind: 'proposal',
    instructorEmpId: '10',
    options: [{
      instructorEmpId: '10',
      operationalMetrics: { newWorkDayMeetingCount: 0, relevantTravelDistance: 18 },
      planningOptimization: { total: 95 }
    }]
  }];
  assert.equal(planningPlanQuality(lessTravel).totalTravelKm, 12);
  assert.equal(planningPlanQuality(moreTravel).totalTravelKm, 18);
  assert.ok(comparePlanningPlanQuality(lessTravel, moreTravel) < 0);
});

test('global objective uses the approved 35/20/18/15/7/3/2 priorities', () => {
  assert.deepEqual(GLOBAL_PLANNING_OBJECTIVE_WEIGHTS, {
    recruitmentCoverage: 35,
    newWorkDays: 20,
    continuityGeography: 18,
    travel: 15,
    gaps: 7,
    workloadBalance: 3,
    stability: 2
  });
  assert.equal(Object.values(GLOBAL_PLANNING_OBJECTIVE_WEIGHTS).reduce((sum, value) => sum + value, 0), 100);
  assert.equal(GLOBAL_OPTIMIZATION_MIN_GAIN, 5);
});

test('global objective rewards fewer new work days and more packed continuity', () => {
  const compact = [
    {
      courseId: 'a',
      kind: 'proposal',
      instructorEmpId: '1',
      instructorName: 'מדריך',
      meetings: [{ date: '2026-10-11', start_time: '08:00', end_time: '09:30' }],
      options: [{
        instructorEmpId: '1',
        startDate: '2026-10-11',
        startTime: '08:00',
        planningOptimization: { total: 82 },
        operationalMetrics: {
          continuityMeetingCount: 1,
          sameSchoolMeetingCount: 1,
          sameAuthorityMeetingCount: 1,
          nearbyMeetingCount: 0,
          existingWorkDayMeetingCount: 1,
          newWorkDayMeetingCount: 0,
          relevantTravelDistance: 8
        }
      }]
    },
    {
      courseId: 'b',
      kind: 'proposal',
      instructorEmpId: '1',
      instructorName: 'מדריך',
      meetings: [{ date: '2026-10-11', start_time: '10:00', end_time: '11:30' }],
      options: [{
        instructorEmpId: '1',
        startDate: '2026-10-11',
        startTime: '10:00',
        planningOptimization: { total: 82 },
        operationalMetrics: {
          continuityMeetingCount: 1,
          sameSchoolMeetingCount: 1,
          sameAuthorityMeetingCount: 1,
          nearbyMeetingCount: 0,
          existingWorkDayMeetingCount: 1,
          newWorkDayMeetingCount: 0,
          relevantTravelDistance: 8
        }
      }]
    }
  ];
  const scattered = compact.map((row, index) => ({
    ...row,
    meetings: [{ date: index ? '2026-10-12' : '2026-10-11', start_time: row.meetings[0].start_time, end_time: row.meetings[0].end_time }],
    options: [{
      ...row.options[0],
      operationalMetrics: {
        ...row.options[0].operationalMetrics,
        sameSchoolMeetingCount: 0,
        sameAuthorityMeetingCount: 0,
        existingWorkDayMeetingCount: 0,
        newWorkDayMeetingCount: 1,
        relevantTravelDistance: 6
      }
    }]
  }));
  assert.ok(planningGlobalObjective(compact).total > planningGlobalObjective(scattered).total);
  assert.ok(comparePlanningPlanQuality(compact, scattered) < 0);
});

test('global repair priorities include inefficient planned rows even without recruitment', () => {
  const rows = [
    {
      courseId: 'inefficient',
      kind: 'proposal',
      instructorEmpId: '1',
      options: [{
        instructorEmpId: '1',
        planningOptimization: { total: 55 },
        operationalMetrics: { newWorkDayMeetingCount: 3, relevantTravelDistance: 30 }
      }]
    },
    {
      courseId: 'efficient',
      kind: 'proposal',
      instructorEmpId: '2',
      options: [{
        instructorEmpId: '2',
        planningOptimization: { total: 95 },
        operationalMetrics: { newWorkDayMeetingCount: 0, relevantTravelDistance: 2 }
      }]
    }
  ];
  const ids = planningGlobalRepairPriorityIds(rows);
  assert.equal(ids[0], 'inefficient');
  assert.ok(ids.includes('efficient'));
});

test('global optimizer requires a meaningful gain unless it reduces uncovered work', () => {
  const base = [{
    courseId: 'a',
    kind: 'proposal',
    instructorEmpId: '1',
    instructorName: 'מדריך',
    meetings: [{ date: '2026-10-11', start_time: '08:00', end_time: '09:30' }],
    options: [{
      instructorEmpId: '1',
      planningOptimization: { total: 80 },
      operationalMetrics: { newWorkDayMeetingCount: 1, relevantTravelDistance: 10 }
    }]
  }];
  assert.equal(globalOptimizationImprovesPlan(base, base), false);
  const covered = [{ ...base[0], courseId: 'b' }];
  const uncovered = [{ courseId: 'b', kind: 'recruitment', recruitmentProfileId: 'r1', options: [] }];
  assert.equal(globalOptimizationImprovesPlan(uncovered, covered), true);
});

test('national planning reoptimizes an existing draft before declaring recruitment', async () => {
  const draft = {
    ...baseCourse,
    row_id: 'flex-draft',
    sessions: 2,
    draft_emp_id: '99',
    draft_instructor_name: 'טיוטה ישנה',
    draft_proposed_meetings: [
      { date: '2026-11-01', start_time: '08:00', end_time: '09:30' },
      { date: '2026-11-08', start_time: '08:00', end_time: '09:30' }
    ]
  };
  const result = await buildDynamicCoursePlan({
    activities: [draft],
    instructors: [],
    profiles: {},
    rules: {},
    exceptions: {},
    schoolCalendar: [],
    catalog,
    today: '2026-09-23',
    routeClient: routeClient(null)
  });
  const row = result.rows[0];
  assert.notEqual(row.kind, 'draft');
  assert.equal(row.sourceHadDraft, true);
  assert.equal(row.previousDraftInstructorEmpId, '99');
  assert.deepEqual(row.previousDraftMeetings, draft.draft_proposed_meetings.map((meeting, index) => ({ ...meeting, meeting_no: index + 1 })));
  assert.equal(row.previousDraftInstructorName, 'טיוטה ישנה');
  assert.equal(row.kind, 'recruitment');
  assert.ok(row.startDate);
  assert.ok(row.startTime);
  assert.ok(row.meetings.length > 0);
  assert.match(row.reason, /מיצוי אפשרויות הצוות הקיים/);
});

test('recruitment packing reuses one hiring model for compatible activities instead of one hire per activity', () => {
  const rows = assignRecruitmentProfiles([
    {
      courseId: 'r1', courseName: 'ביומימיקרי', school: 'בית ספר א', authority: 'רחובות',
      kind: 'recruitment', status: 'נדרש גיוס', sessions: 2, requiredLanguage: 'he', requiredGender: 'any',
      scheduleOptions: [
        { startDate: '2026-10-11', endDate: '2026-10-18', startTime: '08:00', endTime: '09:30', meetings: [
          { date: '2026-10-11', start_time: '08:00', end_time: '09:30' },
          { date: '2026-10-18', start_time: '08:00', end_time: '09:30' }
        ] }
      ]
    },
    {
      courseId: 'r2', courseName: 'יישומי AI', school: 'בית ספר ב', authority: 'רחובות',
      kind: 'recruitment', status: 'נדרש גיוס', sessions: 2, requiredLanguage: 'he', requiredGender: 'any',
      scheduleOptions: [
        { startDate: '2026-10-12', endDate: '2026-10-19', startTime: '10:00', endTime: '11:30', meetings: [
          { date: '2026-10-12', start_time: '10:00', end_time: '11:30' },
          { date: '2026-10-19', start_time: '10:00', end_time: '11:30' }
        ] }
      ]
    }
  ]);
  assert.equal(rows[0].recruitmentProfileId, rows[1].recruitmentProfileId);
  assert.equal(rows[0].recruitmentProfileSize, 2);
  assert.equal(rows[1].recruitmentProfileSize, 2);
  assert.ok(rows.every((row) => row.startDate && row.startTime));
});

test('Planning marks recruitment only when no active instructor can satisfy the hard gates', async () => {
  const activity = { ...baseCourse, row_id: 'needs-recruitment', sessions: 2 };
  const result = await buildDynamicCoursePlan({
    activities: [activity],
    instructors: [],
    profiles: {},
    rules: {},
    exceptions: {},
    schoolCalendar: [],
    catalog,
    today: '2026-09-23',
    routeClient: routeClient(null)
  });
  assert.equal(result.rows[0].kind, 'recruitment');
  assert.equal(result.rows[0].status, 'נדרש גיוס');
  assert.ok(result.rows[0].startDate);
  assert.ok(result.rows[0].startTime);
  assert.ok(result.rows[0].meetings.length > 0);
  assert.ok(result.rows[0].recruitmentProfileId);
  assert.match(result.rows[0].reason, /נדרש גיוס/);
  assert.equal(result.recruitment, 1);
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
    date_1: '2026-10-11',
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
    draft_proposed_meetings: [{ date: '2026-10-11', start_time: '08:00', end_time: '09:30' }]
  };
  const first = planningDataFingerprint([draft]);
  const second = planningDataFingerprint([{
    ...draft,
    draft_proposed_meetings: [{ date: '2026-10-18', start_time: '08:00', end_time: '09:30' }]
  }]);
  assert.notEqual(first, second);
});

test('first-half drafts may continue through February without becoming an exception', () => {
  const draft = {
    ...baseCourse,
    row_id: 'draft-february',
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
  assert.equal(row.halfOverflow, false);
  assert.equal(row.continuesIntoFebruary, true);
  assert.match(row.reason, /נמשכת עד 07\/02\/2027 בפברואר/);
  assert.doesNotMatch(planningRowsHtml([row]), /חורגת מתקופת התכנון/);

  const tooLong = buildPlanningOverviewRows({
    activities: [{
      ...draft,
      row_id: 'draft-after-february',
      draft_proposed_meetings: [
        { date: '2026-10-18', start_time: '13:30', end_time: '15:00' },
        { date: '2027-03-07', start_time: '13:30', end_time: '15:00' }
      ]
    }],
    catalog,
    periodKey: 'first'
  })[0];
  assert.equal(tooLong.halfOverflow, true);
  assert.match(tooLong.reason, /מעבר לסוף פברואר/);
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

test('Planning runs behind the single scheduling workboard instead of a separate user tab', async () => {
  const [nav, capabilities, screen, planning] = await Promise.all([
    readFile(new URL('../frontend/src/screens/shared/instructors-workspace-nav.js', import.meta.url), 'utf8'),
    readFile(new URL('../frontend/src/capability-registry.js', import.meta.url), 'utf8'),
    readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8'),
    readFile(new URL('../frontend/src/screens/course-scheduling-planning.js', import.meta.url), 'utf8')
  ]);
  assert.doesNotMatch(nav, /id: 'planning', label: 'תכנון'/);
  assert.doesNotMatch(nav, /courseSchedulingTab = 'planning'/);
  assert.match(capabilities, /id: 'instructors\.planning'[\s\S]*permission: 'view_operations_scheduling'/);
  assert.match(screen, /data-business-status-filter/);
  assert.match(screen, /data-confirm-planning-draft/);
  assert.match(screen, /activeTab\(state\) !== 'maintenance'/);
  assert.match(screen, /data-run-course-planning/);
  assert.match(screen, /reloadSharedPlanningState\(\{ refreshData: false \}\)/);
  assert.match(screen, /courseSchedulingPlanningLocks/);
  assert.match(screen, /proposal_activity_pricing/);
  assert.doesNotMatch(planning, /supabase\.rpc|save_course_assignment|assign_activity_instructor|update\s+public\.activities/i);
});
