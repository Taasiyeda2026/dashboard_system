import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(new URL('../supabase/migrations/20261101122500_fix_attendance_course_private_schema_permissions.sql', import.meta.url), 'utf8');

test('paid-hour normalization moves into existing secured assignment guard', () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\\.av2_guard_course_date_assignment\\(\\)/i);
  assert.equal((sql.match(/new := attendance_private\\.normalize_course_paid_hours\\(new, tg_op = 'UPDATE'\\);/g) || []).length, 2);
  assert.match(sql, /drop trigger if exists trg_attendance_course_paid_hours/i);
  assert.match(sql, /drop function if exists attendance_private\\.sync_course_paid_hours\\(\\)/i);
});

test('helper remains inaccessible to the API roles and does not require private schema grants', () => {
  assert.match(sql, /security invoker/i);
  assert.match(sql, /revoke all on function attendance_private\\.normalize_course_paid_hours[\\s\\S]*?from public, anon, authenticated/i);
  assert.doesNotMatch(sql, /grant usage on schema attendance_private/i);
});

test('existing paid hours and approval rules are preserved', () => {
  assert.ok(sql.includes("(v_work->>'paid_minutes')::integer is distinct from 120"));
  assert.match(sql, /p_row\\.total_hours := 2;/i);
  assert.match(sql, /attendance_manager_record_reviews/i);
  assert.match(sql, /attendance_month_approvals/i);
});
