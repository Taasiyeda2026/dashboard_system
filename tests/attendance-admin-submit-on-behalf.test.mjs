import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../supabase/migrations/20260927181000_admin_submit_attendance_month_on_behalf.sql', import.meta.url),
  'utf8'
);
const api = await readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
const workspace = await readFile(new URL('../frontend/src/manager-board-workspace-runtime.js', import.meta.url), 'utf8');

test('admin can submit an attendance month on behalf only through the audited admin RPC', () => {
  assert.match(migration, /admin_submit_attendance_month_on_behalf/);
  assert.match(migration, /if v_role <> 'admin'/);
  assert.match(migration, /attendance_admin_submission_reason_required/);
  assert.match(migration, /submitted_on_behalf=true/);
  assert.match(migration, /submitted_on_behalf_by_user_id=excluded\.submitted_on_behalf_by_user_id/);
  assert.match(migration, /submitted_on_behalf_reason=excluded\.submitted_on_behalf_reason/);
  assert.match(migration, /submitted_on_behalf_at=excluded\.submitted_on_behalf_at/);
  assert.match(migration, /status='submitted'/);
  assert.match(migration, /attendance_admin_submission_no_records/);
});

test('employee self submission clears any prior admin-on-behalf audit state', () => {
  assert.match(migration, /submitted_on_behalf=false/);
  assert.match(migration, /submitted_on_behalf_by_user_id=null/);
  assert.match(migration, /submitted_on_behalf_reason=null/);
  assert.match(migration, /submitted_on_behalf_at=null/);
});

test('admin attendance UI exposes the on-behalf action only for not-submitted months', () => {
  assert.match(api, /adminSubmitAttendanceMonthOnBehalf/);
  assert.match(api, /admin_submit_attendance_month_on_behalf/);
  assert.match(workspace, /workflow\.status === 'not_submitted'/);
  assert.match(workspace, /data-admin-payroll-submit-on-behalf/);
  assert.match(workspace, /אישור דיווח ע״י אדמין/);
  assert.match(workspace, /סיבה לאישור הדיווח/);
  assert.match(workspace, /אושר ע״י אדמין \/ בבקרת מנהל/);
});
