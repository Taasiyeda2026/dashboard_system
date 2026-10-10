import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDynamicCoursePlan } from '../frontend/src/screens/course-scheduling-planning.js';
import { createRouteClient } from '../frontend/src/screens/course-scheduling-travel.js';
import { compareOperationalQuality, operationalQuality } from '../frontend/src/screens/scheduling-core/quality.js';
import { compileConstraints } from '../frontend/src/screens/scheduling-core/constraints.js';

const points = ['home1550', 'agnon', 'barilan'];
const routeClient = createRouteClient({
  preloadedRows: points.flatMap((origin) => points.filter((destination) => destination !== origin).map((destination) => ({
    origin_key: origin,
    destination_key: destination,
    distance_km: (origin === 'agnon' && destination === 'barilan') || (origin === 'barilan' && destination === 'agnon') ? 12 : 6,
    duration_minutes: (origin === 'agnon' && destination === 'barilan') || (origin === 'barilan' && destination === 'agnon') ? 25 : 14
  }))),
  invoke: async () => ({ data: { calculated: false }, error: null })
});

const instructor = { emp_id: '1550', full_name: 'Liron', active: 'yes', address: 'home1550' };
const profiles = { 1550: { emp_id: '1550', gender: 'male', instruction_languages: ['he'], friday_allowed: false } };
const rules = {
  1550: [
    { emp_id: '1550', weekday: 0, available: true, start_time: '09:30', end_time: '14:00' },
    { emp_id: '1550', weekday: 1, available: true, start_time: '10:00', end_time: '15:00' },
    { emp_id: '1550', weekday: 2, available: true, start_time: '09:30', end_time: '15:00' },
    { emp_id: '1550', weekday: 3, available: true, start_time: '09:30', end_time: '15:00' }
  ]
};

const flexAtAgnon = (id, activityName) => ({
  row_id: id,
  activity_season: 'school_2027',
  activity_type: 'course',
  status: 'פתוח',
  activity_name: activityName,
  authority: 'נתניה',
  school: 'עירוני מקיף שי עגנון',
  school_id: '443',
  school_address: 'agnon',
  district: 'מרכז',
  calendar_sector: 'general',
  instruction_language: 'he',
  required_instructor_gender: 'any',
  sessions: 4,
  start_time: null,
  end_time: null,
  date_1: null,
  start_date: null,
  end_date: null
});

const liveMondayElsewhere = {
  row_id: 'live-barilan',
  activity_season: 'school_2027',
  activity_type: 'course',
  status: 'פתוח',
  activity_name: 'בינה מלאכותית',
  authority: 'נתניה',
  school: "תורני ואולפ' בר אילן",
  school_id: '537',
  school_address: 'barilan',
  district: 'מרכז',
  calendar_sector: 'jewish',
  instruction_language: 'he',
  required_instructor_gender: 'any',
  sessions: 4,
  emp_id: '1550',
  instructor_name: 'Liron',
  instructor_assignment_locked: true,
  start_time: '13:30',
  end_time: '15:00',
  date_1: '2026-11-02',
  date_2: '2026-11-09',
  date_3: '2026-11-16',
  date_4: '2026-11-23',
  start_date: '2026-11-02',
  end_date: '2026-11-23'
};

function weekdaysOf(row) {
  return new Set((row?.meetings || []).map((meeting) => new Date(`${meeting.date}T12:00:00Z`).getUTCDay()));
}

test('same-school consecutive packing outranks idle waiting in the operational objective', () => {
  const split = {
    covered: 2,
    meetingHours: 6,
    splitDays: 0,
    waitingMinutes: 0,
    sameSchoolSequences: 0,
    sameAuthoritySequences: 0,
    nearbySequences: 0,
    unknownRouteLegs: 0,
    totalTravelMinutes: 40,
    totalTravelKm: 20,
    operationalScoreSum: 100
  };
  const consolidated = {
    ...split,
    waitingMinutes: 15,
    sameSchoolSequences: 14,
    totalTravelMinutes: 20,
    totalTravelKm: 10
  };
  assert.ok(
    compareOperationalQuality(consolidated, split) > 0,
    'a modest wait on one school day must not beat two separate school visits'
  );
  assert.ok(compareOperationalQuality({ ...split, covered: 1 }, split) < 0);
  assert.ok(compareOperationalQuality({ ...split, meetingHours: 5 }, split) < 0);
});

test('two flexible same-school courses of different programs share one weekday when feasible', async () => {
  const plan = await buildDynamicCoursePlan({
    activities: [
      flexAtAgnon('portzot-a', 'פורצות דרך'),
      flexAtAgnon('portzot-b', 'מנהיגות דיגיטלית'),
      liveMondayElsewhere
    ],
    instructors: [instructor],
    profiles,
    rules,
    exceptions: {},
    schoolCalendar: [],
    catalog: [
      { activity_name: 'פורצות דרך', meetings_count: 4, hours_count: 6 },
      { activity_name: 'מנהיגות דיגיטלית', meetings_count: 4, hours_count: 6 },
      { activity_name: 'בינה מלאכותית', meetings_count: 4, hours_count: 6 }
    ],
    today: '2026-10-09',
    periodKey: 'year',
    routeClient,
    allowGlobalRepair: false,
    planningProfile: 'fast'
  });

  const a = plan.rows.find((row) => row.courseId === 'portzot-a');
  const b = plan.rows.find((row) => row.courseId === 'portzot-b');
  assert.equal(a?.kind, 'proposal');
  assert.equal(b?.kind, 'proposal');
  assert.equal(a.instructorEmpId, '1550');
  assert.equal(b.instructorEmpId, '1550');
  const days = new Set([...weekdaysOf(a), ...weekdaysOf(b)]);
  assert.equal(days.size, 1, 'different programs at the same school still consolidate to one weekday');
  assert.equal(plan.finalPlanValidation.valid, true);
});

test('anchored official weekday cannot be moved just to pack same-school continuity', async () => {
  const anchoredMonday = {
    ...flexAtAgnon('anchored-a', 'פורצות דרך'),
    sessions: 2,
    start_time: '10:30',
    end_time: '12:00',
    date_1: '2026-10-12',
    date_2: '2026-10-19',
    start_date: '2026-10-12',
    end_date: '2026-10-19'
  };
  const flexibleWednesday = flexAtAgnon('flex-b', 'מנהיגות דיגיטלית');
  flexibleWednesday.sessions = 2;

  const plan = await buildDynamicCoursePlan({
    activities: [anchoredMonday, flexibleWednesday],
    instructors: [instructor],
    profiles,
    rules,
    exceptions: {},
    schoolCalendar: [],
    catalog: [
      { activity_name: 'פורצות דרך', meetings_count: 2, hours_count: 3 },
      { activity_name: 'מנהיגות דיגיטלית', meetings_count: 2, hours_count: 3 }
    ],
    today: '2026-10-09',
    periodKey: 'year',
    routeClient,
    allowGlobalRepair: false,
    skipSoftOptimization: true,
    planningProfile: 'fast'
  });

  const anchored = plan.rows.find((row) => row.courseId === 'anchored-a');
  assert.equal(anchored.meetings[0].date, '2026-10-12');
  assert.equal(anchored.startTime, '10:30');
  assert.equal(plan.finalPlanValidation.valid, true);
});

test('soft optimization consolidates an already-split same-school pair and improves measured quality', async () => {
  const mkMeetings = (startDate, start, end, count = 4) => {
    const meetings = [];
    let cursor = new Date(`${startDate}T12:00:00Z`);
    while (meetings.length < count) {
      meetings.push({
        date: cursor.toISOString().slice(0, 10),
        start_time: start,
        end_time: end,
        meeting_no: meetings.length + 1
      });
      cursor = new Date(cursor.getTime() + 7 * 86400000);
    }
    return meetings;
  };

  const input = {
    activities: [
      flexAtAgnon('portzot-a', 'פורצות דרך'),
      flexAtAgnon('portzot-b', 'מנהיגות דיגיטלית'),
      liveMondayElsewhere
    ],
    instructors: [instructor],
    profiles,
    rules,
    exceptions: {},
    schoolCalendar: [],
    catalog: [
      { activity_name: 'פורצות דרך', meetings_count: 4, hours_count: 6 },
      { activity_name: 'מנהיגות דיגיטלית', meetings_count: 4, hours_count: 6 },
      { activity_name: 'בינה מלאכותית', meetings_count: 4, hours_count: 6 }
    ],
    today: '2026-10-09',
    periodKey: 'year',
    routeClient,
    allowGlobalRepair: false,
    planningProfile: 'fast'
  };

  const seed = await buildDynamicCoursePlan({ ...input, skipSoftOptimization: true });
  const mon = mkMeetings('2026-10-12', '10:30', '12:00');
  const wed = mkMeetings('2026-10-14', '12:00', '13:30');
  const splitRows = seed.rows.map((row) => {
    if (row.courseId === 'portzot-a') {
      return {
        ...row,
        kind: 'proposal',
        instructorEmpId: '1550',
        instructorName: 'Liron',
        meetings: mon,
        startDate: mon[0].date,
        endDate: mon.at(-1).date,
        startTime: '10:30',
        endTime: '12:00',
        schoolDateAnchored: false
      };
    }
    if (row.courseId === 'portzot-b') {
      return {
        ...row,
        kind: 'proposal',
        instructorEmpId: '1550',
        instructorName: 'Liron',
        meetings: wed,
        startDate: wed[0].date,
        endDate: wed.at(-1).date,
        startTime: '12:00',
        endTime: '13:30',
        schoolDateAnchored: false
      };
    }
    return row;
  });

  const context = compileConstraints(input);
  const before = operationalQuality(splitRows, input, context);
  const improved = await buildDynamicCoursePlan({
    ...input,
    existingRows: splitRows,
    committedRows: splitRows.filter((row) => row.courseId === 'live-barilan'),
    targetCourseIds: ['portzot-a', 'portzot-b'],
    allowGlobalRepair: false
  });
  const after = improved.quality || operationalQuality(improved.rows, input, context);
  const a = improved.rows.find((row) => row.courseId === 'portzot-a');
  const b = improved.rows.find((row) => row.courseId === 'portzot-b');
  const days = new Set([...weekdaysOf(a), ...weekdaysOf(b)]);

  assert.equal(before.sameSchoolSequences, 0);
  assert.ok(after.sameSchoolSequences > before.sameSchoolSequences);
  assert.ok(compareOperationalQuality(after, before) > 0);
  assert.equal(days.size, 1);
  assert.equal(improved.finalPlanValidation.valid, true);
});
