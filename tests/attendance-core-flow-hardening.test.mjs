import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildAttendanceUpdatePayload } from '../frontend/src/screens/payroll-control-finish.js';
import { attendanceTimesFromActivity } from '../attendance/src/services/activities-report.helpers.js';
import {
  sourceAttendanceRecords,
  isGeneratedTravelCancellation,
  calculateTravelCancellationMinutes,
} from '../attendance/src/services/travel-compensation.js';

const attendanceService = await readFile(new URL('../attendance/src/services/attendance.service.js', import.meta.url), 'utf8');
const home = await readFile(new URL('../attendance/src/screens/home-screen.js', import.meta.url), 'utf8');
const followup = await readFile(new URL('../attendance/src/attendance-followup-runtime-v2.js', import.meta.url), 'utf8');
const control = await readFile(new URL('../frontend/src/screens/attendance-control.js', import.meta.url), 'utf8');
const finish = await readFile(new URL('../frontend/src/screens/payroll-control-finish.js', import.meta.url), 'utf8');
const pdfHandler = await readFile(new URL('../supabase/functions/payroll-attendance-pdf-dispatch/handler.ts', import.meta.url), 'utf8');
const mobileCss = await readFile(new URL('../attendance/src/styles/mobile-reports.css', import.meta.url), 'utf8');
const monthlySummary = await readFile(new URL('../attendance/src/components/monthly-report-summary.js', import.meta.url), 'utf8');
const restoreMigration = await readFile(
  new URL('../supabase/migrations/20260930103000_restore_manager_attendance_submitted_month_gate.sql', import.meta.url),
  'utf8'
);
const retireLegacyPdfTriggerMigration = await readFile(
  new URL('../supabase/migrations/20261003143000_retire_legacy_attendance_pdf_on_lock.sql', import.meta.url),
  'utf8'
);

function hoursOnlyEntry(overrides = {}) {
  const attendance = {
    id: 'rec-1',
    employeeId: '1501',
    employeeName: 'מדריך בדיקה',
    date: '2026-09-10',
    startTime: '08:00',
    endTime: '10:00',
    workHours: 2,
    activityType: 'קורס',
    school: 'בית ספר',
    authority: 'רשות',
    program: 'תכנית',
    meetingNo: '1',
    kilometers: 42,
    publicTransport: false,
    publicTransportCost: 0,
    expenses: 25,
    expenseDetails: 'חניה',
    notes: 'הערה',
    team: '',
    employmentType: 'שעתי',
    attachmentsNames: '',
    status: '',
    approvedBy: '',
    approvedDate: '',
    _source: {
      ID: 'rec-1',
      employeeId: '1501',
      employeeName: 'מדריך בדיקה',
      attendanceDate: '2026-09-10',
      startTime: '08:00',
      endTime: '10:00',
      workHours: 2,
      activityType: 'קורס',
      schoolName: 'בית ספר',
      municipality: 'רשות',
      programName: 'תכנית',
      sessionNumber: '1',
      kilometers: 42,
      publicTransport: false,
      publicTransportCost: 0,
      totalExpenses: 25,
      expensesDetails: 'חניה',
      notes: 'הערה',
      team: '',
      employmentType: 'שעתי',
      attachmentsNames: '',
      status: '',
      approvedBy: '',
      approvedDate: ''
    },
    ...overrides.attendance
  };
  return {
    id: 'cmp-1',
    attendance,
    final: {
      ...attendance,
      startTime: '08:30',
      endTime: '10:30',
      workHours: 2,
      ...(overrides.final || {})
    },
    ...overrides
  };
}

test('1 create attendance record stays atomic whole-payload save', () => {
  assert.match(attendanceService, /normalizeRecordPayload\(payload\)/);
  assert.match(attendanceService, /createRecord[\s\S]*activeEditRecordId/);
  assert.match(attendanceService, /if \(editRecordId\)[\s\S]*updateRecord/);
  assert.match(attendanceService, /sessionStorage\.getItem\(EDIT_RECORD_KEY\)/);
});

test('2 manager record edit remains one local draft and one atomic save', () => {
  assert.match(control, /שינויים טרם נשמרו/);
  assert.match(control, /שמור שינויים/);
  assert.match(control, /persistEntryCorrection/);
});

test('3 hours calculation keeps course buffer and workshop exact window', () => {
  assert.deepEqual(
    attendanceTimesFromActivity({ start_time: '08:30', end_time: '10:00' }, 'קורס'),
    { startTime: '08:15', endTime: '10:15' }
  );
  assert.deepEqual(
    attendanceTimesFromActivity({ start_time: '08:30', end_time: '10:00' }, 'סדנה'),
    { startTime: '08:30', endTime: '10:00' }
  );
  assert.deepEqual(
    attendanceTimesFromActivity({ start_time: '10:00', end_time: '09:00' }, 'קורס'),
    { startTime: '', endTime: '' }
  );
});

test('4 hours-only manager correction preserves kilometers and expenses', () => {
  const update = buildAttendanceUpdatePayload(hoursOnlyEntry());
  assert.equal(update.changed, true);
  assert.equal(update.fields.startTime, '08:30');
  assert.equal(update.fields.endTime, '10:30');
  assert.equal(update.fields.kilometers, 42);
  assert.equal(update.fields.totalExpenses, 25);
  assert.equal(update.fields.expensesDetails, 'חניה');
});

test('5 clearing expenses also clears expense details', () => {
  const update = buildAttendanceUpdatePayload(hoursOnlyEntry({
    final: { expenses: 0, expenseDetails: 'חניה', startTime: '08:00', endTime: '10:00', workHours: 2 }
  }));
  assert.equal(update.changed, true);
  assert.equal(update.fields.totalExpenses, 0);
  assert.equal(update.fields.expensesDetails, '');
  assert.match(attendanceService, /Clearing expenses must also clear the free-text detail/);
  assert.match(attendanceService, /expense_details: expenses > 0/);
  assert.match(control, /Empty input clears the expense/);
  assert.match(restoreMigration, /totalExpenses[\s\S]*<= 0[\s\S]*then ''/);
});

test('6 generated travel cancellation is not duplicated in source-only totals', () => {
  const records = [
    { id: 'source', activity_type: 'קורס', total_hours: 2, roundtrip_km: 10, expenses: 5 },
    {
      id: 'child',
      activity_type: 'ביטול זמן',
      generation_kind: 'travel_time_cancellation',
      source_attendance_record_id: 'source',
      total_hours: 1.25,
      roundtrip_km: 0,
      expenses: 0
    },
    { id: 'manual', activity_type: 'ביטול זמן', total_hours: 0.5, roundtrip_km: 0, expenses: 0 }
  ];
  assert.equal(isGeneratedTravelCancellation(records[1]), true);
  assert.deepEqual(sourceAttendanceRecords(records).map((row) => row.id), ['source', 'manual']);
  assert.equal(calculateTravelCancellationMinutes(60, 50), 20);
  assert.match(home, /cancellationHours\(/);
  assert.match(home, /generatedSourceIds/);
  assert.match(monthlySummary, /buildMonthlySummaryItems/);
});

test('7 month submission RPC remains wired for instructors', () => {
  assert.match(attendanceService, /av2_submit_attendance_month/);
});

test('8 manager correction write-back clears prior review after successful save', () => {
  assert.match(control, /persistEntryCorrection/);
  assert.match(control, /set_manager_attendance_record_review|setManagerAttendanceRecordReview|clear.*review|record review/i);
});

test('payroll PDF dispatch sends from the authenticated approver and keeps email best-effort', () => {
  assert.match(pdfHandler, /email delivery failed after PDF persistence/);
  assert.match(pdfHandler, /mailSent: !mailError/);
  assert.match(pdfHandler, /reusedExistingPdf/);
  assert.match(pdfHandler, /currentUser\?\.auth_email \|\| currentUser\?\.email/);
  assert.doesNotMatch(pdfHandler, /MS_MAIL_SENDER/);
});

test('manager PDF retry restores the original approver identity before sending email', () => {
  assert.match(pdfHandler, /manager_approved_by_user_id/);
  assert.match(pdfHandler, /auth_user_id=eq\.\$\{encodeURIComponent\(approverUserId\)\}/);
  assert.match(pdfHandler, /currentUser = \(Array\.isArray\(approverRows\)/);
});

test('attendance PDF subsets Hebrew fonts safely and normalizes SharePoint Forms URLs', () => {
  assert.match(pdfHandler, /embedFont\(regularBytes, \{ subset: true \}\)/);
  assert.match(pdfHandler, /embedFont\(boldBytes, \{ subset: true \}\)/);
  assert.match(pdfHandler, /normalizeFolderWebUrl/);
  assert.match(pdfHandler, /forms\/view\.aspx/i);
  assert.match(pdfHandler, /attach_manager_attendance_month_pdf/);
  assert.match(pdfHandler, /reusedExistingPdf: true/);
  assert.doesNotMatch(pdfHandler, /subset: false/);
});

test('legacy attendance PDF-on-lock trigger is retired without weakening the PDF guard', () => {
  assert.match(retireLegacyPdfTriggerMigration, /drop trigger if exists av2_request_pdf_on_lock/i);
  assert.match(retireLegacyPdfTriggerMigration, /attendance_month_approvals/i);
  assert.doesNotMatch(retireLegacyPdfTriggerMigration, /drop\s+(function|trigger)[\s\S]*av2_guard_pdf_path/i);
});

test('9 manager approval finalizes before PDF and stores approval stamps', () => {
  assert.match(finish, /managerFinalizeAttendanceMonthReview|manager_finalize_attendance_month_review/);
  assert.match(finish, /attendanceManagerApprovalArtifacts/);
  assert.match(finish, /pdf_pending/);
  assert.match(finish, /manager_approved_snapshot|approved_snapshot/);
  const finalizeIndex = finish.indexOf('managerFinalizeAttendanceMonthReview');
  const artifactsIndex = finish.indexOf('attendanceManagerApprovalArtifacts');
  assert.ok(finalizeIndex > -1 && artifactsIndex > finalizeIndex, 'finalize must happen before PDF artifacts');
});

test('10 locked months stay blocked for team managers and admin UI bypass', () => {
  assert.match(restoreMigration, /attendance_month_not_submitted_for_manager_mutation/);
  assert.match(restoreMigration, /attendance_manager_month_allows_mutation/);
  assert.match(control, /resolved\.status === 'manager_approved' \|\| resolved\.status === 'approved'/);
});

test('11 PDF snapshot path builds a real PDF artifact', () => {
  assert.match(pdfHandler, /PDFDocument|pdf-lib/);
  assert.match(pdfHandler, /sharepoint|SharePoint/i);
});

test('12 mobile attendance totals and cancellation edit path remain present', () => {
  assert.match(mobileCss, /summary|av2-reports/);
  assert.match(followup, /attachEditFormTimeCancellation/);
  assert.match(followup, /av2-report__form\[data-av2-edit-record-id\]/);
  assert.match(followup, /data-av2-time-cancel-edit/);
});
