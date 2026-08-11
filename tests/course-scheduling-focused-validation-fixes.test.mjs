import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { effectiveEndTime } from '../frontend/src/screens/course-scheduling-date-adjustments.js';
import { evaluateInstructor } from '../frontend/src/screens/instructor-matching-engine.js';
import { isSchedulingReadyInstructor } from '../frontend/src/screens/shared/activity-scheduling-eligibility.js';

const migrationUrl = new URL('../supabase/migrations/20260811150000_scheduling_effective_end_and_optional_gender.sql', import.meta.url);
const instructor = { emp_id: '1', full_name: 'מדריך', active: 'yes', address: 'תל אביב' };
const rules = [{ weekday: 0, available: true, start_time: '08:00', end_time: '13:30' }];
const baseActivity = {
  activity_name: 'קורס', school_id: 1, school: 'בית ספר', instruction_language: 'he',
  required_instructor_gender: 'any', start_time: '12:00', end_time: '14:00',
  meetings: [{ date: '2026-09-06', start_time: '12:00', end_time: '13:30' }]
};

function evaluate(profile, activity = baseActivity, existingActivities = []) {
  return evaluateInstructor({ instructor, profile, rules, activity, existingActivities, validateTravel: false });
}

test('enforce_end_time makes 13:30 the effective end of a 12:00–14:00 meeting', () => {
  const calendar = [{
    start_date: '2026-09-06', end_date: '2026-09-06', is_active: true,
    enforce_end_time: true, school_day_end_time: '13:30'
  }];
  assert.equal(effectiveEndTime('2026-09-06', '14:00', calendar), '13:30');
  assert.equal(evaluate({ gender: null, instruction_languages: ['he'] }).eligible, true);
});

test('calendar revalidation does not reject a nominal end after enforce_end_time caps it', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  const calendarReason = sql.split('create or replace function public.scheduling_school_calendar_validation_reason')[1];
  assert.doesNotMatch(calendarReason, /target\.end_time\s*>\s*sc\.school_day_end_time/);
  assert.doesNotMatch(calendarReason, /activity_after_shortened_school_day/);
  assert.match(calendarReason, /activity_date_on_school_holiday/);
});

test('effective shortened hours still fail ordinary overlap and availability validation', () => {
  const overlap = evaluate(
    { gender: null, instruction_languages: ['he'] },
    baseActivity,
    [{ date: '2026-09-06', start_time: '13:00', end_time: '14:00' }]
  );
  const unavailable = evaluate(
    { gender: null, instruction_languages: ['he'] },
    baseActivity,
    [],
  );
  assert.equal(overlap.eligible, false);
  assert.match(overlap.failures.join(' '), /חפיפה/);
  assert.equal(unavailable.eligible, true, 'availability through the effective 13:30 end remains valid');
  const narrower = evaluateInstructor({
    instructor,
    profile: { gender: null, instruction_languages: ['he'] },
    rules: [{ ...rules[0], end_time: '13:15' }],
    activity: baseActivity,
    validateTravel: false
  });
  assert.equal(narrower.eligible, false);
  assert.ok(narrower.issues.some((issue) => issue.kind === 'hours_unavailable'));
});

test('missing instructor gender participates when the course requirement is any', async () => {
  const profile = { gender: null, instruction_languages: ['he'] };
  assert.equal(isSchedulingReadyInstructor(instructor, profile, rules), true);
  assert.equal(evaluate(profile).eligible, true);
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /required_instructor_gender, 'any'\) in \('male','female'\)[\s\S]*profile\.gender/);
});

test('missing instructor gender is rejected for an explicit requirement', () => {
  const result = evaluate(
    { gender: null, instruction_languages: ['he'] },
    { ...baseActivity, required_instructor_gender: 'female' }
  );
  assert.equal(result.eligible, false);
  assert.match(result.missingProfileData.join(' '), /מגדר/);
});

test('mismatched instructor gender remains rejected for an explicit requirement', () => {
  const result = evaluate(
    { gender: 'male', instruction_languages: ['he'] },
    { ...baseActivity, required_instructor_gender: 'female' }
  );
  assert.equal(result.eligible, false);
  assert.ok(result.failures.includes('הקורס דורש מדריכה'));
});
