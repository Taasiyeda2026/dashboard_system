import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  canManagerMutatePayrollEmployeeMonth,
  EMPLOYEE_MONTH_NOT_SUBMITTED_READONLY_MESSAGE,
  resolvePayrollMonthWorkflow,
  resultsHtml
} from '../frontend/src/screens/attendance-control.js';

const migration = await readFile(
  new URL('../supabase/migrations/20260927153000_guard_manager_attendance_requires_submitted_month.sql', import.meta.url),
  'utf8'
);
const restoreMigration = await readFile(
  new URL('../supabase/migrations/20260930103000_restore_manager_attendance_submitted_month_gate.sql', import.meta.url),
  'utf8'
);
const control = await readFile(new URL('../frontend/src/screens/attendance-control.js', import.meta.url), 'utf8');

const baseEntry = {
  id: 'gate-1',
  managerResolved: 'auto_ok',
  attendance: {
    employeeId: '1530',
    employeeName: 'ורד עליאן',
    date: '2026-09-10',
    startTime: '08:00',
    endTime: '09:00',
    workHours: 1,
    activityType: 'קורס',
    program: 'קורס א',
    school: 'בית ספר',
    authority: 'רשות',
    kilometers: 12
  },
  dashboard: {
    employeeId: '1530',
    date: '2026-09-10',
    startTime: '08:00',
    endTime: '10:00',
    workHours: 2,
    activityType: 'קורס',
    program: 'קורס א',
    school: 'בית ספר',
    authority: 'רשות',
    kilometers: 12
  },
  final: {
    employeeId: '1530',
    employeeName: 'ורד עליאן',
    date: '2026-09-10',
    startTime: '08:00',
    endTime: '09:00',
    workHours: 1,
    activityType: 'קורס',
    program: 'קורס א',
    school: 'בית ספר',
    authority: 'רשות',
    kilometers: 12
  },
  differences: [
    { key: 'endTime', label: 'שעת סיום', type: 'time', attendance: '09:00', dashboard: '10:00', choice: 'attendance', custom: '' }
  ],
  unmatched: false
};

const payload = { comparisons: [baseEntry], notCompared: [], dailyKilometers: [] };

test('not_submitted month is read-only for team managers in attendance control UI', () => {
  assert.equal(canManagerMutatePayrollEmployeeMonth({ workflow_status: 'not_submitted' }), false);
  assert.equal(resolvePayrollMonthWorkflow({}).status, 'not_submitted');

  const html = resultsHtml(payload, '2026-09', {
    workflowByEmployee: { '1530': { workflow_status: 'not_submitted', attendance_submission_status: 'open' } }
  });
  assert.match(html, /data-payroll-employee-readonly="1"/);
  assert.match(html, new RegExp(EMPLOYEE_MONTH_NOT_SUBMITTED_READONLY_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(html, /data-attendance-edit-record=/);
  assert.doesNotMatch(html, /data-attendance-approve-reported=/);
  assert.doesNotMatch(html, /data-attendance-field-choice=/);
  assert.doesNotMatch(html, /data-attendance-manual-edit=/);
  assert.doesNotMatch(html, /data-payroll-finish="1530"/);
  assert.doesNotMatch(html, /אישור חישוב מערכת/);
});

test('missing attendance_month_approvals row is treated as not_submitted read-only', () => {
  const html = resultsHtml(payload, '2026-09', { workflowByEmployee: {} });
  assert.match(html, /data-payroll-employee-readonly="1"/);
  assert.match(html, /data-payroll-readonly-notice/);
  assert.doesNotMatch(html, /data-attendance-edit-record=/);
  assert.doesNotMatch(html, /data-attendance-approve-reported=/);
});

test('submitted month allows team manager edit and record approval controls', () => {
  assert.equal(canManagerMutatePayrollEmployeeMonth({
    workflow_status: 'submitted',
    attendance_submission_status: 'submitted'
  }), true);

  const html = resultsHtml(payload, '2026-09', {
    workflowByEmployee: { '1530': { workflow_status: 'submitted', attendance_submission_status: 'submitted' } }
  });
  assert.doesNotMatch(html, /data-payroll-employee-readonly=/);
  assert.match(html, /data-attendance-edit-record="gate-1"/);
  assert.match(html, /data-attendance-approve-reported="gate-1"/);
  assert.match(html, /data-attendance-field-choice=/);
  assert.match(html, /data-payroll-finish="1530"/);
  assert.doesNotMatch(html, /data-payroll-readonly-notice/);
});

test('manager_approved and locked months return to read-only for team managers', () => {
  assert.equal(canManagerMutatePayrollEmployeeMonth({
    workflow_status: 'manager_approved',
    attendance_submission_status: 'locked',
    manager_approved_at: '2026-09-20T10:00:00.000Z'
  }), false);

  const html = resultsHtml(payload, '2026-09', {
    workflowByEmployee: {
      '1530': {
        workflow_status: 'manager_approved',
        attendance_submission_status: 'locked',
        manager_approved_at: '2026-09-20T10:00:00.000Z',
        manager_approved_by_name: 'מנהל בדיקה'
      }
    }
  });
  assert.match(html, /data-payroll-employee-readonly="1"/);
  assert.doesNotMatch(html, /data-attendance-edit-record=/);
  assert.doesNotMatch(html, /data-attendance-approve-reported=/);
  assert.doesNotMatch(html, /data-payroll-finish="1530"/);
  assert.match(html, /אושר על ידי המנהל/);
});

test('admin bypass keeps mutation controls available before employee submission', () => {
  assert.equal(canManagerMutatePayrollEmployeeMonth(
    { workflow_status: 'not_submitted' },
    { bypassMonthSubmissionGate: true }
  ), true);

  const html = resultsHtml(payload, '2026-09', {
    workflowByEmployee: { '1530': { workflow_status: 'not_submitted', attendance_submission_status: 'open' } },
    bypassMonthSubmissionGate: true
  });
  assert.doesNotMatch(html, /data-payroll-employee-readonly=/);
  assert.match(html, /data-attendance-edit-record="gate-1"/);
  assert.match(html, /data-attendance-approve-reported="gate-1"/);
  assert.match(html, /data-attendance-field-choice=/);
  assert.doesNotMatch(html, /data-payroll-readonly-notice/);
  assert.doesNotMatch(html, /data-attendance-add-record=/);
});

test('admin bypass cannot mutate locked or final-payroll months', () => {
  assert.equal(canManagerMutatePayrollEmployeeMonth(
    {
      workflow_status: 'manager_approved',
      attendance_submission_status: 'locked',
      manager_approved_at: '2026-09-20T10:00:00.000Z'
    },
    { bypassMonthSubmissionGate: true }
  ), false);
  assert.equal(canManagerMutatePayrollEmployeeMonth(
    {
      workflow_status: 'approved',
      attendance_submission_status: 'locked',
      payroll_approved_at: '2026-09-25T10:00:00.000Z'
    },
    { bypassMonthSubmissionGate: true }
  ), false);

  const html = resultsHtml(payload, '2026-09', {
    workflowByEmployee: {
      '1530': {
        workflow_status: 'manager_approved',
        attendance_submission_status: 'locked',
        manager_approved_at: '2026-09-20T10:00:00.000Z'
      }
    },
    bypassMonthSubmissionGate: true
  });
  assert.match(html, /data-payroll-employee-readonly="1"/);
  assert.doesNotMatch(html, /data-attendance-edit-record=/);
});

test('server RPCs require submitted month for team managers and preserve admin bypass', () => {
  for (const sql of [migration, restoreMigration]) {
    assert.match(sql, /create or replace function public\.attendance_manager_month_allows_mutation/);
    assert.match(sql, /if v_role in \('admin', 'operation_manager'\) then\s+return true;/);
    assert.match(sql, /return v_status = 'submitted'/);
    assert.match(sql, /if not found then\s+return false;/);
    assert.match(sql, /attendance_month_not_submitted_for_manager_mutation/);
    assert.match(sql, /update_payroll_attendance_record/);
    assert.match(sql, /set_manager_attendance_record_review/);
    assert.match(
      sql,
      /if not public\.attendance_manager_month_allows_mutation\(v_row\.emp_id, v_row\.report_date\) then[\s\S]*attendance_month_not_submitted_for_manager_mutation/
    );
    assert.equal(
      (sql.match(/attendance_manager_month_allows_mutation\(v_row\.emp_id, v_row\.report_date\)/g) || []).length,
      2
    );
  }
  assert.match(restoreMigration, /never recorded\/applied on the live database/);
  assert.match(restoreMigration, /expense_details = case[\s\S]*totalExpenses[\s\S]*<= 0/);
});

test('attendance control binds admin bypass and client-side mutation gate', () => {
  assert.match(control, /bypassMonthSubmissionGate = \['admin', 'operation_manager'\]\.includes\(role\)/);
  assert.match(control, /assertEmployeeMonthMutableForManager/);
  assert.match(control, /EMPLOYEE_MONTH_NOT_SUBMITTED_READONLY_MESSAGE/);
  assert.match(control, /canManagerMutatePayrollEmployeeMonth/);
  assert.match(control, /teamManagerEmployeeMonthWriteAllowed/);
  assert.match(control, /canManagerFinalizeEmployeeMonth/);
  assert.match(control, /resolved\.status === 'manager_approved' \|\| resolved\.status === 'approved'/);
});
