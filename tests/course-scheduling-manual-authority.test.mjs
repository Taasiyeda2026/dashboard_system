import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateCourseSchedule } from '../frontend/src/screens/course-scheduling-engine.js';

const migrationPath = new URL('../supabase/migrations/20260809210000_manual_instructor_choice_authoritative.sql', import.meta.url);
const functionBody = (sql, name, nextName = '') => {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  const end = nextName ? sql.indexOf(`create or replace function public.${nextName}(`, start + 1) : sql.length;
  assert.ok(start >= 0, `${name} must be replaced by the migration`);
  return sql.slice(start, end < 0 ? sql.length : end);
};

test('migration timestamp follows the already-deployed 20260809200000 cleanup', () => {
  assert.match(migrationPath.pathname, /20260809210000_manual_instructor_choice_authoritative\.sql$/);
});

test('admin and operation_manager are the only roles allowed through every manual write path', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  for (const name of ['assign_activity_instructor', 'reassign_locked_course_instructor', 'save_course_assignment_draft', 'save_course_assignment_draft_with_dates', 'assign_activity_instructor_with_dates']) {
    const body = functionBody(sql, name);
    assert.match(body, /not in \('admin','operation_manager'\)|not in \('admin', 'operation_manager'\)/, `${name} role gate`);
    assert.match(body, /auth\.uid\(\)[\s\S]*is_active/, `${name} active-user gate`);
  }
  assert.match(functionBody(sql, 'scheduling_clear_draft_on_manual_assignment', 'assign_activity_instructor'), /not in \('admin', 'operation_manager'\)/);
});

test('draft, direct, dated and replacement writes retain the chosen instructor without recommendation blockers or reason', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  const paths = [
    ['assign_activity_instructor', 'reassign_locked_course_instructor'],
    ['reassign_locked_course_instructor', 'save_course_assignment_draft'],
    ['save_course_assignment_draft', 'save_course_assignment_draft_with_dates'],
    ['save_course_assignment_draft_with_dates', 'assign_activity_instructor_with_dates'],
    ['assign_activity_instructor_with_dates', 'scheduling_apply_course_assignment_revalidation']
  ];
  for (const [name, next] of paths) {
    const body = functionBody(sql, name, next);
    assert.doesNotMatch(body, /scheduling_reason_required|scheduling_course_instructor_violations|scheduling_assert_home_route|scheduling_assert_assignment_calendar|scheduling_assert_proposed_eligibility|scheduling_course_conflict_exists/, `${name} must not reapply recommendation gates`);
  }
  assert.match(functionBody(sql, 'save_course_assignment_draft', 'save_course_assignment_draft_with_dates'), /draft_emp_id=p_emp_id::text/);
  assert.match(functionBody(sql, 'save_course_assignment_draft_with_dates', 'assign_activity_instructor_with_dates'), /draft_emp_id=p_emp_id::text[\s\S]*draft_proposed_meetings=canonical/);
  assert.match(functionBody(sql, 'assign_activity_instructor_with_dates', 'scheduling_apply_course_assignment_revalidation'), /scheduling_validate_proposed_meetings[\s\S]*scheduling_set_activity_meetings[\s\S]*assign_activity_instructor/);
});

test('manual activity replacement clears stale draft state and revalidation preserves approved state', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  const clearDraft = functionBody(sql, 'scheduling_clear_draft_on_manual_assignment', 'assign_activity_instructor');
  for (const field of ['draft_emp_id', 'draft_instructor_name', 'draft_created_at', 'draft_created_by', 'draft_proposed_meetings']) {
    assert.match(clearDraft, new RegExp(`new\\.${field} := null`));
  }
  assert.match(functionBody(sql, 'scheduling_apply_course_assignment_revalidation', 'scheduling_guard_activity_calendar_write'), /instructor_assignment_locked is true[\s\S]*instructor_assignment_status='שובץ'/);
  assert.match(functionBody(sql, 'scheduling_guard_activity_calendar_write'), /instructor_assignment_locked:=true[\s\S]*instructor_assignment_status:='שובץ'/);
});

test('recommendation engine still rejects an unavailable, distant instructor', () => {
  const activity = { row_id: 'manual-policy', activity_type: 'קורס', activity_season: 'school_2027', status: 'פתוח', school: 'בית ספר', school_address: 'יעד', instruction_language: 'he', required_instructor_gender: 'female', start_time: '10:00', end_time: '11:00', date_1: '2026-09-06' };
  const result = calculateCourseSchedule({
    activities: [activity],
    instructors: [{ emp_id: '7', full_name: 'מדריכה', active: 'yes', address: 'מוצא' }],
    profiles: { 7: { gender: 'female', instruction_languages: ['he'] } },
    rules: { 7: [{ weekday: 0, available: false }] }, exceptions: {}, assignments: {},
    travel: { 'manual-policy': { 7: { home: { distance_km: 80, duration_minutes: 90 }, transitions: {} } } }, routeMatrix: {}
  })[0];
  const checked = result.checked.find((candidate) => candidate.instructor.emp_id === '7');
  assert.equal(checked.eligible, false);
  assert.ok(checked.failures.length > 0);
  assert.notEqual(result.recommended?.instructor?.emp_id, '7');
});

test('migration is data-free and contains no backfill', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.doesNotMatch(sql, /^\s*do\s+\$\$/im);
  assert.doesNotMatch(sql, /^update\s+public\.activities/im);
  assert.doesNotMatch(sql, /^insert\s+into\s+public\.activities/im);
  assert.doesNotMatch(sql, /backfill/i);
});
