import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  calculateCourseSchedule,
  schedulingCourses
} from '../frontend/src/screens/course-scheduling-engine.js';
import {
  SCORE_WEIGHTS,
  assertScoreWeightsTotal,
  computeSchedulingScore,
  courseUrgency,
  analyzeDayPlacement,
  scoreTravelDistance,
  scoreActualWorkload,
  scoreOriginalSchedulePreservation,
  scoreGapsAndNewDays,
  compareCandidatesStable
} from '../frontend/src/screens/course-scheduling-score.js';

const course = (id, date = '2026-09-06', extra = {}) => ({
  row_id: id,
  activity_name: id,
  activity_no: id,
  activity_type: 'קורס',
  activity_season: 'school_2027',
  status: 'פתוח',
  school: `בית ספר ${id}`,
  school_id: `school-${id}`,
  school_address: `רחוב ${id}, חיפה`,
  authority: 'חיפה',
  instruction_language: 'he',
  required_instructor_gender: 'female',
  start_time: '10:00',
  end_time: '11:00',
  meetings: [{ date, start_time: '10:00', end_time: '11:00' }],
  ...extra
});

const instructors = [
  { emp_id: '1', full_name: 'נועה', active: 'yes', address: 'חיפה' },
  { emp_id: '2', full_name: 'דנה', active: 'yes', address: 'חיפה' },
  { emp_id: '3', full_name: 'מיכל', active: 'yes', address: 'חיפה' },
  { emp_id: '4', full_name: 'יעל', active: 'yes', address: 'חיפה' }
];
const profiles = Object.fromEntries(instructors.map((row) => [row.emp_id, {
  gender: 'female',
  instruction_languages: ['he']
}]));
const sundayRules = Object.fromEntries(instructors.map((row) => [row.emp_id, [
  { weekday: 0, available: true, start_time: '08:00', end_time: '16:00' }
]]));

function travelHome(courseId, empId, leg = { distance_km: 5, duration_minutes: 10 }) {
  return { [courseId]: { [empId]: { home: leg, transitions: {} } } };
}

function mergeTravel(...parts) {
  const out = {};
  for (const part of parts) {
    for (const [courseId, byEmp] of Object.entries(part)) {
      out[courseId] = { ...(out[courseId] || {}), ...byEmp };
    }
  }
  return out;
}

function scoreParts(breakdown) {
  return [
    breakdown.continuityEfficiency.points,
    breakdown.travelDistance.points,
    breakdown.actualWorkload.points,
    breakdown.originalSchedulePreservation.points,
    breakdown.gapsAndNewDays.points
  ];
}

test('score weights total 100 and every component stays in range', () => {
  assert.equal(assertScoreWeightsTotal(), true);
  assert.equal(Object.values(SCORE_WEIGHTS).reduce((sum, value) => sum + value, 0), 100);
  const scored = computeSchedulingScore({
    eligible: true,
    activity: course('a'),
    meetings: course('a').meetings,
    existingActivities: [],
    travel: { home: { distance_km: 5, duration_minutes: 10 } },
    workDates: new Set(),
    dateAdjustment: null,
    currentHalfHours: 0,
    projectedHalfHours: 1,
    peerProjectedHours: [1, 2],
    activeWorkDays: 1
  });
  const parts = scoreParts(scored.scoreBreakdown);
  assert.equal(parts.reduce((sum, value) => sum + value, 0), scored.totalScore);
  assert.ok(scored.totalScore >= 0 && scored.totalScore <= 100);
  assert.ok(parts[0] >= 0 && parts[0] <= 35);
  assert.ok(parts[1] >= 0 && parts[1] <= 25);
  assert.ok(parts[2] >= 0 && parts[2] <= 20);
  assert.ok(parts[3] >= 0 && parts[3] <= 15);
  assert.ok(parts[4] >= 0 && parts[4] <= 5);
  assert.deepEqual(Object.keys(scored.scoreBreakdown).sort(), [
    'actualWorkload',
    'continuityEfficiency',
    'gapsAndNewDays',
    'originalSchedulePreservation',
    'travelDistance'
  ]);
});

test('urgency uses first upcoming meeting and ignores past meetings', () => {
  const row = course('u', '2026-09-20', {
    meetings: [
      { date: '2026-08-01', start_time: '10:00', end_time: '11:00' },
      { date: '2026-09-10', start_time: '10:00', end_time: '11:00' },
      { date: '2026-09-17', start_time: '10:00', end_time: '11:00' }
    ]
  });
  const urgency = courseUrgency(row, '2026-09-05');
  assert.equal(urgency.nextUpcomingMeetingDate, '2026-09-10');
  assert.equal(urgency.daysUntilNextMeeting, 5);
  assert.equal(urgency.urgencyBand, 'within_7');
});

test('urgency bands order within_7 before within_14 before later before none', () => {
  const bands = [
    courseUrgency(course('a', '2026-09-08'), '2026-09-05'),
    courseUrgency(course('b', '2026-09-15'), '2026-09-05'),
    courseUrgency(course('c', '2026-10-01'), '2026-09-05'),
    courseUrgency(course('d', '2026-08-01'), '2026-09-05')
  ].map((row) => row.urgencyBand);
  assert.deepEqual(bands, ['within_7', 'within_14', 'later', 'none']);
  assert.ok(courseUrgency(course('a', '2026-09-08'), '2026-09-05').urgencyRank
    < courseUrgency(course('b', '2026-09-15'), '2026-09-05').urgencyRank);
  assert.ok(courseUrgency(course('b', '2026-09-15'), '2026-09-05').urgencyRank
    < courseUrgency(course('c', '2026-10-01'), '2026-09-05').urgencyRank);
});

test('course order: urgency, then fewer eligible, then earlier meeting, then row_id', () => {
  // Sundays: 2026-09-13 (within_14), 2026-09-20 / 2026-09-27 (later)
  const urgent = course('z-urgent', '2026-09-13');
  const scarce = course('b-scarce', '2026-09-20');
  const many = course('a-many', '2026-09-27');
  const tieLow = course('d-tie', '2026-09-27');
  const tieHigh = course('e-tie', '2026-09-27');
  const blockers = [2, 3, 4].map((empId) => course(`approved-block-${empId}`, '2026-09-20', {
    emp_id: String(empId),
    instructor_assignment_locked: true,
    school: 'חוסם',
    school_address: `חוסם ${empId}`
  }));
  const openCourses = [many, scarce, urgent, tieHigh, tieLow];
  const travel = mergeTravel(
    ...openCourses.flatMap((row) => instructors.map((instructor) => travelHome(row.row_id, instructor.emp_id)))
  );
  const ordered = calculateCourseSchedule({
    activities: [...openCourses, ...blockers],
    instructors,
    profiles,
    rules: sundayRules,
    exceptions: {},
    referenceDate: '2026-09-05',
    travel,
    routeMatrix: {}
  });
  const readyIds = ordered.filter((row) => row.status !== 'חסר מידע').map((row) => row.course.row_id);
  assert.deepEqual(readyIds.slice(0, 2), ['z-urgent', 'b-scarce']);
  assert.ok(readyIds.indexOf('a-many') < readyIds.indexOf('d-tie'));
  assert.ok(readyIds.indexOf('d-tie') < readyIds.indexOf('e-tie'));
  assert.equal(ordered.find((row) => row.course.row_id === 'b-scarce').eligibleCandidateCount, 1);
  assert.ok(ordered.find((row) => row.course.row_id === 'a-many').eligibleCandidateCount > 1);
});

test('continuity: same school > same authority > work day; one of ten does not yield 35', () => {
  const meetings = Array.from({ length: 10 }, (_, index) => ({
    date: `2026-09-${String(6 + index * 7).padStart(2, '0')}`,
    start_time: '10:00',
    end_time: '11:00'
  }));
  // Fix dates to valid Sundays-ish sequential weeks starting 2026-09-06
  const tenMeetings = [
    '2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27', '2026-10-04',
    '2026-10-11', '2026-10-18', '2026-10-25', '2026-11-01', '2026-11-08'
  ].map((date) => ({ date, start_time: '10:00', end_time: '11:00' }));
  const activity = course('cont', '2026-09-06', { meetings: tenMeetings, school: 'א', school_id: 's-a', authority: 'חיפה' });
  const sameSchoolNeighbor = {
    date: '2026-09-06', start_time: '08:00', end_time: '09:00',
    school: 'א', school_id: 's-a', authority: 'חיפה'
  };
  const sameAuthorityNeighbor = {
    date: '2026-09-06', start_time: '08:00', end_time: '09:00',
    school: 'ב', school_id: 's-b', authority: 'חיפה'
  };
  const otherWorkDay = {
    date: '2026-09-06', start_time: '08:00', end_time: '09:00',
    school: 'ג', school_id: 's-c', authority: 'תל אביב'
  };
  const schoolScore = analyzeDayPlacement({
    activity,
    meetings: tenMeetings,
    existingActivities: [sameSchoolNeighbor],
    travel: { transitions: { '2026-09-06': { previous: { duration_minutes: 0, distance_km: 0 } } } },
    workDates: new Set()
  });
  const authorityScore = analyzeDayPlacement({
    activity,
    meetings: tenMeetings,
    existingActivities: [sameAuthorityNeighbor],
    travel: { transitions: { '2026-09-06': { previous: { duration_minutes: 30, distance_km: 20 } } } },
    workDates: new Set()
  });
  const workDayScore = analyzeDayPlacement({
    activity,
    meetings: tenMeetings,
    existingActivities: [otherWorkDay],
    travel: { transitions: { '2026-09-06': { previous: { duration_minutes: 40, distance_km: 30 } } } },
    workDates: new Set()
  });
  assert.ok(schoolScore.continuityPoints > authorityScore.continuityPoints);
  assert.ok(authorityScore.continuityPoints > workDayScore.continuityPoints);
  assert.ok(schoolScore.continuityPoints < 35);
  assert.equal(schoolScore.continuityMeetingCount, 10);
  assert.equal(schoolScore.sameSchoolMeetingCount, 1);
  void meetings;
});

test('travel: shorter route scores higher; no invented route; travel is not waiting', () => {
  const short = scoreTravelDistance({ relevantTravelMinutes: 10, relevantTravelDistance: 5, hasKnownRoute: true });
  const long = scoreTravelDistance({ relevantTravelMinutes: 80, relevantTravelDistance: 50, hasKnownRoute: true });
  assert.ok(short.points > long.points);
  assert.equal(scoreTravelDistance({ hasKnownRoute: false }).points, 0);
  const gaps = scoreGapsAndNewDays({
    newWorkDayMeetingCount: 0,
    continuityMeetingCount: 1,
    averageNonTravelWaitingMinutes: 0
  });
  assert.equal(gaps.points, 5);
  const withWaiting = scoreGapsAndNewDays({
    newWorkDayMeetingCount: 0,
    continuityMeetingCount: 1,
    averageNonTravelWaitingMinutes: 60
  });
  assert.ok(withWaiting.points < gaps.points);
});

test('workload uses actual hours including approved, draft, planning state and candidate course', () => {
  const equal = scoreActualWorkload({ projectedHalfHours: 4, peerProjectedHours: [4, 4], currentHalfHours: 3, activeWorkDays: 2 });
  assert.equal(equal.points, 20);
  const low = scoreActualWorkload({ projectedHalfHours: 2, peerProjectedHours: [2, 10], currentHalfHours: 1, activeWorkDays: 1 });
  const high = scoreActualWorkload({ projectedHalfHours: 10, peerProjectedHours: [2, 10], currentHalfHours: 9, activeWorkDays: 3 });
  assert.equal(low.points, 20);
  assert.equal(high.points, 0);

  const openA = course('plan-a', '2026-09-06');
  const openB = course('plan-b', '2026-09-13');
  const approved = course('approved', '2026-09-06', {
    emp_id: '1',
    instructor_assignment_locked: true,
    school: 'א',
    school_id: 'school-plan-a',
    meetings: [{ date: '2026-09-06', start_time: '08:00', end_time: '09:00' }]
  });
  const draft = course('drafted', '2026-09-13', {
    draft_emp_id: '2',
    draft_proposed_meetings: [{ date: '2026-09-13', start_time: '08:00', end_time: '09:00' }],
    school: 'ב',
    school_id: 'school-plan-b'
  });
  assert.deepEqual(schedulingCourses([openA, openB, approved, draft]).map((row) => row.row_id).sort(), ['plan-a', 'plan-b']);
  const travel = mergeTravel(
    travelHome('plan-a', '1'), travelHome('plan-a', '2'), travelHome('plan-a', '3'), travelHome('plan-a', '4'),
    travelHome('plan-b', '1'), travelHome('plan-b', '2'), travelHome('plan-b', '3'), travelHome('plan-b', '4')
  );
  const originalApproved = structuredClone(approved);
  const originalDraft = structuredClone(draft);
  const results = calculateCourseSchedule({
    activities: [openA, openB, approved, draft],
    instructors,
    profiles,
    rules: sundayRules,
    exceptions: {},
    referenceDate: '2026-09-01',
    travel,
    routeMatrix: {}
  });
  assert.deepEqual(approved, originalApproved);
  assert.deepEqual(draft, originalDraft);
  assert.ok(results.every((row) => !['approved', 'drafted'].includes(row.course.row_id)));
  const first = results.find((row) => row.course.row_id === 'plan-a');
  const second = results.find((row) => row.course.row_id === 'plan-b');
  assert.ok(first?.recommended || first?.bestAvailable);
  assert.ok(second);
  // Primary of first course blocks conflicting recommendation on second when same slot/instructor.
  const primaryA = first.recommended || first.bestAvailable;
  const primaryB = second.recommended || second.bestAvailable;
  if (primaryA && primaryB && primaryA.instructor.emp_id === primaryB.instructor.emp_id) {
    assert.notEqual(
      JSON.stringify(primaryA.proposedMeetings || primaryA.periodCourse?.meetings),
      JSON.stringify(primaryB.proposedMeetings || primaryB.periodCourse?.meetings)
    );
  }
});

test('original schedule preservation penalties and eligible date-adjusted candidates', () => {
  assert.equal(scoreOriginalSchedulePreservation(null).points, 15);
  const adjusted = scoreOriginalSchedulePreservation({
    valid: true,
    movedCount: 3,
    exceedsHalf: true,
    meetings: [
      { moved: true, original_date: '2026-09-06', date: '2026-09-20' },
      { moved: true, original_date: '2026-09-13', date: '2026-09-27' },
      { moved: true, original_date: '2026-09-20', date: '2026-10-04' }
    ]
  });
  assert.ok(adjusted.points < 15);
  assert.ok(adjusted.movedMeetingsCount >= 3);
  assert.equal(adjusted.halfOverflow, true);
});

test('sequential planning: primary proposal blocks later course; proposedMeetings used; no DB writes', () => {
  const first = course('first', '2026-09-06', {
    school: 'משותף',
    school_id: 'shared',
    school_address: 'כתובת משותפת',
    meetings: [
      { date: '2026-09-06', start_time: '10:00', end_time: '11:00' },
      { date: '2026-09-13', start_time: '10:00', end_time: '11:00' }
    ]
  });
  const second = course('second', '2026-09-06', {
    school: 'משותף',
    school_id: 'shared',
    school_address: 'כתובת משותפת',
    meetings: [
      { date: '2026-09-06', start_time: '10:00', end_time: '11:00' },
      { date: '2026-09-13', start_time: '10:00', end_time: '11:00' }
    ]
  });
  const activities = [first, second];
  const snapshot = structuredClone(activities);
  const oneInstructor = [instructors[0]];
  const travel = mergeTravel(travelHome('first', '1'), travelHome('second', '1'));
  const results = calculateCourseSchedule({
    activities,
    instructors: oneInstructor,
    profiles: { 1: profiles[1] },
    rules: { 1: sundayRules[1] },
    exceptions: {},
    referenceDate: '2026-09-01',
    travel,
    routeMatrix: {}
  });
  assert.deepEqual(activities, snapshot);
  const firstResult = results.find((row) => row.course.row_id === 'first');
  const secondResult = results.find((row) => row.course.row_id === 'second');
  assert.ok(firstResult.recommended || firstResult.bestAvailable);
  assert.equal(secondResult.recommended, null);
  assert.equal(secondResult.bestAvailable, null);
  assert.ok(['נדרש גיוס', 'נדרש טיפול'].includes(secondResult.status));
});

test('proposedMeetings from primary block the next course instead of original dates', () => {
  const first = course('shift-first', '2026-09-06', {
    meetings: [
      { date: '2026-09-06', start_time: '10:00', end_time: '11:00' },
      { date: '2026-09-13', start_time: '10:00', end_time: '11:00' }
    ]
  });
  const second = course('shift-second', '2026-09-20', {
    meetings: [{ date: '2026-09-20', start_time: '10:00', end_time: '11:00' }]
  });
  const results = calculateCourseSchedule({
    activities: [first, second],
    instructors: [instructors[0]],
    profiles: { 1: profiles[1] },
    rules: { 1: sundayRules[1] },
    exceptions: {
      1: [{ exception_date: '2026-09-06', available: false }]
    },
    referenceDate: '2026-09-01',
    travel: mergeTravel(travelHome('shift-first', '1'), travelHome('shift-second', '1')),
    routeMatrix: {}
  });
  const firstResult = results.find((row) => row.course.row_id === 'shift-first');
  const primary = firstResult.recommended || firstResult.bestAvailable;
  assert.ok(primary?.dateAdjustment?.valid);
  assert.ok(primary.proposedMeetings?.some((meeting) => meeting.date !== '2026-09-06'));
  const secondResult = results.find((row) => row.course.row_id === 'shift-second');
  // Second course on 2026-09-20 may collide with shifted first meeting if first moved onto that date.
  if (primary.proposedMeetings.some((meeting) => meeting.date === '2026-09-20')) {
    assert.equal(secondResult.recommended, null);
    assert.equal(secondResult.bestAvailable, null);
  }
});

test('recommendation threshold, alternatives cap, and no ineligible in selectable slots', () => {
  const target = course('rec', '2026-09-06');
  const travel = mergeTravel(
    travelHome('rec', '1', { distance_km: 1, duration_minutes: 2 }),
    travelHome('rec', '2', { distance_km: 1, duration_minutes: 2 }),
    travelHome('rec', '3', { distance_km: 1, duration_minutes: 2 }),
    travelHome('rec', '4', { distance_km: 1, duration_minutes: 2 })
  );
  const result = calculateCourseSchedule({
    activities: [target],
    instructors,
    profiles,
    rules: sundayRules,
    exceptions: {},
    referenceDate: '2026-09-01',
    travel,
    routeMatrix: {}
  })[0];
  assert.ok(result.alternatives.length <= 3);
  const selectable = [result.recommended, result.bestAvailable, ...result.alternatives].filter(Boolean);
  for (const candidate of selectable) {
    assert.equal(candidate.eligible, true);
  }
  if (result.recommended) {
    assert.ok(result.recommended.score >= 60);
    assert.equal(result.bestAvailable, null);
  } else if (result.bestAvailable) {
    assert.ok(result.bestAvailable.score < 60);
    assert.equal(result.bestAvailable.eligible, true);
  }
  // Alternatives evaluated against stateBeforeCourse: with single course they are simply next ranks.
  assert.deepEqual(
    result.alternatives.map((row) => row.rank),
    result.alternatives.map((_, index) => index + 2)
  );
});

test('stable candidate comparator is deterministic', () => {
  const a = {
    score: 70,
    scoreBreakdown: { continuityEfficiency: { points: 20 }, travelDistance: { points: 10 } },
    projectedHalfHours: 3,
    movedMeetingsCount: 1,
    empId: '2'
  };
  const b = {
    score: 70,
    scoreBreakdown: { continuityEfficiency: { points: 20 }, travelDistance: { points: 10 } },
    projectedHalfHours: 3,
    movedMeetingsCount: 1,
    empId: '1'
  };
  assert.equal(compareCandidatesStable(b, a), -1);
});

test('same input five times yields identical course order, primary, alternatives, scores and proposedMeetings', () => {
  const activities = [
    course('d1', '2026-09-06'),
    course('d2', '2026-09-13'),
    course('d3', '2026-09-20')
  ];
  const travel = mergeTravel(
    ...activities.flatMap((row) => instructors.map((instructor) => travelHome(row.row_id, instructor.emp_id)))
  );
  const input = {
    activities,
    instructors,
    profiles,
    rules: sundayRules,
    exceptions: {},
    referenceDate: '2026-09-01',
    travel,
    routeMatrix: {}
  };
  const runs = Array.from({ length: 5 }, () => calculateCourseSchedule(input));
  const fingerprint = (results) => JSON.stringify(results.map((row) => ({
    id: row.course.row_id,
    status: row.status,
    primary: (row.recommended || row.bestAvailable)?.empId || null,
    score: (row.recommended || row.bestAvailable)?.score ?? null,
    alternatives: row.alternatives.map((candidate) => ({
      empId: candidate.empId,
      score: candidate.score
    })),
    proposed: (row.recommended || row.bestAvailable)?.proposedMeetings || null
  })));
  for (let index = 1; index < runs.length; index += 1) {
    assert.equal(fingerprint(runs[index]), fingerprint(runs[0]));
  }
});

test('stage 3 source has no optimization search machinery', async () => {
  const engine = await readFile(new URL('../frontend/src/screens/course-scheduling-engine.js', import.meta.url), 'utf8');
  const score = await readFile(new URL('../frontend/src/screens/course-scheduling-score.js', import.meta.url), 'utf8');
  const docs = await readFile(new URL('../docs/course-scheduling-smart-logic.md', import.meta.url), 'utf8');
  for (const source of [engine, score, docs]) {
    assert.doesNotMatch(source, /optimizeAssignments|independentCourseComponents|timeBudgetMs|maxNodes|optimizationComplete|assignmentUpperBound|assignmentGap|branch-and-bound|Web Worker|new Worker\b/i);
    assert.doesNotMatch(source, /\bexact optimization\b|\bbounded optimization\b|\bupper bound\b|\bglobal optimization\b/i);
  }
});
