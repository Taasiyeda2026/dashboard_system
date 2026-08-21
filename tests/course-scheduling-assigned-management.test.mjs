import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  assignedDetailHtml,
  buildCourseReassignmentRpc,
  isAssignedCourseSchedulingManageable
} from '../frontend/src/screens/course-scheduling.js';
import { isCourseSchedulingInterfaceEligible } from '../frontend/src/screens/shared/activity-scheduling-eligibility.js';
import { clearCourseSchedulingReplacementState } from '../frontend/src/screens/shared/instructors-workspace-nav.js';

const assigned = {
  row_id: 'course-1', activity_season: 'school_2027', activity_type: 'קורס', status: 'פתוח',
  activity_name: 'רובוטיקה', school_id: 1, school: 'אלון', authority: 'חיפה', school_address: 'חיפה',
  instruction_language: 'עברית', start_time: '09:00', end_time: '10:00', date_1: '2027-01-01',
  emp_id: '42', instructor_name: 'דנה כהן'
};

test('assigned course is manageable but remains excluded from the free scheduling engine', () => {
  assert.equal(isAssignedCourseSchedulingManageable(assigned), true);
  assert.equal(isCourseSchedulingInterfaceEligible(assigned), false);
});

test('assignedDetailHtml shows instructor and management actions', () => {
  const html = assignedDetailHtml({ id: assigned.row_id, course: assigned, isAssigned: true }, {});
  assert.match(html, /שובץ/);
  assert.match(html, /מדריך משובץ: <b>דנה כהן<\/b>/);
  assert.match(html, /שינוי \/ החלפת מדריך/);
  assert.match(html, /ביטול שיבוץ/);
});

test('confirmed cancellation RPC requires reason, audits, preserves completed history, and clears assignment', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260821120000_cancel_confirmed_course_assignment.sql', import.meta.url), 'utf8');
  assert.match(sql, /scheduling_reason_required/);
  assert.match(sql, /for update/i);
  assert.match(sql, /course_meeting_instructor_history/);
  assert.match(sql, /assignment_cancelled/);
  assert.match(sql, /previous_emp_id, previous_instructor_name/);
  assert.match(sql, /emp_id = null[\s\S]*instructor_assignment_locked = false[\s\S]*draft_emp_id = null/);
  assert.match(sql, /grant execute on function public\.cancel_confirmed_course_assignment\(text,text\) to authenticated/);
});

test('cancellation audit keeps a non-null identity for the prior assignment', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260821120000_cancel_confirmed_course_assignment.sql', import.meta.url), 'utf8');
  assert.match(sql, /p_activity_id,\s*prior_emp_id,\s*coalesce\(nullif\(btrim\(prior_instructor_name\), ''\), prior_emp_id\),\s*'assignment_cancelled'/);
  assert.doesNotMatch(sql, /p_activity_id,\s*null,\s*null,\s*'assignment_cancelled'/);
});

test('replacement UI routes by completed meeting count and enforces operational inputs', async () => {
  const source = await readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
  assert.match(source, /meetingsDone >= 2 \? 'replace_locked_course_instructor' : 'reassign_locked_course_instructor'/);
  assert.match(source, /meetingsDone === 1 && !reason/);
  assert.match(source, /!reason \|\| !effectiveFrom \|\| !state\.courseSchedulingReplacementConfirmed/);
});

test('ordinary reassignment payload matches the deployed RPC parameter names', () => {
  const selected = { instructor: { emp_id: '52', full_name: 'יעל לוי' }, score: 91 };
  const topCandidate = { instructor: { emp_id: '52', full_name: 'יעל לוי' }, score: 91 };
  const payload = buildCourseReassignmentRpc({ activityId: 'course-1', selectedId: '52', selected, topCandidate, reason: '' });
  assert.equal(payload.p_new_emp_id, 52);
  assert.equal(payload.p_new_instructor_name, 'יעל לוי');
  assert.equal(Object.hasOwn(payload, 'p_emp_id'), false);
  assert.equal(Object.hasOwn(payload, 'p_instructor_name'), false);
});

test('backend reassignment transition guards block 2+ meetings and require reason after one', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260821130000_restore_reassignment_transition_guards.sql', import.meta.url), 'utf8');
  assert.match(sql, /meetings_done >= 2 then\s+raise exception 'scheduling_course_locked_for_reassignment'/);
  assert.match(sql, /meetings_done >= 1 and nullif\(btrim\(p_reason\), ''\) is null then\s+raise exception 'scheduling_reason_required'/);
  assert.match(sql, /scheduling_course_instructor_violations\(p_activity_id, p_new_emp_id, false\)/);
});

test('cancellation clears all draft metadata and error mapping uses the canonical lock code', async () => {
  const [migration, source] = await Promise.all([
    readFile(new URL('../supabase/migrations/20260821120000_cancel_confirmed_course_assignment.sql', import.meta.url), 'utf8'),
    readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8')
  ]);
  assert.match(migration, /draft_created_by = null/);
  assert.match(source, /scheduling_course_locked_for_reassignment:/);
  assert.doesNotMatch(source, /scheduling_reassignment_locked:/);
});

test('replacement cleanup resets temporary state without discarding other course results', () => {
  const state = {
    courseSchedulingReplacementCourseId: 'course-1',
    courseSchedulingReplacementMeetings: 2,
    courseSchedulingReplacementReason: 'החלפה תפעולית',
    courseSchedulingReplacementEffectiveFrom: '2027-01-15',
    courseSchedulingReplacementConfirmed: true,
    courseSchedulingSelectedCandidateId: '52',
    courseSchedulingExpandedCandidateId: '52',
    courseSchedulingResults: [
      { course: { row_id: 'course-1' }, status: 'הצעה מוכנה' },
      { course: { row_id: 'course-2' }, status: 'הצעה מוכנה' }
    ]
  };

  assert.equal(clearCourseSchedulingReplacementState(state), 'course-1');
  assert.equal(state.courseSchedulingReplacementCourseId, '');
  assert.equal(state.courseSchedulingReplacementMeetings, 0);
  assert.equal(state.courseSchedulingReplacementReason, '');
  assert.equal(state.courseSchedulingReplacementEffectiveFrom, '');
  assert.equal(state.courseSchedulingReplacementConfirmed, false);
  assert.equal(state.courseSchedulingSelectedCandidateId, '');
  assert.equal(state.courseSchedulingExpandedCandidateId, '');
  assert.deepEqual(state.courseSchedulingResults.map((result) => result.course.row_id), ['course-2']);
});
