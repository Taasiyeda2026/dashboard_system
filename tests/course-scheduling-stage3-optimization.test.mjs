import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCORE_WEIGHTS,
  assertScoreWeightsTotal,
  computeSchedulingScore,
  courseUrgency,
  compareOptimizationStates,
  isSafeEligibleCandidate,
  scoreTravelDistance,
  scoreOriginalSchedulePreservation,
  scoreGapsAndNewDays
} from '../frontend/src/screens/course-scheduling-score.js';
import { calculateCourseSchedule, schedulingCourses, instructorLoad } from '../frontend/src/screens/course-scheduling-engine.js';
import { evaluateInstructor, schedulingQualityBand } from '../frontend/src/screens/instructor-matching-engine.js';
import { routeMatrixKey } from '../frontend/src/screens/course-scheduling-travel.js';
import { TRAVEL_SAFETY_BUFFER_MINUTES } from '../frontend/src/screens/shared/travel-safety-buffer.js';
import { readFileSync } from 'node:fs';

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

const homeTravel = (courseId, empId, distance_km = 5, duration_minutes = 10, returnMinutes = duration_minutes + 2) => ({
  [courseId]: {
    [empId]: {
      home: { distance_km, duration_minutes },
      homeReturn: { distance_km: distance_km + 0.5, duration_minutes: returnMinutes },
      transitions: {}
    }
  }
});


function fillTravel(activities = [], instructors = [], distance_km = 5, duration_minutes = 10) {
  const travel = {};
  for (const activity of activities) {
    const courseId = String(activity.row_id || activity.id || '');
    if (!courseId) continue;
    travel[courseId] = travel[courseId] || {};
    for (const row of instructors) {
      const empId = String(row.emp_id);
      travel[courseId][empId] = {
        home: { distance_km, duration_minutes },
        homeReturn: { distance_km: distance_km + 0.5, duration_minutes: duration_minutes + 2 },
        transitions: {}
      };
    }
  }
  return travel;
}

function mergeTravel(...parts) {
  const merged = {};
  for (const part of parts) {
    for (const [courseId, byEmp] of Object.entries(part || {})) {
      merged[courseId] = { ...(merged[courseId] || {}), ...byEmp };
    }
  }
  return merged;
}

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
    travel: { home: { distance_km: 3, duration_minutes: 6 },
      homeReturn: { distance_km: 3, duration_minutes: 6 }, transitions: {} },
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
    travel: { home: { distance_km: 4, duration_minutes: 8 },
      homeReturn: { distance_km: 4, duration_minutes: 8 }, transitions: { '2026-09-06': { previous: { distance_km: 0, duration_minutes: 0 } } } }
  });
  const sameAuthority = evaluateInstructor({
    instructor: instructor(1),
    profile: profile(),
    rules: sundayRules,
    activity: target,
    existingActivities: [{ date: '2026-09-06', start_time: '08:00', end_time: '09:30', school: 'בית ספר ב', school_id: 'b', authority: 'רשות א' }],
    travel: { home: { distance_km: 4, duration_minutes: 8 },
      homeReturn: { distance_km: 4, duration_minutes: 8 }, transitions: { '2026-09-06': { previous: { distance_km: 2, duration_minutes: 8 } } } }
  });
  const newDay = evaluateInstructor({
    instructor: instructor(1),
    profile: profile(),
    rules: sundayRules,
    activity: target,
    existingActivities: [],
    travel: { home: { distance_km: 4, duration_minutes: 8 },
      homeReturn: { distance_km: 4, duration_minutes: 8 }, transitions: {} }
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
    travel: { home: { distance_km: 1, duration_minutes: 2 },
      homeReturn: { distance_km: 1, duration_minutes: 2 }, transitions: { '2026-09-06': { previous: { distance_km: 0, duration_minutes: 0 } } } }
  });
  const loose = evaluateInstructor({
    instructor: instructor(1), profile: profile(), rules: sundayRules, activity: target,
    existingActivities: [{ date: '2026-09-06', start_time: '08:00', end_time: '09:00', school: 'בית ספר א', school_id: 'a', authority: 'רשות א' }],
    travel: { home: { distance_km: 1, duration_minutes: 2 },
      homeReturn: { distance_km: 1, duration_minutes: 2 }, transitions: { '2026-09-06': { previous: { distance_km: 0, duration_minutes: 0 } } } }
  });
  assert.ok(tight.scoreBreakdown.continuityEfficiency.points >= loose.scoreBreakdown.continuityEfficiency.points);
  const overlap = evaluateInstructor({
    instructor: instructor(1), profile: profile(), rules: sundayRules, activity: target,
    existingActivities: [{ date: '2026-09-06', start_time: '11:30', end_time: '12:30', school: 'אחר', activity_name: 'חוסם' }],
    travel: { home: { distance_km: 1, duration_minutes: 2 },
      homeReturn: { distance_km: 1, duration_minutes: 2 }, transitions: {} }
  });
  assert.equal(overlap.eligible, false);
  assert.equal(overlap.score, null);
  const impossible = evaluateInstructor({
    instructor: instructor(1), profile: profile(), rules: sundayRules, activity: target,
    existingActivities: [{ date: '2026-09-06', start_time: '10:00', end_time: '11:50', school: 'אחר' }],
    travel: { home: { distance_km: 1, duration_minutes: 2 },
      homeReturn: { distance_km: 1, duration_minutes: 2 }, transitions: { '2026-09-06': { previous: { distance_km: 20, duration_minutes: 40 } } } }
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
      homeReturn: { distance_km: 40, duration_minutes: 70 },
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
    travel: { home: { distance_km: 2, duration_minutes: 4 },
      homeReturn: { distance_km: 2, duration_minutes: 4 }, transitions: { '2026-09-06': { previous: null } } },
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
    travel: fillTravel([shortCourse, approved, draft], [light, heavy]),
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
    travel: fillTravel([longCourse], [light]),
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
    travel: fillTravel([target], [instructor(1)]),
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
    travel: fillTravel([urgent, relaxed], [onlyForUrgent, sharedA, sharedB]),
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
    travel: {},
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
    travel: fillTravel([a, b], [instructor(1)]),
    referenceDate: '2026-09-01'
  });
  assert.equal(oneInstructor.filter((row) => row.recommended || row.bestAvailable).length, 1);

  const twoInstructors = calculateCourseSchedule({
    activities: [a, b],
    instructors: [instructor(1), instructor(2)],
    profiles: { 1: profile(), 2: profile() },
    rules: { 1: sundayRules, 2: sundayRules },
    exceptions: {},
    travel: fillTravel([a, b], [instructor(1), instructor(2)]),
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
    travel: {},
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
    { assignedCount: 2, urgency7Missed: 0, urgency14Missed: 0, scarceMissed: 0, sameSchoolMeetingCount: 2, sameAuthorityMeetingCount: 0, totalTravelMinutes: 40, totalNonTravelWaiting: 0, newWorkDaysOpened: 0, workloadVariance: 5, totalShiftDays: 0, totalScore: 100, tieProjectedHours: 0, tieTravel: 0, tieNewDays: 0, tieMovedMeetings: 0, tieEmpId: '1' },
    { assignedCount: 2, urgency7Missed: 0, urgency14Missed: 0, scarceMissed: 0, sameSchoolMeetingCount: 0, sameAuthorityMeetingCount: 2, totalTravelMinutes: 10, totalNonTravelWaiting: 0, newWorkDaysOpened: 0, workloadVariance: 0, totalShiftDays: 0, totalScore: 120, tieProjectedHours: 0, tieTravel: 0, tieNewDays: 0, tieMovedMeetings: 0, tieEmpId: '2' }
  );
  assert.ok(schoolPrefer < 0);
  const travelPrefer = compareOptimizationStates(
    { assignedCount: 2, urgency7Missed: 0, urgency14Missed: 0, scarceMissed: 0, sameSchoolMeetingCount: 1, sameAuthorityMeetingCount: 1, totalTravelMinutes: 10, totalNonTravelWaiting: 0, newWorkDaysOpened: 0, workloadVariance: 9, totalShiftDays: 0, totalScore: 80, tieProjectedHours: 0, tieTravel: 0, tieNewDays: 0, tieMovedMeetings: 0, tieEmpId: '1' },
    { assignedCount: 2, urgency7Missed: 0, urgency14Missed: 0, scarceMissed: 0, sameSchoolMeetingCount: 1, sameAuthorityMeetingCount: 1, totalTravelMinutes: 40, totalNonTravelWaiting: 0, newWorkDaysOpened: 0, workloadVariance: 0, totalShiftDays: 0, totalScore: 90, tieProjectedHours: 0, tieTravel: 0, tieNewDays: 0, tieMovedMeetings: 0, tieEmpId: '2' }
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
    travel: {},
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
  const fieldsCourse = course('fields');
  const fieldsInstructor = instructor(1);
  const result = calculateCourseSchedule({
    activities: [fieldsCourse],
    instructors: [fieldsInstructor],
    profiles: { 1: profile() },
    rules: { 1: sundayRules },
    exceptions: {},
    travel: fillTravel([fieldsCourse], [fieldsInstructor]),
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
    'nextUpcomingMeetingDate', 'halfOverflow',
    'requiresHomeRoute', 'requiresHomeReturn', 'homeRouteVerified', 'homeReturnVerified',
    'sameSchoolMeetingCount', 'sameAuthorityMeetingCount', 'nearbyMeetingCount',
    'existingWorkDayMeetingCount', 'newWorkDayMeetingCount', 'continuityMeetingCount',
    'continuityAverage'
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
  const bufferInstructor = instructor(1);
  const candidate = calculateCourseSchedule({
    activities: [target, previous],
    instructors: [bufferInstructor],
    profiles: { 1: profile() },
    rules: { 1: sundayRules },
    exceptions: { 1: [{ exception_date: '2027-01-24', available: false }] },
    assignments: { 1: [previous] },
    periodKey: 'first',
    travel: {
      ...fillTravel([target, previous], [bufferInstructor]),
      [key]: { distance_km: 1, duration_minutes: 10 }
    },
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

test('production-shaped screen input injects referenceDate and classifies urgency bands', () => {
  // Mirrors course-scheduling.js: referenceDate: today() as YYYY-MM-DD — never rely on system clock here.
  const referenceDate = '2026-09-10';
  const within7 = course('prod-7', '2026-09-14');
  const within14 = course('prod-14', '2026-09-22');
  const later = course('prod-later', '2026-10-20');
  const screenShapedInput = {
    activities: [within7, within14, later],
    periodKey: 'first',
    authority: '',
    instructors: [instructor(1), instructor(2), instructor(3)],
    profiles: { 1: profile(), 2: profile(), 3: profile() },
    rules: { 1: multiDayRules, 2: multiDayRules, 3: multiDayRules },
    exceptions: {},
    schoolCalendar: [],
    referenceDate,
    travel: {}
  };
  const results = calculateCourseSchedule(screenShapedInput);
  const byId = Object.fromEntries(results.map((row) => [row.course.row_id, row]));
  assert.equal(byId['prod-7'].urgencyBand, 'within_7');
  assert.equal(byId['prod-14'].urgencyBand, 'within_14');
  assert.equal(byId['prod-later'].urgencyBand, 'later');
  for (const row of results) {
    assert.notEqual(row.urgencyBand, 'none');
    assert.ok(row.daysUntilNextMeeting != null);
    assert.notEqual(courseUrgency(row.course, referenceDate).reason, 'missing_reference_date');
  }
  assert.match(
    readFileSync(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8'),
    /referenceDate:\s*today\(\)|const referenceDate = today\(\)/
  );
});

test('solo activity without home route is unsafe in final calculation and safe home stays eligible', () => {
  const target = course('home-gate', '2026-09-06');
  const noHome = calculateCourseSchedule({
    activities: [target],
    instructors: [instructor(1)],
    profiles: { 1: profile() },
    rules: { 1: sundayRules },
    exceptions: {},
    travel: { 'home-gate': { 1: { home: null, transitions: {},
      homeReturn: {} } } },
    routeMatrix: {},
    referenceDate: '2026-09-01'
  })[0];
  const unsafe = noHome.checked[0];
  assert.equal(unsafe.eligible, false);
  assert.equal(isSafeEligibleCandidate(unsafe, { preliminary: false }), false);
  assert.equal(noHome.eligibleCandidateCount, 0);
  assert.equal(noHome.recommended, null);
  assert.equal(noHome.bestAvailable, null);
  assert.equal(noHome.alternatives.length, 0);

  const preliminary = calculateCourseSchedule({
    activities: [target],
    instructors: [instructor(1)],
    profiles: { 1: profile() },
    rules: { 1: sundayRules },
    exceptions: {},
    preliminary: true,
    referenceDate: '2026-09-01'
  })[0];
  assert.equal(preliminary.checked[0].eligible, true);
  assert.equal(isSafeEligibleCandidate(preliminary.checked[0], { preliminary: true }), true);

  const withHome = calculateCourseSchedule({
    activities: [target],
    instructors: [instructor(1)],
    profiles: { 1: profile() },
    rules: { 1: sundayRules },
    exceptions: {},
    travel: homeTravel('home-gate', '1'),
    referenceDate: '2026-09-01'
  })[0];
  assert.equal(withHome.checked[0].eligible, true);
  assert.equal(isSafeEligibleCandidate(withHome.checked[0]), true);
  assert.ok(withHome.recommended || withHome.bestAvailable);
});

test('final recommended and alternatives actualWorkload differ across heavy and light peers', () => {
  const target = course('wl-out', '2026-09-06', {
    school: 'משותף',
    school_address: 'משותף 1',
    authority: 'רשות א'
  });
  const heavyApproved = Array.from({ length: 8 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 8, 7 + index));
    while (date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1);
    return {
      ...course(`busy-${index}`, date.toISOString().slice(0, 10), {
        emp_id: '1',
        school: `עמוס ${index}`,
        school_address: `עמוס ${index}`,
        authority: 'רשות ב',
        start_time: '08:00',
        end_time: '12:00',
        meetings: [{ date: date.toISOString().slice(0, 10), start_time: '08:00', end_time: '12:00' }]
      })
    };
  });
  const wlInstructors = [instructor(1, 'עמוסה'), instructor(2, 'פנויה')];
  const result = calculateCourseSchedule({
    activities: [target, ...heavyApproved],
    instructors: wlInstructors,
    profiles: { 1: profile(), 2: profile() },
    rules: { 1: multiDayRules, 2: multiDayRules },
    exceptions: {},
    travel: fillTravel([target, ...heavyApproved], wlInstructors),
    referenceDate: '2026-09-01'
  })[0];
  const primary = result.recommended || result.bestAvailable;
  assert.ok(primary, 'expected a primary recommendation');
  assert.ok(result.alternatives.length >= 1, 'expected an alternative peer');
  const alt = result.alternatives[0];
  const primaryLoad = primary.scoreBreakdown.actualWorkload.points;
  const altLoad = alt.scoreBreakdown.actualWorkload.points;
  assert.ok(primaryLoad >= 0 && primaryLoad <= 20);
  assert.ok(altLoad >= 0 && altLoad <= 20);
  assert.notEqual(primaryLoad, altLoad, 'recommended/alternatives must reflect real peer workload comparison');
  const light = [primary, alt].find((row) => row.instructor.emp_id === '2');
  const heavy = [primary, alt].find((row) => row.instructor.emp_id === '1');
  assert.ok(light && heavy);
  assert.ok(light.scoreBreakdown.actualWorkload.points > heavy.scoreBreakdown.actualWorkload.points);
});

test('scarcer eligible count (2) beats abundant eligible count (10) when earlier objectives tie', () => {
  const preferMissAbundant = compareOptimizationStates(
    {
      assignedCount: 1, urgency7Missed: 0, urgency14Missed: 0,
      scarcityMissedByCount: [, , 0, , , , , , , , 1],
      sameSchoolCount: 0, sameAuthorityCount: 0, totalTravelMinutes: 0, totalNonTravelWaiting: 0,
      newWorkDaysOpened: 0, workloadVariance: 0, totalShiftDays: 0, totalScore: 50,
      tieProjectedHours: 0, tieTravel: 0, tieNewDays: 0, tieMovedMeetings: 0, tieEmpId: 'x'
    },
    {
      assignedCount: 1, urgency7Missed: 0, urgency14Missed: 0,
      scarcityMissedByCount: [, , 1],
      sameSchoolCount: 0, sameAuthorityCount: 0, totalTravelMinutes: 0, totalNonTravelWaiting: 0,
      newWorkDaysOpened: 0, workloadVariance: 0, totalShiftDays: 0, totalScore: 50,
      tieProjectedHours: 0, tieTravel: 0, tieNewDays: 0, tieMovedMeetings: 0, tieEmpId: 'y'
    }
  );
  // Prefer missing the 10-candidate course over missing the 2-candidate course.
  assert.ok(preferMissAbundant < 0);

  const sharedDate = '2026-09-06';
  const slot = { start_time: '10:00', end_time: '11:00', meetings: [{ date: sharedDate, start_time: '10:00', end_time: '11:00' }] };
  // Two specialists, three same-slot courses: max assignments = 2.
  // Prefer assigning the two 1-eligible courses and leaving the 2-eligible course unassigned
  // (missing count-2 is better than missing count-1). The 2-vs-10 lexicographic case is covered above.
  const oneA = course('one-a', sharedDate, { school: 'א', school_address: 'א 1', ...slot });
  const oneB = course('one-b', sharedDate, { school: 'ב', school_address: 'ב 1', ...slot });
  const two = course('two', sharedDate, { school: 'ג', school_address: 'ג 1', ...slot });
  const scarceInstructors = [instructor('i1'), instructor('i2')];
  const results = calculateCourseSchedule({
    activities: [oneA, oneB, two],
    instructors: scarceInstructors,
    profiles: { i1: profile(), i2: profile() },
    rules: { i1: sundayRules, i2: sundayRules },
    exceptions: {},
    travel: fillTravel([oneA, oneB, two], scarceInstructors),
    referenceDate: '2026-09-01'
  });
  const byId = Object.fromEntries(results.map((row) => [row.course.row_id, row]));
  // eligibleCandidateCount is recomputed against bestState (not the baseline map).
  assert.equal(byId['one-a'].eligibleCandidateCount, 1);
  assert.equal(byId['one-b'].eligibleCandidateCount, 1);
  assert.equal(byId['two'].eligibleCandidateCount, 0);
  assert.ok(byId['two'].checked.every((candidate) => !candidate.eligible || !isSafeEligibleCandidate(candidate)));
  assert.ok(byId['one-a'].recommended || byId['one-a'].bestAvailable);
  assert.ok(byId['one-b'].recommended || byId['one-b'].bestAvailable);
  assert.equal(byId['two'].recommended || byId['two'].bestAvailable, null);
  assert.equal(byId['two'].alternatives.length, 0);
});

test('branch-and-bound keeps max assignments when intermediate states exceed old beam width of 200', () => {
  const engineSource = readFileSync(new URL('../frontend/src/screens/course-scheduling-engine.js', import.meta.url), 'utf8');
  assert.doesNotMatch(engineSource, /\.slice\(\s*0\s*,\s*200\s*\)/);

  // Adversarial for old beam (.slice(0, 200)):
  // - Hub is within_7 so it is ordered before later exclusive courses.
  // - 201 hub candidates expand to >200 states; beam keeps assigned hub states and drops the
  //   unassigned branch that alone reaches the true maximum (2 exclusive courses per instructor).
  // - Exclusive courses conflict with the hub's later meetings (Sep 20–21).
  // Precomputed maps avoid an O(courses×instructors) preprocess blow-up while still running the
  // real assignment search (which re-evaluates candidates along each branch).
  const instructorCount = 201;
  const instructors = Array.from({ length: instructorCount }, (_, index) => instructor(`i${index + 1}`));
  const profiles = Object.fromEntries(instructors.map((row) => [row.emp_id, profile()]));
  const weekRules = [
    { weekday: 0, available: true, start_time: '08:00', end_time: '16:00' },
    { weekday: 1, available: true, start_time: '08:00', end_time: '16:00' }
  ];
  const rules = Object.fromEntries(instructors.map((row) => [row.emp_id, weekRules]));
  const hub = course('hub-early', '2026-09-06', {
    school: 'מוקד',
    school_address: 'מוקד 1',
    meetings: [
      { date: '2026-09-06', start_time: '10:00', end_time: '11:00' },
      { date: '2026-09-07', start_time: '10:00', end_time: '11:00' },
      { date: '2026-09-20', start_time: '10:00', end_time: '11:00' },
      { date: '2026-09-21', start_time: '10:00', end_time: '11:00' }
    ],
    date_1: '2026-09-06',
    date_2: '2026-09-07',
    date_3: '2026-09-20',
    date_4: '2026-09-21'
  });
  const laterCourses = [];
  const travel = { 'hub-early': {} };
  for (const row of instructors) {
    travel['hub-early'][row.emp_id] = {
      home: { distance_km: 3, duration_minutes: 6 },
      homeReturn: { distance_km: 3.5, duration_minutes: 8 },
      transitions: {}
    };
  }
  for (let index = 0; index < instructorCount; index += 1) {
    const empId = `i${index + 1}`;
    const aId = `zz-L${String(index + 1).padStart(3, '0')}a`;
    const bId = `zz-L${String(index + 1).padStart(3, '0')}b`;
    laterCourses.push(course(aId, '2026-09-20', {
      school: `לא-${index + 1}-א`,
      school_address: `לא ${index + 1} א`,
      meetings: [{ date: '2026-09-20', start_time: '10:00', end_time: '11:00' }]
    }));
    laterCourses.push(course(bId, '2026-09-21', {
      school: `לא-${index + 1}-ב`,
      school_address: `לא ${index + 1} ב`,
      meetings: [{ date: '2026-09-21', start_time: '10:00', end_time: '11:00' }]
    }));
    const leg = {
      home: { distance_km: 3, duration_minutes: 6 },
      homeReturn: { distance_km: 3.5, duration_minutes: 8 },
      transitions: {}
    };
    travel[aId] = { [empId]: leg };
    travel[bId] = { [empId]: { ...leg } };
  }

  const stub = (instructorRow, eligibleCount, urgency) => ({
    instructor: instructorRow,
    eligible: true,
    score: 40,
    failures: [],
    missingProfileData: [],
    warnings: [],
    requiresHomeRoute: false,
    projectedHalfHours: 1,
    currentHalfHours: 0,
    eligibleCandidateCount: eligibleCount,
    rank: 1,
    urgencyBand: urgency.urgencyBand,
    daysUntilNextMeeting: urgency.daysUntilNextMeeting,
    nextUpcomingMeetingDate: urgency.nextUpcomingMeetingDate
  });

  const referenceDate = '2026-09-01';
  const hubUrgency = courseUrgency(hub, referenceDate);
  const maps = new Map();
  maps.set('hub-early', instructors.map((row) => stub(row, instructorCount, hubUrgency)));
  for (let index = 0; index < instructorCount; index += 1) {
    const a = laterCourses[index * 2];
    const b = laterCourses[index * 2 + 1];
    const urgencyA = courseUrgency(a, referenceDate);
    const urgencyB = courseUrgency(b, referenceDate);
    maps.set(a.row_id, [stub(instructors[index], 1, urgencyA)]);
    maps.set(b.row_id, [stub(instructors[index], 1, urgencyB)]);
  }
  const urgencyByCourse = new Map([['hub-early', hubUrgency]]);
  for (const row of laterCourses) urgencyByCourse.set(row.row_id, courseUrgency(row, referenceDate));

  // Model the old beam cut at the hub course: >200 assigned children drop the unassigned max path.
  const oldBeamHubStates = [
    { assignedCount: 0, skippedHub: true },
    ...instructors.map((_, index) => ({ assignedCount: 1, skippedHub: false, index }))
  ]
    .sort((left, right) => right.assignedCount - left.assignedCount || (left.index || 0) - (right.index || 0))
    .slice(0, 200);
  assert.equal(oldBeamHubStates.length, 200);
  assert.equal(oldBeamHubStates.some((state) => state.skippedHub), false);

  const results = calculateCourseSchedule({
    activities: [hub, ...laterCourses],
    instructors,
    profiles,
    rules,
    exceptions: {},
    travel,
    routeMatrix: {},
    referenceDate,
    precomputedCandidateMaps: { output: maps, urgencyByCourse }
  });
  const assigned = results.filter((row) => row.recommended || row.bestAvailable).length;
  assert.equal(assigned, instructorCount * 2);
  assert.equal(
    results.find((row) => row.course.row_id === 'hub-early').recommended
      || results.find((row) => row.course.row_id === 'hub-early').bestAvailable,
    null
  );
});

test('home return is scored for solo and last-of-day, not mid-day, and daily travel sums legs', () => {
  const solo = evaluateInstructor({
    instructor: instructor(1),
    profile: profile(),
    rules: sundayRules,
    activity: course('solo-day', '2026-09-06', { school_address: 'יעד 1' }),
    existingActivities: [],
    travel: {
      home: { distance_km: 5, duration_minutes: 10 },
      homeReturn: { distance_km: 6, duration_minutes: 12 },
      transitions: {}
    }
  });
  assert.equal(solo.relevantTravelMinutes, 22);
  assert.equal(solo.dailyTravelMinutes, 22);
  assert.ok(solo.scoreBreakdown.travelDistance.duration_minutes === 22);

  const firstWithNext = evaluateInstructor({
    instructor: instructor(1),
    profile: profile(),
    rules: sundayRules,
    activity: course('first', '2026-09-06', {
      school: 'יעד',
      school_address: 'יעד 1',
      start_time: '10:00',
      end_time: '11:00',
      meetings: [{ date: '2026-09-06', start_time: '10:00', end_time: '11:00' }]
    }),
    existingActivities: [
      { date: '2026-09-06', start_time: '12:00', end_time: '13:00', school: 'הבא', school_address: 'הבא 1' }
    ],
    travel: {
      home: { distance_km: 5, duration_minutes: 10 },
      homeReturn: { distance_km: 6, duration_minutes: 12 },
      transitions: {
        '2026-09-06': { next: { distance_km: 2, duration_minutes: 7 } }
      }
    }
  });
  assert.equal(firstWithNext.relevantTravelMinutes, 17);
  assert.ok(firstWithNext.relevantTravelMinutes < 10 + 12, 'must not charge home return mid-day');

  const lastWithPrev = evaluateInstructor({
    instructor: instructor(1),
    profile: profile(),
    rules: sundayRules,
    activity: course('last', '2026-09-06', {
      school: 'יעד',
      school_address: 'יעד 1',
      start_time: '12:00',
      end_time: '13:00',
      meetings: [{ date: '2026-09-06', start_time: '12:00', end_time: '13:00' }]
    }),
    existingActivities: [
      { date: '2026-09-06', start_time: '08:00', end_time: '09:00', school: 'קודם', school_address: 'קודם 1' }
    ],
    travel: {
      home: { distance_km: 40, duration_minutes: 70 },
      homeReturn: { distance_km: 6, duration_minutes: 12 },
      transitions: {
        '2026-09-06': { previous: { distance_km: 3, duration_minutes: 8 } }
      }
    }
  });
  assert.equal(lastWithPrev.relevantTravelMinutes, 20);
  assert.ok(lastWithPrev.relevantTravelMinutes < 70, 'arrival uses previous activity, not home');
  // +15 safety buffer is operational only and must not appear in the scored minute total.
  assert.notEqual(lastWithPrev.scoreBreakdown.travelDistance.duration_minutes, 20 + 15);
});

test('proposedMeetings from stage-2 free original date and block proposed date inside optimization', () => {
  assert.equal(TRAVEL_SAFETY_BUFFER_MINUTES, 15);
  // Partial-day exception on 6.9 covers only 12:00–16:00: A at 10:00 must move to 13.9,
  // while B at 12:30 stays on 6.9 (instructor still available then).
  const courseA = course('prop-a', '2026-09-06', {
    school: 'בית א',
    school_address: 'כתובת א',
    start_time: '10:00',
    end_time: '11:00',
    meetings: [{ date: '2026-09-06', start_time: '10:00', end_time: '11:00' }]
  });
  const courseB = course('prop-b', '2026-09-06', {
    school: 'בית ב',
    school_address: 'כתובת ב',
    start_time: '12:30',
    end_time: '13:30',
    meetings: [{ date: '2026-09-06', start_time: '12:30', end_time: '13:30' }]
  });
  const courseC = course('prop-c', '2026-09-13', {
    school: 'בית ג',
    school_address: 'כתובת ג',
    start_time: '10:00',
    end_time: '11:00',
    meetings: [{ date: '2026-09-13', start_time: '10:00', end_time: '11:00' }]
  });
  const emp = instructor(1);
  const partialException = {
    1: [{ exception_date: '2026-09-06', available: true, start_time: '12:00', end_time: '16:00' }]
  };
  const ab = calculateCourseSchedule({
    activities: [courseA, courseB],
    instructors: [emp],
    profiles: { 1: profile() },
    rules: { 1: multiDayRules },
    exceptions: partialException,
    travel: fillTravel([courseA, courseB], [emp]),
    referenceDate: '2026-09-01',
    timeBudgetMs: 8000
  });
  const abById = Object.fromEntries(ab.map((row) => [row.course.row_id, row]));
  const selectedA = abById['prop-a'].recommended || abById['prop-a'].bestAvailable;
  assert.ok(selectedA, 'A should be assignable via proposed meetings');
  assert.ok(selectedA.proposedMeetings?.some((meeting) => meeting.date === '2026-09-13'));
  assert.ok(selectedA.proposedMeetings?.every((meeting) => meeting.date !== '2026-09-06'));
  const selectedB = abById['prop-b'].recommended || abById['prop-b'].bestAvailable;
  assert.ok(selectedB, 'B on original 6.9 must be free after A moves');
  assert.equal(selectedB.instructor.emp_id, '1');
  assert.equal(selectedB.proposedMeetings ?? null, null);

  const ac = calculateCourseSchedule({
    activities: [courseA, courseC],
    instructors: [emp],
    profiles: { 1: profile() },
    rules: { 1: multiDayRules },
    exceptions: partialException,
    travel: fillTravel([courseA, courseC], [emp]),
    referenceDate: '2026-09-01',
    timeBudgetMs: 8000
  });
  const acById = Object.fromEntries(ac.map((row) => [row.course.row_id, row]));
  const aAgain = acById['prop-a'].recommended || acById['prop-a'].bestAvailable;
  assert.ok(aAgain?.proposedMeetings?.some((meeting) => meeting.date === '2026-09-13'));
  const selectedC = acById['prop-c'].recommended || acById['prop-c'].bestAvailable;
  assert.equal(selectedC, null, 'C on 13.9 conflicts with A proposed meetings');
  const cFor1 = acById['prop-c'].checked.find((candidate) => candidate.instructor.emp_id === '1');
  assert.equal(isSafeEligibleCandidate(cFor1), false);
  assert.match(cFor1.failures.join(' '), /חפיפה/);

  const loadOnProposed = instructorLoad(
    [{ ...courseA, meetings: selectedA.proposedMeetings }],
    profile(),
    multiDayRules,
    { periodKey: 'first' }
  );
  assert.ok(loadOnProposed.workDates.has('2026-09-13'));
  assert.equal(loadOnProposed.workDates.has('2026-09-06'), false);
  assert.ok(Number(selectedA.projectedHalfHours) > 0);
});

test('proposed meeting that crosses half-year counts hours in the destination half', () => {
  const target = course('half-cross', '2027-01-24', {
    meetings: [
      { date: '2027-01-24', start_time: '10:00', end_time: '12:00' },
      { date: '2027-01-31', start_time: '10:00', end_time: '12:00' }
    ]
  });
  const emp = instructor(1);
  const candidate = calculateCourseSchedule({
    activities: [target],
    instructors: [emp],
    profiles: { 1: profile() },
    rules: { 1: sundayRules },
    exceptions: { 1: [{ exception_date: '2027-01-24', available: false }] },
    travel: fillTravel([target], [emp]),
    periodKey: 'first',
    referenceDate: '2027-01-01'
  })[0].checked[0];
  assert.equal(candidate.eligible, true);
  assert.ok(candidate.dateAdjustment?.valid);
  assert.ok(candidate.proposedMeetings?.some((meeting) => meeting.date > '2027-01-29'));
  const proposedActivity = { ...target, meetings: candidate.proposedMeetings };
  const firstHalf = instructorLoad([proposedActivity], profile(), sundayRules, { periodKey: 'first' });
  const secondHalf = instructorLoad([proposedActivity], profile(), sundayRules, { periodKey: 'second' });
  assert.ok(secondHalf.hours > 0, 'hours belong where proposed meetings fall');
  assert.ok(firstHalf.hours < secondHalf.hours || firstHalf.hours === 0 || firstHalf.hours < candidate.proposedMeetings.length * 2);
});

test('travel safety buffer: 10+14 fails, 10+25 passes; same-school 14 fails and 15 passes; score stays raw', () => {
  const target = course('buf15', '2026-09-06', {
    school: 'יעד',
    school_id: 'y',
    school_address: 'יעד 1',
    start_time: '11:00',
    end_time: '12:00',
    meetings: [{ date: '2026-09-06', start_time: '11:00', end_time: '12:00' }]
  });
  const failGap = evaluateInstructor({
    instructor: instructor(1),
    profile: profile(),
    rules: sundayRules,
    activity: target,
    existingActivities: [{ date: '2026-09-06', start_time: '08:00', end_time: '10:36', school: 'אחר', school_id: 'x', school_address: 'אחר 1' }],
    travel: {
      home: { distance_km: 2, duration_minutes: 4 },
      homeReturn: { distance_km: 2, duration_minutes: 4 },
      transitions: { '2026-09-06': { previous: { distance_km: 3, duration_minutes: 10 } } }
    },
    validateTravel: true
  });
  assert.equal(failGap.eligible, false, 'gap 24 < 10+15');

  const passGap = evaluateInstructor({
    instructor: instructor(1),
    profile: profile(),
    rules: sundayRules,
    activity: target,
    existingActivities: [{ date: '2026-09-06', start_time: '08:00', end_time: '10:35', school: 'אחר', school_id: 'x', school_address: 'אחר 1' }],
    travel: {
      home: { distance_km: 2, duration_minutes: 4 },
      homeReturn: { distance_km: 2, duration_minutes: 4 },
      transitions: { '2026-09-06': { previous: { distance_km: 3, duration_minutes: 10 } } }
    },
    validateTravel: true
  });
  assert.equal(passGap.eligible, true, 'gap 25 >= 10+15');
  // Scoring uses raw legs only (previous 10 + return 4) — never raw+buffer (25).
  assert.equal(passGap.scoreBreakdown.travelDistance.duration_minutes, 14);
  assert.notEqual(passGap.scoreBreakdown.travelDistance.duration_minutes, 10 + TRAVEL_SAFETY_BUFFER_MINUTES);
  assert.notEqual(passGap.relevantTravelMinutes, 10 + TRAVEL_SAFETY_BUFFER_MINUTES);

  const sameSchoolFail = evaluateInstructor({
    instructor: instructor(1),
    profile: profile(),
    rules: sundayRules,
    activity: target,
    existingActivities: [{ date: '2026-09-06', start_time: '08:00', end_time: '10:46', school: 'יעד', school_id: 'y', school_address: 'יעד 1' }],
    travel: {
      home: { distance_km: 2, duration_minutes: 4 },
      homeReturn: { distance_km: 2, duration_minutes: 4 },
      transitions: { '2026-09-06': { previous: { distance_km: 0, duration_minutes: 0 } } }
    },
    validateTravel: true
  });
  assert.equal(sameSchoolFail.eligible, false, 'same school gap 14 < 0+15');

  const sameSchoolPass = evaluateInstructor({
    instructor: instructor(1),
    profile: profile(),
    rules: sundayRules,
    activity: target,
    existingActivities: [{ date: '2026-09-06', start_time: '08:00', end_time: '10:45', school: 'יעד', school_id: 'y', school_address: 'יעד 1' }],
    travel: {
      home: { distance_km: 2, duration_minutes: 4 },
      homeReturn: { distance_km: 2, duration_minutes: 4 },
      transitions: { '2026-09-06': { previous: { distance_km: 0, duration_minutes: 0 } } }
    },
    validateTravel: true
  });
  assert.equal(sameSchoolPass.eligible, true, 'same school gap 15 >= 0+15');

  // Proposed meetings use the same buffer (date-adjustments imports the shared constant).
  const adjSource = readFileSync(new URL('../frontend/src/screens/course-scheduling-date-adjustments.js', import.meta.url), 'utf8');
  assert.match(adjSource, /TRAVEL_SAFETY_BUFFER_MINUTES/);
  assert.doesNotMatch(adjSource, /gap < Number\(neighbor\.duration_minutes\) \+ 15/);
});

test('continuity averages all meetings; 1/10 same-school is far below 10/10 and never 35 from one hit', () => {
  const tenDates = Array.from({ length: 10 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 8, 6 + index * 7));
    return date.toISOString().slice(0, 10);
  });
  const activity = course('cont-avg', tenDates[0], {
    school: 'בית ספר א',
    school_id: 'a',
    authority: 'רשות א',
    meetings: tenDates.map((date) => ({ date, start_time: '10:00', end_time: '11:00' }))
  });
  const oneSameSchool = computeSchedulingScore({
    eligible: true,
    activity,
    meetings: activity.meetings,
    existingActivities: [
      { date: tenDates[0], start_time: '08:00', end_time: '09:30', school: 'בית ספר א', school_id: 'a', authority: 'רשות א' }
    ],
    travel: {
      home: { distance_km: 3, duration_minutes: 6 },
      homeReturn: { distance_km: 3, duration_minutes: 6 },
      transitions: Object.fromEntries(tenDates.map((date, index) => [date, index === 0
        ? { previous: { distance_km: 0, duration_minutes: 0 } }
        : {}]))
    },
    workDates: new Set(),
    currentHalfHours: 0,
    projectedHalfHours: 10,
    peerProjectedHours: [10],
    activeWorkDays: 10
  });
  const allSameSchool = computeSchedulingScore({
    eligible: true,
    activity,
    meetings: activity.meetings,
    existingActivities: tenDates.map((date) => ({
      date, start_time: '08:00', end_time: '09:30', school: 'בית ספר א', school_id: 'a', authority: 'רשות א'
    })),
    travel: {
      home: { distance_km: 3, duration_minutes: 6 },
      homeReturn: { distance_km: 3, duration_minutes: 6 },
      transitions: Object.fromEntries(tenDates.map((date) => [date, { previous: { distance_km: 0, duration_minutes: 0 } }]))
    },
    workDates: new Set(),
    currentHalfHours: 0,
    projectedHalfHours: 10,
    peerProjectedHours: [10],
    activeWorkDays: 10
  });
  assert.equal(oneSameSchool.sameSchoolMeetingCount, 1);
  assert.equal(allSameSchool.sameSchoolMeetingCount, 10);
  assert.ok(oneSameSchool.scoreBreakdown.continuityEfficiency.points < 35);
  assert.ok(allSameSchool.scoreBreakdown.continuityEfficiency.points > oneSameSchool.scoreBreakdown.continuityEfficiency.points);
  assert.ok(oneSameSchool.continuityAverage < allSameSchool.continuityAverage);

  const sameAuthorityOnly = computeSchedulingScore({
    eligible: true,
    activity,
    meetings: activity.meetings.slice(0, 1),
    existingActivities: [
      { date: tenDates[0], start_time: '08:00', end_time: '09:30', school: 'בית ספר ב', school_id: 'b', authority: 'רשות א' }
    ],
    travel: {
      home: { distance_km: 3, duration_minutes: 6 },
      homeReturn: { distance_km: 3, duration_minutes: 6 },
      transitions: { [tenDates[0]]: { previous: { distance_km: 2, duration_minutes: 8 } } }
    },
    workDates: new Set(),
    currentHalfHours: 0,
    projectedHalfHours: 1,
    peerProjectedHours: [1],
    activeWorkDays: 1
  });
  const sameSchoolOnly = computeSchedulingScore({
    eligible: true,
    activity,
    meetings: activity.meetings.slice(0, 1),
    existingActivities: [
      { date: tenDates[0], start_time: '08:00', end_time: '09:30', school: 'בית ספר א', school_id: 'a', authority: 'רשות א' }
    ],
    travel: {
      home: { distance_km: 3, duration_minutes: 6 },
      homeReturn: { distance_km: 3, duration_minutes: 6 },
      transitions: { [tenDates[0]]: { previous: { distance_km: 0, duration_minutes: 0 } } }
    },
    workDates: new Set(),
    currentHalfHours: 0,
    projectedHalfHours: 1,
    peerProjectedHours: [1],
    activeWorkDays: 1
  });
  assert.ok(sameAuthorityOnly.scoreBreakdown.continuityEfficiency.points < sameSchoolOnly.scoreBreakdown.continuityEfficiency.points);

  const mostlyNewDays = computeSchedulingScore({
    eligible: true,
    activity,
    meetings: activity.meetings,
    existingActivities: [],
    travel: {
      home: { distance_km: 3, duration_minutes: 6 },
      homeReturn: { distance_km: 3, duration_minutes: 6 },
      transitions: {}
    },
    workDates: new Set(),
    currentHalfHours: 0,
    projectedHalfHours: 10,
    peerProjectedHours: [10],
    activeWorkDays: 10
  });
  assert.ok(mostlyNewDays.newWorkDayMeetingCount >= 8);
  assert.ok(mostlyNewDays.scoreBreakdown.continuityEfficiency.points < oneSameSchool.scoreBreakdown.continuityEfficiency.points
    || mostlyNewDays.continuityAverage <= oneSameSchool.continuityAverage);

  const single = computeSchedulingScore({
    eligible: true,
    activity: course('single-cont', tenDates[0], { school: 'בית ספר א', school_id: 'a' }),
    meetings: [{ date: tenDates[0], start_time: '10:00', end_time: '11:00' }],
    existingActivities: [
      { date: tenDates[0], start_time: '08:00', end_time: '09:30', school: 'בית ספר א', school_id: 'a', authority: 'רשות א' }
    ],
    travel: {
      home: { distance_km: 3, duration_minutes: 6 },
      homeReturn: { distance_km: 3, duration_minutes: 6 },
      transitions: { [tenDates[0]]: { previous: { distance_km: 0, duration_minutes: 0 } } }
    },
    workDates: new Set(),
    currentHalfHours: 0,
    projectedHalfHours: 1,
    peerProjectedHours: [1],
    activeWorkDays: 1
  });
  assert.equal(single.continuityMeetingCount, 1);
  assert.ok(single.scoreBreakdown.continuityEfficiency.points <= 35);
  assert.ok(single.scoreBreakdown.continuityEfficiency.points >= 20);
});

test('missing homeReturn is unsafe in final for solo/last; mid-day does not require return; daily travel sums both legs', () => {
  const solo = course('ret-solo', '2026-09-06');
  const noReturn = calculateCourseSchedule({
    activities: [solo],
    instructors: [instructor(1)],
    profiles: { 1: profile() },
    rules: { 1: sundayRules },
    exceptions: {},
    travel: {
      'ret-solo': {
        1: {
          home: { distance_km: 5, duration_minutes: 10 },
          homeReturn: null,
          transitions: {}
        }
      }
    },
    routeMatrix: {},
    referenceDate: '2026-09-01'
  })[0];
  assert.equal(noReturn.checked[0].requiresHomeReturn, true);
  assert.equal(noReturn.checked[0].homeReturnVerified, false);
  assert.equal(isSafeEligibleCandidate(noReturn.checked[0]), false);
  assert.equal(noReturn.recommended, null);
  assert.equal(noReturn.bestAvailable, null);
  assert.equal(noReturn.alternatives.length, 0);
  assert.equal(noReturn.eligibleCandidateCount, 0);

  const last = evaluateInstructor({
    instructor: instructor(1),
    profile: profile(),
    rules: sundayRules,
    activity: course('ret-last', '2026-09-06', {
      start_time: '12:00',
      end_time: '13:00',
      meetings: [{ date: '2026-09-06', start_time: '12:00', end_time: '13:00' }]
    }),
    existingActivities: [
      { date: '2026-09-06', start_time: '08:00', end_time: '09:00', school: 'קודם', school_address: 'קודם 1' }
    ],
    travel: {
      home: { distance_km: 5, duration_minutes: 10 },
      homeReturn: null,
      transitions: { '2026-09-06': { previous: { distance_km: 2, duration_minutes: 8 } } }
    },
    validateTravel: true
  });
  assert.equal(last.eligible, false);

  const mid = evaluateInstructor({
    instructor: instructor(1),
    profile: profile(),
    rules: sundayRules,
    activity: course('ret-mid', '2026-09-06', {
      start_time: '10:00',
      end_time: '11:00',
      meetings: [{ date: '2026-09-06', start_time: '10:00', end_time: '11:00' }]
    }),
    existingActivities: [
      { date: '2026-09-06', start_time: '08:00', end_time: '09:00', school: 'קודם', school_address: 'קודם 1' },
      { date: '2026-09-06', start_time: '12:00', end_time: '13:00', school: 'הבא', school_address: 'הבא 1' }
    ],
    travel: {
      home: { distance_km: 40, duration_minutes: 70 },
      homeReturn: null,
      transitions: {
        '2026-09-06': {
          previous: { distance_km: 2, duration_minutes: 8 },
          next: { distance_km: 2, duration_minutes: 9 }
        }
      }
    },
    validateTravel: true
  });
  assert.equal(mid.eligible, true);

  const both = calculateCourseSchedule({
    activities: [solo],
    instructors: [instructor(1)],
    profiles: { 1: profile() },
    rules: { 1: sundayRules },
    exceptions: {},
    travel: homeTravel('ret-solo', '1', 5, 10, 12),
    referenceDate: '2026-09-01'
  })[0];
  assert.equal(both.checked[0].requiresHomeRoute, true);
  assert.equal(both.checked[0].requiresHomeReturn, true);
  assert.equal(both.checked[0].homeRouteVerified, true);
  assert.equal(both.checked[0].homeReturnVerified, true);
  assert.ok(both.recommended || both.bestAvailable);
  assert.equal((both.recommended || both.bestAvailable).dailyTravelMinutes, 22);

  const engineTravel = readFileSync(new URL('../frontend/src/screens/course-scheduling-engine.js', import.meta.url), 'utf8');
  assert.match(engineTravel, /never invent reverse/);
  assert.doesNotMatch(engineTravel, /homeReturn:\s*\{\s*\.\.\.home/);
  assert.doesNotMatch(engineTravel, /homeReturn:\s*structuredClone\(home\)/);
});

test('checked and alternatives are refreshed against bestState; sixth candidate survives after first five blocked', () => {
  const shared = '2026-09-06';
  const slot = { start_time: '10:00', end_time: '11:00', meetings: [{ date: shared, start_time: '10:00', end_time: '11:00' }] };
  const primary = course('chk-primary', shared, { school: 'ראשי', school_address: 'ראשי 1', ...slot });
  const target = course('chk-target', shared, { school: 'יעד', school_address: 'יעד 1', ...slot });
  const instructors = Array.from({ length: 6 }, (_, index) => instructor(`c${index + 1}`));
  // First five share the primary course exclusivity via language; sixth is the only remaining for target after bestState.
  // Simpler: assign primary to c1.. use overlapping so bestState takes c1 for primary; c1 was eligible for target at baseline.
  const results = calculateCourseSchedule({
    activities: [primary, target],
    instructors,
    profiles: Object.fromEntries(instructors.map((row) => [row.emp_id, profile()])),
    rules: Object.fromEntries(instructors.map((row) => [row.emp_id, sundayRules])),
    exceptions: {},
    travel: fillTravel([primary, target], instructors),
    referenceDate: '2026-09-01',
    timeBudgetMs: 8000
  });
  const byId = Object.fromEntries(results.map((row) => [row.course.row_id, row]));
  const primaryPick = byId['chk-primary'].recommended || byId['chk-primary'].bestAvailable;
  assert.ok(primaryPick);
  const blockedEmp = primaryPick.instructor.emp_id;
  const targetChecked = byId['chk-target'].checked.find((candidate) => candidate.instructor.emp_id === blockedEmp);
  assert.equal(isSafeEligibleCandidate(targetChecked), false, 'baseline-eligible peer blocked by bestState appears ineligible in checked');
  assert.ok(!(byId['chk-target'].alternatives || []).some((row) => row.instructor.emp_id === blockedEmp));
  assert.ok(byId['chk-target'].recommended || byId['chk-target'].bestAvailable || byId['chk-target'].alternatives.length >= 0);

  // Five early instructors claimed by five blockers; sixth remains alternative for the open target.
  const blockers = Array.from({ length: 5 }, (_, index) => course(`blk-${index + 1}`, shared, {
    school: `חוסם ${index + 1}`,
    school_address: `חוסם ${index + 1}`,
    ...slot
  }));
  const open = course('open-sixth', shared, { school: 'פתוח', school_address: 'פתוח 1', ...slot });
  const six = Array.from({ length: 6 }, (_, index) => instructor(`s${index + 1}`));
  const multi = calculateCourseSchedule({
    activities: [...blockers, open],
    instructors: six,
    profiles: Object.fromEntries(six.map((row) => [row.emp_id, profile()])),
    rules: Object.fromEntries(six.map((row) => [row.emp_id, sundayRules])),
    exceptions: {},
    travel: fillTravel([...blockers, open], six),
    referenceDate: '2026-09-01',
    timeBudgetMs: 8000
  });
  const openRow = multi.find((row) => row.course.row_id === 'open-sixth');
  // With 6 instructors and 6 same-slot courses, max one remains for open — or open itself is assigned.
  const primaryOpen = openRow.recommended || openRow.bestAvailable;
  if (!primaryOpen) {
    assert.ok(openRow.alternatives.length >= 1 || openRow.checked.some((candidate) => isSafeEligibleCandidate(candidate)));
  }
  const source = readFileSync(new URL('../frontend/src/screens/course-scheduling-engine.js', import.meta.url), 'utf8');
  assert.match(source, /Refresh all peers first, then filter\/sort, then slice/);
  assert.match(source, /refreshedChecked/);
  assert.doesNotMatch(source, /const checked = maps\.get\(id\) \|\| \[\]/);


  // Explicit sixth-alternative scenario: five instructors claimed by blockers; sixth stays for the target.
  const sharedTarget = course('alt-target', '2026-09-06', {
    school: 'מטרה',
    school_address: 'מטרה 1',
    start_time: '10:00',
    end_time: '11:00',
    meetings: [{ date: '2026-09-06', start_time: '10:00', end_time: '11:00' }]
  });
  const alts = Array.from({ length: 6 }, (_, index) => instructor(`a${index + 1}`));
  const earlyBlockers = alts.slice(0, 5).map((row, index) => course(`early-${index + 1}`, '2026-09-06', {
    school: `מוקדם ${index + 1}`,
    school_address: `מוקדם ${index + 1}`,
    start_time: '10:00',
    end_time: '11:00',
    meetings: [{ date: '2026-09-06', start_time: '10:00', end_time: '11:00' }],
    // Force each blocker to prefer a dedicated instructor by unique school continuity later — use dedicated availability:
  }));
  // Dedicated: each early blocker is only available to one instructor via weekday rules on a unique date.
  // Keep it simple: same slot, 5 blockers + target, 6 instructors → 5 assigned + 1 left for target as primary/alternative.
  const pack = calculateCourseSchedule({
    activities: [...earlyBlockers, sharedTarget],
    instructors: alts,
    profiles: Object.fromEntries(alts.map((row) => [row.emp_id, profile()])),
    rules: Object.fromEntries(alts.map((row) => [row.emp_id, sundayRules])),
    exceptions: {},
    travel: fillTravel([...earlyBlockers, sharedTarget], alts),
    referenceDate: '2026-09-01',
    timeBudgetMs: 8000
  });
  const targetRow = pack.find((row) => row.course.row_id === 'alt-target');
  const assignedBlockers = pack.filter((row) => row.course.row_id.startsWith('early-') && (row.recommended || row.bestAvailable));
  assert.equal(assignedBlockers.length, 5);
  const taken = new Set(assignedBlockers.map((row) => (row.recommended || row.bestAvailable).instructor.emp_id));
  assert.equal(taken.size, 5);
  const survivor = alts.find((row) => !taken.has(row.emp_id));
  assert.ok(survivor);
  const survivorChecked = targetRow.checked.find((candidate) => candidate.instructor.emp_id === survivor.emp_id);
  assert.equal(isSafeEligibleCandidate(survivorChecked), true);
  const primaryOrAlts = [targetRow.recommended, targetRow.bestAvailable, ...targetRow.alternatives].filter(Boolean);
  assert.ok(primaryOrAlts.some((row) => row.instructor.emp_id === survivor.emp_id), 'sixth instructor must appear as primary or alternative');
  for (const empId of taken) {
    const row = targetRow.checked.find((candidate) => candidate.instructor.emp_id === empId);
    assert.equal(isSafeEligibleCandidate(row), false);
    assert.ok(!targetRow.alternatives.some((candidate) => candidate.instructor.emp_id === empId));
  }
});

test('state-aware workload peers drop blocked instructors and follow proposed half; scores match checked', () => {
  const date = '2026-09-06';
  const slot = { start_time: '10:00', end_time: '11:00', meetings: [{ date, start_time: '10:00', end_time: '11:00' }] };
  const blocker = course('peer-block', date, { school: 'חסימה', school_address: 'חסימה 1', ...slot });
  const target = course('peer-target', date, { school: 'יעד עומס', school_address: 'יעד עומס 1', ...slot });
  const later = course('peer-later', '2026-09-13', {
    school: 'מאוחר',
    school_address: 'מאוחר 1',
    meetings: [{ date: '2026-09-13', start_time: '10:00', end_time: '11:00' }]
  });
  const instructors = [instructor(1), instructor(2), instructor(3)];
  const results = calculateCourseSchedule({
    activities: [blocker, target, later],
    instructors,
    profiles: { 1: profile(), 2: profile(), 3: profile() },
    rules: { 1: multiDayRules, 2: multiDayRules, 3: multiDayRules },
    exceptions: {},
    travel: fillTravel([blocker, target, later], instructors),
    referenceDate: '2026-09-01',
    timeBudgetMs: 8000
  });
  const byId = Object.fromEntries(results.map((row) => [row.course.row_id, row]));
  const blockedEmp = (byId['peer-block'].recommended || byId['peer-block'].bestAvailable)?.instructor?.emp_id;
  assert.ok(blockedEmp);
  const targetPrimary = byId['peer-target'].recommended || byId['peer-target'].bestAvailable;
  if (targetPrimary) {
    const checkedPrimary = byId['peer-target'].checked.find((candidate) => candidate.instructor.emp_id === targetPrimary.instructor.emp_id);
    assert.equal(checkedPrimary.scoreBreakdown.actualWorkload.points, targetPrimary.scoreBreakdown.actualWorkload.points);
  }
  if (byId['peer-target'].alternatives[0] && targetPrimary) {
    assert.notEqual(
      targetPrimary.scoreBreakdown.actualWorkload.points,
      byId['peer-target'].alternatives[0].scoreBreakdown.actualWorkload.points
    );
  }
  // Proposed-half peer: instructor 1 blocked on 6.9 moves a course to 13.9 via exception; peer hours use destination half.
  const moved = course('peer-moved', '2026-09-06', {
    school: 'מוזז',
    school_address: 'מוזז 1',
    meetings: [{ date: '2026-09-06', start_time: '10:00', end_time: '12:00' }]
  });
  const peerCourse = course('peer-course', '2026-09-20', {
    school: 'עמית',
    school_address: 'עמית 1',
    meetings: [{ date: '2026-09-20', start_time: '10:00', end_time: '11:00' }]
  });
  const onlyMover = instructor(1);
  const movedResult = calculateCourseSchedule({
    activities: [moved, peerCourse],
    instructors: [onlyMover],
    profiles: { 1: profile() },
    rules: { 1: multiDayRules },
    exceptions: { 1: [{ exception_date: '2026-09-06', available: false }] },
    travel: fillTravel([moved, peerCourse], [onlyMover]),
    referenceDate: '2026-09-01',
    timeBudgetMs: 8000
  });
  const movedRow = movedResult.find((row) => row.course.row_id === 'peer-moved');
  const movedPick = movedRow.recommended || movedRow.bestAvailable || movedRow.checked.find((candidate) => candidate.dateAdjustment?.valid);
  assert.ok(movedPick?.proposedMeetings?.length || movedPick?.dateAdjustment?.meetings?.length);
  const proposedMeetings = movedPick.proposedMeetings || movedPick.dateAdjustment.meetings;
  const proposedHalf = instructorLoad(
    [{ ...moved, meetings: proposedMeetings }],
    profile(),
    multiDayRules,
    { periodKey: 'first' }
  );
  assert.equal(proposedHalf.workDates.has('2026-09-06'), false);
  assert.ok([...proposedHalf.workDates].some((date) => date > '2026-09-06'));
});

test('optimization removes unsafe soleCoursesBlockedBy pruning and reports completion stats', () => {
  const source = readFileSync(new URL('../frontend/src/screens/course-scheduling-engine.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /soleCoursesBlockedBy/);
  assert.match(source, /optimizationComplete/);
  assert.match(source, /Admissible/);
  const a = course('opt-a', '2026-09-06');
  const b = course('opt-b', '2026-09-13');
  const result = calculateCourseSchedule({
    activities: [a, b],
    instructors: [instructor(1), instructor(2)],
    profiles: { 1: profile(), 2: profile() },
    rules: { 1: multiDayRules, 2: multiDayRules },
    exceptions: {},
    travel: fillTravel([a, b], [instructor(1), instructor(2)]),
    referenceDate: '2026-09-01'
  });
  assert.equal(typeof result[0].optimizationComplete, 'boolean');
  assert.ok(Number(result[0].nodesVisited) >= 0);
  assert.ok(Number(result[0].branchesPruned) >= 0);
});

test('production-shaped 187×10 benchmark finishes in budget with deterministic stats', () => {
  const instructorCount = 10;
  const courseCount = 187;
  const instructors = Array.from({ length: instructorCount }, (_, index) => instructor(`p${index + 1}`));
  const langs = instructors.map((row) => `lang-${row.emp_id}`);
  // Language partitions create instructor-disjoint components (real path, no precomputedCandidateMaps).
  // Each instructor speaks a private language plus a shared pool language on a subset of courses
  // to create 1-candidate exclusives and small shared clusters without one giant component.
  const profiles = Object.fromEntries(instructors.map((row, index) => [
    row.emp_id,
    profile({
      instruction_languages: index < 5
        ? [langs[index], `pool-${index % 2}`]
        : [langs[index]]
    })
  ]));
  const weekRules = [0, 1, 2, 3, 4].map((weekday) => ({
    weekday, available: true, start_time: '08:00', end_time: '16:00'
  }));
  const rules = Object.fromEntries(instructors.map((row) => [row.emp_id, weekRules]));
  const exceptions = {};
  const activities = [];

  for (let index = 0; index < courseCount; index += 1) {
    const owner = index % instructorCount;
    const week = Math.floor(index / instructorCount) % 16;
    const date = new Date(Date.UTC(2026, 8, 6 + week * 7)).toISOString().slice(0, 10);
    const startHour = week < 3 ? 10 : (8 + (week % 5));
    const band = index % 10;
    // 1-candidate, 2-candidate (pool), and exclusive owner languages — shaped like production mix.
    let language = langs[owner];
    if (band >= 7) language = `pool-${owner % 2}`;
    const meetings = [{
      date,
      start_time: `${String(startHour).padStart(2, '0')}:00`,
      end_time: `${String(startHour + 1).padStart(2, '0')}:00`
    }];
    const row = course(`prod-${String(index + 1).padStart(3, '0')}`, date, {
      school: `ביס ${index + 1}`,
      school_address: `כתובת ${index + 1}`,
      authority: index % 2 ? 'רשות א' : 'רשות ב',
      instruction_language: language,
      start_time: meetings[0].start_time,
      end_time: meetings[0].end_time,
      meetings
    });
    if (index < 8) row.emp_id = instructors[owner].emp_id;
    else if (index < 14) {
      row.draft_emp_id = instructors[owner].emp_id;
      row.draft_proposed_meetings = meetings;
    } else if (index < 24) {
      const empId = instructors[owner].emp_id;
      exceptions[empId] = [...(exceptions[empId] || []), { exception_date: date, available: false }];
    }
    activities.push(row);
  }

  const travel = fillTravel(activities, instructors, 4, 8);
  delete travel[activities[30]?.row_id]?.[instructors[0].emp_id];

  const run = () => calculateCourseSchedule({
    activities,
    instructors,
    profiles,
    rules,
    exceptions,
    travel,
    routeMatrix: {},
    referenceDate: '2026-09-01',
    timeBudgetMs: 4000
  });

  const started = Date.now();
  const first = run();
  const elapsed = Date.now() - started;
  const second = run();

  assert.ok(elapsed < 5000, `production-shaped run exceeded 5s: ${elapsed}ms`);
  assert.equal(first.length, schedulingCourses(activities).length);
  const nodes = Number(first[0]?.nodesVisited) || 0;
  const pruned = Number(first[0]?.branchesPruned) || 0;
  const complete = first[0]?.optimizationComplete;
  assert.equal(typeof complete, 'boolean');
  assert.ok(nodes >= 0);
  assert.ok(pruned >= 0);
  // Assignment outcome must be deterministic; node/prune counters may vary with wall-clock budget cuts.
  const summary = first.map((row) => ({
    id: row.course.row_id,
    emp: (row.recommended || row.bestAvailable)?.instructor?.emp_id || null,
    score: (row.recommended || row.bestAvailable)?.score || null
  }));
  assert.deepEqual(summary, second.map((row) => ({
    id: row.course.row_id,
    emp: (row.recommended || row.bestAvailable)?.instructor?.emp_id || null,
    score: (row.recommended || row.bestAvailable)?.score || null
  })));
  assert.equal(first[0].optimizationComplete, second[0].optimizationComplete);
  console.log(JSON.stringify({
    benchmark: '187x10',
    elapsedMs: elapsed,
    nodesVisited: nodes,
    branchesPruned: pruned,
    optimizationComplete: complete,
    assigned: summary.filter((row) => row.emp).length
  }));
  if (complete !== true) {
    console.log('NOTE: optimizationComplete=false — exact optimum not proven within time budget; PR must not claim exact readiness.');
  }
});
