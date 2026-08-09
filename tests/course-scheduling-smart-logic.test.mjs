import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateCourseSchedule } from '../frontend/src/screens/course-scheduling-engine.js';
import { evaluateInstructor, schedulingQualityBand } from '../frontend/src/screens/instructor-matching-engine.js';
import { detailsHtml } from '../frontend/src/screens/course-scheduling.js';

const instructor = { emp_id: '1', full_name: 'נועה', active: 'yes', address: 'חיפה' };
const profile = { gender: 'female', instruction_languages: ['he'], friday_allowed: false };
const rules = [{ weekday: 0, available: true, start_time: '08:00', end_time: '16:00' }];
const course = { row_id: 'c1', activity_season: 'school_2027', activity_type: 'course', status: 'פתוח', activity_name: 'קורס', school: 'בית ספר', school_address: 'תל אביב', authority: 'רשות', instruction_language: 'he', required_instructor_gender: 'any', start_time: '10:00', end_time: '11:00', date_1: '2026-09-06' };

test('removed fields never gate or mark an instructor profile incomplete', () => {
  const result = evaluateInstructor({ instructor, profile: { ...profile, education_levels: [], course_restriction_mode: 'allow_only', course_ids: [], blocked_authorities: ['רשות'], blocked_schools: ['בית ספר'], weekly_target_hours: 0, weekly_max_hours: 0, preferred_work_days: 0, max_fixed_courses: 0 }, rules, activity: { ...course, education_level: 'different', allowed_instructor_ids: ['2'], blocked_instructor_ids: ['1'] } });
  assert.equal(result.eligible, true);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.missingProfileData, []);
});

test('gender is mandatory even when required gender is any; mismatch remains a hard gate', () => {
  assert.equal(evaluateInstructor({ instructor, profile: { ...profile, gender: null }, rules, activity: course }).eligible, false);
  assert.ok(evaluateInstructor({ instructor, profile: { ...profile, gender: null }, rules, activity: course }).missingProfileData.some((item) => /מגדר/.test(item)));
  assert.equal(evaluateInstructor({ instructor, profile, rules, activity: course }).eligible, true);
  assert.equal(evaluateInstructor({ instructor, profile: { ...profile, gender: 'male' }, rules, activity: { ...course, required_instructor_gender: 'female' } }).eligible, false);
});

test('quality boundaries are stable', () => {
  assert.equal(schedulingQualityBand(60).qualityBand, 'recommended');
  assert.equal(schedulingQualityBand(59).qualityBand, 'warning');
  assert.equal(schedulingQualityBand(40).qualityBand, 'warning');
  assert.equal(schedulingQualityBand(39).qualityBand, 'technical');
});

test('eligible low score is bestAvailable and requires treatment, never recruitment or recommendation', () => {
  const result = calculateCourseSchedule({ activities: [course], instructors: [instructor], profiles: { 1: profile }, rules: { 1: rules }, exceptions: {}, preliminary: true })[0];
  assert.equal(result.recommended, null);
  assert.ok(result.bestAvailable);
  // Neutral first-schedule continuity (18/35 + 5/5) lifts a bare eligible score into the warning band,
  // still below the recommendation threshold.
  assert.ok(['warning', 'technical'].includes(result.bestAvailable.qualityBand));
  assert.ok(result.bestAvailable.score < 60);
  assert.equal(result.status, 'נדרש טיפול');
  assert.notEqual(result.status, 'נדרש גיוס');
  const html = detailsHtml(result);
  assert.match(html, /ההתאמה הטובה ביותר שנמצאה/);
  assert.doesNotMatch(html, /נדרשת בדיקה/);
  assert.doesNotMatch(html, /לא נמצאה התאמה איכותית לקורס/);
  assert.equal((html.match(/נדרשת בדיקה/g) || []).length, 0);
  const badges = [...html.matchAll(/course-scheduling-status-pill[^"]*"[^>]*>([^<]+)/g)].map((m) => m[1]);
  assert.deepEqual(badges, []);
  assert.doesNotMatch(html, /המדריך המומלץ/);
});

test('no eligible candidate is recruitment while missing-only remains treatment', () => {
  const rejected = calculateCourseSchedule({ activities: [course], instructors: [instructor], profiles: { 1: { ...profile, instruction_languages: ['ar'] } }, rules: { 1: rules }, exceptions: {}, preliminary: true })[0];
  assert.equal(rejected.status, 'נדרש גיוס');
  const incomplete = calculateCourseSchedule({ activities: [course], instructors: [instructor], profiles: { 1: profile }, rules: { 1: [] }, exceptions: {}, preliminary: true })[0];
  assert.equal(incomplete.status, 'נדרש טיפול');
});

test('focused SQL migration removes legacy gates and preserves operational validation', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260807203000_course_scheduling_e2e_alignment.sql', import.meta.url), 'utf8');
  for (const removed of ['education_levels', 'course_restriction_mode', 'course_ids', 'allowed_instructor_ids', 'blocked_instructor_ids', 'blocked_authorities', 'blocked_schools', 'weekly_target_hours', 'weekly_max_hours', 'preferred_work_days', 'max_fixed_courses']) assert.doesNotMatch(sql, new RegExp(removed));
  for (const kept of ['instructor_inactive', 'scheduling_language_mismatch', 'scheduling_gender_mismatch', 'scheduling_availability_missing', 'scheduling_conflict_detected', 'scheduling_transition_insufficient', 'scheduling_daily_sequence_exceeded', 'scheduling_instructor_profile_incomplete', 'scheduling_home_distance_exceeded', 'scheduling_home_route_unverified']) assert.match(sql, new RegExp(kept));
});
