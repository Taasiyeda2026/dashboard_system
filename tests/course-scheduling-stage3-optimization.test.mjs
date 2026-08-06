import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCORE_WEIGHTS,
  assertScoreWeightsTotal,
  computeSchedulingScore,
  courseUrgency,
  compareOptimizationStates,
  scoreTravelDistance,
  scoreOriginalSchedulePreservation,
  scoreGapsAndNewDays
} from '../frontend/src/screens/course-scheduling-score.js';
import { calculateCourseSchedule, schedulingCourses } from '../frontend/src/screens/course-scheduling-engine.js';
import { evaluateInstructor, schedulingQualityBand } from '../frontend/src/screens/instructor-matching-engine.js';
import { routeMatrixKey } from '../frontend/src/screens/course-scheduling-travel.js';

const instructor = (id, name = `מדריך ${id}`) => ({ emp_id: String(id), full_name: name, active: 'yes', address: `כתובת ${id}` });
const profile = (extra = {}) => ({ gender: 'female', instruction_languages: ['he'], friday_allowed: false, ...extra });
const sundayRules = [{ weekday: 0, available: true, start_time: '08:00', end_time: '16:00' }];
const multiDayRules = [
  { weekday: 0, available: true, start_time: '08:00', end_time: '16:00' },
  { weekday: 1, available: true, start_time: '08:00', end_time: '16:00' },
  { weekday: 2, available: true, start_time: '08:00', end_time: '16:00' }
];

const course = (id, date = '2026-09-06', extra = {}) => ({
  row_id: id,
  activity_name: id,
  activity_type: 'קורס',
  activity_season: 'school_2027',
  status: 'פתוח',
  school: `בית ספר ${id}`,
  school_id: id,
  school_address: `כתובת בית ספר ${id}`,
  authority: 'רשות א',
  instruction_language: 'he',
  required_instructor_gender: 'female',
  start_time: '10:00',
  end_time: '11:00',
  meetings: [{ date, start_time: '10:00', end_time: '11:00' }],
  date_1: date,
  ...extra
});

const homeTravel = (courseId, empId, distance_km = 5, duration_minutes = 10) => ({
  [courseId]: { [empId]: { home: { distance_km, duration_minutes } } }
});

test('score weights total exactly 100 and every component stays in range', () => {
  assert.equal(assertScoreWeightsTotal(), true);
  assert.equal(SCORE_WEIGHTS.continuityEfficiency, 35);
  assert.equal(SCORE_WEIGHTS.travelDistance, 25);
  assert.equal(SCORE_WEIGHTS.actualWorkload, 20);
  assert.equal(SCORE_WEIGHTS.originalSchedulePreservation, 15);
  assert.equal(SCORE_WEIGHTS.gapsAndNewDays, 5);

  const scored = computeSchedulingScore({
    eligible: true,
    activity: course('w'),
    meetings: course('w').meetings,
    existingActivities: [],
    travel: { home: { distance_km: 3, duration_minutes: 6 }, transitions: {} },
    currentHalfHours: 0,
    projectedHalfHours: 1,
    peerProjectedHours: [1, 8],
    activeWorkDays: 1
  });
  const b = scored.scoreBreakdown;
  assert.ok(b.continuityEfficiency.points >= 0 && b.continuityEfficiency.points <= 35);
  assert.ok(b.travelDistance.points >= 0 && b.travelDistance.points <= 25);
  assert.ok(b.actualWorkload.points >= 0 && b.actualWorkload.points <= 20);
  assert.ok(b.originalSchedulePreservation.points >= 0 && b.originalSchedulePreservation.points <= 15);
  assert.ok(b.gapsAndNewDays.points >= 0 && b.gapsAndNewDays.points <= 5);
  assert.equal(
    b.continuityEfficiency.points + b.travelDistance.points + b.actualWorkload.points
      + b.originalSchedulePreservation.points + b.gapsAndNewDays.points,
    scored.score
  );
  assert.ok(scored.score >= 0 && scored.score <= 100);
  assert.equal(computeSchedulingScore({ eligible: false }).score, null);
});

test('continuity prefers same school over same authority over new work day', () => {
  const target = course('cont', '2026-09-06', { school: 'בית ספר א', school_id: 'a', authority: 'רשות א' });
  const sameSchool = evaluateInstructor({
    instructor: instructor(1),
    profile: profile(),
    rules: sundayRules,
    activity: target,
    existingActivities: [{ date: '2026-09-06', start_time: '08:00', end_time: '09:30', school: 'בית ספר א', school_id: 'a', authority: 'רשות א' }],
    travel: { home: { distance_km: 4, duration_minutes: 8 }, transitions: { '2026-09-06': { previous: { distance_km: 0, duration_minutes: 0 } } } }
  });
  const sameAuthority = evaluateInstructor({
    instructor: instructor(1),
    profile: profile(),
    rules: sundayRules,
    activity: target,
    existingActivities: [{ date: '2026-09-06', start_time: '08:00', end_time: '09:30', school: 'בית ספר ב', school_id: 'b', authority: 'רשות א' }],
    travel: { home: { distance_km: 4, duration_minutes: 8 }, transitions: { '2026-09-06': { previous: { distance_km: 2, duration_minutes: 8 } } } }
  });
  const newDay = evaluateInstructor({
    instructor: instructor(1),
    profile: profile(),
    rules: sundayRules,
    activity: target,
    existingActivities: [],
    travel: { home: { distance_km: 4, duration_minutes: 8 }, transitions: {} }
  });
  assert.ok(sameSchool.scoreBreakdown.continuityEfficiency.points > sameAuthority.scoreBreakdown.continuityEfficiency.points);
  assert.ok(sameAuthority.scoreBreakdown.continuityEfficiency.points > newDay.scoreBreakdown.continuityEfficiency.points);
  assert.equal(sameSchool.hasSameSchoolDay, true);
  assert.equal(newDay.opensNewWorkDay, true);
});

test('small gap continuity beats large gap; overlap and impossible transition stay disqualifying', () => {
  const target = course('gap', '2026-09-06', { school: 'בית ספר א', school_id: 'a', authority: 'רשות א', start_time: '12:00', end_time: '13:00', meetings: [{ date: '2026-09-06', start_time: '12:00', end_time: '13:00' }] });
  const tight = evaluateInstructor({
    instructor: instructor(1), profile: profile(), rules: sundayRules, activity: target,
    existingActivities: [{ date: '2026-09-06', start_time: '10:00', end_time: '11:30', school: 'בית ספר א', school_id: 'a', authority: 'רשות א' }],
    travel: { home: { distance_km: 1, duration_minutes: 2 }, transitions: { '2026-09-06': { previous: { distance_km: 0, duration_minutes: 0 } } } }
  });
  const loose = evaluateInstructor({
    instructor: instructor(1), profile: profile(), rules: sundayRules, activity: target,
    existingActivities: [{ date: '2026-09-06', start_time: '08:00', end_time: '09:00', school: 'בית ספר א', school_id: 'a', authority: 'רשות א' }],
    travel: { home: { distance_km: 1, duration_minutes: 2 }, transitions: { '2026-09-06': { previous: { distance_km: 0, duration_minutes: 0 } } } }
  });
  assert.ok(tight.scoreBreakdown.continuityEfficiency.points >= loose.scoreBreakdown.continuityEfficiency.points);
  const overlap = evaluateInstructor({
    instructor: instructor(1), profile: profile(), rules: sundayRules, activity: target,
    existingActivities: [{ date: '2026-09-06', start_time: '11:30', end_time: '12:30', school: 'אחר', activity_name: 'חוסם' }],
    travel: { home: { distance_km: 1, duration_minutes: 2 }, transitions: {} }
  });
  assert.equal(overlap.eligible, false);
  assert.equal(overlap.score, null);
  const impossible = evaluateInstructor({
    instructor: instructor(1), profile: profile(), rules: sundayRules, activity: target,
    existingActivities: [{ date: '2026-09-06', start_time: '10:00', end_time: '11:50', school: 'אחר' }],
    travel: { home: { distance_km: 1, duration_minutes: 2 }, transitions: { '2026-09-06': { previous: { distance_km: 20, duration_minutes: 40 } } } }
  });
  assert.equal(impossible.eligible, false);
});

test('travel scoring prefers short routes, uses previous activity instead of home, and checks next leg mid-day', () => {
  const short = scoreTravelDistance({ relevantTravelMinutes: 10, relevantTravelDistance: 4, hasKnownRoute: true });
  const long = scoreTravelDistance({ relevantTravelMinutes: 80, relevantTravelDistance: 55, hasKnownRoute: true });
  assert.ok(short.points > long.points);
  assert.ok(long.points >= 0);
  assert.equal(scoreTravelDistance({ unknownRoute: true, hasKnownRoute: false }).points, 0);

  const target = course('travel', '2026-09-06', { school: 'יעד', school_address: 'יעד 1', start_time: '11:00', end_time: '12:00', meetings: [{ date: '2026-09-06', start_time: '11:00', end_time: '12:00' }] });
  const fromPrevious = evaluateInstructor({
    instructor: instructor(1), profile: profile(), rules: sundayRules, activity: target,
    existingActivities: [
      { date: '2026-09-06', start_time: '08:00', end_time: '09:00', school: 'קודם', school_address: 'קודם 1' },
      { date: '2026-09-06', start_time: '13:30', end_time: '14:30', school: 'הבא', school_address: 'הבא 1' }
    ],
    travel: {
      home: { distance_km: 40, duration_minutes: 70 },
      transitions: {
        '2026-09-06': {
          previous: { distance_km: 3, duration_minutes: 8 },
          next: { distance_km: 4, duration_minutes: 9 }
        }
      }
    }
  });
  assert.ok(fromPrevious.relevantTravelMinutes >= 17);
  assert.ok(fromPrevious.relevantTravelMinutes < 70, 'must not also charge the home leg when arriving from a previous activity');
  assert.ok(fromPrevious.nonTravelWaitingMinutes >= 0);
  assert.ok(fromPrevious.scoreBreakdown.travelDistance.duration_minutes !== 70 + 15);
});

test('unknown route is not a safe recommendation and waiting excludes travel minutes', () => {
  const unknown = evaluateInstructor({
    instructor: instructor(1), profile: profile(), rules: sundayRules,
    activity: course('unk'),
    existingActivities: [{ date: '2026-09-06', start_time: '08:00', end_time: '09:00', school: 'אחר' }],
    travel: { home: { distance_km: 2, duration_minutes: 4 }, transitions: { '2026-09-06': { previous: null } } },
    validateTravel: true
  });
  assert.equal(unknown.eligible, false);
  const gaps = scoreGapsAndNewDays({ opensNewWorkDay: false, gapBeforeMinutes: 60, nonTravelWaitingMinutes: 45, fillsExistingGap: false });
  assert.ok(gaps.points <= 5);
  assert.equal(gaps.nonTravelWaitingMinutes, 45);
});

test('actual workload uses meeting hours, includes approved/drafts/proposed, ignores manual quotas', () => {
  const shortCourse = course('short', '2026-09-06', {
    meetings: [
      { date: '2026-09-06', start_time: '10:00', end_time: '11:30' },
      { date: '2026-09-13', start_time: '10:00', end_time: '11:30' }
    ]
  });
  const longCourse = course('long', '2026-09-06', {
    meetings: Array.from({ length: 8 }, (_, index) => ({
      date: new Date(Date.UTC(2026, 8, 6 + index * 7)).toISOString().slice(0, 10),
      start_time: '10:00',
      end_time: '11:30'
    }))
  });
  const approved = {
    ...course('approved', '2026-09-07', {
      emp_id: '1',
      meetings: [{ date: '2026-09-07', start_time: '10:00', end_time: '12:00' }],
      start_time: '10:00',
      end_time: '12:00'
    })
  };
  const draft = {
    ...course('draft', '2026-09-08', {
      draft_emp_id: '1',
      draft_proposed_meetings: [{ date: '2026-09-08', start_time: '10:00', end_time: '11:00' }],
      meetings: [{ date: '2026-09-08', start_time: '10:00', end_time: '11:00' }]
    })
  };
  const light = instructor(1);
  const heavy = instructor(2);
  const results = calculateCourseSchedule({
    activities: [shortCourse, approved, draft],
    instructors: [light, heavy],
    profiles: { 1: profile({ weekly_max_hours: 1, weekly_target_hours: 1 }), 2: profile() },
    rules: { 1: multiDayRules, 2: multiDayRules },
    exceptions: {},
    travel: { ...homeTravel('short', '1', 4, 8), ...homeTravel('short', '2', 4, 8) },
    routeMatrix: {},
    referenceDate: '2026-09-01'
  });
  const shortResult = results.find((row) => row.course.row_id === 'short');
  const forLight = shortResult.checked.find((candidate) => candidate.instructor.emp_id === '1');
  const forHeavyEmpty = shortResult.checked.find((candidate) => candidate.instructor.emp_id === '2');
  assert.ok(forLight.currentHalfHours > 0, 'approved and draft hours count toward current load');
  assert.ok(forLight.projectedHalfHours > forLight.currentHalfHours, 'candidate course is included in projected hours');
  assert.ok(forHeavyEmpty.scoreBreakdown.actualWorkload.points >= forLight.scoreBreakdown.actualWorkload.points);

  const longOnly = calculateCourseSchedule({
    activities: [longCourse],
    instructors: [light],
    profiles: { 1: profile() },
    rules: { 1: multiDayRules },
    exceptions: {},
    travel: homeTravel('long', '1', 4, 8),
    routeMatrix: {},
    referenceDate: '2026-09-01'
  })[0].checked[0];
  assert.ok(longOnly.projectedHalfHours > forHeavyEmpty.projectedHalfHours);
  assert.equal(forLight.scoreBreakdown.actualWorkload.currentHalfHours, forLight.currentHalfHours);
});

test('original schedule preservation prefers no move, then fewer/shorter moves, and keeps adjusted candidates eligible', () => {
  const none = scoreOriginalSchedulePreservation(null);
  assert.equal(none.points, 15);
  const oneMove = scoreOriginalSchedulePreservation({
    valid: true,
    movedCount: 1,
    meetings: [
      { date: '2027-01-10', original_date: '2027-01-03', moved: true },
      { date: '2027-01-17', original_date: '2027-01-17', moved: false }
    ],
    newEndDate: '2027-01-17',
    exceedsHalf: false
  });
  const manyMoves = scoreOriginalSchedulePreservation({
    valid: true,
    movedCount: 4,
    meetings: [
      { date: '2027-02-07', original_date: '2027-01-03', moved: true },
      { date: '2027-02-14', original_date: '2027-01-10', moved: true },
      { date: '2027-02-21', original_date: '2027-01-17', moved: true },
      { date: '2027-02-28', original_date: '2027-01-24', moved: true }
    ],
    newEndDate: '2027-02-28',
    exceedsHalf: true
  });
  assert.ok(oneMove.points > manyMoves.points);
  assert.ok(oneMove.points < 15);
  assert.equal(manyMoves.halfOverflow, true);
  assert.ok(manyMoves.points >= 0);

  const target = course('adj', '2027-01-24', {
    meetings: [
      { date: '2027-01-24', start_time: '10:00', end_time: '11:00' },
      { date: '2027-01-31', start_time: '10:00', end_time: '11:00' }
    ]
  });
  const result = calculateCourseSchedule({
    activities: [target],
    instructors: [instructor(1)],
    profiles: { 1: profile() },
    rules: { 1: sundayRules },
    exceptions: { 1: [{ exception_date: '2027-01-24', available: false }] },
    travel: homeTravel('adj', '1', 3, 6),
    routeMatrix: {},
    periodKey: 'first',
    referenceDate: '2027-01-01'
  })[0].checked[0];
  assert.equal(result.eligible, true);
  assert.ok(result.dateAdjustment?.valid);
  assert.ok(result.movedMeetingsCount >= 1);
  assert.ok(result.scoreBreakdown.originalSchedulePreservation.points < 15);
});

test('urgency uses first upcoming date_1..date_35 and ignores past meetings', () => {
  const referenceDate = '2026-09-10';
  const soon = courseUrgency({
    date_1: '2026-09-01',
    date_2: '2026-09-14',
    date_3: '2026-09-21'
  }, referenceDate);
  assert.equal(soon.nextUpcomingMeetingDate, '2026-09-14');
  assert.equal(soon.urgencyBand, 'within_7');
  assert.equal(soon.daysUntilNextMeeting, 4);

  const mid = courseUrgency({ date_1: '2026-09-20' }, referenceDate);
  assert.equal(mid.urgencyBand, 'within_14');
  const later = courseUrgency({ date_1: '2026-10-01' }, referenceDate);
  assert.equal(later.urgencyBand, 'later');
  const none = courseUrgency({ date_1: '2026-09-01' }, referenceDate);
  assert.equal(none.urgencyBand, 'none');
  assert.equal(none.reason, 'no_upcoming_meeting');
});

test('urgent and scarce courses get global priority over higher raw scores', () => {
  // Sunday 2026-09-06 is within 7 days; only instructor 1 is available that day.
  const urgent = course('urgent', '2026-09-06', { school: 'רחוק', school_address: 'רחוק 1', authority: 'רשות ב' });
  // Monday 2026-09-28 is later; instructors 2/3 are available then.
  const relaxed = course('relaxed', '2026-09-28', { school: 'קרוב', school_address: 'קרוב 1', authority: 'רשות א' });
  const onlyForUrgent = instructor(1, 'יחידה');
  const sharedA = instructor(2, 'משותפת א');
  const sharedB = instructor(3, 'משותפת ב');
  const mondayRules = [{ weekday: 1, available: true, start_time: '08:00', end_time: '16:00' }];
  const results = calculateCourseSchedule({
    activities: [urgent, relaxed],
    instructors: [onlyForUrgent, sharedA, sharedB],
    profiles: {
      1: profile({ instruction_languages: ['he'] }),
      2: profile(),
      3: profile()
    },
    rules: {
      1: sundayRules,
      2: mondayRules,
      3: mondayRules
    },
    exceptions: {},
    travel: {
      ...homeTravel('urgent', '1', 30, 45),
      ...homeTravel('relaxed', '2', 2, 5),
      ...homeTravel('relaxed', '3', 2, 5)
    },
    routeMatrix: {},
    referenceDate: '2026-09-06'
  });
  const urgentResult = results.find((row) => row.course.row_id === 'urgent');
  const relaxedResult = results.find((row) => row.course.row_id === 'relaxed');
  assert.equal(urgentResult.urgencyBand, 'within_7');
  assert.equal(relaxedResult.urgencyBand, 'later');
  assert.equal(urgentResult.eligibleCandidateCount, 1);
  assert.ok(urgentResult.recommended || urgentResult.bestAvailable);
  assert.equal((urgentResult.recommended || urgentResult.bestAvailable).instructor.emp_id, '1');
  assert.ok((relaxedResult.recommended || relaxedResult.bestAvailable));
  assert.notEqual((relaxedResult.recommended || relaxedResult.bestAvailable).instructor.emp_id, '1');
});

test('eligibleCandidateCount includes warning/technical/bestAvailable/date-adjusted and excludes hard failures', () => {
  const target = course('count', '2026-09-06');
  const results = calculateCourseSchedule({
    activities: [target],
    instructors: [instructor(1), instructor(2), instructor(3)],
    profiles: {
      1: profile(),
      2: profile({ instruction_languages: ['ar'] }),
      3: profile()
    },
    rules: { 1: sundayRules, 2: sundayRules, 3: sundayRules },
    exceptions: {},
    travel: { ...homeTravel('count', '1', 40, 70), ...homeTravel('count', '3', 5, 10) },
    routeMatrix: {},
    referenceDate: '2026-09-01',
    preliminary: true
  })[0];
  assert.equal(results.eligibleCandidateCount, 2);
  assert.ok(results.checked.every((candidate) => candidate.eligibleCandidateCount === 2));
  assert.ok(results.checked.find((candidate) => candidate.instructor.emp_id === '1').score < 60);
  assert.equal(results.checked.find((candidate) => candidate.instructor.emp_id === '1').eligible, true);
  assert.equal(results.checked.find((candidate) => candidate.instructor.emp_id === '2').eligible, false);
});

test('global optimization maximizes assigned courses before total score', () => {
  const betterScoreFewer = compareOptimizationStates(
    { assignedCount: 10, urgency7Missed: 0, urgency14Missed: 0, scarceMissed: 0, sameSchoolCount: 0, sameAuthorityCount: 0, totalTravelMinutes: 100, totalNonTravelWaiting: 0, newWorkDaysOpened: 0, workloadVariance: 1, totalShiftDays: 0, totalScore: 500, tieProjectedHours: 0, tieTravel: 0, tieNewDays: 0, tieMovedMeetings: 0, tieEmpId: '1' },
    { assignedCount: 9, urgency7Missed: 0, urgency14Missed: 0, scarceMissed: 0, sameSchoolCount: 5, sameAuthorityCount: 5, totalTravelMinutes: 0, totalNonTravelWaiting: 0, newWorkDaysOpened: 0, workloadVariance: 0, totalShiftDays: 0, totalScore: 900, tieProjectedHours: 0, tieTravel: 0, tieNewDays: 0, tieMovedMeetings: 0, tieEmpId: '2' }
  );
  assert.ok(betterScoreFewer < 0);

  const a = course('a', '2026-09-06', { school: 'א', school_address: 'כתובת א', start_time: '08:00', end_time: '09:00', meetings: [{ date: '2026-09-06', start_time: '08:00', end_time: '09:00' }] });
  const b = course('b', '2026-09-06', { school: 'ב', school_address: 'כתובת ב', start_time: '10:00', end_time: '11:00', meetings: [{ date: '2026-09-06', start_time: '10:00', end_time: '11:00' }] });
  const oneInstructor = calculateCourseSchedule({
    activities: [a, b],
    instructors: [instructor(1)],
    profiles: { 1: profile() },
    rules: { 1: sundayRules },
    exceptions: {},
    travel: { ...homeTravel('a', '1', 2, 4), ...homeTravel('b', '1', 2, 4) },
    routeMatrix: {},
    referenceDate: '2026-09-01'
  });
  assert.equal(oneInstructor.filter((row) => row.recommended || row.bestAvailable).length, 1);

  const twoInstructors = calculateCourseSchedule({
    activities: [a, b],
    instructors: [instructor(1), instructor(2)],
    profiles: { 1: profile(), 2: profile() },
    rules: { 1: sundayRules, 2: sundayRules },
    exceptions: {},
    travel: {
      ...homeTravel('a', '1', 2, 4), ...homeTravel('a', '2', 2, 4),
      ...homeTravel('b', '1', 2, 4), ...homeTravel('b', '2', 2, 4)
    },
    routeMatrix: {},
    referenceDate: '2026-09-01'
  });
  assert.equal(twoInstructors.filter((row) => row.recommended || row.bestAvailable).length, 2);
});

test('approved and draft courses stay fixed, continue blocking, and do not re-enter optimization', () => {
  const open = course('open', '2026-09-06');
  const approved = course('approved', '2026-09-06', {
    emp_id: '1',
    school: 'חוסם',
    school_address: 'חוסם 1',
    start_time: '10:00',
    end_time: '11:00',
    meetings: [{ date: '2026-09-06', start_time: '10:00', end_time: '11:00' }]
  });
  const draft = course('drafted', '2026-09-13', {
    draft_emp_id: '2',
    draft_proposed_meetings: [{ date: '2026-09-13', start_time: '10:00', end_time: '11:00' }],
    meetings: [{ date: '2026-09-13', start_time: '10:00', end_time: '11:00' }]
  });
  assert.deepEqual(schedulingCourses([open, approved, draft]).map((row) => row.row_id), ['open']);
  const results = calculateCourseSchedule({
    activities: [open, approved, draft],
    instructors: [instructor(1), instructor(2)],
    profiles: { 1: profile(), 2: profile() },
    rules: { 1: multiDayRules, 2: multiDayRules },
    exceptions: {},
    travel: { ...homeTravel('open', '1', 3, 6), ...homeTravel('open', '2', 3, 6) },
    routeMatrix: {},
    referenceDate: '2026-09-01'
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].course.row_id, 'open');
  const blockedByApproved = results[0].checked.find((candidate) => candidate.instructor.emp_id === '1');
  assert.equal(blockedByApproved.eligible, false);
  assert.match(blockedByApproved.failures.join(' '), /חפיפה/);
});

test('same school continuity beats workload balancing when earlier objectives tie; travel beats workload next', () => {
  const schoolPrefer = compareOptimizationStates(
    { assignedCount: 2, urgency7Missed: 0, urgency14Missed: 0, scarceMissed: 0, sameSchoolCount: 2, sameAuthorityCount: 0, totalTravelMinutes: 40, totalNonTravelWaiting: 0, newWorkDaysOpened: 0, workloadVariance: 5, totalShiftDays: 0, totalScore: 100, tieProjectedHours: 0, tieTravel: 0, tieNewDays: 0, tieMovedMeetings: 0, tieEmpId: '1' },
    { assignedCount: 2, urgency7Missed: 0, urgency14Missed: 0, scarceMissed: 0, sameSchoolCount: 0, sameAuthorityCount: 2, totalTravelMinutes: 10, totalNonTravelWaiting: 0, newWorkDaysOpened: 0, workloadVariance: 0, totalShiftDays: 0, totalScore: 120, tieProjectedHours: 0, tieTravel: 0, tieNewDays: 0, tieMovedMeetings: 0, tieEmpId: '2' }
  );
  assert.ok(schoolPrefer < 0);
  const travelPrefer = compareOptimizationStates(
    { assignedCount: 2, urgency7Missed: 0, urgency14Missed: 0, scarceMissed: 0, sameSchoolCount: 1, sameAuthorityCount: 1, totalTravelMinutes: 10, totalNonTravelWaiting: 0, newWorkDaysOpened: 0, workloadVariance: 9, totalShiftDays: 0, totalScore: 80, tieProjectedHours: 0, tieTravel: 0, tieNewDays: 0, tieMovedMeetings: 0, tieEmpId: '1' },
    { assignedCount: 2, urgency7Missed: 0, urgency14Missed: 0, scarceMissed: 0, sameSchoolCount: 1, sameAuthorityCount: 1, totalTravelMinutes: 40, totalNonTravelWaiting: 0, newWorkDaysOpened: 0, workloadVariance: 0, totalShiftDays: 0, totalScore: 90, tieProjectedHours: 0, tieTravel: 0, tieNewDays: 0, tieMovedMeetings: 0, tieEmpId: '2' }
  );
  assert.ok(travelPrefer < 0);
});

test('quality bands, bestAvailable below 60, and recruitment only when no eligible remain', () => {
  assert.equal(schedulingQualityBand(60).qualityBand, 'recommended');
  assert.equal(schedulingQualityBand(59).qualityBand, 'warning');
  assert.equal(schedulingQualityBand(39).qualityBand, 'technical');
  const low = calculateCourseSchedule({
    activities: [course('low')],
    instructors: [instructor(1)],
    profiles: { 1: profile() },
    rules: { 1: sundayRules },
    exceptions: {},
    preliminary: true,
    referenceDate: '2026-09-01'
  })[0];
  assert.equal(low.recommended, null);
  assert.ok(low.bestAvailable);
  assert.ok(low.bestAvailable.score < 60);
  assert.equal(low.bestAvailable.recommended, false);
  assert.equal(low.bestAvailable.bestAvailable, true);
  assert.notEqual(low.status, 'נדרש גיוס');

  const none = calculateCourseSchedule({
    activities: [course('none')],
    instructors: [instructor(1)],
    profiles: { 1: profile({ instruction_languages: ['ar'] }) },
    rules: { 1: sundayRules },
    exceptions: {},
    preliminary: true,
    referenceDate: '2026-09-01'
  })[0];
  assert.equal(none.status, 'נדרש גיוס');
});

test('deterministic output for identical inputs', () => {
  const input = {
    activities: [course('d1', '2026-09-06'), course('d2', '2026-09-07')],
    instructors: [instructor(1), instructor(2)],
    profiles: { 1: profile(), 2: profile() },
    rules: { 1: multiDayRules, 2: multiDayRules },
    exceptions: {},
    travel: {
      ...homeTravel('d1', '1', 5, 10), ...homeTravel('d1', '2', 5, 10),
      ...homeTravel('d2', '1', 5, 10), ...homeTravel('d2', '2', 5, 10)
    },
    routeMatrix: {},
    referenceDate: '2026-09-01'
  };
  const first = calculateCourseSchedule(input).map((row) => ({
    id: row.course.row_id,
    emp: (row.recommended || row.bestAvailable)?.instructor?.emp_id || null,
    score: (row.recommended || row.bestAvailable)?.score || null
  }));
  const second = calculateCourseSchedule(input).map((row) => ({
    id: row.course.row_id,
    emp: (row.recommended || row.bestAvailable)?.instructor?.emp_id || null,
    score: (row.recommended || row.bestAvailable)?.score || null
  }));
  assert.deepEqual(first, second);
});

test('candidate payload exposes required stage 3 fields', () => {
  const result = calculateCourseSchedule({
    activities: [course('fields')],
    instructors: [instructor(1)],
    profiles: { 1: profile() },
    rules: { 1: sundayRules },
    exceptions: {},
    travel: homeTravel('fields', '1', 4, 8),
    routeMatrix: {},
    referenceDate: '2026-09-01'
  })[0];
  const candidate = result.recommended || result.bestAvailable;
  for (const key of [
    'empId', 'instructorName', 'eligible', 'totalScore', 'qualityBand', 'qualityLabel',
    'bestAvailable', 'recommended', 'scoreBreakdown', 'recommendationReason',
    'currentHalfHours', 'projectedHalfHours', 'activeWorkDays', 'relevantTravelMinutes',
    'relevantTravelDistance', 'dailyTravelMinutes', 'movedMeetingsCount', 'totalShiftDays',
    'opensNewWorkDay', 'gapBeforeMinutes', 'gapAfterMinutes', 'nonTravelWaitingMinutes',
    'rank', 'eligibleCandidateCount', 'urgencyBand', 'daysUntilNextMeeting',
    'nextUpcomingMeetingDate', 'halfOverflow'
  ]) {
    assert.notEqual(candidate[key], undefined, `missing ${key}`);
  }
  assert.ok(candidate.scoreBreakdown.continuityEfficiency);
  assert.ok(candidate.scoreBreakdown.travelDistance);
  assert.ok(candidate.scoreBreakdown.actualWorkload);
  assert.ok(candidate.scoreBreakdown.originalSchedulePreservation);
  assert.ok(candidate.scoreBreakdown.gapsAndNewDays);
});

test('15 minute safety buffer is not double-counted in travel score', () => {
  const key = routeMatrixKey('מוצא 1', 'יעד 1');
  const target = course('buf', '2027-01-24', {
    school: 'יעד',
    school_address: 'יעד 1',
    meetings: [
      { date: '2027-01-24', start_time: '10:00', end_time: '11:00' },
      { date: '2027-01-31', start_time: '10:00', end_time: '11:00' }
    ]
  });
  const previous = course('prev', '2027-01-31', {
    emp_id: '1',
    school: 'מוצא',
    school_address: 'מוצא 1',
    start_time: '09:00',
    end_time: '09:35',
    meetings: [{ date: '2027-01-31', start_time: '09:00', end_time: '09:35' }]
  });
  const candidate = calculateCourseSchedule({
    activities: [target, previous],
    instructors: [instructor(1)],
    profiles: { 1: profile() },
    rules: { 1: sundayRules },
    exceptions: { 1: [{ exception_date: '2027-01-24', available: false }] },
    assignments: { 1: [previous] },
    periodKey: 'first',
    travel: homeTravel('buf', '1', 2, 4),
    routeMatrix: { [key]: { distance_km: 1, duration_minutes: 10 } },
    referenceDate: '2027-01-01'
  })[0].checked[0];
  assert.equal(candidate.eligible, true);
  assert.ok(candidate.dateAdjustment?.valid);
  // Scoring uses raw travel minutes only; the single +15 buffer stays in operational validation.
  const scoredMinutes = Number(candidate.scoreBreakdown.travelDistance.duration_minutes);
  assert.ok(Number.isFinite(scoredMinutes));
  assert.notEqual(scoredMinutes, 25);
  assert.ok(scoredMinutes < 15 + 10 || scoredMinutes === 0 || scoredMinutes === 4 || scoredMinutes === 8);
});
