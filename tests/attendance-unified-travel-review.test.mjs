import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  calculateTravelCancellationMinutes,
  computeTravelReviewStatus,
  isOpenTravelReviewStatus,
  isPayrollApprovedTravelReview,
  maxOneWayDistanceKm,
  shouldRemindTravelReport,
  toInstructorTravelCompensationView,
  TRAVEL_REPORT_REMINDER_ONE_WAY_KM,
} from '../attendance/src/services/travel-compensation.js';
import { instructorTravelReportStatusLabel } from '../attendance/src/services/time-cancellation.helpers.js';

const migration = await readFile(
  new URL('../supabase/migrations/20261013093000_unified_attendance_travel_time_cancellation.sql', import.meta.url),
  'utf8'
);
const service = await readFile(new URL('../attendance/src/services/attendance.service.js', import.meta.url), 'utf8');
const edge = await readFile(new URL('../supabase/functions/attendance-travel-compensation/index.ts', import.meta.url), 'utf8');
const basePreview = await readFile(new URL('../supabase/functions/attendance-base-training-routes/index.ts', import.meta.url), 'utf8');
const newReport = await readFile(new URL('../attendance/src/screens/new-report-screen.js', import.meta.url), 'utf8');
const myReports = await readFile(new URL('../attendance/src/screens/my-reports-screen.js', import.meta.url), 'utf8');
const followup = await readFile(new URL('../attendance/src/attendance-followup-runtime-v2.js', import.meta.url), 'utf8');
const control = await readFile(new URL('../frontend/src/screens/attendance-control.js', import.meta.url), 'utf8');
const api = await readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
const sw = await readFile(new URL('../frontend/sw.js', import.meta.url), 'utf8');
const config = await readFile(new URL('../frontend/src/config.js', import.meta.url), 'utf8');
const spec = await readFile(new URL('../docs/attendance-time-cancellation-unified-implementation.md', import.meta.url), 'utf8');

test('45-minute formula unchanged for per-direction eligibility', () => {
  assert.equal(calculateTravelCancellationMinutes(45, 45), 0);
  assert.equal(calculateTravelCancellationMinutes(46, 45), 1);
  assert.equal(calculateTravelCancellationMinutes(60, 50), 20);
  assert.equal(TRAVEL_REPORT_REMINDER_ONE_WAY_KM, 40);
});

test('40km reminder uses one-way max distance, not round-trip', () => {
  assert.equal(maxOneWayDistanceKm(41, 10), 41);
  assert.equal(shouldRemindTravelReport(40), false);
  assert.equal(shouldRemindTravelReport(40.1), true);
  assert.equal(shouldRemindTravelReport(39.9), false);
  assert.match(spec, /בכיוון אחד/);
  assert.match(migration, /system_distance_km/);
  assert.match(migration, /> 40/);
});

test('auto_matched is not payroll-approved; every gap goes to pending_review', () => {
  assert.equal(
    computeTravelReviewStatus({
      reportedOutbound: 60,
      reportedReturn: 60,
      systemCancelMinutes: 30,
      calculationStatus: 'resolved',
    }),
    'auto_matched'
  );
  assert.equal(
    computeTravelReviewStatus({
      reportedOutbound: 61,
      reportedReturn: 60,
      systemCancelMinutes: 30,
      calculationStatus: 'resolved',
    }),
    'pending_review'
  );
  assert.equal(isPayrollApprovedTravelReview('auto_matched'), false);
  assert.equal(isPayrollApprovedTravelReview('approved'), true);
  assert.equal(isOpenTravelReviewStatus('auto_matched'), true);
  assert.equal(isOpenTravelReviewStatus('approved'), false);
});

test('awaiting_report when system needs attention and guide did not report', () => {
  assert.equal(
    computeTravelReviewStatus({
      systemCancelMinutes: 15,
      systemDistanceKm: 10,
      calculationStatus: 'resolved',
    }),
    'awaiting_report'
  );
  assert.equal(
    computeTravelReviewStatus({
      systemCancelMinutes: 0,
      systemDistanceKm: 41,
      calculationStatus: 'resolved',
    }),
    'awaiting_report'
  );
  assert.equal(
    computeTravelReviewStatus({
      systemCancelMinutes: 0,
      systemDistanceKm: 10,
      calculationStatus: 'resolved',
    }),
    'none'
  );
});

test('locked manager decisions are preserved by review-status helper', () => {
  assert.equal(
    computeTravelReviewStatus({
      reportedOutbound: 90,
      reportedReturn: 90,
      systemCancelMinutes: 10,
      calculationStatus: 'resolved',
      existingReviewStatus: 'approved',
    }),
    'approved'
  );
});

test('instructor view never includes system estimate fields', () => {
  const view = toInstructorTravelCompensationView({
    source_attendance_record_id: 's1',
    calculation_status: 'resolved',
    reported_outbound_minutes: 70,
    reported_return_minutes: 50,
    review_status: 'pending_review',
    approved_cancellation_minutes: null,
    show_travel_report_reminder: true,
    outbound_travel_minutes: 999,
    calculated_cancellation_minutes: 888,
    system_distance_km: 55,
  });
  assert.equal(view.requested_cancellation_minutes, 30);
  assert.equal(view.show_travel_report_reminder, true);
  assert.equal('outbound_travel_minutes' in view, false);
  assert.equal('calculated_cancellation_minutes' in view, false);
  assert.equal('system_distance_km' in view, false);
  assert.match(instructorTravelReportStatusLabel(view), /בקרת מנהל/);
});

test('migration enforces unified review engine and finalize gate', () => {
  assert.match(migration, /av2_report_attendance_travel_time/);
  assert.match(migration, /av2_review_attendance_travel_compensation/);
  assert.match(migration, /av2_list_instructor_travel_compensations/);
  assert.match(migration, /approved_cancellation_minutes/);
  assert.match(migration, /attendance_travel_compensation_events/);
  assert.match(migration, /attendance_travel_reviews_pending/);
  assert.match(migration, /manager_finalize_attendance_month_review/);
  assert.match(migration, /NEVER creates payable|never creates payable|must not mint payable/i);
  assert.match(migration, /migrated_legacy_payroll_freeze/);
  assert.match(migration, /revoke select on public\.attendance_travel_compensations from authenticated/);
  assert.match(migration, /attendance_travel_override_retired_use_report_rpc/);
  assert.match(migration, /Preserve guide report/);
});

test('instructor service uses safe RPC and strips system edge fields', () => {
  assert.match(service, /av2_list_instructor_travel_compensations/);
  assert.doesNotMatch(service, /from\('attendance_travel_compensations'\)[\s\S]{0,80}select\('\*'\)/);
  assert.match(service, /reportTravelTime/);
  assert.match(service, /Strip any system estimate fields/);
  assert.match(service, /show_travel_report_reminder/);
  assert.match(service, /דיווח ביטול זמן ידני הוחלף/);
});

test('edge writes one-way distance and base preview hides cancellation minutes', () => {
  assert.match(edge, /p_distance_km: oneWayKm/);
  assert.match(edge, /show_travel_report_reminder: oneWayKm > 40/);
  assert.match(basePreview, /must not expose system travel minutes/);
  assert.match(basePreview, /show_travel_report_reminder: oneWayKm > 40/);
  assert.doesNotMatch(basePreview, /\.\.\.route/);
});

test('instructor UI reports outbound/return and never shows expected cancellation', () => {
  assert.match(newReport, /מעל 40 ק״מ בכיוון אחד/);
  assert.doesNotMatch(newReport, /ביטול זמן צפוי/);
  assert.doesNotMatch(newReport, /מחושב אוטומטית לפי זמן הנסיעה/);
  assert.match(myReports, /reportTravelTime/);
  assert.match(myReports, /דקות נסיעה הלוך/);
  assert.match(followup, /reportTravelTime/);
  assert.doesNotMatch(followup, /חזור לחישוב האוטומטי/);
  assert.doesNotMatch(followup, /overrideTravelCompensation/);
});

test('manager control can approve/correct/reject and API exposes review RPC', () => {
  assert.match(control, /data-travel-review="approve"/);
  assert.match(control, /data-travel-review="reject"/);
  assert.match(control, /data-travel-review="correct"/);
  assert.match(api, /av2_review_attendance_travel_compensation/);
  assert.match(api, /reviewAttendanceTravelCompensation/);
});

test('deployable frontend cache markers bumped for this change', () => {
  assert.match(config, /unified-travel-time-cancellation-review-20261013-v1/);
  assert.match(sw, /const CACHE_VERSION = 2003/);
});

test('spec records no auto payroll approval and separate submit vs finalize gates', () => {
  assert.match(spec, /אין אישור אוטומטי לתשלום/);
  assert.match(spec, /auto_matched` = התאמה בלבד/);
  assert.match(spec, /שליחת חודש ≠ אישור לשכר/);
  assert.match(spec, /manager_finalize_attendance_month_review/);
});
