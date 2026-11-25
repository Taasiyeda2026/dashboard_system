import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  managerAttendanceHandoffState,
  managerAttendanceHandoffTotals
} from '../frontend/src/manager-attendance-handoff.js';

const read = async path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const [workspace,control,finish,admin,migration] = await Promise.all([
  read('frontend/src/manager-board-workspace-runtime.js'),
  read('frontend/src/screens/attendance-control.js'),
  read('frontend/src/screens/payroll-control-finish.js'),
  read('frontend/src/admin-attendance-standalone.js'),
  read('supabase/migrations/20261125213000_manager_month_signature_server_identity.sql')
]);
const locked = { workflow_status:'manager_approved', attendance_submission_status:'locked', manager_approved_at:'2026-11-25T18:00:00Z' };

const api = await read('frontend/src/api.js');
const handoffMigration = await read('supabase/migrations/20261125214500_manager_handoff_scoped_status.sql');

test('handoff displays PDF blocking, final admin approval and actual payroll dispatch distinctly', () => {
  const missingPdf = managerAttendanceHandoffState({ workflow:locked });
  assert.equal(missingPdf.step,'pdf_pending');
  assert.equal(missingPdf.readyToDispatch,false);
  const awaitingAdmin = managerAttendanceHandoffState({ workflow:{...locked,manager_pdf_sharepoint_url:'https://sharepoint.example.com/report.pdf'}});
  assert.equal(awaitingAdmin.step,'awaiting_admin');
  assert.equal(awaitingAdmin.dispatched,false);
  const adminApproved = managerAttendanceHandoffState({ workflow:locked, finalApproval:{status:'admin_approved'}});
  assert.equal(adminApproved.step,'admin_approved');
  assert.equal(adminApproved.readyToDispatch,true);
  assert.equal(adminApproved.dispatched,false);
  const sent = managerAttendanceHandoffState({ workflow:locked,finalApproval:{status:'approved_for_payroll'}});
  assert.equal(sent.step,'sent_to_payroll');
  assert.equal(sent.dispatched,true);
  assert.equal(sent.readyToDispatch,false);
});

test('unsubmitted, returned and submitted instructor months never count as payroll-ready', () => {
  assert.equal(managerAttendanceHandoffState({}).step,'instructor');
  assert.equal(managerAttendanceHandoffState({
    workflow:{ workflow_status:'not_submitted',attendance_submission_status:'reopened' }
  }).step,'returned');
  assert.equal(managerAttendanceHandoffState({
    workflow:{ workflow_status:'submitted',attendance_submission_status:'submitted' }
  }).step,'awaiting_manager');
});

test('counts distinguish each stage; post-signature edits are flagged separately', () => {
  const states=[
    managerAttendanceHandoffState({workflow:locked,auditCount:2}),
    managerAttendanceHandoffState({workflow:{...locked,manager_pdf_sharepoint_url:'https://example.com/a.pdf'}}),
    managerAttendanceHandoffState({workflow:locked,finalApproval:{status:'admin_approved'}}),
    managerAttendanceHandoffState({workflow:locked,finalApproval:{status:'approved_for_payroll'}})
  ];
  assert.deepEqual(managerAttendanceHandoffTotals(states),{
    awaitingAdmin:1,pdfPending:1,adminApproved:1,sentToPayroll:1,reviewExceptions:1
  });
});

test('manager overview reads admin-approved and sent payroll separately, without dispatch mutations', () => {
  assert.match(workspace, /api\.managerAttendanceHandoffStatuses\(\{ monthKey: ym, employeeIds: ids \}\)/);
  assert.doesNotMatch(workspace, /api\.listPayrollControlApprovals\(\{\s*monthKey: ym, employeeIds: ids/);
  assert.match(workspace, /managerAttendanceHandoffSummaryHtml\(roster, summary\)/);
  assert.match(workspace, /summary\.approvals\?\.get\(empId\)/);
  assert.match(workspace, /data-manager-handoff-phase/);
  assert.match(workspace, /PDF חסר אחרי חתימה/);
  assert.doesNotMatch(workspace, /api\.adminSendAttendanceMonthToPayroll\(/);
});

test('manager signoff remains separate from admin final approval and payroll dispatch', () => {
  const signoffIndex = finish.indexOf('await api.managerFinalizeAttendanceMonthReview');
  const artifactsIndex = finish.indexOf('await api.attendanceManagerApprovalArtifacts');
  assert.ok(signoffIndex>=0 && artifactsIndex>signoffIndex);
  assert.match(control, /statuses: \['admin_approved', 'approved_for_payroll'\]/);
  assert.match(control, /approval\.status === 'approved_for_payroll' \? 'הועבר לשכר'/);
  assert.match(control, /ההעברה לשכר תתבצע בנפרד לאחר אישור מנהל המערכת/);
  assert.match(admin, /adminFinalizeAttendanceMonthPayroll\(/);
  assert.match(admin, /adminSendAttendanceMonthToPayroll\(/);
  assert.match(admin, /status\.raw === 'manager_approved'/);
  assert.match(admin, /text\(finalApproval\?\.status\) === 'admin_approved'/);
});

test('team-scoped read-only RPC exposes no payroll data or staff outside direct manager team', () => {
  assert.match(api, /get_manager_attendance_handoff_statuses/);
  assert.match(handoffMigration, /auth\.uid\(\) IS NULL/);
  assert.match(handoffMigration, /public\.attendance_manager_can_review_employee\(requested\.id\)/);
  assert.match(handoffMigration, /RETURNS TABLE\(employee_id bigint, final_status text\)/);
  assert.match(handoffMigration, /IN \('admin_approved', 'approved_for_payroll'\)/);
  assert.match(handoffMigration, /REVOKE ALL ON FUNCTION public\.get_manager_attendance_handoff_statuses/);
  assert.doesNotMatch(handoffMigration, /approved_snapshot|approved_amount|total_hours|update public\.|delete from public\./i);
});

test('signoff SQL ignores spoofable p_manager_name for the manager identity and retains review guards', () => {
  assert.match(migration, /create or replace function public\.manager_finalize_attendance_month_review/i);
  assert.match(migration, /where u\.auth_user_id = auth\.uid\(\)/);
  assert.match(migration, /and u\.is_active = true/);
  assert.doesNotMatch(migration, /nullif\(trim\(coalesce\(p_manager_name,/);
  assert.match(migration, /lower\(trim\(coalesce\(ci\.direct_manager/);
  assert.match(migration, /review\.approved_record_updated_at = ar\.updated_at/);
  assert.match(migration, /attendance_daily_travel_reviews_pending/);
  assert.match(migration, /attendance_expense_reviews_pending/);
  assert.match(migration, /status = 'locked'/);
  assert.match(migration, /manager_approved_snapshot =/);
  assert.match(migration, /end\s*\$function\$;\s*REVOKE ALL ON FUNCTION/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.manager_finalize_attendance_month_review/);
});
