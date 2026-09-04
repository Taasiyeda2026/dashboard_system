import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  activityAllowsSecondInstructor,
  deriveActivityMeetingRange,
  resolveSchoolRecord,
  schoolBelongsToAuthority,
  schoolsForAuthority,
} from '../frontend/src/screens/shared/activity-form-rules.js';
import { attendanceDateWarning } from '../attendance/src/services/activity-date-warning.js';

const schools = [
  { school_id: 10, authority_id: 1, name: 'אלון' },
  { school_id: 11, authority_id: 1, name: 'הרצל' },
  { school_id: 20, authority_id: 2, name: 'אלון' },
];

test('authority filters searchable school choices by real IDs', () => {
  assert.deepEqual(schoolsForAuthority(schools, 1).map((row) => row.school_id), [10, 11]);
  assert.equal(resolveSchoolRecord(schools, 'הרצ', 1), null);
  assert.equal(resolveSchoolRecord(schools, 'הרצל', 1)?.school_id, 11);
  assert.equal(resolveSchoolRecord(schools, 'אלון', 2)?.school_id, 20);
});

test('school-authority validation rejects mismatches and authority change invalidates selection', () => {
  assert.equal(schoolBelongsToAuthority(schools, 10, 1), true);
  assert.equal(schoolBelongsToAuthority(schools, 10, 2), false);
  assert.equal(resolveSchoolRecord(schools, 10, 2), null);
});

test('multi-session range uses actual first and last meeting dates', () => {
  assert.deepEqual(deriveActivityMeetingRange(['2026-09-19', '', '2026-09-11']), {
    startDate: '2026-09-11',
    endDate: '2026-09-19',
  });
});

test('only catalog-identified Tamir workshop allows a second instructor', () => {
  const catalog = [{ activity_no: 'T-1', activity_name: 'תמיר - המחזור מתחיל בבית' }];
  assert.equal(activityAllowsSecondInstructor({ activity_type: 'workshop', activity_no: 'T-1' }, catalog), true);
  assert.equal(activityAllowsSecondInstructor({ activity_type: 'workshop', activity_no: 'W-1', activity_name: 'תמיר בטקסט חופשי' }, catalog), false);
  assert.equal(activityAllowsSecondInstructor({ activity_type: 'course', activity_no: 'T-1' }, catalog), false);
});

test('planned attendance date has no warning and exceptional date has a non-blocking warning', () => {
  const activity = { row_id: 'A-1', date_1: '2026-09-11', date_2: '2026-09-19' };
  assert.equal(attendanceDateWarning(activity, '2026-09-11'), '');
  assert.match(attendanceDateWarning(activity, '2026-09-15'), /אינו מופיע/);
  assert.match(attendanceDateWarning(activity, '2026-09-15'), /11\.09\.2026, 19\.09\.2026/);
});

test('add activity form has no instructor controls or manual multi-session end date', () => {
  const source = fs.readFileSync(new URL('../frontend/src/screens/activities.js', import.meta.url), 'utf8');
  const modal = source.slice(source.indexOf('function addActivityModalHtml'), source.indexOf('function resolveOneDayTypes'));
  assert.doesNotMatch(modal, /name="emp_id(?:_2)?"/);
  assert.doesNotMatch(modal, /name="end_date" type="date"/);
  assert.match(modal, /name="school" type="search"/);
});

test('attendance warning remains advisory and does not gate createRecord', () => {
  const source = fs.readFileSync(new URL('../attendance/src/screens/new-report-screen.js', import.meta.url), 'utf8');
  const submit = source.slice(source.indexOf("form.addEventListener('submit'"), source.indexOf('formArea.append(form)'));
  assert.match(submit, /syncDateWarning\(\)/);
  assert.match(submit, /await createRecord/);
  assert.doesNotMatch(submit, /if \(syncDateWarning\(\)\) return/);
});

const activityIntegritySql = fs.readFileSync(
  new URL('../supabase/migrations/20260904123000_canonicalize_activity_authority_school_snapshots.sql', import.meta.url),
  'utf8',
);

test('database backfill and trigger overwrite stale text from valid canonical IDs', () => {
  assert.match(activityIntegritySql, /update public\.activities activity[\s\S]*activity\.authority_id = school\.authority_id/);
  assert.match(activityIntegritySql, /set authority = authority\.authority_name,[\s\S]*school = school\.school_name/);
  assert.match(activityIntegritySql, /new\.authority := canonical_authority_name/);
  assert.match(activityIntegritySql, /new\.school := canonical_school_name/);
  assert.match(activityIntegritySql, /before insert or update\s+on public\.activities/i);
});

test('database trigger blocks mismatched school IDs and exposes them only through audit', () => {
  assert.match(activityIntegritySql, /school_authority_id is distinct from new\.authority_id/);
  assert.match(activityIntegritySql, /activity_school_authority_mismatch_audit/);
  assert.match(activityIntegritySql, /school\.authority_id is distinct from activity\.authority_id/);
  assert.doesNotMatch(activityIntegritySql, /update public\.activities[\s\S]*set authority_id\s*=/i);
});

test('database trigger guards new second-instructor assignments', () => {
  const sql = activityIntegritySql;
  assert.match(sql, /new_activity_instructors_must_use_scheduling/);
  assert.match(sql, /second_instructor_requires_tamir_workshop/);
  assert.match(sql, /proposal_activity_pricing/);
});
