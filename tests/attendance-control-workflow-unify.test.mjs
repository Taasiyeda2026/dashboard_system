import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  canManagerMutatePayrollEmployeeMonth,
  countAdminPendingManagerApproved,
  resolveAdminAttendanceDefaultMonth,
  resolveManagerAttendanceOverviewState,
  resultsHtml,
  teamManagerEmployeeMonthWriteAllowed
} from '../frontend/src/screens/attendance-control.js';

const workspace = await readFile(new URL('../frontend/src/manager-board-workspace-runtime.js', import.meta.url), 'utf8');
const finalFixes = await readFile(new URL('../frontend/src/manager-board-final-fixes-runtime.js', import.meta.url), 'utf8');
const adminStandalone = await readFile(new URL('../frontend/src/admin-attendance-standalone.js', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
const migration = await readFile(
  new URL('../supabase/migrations/20261005210000_admin_pending_attendance_by_month.sql', import.meta.url),
  'utf8'
);
const approvedSnapshotMigration = await readFile(
  new URL('../supabase/migrations/20261006171217_admin_attendance_approved_snapshot_preview.sql', import.meta.url),
  'utf8'
);
const control = await readFile(new URL('../frontend/src/screens/attendance-control.js', import.meta.url), 'utf8');

const payload = {
  comparisons: [{
    id: 'row-approved',
    managerResolved: 'approved_as_reported',
    managerRecordApproved: true,
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

test('submitted overview state shows open-for-review action', () => {
  const overview = resolveManagerAttendanceOverviewState({
    workflow: { workflow_status: 'submitted', attendance_submission_status: 'submitted' },
    recordCount: 3
  });
  assert.equal(overview.status, 'submitted');
  assert.equal(overview.actionKind, 'review');
  assert.equal(overview.actionLabel, 'פתח לבדיקה');
  assert.equal(overview.opensManagerReview, true);
  assert.match(overview.statusLabel, /ממתין לבקרת מנהל/);
});

test('manager_approved overview never offers review reopen action', () => {
  const overview = resolveManagerAttendanceOverviewState({
    workflow: {
      workflow_status: 'manager_approved',
      attendance_submission_status: 'locked',
      manager_approved_at: '2026-09-20T10:00:00Z',
      manager_pdf_sharepoint_url: 'https://example.com/report.pdf'
    },
    recordCount: 4
  });
  assert.equal(overview.status, 'manager_approved');
  assert.equal(overview.actionKind, 'pdf');
  assert.equal(overview.actionLabel, 'צפייה בדוח');
  assert.equal(overview.opensManagerReview, false);
  assert.notEqual(overview.actionLabel, 'פתח לבדיקה');
  assert.doesNotMatch(overview.actionLabel, /פתח דוח לבדיקה/);
});

test('manager_approved without pdf has no review action', () => {
  const overview = resolveManagerAttendanceOverviewState({
    workflow: {
      workflow_status: 'manager_approved',
      attendance_submission_status: 'locked',
      manager_approved_at: '2026-09-20T10:00:00Z'
    },
    recordCount: 2
  });
  assert.equal(overview.actionKind, 'none');
  assert.equal(overview.opensManagerReview, false);
});

test('manager_approved blocks manager mutation actions', () => {
  const workflow = {
    workflow_status: 'manager_approved',
    attendance_submission_status: 'locked',
    manager_approved_at: '2026-09-20T10:00:00Z'
  };
  assert.equal(canManagerMutatePayrollEmployeeMonth(workflow), false);
  assert.equal(teamManagerEmployeeMonthWriteAllowed(workflow), false);
  const html = resultsHtml(payload, '2026-09', { workflowByEmployee: { '1530': workflow } });
  assert.doesNotMatch(html, /data-attendance-edit-record=/);
  assert.doesNotMatch(html, /data-attendance-approve-reported=/);
  assert.doesNotMatch(html, /data-attendance-add-record=/);
  assert.doesNotMatch(html, /data-payroll-finish=/);
});

test('approved month is read-only for managers', () => {
  const overview = resolveManagerAttendanceOverviewState({
    workflow: {
      workflow_status: 'approved',
      attendance_submission_status: 'locked',
      payroll_approved_at: '2026-09-25T10:00:00Z',
      manager_pdf_sharepoint_url: 'https://example.com/final.pdf'
    },
    recordCount: 2
  });
  assert.equal(overview.status, 'approved');
  assert.equal(overview.opensManagerReview, false);
  assert.equal(overview.actionKind, 'pdf');
  assert.equal(canManagerMutatePayrollEmployeeMonth({
    workflow_status: 'approved',
    attendance_submission_status: 'locked',
    payroll_approved_at: '2026-09-25T10:00:00Z'
  }), false);
});

test('reopened belongs to the employee and is read-only for the manager until resubmission', () => {
  const workflow = { attendance_submission_status: 'reopened', workflow_status: 'not_submitted' };
  const overview = resolveManagerAttendanceOverviewState({ workflow, recordCount: 2 });
  assert.equal(overview.status, 'reopened');
  assert.equal(overview.actionKind, 'view');
  assert.equal(overview.actionLabel, 'צפייה');
  assert.equal(overview.opensManagerReview, false);
  assert.match(overview.statusLabel, /פתוח לעובד/);
  assert.equal(teamManagerEmployeeMonthWriteAllowed(workflow), false);
  assert.equal(canManagerMutatePayrollEmployeeMonth(workflow), false);

  const html = resultsHtml(payload, '2026-09', { workflowByEmployee: { '1530': workflow } });
  assert.doesNotMatch(html, /data-attendance-add-record="1530"/);
  assert.doesNotMatch(html, /data-attendance-edit-record=/);
  assert.doesNotMatch(html, /data-payroll-finish="1530"/);
});

test('approved record renders static indicator instead of approve button', () => {
  const html = resultsHtml(payload, '2026-09', {
    workflowByEmployee: {
      '1530': { workflow_status: 'submitted', attendance_submission_status: 'submitted' }
    }
  });
  assert.match(html, /attendance-control__record-approved-indicator/);
  assert.match(html, /✓ רשומה אושרה/);
  assert.doesNotMatch(html, /data-attendance-approve-reported="row-approved"/);
  assert.match(html, /data-attendance-edit-record="row-approved"[^>]*data-attendance-edit-approved="1"/);
});

test('manager overview table no longer includes total-hours column', () => {
  assert.doesNotMatch(workspace, /<th>סה״כ שעות<\/th>/);
  assert.doesNotMatch(workspace, /data-label="סה״כ שעות"/);
  assert.doesNotMatch(workspace, /totalHours/);
  assert.doesNotMatch(workspace, /formatAttendanceHours/);
  assert.match(workspace, /resolveManagerAttendanceOverviewState/);
  assert.match(workspace, /overview\.actionLabel/);
  assert.match(workspace, /<th>מדריך<\/th><th>מס׳ עובד<\/th><th>דיווח \$\{escapeHtml\(ym\)\}<\/th><th>סטטוס אישור<\/th><th>פעולות<\/th>/);
  assert.match(workspace, /data-manager-attendance-reopen-employee/);
  assert.match(workspace, /פתח חודש לעובד/);
  assert.match(apiSource, /managerReopenAttendanceMonthForEmployee/);
  assert.doesNotMatch(workspace, /פתח דוח לבדיקה/);
});

test('manager overview action and status come from one workflow helper in the renderer', () => {
  assert.match(workspace, /attendanceControlMonthWorkflowStatuses/);
  assert.match(workspace, /workflowByEmployee/);
  assert.match(workspace, /data-manager-attendance-open-pdf/);
  assert.match(workspace, /data-manager-attendance-status=/);
  assert.match(control, /פתח לבדיקה/);
  assert.match(control, /אושר על ידי העובד · ממתין לבקרת מנהל/);
  assert.doesNotMatch(finalFixes, /setAttendanceWorkflowBadge/);
  assert.doesNotMatch(finalFixes, /attendanceControlMonthWorkflowStatuses/);
});

test('admin badge counts only manager_approved pending final admin approval', () => {
  const count = countAdminPendingManagerApproved([
    { workflow_status: 'manager_approved' },
    { workflow_status: 'submitted' },
    { workflow_status: 'reopened', attendance_submission_status: 'reopened' },
    { workflow_status: 'approved' },
    { workflow_status: 'manager_approved' },
    { workflow_status: 'not_submitted' }
  ]);
  assert.equal(count, 2);
  assert.match(adminStandalone, /ממתינים לאישור/);
  assert.match(adminStandalone, /adminPendingAttendanceByMonth|get_admin_pending_attendance_by_month/);
  assert.match(adminStandalone, /applyAdminHubPendingBadge/);
  assert.match(apiSource, /adminPendingAttendanceByMonth/);
  assert.match(migration, /get_admin_pending_attendance_by_month/);
  assert.match(migration, /manager_approved_at is not null/);
  assert.match(migration, /admin_approved', 'approved_for_payroll/);
});

test('admin attendance opens the latest pending manager_approved month', () => {
  assert.equal(resolveAdminAttendanceDefaultMonth({
    pendingByMonth: [
      { month_key: '2026-07', pending_count: 2 },
      { month_key: '2026-09', pending_count: 13 },
      { month_key: '2026-08', pending_count: 1 }
    ],
    currentMonth: '2026-10'
  }), '2026-09');
  assert.equal(resolveAdminAttendanceDefaultMonth({
    pendingByMonth: [],
    currentMonth: '2026-10'
  }), '2026-10');
  assert.match(adminStandalone, /resolveAdminAttendanceDefaultMonth/);
  assert.match(adminStandalone, /loadAdminPendingSummary/);
});

test('admin final approval refreshes pending badge and keeps payroll transfer separate', () => {
  assert.match(adminStandalone, /refreshPendingBadge\(true\)/);
  assert.match(adminStandalone, /adminFinalizeAttendanceMonthPayroll/);
  assert.match(adminStandalone, /manager_approved[^\n]+ממתין לאדמין/);
  assert.match(adminStandalone, /אישור סופי/);
  assert.match(adminStandalone, /העבר לשכר/);
  assert.match(adminStandalone, /<th>עובד<\/th><th>אישור עובד<\/th><th>אישור מנהל<\/th><th>אישור אדמין<\/th><th>סטטוס<\/th><th>פעולות<\/th>/);
  assert.doesNotMatch(adminStandalone, /<th>דיווח<\/th>/);
  assert.doesNotMatch(adminStandalone, /<th>ביטול זמן<\/th>/);
  assert.match(adminStandalone, /data-admin-attendance-approval-check/);
  assert.match(adminStandalone, /data-admin-attendance-approval-popover/);
  assert.match(adminStandalone, /table-layout:fixed/);
  assert.match(adminStandalone, /<col style="width:25%">/);
  assert.match(adminStandalone, /background:transparent; color:#166534/);
  assert.doesNotMatch(adminStandalone, /await api\.adminSendAttendanceMonthToPayroll\(\{[\s\S]*adminFinalize/);
});

test('admin super-control previews the immutable approved snapshot inline with expenses', () => {
  assert.match(adminStandalone, /data-admin-attendance-records=/);
  assert.match(adminStandalone, /צפייה ברשומות שאושרו/);
  assert.match(adminStandalone, /approvedSnapshotPreviewHtml/);
  assert.match(adminStandalone, /הוצאות ופירוט/);
  assert.match(adminStandalone, /אסמכתאות/);
  assert.match(adminStandalone, /approvedRowsChronological/);
  assert.match(adminStandalone, /data-admin-attendance-preview-row/);
  assert.match(apiSource, /adminAttendanceApprovedSnapshot/);
  assert.match(apiSource, /admin_get_attendance_approved_snapshot/);
  assert.match(approvedSnapshotMigration, /security definer/i);
  assert.match(approvedSnapshotMigration, /v_role <> 'admin'/);
  assert.match(approvedSnapshotMigration, /manager_approved_snapshot/);
  assert.match(approvedSnapshotMigration, /revoke all[\s\S]*from public, anon/i);
  assert.match(approvedSnapshotMigration, /grant execute[\s\S]*to authenticated/i);
});

test('plus add-record button label from PR 2115 remains', () => {
  assert.match(control, /title="הוספת רשומה"/);
  assert.match(control, /aria-label="הוספת רשומה"/);
  assert.match(control, />\+<\/button>/);
  assert.doesNotMatch(control, /הוספת דיווח שנשכח/);
});
