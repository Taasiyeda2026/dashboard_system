import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { courseSchedulingAllowedEndDate } from '../frontend/src/screens/course-scheduling-periods.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('first-half courses can continue through February without date overflow', () => {
  assert.equal(courseSchedulingAllowedEndDate('first'), '2027-02-28');
  assert.equal(courseSchedulingAllowedEndDate('second'), '2027-06-30');
  assert.equal(courseSchedulingAllowedEndDate('year'), '2027-06-30');
  assert.equal('2027-02-14' > courseSchedulingAllowedEndDate('first'), false);
  assert.equal('2027-03-01' > courseSchedulingAllowedEndDate('first'), true);
});

test('draft and confirmation use the same allowed end and never invent original dates', async () => {
  const src = await read('../frontend/src/screens/course-scheduling.js');
  assert.match(src, /hasOfficialDates: official\.length > 0/);
  assert.match(src, /original_date: text\(original\)/);
  assert.match(src, /const allowedEnd = courseSchedulingAllowedEndDate/);
  assert.match(src, /const halfEnd = courseSchedulingAllowedEndDate\(selectedPeriodKey\(state\)\)/);
  assert.match(src, /טרם נקבע/);
  assert.doesNotMatch(src, /original_date: text\(original\) \|\| date/);
});

test('the approval-status renderer deduplicates concurrent RPC reads without caching approvals', async () => {
  const src = await read('../frontend/src/screens/shared/course-scheduling-manager-approval.js');
  assert.match(src, /const inFlightApprovalStates = new Map\(\)/);
  assert.match(src, /const pending = inFlightApprovalStates\.get\(courseId\)/);
  assert.match(src, /const approvalState = await loadManagerApprovalState\(courseId\)/);
  assert.equal((src.match(/supabase\.rpc\('course_assignment_manager_approval_state'/g) || []).length, 1);
  assert.match(src, /inFlightApprovalStates\.delete\(courseId\)/);
  assert.match(src, /host\.isConnected === false/);
  assert.match(src, /confirmButton\.disabled = !approved/);
});

test('server performance migration retains all mandatory checks and caches expensive expansion', async () => {
  const sql = await read('../supabase/migrations/20261027164130_optimize_manual_assignment_approval_checks.sql');
  assert.match(sql, /SECURITY DEFINER/);
  assert.match(sql, /SET search_path TO 'public'/);
  assert.match(sql, /other_meetings jsonb/);
  assert.equal((sql.match(/scheduling_effective_meetings\(a, p_emp_id\)/g) || []).length, 1);
  assert.equal((sql.match(/jsonb_to_recordset\(other_meetings\)/g) || []).length, 3);
  for (const constraint of [
    'scheduling_conflict_detected',
    'scheduling_transition_insufficient',
    'scheduling_transition_distance_forbidden',
    'scheduling_home_route_unverified',
    'scheduling_availability_missing',
    'scheduling_course_blocked'
  ]) assert.ok(sql.includes(constraint), `required check ${constraint} was removed`);
});
