import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const bridgeSource = await readFile(new URL('../frontend/src/payroll-attendance-v2-bridge.js', import.meta.url), 'utf8');
const migrationSource = await readFile(new URL('../supabase/migrations/20260828223936_attendance_retention_foundation.sql', import.meta.url), 'utf8');

test('attendance-control team discovery does not scan accumulated attendance history', () => {
  assert.match(bridgeSource, /attendanceControlTeams\s*=\s*async function[\s\S]*get_payroll_attendance_team_roster/);
  const teamsFunction = bridgeSource.match(/api\.attendanceControlTeams\s*=\s*async function\s*\(\)\s*\{([\s\S]*?)\n\};/)?.[1] || '';
  assert.doesNotMatch(teamsFunction, /attendanceControlRecords\s*\(/);
  assert.doesNotMatch(teamsFunction, /get_payroll_attendance_records/);
});

test('attendance history has indexes for employee-month and manager-month access patterns', () => {
  assert.match(migrationSource, /attendance_records_emp_date_time_idx[\s\S]*\(emp_id, report_date, start_time\)/);
  assert.match(migrationSource, /attendance_records_date_emp_time_idx[\s\S]*\(report_date, emp_id, start_time\)/);
  assert.match(migrationSource, /attendance_record_attachments_record_idx[\s\S]*\(record_id\)/);
  assert.match(migrationSource, /attendance_month_approvals_month_status_emp_idx[\s\S]*\(month_key, status, emp_id\)/);
});

test('finalized attendance months are retained and protected from row mutation', () => {
  assert.match(migrationSource, /Rows are retained; finalized months are archived logically and are not automatically deleted/);
  assert.match(migrationSource, /ama\.status = 'locked'/);
  assert.match(migrationSource, /pca\.status = 'approved_for_payroll'/);
  assert.match(migrationSource, /before insert or update or delete on public\.attendance_records/);
  assert.match(migrationSource, /raise exception 'attendance_month_locked'/);
  assert.doesNotMatch(migrationSource, /delete\s+from\s+public\.attendance_records/i);
});

test('approved snapshot remains the deterministic source for Excel regeneration', () => {
  assert.match(migrationSource, /payroll_control_approvals\.approved_snapshot/);
  assert.match(migrationSource, /deterministic regeneration of the approved Excel export/);
});
