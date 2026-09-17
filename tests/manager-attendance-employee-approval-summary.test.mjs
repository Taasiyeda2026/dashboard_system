import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../frontend/src/manager-board-final-fixes-runtime.js', import.meta.url), 'utf8');

test('manager attendance summary reads employee month workflow statuses', () => {
  assert.match(source, /attendanceControlMonthWorkflowStatuses/);
  assert.match(source, /אושר על ידי העובד · ממתין לבקרת מנהל/);
  assert.match(source, /אושר על ידי המנהל/);
  assert.match(source, /אושר סופית/);
});

test('manager attendance alert counts use employee submission workflow', () => {
  assert.match(source, /employeeApprovedCount/);
  assert.match(source, /awaitingEmployeeApprovalCount/);
  assert.match(source, /טרם אושר/);
  assert.match(source, /אושרו/);
});
