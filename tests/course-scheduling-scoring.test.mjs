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

test('matching engine keeps same-school candidate eligible before transparent ranking', () => {
  const previous = { date: '2026-09-02', start_time: '08:30', end_time: '09:55', school: 'בית ספר א', school_id: 'SCHOOL-A', authority: 'חיפה', activity_name: 'קודמת' };
  const result = evaluateInstructor({
    instructor, profile, rules, activity,
    existingActivities: [previous],
    travel: { home: { distance_km: 1, duration_minutes: 2 }, transitions: { '2026-09-02': { previous: { distance_km: 0, duration_minutes: 0 } } } },
    workloadRatio: 0
  });
  assert.equal(result.eligible, true);
});

test('same-school continuity remains eligibility-neutral before transparent ranking', () => {
  const sameSchoolNeighbor = { date: '2026-09-02', start_time: '08:30', end_time: '09:55', school: 'בית ספר א', school_id: 'SCHOOL-A', authority: 'חיפה', activity_name: 'קודמת' };
  const home = { distance_km: 8, duration_minutes: 12 };
  const withSameSchool = evaluateInstructor({
    instructor, profile, rules, activity, existingActivities: [sameSchoolNeighbor],
    travel: { home, transitions: { '2026-09-02': { previous: { distance_km: 0, duration_minutes: 0 } } } }
  });
  assert.equal(withSameSchool.eligible, true);
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

test('manual weekly_max_hours does not create an eligibility ceiling', () => {
  const heavyDay = [{ weekday: 3, available: true, start_time: '08:00', end_time: '20:00' }];
  const withoutTarget = evaluateInstructor({ instructor, profile, rules: heavyDay, activity, workloadRatio: 1 / 12 });
  const withTightTarget = evaluateInstructor({ instructor, profile: { ...profile, weekly_max_hours: 1 }, rules: heavyDay, activity, workloadRatio: 1 / 1 });
  assert.equal(withTightTarget.eligible, withoutTarget.eligible);
});

test('prior course experience is not an eligibility condition', () => {
  const priorSameCourse = { date: '2026-01-05', start_time: '09:00', end_time: '10:00', activity_name: activity.activity_name, school: 'בית ספר אחר', authority: 'ירושלים' };
  const withExperience = evaluateInstructor({ instructor, profile, rules, activity, existingActivities: [priorSameCourse], travel: { home: null, transitions: {} } });
  const withoutExperience = evaluateInstructor({ instructor, profile, rules, activity, travel: { home: null, transitions: {} } });
  assert.equal(withExperience.eligible, withoutExperience.eligible);
  assert.doesNotMatch(withExperience.explanation, /ניסיון קודם בקורס/);
});
