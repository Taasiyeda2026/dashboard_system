import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workspace = await readFile(new URL('../frontend/src/manager-board-workspace-runtime.js', import.meta.url), 'utf8');
const control = await readFile(new URL('../frontend/src/screens/attendance-control.js', import.meta.url), 'utf8');

test('manager attendance summary reads employee month workflow statuses in the renderer', () => {
  assert.match(workspace, /attendanceControlMonthWorkflowStatuses/);
  assert.match(workspace, /resolveManagerAttendanceOverviewState/);
  assert.match(control, /אושר על ידי העובד · ממתין לבקרת מנהל/);
  assert.match(control, /אושר על ידי המנהל/);
  assert.match(control, /אושר סופית/);
});

test('manager attendance alert counts use employee submission workflow', () => {
  assert.match(workspace, /awaitingApproval/);
  assert.match(workspace, /employeeApproved/);
  assert.match(workspace, /טרם אושר ע״י העובד/);
  assert.match(workspace, /אושר ע״י העובד/);
});
