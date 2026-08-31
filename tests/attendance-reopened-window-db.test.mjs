import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20260831143000_attendance_reopened_correction_window.sql', import.meta.url), 'utf8');

test('Supabase enforces the reopened correction window for writes and reopen transitions', () => {
  assert.match(migration, /create or replace function public\.av2_can_write_month/);
  assert.match(migration, /v_status = 'reopened' and extract\(day from current_date\)::int <= 7/);
  assert.match(migration, /v_status in \('submitted', 'locked', 'approved_for_payroll'\)/);
  assert.match(migration, /v_report_month <> \(v_current_month - interval '1 month'\)::date/);
  assert.match(migration, /create trigger av2_guard_reopened_correction_window/);
  assert.match(migration, /new.status is distinct from 'reopened'/);
  assert.match(migration, /raise exception 'attendance_reopen_window_closed'/);
});
