import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCourseSchedule } from '../frontend/src/screens/course-scheduling-engine.js';
import {
  evaluateInstructor,
  MAX_HOME_DISTANCE_KM,
  exceedsHomeDistanceLimit,
  homeDistanceLimitFailureMessage
} from '../frontend/src/screens/instructor-matching-engine.js';
import {
  SCORE_WEIGHTS,
  assertScoreWeightsTotal,
  computeSchedulingScore,
  formatWorkloadHours,
  NEUTRAL_CONTINUITY_NOTE,
  NEUTRAL_CONTINUITY_POINTS,
  NEUTRAL_GAPS_POINTS
} from '../frontend/src/screens/course-scheduling-score.js';
import {
  actionDisabledReason,
  candidateHardBlockReason,
  detailsHtml,
  instructorsResultsHtml
} from '../frontend/src/screens/course-scheduling.js';

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
const nearbyInstructor = {
  emp_id: '200',
  full_name: 'נועה כהן',
  active: 'yes',
  address: 'הרצל 10, נתניה'
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

function mergeTravel(...parts) {
  const merged = {};
  for (const part of parts) {
    for (const [courseId, byEmp] of Object.entries(part || {})) {
      merged[courseId] = { ...(merged[courseId] || {}), ...byEmp };
    }
  }
  return merged;
}

function scheduleInput({
  activities = [course('c1')],
  instructors = [instructor],
  travel = travelFor('c1', '100', { distance_km: 12, duration_minutes: 18 }),
  assignments = {},
  profiles = { 100: profile }
} = {}) {
  return {
    activities,
    instructors,
    profiles,
    rules: Object.fromEntries(instructors.map((row) => [row.emp_id, weekdayRules])),
    exceptions: {},
    assignments,
    travel,
    routeMatrix: {},
    referenceDate: '2026-09-01'
  };
}

function checkedByEmp(result, empId) {
  return (result.checked || []).find((item) => String(item.instructor?.emp_id) === String(empId));
}

test('1-4: home distance eligibility boundary is inclusive at 40 km', () => {
  for (const [km, eligible] of [[39.9, true], [40, true], [40.1, false], [135, false]]) {
    const result = calculateCourseSchedule(scheduleInput({
      travel: travelFor('c1', '100', { distance_km: km, duration_minutes: 40 })
    }))[0];
    const candidate = checkedByEmp(result, '100');
    assert.equal(candidate.eligible, eligible, `${km} km eligible=${eligible}`);
    if (!eligible) {
      assert.match(candidate.failures.join(' '), new RegExp(`מגבלה של ${MAX_HOME_DISTANCE_KM}`));
      assert.match(candidate.failures.join(' '), new RegExp(String(Math.round(km))));
    }
  }
});

test('5-7: rejected-distance candidate never recommended/bestAvailable/alternatives and shows real km', () => {
  const far = { distance_km: 135, duration_minutes: 120 };
  const near = { distance_km: 8, duration_minutes: 12 };
  const result = calculateCourseSchedule(scheduleInput({
    instructors: [instructor, nearbyInstructor],
    profiles: { 100: profile, 200: profile },
    travel: mergeTravel(
      travelFor('c1', '100', far),
      travelFor('c1', '200', near)
    )
  }))[0];
  const rejected = checkedByEmp(result, '100');
  assert.equal(rejected.eligible, false);
  assert.equal(result.recommended?.instructor?.emp_id, '200');
  assert.equal(result.bestAvailable, null);
  assert.ok(!(result.alternatives || []).some((item) => item.instructor.emp_id === '100'));
  assert.equal(homeDistanceLimitFailureMessage(135), 'מרחק הנסיעה לבית הספר הוא 135 ק״מ ועולה על המגבלה של 40 ק״מ');
  assert.match(rejected.failures.join(' '), /מרחק הנסיעה לבית הספר הוא 135 ק״מ ועולה על המגבלה של 40 ק״מ/);
  const html = detailsHtml(result);
  assert.match(html, /data-rejected-candidate="100"/);
  assert.match(html, /מרחק הנסיעה לבית הספר הוא 135 ק״מ ועולה על המגבלה של 40 ק״מ/);
  assert.doesNotMatch(html, /data-alternatives[\s\S]*data-candidate-row="100"/);
});

test('8: unknown/null home route is missing data and not eligible (no invented distance)', () => {
  const result = evaluateInstructor({
    instructor,
    profile,
    rules: weekdayRules,
    activity: course('c1'),
    travel: { home: null, transitions: {} },
    validateTravel: true
  });
  assert.equal(result.eligible, false);
  assert.ok(result.missingProfileData.some((item) => /מסלול/.test(item)));
  assert.equal(result.checks.travel.passed, false);
  assert.match(result.checks.travel.reason || result.checks.travel.label, /מסלול|מרחק/);
  assert.equal(exceedsHomeDistanceLimit(null), false);
  assert.equal(exceedsHomeDistanceLimit(undefined), false);
});

test('9: recommendation still flags distance while a manager can persist a manual choice', () => {
  const stale = {
    instructor,
    eligible: true,
    score: 90,
    travel: { home: { distance_km: 55.4, duration_minutes: 70 } },
    checks: { language: { passed: true }, gender: { passed: true }, availability: { passed: true } }
  };
  const reason = candidateHardBlockReason(stale);
  assert.match(reason, /מרחק הנסיעה לבית הספר הוא 55 ק״מ ועולה על המגבלה של 40 ק״מ/);
  assert.equal(actionDisabledReason({ candidate: stale, canEdit: true }), '');
  assert.equal(actionDisabledReason({
    candidate: {
      ...stale,
      eligible: true,
      travel: { home: { distance_km: 40, duration_minutes: 55 } }
    },
    canEdit: true
  }), '');
});

test('10-12: first schedule without half-year history uses neutral continuity 18/35 and gaps 5/5', () => {
  const result = calculateCourseSchedule(scheduleInput({
    travel: travelFor('c1', '100', { distance_km: 10, duration_minutes: 15 })
  }))[0];
  const primary = result.recommended || result.bestAvailable;
  assert.ok(primary);
  assert.equal(primary.scoreBreakdown.continuityEfficiency.points, NEUTRAL_CONTINUITY_POINTS);
  assert.equal(primary.scoreBreakdown.gapsAndNewDays.points, NEUTRAL_GAPS_POINTS);
  assert.equal(primary.scoreBreakdown.continuityEfficiency.note, NEUTRAL_CONTINUITY_NOTE);
  assert.match(detailsHtml(result), /טרם קיים סידור עבודה להשוואת רציפות/);
});

test('13-14: second planningDraft course and existing approved/draft use real continuity scoring', () => {
  const first = course('plan-a');
  // Use non-overlapping weekdays so transition verification is not required between planned courses.
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
  const travel = mergeTravel(
    travelFor('plan-a', '100', { distance_km: 6, duration_minutes: 10 }),
    travelFor('plan-b', '100', { distance_km: 6, duration_minutes: 10 })
  );
  const planned = calculateCourseSchedule(scheduleInput({
    activities: [first, second],
    travel
  }));
  const firstPrimary = planned.find((row) => row.course.row_id === 'plan-a');
  const secondPrimary = planned.find((row) => row.course.row_id === 'plan-b');
  const firstPick = firstPrimary.recommended || firstPrimary.bestAvailable;
  const secondPick = secondPrimary.recommended || secondPrimary.bestAvailable;
  assert.ok(firstPick, 'first course should have a primary candidate');
  assert.ok(secondPick, 'second course should have a primary candidate');
  assert.equal(firstPick.scoreBreakdown.continuityEfficiency.points, NEUTRAL_CONTINUITY_POINTS);
  assert.equal(firstPick.scoreBreakdown.continuityEfficiency.neutralBaseline, true);
  assert.notEqual(secondPick.scoreBreakdown.continuityEfficiency.neutralBaseline, true);
  assert.notEqual(secondPick.scoreBreakdown.continuityEfficiency.note, NEUTRAL_CONTINUITY_NOTE);

  const approved = course('approved', {
    emp_id: '100',
    instructor_assignment_locked: true,
    school: 'תורני ואולפנת בר אילן',
    school_id: 'school-a',
    meetings: [{ date: '2026-09-06', start_time: '08:00', end_time: '09:00' }]
  });
  const withApproved = calculateCourseSchedule(scheduleInput({
    activities: [course('open-1'), approved],
    travel: travelFor('open-1', '100', { distance_km: 5, duration_minutes: 9 }),
    assignments: { 100: [approved] }
  }))[0];
  const approvedPick = withApproved.recommended || withApproved.bestAvailable;
  assert.ok(approvedPick);
  assert.notEqual(approvedPick.scoreBreakdown.continuityEfficiency.neutralBaseline, true);
  assert.notEqual(approvedPick.scoreBreakdown.continuityEfficiency.note, NEUTRAL_CONTINUITY_NOTE);
  // One same-school meeting among several yields a real averaged continuity score (not the empty-schedule baseline).
  assert.ok((approvedPick.sameSchoolMeetingCount || approvedPick.scoreBreakdown.continuityEfficiency.sameSchoolMeetingCount) >= 1);
  assert.ok(approvedPick.scoreBreakdown.continuityEfficiency.points > 0);
  assert.notEqual(approvedPick.scoreBreakdown.continuityEfficiency.points, NEUTRAL_CONTINUITY_POINTS);
});

test('15: total score weights still equal 100', () => {
  assert.equal(assertScoreWeightsTotal(), true);
  assert.equal(Object.values(SCORE_WEIGHTS).reduce((sum, value) => sum + value, 0), 100);
});

test('16-17: single failure renders once; additional failures only after primary', () => {
  const single = {
    instructor,
    eligible: false,
    score: null,
    failures: ['אין זמן מעבר מספיק מהפעילות הקודמת - משפיע על מפגש אחד'],
    missingProfileData: [],
    checks: {},
    travel: { home: { distance_km: 5, duration_minutes: 8 } }
  };
  const singleHtml = instructorsResultsHtml({
    course: course('c1', { required_instructor_gender: 'any' }),
    status: 'נדרש גיוס',
    recommended: null,
    bestAvailable: null,
    alternatives: [],
    checked: [single]
  });
  const phrase = 'אין זמן מעבר מספיק מהפעילות הקודמת - משפיע על מפגש אחד';
  assert.equal((singleHtml.match(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 1);
  assert.doesNotMatch(singleHtml, /course-scheduling-rejected-failures/);

  const multi = {
    ...single,
    failures: ['סיבה ראשית', 'סיבה שנייה', 'סיבה שלישית']
  };
  const multiHtml = instructorsResultsHtml({
    course: course('c1', { required_instructor_gender: 'any' }),
    status: 'נדרש גיוס',
    recommended: null,
    bestAvailable: null,
    alternatives: [],
    checked: [multi]
  });
  assert.match(multiHtml, /course-scheduling-rejected-primary">סיבה ראשית/);
  assert.match(multiHtml, /course-scheduling-rejected-failures/);
  assert.match(multiHtml, /<li>סיבה שנייה<\/li>/);
  assert.match(multiHtml, /<li>סיבה שלישית<\/li>/);
  assert.doesNotMatch(multiHtml, /course-scheduling-rejected-failures[\s\S]*סיבה ראשית/);
});

test('18-20: recommended/bestAvailable badges are singular; rejected never in alternatives cards', () => {
  const recommended = {
    instructor,
    eligible: true,
    score: 88,
    qualityLabel: 'מומלץ',
    recommendationReason: 'רציפות',
    projectedHalfHours: 3.25,
    movedMeetingsCount: 0,
    activeWorkDays: 2,
    scoreBreakdown: {
      continuityEfficiency: { points: 18, label: 'רציפות ויעילות ביום', note: NEUTRAL_CONTINUITY_NOTE },
      travelDistance: { points: 20, label: 'מרחק ונסיעות', note: '12 ק״מ וכ-15 דקות נסיעה' },
      actualWorkload: { points: 20, label: 'עומס עבודה בפועל', note: '3.25 שעות לאחר השיבוץ', projectedHalfHours: 3.25 },
      originalSchedulePreservation: { points: 15, label: 'שמירה על המועדים המקוריים', note: 'המועדים נשארים ללא שינוי' },
      gapsAndNewDays: { points: 5, label: 'צמצום חלונות ופתיחת ימי עבודה', note: NEUTRAL_CONTINUITY_NOTE }
    },
    travel: { home: { distance_km: 12, duration_minutes: 15 }, transitions: {} },
    checks: { language: { passed: true }, gender: { passed: true }, availability: { passed: true } },
    failures: []
  };
  const recommendedHtml = detailsHtml({
    course: course('c1', { required_instructor_gender: 'any' }),
    status: 'הצעה מוכנה',
    recommended,
    alternatives: [],
    checked: [recommended]
  });
  assert.match(recommendedHtml, /המדריך המומלץ/);
  const recommendedBadges = [...recommendedHtml.matchAll(/course-scheduling-status-pill[^"]*"[^>]*>([^<]+)/g)].map((m) => m[1]);
  assert.deepEqual(recommendedBadges, ['מומלץ']);

  const bestAvailable = { ...recommended, score: 48, qualityLabel: 'מתאים עם אזהרה' };
  const bestHtml = detailsHtml({
    course: course('c1', { required_instructor_gender: 'any' }),
    status: 'נדרש טיפול',
    recommended: null,
    bestAvailable,
    alternatives: [],
    checked: [bestAvailable]
  });
  assert.match(bestHtml, /ההתאמה הטובה ביותר שנמצאה/);
  const bestBadges = [...bestHtml.matchAll(/course-scheduling-status-pill[^"]*"[^>]*>([^<]+)/g)].map((m) => m[1]);
  assert.deepEqual(bestBadges, ['נדרשת בדיקה']);
  assert.doesNotMatch(bestHtml, /מתאים עם אזהרה/);
  assert.doesNotMatch(bestHtml, /ההתאמה הטובה ביותר<\/span>/);

  const farRejected = {
    instructor: nearbyInstructor,
    eligible: false,
    score: null,
    failures: [homeDistanceLimitFailureMessage(135)],
    missingProfileData: [],
    travel: { home: { distance_km: 135, duration_minutes: 120 } },
    checks: { travel: { passed: false } }
  };
  const altHtml = detailsHtml({
    course: course('c1', { required_instructor_gender: 'any' }),
    status: 'הצעה מוכנה',
    recommended,
    alternatives: [farRejected],
    checked: [recommended, farRejected]
  });
  const alternativesBlock = altHtml.match(/data-alternatives>[\s\S]*?<\/section>/)?.[0] || '';
  assert.doesNotMatch(alternativesBlock, /נועה כהן/);
  assert.doesNotMatch(alternativesBlock, /data-candidate-row="200"/);
  assert.match(altHtml, /data-rejected-candidate="200"/);
});

test('21-22: unchanged meetings are compact; changed meetings keep comparison table', () => {
  const unchanged = {
    instructor,
    eligible: true,
    score: 70,
    projectedHalfHours: 3,
    movedMeetingsCount: 0,
    proposedMeetings: [],
    dateAdjustment: null,
    scoreBreakdown: {
      continuityEfficiency: { points: 18, label: 'רציפות ויעילות ביום' },
      travelDistance: { points: 20, label: 'מרחק ונסיעות' },
      actualWorkload: { points: 15, label: 'עומס עבודה בפועל', projectedHalfHours: 3 },
      originalSchedulePreservation: { points: 15, label: 'שמירה על המועדים המקוריים' },
      gapsAndNewDays: { points: 5, label: 'צמצום חלונות ופתיחת ימי עבודה' }
    },
    travel: { home: { distance_km: 8, duration_minutes: 12 } },
    checks: { language: { passed: true }, gender: { passed: true }, availability: { passed: true } }
  };
  const unchangedHtml = detailsHtml({
    course: course('c1', { required_instructor_gender: 'any' }),
    status: 'הצעה מוכנה',
    recommended: unchanged,
    alternatives: [],
    checked: [unchanged]
  }, { courseSchedulingSelectedCandidateId: '100' });
  assert.match(unchangedHtml, /מועדי הפעילות נשארים ללא שינוי/);
  assert.doesNotMatch(unchangedHtml, /course-scheduling-meetings-table/);
  assert.doesNotMatch(unchangedHtml, /מועד מקורי/);

  const changed = {
    ...unchanged,
    movedMeetingsCount: 1,
    proposedMeetings: [
      { date: '2026-09-13', original_date: '2026-09-06', start_time: '10:00', end_time: '11:00', moved: true }
    ],
    dateAdjustment: {
      valid: true,
      movedCount: 1,
      exceedsHalf: false,
      meetings: [
        { date: '2026-09-13', original_date: '2026-09-06', start_time: '10:00', end_time: '11:00', moved: true }
      ]
    }
  };
  const changedHtml = detailsHtml({
    course: course('c1', { required_instructor_gender: 'any' }),
    status: 'הצעה מוכנה',
    recommended: changed,
    alternatives: [],
    checked: [changed]
  }, { courseSchedulingSelectedCandidateId: '100' });
  assert.match(changedHtml, /course-scheduling-meetings-table/);
  assert.match(changedHtml, /מועד מקורי/);
  assert.match(changedHtml, /מועד מוצע/);
  assert.match(changedHtml, /הוזז/);
});

test('23: workload hours use identical formatting everywhere', () => {
  assert.equal(formatWorkloadHours(3.25), '3.25 שעות');
  assert.equal(formatWorkloadHours(3.5), '3.5 שעות');
  assert.equal(formatWorkloadHours(3), '3 שעות');
  const scored = computeSchedulingScore({
    eligible: true,
    activity: course('c1'),
    meetings: course('c1').meetings,
    existingActivities: [],
    travel: { home: { distance_km: 12, duration_minutes: 15 }, transitions: {} },
    workDates: new Set(),
    projectedHalfHours: 3.25,
    peerProjectedHours: [3.25],
    currentHalfHours: 0,
    activeWorkDays: 1
  });
  assert.equal(scored.scoreBreakdown.actualWorkload.note, '3.25 שעות לאחר השיבוץ');
  assert.match(scored.recommendationReason, /3\.25 שעות/);
  const html = detailsHtml({
    course: course('c1', { required_instructor_gender: 'any' }),
    status: 'הצעה מוכנה',
    recommended: {
      instructor,
      eligible: true,
      score: scored.score,
      projectedHalfHours: 3.25,
      movedMeetingsCount: 0,
      activeWorkDays: 1,
      scoreBreakdown: scored.scoreBreakdown,
      recommendationReason: scored.recommendationReason,
      travel: { home: { distance_km: 12, duration_minutes: 15 } },
      checks: { language: { passed: true }, gender: { passed: true }, availability: { passed: true } }
    },
    alternatives: [],
    checked: []
  }, { courseSchedulingSelectedCandidateId: '100' });
  assert.equal((html.match(/3\.25 שעות/g) || []).length >= 2, true);
  assert.doesNotMatch(html, /3\.3 שעות/);
});

test('24: action buttons remain disabled for an ineligible / over-distance candidate', () => {
  const rejected = {
    instructor,
    eligible: false,
    score: null,
    failures: [homeDistanceLimitFailureMessage(135)],
    travel: { home: { distance_km: 135, duration_minutes: 120 } },
    checks: {
      language: { passed: true },
      gender: { passed: true },
      availability: { passed: true },
      travel: { passed: false, reason: homeDistanceLimitFailureMessage(135) }
    }
  };
  const eligible = {
    instructor: nearbyInstructor,
    eligible: true,
    score: 80,
    projectedHalfHours: 4,
    movedMeetingsCount: 0,
    activeWorkDays: 1,
    scoreBreakdown: {
      continuityEfficiency: { points: 18, label: 'רציפות ויעילות ביום' },
      travelDistance: { points: 20, label: 'מרחק ונסיעות' },
      actualWorkload: { points: 20, label: 'עומס עבודה בפועל' },
      originalSchedulePreservation: { points: 15, label: 'שמירה על המועדים המקוריים' },
      gapsAndNewDays: { points: 5, label: 'צמצום חלונות ופתיחת ימי עבודה' }
    },
    travel: { home: { distance_km: 8, duration_minutes: 12 } },
    checks: { language: { passed: true }, gender: { passed: true }, availability: { passed: true } },
    failures: []
  };
  // Stale selection of the rejected-distance candidate must not enable actions.
  const html = detailsHtml({
    course: course('c1', { required_instructor_gender: 'any' }),
    status: 'הצעה מוכנה',
    recommended: eligible,
    alternatives: [],
    checked: [eligible, rejected]
  }, { courseSchedulingSelectedCandidateId: '100' });
  assert.match(html, /data-save-draft disabled/);
  assert.match(html, /data-assign-course disabled/);
  assert.doesNotMatch(html, /data-rejected-candidate="100"[\s\S]{0,200}type="radio"/);
  assert.equal(actionDisabledReason({ candidate: rejected, canEdit: true }), '');
});
