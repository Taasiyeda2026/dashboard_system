import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  assignedDetailHtml,
  isAssignedCourseSchedulingManageable
} from '../frontend/src/screens/course-scheduling.js';
import { isCourseSchedulingInterfaceEligible } from '../frontend/src/screens/shared/activity-scheduling-eligibility.js';

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

test('replacement UI routes by completed meeting count and enforces operational inputs', async () => {
  const source = await readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
  assert.match(source, /meetingsDone >= 2 \? 'replace_locked_course_instructor' : 'reassign_locked_course_instructor'/);
  assert.match(source, /meetingsDone === 1 && !reason/);
  assert.match(source, /!reason \|\| !effectiveFrom \|\| !state\.courseSchedulingReplacementConfirmed/);
});
