import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { requestAttendanceCorrectionReason } from '../frontend/src/manager-attendance-return-dialog.js';
import { buildMonthReturnNotice } from '../attendance/src/components/month-return-notice.js';

const migration = await readFile(new URL('../supabase/migrations/20261125134500_manager_attendance_return_with_reason.sql', import.meta.url), 'utf8');
const workspace = await readFile(new URL('../frontend/src/manager-board-workspace-runtime.js', import.meta.url), 'utf8');
const api = await readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
const home = await readFile(new URL('../attendance/src/screens/home-screen.js', import.meta.url), 'utf8');
const reports = await readFile(new URL('../attendance/src/screens/my-reports-screen.js', import.meta.url), 'utf8');
const approvalService = await readFile(new URL('../attendance/src/services/attendance.service.js', import.meta.url), 'utf8');

function makeDoc() {
  return new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://dashboard.test/' }).window.document;
}

test('manager return dialog requires actionable trimmed note and never injects HTML', async () => {
  const doc = makeDoc();
  const waiting = requestAttendanceCorrectionReason({
    documentRef: doc, employeeName: '<script>unsafe</script>', monthKey: '2026-11'
  });
  const dialog = doc.querySelector('.manager-attendance-return-dialog');
  assert.ok(dialog);
  assert.match(dialog.textContent, /<script>unsafe<\/script>/);
  assert.equal(dialog.querySelector('script'), null);
  const form = dialog.querySelector('form');
  const input = dialog.querySelector('textarea');
  input.value = '  קצר  ';
  form.dispatchEvent(new doc.defaultView.Event('submit', { bubbles: true, cancelable: true }));
  assert.ok(dialog.isConnected, 'invalid note must not close dialog');
  assert.match(dialog.textContent, /8–1000/);
  input.value = '   נא לתקן את שעת הסיום במפגש מיום 12.11   ';
  form.dispatchEvent(new doc.defaultView.Event('submit', { bubbles: true, cancelable: true }));
  const result = await waiting;
  assert.equal(result, 'נא לתקן את שעת הסיום במפגש מיום 12.11');
  assert.equal(doc.querySelector('dialog'), null);
});

test('canceling the return dialog does not produce a reason', async () => {
  const doc = makeDoc();
  const pending = requestAttendanceCorrectionReason({ documentRef: doc, employeeName: 'מדריך' });
  doc.querySelector('button[type=button]').click();
  assert.equal(await pending, null);
  assert.equal(doc.querySelector('dialog'), null);
});

test('reopened instructor month shows original manager instruction as literal text', () => {
  const doc = makeDoc();
  const reason = '<img src=x onerror=alert(1)> נא לתקן את דיווח הנסיעה';
  const notice = buildMonthReturnNotice({
    status: 'reopened', reopen_reason: reason, reopened_by_name: 'מנהלת פעילות',
    reopened_at: '2026-11-25T11:00:00Z'
  }, { documentRef: doc });
  assert.ok(notice);
  assert.equal(notice.querySelector('.av2-month-return-notice__reason').textContent, reason);
  assert.equal(notice.querySelector('img'), null);
  assert.match(notice.textContent, /סיום ואישור חודש/);
  assert.equal(buildMonthReturnNotice({ status: 'submitted', reopen_reason: reason }, { documentRef: doc }), null);
  assert.equal(buildMonthReturnNotice({ status: 'locked', reopen_reason: reason }, { documentRef: doc }), null);
});

test('manager-only return uses reason-aware RPC; admin keeps separate pre-existing reopen path', () => {
  assert.match(api, /managerReturnAttendanceMonthForCorrection: async function|managerReturnAttendanceMonthForCorrection: async \(/);
  assert.match(api, /manager_return_attendance_month_for_correction/);
  assert.match(api, /p_reason: note/);
  assert.match(workspace, /requestAttendanceCorrectionReason\(/);
  assert.match(workspace, /reason: correctionReason/);
  assert.match(workspace, /adminReopenAttendanceMonthForCorrection/);
  assert.match(workspace, /if \(isAdminReopen\)/);
  assert.match(workspace, /החזר לתיקון/);
});

test('server saves the reason only after authorized and submitted-only return', () => {
  assert.match(migration, /if auth\.uid\(\) is null then/);
  assert.match(migration, /char_length\(v_reason\) < 8 or char_length\(v_reason\) > 1000/);
  assert.match(migration, /public\.manager_reopen_attendance_month_for_employee/);
  assert.match(migration, /set reopen_reason = v_reason/);
  assert.match(migration, /reopened_by_user_id = auth\.uid\(\)/);
  assert.match(migration, /insert into private\.attendance_month_return_events/);
  assert.match(migration, /alter table private\.attendance_month_return_events enable row level security/);
  assert.match(migration, /revoke all on table private\.attendance_month_return_events from public, anon, authenticated/);
  assert.match(migration, /revoke all on function public\.manager_return_attendance_month_for_correction/);
});

test('instructor sees correction on home and reports and existing resubmission RPC is unchanged', () => {
  assert.match(home, /buildMonthReturnNotice\(approval, \{ onMyReports \}\)/);
  assert.match(reports, /buildMonthReturnNotice\(approval\)/);
  assert.match(home, /status === 'reopened'/);
  assert.match(home, /הגשה מחדש/);
  assert.match(approvalService, /supabase\.rpc\('av2_submit_attendance_month'/);
});
