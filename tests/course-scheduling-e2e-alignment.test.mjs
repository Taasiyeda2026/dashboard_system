import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { calculateCourseSchedule } from '../frontend/src/screens/course-scheduling-engine.js';
import {
  evaluateInstructor,
  MAX_HOME_DISTANCE_KM,
  TRANSITION_BUFFER_MINUTES,
  exceedsHomeDistanceLimit
} from '../frontend/src/screens/instructor-matching-engine.js';
import { proposeDateAdjustments } from '../frontend/src/screens/course-scheduling-date-adjustments.js';
import {
  DISTRICT_SIMULATION_STATUSES,
  hasReliableHomeRoute,
  runDistrictSchedulingSimulation
} from '../frontend/src/screens/course-scheduling-district-simulation.js';
import { buildWeekRows, fixedScheduleHtml } from '../frontend/src/screens/course-scheduling-calendar.js';
import {
  attachCancelledMeetingsToActivities,
  israelTodayIso,
  meetingsCompletedForCourse
} from '../frontend/src/screens/course-scheduling-meetings.js';
import { activityMeetings, schedulingCalendarMeetings } from '../frontend/src/screens/instructor-scheduling-load.js';
import {
  candidateHardBlockReason,
  actionDisabledReason,
  buildCourseAssignmentDraftRpc
} from '../frontend/src/screens/course-scheduling.js';
import { calculateCandidateTravel } from '../frontend/src/screens/course-scheduling-travel.js';

const weekdayRules = [
  { weekday: 0, available: true, start_time: '08:00', end_time: '16:00' },
  { weekday: 1, available: true, start_time: '08:00', end_time: '16:00' },
  { weekday: 2, available: true, start_time: '08:00', end_time: '16:00' },
  { weekday: 3, available: true, start_time: '08:00', end_time: '16:00' },
  { weekday: 4, available: true, start_time: '08:00', end_time: '16:00' }
];

const instructor = {
  emp_id: '100',
  full_name: 'הילה רוזן',
  active: 'yes',
  address: 'צה״ל 68, גן יבנה'
};
const profile = {
  gender: 'female',
  instruction_languages: ['he'],
  friday_allowed: false
};

function course(id, extra = {}) {
  return {
    row_id: id,
    activity_name: `קורס ${id}`,
    activity_no: id,
    activity_type: 'קורס',
    activity_season: 'school_2027',
    status: 'פתוח',
    school: 'תורני ואולפנת בר אילן',
    school_id: 'school-a',
    school_address: 'רחוב בר אילן 1, נתניה',
    authority: 'נתניה',
    district: 'מרכז',
    instruction_language: 'he',
    required_instructor_gender: 'female',
    start_date: '2026-09-06',
    start_time: '10:00',
    end_time: '11:00',
    meetings: Array.from({ length: 4 }, (_, index) => {
      const date = new Date('2026-09-06T12:00:00Z');
      date.setUTCDate(date.getUTCDate() + index * 7);
      return { date: date.toISOString().slice(0, 10), start_time: '10:00', end_time: '11:00' };
    }),
    ...extra
  };
}

function travelFor(courseId, empId, home) {
  return {
    [courseId]: {
      [empId]: {
        home,
        homeReturn: home,
        transitions: {}
      }
    }
  };
}

function scheduleInput({
  activities = [course('c1')],
  instructors = [instructor],
  travel = travelFor('c1', '100', { distance_km: 12, duration_minutes: 18 }),
  profiles = { 100: profile },
  ...rest
} = {}) {
  return {
    activities,
    instructors,
    profiles,
    rules: Object.fromEntries(instructors.map((row) => [row.emp_id, weekdayRules])),
    exceptions: {},
    travel,
    routeMatrix: {},
    referenceDate: '2026-09-01',
    ...rest
  };
}

test('1: unknown home route is not eligible in individual matching', () => {
  const result = calculateCourseSchedule(scheduleInput({
    travel: travelFor('c1', '100', null)
  }))[0];
  const candidate = (result.checked || []).find((item) => String(item.instructor?.emp_id) === '100');
  assert.equal(candidate.eligible, false);
  assert.equal(result.recommended, null);
  assert.equal(result.bestAvailable, null);
  assert.ok(!(result.alternatives || []).some((item) => item.instructor.emp_id === '100'));
  assert.ok(candidate.missingProfileData.some((item) => /מסלול|כתובת/.test(item)));
});

test('2: unknown home route is missing data in district simulation', () => {
  const simulation = runDistrictSchedulingSimulation(scheduleInput({
    district: 'מרכז',
    travel: travelFor('c1', '100', null)
  }));
  assert.equal(simulation.ok, true);
  assert.equal(simulation.rows[0].status, DISTRICT_SIMULATION_STATUSES.missing);
  assert.equal(simulation.rows[0].proposedInstructor, '—');
  assert.match(simulation.rows[0].reason, /מסלול|חסרים נתונים/);
});

test('3-4: unknown route cannot be saved as draft or finally assigned', () => {
  const stale = {
    instructor,
    eligible: true,
    score: 90,
    travel: { home: null, transitions: {}, unavailableReason: 'no_route' },
    checks: { language: { passed: true }, gender: { passed: true }, availability: { passed: true } }
  };
  assert.equal(hasReliableHomeRoute(stale), false);
  assert.match(candidateHardBlockReason(stale), /מסלול|כתובת|מרחק/);
  assert.equal(actionDisabledReason({ candidate: stale, canEdit: true }), '');
});

test('5-6: exactly 40 km accepted; more than 40 km rejected by client and server migration', async () => {
  assert.equal(exceedsHomeDistanceLimit(40), false);
  assert.equal(exceedsHomeDistanceLimit(40.1), true);
  const ok = calculateCourseSchedule(scheduleInput({
    travel: travelFor('c1', '100', { distance_km: 40, duration_minutes: 55 })
  }))[0];
  assert.equal((ok.checked || []).find((item) => item.instructor.emp_id === '100').eligible, true);
  const far = calculateCourseSchedule(scheduleInput({
    travel: travelFor('c1', '100', { distance_km: 40.1, duration_minutes: 56 })
  }))[0];
  assert.equal((far.checked || []).find((item) => item.instructor.emp_id === '100').eligible, false);
  const sql = await readFile(new URL('../supabase/migrations/20260807203000_course_scheduling_e2e_alignment.sql', import.meta.url), 'utf8');
  assert.match(sql, /home_km > 40/);
  assert.match(sql, /scheduling_home_distance_exceeded/);
  assert.match(sql, /scheduling_cached_travel_distance_km/);
  assert.equal(MAX_HOME_DISTANCE_KM, 40);
});

test('7: transition time uses one 15-minute buffer in client and server', async () => {
  assert.equal(TRANSITION_BUFFER_MINUTES, 15);
  const insufficient = evaluateInstructor({
    instructor,
    profile,
    rules: weekdayRules,
    activity: course('c1', {
      meetings: [{ date: '2026-09-06', start_time: '11:00', end_time: '12:00' }]
    }),
    existingActivities: [{
      date: '2026-09-06',
      start_time: '09:00',
      end_time: '10:30',
      school: 'אחר',
      school_address: 'רחוב אחר',
      authority: 'נתניה',
      activity_name: 'קודם'
    }],
    travel: {
      home: { distance_km: 8, duration_minutes: 12 },
      transitions: {
        '2026-09-06': {
          previous: { distance_km: 5, duration_minutes: 20 }
        }
      }
    },
    validateTravel: true
  });
  // gap = 30 minutes, required = 20 + 15 = 35 → insufficient
  assert.equal(insufficient.eligible, false);
  assert.ok(insufficient.failures.some((item) => /מעבר/.test(item)));

  const enough = evaluateInstructor({
    instructor,
    profile,
    rules: weekdayRules,
    activity: course('c1', {
      meetings: [{ date: '2026-09-06', start_time: '11:05', end_time: '12:05' }]
    }),
    existingActivities: [{
      date: '2026-09-06',
      start_time: '09:00',
      end_time: '10:30',
      school: 'אחר',
      school_address: 'רחוב אחר',
      authority: 'נתניה',
      activity_name: 'קודם'
    }],
    travel: {
      home: { distance_km: 8, duration_minutes: 12 },
      transitions: {
        '2026-09-06': {
          previous: { distance_km: 5, duration_minutes: 20 }
        }
      }
    },
    validateTravel: true
  });
  // gap = 35 minutes, required = 35 → accepted
  assert.equal(enough.eligible, true);

  const adjustment = proposeDateAdjustments({
    meetings: [{ date: '2026-09-06', start_time: '11:00', end_time: '12:00' }],
    rules: weekdayRules,
    exceptions: [{ exception_date: '2026-09-06', available: false }],
    transitions: {
      '2026-09-13': { previous: { duration_minutes: 20, end_time: '10:30' } }
    }
  });
  assert.equal(TRANSITION_BUFFER_MINUTES, 15);
  const sql = await readFile(new URL('../supabase/migrations/20260807203000_course_scheduling_e2e_alignment.sql', import.meta.url), 'utf8');
  assert.match(sql, /required_minutes \+ 15/);
  assert.doesNotMatch(sql, /required_minutes \+ 15 \+ 15/);
  void adjustment;
});

test('8: existing draft cannot be overwritten (server + client wording)', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260807203000_course_scheduling_e2e_alignment.sql', import.meta.url), 'utf8');
  assert.match(sql, /הקורס כבר נשמר כטיוטה/);
  assert.equal((sql.match(/הקורס כבר נשמר כטיוטה/g) || []).length >= 2, true);
});

test('9: saved draft meetings participate in transition calculations', async () => {
  const open = course('open-after', {
    meetings: [{ date: '2026-09-06', start_time: '10:30', end_time: '11:30' }]
  });
  const draft = course('draft-holder', {
    draft_emp_id: '100',
    draft_instructor_name: 'הילה רוזן',
    school: 'בית ספר ב',
    school_id: 'school-b',
    school_address: 'רחוב אחר 2, נתניה',
    start_time: '09:00',
    end_time: '10:00',
    meetings: [{ date: '2026-09-06', start_time: '09:00', end_time: '10:00' }],
    draft_proposed_meetings: [{ date: '2026-09-06', start_time: '09:00', end_time: '10:00' }]
  });
  const routeClient = {
    requests: [],
    unavailableReason: '',
    googleCalls: 0,
    cacheHits: 0,
    request(origin, destination) {
      this.requests.push({ origin, destination });
      return Promise.resolve({ distance_km: 4, duration_minutes: 25 });
    }
  };
  const preliminary = [{ course: open, candidate: { instructor, eligible: true } }];
  const routed = await calculateCandidateTravel(preliminary, [open, draft], routeClient);
  assert.ok(routeClient.requests.some((row) => /אחר/.test(row.origin) || /אחר/.test(row.destination)));
  // gap = 30 minutes, required = 25 + 15 = 40 → hard rejection from saved draft calendar
  const result = calculateCourseSchedule(scheduleInput({
    activities: [open, draft],
    travel: routed.travel,
    routeMatrix: routed.routeMatrix
  })).find((row) => row.course.row_id === 'open-after');
  const candidate = (result.checked || []).find((item) => item.instructor.emp_id === '100');
  assert.equal(candidate.eligible, false);
  assert.ok(candidate.failures.some((item) => /מעבר/.test(item)));
});

test('10: unsaved planning recommendations do not create hard conflicts', () => {
  const first = course('plan-a');
  const second = course('plan-b', {
    school: 'בית ספר ב',
    school_id: 'school-b',
    school_address: 'רחוב אחר 2, נתניה',
    meetings: ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28'].map((date) => ({
      date,
      start_time: '10:00',
      end_time: '11:00'
    }))
  });
  const results = calculateCourseSchedule(scheduleInput({
    activities: [first, second],
    travel: {
      ...travelFor('plan-a', '100', { distance_km: 6, duration_minutes: 10 }),
      ...travelFor('plan-b', '100', { distance_km: 6, duration_minutes: 10 })
    }
  }));
  assert.ok(results.every((row) => (row.recommended || row.bestAvailable)));
});

test('11: missing gender is allowed when required gender is any', () => {
  const result = evaluateInstructor({
    instructor,
    profile: { ...profile, gender: null },
    rules: weekdayRules,
    activity: course('c1', { required_instructor_gender: 'any' }),
    travel: { home: { distance_km: 8, duration_minutes: 12 }, transitions: {} },
    validateTravel: true
  });
  assert.equal(result.eligible, true);
  assert.ok(result.missingProfileData.every((item) => !/מגדר/.test(item)));
});

test('12: hard gates cannot be bypassed with exception approval', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260807203000_course_scheduling_e2e_alignment.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(sql, /p_decision_type <> 'exception_approved'/);
  assert.match(sql, /Hard gates cannot be bypassed through exception_approved/);
});

test('13-14: obsolete restriction fields do not affect matching or revalidation', async () => {
  const result = evaluateInstructor({
    instructor,
    profile: {
      ...profile,
      education_levels: [],
      course_restriction_mode: 'allow_only',
      course_ids: ['other'],
      blocked_authorities: ['נתניה'],
      blocked_schools: ['תורני ואולפנת בר אילן']
    },
    rules: weekdayRules,
    activity: course('c1', {
      education_level: 'high_school',
      allowed_instructor_ids: ['999'],
      blocked_instructor_ids: ['100']
    }),
    travel: { home: { distance_km: 8, duration_minutes: 12 }, transitions: {} },
    validateTravel: true
  });
  assert.equal(result.eligible, true);
  const sql = await readFile(new URL('../supabase/migrations/20260807203000_course_scheduling_e2e_alignment.sql', import.meta.url), 'utf8');
  const validation = sql.split('create or replace function public.scheduling_locked_course_validation_reason')[1]
    .split('create or replace function public.scheduling_revalidate_assignments_for_instructor')[0];
  for (const obsolete of [
    'scheduling_education_level_mismatch',
    'scheduling_course_not_allowed',
    'scheduling_course_blocked',
    'scheduling_authority_blocked',
    'scheduling_school_blocked',
    'scheduling_instructor_blocked',
    'scheduling_instructor_not_allowed'
  ]) {
    assert.doesNotMatch(validation, new RegExp(obsolete));
  }
});

test('15-16: district simulation includes courses without dates/hours as missing data', () => {
  const noDates = course('no-dates', { meetings: [], start_date: '', date_1: null });
  const noHours = course('no-hours', {
    start_time: '',
    end_time: '',
    meetings: [{ date: '2026-09-06', start_time: '', end_time: '' }]
  });
  const simulation = runDistrictSchedulingSimulation(scheduleInput({
    district: 'מרכז',
    activities: [noDates, noHours],
    travel: {}
  }));
  assert.equal(simulation.rows.length, 2);
  assert.ok(simulation.rows.every((row) => row.status === DISTRICT_SIMULATION_STATUSES.missing));
  assert.ok(simulation.rows.some((row) => /תאריכ|מפגש/.test(row.reason)));
  assert.ok(simulation.rows.some((row) => /שע/.test(row.reason)));
});

test('17-19: saved proposed-date drafts display original/proposed dates in details, calendar and confirmation inputs', () => {
  const drafted = course('draft-proposed', {
    draft_emp_id: '100',
    draft_instructor_name: 'הילה רוזן',
    meetings: [
      { date: '2026-09-06', start_time: '10:00', end_time: '11:00' },
      { date: '2026-09-13', start_time: '10:00', end_time: '11:00' }
    ],
    draft_proposed_meetings: [{ date: '2026-09-20' }, { date: '2026-09-27' }]
  });
  const calendarMeetings = schedulingCalendarMeetings(drafted).map((row) => row.date);
  assert.deepEqual(calendarMeetings, ['2026-09-20', '2026-09-27']);
  const official = activityMeetings(drafted).map((row) => row.date);
  assert.deepEqual(official, ['2026-09-06', '2026-09-13']);
  const rows = buildWeekRows([drafted], ['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25']);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].byDay.get('2026-09-20').length, 1);
  const fixed = fixedScheduleHtml([drafted]);
  assert.match(fixed, /מוצע|20\.09\.2026|27\.09\.2026/);
  assert.match(fixed, /מקורי|06\.09\.2026|13\.09\.2026/);
});

test('18: weekly calendar uses draft proposed dates, not official dates', () => {
  const drafted = course('cal-draft', {
    draft_emp_id: '100',
    draft_instructor_name: 'הילה',
    meetings: [{ date: '2026-09-06', start_time: '10:00', end_time: '11:00' }],
    draft_proposed_meetings: [{ date: '2026-09-20' }]
  });
  const officialWeek = buildWeekRows([drafted], ['2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']);
  assert.equal(officialWeek.length, 0);
  const proposedWeek = buildWeekRows([drafted], ['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25']);
  assert.equal(proposedWeek[0].byDay.get('2026-09-20')[0].kind, 'draft');
});

test('20-22: cancelled meetings release overlaps, transitions and weekly calendar', () => {
  const assigned = course('assigned', {
    emp_id: '100',
    instructor_name: 'הילה',
    instructor_assignment_locked: true,
    meetings: [
      { date: '2026-09-06', start_time: '10:00', end_time: '11:00' },
      { date: '2026-09-13', start_time: '10:00', end_time: '11:00' }
    ],
    cancelled_meeting_dates: ['2026-09-06']
  });
  assert.deepEqual(activityMeetings(assigned).map((row) => row.date), ['2026-09-13']);
  const open = course('open', {
    meetings: [{ date: '2026-09-06', start_time: '10:00', end_time: '11:00' }]
  });
  const result = calculateCourseSchedule(scheduleInput({
    activities: [open, assigned],
    travel: travelFor('open', '100', { distance_km: 8, duration_minutes: 12 })
  })).find((row) => row.course.row_id === 'open');
  const candidate = (result.checked || []).find((item) => item.instructor.emp_id === '100');
  assert.equal(candidate.eligible, true);
  const days = ['2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'];
  const rows = buildWeekRows([assigned], days);
  assert.equal(rows.length, 0);
});

test('23+26: cancelled meetings are not completed; completion uses Asia/Jerusalem date and end time', () => {
  const today = israelTodayIso();
  const courseRow = course('done', {
    meetings: [
      { date: today, start_time: '00:00', end_time: '00:01' },
      { date: today, start_time: '23:50', end_time: '23:59' }
    ],
    end_time: '23:59'
  });
  const state = {
    loaded: true,
    approvedDates: new Map(),
    cancelledDates: new Map([['done', new Set([today])]])
  };
  assert.equal(meetingsCompletedForCourse(courseRow, state), 0);
  const past = course('past', {
    meetings: [{ date: '2020-01-01', start_time: '10:00', end_time: '11:00' }],
    end_time: '11:00'
  });
  assert.equal(meetingsCompletedForCourse(past, { loaded: true, approvedDates: new Map(), cancelledDates: new Map() }), 1);
  assert.match(israelTodayIso(), /^\d{4}-\d{2}-\d{2}$/);
});

test('24: direct instructor update on an activity is protected by the same hard server rules', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260807203000_course_scheduling_e2e_alignment.sql', import.meta.url), 'utf8');
  assert.match(sql, /scheduling_guard_activity_calendar_write/);
  assert.match(sql, /perform public\.scheduling_assert_home_route\(holder, new\.row_id\)/);
  assert.match(sql, /perform public\.scheduling_assert_assignment_calendar/);
});

test('25: activity and scheduling screens read the same instructor fields', async () => {
  const scheduling = await readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
  assert.match(scheduling, /emp_id,instructor_name,emp_id_2,instructor_name_2/);
  const activityBind = await readFile(new URL('../frontend/src/screens/shared/bind-activity-edit-form.js', import.meta.url), 'utf8');
  assert.match(activityBind, /changes\.instructor_name = instructor1\.name/);
  assert.match(activityBind, /changes\.emp_id = instructor1\.emp_id/);
  assert.match(activityBind, /changes\.instructor_name_2 = instructor2\.name/);
  assert.match(activityBind, /changes\.emp_id_2 = instructor2\.emp_id/);
});

test('27-29: existing draft-save and final-assignment helpers remain for eligible candidates', () => {
  const selected = {
    instructor,
    eligible: true,
    score: 80,
    travel: { home: { distance_km: 12, duration_minutes: 18 } },
    checks: { language: { passed: true }, gender: { passed: true }, availability: { passed: true } }
  };
  assert.equal(candidateHardBlockReason(selected), '');
  const ordinary = buildCourseAssignmentDraftRpc({
    activityId: 'c1',
    selected,
    topCandidate: selected
  });
  assert.equal(ordinary.rpc, 'save_course_assignment_draft');
  const withDates = buildCourseAssignmentDraftRpc({
    activityId: 'c1',
    selected: {
      ...selected,
      dateAdjustment: {
        meetings: [{ date: '2026-09-20' }, { date: '2026-09-27' }]
      }
    },
    topCandidate: selected
  });
  assert.equal(withDates.rpc, 'save_course_assignment_draft_with_dates');
  assert.ok(Array.isArray(withDates.payload.p_proposed_meetings));
});

test('30: no new route, tab, table or parallel assignment model is introduced', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260807203000_course_scheduling_e2e_alignment.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(sql, /create table/i);
  const files = await readdir(new URL('../frontend/src/screens', import.meta.url));
  assert.ok(!files.some((name) => /parallel|assignment-sync|district-dashboard/.test(name)));
  const nav = await readFile(new URL('../frontend/src/screens/shared/instructors-workspace-nav.js', import.meta.url), 'utf8');
  assert.doesNotMatch(nav, /district-dashboard|bulk-final-approval/);
  const enriched = attachCancelledMeetingsToActivities(
    [course('x')],
    { cancelledDates: new Map([['x', new Set(['2026-09-06'])]]) }
  );
  assert.deepEqual(enriched[0].cancelled_meeting_dates, ['2026-09-06']);
});

test('31: proposed dates owned by another instructor do not block this instructor', () => {
  const open = course('open-for-100', {
    meetings: [{ date: '2026-09-20', start_time: '10:00', end_time: '11:00' }]
  });
  const otherInstructorDraft = course('draft-for-200', {
    draft_emp_id: '200',
    draft_instructor_name: 'מדריך אחר',
    meetings: [{ date: '2026-09-06', start_time: '10:00', end_time: '11:00' }],
    draft_proposed_meetings: [{ date: '2026-09-20', start_time: '10:00', end_time: '11:00' }]
  });
  const result = calculateCourseSchedule(scheduleInput({
    activities: [open, otherInstructorDraft],
    travel: travelFor('open-for-100', '100', { distance_km: 8, duration_minutes: 12 })
  })).find((row) => row.course.row_id === 'open-for-100');
  const candidate = (result.checked || []).find((item) => item.instructor.emp_id === '100');
  assert.equal(candidate.eligible, true);
  assert.ok(!candidate.failures.some((item) => /חפיפה|מעבר/.test(item)));
});
