import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCourseSchedule } from '../frontend/src/screens/course-scheduling-engine.js';
import {
  evaluateInstructor,
  formatAffectedMeetingsPhrase,
  formatPersistedActivityReference
} from '../frontend/src/screens/instructor-matching-engine.js';
import { routeMatrixKey } from '../frontend/src/screens/course-scheduling-travel.js';
import {
  NEUTRAL_CONTINUITY_NOTE,
  NEUTRAL_CONTINUITY_POINTS,
  NEUTRAL_GAPS_POINTS
} from '../frontend/src/screens/course-scheduling-score.js';
import { detailsHtml, instructorsResultsHtml } from '../frontend/src/screens/course-scheduling.js';

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
  const meetings = extra.meetings || [{ date: '2026-09-06', start_time: '10:00', end_time: '11:00' }];
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
    start_date: meetings[0].date,
    start_time: meetings[0].start_time,
    end_time: meetings[0].end_time,
    meetings,
    ...extra
  };
}

function travelFor(courseId, empId, home, transitions = {}) {
  return {
    [courseId]: {
      [empId]: {
        home,
        homeReturn: home,
        transitions
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
  activities,
  instructors = [instructor],
  travel,
  assignments = {},
  routeMatrix = {}
} = {}) {
  return {
    activities,
    instructors,
    profiles: Object.fromEntries(instructors.map((row) => [row.emp_id, profile])),
    rules: Object.fromEntries(instructors.map((row) => [row.emp_id, weekdayRules])),
    exceptions: {},
    assignments,
    travel,
    routeMatrix,
    referenceDate: '2026-09-01'
  };
}

function checked(result, empId = '100') {
  return (result.checked || []).find((item) => String(item.instructor?.emp_id) === String(empId));
}

function primaryOf(result) {
  return result.recommended || result.bestAvailable || checked(result);
}

function mondaySeries(count, start = '2026-09-07') {
  const base = new Date(`${start}T12:00:00Z`);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(base);
    date.setUTCDate(base.getUTCDate() + index * 7);
    return {
      date: date.toISOString().slice(0, 10),
      start_time: '10:00',
      end_time: '11:00'
    };
  });
}

test('1: instructor with no approved/saved rows has zero persisted existing meetings', () => {
  const open = course('solo', { meetings: [{ date: '2026-09-07', start_time: '10:00', end_time: '11:00' }] });
  const result = calculateCourseSchedule(scheduleInput({
    activities: [open],
    travel: travelFor('solo', '100', { distance_km: 8, duration_minutes: 12 })
  }))[0];
  const candidate = primaryOf(result);
  assert.ok(candidate);
  assert.equal((candidate.existingMeetings || []).length, 0);
  assert.equal(candidate.existingWorkDays, 0);
  assert.equal(candidate.currentHalfHours, 0);
});

test('2: one-meeting current course → existing workdays 0, projected workdays 1', () => {
  const open = course('one-meeting', { meetings: [{ date: '2026-09-07', start_time: '10:00', end_time: '11:00' }] });
  const result = calculateCourseSchedule(scheduleInput({
    activities: [open],
    travel: travelFor('one-meeting', '100', { distance_km: 8, duration_minutes: 12 })
  }))[0];
  const candidate = primaryOf(result);
  assert.equal(candidate.existingWorkDays, 0);
  assert.equal(candidate.projectedWorkDays, 1);
  assert.equal(candidate.activeWorkDays, 1);
  const html = detailsHtml(result, { courseSchedulingSelectedCandidateId: '100', courseSchedulingExpandedCandidateId: '100' });
  assert.match(html, /ימי עבודה קיימים: 0/);
  assert.match(html, /ימי עבודה לאחר שיבוץ זה: 1/);
  assert.doesNotMatch(html, /ימי עבודה פעילים/);
});

test('3: ten hidden planningDraft recommendations do not inflate user-facing workdays', () => {
  const planned = mondaySeries(10).map((meeting, index) => course(`plan-${index}`, {
    meetings: [meeting],
    school: `בית ספר ${index}`,
    school_id: `school-${index}`,
    school_address: `רחוב ${index}, נתניה`
  }));
  const current = course('current', {
    meetings: [{ date: '2026-11-16', start_time: '10:00', end_time: '11:00' }],
    school: 'בית ספר נוכחי',
    school_id: 'school-current',
    school_address: 'רחוב נוכחי 1, נתניה'
  });
  const travel = mergeTravel(
    ...planned.map((row) => travelFor(row.row_id, '100', { distance_km: 6, duration_minutes: 10 })),
    travelFor('current', '100', { distance_km: 6, duration_minutes: 10 })
  );
  const results = calculateCourseSchedule(scheduleInput({
    activities: [...planned, current],
    travel
  }));
  const currentResult = results.find((row) => row.course.row_id === 'current');
  const candidate = primaryOf(currentResult);
  assert.ok(candidate?.eligible, 'current course must stay eligible despite earlier hidden recommendations');
  assert.equal(candidate.existingWorkDays, 0);
  assert.equal(candidate.projectedWorkDays, 1);
  assert.ok(candidate.existingWorkDays !== 10);
  assert.ok(candidate.projectedWorkDays <= 1);
});

test('4-6: hidden planningDraft must not create overlap/transition hard failures or previous/next activity refs', () => {
  const first = course('hidden-a', {
    meetings: [{ date: '2026-09-07', start_time: '10:00', end_time: '11:00' }],
    school: 'ביומימיקרי',
    school_id: 'school-bio',
    school_address: 'רחוב ביו 1, נתניה',
    activity_name: 'ביומימיקרי'
  });
  const second = course('hidden-b', {
    meetings: [{ date: '2026-09-07', start_time: '11:15', end_time: '12:15' }],
    school: 'יצחק נבון',
    school_id: 'school-navon',
    school_address: 'רחוב נבון 2, נתניה',
    activity_name: 'קורס נבון'
  });
  const routeMatrix = {
    [routeMatrixKey('רחוב ביו 1, נתניה', 'רחוב נבון 2, נתניה')]: { distance_km: 12, duration_minutes: 28 },
    [routeMatrixKey('רחוב נבון 2, נתניה', 'רחוב ביו 1, נתניה')]: { distance_km: 12, duration_minutes: 28 }
  };
  const travel = mergeTravel(
    travelFor('hidden-a', '100', { distance_km: 5, duration_minutes: 8 }),
    travelFor('hidden-b', '100', { distance_km: 5, duration_minutes: 8 })
  );
  const results = calculateCourseSchedule(scheduleInput({
    activities: [first, second],
    travel,
    routeMatrix
  }));
  const secondResult = results.find((row) => row.course.row_id === 'hidden-b');
  const candidate = checked(secondResult);
  assert.ok(candidate);
  assert.equal(candidate.eligible, true, 'hidden planningDraft must not make candidate ineligible');
  const failureText = (candidate.failures || []).join(' ');
  assert.doesNotMatch(failureText, /אין זמן מעבר מספיק/);
  assert.doesNotMatch(failureText, /חפיפה/);
  assert.doesNotMatch(failureText, /הפעילות הקודמת/);
  assert.doesNotMatch(failureText, /הפעילות הבאה/);
  assert.doesNotMatch(failureText, /ביומימיקרי/);
  assert.equal((candidate.existingMeetings || []).length, 0);
  assert.ok((candidate.planningMeetings || []).length >= 1, 'planning meetings retained for soft use');
});

test('7-8: real approved assignment still creates overlap and transition failures', () => {
  const approvedOverlap = course('approved-overlap', {
    emp_id: '100',
    instructor_assignment_locked: true,
    status: 'שובץ',
    activity_name: 'פעילות מאושרת',
    school: 'בית ספר מאושר',
    school_id: 'school-approved',
    school_address: 'רחוב מאושר 1, נתניה',
    meetings: [{ date: '2026-09-07', start_time: '10:00', end_time: '11:00' }]
  });
  const openOverlap = course('open-overlap', {
    meetings: [{ date: '2026-09-07', start_time: '10:30', end_time: '11:30' }]
  });
  const overlapResult = calculateCourseSchedule(scheduleInput({
    activities: [openOverlap, approvedOverlap],
    travel: travelFor('open-overlap', '100', { distance_km: 5, duration_minutes: 8 }),
    assignments: { 100: [approvedOverlap] }
  }))[0];
  const overlapCandidate = checked(overlapResult);
  assert.equal(overlapCandidate.eligible, false);
  assert.match(overlapCandidate.failures.join(' '), /חפיפה/);
  assert.match(overlapCandidate.failures.join(' '), /פעילות מאושרת|בית ספר מאושר/);

  const approvedBefore = course('approved-before', {
    emp_id: '100',
    instructor_assignment_locked: true,
    status: 'שובץ',
    activity_name: 'ביומימיקרי',
    school: 'יצחק נבון',
    school_id: 'school-navon',
    school_address: 'רחוב נבון 1, נתניה',
    meetings: [{ date: '2026-10-14', start_time: '10:00', end_time: '11:00' }]
  });
  const openAfter = course('open-after', {
    meetings: [{ date: '2026-10-14', start_time: '11:15', end_time: '12:15' }],
    school: 'בית ספר אחר',
    school_id: 'school-other',
    school_address: 'רחוב אחר 9, נתניה'
  });
  const routeMatrix = {
    [routeMatrixKey('רחוב נבון 1, נתניה', 'רחוב אחר 9, נתניה')]: { distance_km: 12, duration_minutes: 28 },
    [routeMatrixKey('רחוב אחר 9, נתניה', 'רחוב נבון 1, נתניה')]: { distance_km: 12, duration_minutes: 28 }
  };
  const transitionResult = calculateCourseSchedule(scheduleInput({
    activities: [openAfter, approvedBefore],
    travel: travelFor('open-after', '100', { distance_km: 5, duration_minutes: 8 }),
    routeMatrix,
    assignments: { 100: [approvedBefore] }
  }))[0];
  const transitionCandidate = checked(transitionResult);
  assert.equal(transitionCandidate.eligible, false);
  const transitionText = transitionCandidate.failures.join(' ');
  assert.ok(
    /אין זמן מעבר מספיק|transition_insufficient/.test(transitionText),
    `expected transition hard failure, got: ${transitionText}`
  );
  assert.match(transitionText, /ביומימיקרי|transition_insufficient/);
  if (/אין זמן מעבר מספיק/.test(transitionText)) {
    assert.match(transitionText, /יצחק נבון/);
    assert.match(transitionText, /14\.10\.2026/);
  }
});

test('9+18: saved draft still creates overlap and transition validation', () => {
  const savedDraft = course('saved-draft', {
    draft_emp_id: '100',
    draft_instructor_name: 'הילה רוזן',
    draft_proposed_meetings: [{ date: '2026-09-07', start_time: '10:00', end_time: '11:00' }],
    activity_name: 'טיוטה שמורה',
    school: 'בית ספר טיוטה',
    school_id: 'school-draft',
    school_address: 'רחוב טיוטה 1, נתניה',
    meetings: [{ date: '2026-09-07', start_time: '10:00', end_time: '11:00' }]
  });
  const openOverlap = course('open-vs-draft', {
    meetings: [{ date: '2026-09-07', start_time: '10:30', end_time: '11:30' }]
  });
  const overlapResult = calculateCourseSchedule(scheduleInput({
    activities: [openOverlap, savedDraft],
    travel: travelFor('open-vs-draft', '100', { distance_km: 5, duration_minutes: 8 })
  }))[0];
  const overlapCandidate = checked(overlapResult);
  assert.equal(overlapCandidate.eligible, false);
  assert.match(overlapCandidate.failures.join(' '), /חפיפה/);

  const draftBefore = course('draft-before', {
    draft_emp_id: '100',
    draft_proposed_meetings: [{ date: '2026-10-14', start_time: '10:00', end_time: '11:00' }],
    activity_name: 'טיוטה קודמת',
    school: 'בית ספר קודם',
    school_id: 'school-prev',
    school_address: 'רחוב קודם 1, נתניה',
    meetings: [{ date: '2026-10-14', start_time: '10:00', end_time: '11:00' }]
  });
  const openAfter = course('open-vs-draft-travel', {
    meetings: [{ date: '2026-10-14', start_time: '11:15', end_time: '12:15' }],
    school: 'בית ספר יעד',
    school_id: 'school-dest',
    school_address: 'רחוב יעד 2, נתניה'
  });
  const routeMatrix = {
    [routeMatrixKey('רחוב קודם 1, נתניה', 'רחוב יעד 2, נתניה')]: { distance_km: 10, duration_minutes: 30 },
    [routeMatrixKey('רחוב יעד 2, נתניה', 'רחוב קודם 1, נתניה')]: { distance_km: 10, duration_minutes: 30 }
  };
  const transitionResult = calculateCourseSchedule(scheduleInput({
    activities: [openAfter, draftBefore],
    travel: travelFor('open-vs-draft-travel', '100', { distance_km: 5, duration_minutes: 8 }),
    routeMatrix
  }))[0];
  const transitionCandidate = checked(transitionResult);
  assert.equal(transitionCandidate.eligible, false);
  const transitionText = transitionCandidate.failures.join(' ');
  assert.ok(
    /אין זמן מעבר מספיק|transition_insufficient/.test(transitionText),
    `expected transition hard failure from saved draft, got: ${transitionText}`
  );
});

test('10: hidden planningDraft may affect soft continuity without flipping eligible', () => {
  const first = course('soft-a', {
    meetings: [{ date: '2026-09-07', start_time: '08:00', end_time: '09:00' }],
    school: 'אותו בית ספר',
    school_id: 'same-school',
    school_address: 'רחוב זהה 1, נתניה'
  });
  const second = course('soft-b', {
    meetings: [{ date: '2026-09-07', start_time: '12:00', end_time: '13:00' }],
    school: 'אותו בית ספר',
    school_id: 'same-school',
    school_address: 'רחוב זהה 1, נתניה'
  });
  const travel = mergeTravel(
    travelFor('soft-a', '100', { distance_km: 4, duration_minutes: 7 }),
    travelFor('soft-b', '100', { distance_km: 4, duration_minutes: 7 })
  );
  const results = calculateCourseSchedule(scheduleInput({
    activities: [first, second],
    travel
  }));
  const firstPick = primaryOf(results.find((row) => row.course.row_id === 'soft-a'));
  const secondPick = primaryOf(results.find((row) => row.course.row_id === 'soft-b'));
  assert.equal(firstPick.eligible, true);
  assert.equal(secondPick.eligible, true);
  assert.equal(firstPick.scoreBreakdown.continuityEfficiency.neutralBaseline, true);
  assert.notEqual(secondPick.scoreBreakdown.continuityEfficiency.neutralBaseline, true);
  assert.ok(secondPick.sameSchoolMeetingCount >= 1 || secondPick.scoreBreakdown.continuityEfficiency.sameSchoolMeetingCount >= 1);
});

test('11-13: user-facing workload excludes planningDraft; planner workload may include it', () => {
  const planned = mondaySeries(3).map((meeting, index) => course(`load-plan-${index}`, {
    meetings: [meeting],
    school: `עומס ${index}`,
    school_id: `load-${index}`,
    school_address: `רחוב עומס ${index}, נתניה`
  }));
  const current = course('load-current', {
    meetings: [{ date: '2026-09-28', start_time: '10:00', end_time: '11:00' }]
  });
  const travel = mergeTravel(
    ...planned.map((row) => travelFor(row.row_id, '100', { distance_km: 5, duration_minutes: 9 })),
    travelFor('load-current', '100', { distance_km: 5, duration_minutes: 9 })
  );
  const results = calculateCourseSchedule(scheduleInput({
    activities: [...planned, current],
    travel
  }));
  const candidate = primaryOf(results.find((row) => row.course.row_id === 'load-current'));
  assert.equal(candidate.currentHalfHours, 0);
  assert.equal(candidate.projectedHalfHours, 1);
  assert.ok(Number(candidate.plannerProjectedHalfHours) > Number(candidate.projectedHalfHours));
  assert.ok(Number(candidate.plannerCurrentHalfHours) >= 3);
  const html = detailsHtml(results.find((row) => row.course.row_id === 'load-current'), {
    courseSchedulingSelectedCandidateId: '100',
    courseSchedulingExpandedCandidateId: '100'
  });
  assert.match(html, /עומס לאחר השיבוץ: 1 שעות/);
  assert.doesNotMatch(html, /עומס לאחר השיבוץ: 4 שעות/);
});

test('14: instructor with no persisted schedule keeps neutral continuity 18/35 and gaps 5/5', () => {
  const open = course('neutral', { meetings: [{ date: '2026-09-07', start_time: '10:00', end_time: '11:00' }] });
  const result = calculateCourseSchedule(scheduleInput({
    activities: [open],
    travel: travelFor('neutral', '100', { distance_km: 8, duration_minutes: 12 })
  }))[0];
  const candidate = primaryOf(result);
  assert.equal(candidate.scoreBreakdown.continuityEfficiency.points, NEUTRAL_CONTINUITY_POINTS);
  assert.equal(candidate.scoreBreakdown.gapsAndNewDays.points, NEUTRAL_GAPS_POINTS);
  assert.equal(candidate.scoreBreakdown.continuityEfficiency.note, NEUTRAL_CONTINUITY_NOTE);
});

test('15-16: affected-meeting wording is singular for 1 and plural for many', () => {
  assert.equal(formatAffectedMeetingsPhrase(1), 'משפיע על מפגש אחד');
  assert.equal(formatAffectedMeetingsPhrase(2), 'משפיע על 2 מפגשים');
  assert.equal(formatAffectedMeetingsPhrase(3), 'משפיע על 3 מפגשים');
  assert.doesNotMatch(formatAffectedMeetingsPhrase(1), /1 מפגשים/);

  const one = evaluateInstructor({
    instructor,
    profile,
    rules: weekdayRules,
    activity: course('one-fail', { meetings: [{ date: '2026-09-07', start_time: '11:15', end_time: '12:15' }] }),
    existingActivities: [{
      date: '2026-09-07',
      start_time: '10:00',
      end_time: '11:00',
      school: 'יצחק נבון',
      school_address: 'רחוב נבון 1, נתניה',
      activity_name: 'ביומימיקרי',
      authority: 'נתניה'
    }],
    travel: {
      home: { distance_km: 5, duration_minutes: 8 },
      transitions: {
        '2026-09-07': { previous: { distance_km: 12, duration_minutes: 28 } }
      }
    },
    validateTravel: true
  });
  assert.equal(one.eligible, false);
  assert.match(one.failures.join(' '), /משפיע על מפגש אחד/);
  assert.doesNotMatch(one.failures.join(' '), /משפיע על 1 מפגשים/);
  assert.match(one.failures.join(' '), /ביומימיקרי/);
  assert.match(one.failures.join(' '), /יצחק נבון/);

  const manyMeetings = Array.from({ length: 3 }, (_, index) => ({
    date: `2026-09-${String(7 + index * 7).padStart(2, '0')}`,
    start_time: '11:15',
    end_time: '12:15'
  }));
  const manyExisting = manyMeetings.map((meeting) => ({
    date: meeting.date,
    start_time: '10:00',
    end_time: '11:00',
    school: 'אחר',
    school_address: 'רחוב אחר',
    activity_name: 'פעילות קודמת'
  }));
  const many = evaluateInstructor({
    instructor,
    profile,
    rules: weekdayRules,
    activity: course('many-fail', { meetings: manyMeetings }),
    existingActivities: manyExisting,
    travel: {
      home: { distance_km: 5, duration_minutes: 8 },
      transitions: Object.fromEntries(manyMeetings.map((meeting) => [
        meeting.date,
        { previous: { distance_km: 12, duration_minutes: 28 } }
      ]))
    },
    validateTravel: true
  });
  assert.match(many.failures.join(' '), /משפיע על 3 מפגשים/);
});

test('17: same failure reason appears only once in rejected UI', () => {
  const phrase = 'אין זמן מעבר מספיק מהפעילות הקודמת - משפיע על מפגש אחד';
  const html = instructorsResultsHtml({
    course: course('dup', { required_instructor_gender: 'any' }),
    status: 'נדרש גיוס',
    recommended: null,
    bestAvailable: null,
    alternatives: [],
    checked: [{
      instructor,
      eligible: false,
      score: null,
      failures: [phrase],
      missingProfileData: [],
      checks: {},
      travel: { home: { distance_km: 5, duration_minutes: 8 } }
    }]
  });
  assert.equal((html.match(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 1);
  assert.doesNotMatch(html, /course-scheduling-rejected-failures/);
});

test('Part 8 helper formats persisted activity references without inventing ids', () => {
  assert.equal(
    formatPersistedActivityReference({
      activity_name: 'ביומימיקרי',
      school: 'יצחק נבון',
      date: '2026-10-14'
    }),
    'ביומימיקרי בבית ספר יצחק נבון ביום 14.10.2026'
  );
});

test('manual acceptance shape: empty school_2027 schedule shows 0 existing / 1 projected workdays', () => {
  // Synthetic stand-in for production instructors with no school_2027 approved/draft rows.
  const emptyInstructor = {
    emp_id: '9001',
    full_name: 'מדריך ללא שיבוץ',
    active: 'yes',
    address: 'הרצל 1, נתניה'
  };
  const open = course('accept-one', {
    meetings: [{ date: '2026-09-07', start_time: '10:00', end_time: '11:00' }]
  });
  const result = calculateCourseSchedule(scheduleInput({
    activities: [open],
    instructors: [emptyInstructor],
    travel: travelFor('accept-one', '9001', { distance_km: 7, duration_minutes: 11 })
  }))[0];
  const candidate = checked(result, '9001');
  assert.equal(candidate.existingWorkDays, 0);
  assert.equal(candidate.projectedWorkDays, 1);
  assert.equal(candidate.eligible, true);
  assert.doesNotMatch((candidate.failures || []).join(' '), /מעבר|חפיפה|הפעילות הקודמת/);
});
