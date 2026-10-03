import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  TOUR_OPERATIONAL_DURATION_MINUTES,
  TOUR_OPERATIONAL_START_TIME,
  TOUR_OPERATIONAL_END_TIME,
  generatePlanningScenarios,
  buildDynamicCoursePlan,
  inferPlanningCourseSpec,
  optimizeSchoolDayPackingPass,
  validatePlanningPlanCoherence,
  finalValidationRepairCourseIds
} from '../frontend/src/screens/course-scheduling-planning.js';
import { planningEngineUpgradeAffectedCourseIds } from '../frontend/src/screens/course-scheduling-planning-store.js';
import { appendSchedulingRunActivity, prepareSchedulingRunContext } from '../frontend/src/screens/course-scheduling-engine-core.js';
import { transitionDistanceCapApplies } from '../frontend/src/screens/instructor-matching-engine.js';

const instructor = { emp_id: 1550, full_name: 'לירון', active: 'yes', address: 'ראשון לציון' };
const profiles = {
  1550: {
    emp_id: 1550,
    gender: 'female',
    instruction_languages: ['he'],
    preferred_work_days: 3
  }
};
const rules = {
  1550: [0, 1, 2, 3].map((weekday) => ({
    emp_id: 1550,
    weekday,
    available: true,
    start_time: weekday === 1 ? '10:00' : '09:00',
    end_time: '15:00'
  }))
};

function course(id, extras = {}) {
  return {
    row_id: id,
    activity_season: 'school_2027',
    activity_type: 'course',
    status: 'פתוח',
    activity_name: id,
    school: 'בית ספר',
    school_id: 'school-1',
    school_address: 'ראשון לציון',
    authority: 'ראשון לציון',
    calendar_sector: 'jewish',
    instruction_language: 'he',
    required_instructor_gender: 'any',
    sessions: 1,
    ...extras
  };
}

function option(empId, date, start, end) {
  return {
    instructorEmpId: String(empId),
    instructorName: 'לירון',
    startDate: date,
    endDate: date,
    startTime: start,
    endTime: end,
    routeVerified: true,
    meetings: [{ date, start_time: start, end_time: end }]
  };
}

test('13990 scheduling is one operational 09:00-14:00 meeting regardless of 2-hour pricing', () => {
  const activity = course('tour', {
    activity_type: 'tour',
    activity_no: '13990',
    activity_name: 'התנסות בתעשייה',
    sessions: ''
  });
  const catalog = [{ activity_no: '13990', activity_name: 'התנסות בתעשייה', hours_count: 2 }];

  const spec = inferPlanningCourseSpec(activity, catalog);
  assert.equal(spec.sessions, 1);
  assert.equal(spec.durationMinutes, TOUR_OPERATIONAL_DURATION_MINUTES);
  assert.equal(TOUR_OPERATIONAL_START_TIME, '09:00');
  assert.equal(TOUR_OPERATIONAL_END_TIME, '14:00');

  const generated = generatePlanningScenarios({
    activity,
    catalog,
    instructors: [instructor],
    profiles,
    rules,
    activities: [],
    schoolCalendar: [],
    today: '2026-10-01',
    periodKey: 'year',
    maxScenarios: 20
  });
  assert.ok(generated.scenarios.length > 0);
  assert.ok(generated.scenarios.every((scenario) =>
    scenario.startTime === '09:00' && scenario.endTime === '14:00'
  ));
});

test('preferred_work_days is not a planning constraint; weekly availability remains the source of truth', async () => {
  const source = await readFile(new URL('../frontend/src/screens/course-scheduling-planning.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /preferredWorkdayTarget/);
  assert.doesNotMatch(source, /preferred_work_days/);

  const generated = generatePlanningScenarios({
    activity: course('four-days'),
    catalog: [{ activity_name: 'four-days', meetings_count: 1, hours_count: 1.5 }],
    instructors: [instructor],
    profiles,
    rules,
    activities: [],
    schoolCalendar: [],
    today: '2026-10-01',
    periodKey: 'year',
    maxScenarios: 20
  });
  const weekdays = new Set(generated.scenarios.map((scenario) =>
    new Date(`${scenario.startDate}T12:00:00Z`).getUTCDay()
  ));
  assert.ok(weekdays.has(0));
  assert.ok(weekdays.has(1));
  assert.ok(weekdays.has(2));
  assert.ok(weekdays.has(3));
});

test('v25 to v26 forces a real rebuild of every flexible proposal, not only multi-school groups', () => {
  const shared = {
    rows: [
      { activityId: 'a', row: { courseId: 'a', kind: 'proposal', schoolId: 's1' } },
      { activityId: 'b', row: { courseId: 'b', kind: 'proposal', schoolId: 's1' } },
      { activityId: 'c', row: { courseId: 'c', kind: 'proposal', schoolId: 's2' } },
      { activityId: 'locked', lockedOption: { instructorEmpId: '1' }, row: { courseId: 'locked', kind: 'proposal', schoolId: 's3' } },
      { activityId: 'live', row: { courseId: 'live', kind: 'live', schoolId: 's4' } }
    ]
  };
  const ids = planningEngineUpgradeAffectedCourseIds({
    shared,
    activities: [],
    storedEngineVersion: 'planning-v25-20261003-school-packing-option-coverage-self-invalidation',
    currentEngineVersion: 'planning-v26-20261003-coherent-school-first-separate-trip-distance-self-invalidation'
  });
  assert.deepEqual(new Set(ids), new Set(['a', 'b', 'c']));
});

test('school packing discovers a shared weekday that exists only in packingOptions', () => {
  const activities = [course('a'), course('b')];
  const rowsById = new Map([
    ['a', {
      courseId: 'a', schoolId: 'school-1', school: 'בית ספר', kind: 'proposal',
      instructorEmpId: '1550', instructorName: 'לירון',
      startDate: '2026-10-11', startTime: '09:00', endTime: '10:30',
      meetings: [{ date: '2026-10-11', start_time: '09:00', end_time: '10:30' }],
      options: [option(1550, '2026-10-11', '09:00', '10:30')],
      packingOptions: [
        option(1550, '2026-10-11', '09:00', '10:30'),
        option(1550, '2026-10-13', '09:00', '10:30')
      ]
    }],
    ['b', {
      courseId: 'b', schoolId: 'school-1', school: 'בית ספר', kind: 'proposal',
      instructorEmpId: '1550', instructorName: 'לירון',
      startDate: '2026-10-14', startTime: '11:00', endTime: '12:30',
      meetings: [{ date: '2026-10-14', start_time: '11:00', end_time: '12:30' }],
      options: [option(1550, '2026-10-14', '11:00', '12:30')],
      packingOptions: [
        option(1550, '2026-10-14', '11:00', '12:30'),
        option(1550, '2026-10-13', '11:00', '12:30')
      ]
    }]
  ]);

  const result = optimizeSchoolDayPackingPass({ rowsById, activities });
  assert.equal(result.moved, 2);
  assert.equal(rowsById.get('a').startDate, '2026-10-13');
  assert.equal(rowsById.get('b').startDate, '2026-10-13');
  assert.equal(rowsById.get('a').schoolPlanning.minimumFeasibleWeekdays, 1);
  assert.equal(rowsById.get('a').schoolPlanning.packingStatus, 'packed');
});

test('school packing cannot move a school group onto another-school tour day for the same instructor', () => {
  const activities = [
    course('a', { school_id: 'school-a', school_address: 'A' }),
    course('b', { school_id: 'school-a', school_address: 'A' }),
    course('tour-blocker', {
      school_id: 'school-tour',
      school_address: 'TOUR',
      activity_type: 'tour',
      activity_no: '13990',
      activity_name: 'התנסות בתעשייה'
    })
  ];
  const rowsById = new Map([
    ['tour-blocker', {
      courseId: 'tour-blocker',
      schoolId: 'school-tour',
      school: 'סיור',
      kind: 'proposal',
      instructorEmpId: '1550',
      instructorName: 'לירון',
      fullDayBlocking: true,
      startDate: '2026-10-13',
      endDate: '2026-10-13',
      startTime: '09:00',
      endTime: '14:00',
      meetings: [{ date: '2026-10-13', start_time: '09:00', end_time: '14:00' }]
    }],
    ['a', {
      courseId: 'a',
      schoolId: 'school-a',
      school: 'בית ספר א',
      kind: 'proposal',
      instructorEmpId: '1550',
      instructorName: 'לירון',
      startDate: '2026-10-11',
      endDate: '2026-10-11',
      startTime: '09:00',
      endTime: '10:30',
      meetings: [{ date: '2026-10-11', start_time: '09:00', end_time: '10:30' }],
      packingOptions: [
        option(1550, '2026-10-11', '09:00', '10:30'),
        option(1550, '2026-10-13', '09:00', '10:30')
      ]
    }],
    ['b', {
      courseId: 'b',
      schoolId: 'school-a',
      school: 'בית ספר א',
      kind: 'proposal',
      instructorEmpId: '1550',
      instructorName: 'לירון',
      startDate: '2026-10-14',
      endDate: '2026-10-14',
      startTime: '11:00',
      endTime: '12:30',
      meetings: [{ date: '2026-10-14', start_time: '11:00', end_time: '12:30' }],
      packingOptions: [
        option(1550, '2026-10-14', '11:00', '12:30'),
        option(1550, '2026-10-13', '11:00', '12:30')
      ]
    }]
  ]);

  optimizeSchoolDayPackingPass({ rowsById, activities, routeClient: { peek: () => null } });

  assert.notEqual(rowsById.get('a').startDate, '2026-10-13');
  assert.notEqual(rowsById.get('b').startDate, '2026-10-13');
  assert.equal(rowsById.get('a').schoolPlanning.minimumFeasibleWeekdays, 2);
});

test('school packing rejects a cross-school move when cached travel plus buffer does not fit', () => {
  const activities = [
    course('a', { school_id: 'school-a', school_address: 'A' }),
    course('b', { school_id: 'school-a', school_address: 'A' }),
    course('external', { school_id: 'school-b', school_address: 'B' })
  ];
  const rowsById = new Map([
    ['external', {
      courseId: 'external',
      schoolId: 'school-b',
      school: 'בית ספר ב',
      kind: 'proposal',
      instructorEmpId: '1550',
      instructorName: 'לירון',
      startDate: '2026-10-13',
      endDate: '2026-10-13',
      startTime: '12:00',
      endTime: '13:30',
      meetings: [{ date: '2026-10-13', start_time: '12:00', end_time: '13:30' }]
    }],
    ['a', {
      courseId: 'a',
      schoolId: 'school-a',
      school: 'בית ספר א',
      kind: 'proposal',
      instructorEmpId: '1550',
      instructorName: 'לירון',
      startDate: '2026-10-11',
      endDate: '2026-10-11',
      startTime: '09:00',
      endTime: '10:30',
      meetings: [{ date: '2026-10-11', start_time: '09:00', end_time: '10:30' }],
      packingOptions: [
        option(1550, '2026-10-11', '09:00', '10:30'),
        option(1550, '2026-10-13', '10:30', '12:00')
      ]
    }],
    ['b', {
      courseId: 'b',
      schoolId: 'school-a',
      school: 'בית ספר א',
      kind: 'proposal',
      instructorEmpId: '1550',
      instructorName: 'לירון',
      startDate: '2026-10-14',
      endDate: '2026-10-14',
      startTime: '09:00',
      endTime: '10:30',
      meetings: [{ date: '2026-10-14', start_time: '09:00', end_time: '10:30' }],
      packingOptions: [
        option(1550, '2026-10-14', '09:00', '10:30'),
        option(1550, '2026-10-13', '09:00', '10:30')
      ]
    }]
  ]);
  const routeClient = {
    peek(origin, destination) {
      if ((origin === 'A' && destination === 'B') || (origin === 'B' && destination === 'A')) {
        return { distance_km: 8, duration_minutes: 20 };
      }
      return null;
    }
  };

  optimizeSchoolDayPackingPass({ rowsById, activities, routeClient });

  assert.notEqual(rowsById.get('a').startDate, '2026-10-13');
  assert.notEqual(rowsById.get('b').startDate, '2026-10-13');
  assert.equal(rowsById.get('a').schoolPlanning.minimumFeasibleWeekdays, 2);
});

test('final whole-plan validator rejects a tour sharing an instructor date with another proposal', () => {
  const tourActivity = course('tour', {
    activity_type: 'tour',
    activity_no: '13990',
    activity_name: 'התנסות בתעשייה',
    school_id: 'tour-school'
  });
  const otherActivity = course('other', { school_id: 'other-school' });
  const rows = [
    {
      courseId: 'tour', kind: 'proposal', instructorEmpId: '1550', instructorName: 'לירון',
      schoolId: 'tour-school', fullDayBlocking: true,
      startDate: '2026-10-13', endDate: '2026-10-13', startTime: '09:00', endTime: '14:00',
      meetings: [{ date: '2026-10-13', start_time: '09:00', end_time: '14:00' }]
    },
    {
      courseId: 'other', kind: 'proposal', instructorEmpId: '1550', instructorName: 'לירון',
      schoolId: 'other-school',
      startDate: '2026-10-13', endDate: '2026-10-13', startTime: '14:30', endTime: '15:00',
      meetings: [{ date: '2026-10-13', start_time: '14:30', end_time: '15:00' }]
    }
  ];

  const result = validatePlanningPlanCoherence({
    rows,
    activities: [tourActivity, otherActivity],
    instructors: [instructor],
    profiles,
    rules: {
      1550: [{ emp_id: 1550, weekday: 2, available: true, start_time: '09:00', end_time: '16:00' }]
    },
    exceptions: {},
    schoolCalendar: []
  });
  assert.equal(result.valid, false);
  assert.ok(result.failures.some((failure) => failure.reason === 'full_day_tour_conflict'));
});

test('planner context assigns appended substitute meetings to the actual substitute, not the main instructor', () => {
  const activity = course('with-substitute', {
    draft_emp_id: '1550',
    draft_instructor_name: 'לירון',
    meetings: [],
    draft_proposed_meetings: [
      { date: '2027-01-13', start_time: '10:30', end_time: '12:00' },
      { date: '2027-01-20', start_time: '10:30', end_time: '12:00', substituteEmpId: '1549', substituteName: 'נעמה' }
    ]
  });
  const context = prepareSchedulingRunContext({
    activities: [],
    instructors: [
      instructor,
      { emp_id: 1549, full_name: 'נעמה', active: 'yes', address: 'ראשון לציון' }
    ],
    profiles: {
      ...profiles,
      1549: { emp_id: 1549, gender: 'female', instruction_languages: ['he'] }
    },
    rules: {
      ...rules,
      1549: [{ emp_id: 1549, weekday: 3, available: true, start_time: '09:00', end_time: '15:00' }]
    },
    exceptions: {},
    schoolCalendar: [],
    periodKey: 'year'
  });
  appendSchedulingRunActivity(context, activity);

  assert.deepEqual(
    context.assignedMeetingsByInstructor['1550'].map((meeting) => meeting.date),
    ['2027-01-13']
  );
  assert.deepEqual(
    context.assignedMeetingsByInstructor['1549'].map((meeting) => meeting.date),
    ['2027-01-20']
  );
});

test('school packing treats a substitute as the actual instructor for overlap checks', () => {
  const activities = [
    course('space', { school_id: 'herzog' }),
    course('bio', { school_id: 'herzog' })
  ];
  const rowsById = new Map([
    ['space', {
      courseId: 'space', schoolId: 'herzog', school: 'הרצוג', kind: 'proposal',
      instructorEmpId: '1550', instructorName: 'לירון',
      startDate: '2027-01-13', startTime: '10:30', endTime: '12:00',
      meetings: [
        { date: '2027-01-13', start_time: '10:30', end_time: '12:00' },
        { date: '2027-01-20', start_time: '10:30', end_time: '12:00', substituteEmpId: '1549', substituteName: 'נעמה' }
      ],
      options: [option(1550, '2027-01-13', '10:30', '12:00')]
    }],
    ['bio', {
      courseId: 'bio', schoolId: 'herzog', school: 'הרצוג', kind: 'proposal',
      instructorEmpId: '1549', instructorName: 'נעמה',
      startDate: '2027-01-20', startTime: '10:30', endTime: '12:00',
      meetings: [{ date: '2027-01-20', start_time: '10:30', end_time: '12:00' }],
      options: [option(1549, '2027-01-20', '10:30', '12:00')]
    }]
  ]);

  const result = validatePlanningPlanCoherence({
    rows: [...rowsById.values()],
    activities,
    instructors: [
      instructor,
      { emp_id: 1549, full_name: 'נעמה', active: 'yes', address: 'ראשון לציון' }
    ],
    profiles: {
      ...profiles,
      1549: { emp_id: 1549, gender: 'female', instruction_languages: ['he'] }
    },
    rules: {
      ...rules,
      1549: [{ emp_id: 1549, weekday: 3, available: true, start_time: '09:00', end_time: '15:00' }]
    },
    exceptions: {},
    schoolCalendar: []
  });
  assert.equal(result.valid, false);
  assert.ok(result.failures.some((failure) =>
    failure.reason === 'overlap' && failure.empId === '1549' && failure.date === '2027-01-20'
  ));
});

test('20km cap applies only to consecutive transitions up to two hours apart', () => {
  assert.equal(transitionDistanceCapApplies(120), true);
  assert.equal(transitionDistanceCapApplies(121), false);
  assert.equal(transitionDistanceCapApplies(180), false);
});

test('final validator allows a 21km separate trip when a three-hour gap easily covers travel and buffer', () => {
  const activities = [
    course('ashdod', { school_id: '250', school: "מקיף ה' כללי", school_address: 'הרותם 31, אשדוד' }),
    course('shafir', { school_id: '74', school: 'ישיבת אור עציון', school_address: 'מרכז שפירא' })
  ];
  const rows = [
    {
      courseId: 'ashdod', kind: 'fixed-proposal', instructorEmpId: '1502', instructorName: 'אלדר',
      schoolId: '250', school: "מקיף ה' כללי",
      startDate: '2027-02-01', endDate: '2027-02-01', startTime: '08:00', endTime: '09:30',
      meetings: [{ date: '2027-02-01', start_time: '08:00', end_time: '09:30' }]
    },
    {
      courseId: 'shafir', kind: 'proposal', instructorEmpId: '1502', instructorName: 'אלדר',
      schoolId: '74', school: 'ישיבת אור עציון',
      startDate: '2027-02-01', endDate: '2027-02-01', startTime: '12:30', endTime: '14:00',
      meetings: [{ date: '2027-02-01', start_time: '12:30', end_time: '14:00' }]
    }
  ];
  const result = validatePlanningPlanCoherence({
    rows,
    activities,
    instructors: [{ emp_id: 1502, full_name: 'אלדר', active: 'yes', address: 'אשדוד' }],
    profiles: { 1502: { emp_id: 1502, gender: 'male', instruction_languages: ['he'] } },
    rules: { 1502: [{ emp_id: 1502, weekday: 1, available: true, start_time: '08:00', end_time: '15:00' }] },
    exceptions: {},
    schoolCalendar: [],
    routeClient: {
      peek(origin, destination) {
        if ((origin.includes('אשדוד') && destination.includes('שפירא')) || (origin.includes('שפירא') && destination.includes('אשדוד'))) {
          return { distance_km: 21.1, duration_minutes: 24 };
        }
        return null;
      }
    }
  });
  assert.equal(result.valid, true);
  assert.equal(result.failures.length, 0);
});

test('final validator still rejects a 21km consecutive transition when the gap is at most two hours', () => {
  const activities = [
    course('a', { school_id: 'a', school_address: 'A' }),
    course('b', { school_id: 'b', school_address: 'B' })
  ];
  const rows = [
    {
      courseId: 'a', kind: 'proposal', instructorEmpId: '1502', instructorName: 'אלדר',
      schoolId: 'a', startDate: '2027-02-01', endDate: '2027-02-01', startTime: '08:00', endTime: '09:30',
      meetings: [{ date: '2027-02-01', start_time: '08:00', end_time: '09:30' }]
    },
    {
      courseId: 'b', kind: 'proposal', instructorEmpId: '1502', instructorName: 'אלדר',
      schoolId: 'b', startDate: '2027-02-01', endDate: '2027-02-01', startTime: '10:30', endTime: '12:00',
      meetings: [{ date: '2027-02-01', start_time: '10:30', end_time: '12:00' }]
    }
  ];
  const result = validatePlanningPlanCoherence({
    rows,
    activities,
    instructors: [{ emp_id: 1502, full_name: 'אלדר', active: 'yes', address: 'אשדוד' }],
    profiles: { 1502: { emp_id: 1502, gender: 'male', instruction_languages: ['he'] } },
    rules: { 1502: [{ emp_id: 1502, weekday: 1, available: true, start_time: '08:00', end_time: '15:00' }] },
    exceptions: {},
    schoolCalendar: [],
    routeClient: { peek: () => ({ distance_km: 21.1, duration_minutes: 24 }) }
  });
  assert.equal(result.valid, false);
  assert.ok(result.failures.some((failure) => failure.reason === 'transition_distance_exceeded'));
});

test('late overlap is repaired locally from existing rows without rebuilding unrelated rows', async () => {
  const activities = [
    course('repair-a', { school_id: 'repair-school', school: 'בית ספר תיקון' }),
    course('repair-b', { school_id: 'repair-school', school: 'בית ספר תיקון' }),
    course('unrelated-course', { school_id: 'other-school', school: 'בית ספר אחר' })
  ];
  const catalog = activities.map((activity) => ({
    activity_name: activity.activity_name,
    meetings_count: 1,
    hours_count: 1.5
  }));
  const existingRows = [
    {
      courseId: 'repair-a', kind: 'proposal', schoolId: 'repair-school', school: 'בית ספר תיקון',
      instructorEmpId: '1550', instructorName: 'לירון',
      startDate: '2026-10-12', endDate: '2026-10-12', startTime: '10:00', endTime: '11:30',
      meetings: [{ date: '2026-10-12', start_time: '10:00', end_time: '11:30' }],
      options: [option(1550, '2026-10-12', '10:00', '11:30')]
    },
    {
      courseId: 'repair-b', kind: 'proposal', schoolId: 'repair-school', school: 'בית ספר תיקון',
      instructorEmpId: '1550', instructorName: 'לירון',
      startDate: '2026-10-12', endDate: '2026-10-12', startTime: '10:00', endTime: '11:30',
      meetings: [{ date: '2026-10-12', start_time: '10:00', end_time: '11:30' }],
      options: [option(1550, '2026-10-12', '10:00', '11:30')]
    },
    {
      courseId: 'unrelated-course', kind: 'recruitment', schoolId: 'other-school', school: 'בית ספר אחר',
      instructorEmpId: '', instructorName: '', startDate: '2026-10-13', startTime: '09:00', endTime: '10:30',
      meetings: [{ date: '2026-10-13', start_time: '09:00', end_time: '10:30' }],
      options: []
    }
  ];
  const routeClient = {
    googleCalls: 0,
    cacheHits: 0,
    peek: () => ({ distance_km: 0, duration_minutes: 0 }),
    request: async () => ({ calculated: true, distance_km: 0, duration_minutes: 0 })
  };

  const result = await buildDynamicCoursePlan({
    activities,
    instructors: [instructor],
    profiles,
    rules,
    exceptions: {},
    schoolCalendar: [],
    catalog,
    existingRows,
    targetCourseIds: [],
    today: '2026-10-03',
    routeClient,
    allowGlobalRepair: false,
    planningProfile: 'fast'
  });

  assert.equal(result.finalPlanValidation.valid, true);
  const repaired = result.rows.filter((row) => ['repair-a', 'repair-b'].includes(row.courseId));
  assert.equal(repaired.length, 2);
  assert.notDeepEqual(
    repaired.map((row) => [row.startDate, row.startTime]),
    [['2026-10-12', '10:00'], ['2026-10-12', '10:00']]
  );
  assert.equal(result.rows.find((row) => row.courseId === 'unrelated-course')?.kind, 'recruitment');
});

test('final-validation repair scope expands only to direct day/school dependents', () => {
  const rows = [
    {
      courseId: 'a', kind: 'proposal', schoolId: 's1', instructorEmpId: '1',
      meetings: [{ date: '2027-01-10', start_time: '10:00', end_time: '11:30' }]
    },
    {
      courseId: 'b', kind: 'proposal', schoolId: 's2', instructorEmpId: '1',
      meetings: [{ date: '2027-01-10', start_time: '11:00', end_time: '12:30' }]
    },
    {
      courseId: 'school-sibling', kind: 'proposal', schoolId: 's1', instructorEmpId: '2',
      meetings: [{ date: '2027-01-12', start_time: '09:00', end_time: '10:30' }]
    },
    {
      courseId: 'unrelated', kind: 'proposal', schoolId: 's9', instructorEmpId: '9',
      meetings: [{ date: '2027-01-13', start_time: '09:00', end_time: '10:30' }]
    }
  ];
  const ids = finalValidationRepairCourseIds([
    { reason: 'overlap', empId: '1', date: '2027-01-10', firstCourseId: 'a', secondCourseId: 'b' }
  ], rows);
  assert.deepEqual(new Set(ids), new Set(['a', 'b', 'school-sibling']));
  assert.equal(ids.includes('unrelated'), false);
});

test('planner source checkpoints global stages and attempts bounded local final repair before throwing', async () => {
  const source = await readFile(new URL('../frontend/src/screens/course-scheduling-planning.js', import.meta.url), 'utf8');
  assert.match(source, /אריזת בתי ספר הושלמה[\s\S]*snapshotRows/);
  assert.match(source, /ריכוז ימי עבודה הושלם/);
  assert.match(source, /צמצום חלונות הושלם/);
  assert.match(source, /בקרת תקינות סופית/);
  assert.match(source, /_finalValidationRepairPass < 2/);
  assert.match(source, /targetCourseIds: repairIds/);
  assert.match(source, /allowGlobalRepair: false/);
});

test('v26 migration tracks packing options, expands school invalidation, ignores preferred_work_days, and rebuilds proposals', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20261003170000_planning_v26_coherent_school_first.sql', import.meta.url), 'utf8');
  assert.match(sql, /row_data->'packingOptions'/);
  assert.match(sql, /schoolId/);
  assert.match(sql, /scheduling_tour_operational_hours_required/);
  assert.match(sql, /09:00/);
  assert.match(sql, /14:00/);
  assert.match(sql, /coalesce\(r\.row_data->>'kind', ''\) = 'proposal'/);
  const profileTrigger = sql.slice(sql.indexOf('create or replace function public.scheduling_invalidate_planning_after_scheduling_profile'));
  assert.doesNotMatch(profileTrigger, /preferred_work_days/);
});

test('progress reports processed rows rather than number of moves', async () => {
  const source = await readFile(new URL('../frontend/src/screens/course-scheduling-planning.js', import.meta.url), 'utf8');
  assert.match(source, /processedThisPass \+= 1;[\s\S]*ריכוז ימי עבודה · סבב/);
  assert.match(source, /processedThisPass \+= 1;[\s\S]*צמצום חלונות ביום · סבב/);
  assert.doesNotMatch(source, /report\('צמצום חלונות ביום', moved,/);
});
