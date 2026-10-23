import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  formatCancellationDuration, parseCancellationDuration,
  canReportInlineCancellation, cancellationRequestedMinutes, instructorReportedCancellationMinutes,
} from '../attendance/src/services/cancellation-segments.js';

const read = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');
const [create, edit, migration, control, bridge] = await Promise.all([
  read('attendance/src/screens/new-report-screen.js'),
  read('attendance/src/screens/my-reports-screen.js'),
  read('supabase/migrations/20261013042258_unified_attendance_travel_time_cancellation.sql'),
  read('frontend/src/screens/attendance-control.js'),
  read('frontend/src/payroll-attendance-v2-bridge.js'),
]);

test('explicit duration fields accept clock hours:minutes and preserve zero', () => {
  assert.equal(parseCancellationDuration('0:00'), 0);
  assert.equal(parseCancellationDuration('1:44'), 105);
  assert.equal(parseCancellationDuration('12:05'), 725);
  assert.equal(parseCancellationDuration('01:60'), null);
  assert.equal(parseCancellationDuration('-1:00'), null);
  assert.equal(parseCancellationDuration('25:00'), null);
  assert.equal(formatCancellationDuration(104), '1:45');
});

test('inline cancellation is eligible only on physical source activities', () => {
  assert.equal(canReportInlineCancellation({ activityType: 'קורס' }), true);
  assert.equal(canReportInlineCancellation({ activityType: 'הכשרה' }), true);
  assert.equal(canReportInlineCancellation({ activityType: 'הכשרה', online: true }), false);
  assert.equal(canReportInlineCancellation({ activityType: 'ביטול זמן' }), false);
  assert.equal(cancellationRequestedMinutes({
    cancellation_before_minutes: 52, cancellation_after_minutes: 52,
    total_hours: 2
  }), 110);
  assert.equal(cancellationRequestedMinutes({ total_hours: 2 }), null);
});

test('new and edit forms keep separate before/after segments and physical venue', () => {
  for (const screen of [create, edit]) {
    assert.match(screen, /cancellation_before_minutes/);
    assert.match(screen, /cancellation_after_minutes/);
    assert.match(screen, /trainingLocationField/);
    assert.match(screen, /canReportInlineCancellation/);
    assert.match(screen, /parseCancellationDuration/);
  }
  assert.match(create, /trainingLocationField\.wrap/);
  assert.match(edit, /publicTransportToggle\.checked/);
  assert.match(create, /total_hours: totalHours/);
  assert.match(edit, /total_hours:\s+totalHours/);
});

test('new-report cancellation is immediately after hours and before travel, with no redundant note', () => {
  const hours = create.indexOf("timesGrid.append(startPicker.wrap, endPicker.wrap, hoursDisplay, publicTransportToggle, kmField.wrap, publicTransportCostWrap)");
  const afterHours = create.indexOf('hoursDisplay.after(cancellationRow, cancellationFields)');
  const beforeTravel = create.indexOf('publicTransportToggle, kmField.wrap, publicTransportCostWrap', hours);
  assert.ok(hours >= 0 && beforeTravel > hours && afterHours > beforeTravel, 'cancellation is inserted after the hours node before transport and kilometers');
  assert.match(create, /cancellationFields\.append\(cancellationBeforeField\.wrap, cancellationAfterField\.wrap\)/);
  assert.doesNotMatch(create, /ביטול הזמן ייבדק בנפרד; שעות הפעילות אינן משתנות\./);
  assert.match(create, /cancellationFields\.hidden = !eligible \|\| !cancellationToggle\.checked/);
  assert.match(create, /cancellationToggle\.addEventListener\('change', syncInlineCancellationUi\)/);
  assert.match(create, /cancellation_before_minutes: cancellationToggle\.checked/);
  assert.match(create, /total_hours: totalHours/);
});

test('instructor cancellation display favors exact submitted values over manager-approved minutes', () => {
  assert.equal(instructorReportedCancellationMinutes({
    cancellation_before_minutes: 75,
    cancellation_after_minutes: 20,
    travel_compensation: { approved_cancellation_minutes: 30, review_status: 'corrected', requested_cancellation_minutes: 80 },
  }), 95);
  assert.equal(instructorReportedCancellationMinutes({
    travel_compensation: { requested_cancellation_minutes: 85, approved_cancellation_minutes: null, review_status: 'pending_review' },
  }), 85);
  assert.equal(instructorReportedCancellationMinutes({
    travel_compensation: { reported_before_cancellation_minutes: 65, reported_after_cancellation_minutes: 5, approved_cancellation_minutes: null },
  }), 70);
  assert.equal(instructorReportedCancellationMinutes({ cancellation_before_minutes: 0, cancellation_after_minutes: 0 }), 0);
  assert.equal(instructorReportedCancellationMinutes({
    travel_compensation: { requested_cancellation_minutes: null, approved_cancellation_minutes: 45, review_status: 'approved' },
  }), null);
  assert.equal(instructorReportedCancellationMinutes({}), null);
});

test('all attendance report views use submitted cancellations before approval, not approved figures', async () => {
  const [row, home, monthly, excel, reportDetails] = await Promise.all([
    read('attendance/src/components/report-summary-row.js'),
    read('attendance/src/screens/home-screen.js'),
    read('attendance/src/components/monthly-report-summary.js'),
    read('attendance/src/services/excel.service.js'),
    read('attendance/src/screens/my-reports-screen.js'),
  ]);
  const { reportedCancellationHours, buildMonthlySummaryItems, groupReportRecordsByDate } = await import('../attendance/src/components/monthly-report-summary.js');
  const rows = [
    { id: 'A1', report_date: '2026-10-13', activity_type: 'קורס', total_hours: 2,
      cancellation_before_minutes: 40, cancellation_after_minutes: 20,
      travel_compensation: { requested_cancellation_minutes: 60, approved_cancellation_minutes: null, review_status: 'pending_review' } },
    { id: 'GEN', report_date: '2026-10-13', generation_kind: 'travel_time_cancellation',
      source_attendance_record_id: 'A1', activity_type: 'ביטול זמן', total_hours: 0.5 },
    { id: 'A2', report_date: '2026-10-13', activity_type: 'הכשרה', total_hours: 1,
      travel_compensation: { requested_cancellation_minutes: 90, approved_cancellation_minutes: 20, review_status: 'corrected' } },
    { id: 'STANDALONE', report_date: '2026-10-13', activity_type: 'ביטול זמן', total_hours: 0.5 },
  ];
  assert.equal(reportedCancellationHours(rows), 3);
  assert.equal(groupReportRecordsByDate(rows)[0].cancellationHours, 3);
  const summary = buildMonthlySummaryItems(rows).find((item) => item.activityType === 'ביטול זמן');
  assert.equal(summary.numericValue, 3);
  assert.match(row, /instructorReportedCancellationMinutes\(record\)/);
  assert.doesNotMatch(row, /formatTravelMinutes\(compensation\.approved_cancellation_minutes\)/);
  assert.match(home, /return reportedCancellationHours\(records\)/);
  assert.match(reportDetails, /const label = instructorMinutes !== null \? formatCancellationMinutes\(instructorMinutes\) : 'טרם דווח'/);
  assert.match(reportDetails, /instructorReportedCancellationMinutes\(record\)/);
  assert.match(excel, /'ביטול זמן מדווח': instructorReportedCancellationMinutes\(r\)/);
  assert.match(excel, /reportedCancellationHours\(records\)/);
  assert.match(monthly, /reportedCancellationHours/);
});

test('SQL preserves course timestamps and gates cancellation behind manager approval', () => {
  assert.match(migration, /add column if not exists cancellation_before_minutes integer/);
  assert.match(migration, /add column if not exists cancellation_after_minutes integer/);
  assert.match(migration, /av2_compute_source_travel_review_status/);
  assert.match(migration, /when c\.review_status in \('approved', 'corrected'\)/);
  assert.match(migration, /only clears unapproved/);
  assert.doesNotMatch(migration, /set\s+total_hours\s*=\s*cancellation_/);
  assert.match(bridge, /reportedCancellationBeforeMinutes/);
  assert.match(control, /דיווח ביטול זמן \(לפני\/אחרי\)/);
});
