import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  canManagerAddMissingAttendanceRecord,
  canManagerFinalizeEmployeeMonth,
  canManagerMutatePayrollEmployeeMonth,
  resultsHtml,
  teamManagerEmployeeMonthWriteAllowed
} from '../frontend/src/screens/attendance-control.js';

const migration = await readFile(
  new URL('../supabase/migrations/20261005201500_manager_attendance_reopened_write_gate.sql', import.meta.url),
  'utf8'
);
const control = await readFile(new URL('../frontend/src/screens/attendance-control.js', import.meta.url), 'utf8');
const priorAddMigration = await readFile(
  new URL('../supabase/migrations/20261004164845_manager_add_missing_attendance_during_review.sql', import.meta.url),
  'utf8'
);

const payload = {
  comparisons: [{
    id: 'row-1',
    managerResolved: 'auto_ok',
    attendance: {
      employeeId: '1530',
      employeeName: 'מדריך',
      date: '2026-09-10',
      startTime: '08:00',
      endTime: '09:00',
      workHours: 1,
      activityType: 'קורס',
      program: 'קורס',
      school: 'בית ספר',
      authority: 'רשות',
      kilometers: 0
    },
    final: {
      employeeId: '1530',
      date: '2026-09-10',
      startTime: '08:00',
      endTime: '09:00',
      workHours: 1,
      activityType: 'קורס',
      kilometers: 0
    },
    differences: []
  }],
  notCompared: [],
  dailyKilometers: []
};

test('central team-manager write gate allows submitted only after hierarchy change', () => {
  assert.equal(teamManagerEmployeeMonthWriteAllowed({
    attendance_submission_status: 'submitted',
    workflow_status: 'submitted'
  }), true);
  assert.equal(teamManagerEmployeeMonthWriteAllowed({
    attendance_submission_status: 'reopened',
    workflow_status: 'not_submitted'
  }), false);
  assert.equal(teamManagerEmployeeMonthWriteAllowed({
    attendance_submission_status: 'open',
    workflow_status: 'not_submitted'
  }), false);
  assert.equal(teamManagerEmployeeMonthWriteAllowed({
    attendance_submission_status: 'locked',
    workflow_status: 'manager_approved',
    manager_approved_at: '2026-09-20T10:00:00Z'
  }), false);
  assert.equal(teamManagerEmployeeMonthWriteAllowed({
    attendance_submission_status: 'submitted',
    workflow_status: 'approved',
    payroll_approved_at: '2026-09-25T10:00:00Z'
  }), false);
});

test('edit and add flows share the same team-manager gate', () => {
  const reopened = { attendance_submission_status: 'reopened', workflow_status: 'not_submitted' };
  assert.equal(canManagerMutatePayrollEmployeeMonth(reopened), false);
  assert.equal(canManagerAddMissingAttendanceRecord(reopened), false);
  const open = { attendance_submission_status: 'open', workflow_status: 'not_submitted' };
  assert.equal(canManagerMutatePayrollEmployeeMonth(open), false);
  assert.equal(canManagerAddMissingAttendanceRecord(open), false);
});

test('reopened month blocks manager add, edit, and finalize until employee resubmits', () => {
  assert.equal(canManagerFinalizeEmployeeMonth({
    attendance_submission_status: 'reopened',
    workflow_status: 'not_submitted'
  }), false);

  const html = resultsHtml(payload, '2026-09', {
    workflowByEmployee: {
      '1530': { attendance_submission_status: 'reopened', workflow_status: 'not_submitted' }
    }
  });
  assert.doesNotMatch(html, /data-attendance-add-record="1530"/);
  assert.doesNotMatch(html, /data-payroll-finish="1530"/);
  assert.doesNotMatch(html, /data-attendance-edit-record=/);
});

test('submitted month keeps add-record and finalize controls', () => {
  const html = resultsHtml(payload, '2026-09', {
    workflowByEmployee: {
      '1530': { attendance_submission_status: 'submitted', workflow_status: 'submitted' }
    }
  });
  assert.match(html, /data-attendance-add-record="1530"/);
  assert.match(html, /data-payroll-finish="1530"/);
});

test('open month has no add button and remains read-only for team managers', () => {
  const html = resultsHtml(payload, '2026-09', {
    workflowByEmployee: {
      '1530': { attendance_submission_status: 'open', workflow_status: 'not_submitted' }
    }
  });
  assert.doesNotMatch(html, /data-attendance-add-record=/);
  assert.match(html, /data-payroll-employee-readonly="1"/);
});

test('locked and approved_for_payroll months stay blocked in UI gate', () => {
  assert.equal(canManagerMutatePayrollEmployeeMonth({
    attendance_submission_status: 'locked',
    workflow_status: 'manager_approved',
    manager_approved_at: '2026-09-20T10:00:00Z'
  }), false);
  assert.equal(canManagerAddMissingAttendanceRecord({
    attendance_submission_status: 'submitted',
    workflow_status: 'approved',
    payroll_approved_at: '2026-09-25T10:00:00Z'
  }), false);
});

test('admin bypass behavior is unchanged for open months but finalize still needs submitted workflow', () => {
  assert.equal(canManagerMutatePayrollEmployeeMonth(
    { attendance_submission_status: 'open', workflow_status: 'not_submitted' },
    { bypassMonthSubmissionGate: true }
  ), true);
  assert.equal(canManagerFinalizeEmployeeMonth(
    { attendance_submission_status: 'open', workflow_status: 'not_submitted' },
    { bypassMonthSubmissionGate: true }
  ), false);
});

test('historical PR 2115 migration remains immutable in migration history', () => {
  assert.match(migration, /attendance_manager_record_creates/);
  assert.match(migration, /manager_review_add/);
  assert.match(migration, /v_status not in \('submitted', 'reopened'\)/);
  assert.match(migration, /av2_attendance_month_is_closed/);
  assert.match(migration, /attendance_manager_month_allows_mutation/);
  assert.match(migration, /insert into public\.attendance_manager_record_creates/);
  assert.match(migration, /create_manager_attendance_record/);
  assert.doesNotMatch(migration, /v_status <> 'submitted'/);
});

test('create RPC blocks open and closed months even for admin bypass roles', () => {
  const createStart = migration.indexOf('create or replace function public.create_manager_attendance_record');
  assert.notEqual(createStart, -1);
  const createRpc = migration.slice(createStart);
  assert.match(createRpc, /from public\.attendance_month_approvals ama[\s\S]*for update/);
  assert.match(createRpc, /v_status not in \('submitted', 'reopened'\)/);
  assert.match(createRpc, /av2_attendance_month_is_closed\(p_employee_id, v_report_date\)/);
  assert.match(createRpc, /attendance_month_locked/);
});

test('create RPC keeps direct-manager scope and instructor emp_id ownership', () => {
  assert.match(migration, /attendance_manager_can_review_employee\(p_employee_id\)/);
  assert.match(migration, /insert into public\.attendance_records[\s\S]*p_employee_id/);
  assert.match(migration, /requiresManagerReview', true/);
  assert.match(priorAddMigration, /app\.av2_manager_attendance_write/);
});

test('attendance control uses one shared gate for edit and add flows', () => {
  assert.match(control, /teamManagerEmployeeMonthWriteAllowed/);
  assert.match(control, /canManagerAddMissingAttendanceRecord\(workflowRow\)/);
  assert.match(control, /canManagerFinalizeEmployeeMonth/);
  assert.match(control, /canManagerMutatePayrollEmployeeMonth\(workflowRow/);
});
