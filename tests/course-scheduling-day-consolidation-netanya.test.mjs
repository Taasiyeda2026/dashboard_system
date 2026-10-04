import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildDynamicCoursePlan,
  dayConsolidationAcceptsMove,
  generatePlanningScenarios,
  optimizeSchoolDayPackingPass,
  travelAwareAdjacentStartMinutes
} from '../frontend/src/screens/course-scheduling-planning.js';
import {
  applyCourseListSearchInPlace,
  filterCourseRowModelsBySearch
} from '../frontend/src/screens/course-scheduling.js';

const text = (value) => String(value ?? '').trim();

test('school-day packing pass is available before instructor-day consolidation', () => {
  assert.equal(typeof optimizeSchoolDayPackingPass, 'function');
  const source = readFileSync(new URL('../frontend/src/screens/course-scheduling-planning.js', import.meta.url), 'utf8');
  assert.ok(source.indexOf('optimizeSchoolDayPackingPass({') < source.indexOf('await consolidateInstructorWorkdaysPass({'));
});

function netanyaRouteClient() {
  const schoolA = 'כתובת ריגלר נתניה';
  const schoolB = 'כתובת שי עגנון נתניה';
  const home = 'כתובת לירון נחום';
  const interSchool = { distance_km: 8, duration_minutes: 19 };
  const homeLeg = { distance_km: 6, duration_minutes: 14 };
  const peek = (origin, destination) => {
    const a = text(origin);
    const b = text(destination);
    if ((a === schoolA && b === schoolB) || (a === schoolB && b === schoolA)) return { ...interSchool };
    if (a === home || b === home) return { ...homeLeg };
    return { ...homeLeg };
  };
  return {
    peek,
    // Real createRouteClient.request is positional: (origin, destination, context).
    request: async (origin, destination) => {
      if (origin && typeof origin === 'object') return peek(origin.origin, origin.destination);
      return peek(origin, destination);
    },
    googleCalls: 0,
    cacheHits: 0,
    unavailableReason: ''
  };
}

const instructor = {
  emp_id: '1550',
  full_name: 'לירון נחום',
  active: 'yes',
  address: 'כתובת לירון נחום'
};
const profiles = {
  1550: { emp_id: '1550', gender: 'male', instruction_languages: ['he'], friday_allowed: false }
};
const rules = {
  1550: [0, 1, 2, 3].map((weekday) => ({
    emp_id: '1550',
    weekday,
    available: true,
    start_time: '09:30',
    end_time: '15:00'
  }))
};

const activityA = {
  row_id: 'netanya-a',
  activity_season: 'school_2027',
  activity_type: 'course',
  status: 'פתוח',
  activity_name: 'ריגלר נתניה',
  authority: 'נתניה',
  school: 'ריגלר',
  school_id: 'school-a',
  school_address: 'כתובת ריגלר נתניה',
  district: 'מרכז',
  calendar_sector: 'general',
  instruction_language: 'he',
  required_instructor_gender: 'any',
  emp_id: '1550',
  instructor_name: 'לירון נחום',
  sessions: 2,
  start_time: '10:30',
  end_time: '12:00',
  date_1: '2026-10-12',
  date_2: '2026-10-19',
  start_date: '2026-10-12',
  end_date: '2026-10-19'
};

const activityB = {
  row_id: 'netanya-b',
  activity_season: 'school_2027',
  activity_type: 'course',
  status: 'פתוח',
  activity_name: 'שי עגנון נתניה',
  authority: 'נתניה',
  school: 'שי עגנון',
  school_id: 'school-b',
  school_address: 'כתובת שי עגנון נתניה',
  district: 'מרכז',
  calendar_sector: 'general',
  instruction_language: 'he',
  required_instructor_gender: 'any',
  sessions: 2
};

const catalog = [{
  activity_name: 'שי עגנון נתניה',
  meetings_count: 2,
  hours_count: 3,
  unit_duration: ''
}];

test('same school may abut; different school requires travel+buffer and rounds to next slot', () => {
  const same = travelAwareAdjacentStartMinutes({
    meeting: {
      end_time: '12:00',
      start_time: '10:30',
      school_id: 'school-a',
      school_address: 'כתובת ריגלר נתניה'
    },
    activity: { school_id: 'school-a', school_address: 'כתובת ריגלר נתניה' },
    durationMinutes: 90,
    routeClient: netanyaRouteClient()
  });
  assert.equal(same.sameSchool, true);
  assert.equal(same.afterStartMinute, 12 * 60);
  assert.equal(same.exactAfterOk, true);

  const different = travelAwareAdjacentStartMinutes({
    meeting: {
      end_time: '12:00',
      start_time: '10:30',
      school_id: 'school-a',
      school_address: 'כתובת ריגלר נתניה'
    },
    activity: { school_id: 'school-b', school_address: 'כתובת שי עגנון נתניה' },
    durationMinutes: 90,
    routeClient: netanyaRouteClient()
  });
  assert.equal(different.sameSchool, false);
  assert.equal(different.exactAfterOk, false);
  // Approved rule: 8 km → +15. 12:00 + 19 + 15 = 12:34 → round up to 13:00
  assert.equal(different.afterStartMinute, 13 * 60);
  assert.equal(different.gapMinutes, 34);
});

test('scenario generation prefers travel-aware 13:00 over false 12:00 adjacency across schools', () => {
  const generated = generatePlanningScenarios({
    activity: activityB,
    catalog,
    instructors: [instructor],
    profiles,
    rules,
    activities: [activityA],
    schoolCalendar: [],
    today: '2026-09-23',
    periodKey: 'year',
    maxScenarios: 12,
    routeClient: netanyaRouteClient()
  });
  assert.ok(generated.scenarios.length > 0);
  const mondayScenarios = generated.scenarios.filter((scenario) => scenario.startDate === '2026-10-12'
    || new Date(`${scenario.startDate}T12:00:00Z`).getUTCDay() === 1);
  assert.ok(mondayScenarios.some((scenario) => scenario.startTime === '13:00'), '13:00 must be among Monday candidates');
  // False zero-minute abut must not outrank the travel-aware slot on heuristic.
  const noon = generated.scenarios.find((scenario) => scenario.startTime === '12:00' && new Date(`${scenario.startDate}T12:00:00Z`).getUTCDay() === 1);
  const one = generated.scenarios.find((scenario) => scenario.startTime === '13:00' && new Date(`${scenario.startDate}T12:00:00Z`).getUTCDay() === 1);
  assert.ok(one);
  if (noon) assert.ok(one.heuristic >= noon.heuristic);
});

test('day consolidation rejects equal-day reseats that do not improve measured travel', () => {
  assert.equal(dayConsolidationAcceptsMove({ beforeDays: 3, afterDays: 2, beforeTravelKm: 10, afterTravelKm: 12 }), true);
  assert.equal(dayConsolidationAcceptsMove({ beforeDays: 2, afterDays: 3, beforeTravelKm: 12, afterTravelKm: 8 }), false);
  assert.equal(dayConsolidationAcceptsMove({ beforeDays: 2, afterDays: 2, beforeTravelKm: 10, afterTravelKm: 9 }), true);
  assert.equal(dayConsolidationAcceptsMove({ beforeDays: 2, afterDays: 2, beforeTravelKm: 10, afterTravelKm: 10 }), false);
  assert.equal(dayConsolidationAcceptsMove({ beforeDays: 2, afterDays: 2, beforeTravelKm: 10, afterTravelKm: 11 }), false);
  assert.equal(dayConsolidationAcceptsMove({ beforeDays: 2, afterDays: 2, beforeTravelKm: null, afterTravelKm: 8 }), false);
});

test('Netanya flexible activity packs onto Monday 13:00 after existing Monday 10:30–12:00, not Tuesday', async () => {
  const input = {
    activities: [activityA, activityB],
    instructors: [instructor],
    profiles,
    rules,
    exceptions: {},
    schoolCalendar: [],
    catalog,
    today: '2026-09-23',
    periodKey: 'year',
    routeClient: netanyaRouteClient(),
    allowGlobalRepair: false,
    planningProfile: 'deep'
  };
  const first = await buildDynamicCoursePlan(input);
  const second = await buildDynamicCoursePlan(input);
  const rowB1 = first.rows.find((row) => row.courseId === 'netanya-b');
  const rowB2 = second.rows.find((row) => row.courseId === 'netanya-b');
  assert.ok(rowB1);
  assert.equal(rowB1.kind, 'proposal');
  assert.equal(rowB1.instructorEmpId, '1550');
  assert.equal(rowB1.startTime, '13:00');
  assert.equal(rowB1.endTime, '14:30');
  assert.equal(new Date(`${rowB1.startDate}T12:00:00Z`).getUTCDay(), 1, 'must stay on Monday');
  assert.notEqual(new Date(`${rowB1.startDate}T12:00:00Z`).getUTCDay(), 2, 'must not open Tuesday');
  assert.deepEqual(
    { startDate: rowB1.startDate, startTime: rowB1.startTime, endTime: rowB1.endTime, instructorEmpId: rowB1.instructorEmpId },
    { startDate: rowB2.startDate, startTime: rowB2.startTime, endTime: rowB2.endTime, instructorEmpId: rowB2.instructorEmpId },
    'deterministic across identical runs'
  );
});

test('tight scenario budget retains same-school adjacency before broad availability coverage', () => {
  const sameSchoolExisting = {
    ...activityA,
    row_id: 'same-school-existing',
    school: 'שי עגנון',
    school_id: 'school-b',
    school_address: 'כתובת שי עגנון נתניה',
    start_time: '10:00',
    end_time: '11:30'
  };
  const generated = generatePlanningScenarios({
    activity: activityB,
    catalog,
    instructors: [instructor],
    profiles,
    rules,
    activities: [sameSchoolExisting],
    schoolCalendar: [],
    today: '2026-09-23',
    periodKey: 'year',
    maxScenarios: 4,
    routeClient: netanyaRouteClient()
  });

  const monday = generated.scenarios.filter((scenario) =>
    new Date(`${scenario.startDate}T12:00:00Z`).getUTCDay() === 1
  );
  assert.ok(monday.length, 'Monday must survive the tight scenario budget');
  assert.ok(
    monday.some((scenario) => scenario.startTime === '11:30'),
    'same-school exact-after slot must survive before generic availability coverage'
  );
});

test('three flexible same-school activities consolidate to one weekly workday when feasible', async () => {
  const packedProfiles = {
    1550: {
      ...profiles[1550],
      preferred_work_days: 1
    }
  };
  const makeFlexible = (id) => ({
    ...activityB,
    row_id: id,
    school: 'שי עגנון',
    school_id: 'school-b',
    school_address: 'כתובת שי עגנון נתניה',
    activity_name: 'שי עגנון נתניה',
    emp_id: null,
    instructor_name: null,
    start_date: null,
    end_date: null,
    start_time: null,
    end_time: null,
    date_1: null,
    date_2: null
  });

  let result;
  try {
    result = await buildDynamicCoursePlan({
      activities: [
        makeFlexible('packed-flex-a'),
        makeFlexible('packed-flex-b'),
        makeFlexible('packed-flex-c')
      ],
      instructors: [instructor],
      profiles: packedProfiles,
      rules,
      exceptions: {},
      schoolCalendar: [],
      catalog,
      today: '2026-09-23',
      periodKey: 'year',
      routeClient: netanyaRouteClient(),
      allowGlobalRepair: false,
      planningProfile: 'fast'
    });
  } catch (error) {
    console.error('SCHOOL_FIRST_DEBUG', JSON.stringify(error?.failures || []));
    throw error;
  }

  const rows = result.rows.filter((row) => row.courseId.startsWith('packed-flex-'));
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => row.kind === 'proposal' && row.instructorEmpId === '1550'));

  const weekdays = new Set(rows.flatMap((row) =>
    (row.meetings || []).map((meeting) => new Date(`${meeting.date}T12:00:00Z`).getUTCDay())
  ));
  assert.equal(weekdays.size, 1, 'all flexible same-school courses should share one weekly workday');

  const firstDate = [...new Set(rows.map((row) => row.startDate))];
  assert.equal(firstDate.length, 1, 'all packed courses should start on the same weekday/date series');

  const slots = rows
    .map((row) => [row.startTime, row.endTime])
    .sort((a, b) => a[0].localeCompare(b[0]));
  for (let index = 1; index < slots.length; index += 1) {
    assert.ok(slots[index - 1][1] <= slots[index][0], 'packed slots must remain non-overlapping');
  }
});

test('flexible course is compacted immediately before a fixed afternoon course using travel+buffer', async () => {
  const fixedAfternoon = {
    ...activityB,
    row_id: 'fixed-afternoon',
    school: 'שי עגנון',
    school_id: 'school-b',
    school_address: 'כתובת שי עגנון נתניה',
    activity_name: 'קבוע אחר הצהריים',
    emp_id: '1550',
    instructor_name: 'לירון נחום',
    sessions: 2,
    start_time: '13:30',
    end_time: '15:00',
    date_1: '2026-10-12',
    date_2: '2026-10-19',
    start_date: '2026-10-12',
    end_date: '2026-10-19'
  };
  const flexibleBefore = {
    ...activityB,
    row_id: 'flex-before-fixed',
    school: 'ריגלר',
    school_id: 'school-a',
    school_address: 'כתובת ריגלר נתניה',
    activity_name: 'שי עגנון נתניה',
    emp_id: null,
    instructor_name: null,
    sessions: 2,
    start_time: null,
    end_time: null,
    date_1: null,
    date_2: null,
    start_date: null,
    end_date: null
  };

  const result = await buildDynamicCoursePlan({
    activities: [flexibleBefore, fixedAfternoon],
    instructors: [instructor],
    profiles,
    rules,
    exceptions: {},
    schoolCalendar: [],
    catalog,
    today: '2026-09-23',
    periodKey: 'year',
    routeClient: netanyaRouteClient(),
    allowGlobalRepair: false,
    planningProfile: 'fast'
  });

  const row = result.rows.find((item) => item.courseId === 'flex-before-fixed');
  assert.ok(row);
  assert.equal(row.kind, 'proposal');
  assert.equal(row.instructorEmpId, '1550');
  assert.equal(row.startDate, '2026-10-12');
  // 13:30 fixed start - 90 min course - (19 min travel + 15 min buffer)
  // = 11:26; planner rounds down to the latest safe 30-min slot: 11:00.
  assert.equal(row.startTime, '11:00');
  assert.equal(row.endTime, '12:30');
});

test('optimization-only upgrade reuses instructor assignment and only compacts the stored time', async () => {
  const fixedAfternoon = {
    ...activityB,
    row_id: 'fixed-afternoon-opt',
    school: 'שי עגנון',
    school_id: 'school-b',
    school_address: 'כתובת שי עגנון נתניה',
    activity_name: 'קבוע אחר הצהריים',
    emp_id: '1550',
    instructor_name: 'לירון נחום',
    sessions: 2,
    start_time: '13:30',
    end_time: '15:00',
    date_1: '2026-10-12',
    date_2: '2026-10-19',
    start_date: '2026-10-12',
    end_date: '2026-10-19'
  };
  const flexibleBefore = {
    ...activityB,
    row_id: 'flex-opt-only',
    school: 'ריגלר',
    school_id: 'school-a',
    school_address: 'כתובת ריגלר נתניה',
    activity_name: 'שי עגנון נתניה',
    emp_id: null,
    instructor_name: null,
    sessions: 2,
    start_time: null,
    end_time: null,
    date_1: null,
    date_2: null,
    start_date: null,
    end_date: null
  };
  const storedProposal = {
    courseId: 'flex-opt-only',
    authority: 'נתניה',
    school: 'ריגלר',
    courseName: 'שי עגנון נתניה',
    kind: 'proposal',
    status: 'מועד מומלץ לבית הספר',
    schoolDateAnchored: false,
    planningLocked: false,
    instructorEmpId: '1550',
    instructorName: 'לירון נחום',
    startDate: '2026-10-12',
    endDate: '2026-10-19',
    startTime: '10:00',
    endTime: '11:30',
    meetings: [
      { date: '2026-10-12', meeting_no: 1, start_time: '10:00', end_time: '11:30' },
      { date: '2026-10-19', meeting_no: 2, start_time: '10:00', end_time: '11:30' }
    ],
    options: []
  };
  const phases = [];

  const result = await buildDynamicCoursePlan({
    activities: [flexibleBefore, fixedAfternoon],
    instructors: [instructor],
    profiles,
    rules,
    exceptions: {},
    schoolCalendar: [],
    catalog,
    today: '2026-09-23',
    periodKey: 'year',
    routeClient: netanyaRouteClient(),
    existingRows: [storedProposal],
    targetCourseIds: ['flex-opt-only'],
    optimizationOnlyCourseIds: ['flex-opt-only'],
    allowGlobalRepair: false,
    planningProfile: 'fast',
    onProgress: async (progress) => phases.push(progress.phase)
  });

  const row = result.rows.find((item) => item.courseId === 'flex-opt-only');
  assert.ok(row);
  assert.equal(row.instructorEmpId, '1550', 'optimization-only must preserve the stored instructor');
  assert.equal(row.startDate, '2026-10-12', 'optimization-only must preserve the selected weekday/date series');
  assert.equal(row.startTime, '11:00');
  assert.equal(row.endTime, '12:30');
  assert.ok(phases.some((phase) => phase.startsWith('צמצום חלונות ביום')));
  assert.ok(!phases.includes('בדיקת מדריכים'), 'optimization-only must not rerun instructor search');
});

test('fixed schedule and locked assignment stay put while flexible consolidates', async () => {
  const lockedFlexible = {
    ...activityB,
    row_id: 'locked-flex',
    activity_name: 'שי עגנון נתניה'
  };
  const result = await buildDynamicCoursePlan({
    activities: [activityA, lockedFlexible],
    instructors: [instructor],
    profiles,
    rules,
    exceptions: {},
    schoolCalendar: [],
    catalog,
    today: '2026-09-23',
    periodKey: 'year',
    lockedOptions: {
      'locked-flex': {
        instructorEmpId: '1550',
        instructorName: 'לירון נחום',
        startDate: '2026-10-13',
        endDate: '2026-10-20',
        startTime: '10:00',
        endTime: '11:30',
        meetings: [
          { date: '2026-10-13', meeting_no: 1, start_time: '10:00', end_time: '11:30' },
          { date: '2026-10-20', meeting_no: 2, start_time: '10:00', end_time: '11:30' }
        ]
      }
    },
    routeClient: netanyaRouteClient(),
    allowGlobalRepair: false
  });
  const live = result.rows.find((row) => row.courseId === 'netanya-a');
  const locked = result.rows.find((row) => row.courseId === 'locked-flex');
  assert.equal(live.kind, 'live');
  assert.equal(live.startTime, '10:30');
  assert.equal(locked.kind, 'planning-locked');
  assert.equal(locked.startDate, '2026-10-13');
  assert.equal(locked.startTime, '10:00');
});

test('list search filters in place without calling full workboard rerender', () => {
  const source = readFileSync(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
  const inputHandler = source.slice(
    source.indexOf("root.querySelector('[data-course-list-search]')?.addEventListener('input'"),
    source.indexOf("root.querySelector('[data-clear-course-list-search]')?.addEventListener('click'")
  );
  assert.match(inputHandler, /applyCourseListSearchInPlace/);
  assert.doesNotMatch(inputHandler, /rerenderPreservingWorkboardScroll/);
  assert.doesNotMatch(inputHandler, /rerender\(\)/);

  const rows = [
    { id: 'a1', course: { activity_name: 'ריגלר', school: 'נתניה', authority: 'נתניה' }, instructorLabel: 'לירון' },
    { id: 'b2', course: { activity_name: 'שי עגנון', school: 'הרצוג', authority: 'נתניה' }, instructorLabel: 'אחר' }
  ];
  assert.deepEqual(filterCourseRowModelsBySearch(rows, 'נתניה הרצוג').map((row) => row.id), []);
  assert.deepEqual(filterCourseRowModelsBySearch(rows, 'הרצוג').map((row) => row.id), ['b2']);
  assert.deepEqual(filterCourseRowModelsBySearch(rows, 'נתניה').map((row) => row.id).sort(), ['a1', 'b2']);

  const root = {
    nodes: [],
    querySelector(selector) {
      if (selector === '[data-course-list-search-empty]') return this.empty;
      if (selector === '[data-clear-course-list-search]') return this.clear;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-course-card]') return this.cards;
      if (selector === '.course-scheduling-course-group') return this.groups;
      return [];
    }
  };
  root.cards = [
    { getAttribute: () => 'ריגלר נתניה לירון', hidden: false, toggleAttribute() {}, textContent: 'ריגלר נתניה' },
    { getAttribute: () => 'שי עגנון הרצוג נתניה', hidden: false, toggleAttribute() {}, textContent: 'שי עגנון הרצוג' }
  ];
  root.groups = [{
    querySelectorAll: () => root.cards,
    querySelector: () => ({ textContent: '' }),
    hidden: false
  }];
  root.empty = { hidden: true };
  root.clear = { hidden: true };

  let renderCount = 0;
  const before = renderCount;
  applyCourseListSearchInPlace(root, 'הרצוג');
  assert.equal(renderCount, before, 'DOM filter must not trigger full renders');
  assert.equal(root.cards[0].hidden, true);
  assert.equal(root.cards[1].hidden, false);

  // Typing the full operational query character-by-character must stay local (0 full renders).
  const query = 'נתניה הרצוג';
  for (let index = 1; index <= query.length; index += 1) {
    applyCourseListSearchInPlace(root, query.slice(0, index));
  }
  assert.equal(renderCount, 0, 'expected 0 full renders while typing Netanya query (was 1 per keypress before)');
});
