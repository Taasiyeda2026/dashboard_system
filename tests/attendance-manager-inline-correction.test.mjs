import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const control = await readFile(new URL('../frontend/src/screens/attendance-control.js', import.meta.url), 'utf8');
const finish = await readFile(new URL('../frontend/src/screens/payroll-control-finish.js', import.meta.url), 'utf8');
const bridge = await readFile(new URL('../frontend/src/payroll-attendance-v2-bridge.js', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20260927025000_sync_manager_attendance_generated_travel_corrections.sql', import.meta.url), 'utf8');
const recordReviewMigration = await readFile(new URL('../supabase/migrations/20260927053500_attendance_manager_record_reviews.sql', import.meta.url), 'utf8');
const finalizeGuardMigration = await readFile(new URL('../supabase/migrations/20260927061000_guard_manager_finalize_requires_record_reviews.sql', import.meta.url), 'utf8');

test('attendance-only review exposes inline field editing and uses manual correction state', () => {
  assert.match(control, /data-attendance-edit-record=/);
  assert.match(control, /data-attendance-approve-reported=/);
  assert.match(control, /data-attendance-manual-edit=/);
  assert.match(control, /data-attendance-manual-save=/);
  assert.match(control, /applyAttendanceManualCorrection\(entry, \{ \[field\]: parsed\.value \}\)/);
  assert.match(control, /TRAVEL_EDITABLE_FIELDS\.has\(field\)/);
  assert.match(control, /data-field-key="\$\{escapeHtml\(key\)\}"/);
  assert.doesNotMatch(control, /data-attendance-focus-travel="\$\{escapeHtml\(entry\.id\)\}">עריכת נסיעה/);
});

test('manager write-back supports corrected date and keeps generated travel cancellation synchronized', () => {
  assert.match(finish, /\['attendanceDate', 'date', false\]/);
  assert.match(migration, /report_date = case when p_fields \? 'attendanceDate'/);
  assert.match(migration, /set_config\('app\.av2_compensation_write', '1', true\)/);
  assert.match(migration, /child\.source_attendance_record_id = v_row\.id/);
  assert.match(migration, /child\.generation_kind = 'travel_time_cancellation'/);
  assert.match(migration, /final_cancellation_minutes = greatest/);
  assert.match(migration, /manually_overridden = true/);
  assert.match(migration, /override_by = auth\.uid\(\)/);
  assert.match(migration, /payroll_attendance_permission_denied/);
});

test('team manager record mutations require a submitted employee month', async () => {
  const gateMigration = await readFile(new URL('../supabase/migrations/20260927153000_guard_manager_attendance_requires_submitted_month.sql', import.meta.url), 'utf8');
  assert.match(gateMigration, /attendance_manager_month_allows_mutation/);
  assert.match(gateMigration, /attendance_month_not_submitted_for_manager_mutation/);
  assert.match(gateMigration, /update_payroll_attendance_record/);
  assert.match(gateMigration, /set_manager_attendance_record_review/);
  assert.match(gateMigration, /'admin', 'operation_manager'/);
  assert.match(control, /canManagerMutatePayrollEmployeeMonth/);
  assert.match(control, /bypassMonthSubmissionGate/);
});


test('record approval is persisted and invalidated by later record writes', () => {
  assert.match(bridge, /attendanceControlRecordReviews = async function/);
  assert.match(bridge, /get_manager_attendance_record_reviews/);
  assert.match(bridge, /attendanceControlApproveRecord = async function/);
  assert.match(bridge, /set_manager_attendance_record_review/);
  assert.match(control, /loadRecordReviews/);
  assert.match(control, /attendanceControlApproveRecord/);
  assert.match(control, /buildAttendanceUpdatePayload\(entry\)/);
  assert.match(recordReviewMigration, /attendance_manager_record_reviews/);
  assert.match(recordReviewMigration, /approved_record_updated_at = ar\.updated_at/);
  assert.match(recordReviewMigration, /attendance_manager_can_review_employee/);
  assert.match(recordReviewMigration, /payroll_attendance_permission_denied/);
});

test('manager edits persist to attendance_records and clear the prior review', () => {
  assert.match(control, /persistEntryCorrection/);
  assert.match(control, /attendanceControlUpdateRecord/);
  assert.match(control, /attendanceControlApproveRecord\(update\.recordId, false\)/);
  assert.match(control, /התיקון נשמר ברשומת הנוכחות\. הרשומה ממתינה לאישור/);
  assert.match(finish, /buildAttendanceUpdatePayload/);
  assert.match(finish, /\['attendanceDate', 'date', false\]/);
  assert.match(finish, /\['startTime', 'startTime', false\]/);
  assert.match(finish, /\['endTime', 'endTime', false\]/);
  assert.match(finish, /\['municipality', 'authority', false\]/);
  assert.match(finish, /\['schoolName', 'school', false\]/);
  assert.match(finish, /\['programName', 'program', false\]/);
  assert.match(finish, /\['sessionNumber', 'meetingNo', false\]/);
  assert.match(finish, /\['kilometers', 'kilometers', true\]/);
  assert.match(finish, /\['publicTransport', 'publicTransport', false\]/);
  assert.doesNotMatch(control, /ויעודכן ברשומת הנוכחות בעת אישור המנהל/);
});

test('manager record review RPCs enforce direct-manager scope', () => {
  assert.match(recordReviewMigration, /attendance_manager_can_review_employee\(v_row\.emp_id\)/);
  assert.match(recordReviewMigration, /attendance_manager_can_review_employee\(ar\.emp_id\)/);
  assert.match(recordReviewMigration, /direct_manager/);
  assert.match(recordReviewMigration, /activities_manager/);
  assert.match(recordReviewMigration, /'admin', 'operation_manager'/);
  assert.match(recordReviewMigration, /raise exception 'payroll_attendance_permission_denied'/);
});

test('reload path restores only still-valid record approvals', () => {
  assert.match(control, /loadRecordReviews/);
  assert.match(control, /managerRecordApproved = false/);
  assert.match(control, /approveAttendanceEntryCurrent\(entry\)/);
  assert.match(recordReviewMigration, /review\.approved_record_updated_at = ar\.updated_at/);
});

test('month with an unapproved attendance record blocks manager finalize', () => {
  assert.match(finalizeGuardMigration, /create or replace function public\.manager_finalize_attendance_month_review/);
  assert.match(finalizeGuardMigration, /security definer/);
  assert.match(finalizeGuardMigration, /from public\.attendance_records ar/);
  assert.match(finalizeGuardMigration, /to_char\(ar\.report_date, 'YYYY-MM'\) = p_month_key/);
  assert.match(finalizeGuardMigration, /not exists \(\s*select 1\s*from public\.attendance_manager_record_reviews review/s);
  assert.match(finalizeGuardMigration, /raise exception 'attendance_records_not_fully_approved'/);
  assert.match(
    finalizeGuardMigration,
    /attendance_records_not_fully_approved[\s\S]*update public\.attendance_month_approvals/
  );
  assert.match(finalizeGuardMigration, /payroll_attendance_permission_denied/);
  assert.match(finalizeGuardMigration, /grant execute on function public\.manager_finalize_attendance_month_review/);
});

test('manager finalize succeeds only when every record has a current valid review', () => {
  assert.match(finalizeGuardMigration, /review\.record_id = ar\.id/);
  assert.match(finalizeGuardMigration, /review\.status = 'approved'/);
  assert.match(finalizeGuardMigration, /review\.approved_record_updated_at = ar\.updated_at/);
  assert.match(finalizeGuardMigration, /v_unapproved_count/);
  assert.match(finalizeGuardMigration, /if coalesce\(v_unapproved_count, 0\) > 0 then/);
  // Zero unapproved records allows the existing lock/update path to continue.
  assert.match(
    finalizeGuardMigration,
    /if coalesce\(v_unapproved_count, 0\) > 0 then[\s\S]*end if;[\s\S]*update public\.attendance_month_approvals/s
  );
});

test('stale record review after attendance edit invalidates monthly manager finalize', () => {
  // Validity is tied to the exact attendance_records.updated_at version, so a later
  // edit makes approved_record_updated_at stale and the month cannot be finalized.
  assert.match(finalizeGuardMigration, /review\.record_id = ar\.id/);
  assert.match(finalizeGuardMigration, /review\.approved_record_updated_at = ar\.updated_at/);
  assert.match(finalizeGuardMigration, /raise exception 'attendance_records_not_fully_approved'/);
  assert.match(recordReviewMigration, /approved_record_updated_at = ar\.updated_at/);
});
