import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  managerAttendancePriorityRows,
  managerAttendanceAttentionTotals
} from '../frontend/src/manager-attendance-priority.js';
import { resolveManagerAttendanceOverviewState } from '../frontend/src/screens/attendance-control.js';

const workspace = await readFile(new URL('../frontend/src/manager-board-workspace-runtime.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../frontend/src/styles/manager-board-workspace.css', import.meta.url), 'utf8');
const reopen = await readFile(new URL('../frontend/src/attendance-self-submit-reopen-runtime.js', import.meta.url), 'utf8');

const members = [
  { emp_id: '201', full_name: 'אושר' },
  { emp_id: '202', full_name: 'ממתין לאישור מנהל' },
  { emp_id: '203', full_name: 'עדיין עובד' },
  { emp_id: '204', full_name: 'שינוי לאחר אישור' },
  { emp_id: '205', full_name: 'ללא דיווח' }
];
const summary = {
  recordCounts: new Map([['201', 5], ['202', 4], ['203', 3], ['204', 6], ['205', 0]]),
  workflowByEmployee: new Map([
    ['201', { workflow_status: 'approved', attendance_submission_status: 'locked' }],
    ['202', { workflow_status: 'submitted', attendance_submission_status: 'submitted' }],
    ['203', { workflow_status: 'not_submitted', attendance_submission_status: 'open' }],
    ['204', { workflow_status: 'manager_approved', attendance_submission_status: 'locked' }]
  ]),
  pendingRecordsByEmployee: new Map([['201', 5], ['202', 2], ['203', 3], ['204', 6]]),
  pendingTravelByEmployee: new Map([['201', 2], ['202', 1], ['203', 4], ['204', 3]]),
  auditByEmployee: new Map([['204', 1]])
};

test('manager sees signed-month anomalies first, then submitted months; completed ones last', () => {
  const sorted = managerAttendancePriorityRows(members, summary, resolveManagerAttendanceOverviewState);
  assert.deepEqual(sorted.map((row) => row.employeeId), ['204', '202', '203', '205', '201']);
  assert.equal(sorted[0].auditCount, 1);
  assert.equal(sorted[1].recordsToReview, 2);
  assert.equal(sorted[1].travelToReview, 1);
  assert.equal(sorted.at(-1).needsAttention, false);
});

test('only submitted months count pending manager approvals; missing instructor submissions are separate', () => {
  const sorted = managerAttendancePriorityRows(members, summary, resolveManagerAttendanceOverviewState);
  const totals = managerAttendanceAttentionTotals(sorted);
  assert.deepEqual(totals, {
    instructors: 5,
    awaitingManager: 1,
    pendingRecords: 2,
    pendingTravel: 1,
    awaitingInstructor: 2,
    postApprovalChanges: 1,
    attentionCount: 4
  });
  assert.equal(sorted.find((row) => row.employeeId === '203').recordsToReview, 0);
  assert.equal(sorted.find((row) => row.employeeId === '201').travelToReview, 0);
});

test('empty month is safe, counts stay zero and already-approved rows have no action flags', () => {
  assert.deepEqual(managerAttendancePriorityRows([], {}, resolveManagerAttendanceOverviewState), []);
  assert.deepEqual(managerAttendanceAttentionTotals([]), {
    instructors: 0, awaitingManager: 0, pendingRecords: 0, pendingTravel: 0,
    awaitingInstructor: 0, postApprovalChanges: 0, attentionCount: 0
  });
  const approved = managerAttendancePriorityRows([members[0]], summary, resolveManagerAttendanceOverviewState);
  assert.equal(approved[0].priority, 4);
  assert.equal(approved[0].needsAttention, false);
});

test('overview queries record approvals and daily travel in team scope without writing', () => {
  assert.match(workspace, /api\.attendanceControlRecordReviews\(\{ recordIds \}\)/);
  assert.match(workspace, /api\.attendanceControlDailyTravelReports\(\{/);
  assert.match(workspace, /employeeIds: numericIds, fromDate, toDate/);
  assert.match(workspace, /value\.pendingRecordsByEmployee = pendingRecordsByEmployee/);
  assert.match(workspace, /value\.pendingTravelByEmployee = pendingTravelByEmployee/);
  assert.match(workspace, /summary\.reviewsError, summary\.travelError/);
  assert.match(workspace, /if \(managerAttendanceSummaryError\(summary\)\)/);
});

test('manager can filter attention without losing all employees or reopening approved months', () => {
  assert.match(workspace, /data-manager-attendance-filter="all"/);
  assert.match(workspace, /data-manager-attendance-filter="attention"/);
  assert.match(workspace, /data-manager-attendance-attention="\$\{needsAttention \? '1' : '0'\}"/);
  assert.match(workspace, /tr\.hidden = !show/);
  assert.match(workspace, /choice\.setAttribute\('aria-pressed', String\(selected\)\)/);
  assert.match(css, /manager-workspace-attendance-list \[data-manager-attendance-attention\]\[hidden\]\{display:none!important\}/);
  assert.match(workspace, /data-manager-attendance-refresh/);
});

test('subsequent workflow badge refresh never discards pending details or signed-month warnings', () => {
  assert.match(reopen, /const currentBadge = statusCell\.querySelector\('\.manager-workspace-status'\)/);
  assert.match(reopen, /currentBadge\.replaceWith\(nextBadge\)/);
  assert.doesNotMatch(reopen, /statusCell\.innerHTML = nextHtml/);
});
