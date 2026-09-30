import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  evaluateInstructor,
  isAuthorityBlocked,
  normalizeBlockedAuthorities,
  BLOCKED_AUTHORITY_CODE,
  BLOCKED_AUTHORITY_MESSAGE
} from '../frontend/src/screens/instructor-matching-engine.js';
import { calculateCourseSchedule, preliminaryCourseCandidates } from '../frontend/src/screens/course-scheduling-engine.js';
import { manualCandidateBlocked } from '../frontend/src/screens/shared/course-scheduling-manual-picker-access.js';
import { conciseSchedulingReason } from '../frontend/src/screens/course-scheduling-reason-labels.js';
import { matchingForm } from '../frontend/src/screens/instructor-workspace-ui.js';

const activity = {
  activity_name: 'קורס מדעים',
  authority: 'נתניה',
  instruction_language: 'he',
  required_instructor_gender: 'female',
  grade: 'ח',
  start_time: '10:00',
  end_time: '11:30',
  meetings: [{ date: '2026-08-02', start_time: '10:00', end_time: '11:30' }]
};
const instructor = { emp_id: '10', full_name: 'נועה', active: 'yes', address: 'חיפה' };
const profile = { gender: 'female', instruction_languages: ['he', 'ar'], friday_allowed: false };
const rules = [{ weekday: 0, available: true, start_time: '08:00', end_time: '16:00' }];

test('normalizeBlockedAuthorities keeps display names and dedupes case-insensitively', () => {
  assert.deepEqual(
    normalizeBlockedAuthorities(['  נתניה  ', 'חדרה', 'נתניה', '', '  חדרה ']),
    ['נתניה', 'חדרה']
  );
});

test('instructor without blocked authorities keeps normal eligibility', () => {
  const result = evaluateInstructor({ instructor, profile, rules, activity });
  assert.equal(result.eligible, true);
  assert.equal((result.failureCodes || []).includes(BLOCKED_AUTHORITY_CODE), false);
});

test('blocked authority is a hard eligibility failure before scoring', () => {
  const result = evaluateInstructor({
    instructor,
    profile: { ...profile, blocked_authorities: ['נתניה'] },
    rules,
    activity
  });
  assert.equal(result.eligible, false);
  assert.equal(result.score, null);
  assert.deepEqual(result.failureCodes, [BLOCKED_AUTHORITY_CODE]);
  assert.match(result.failures.join('|'), new RegExp(BLOCKED_AUTHORITY_MESSAGE));
  assert.equal(isAuthorityBlocked(['נתניה'], 'נתניה'), true);
});

test('blocked authority on a different authority still allows eligibility', () => {
  const result = evaluateInstructor({
    instructor,
    profile: { ...profile, blocked_authorities: ['חדרה'] },
    rules,
    activity
  });
  assert.equal(result.eligible, true);
  assert.equal((result.failureCodes || []).includes(BLOCKED_AUTHORITY_CODE), false);
});

test('planning preliminary candidates exclude blocked-authority instructors and skip them for travel', () => {
  const course = {
    row_id: 'c1',
    activity_name: 'קורס',
    activity_season: 'school_2027',
    activity_type: 'course',
    status: 'פתוח',
    authority: 'נתניה',
    school: 'א',
    school_id: 's1',
    school_address: 'נתניה 1',
    instruction_language: 'he',
    required_instructor_gender: 'female',
    start_time: '10:00',
    end_time: '11:30',
    meetings: [{ date: '2026-09-06', start_time: '10:00', end_time: '11:30' }],
    date_1: '2026-09-06'
  };
  const other = { emp_id: '11', full_name: 'רותם', active: 'yes', address: 'תל אביב' };
  const profiles = {
    10: { ...profile, blocked_authorities: ['נתניה'] },
    11: { ...profile }
  };
  const weekly = {
    10: rules,
    11: rules
  };
  const preliminary = preliminaryCourseCandidates({
    activities: [course],
    instructors: [instructor, other],
    profiles,
    rules: weekly,
    exceptions: {},
    preliminary: true
  });
  const ids = preliminary.map((item) => String(item.candidate.instructor.emp_id));
  assert.equal(ids.includes('10'), false);
  assert.equal(ids.includes('11'), true);

  const results = calculateCourseSchedule({
    activities: [course],
    instructors: [instructor, other],
    profiles,
    rules: weekly,
    exceptions: {},
    preliminary: true
  });
  const checked = results[0]?.checked || [];
  const blocked = checked.find((row) => String(row.instructor.emp_id) === '10');
  assert.equal(blocked?.eligible, false);
  assert.equal(blocked?.travel, null);
  assert.match((blocked?.failures || []).join('|'), new RegExp(BLOCKED_AUTHORITY_MESSAGE));
});

test('manual picker treats blocked authority as non-overridable', () => {
  const candidate = {
    instructor,
    eligible: false,
    failures: [BLOCKED_AUTHORITY_MESSAGE],
    missingProfileData: []
  };
  assert.equal(manualCandidateBlocked(candidate), true);
  assert.equal(conciseSchedulingReason(BLOCKED_AUTHORITY_MESSAGE), BLOCKED_AUTHORITY_MESSAGE);
});

test('matching form exposes blocked authorities multi-select UI', () => {
  const html = matchingForm(
    { emp_id: '10', scheduling_profile: { ...profile, blocked_authorities: ['נתניה'] } },
    { authorities: [{ value: 'נתניה', label: 'נתניה' }, { value: 'חדרה', label: 'חדרה' }] }
  );
  assert.match(html, /רשויות חסומות/);
  assert.match(html, /המדריך לא יוצע ולא ישובץ לפעילויות ברשויות אלו/);
  assert.match(html, /data-blocked-authority-chip="נתניה"/);
  assert.match(html, /instructor-blocked-authority-options/);
});

test('save payload helper persists blocked_authorities field in scheduling data module', async () => {
  const source = await readFile(new URL('../frontend/src/screens/instructor-scheduling-data.js', import.meta.url), 'utf8');
  assert.match(source, /blocked_authorities:\s*normalizeBlockedAuthoritiesForSave/);
});

test('SQL migration restores scheduling_authority_blocked guards without auto-cancelling assignments', async () => {
  const sql = await readFile(
    new URL('../supabase/migrations/20260930220000_scheduling_blocked_authorities_hard_constraint.sql', import.meta.url),
    'utf8'
  );
  assert.match(sql, /scheduling_authority_name_is_blocked/);
  assert.match(sql, /scheduling_authority_blocked/);
  assert.match(sql, /scheduling_course_instructor_violations/);
  assert.match(sql, /scheduling_manual_assignment_hard_violations/);
  assert.match(sql, /scheduling_assert_proposed_eligibility/);
  assert.match(sql, /Existing approved assignments are not auto-cancelled/);
  assert.doesNotMatch(sql, /delete from public\.activities/i);
  assert.doesNotMatch(sql, /emp_id\s*=\s*null/i);
});

test('planning invalidation already watches blocked_authorities without full rebuild', async () => {
  const sql = await readFile(
    new URL('../supabase/migrations/20260927190000_planning_self_invalidation.sql', import.meta.url),
    'utf8'
  );
  assert.match(sql, /old\.blocked_authorities is not distinct from new\.blocked_authorities/);
  assert.match(sql, /mark_scheduling_planning_needs_recalc_for_instructor\(new\.emp_id/);
  assert.doesNotMatch(sql, /clear_scheduling_planning_workspace/);
});
