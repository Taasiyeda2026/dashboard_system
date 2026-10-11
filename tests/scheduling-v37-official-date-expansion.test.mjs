import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/20261012004000_optimize_v37_official_date_expansion.sql', import.meta.url), 'utf8');

test('v37 reads typed activity dates without serializing full 200+ field activities rows', () => {
  assert.match(sql, /from unnest\(array\[a\.date_1, a\.date_2,/);
  assert.match(sql, /from unnest\(array\[source\.date_1, source\.date_2,/);
  assert.match(sql, /with ordinality d\(value,num\)/);
  assert.doesNotMatch(sql, /to_jsonb\(source\)|to_jsonb\(a\)/);
});

test('v37 retains all critical hard-gate protection and server execution policy', () => {
  assert.match(sql, /scheduling_permission_denied/);
  assert.match(sql, /planning_server_activity_missing/);
  assert.match(sql, /planning_server_official_dates_changed/);
  assert.match(sql, /planning_server_protected_instructor_changed/);
  assert.match(sql, /planning_server_meeting_instructor_changed/);
  assert.match(sql, /planning_server_scope_changed/);
  assert.match(sql, /planning_server_candidate_constraint_failed/);
  assert.match(sql, /p\.course_restriction_mode = 'block_selected'/);
  assert.match(sql, /planning_server_calendar_constraint_failed/);
  assert.match(sql, /planning_server_overlap/);
  assert.match(sql, /planning_server_transition_constraint_failed/);
  assert.match(sql, /SECURITY DEFINER/);
  assert.match(sql, /SET search_path TO ''/);
  assert.doesNotMatch(sql, /set\s+statement_timeout|alter\s+role\s+authenticated/i);
});
