import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateInstructor } from '../frontend/src/screens/instructor-matching-engine.js';
import { calculateCourseSchedule } from '../frontend/src/screens/course-scheduling-engine.js';
import { isFullDaySchedulingActivity } from '../frontend/src/screens/shared/activity-scheduling-eligibility.js';
import { manualCandidateBlocked } from '../frontend/src/screens/shared/course-scheduling-manual-picker-access.js';

const instructor = {
  emp_id: '9001',
  full_name: 'מדריכה',
  active: 'yes',
  address: 'תל אביב'
};

const profile = {
  gender: 'female',
  instruction_languages: ['he'],
  friday_allowed: false,
  blocked_authorities: []
};

const mondayRule = [{ weekday: 1, available: true, start_time: '08:00', end_time: '18:00' }];

function activity(id, {
  type = 'course',
  name = id,
  activityNo = '',
  start = '10:00',
  end = '11:30',
  date = '2026-10-19',
  assigned = false
} = {}) {
  return {
    row_id: id,
    activity_no: activityNo,
    activity_name: name,
    activity_type: type,
    activity_season: 'school_2027',
    status: 'פתוח',
    school: 'בית ספר',
    school_id: 100,
    school_address: 'תל אביב',
    authority: 'תל אביב',
    instruction_language: 'he',
    required_instructor_gender: 'any',
    calendar_sector: 'jewish',
    start_time: start,
    end_time: end,
    meetings: [{ date, start_time: start, end_time: end }],
    ...(assigned ? {
      emp_id: '9001',
      instructor_name: 'מדריכה',
      instructor_assignment_locked: true
    } : {})
  };
}

test('tour and התנסות בתעשייה are full-day scheduling activities', () => {
  assert.equal(isFullDaySchedulingActivity({ activity_type: 'tour' }), true);
  assert.equal(isFullDaySchedulingActivity({ activity_type: 'סיור' }), true);
  assert.equal(isFullDaySchedulingActivity({ activity_no: '13990', activity_type: 'course' }), true);
  assert.equal(isFullDaySchedulingActivity({ activity_name: 'התנסות בתעשייה', activity_type: 'course' }), true);
  assert.equal(isFullDaySchedulingActivity({ activity_type: 'course', activity_name: 'יישומי AI' }), false);
});

test('existing full-day tour blocks a non-overlapping course on the same date', () => {
  const target = activity('course-a', { start: '15:00', end: '16:30' });
  const existingTourMeeting = {
    date: '2026-10-19',
    start_time: '09:00',
    end_time: '12:00',
    activity_id: 'tour-a',
    activity_name: 'התנסות בתעשייה',
    activity_type: 'tour',
    full_day_blocking: true
  };

  const result = evaluateInstructor({
    instructor,
    profile,
    rules: mondayRule,
    exceptions: [],
    activity: target,
    existingActivities: [existingTourMeeting],
    validateTravel: false,
    includeLegacyScore: false
  });

  assert.equal(result.eligible, false);
  assert.ok(result.issues.some((issue) => issue.kind === 'full_day_tour_conflict'));
});

test('a full-day tour cannot be assigned on a date with another non-overlapping activity', () => {
  const tour = activity('tour-a', {
    type: 'tour',
    name: 'התנסות בתעשייה',
    activityNo: '13990',
    start: '09:00',
    end: '12:00'
  });
  const existingCourseMeeting = {
    date: '2026-10-19',
    start_time: '15:00',
    end_time: '16:30',
    activity_id: 'course-a',
    activity_name: 'יישומי AI',
    activity_type: 'course'
  };

  const result = evaluateInstructor({
    instructor,
    profile,
    rules: mondayRule,
    exceptions: [],
    activity: tour,
    existingActivities: [existingCourseMeeting],
    validateTravel: false,
    includeLegacyScore: false
  });

  assert.equal(result.eligible, false);
  assert.ok(result.issues.some((issue) => issue.kind === 'full_day_tour_conflict'));
});

test('ordinary non-overlapping activities on the same date remain allowed', () => {
  const target = activity('course-b', { start: '15:00', end: '16:30' });
  const existing = {
    date: '2026-10-19',
    start_time: '09:00',
    end_time: '10:30',
    activity_id: 'course-a',
    activity_name: 'קורס אחר',
    activity_type: 'course'
  };

  const result = evaluateInstructor({
    instructor,
    profile,
    rules: mondayRule,
    exceptions: [],
    activity: target,
    existingActivities: [existing],
    validateTravel: false,
    includeLegacyScore: false
  });

  assert.equal(result.issues.some((issue) => issue.kind === 'full_day_tour_conflict'), false);
  assert.equal(result.issues.some((issue) => issue.kind === 'overlap'), false);
});

test('prepared engine context carries an assigned tour as a full-day blocker', () => {
  const existingTour = activity('tour-live', {
    type: 'tour',
    name: 'התנסות בתעשייה',
    activityNo: '13990',
    start: '09:00',
    end: '12:00',
    assigned: true
  });
  const target = activity('course-later', { start: '15:00', end: '16:30' });

  const result = calculateCourseSchedule({
    activities: [existingTour, target],
    instructors: [instructor],
    profiles: { 9001: profile },
    rules: { 9001: mondayRule },
    exceptions: { 9001: [] },
    assignments: { 9001: [existingTour] },
    periodKey: 'first',
    referenceDate: '2026-10-01',
    preliminary: true
  })[0];

  const candidate = result.checked.find((row) => row.instructor?.emp_id === '9001');
  assert.equal(candidate?.eligible, false);
  assert.ok(candidate?.issues?.some((issue) => issue.kind === 'full_day_tour_conflict'));
});

test('manual picker cannot override a full-day tour conflict', () => {
  assert.equal(manualCandidateBlocked({
    failures: ['ביום זה כבר משובץ סיור שתופס יום עבודה מלא: התנסות בתעשייה']
  }), true);
});
