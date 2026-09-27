import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const control = await readFile(new URL('../frontend/src/screens/attendance-control.js', import.meta.url), 'utf8');
const finish = await readFile(new URL('../frontend/src/screens/payroll-control-finish.js', import.meta.url), 'utf8');
const bridge = await readFile(new URL('../frontend/src/payroll-attendance-v2-bridge.js', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20260927025000_sync_manager_attendance_generated_travel_corrections.sql', import.meta.url), 'utf8');
const recordReviewMigration = await readFile(new URL('../supabase/migrations/20260927053500_attendance_manager_record_reviews.sql', import.meta.url), 'utf8');

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
