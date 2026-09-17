import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateInstructor,
  TRANSITION_BUFFER_MINUTES
} from '../frontend/src/screens/instructor-matching-engine.js';
import {
  SCORE_WEIGHTS,
  assertScoreWeightsTotal,
  computeSchedulingScore
} from '../frontend/src/screens/course-scheduling-score.js';
import {
  activitySchedulingReadinessMissingFields,
  instructorSchedulingReadinessMissingFields,
  isSchedulingReadyActivity,
  isSchedulingReadyInstructor
} from '../frontend/src/screens/shared/activity-scheduling-eligibility.js';

const instructor = { emp_id: '1519', full_name: 'אביגדור', active: 'yes', address: 'נתניה' };
const profile = { gender: 'male', instruction_languages: ['he'], friday_allowed: false };
const sundayRules = [{ weekday: 0, available: true, start_time: '08:00', end_time: '17:00' }];
const activity = {
  row_id: 'contract-a',
  activity_season: 'school_2027',
  activity_type: 'course',
  status: 'פתוח',
  activity_name: 'קורס',
  school: 'בית ספר א',
  school_id: '100',
  school_address: 'נתניה',
  authority: 'נתניה',
  instruction_language: 'he',
  required_instructor_gender: 'any',
  start_date: '2026-09-20',
  start_time: '10:00',
  end_time: '11:30',
  meetings: [{ date: '2026-09-20', start_time: '10:00', end_time: '11:30' }]
};

test('gender remains mandatory profile data even when the activity has no gender preference', () => {
  const result = evaluateInstructor({
    instructor,
    profile: { ...profile, gender: null },
    rules: sundayRules,
    activity,
    validateTravel: false
  });
  assert.equal(result.eligible, false);
  assert.ok(result.missingProfileData.some((item) => /מגדר/.test(item)));
  assert.equal(result.checks.gender.passed, false);
});

test('explicit gender requirement stays a hard gate', () => {
  const result = evaluateInstructor({
    instructor,
    profile,
    rules: sundayRules,
    activity: { ...activity, required_instructor_gender: 'female' },
    validateTravel: false
  });
  assert.equal(result.eligible, false);
  assert.ok(result.failures.some((item) => /מדריכה/.test(item)));
});

test('transition contract is raw travel time plus exactly 15 safety minutes', () => {
  assert.equal(TRANSITION_BUFFER_MINUTES, 15);
  const previous = {
    date: '2026-09-20', start_time: '08:00', end_time: '09:30',
    school: 'בית ספר ב', school_id: '200', authority: 'נתניה', school_address: 'נתניה'
  };
  const base = {
    instructor,
    profile,
    rules: sundayRules,
    activity,
    existingActivities: [previous],
    validateTravel: true
  };
  const pass = evaluateInstructor({
    ...base,
    travel: {
      home: { distance_km: 5, duration_minutes: 10 },
      transitions: { '2026-09-20': { previous: { distance_km: 5, duration_minutes: 15 } } }
    }
  });
  assert.equal(pass.eligible, true);
  const fail = evaluateInstructor({
    ...base,
    travel: {
      home: { distance_km: 5, duration_minutes: 10 },
      transitions: { '2026-09-20': { previous: { distance_km: 5, duration_minutes: 16 } } }
    }
  });
  assert.equal(fail.eligible, false);
  assert.ok(fail.failures.some((item) => /זמן מעבר/.test(item)));
});

test('daily sequence blocks a fourth consecutive long activity', () => {
  const longActivity = {
    ...activity,
    start_time: '13:30',
    end_time: '15:00',
    meetings: [{ date: '2026-09-20', start_time: '13:30', end_time: '15:00' }]
  };
  const existingActivities = [
    ['09:00', '10:30'],
    ['10:30', '12:00'],
    ['12:00', '13:30']
  ].map(([start_time, end_time], index) => ({
    date: '2026-09-20', start_time, end_time,
    school: `בית ספר ${index + 2}`, school_id: String(index + 2), authority: 'נתניה'
  }));
  const result = evaluateInstructor({
    instructor,
    profile,
    rules: sundayRules,
    activity: longActivity,
    existingActivities,
    validateTravel: false
  });
  assert.equal(result.eligible, false);
  assert.ok(result.failures.some((item) => /רצף היומי/.test(item)));
});

test('rolling workspace shows incomplete courses instead of hiding them', () => {
  const incomplete = {
    row_id: 'incomplete', activity_season: 'school_2027', activity_type: 'course',
    status: 'פתוח', activity_name: 'קורס חסר', start_date: '2026-10-01', start_time: '10:00'
  };
  assert.equal(isSchedulingReadyActivity(incomplete), true);
  assert.ok(activitySchedulingReadinessMissingFields(incomplete).length > 0);
});

test('active incomplete instructors remain visible but report gender as missing', () => {
  assert.equal(isSchedulingReadyInstructor(instructor, { instruction_languages: ['he'] }, sundayRules), true);
  const missing = instructorSchedulingReadinessMissingFields(instructor, { instruction_languages: ['he'] }, sundayRules);
  assert.ok(missing.includes('מגדר'));
});

test('approved scoring contract is exactly 100 points and five components', () => {
  assert.equal(assertScoreWeightsTotal(), true);
  assert.deepEqual(SCORE_WEIGHTS, {
    continuityEfficiency: 35,
    travelDistance: 25,
    actualWorkload: 20,
    originalSchedulePreservation: 15,
    gapsAndNewDays: 5
  });
  const scored = computeSchedulingScore({
    eligible: true,
    activity,
    meetings: activity.meetings,
    existingActivities: [],
    travel: { home: { distance_km: 5, duration_minutes: 10 } },
    projectedHalfHours: 10,
    peerProjectedHours: [10, 20]
  });
  assert.equal(scored.totalScore, Object.values(scored.scoreBreakdown).reduce((sum, item) => sum + item.points, 0));
  assert.ok(scored.totalScore >= 0 && scored.totalScore <= 100);
  assert.equal('seniority' in scored.scoreBreakdown, false);
});
