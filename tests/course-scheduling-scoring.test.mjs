import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateInstructor } from '../frontend/src/screens/instructor-matching-engine.js';

const instructor = { emp_id: '1', full_name: 'נועה', active: 'yes', address: 'חיפה' };
const profile = { gender: 'female', instruction_languages: ['he'], education_levels: ['elementary'], course_restriction_mode: 'all' };
const rules = [{ weekday: 3, available: true, start_time: '08:00', end_time: '16:00' }];
const activity = {
  activity_name: 'קורס מדעים', instruction_language: 'he', required_instructor_gender: 'female', education_level: 'elementary',
  start_time: '10:00', end_time: '11:00', school: 'בית ספר א', school_id: 'SCHOOL-A', authority: 'חיפה',
  meetings: [{ date: '2026-09-02', start_time: '10:00', end_time: '11:00' }] // Wednesday, matches weekday 3
};

test('score is capped at 100 and never at the old 120 ceiling', () => {
  const previous = { date: '2026-09-02', start_time: '08:30', end_time: '09:55', school: 'בית ספר א', school_id: 'SCHOOL-A', authority: 'חיפה', activity_name: 'קודמת' };
  const result = evaluateInstructor({
    instructor, profile, rules, activity,
    existingActivities: [previous],
    travel: { home: { distance_km: 1, duration_minutes: 2 }, transitions: { '2026-09-02': { previous: { distance_km: 0, duration_minutes: 0 } } } },
    workloadRatio: 0
  });
  assert.equal(result.eligible, true);
  assert.ok(result.score <= 100, `score ${result.score} exceeds the 100-point cap`);
});

test('same-school continuity does not also earn the full same-authority bonus (no double counting)', () => {
  const sameSchoolNeighbor = { date: '2026-09-02', start_time: '08:30', end_time: '09:55', school: 'בית ספר א', school_id: 'SCHOOL-A', authority: 'חיפה', activity_name: 'קודמת' };
  const home = { distance_km: 8, duration_minutes: 12 };
  const withSameSchool = evaluateInstructor({
    instructor, profile, rules, activity, existingActivities: [sameSchoolNeighbor],
    travel: { home, transitions: { '2026-09-02': { previous: { distance_km: 0, duration_minutes: 0 } } } }
  });
  const bare = evaluateInstructor({ instructor, profile, rules, activity, travel: { home, transitions: {} } });
  assert.ok(withSameSchool.score > bare.score, 'same-school continuity should raise the score');
  // A same-school connection is worth at most the 30-point school bucket, never
  // school (30) plus authority (20) for the very same neighbor relationship.
  assert.ok(withSameSchool.score - bare.score <= 30, `continuity bonus ${withSameSchool.score - bare.score} exceeds the 30-point school cap, suggesting double counting`);
});

test('language, gender and blocks stay gating conditions, never point contributions', () => {
  const eligible = evaluateInstructor({
    instructor,
    profile,
    rules,
    activity,
    travel: { home: { distance_km: 8, duration_minutes: 12 }, transitions: {} },
    validateTravel: true
  });
  assert.equal(eligible.eligible, true);
  const mismatched = evaluateInstructor({ instructor, profile: { ...profile, gender: 'male' }, rules, activity });
  assert.equal(mismatched.eligible, false);
  assert.equal(mismatched.score, null);
});

test('manual weekly_max_hours does not change the new workload score', () => {
  const heavyDay = [{ weekday: 3, available: true, start_time: '08:00', end_time: '20:00' }];
  const withoutTarget = evaluateInstructor({ instructor, profile, rules: heavyDay, activity, workloadRatio: 1 / 12 });
  const withTightTarget = evaluateInstructor({ instructor, profile: { ...profile, weekly_max_hours: 1 }, rules: heavyDay, activity, workloadRatio: 1 / 1 });
  assert.equal(withTightTarget.scoreBreakdown.workload.points, withoutTarget.scoreBreakdown.workload.points);
});

test('prior course experience is not a separate score component', () => {
  const priorSameCourse = { date: '2026-01-05', start_time: '09:00', end_time: '10:00', activity_name: activity.activity_name, school: 'בית ספר אחר', authority: 'ירושלים' };
  const withExperience = evaluateInstructor({ instructor, profile, rules, activity, existingActivities: [priorSameCourse], travel: { home: null, transitions: {} } });
  const withoutExperience = evaluateInstructor({ instructor, profile, rules, activity, travel: { home: null, transitions: {} } });
  assert.equal(withExperience.score, withoutExperience.score);
  assert.doesNotMatch(withExperience.explanation, /ניסיון קודם בקורס/);
});
