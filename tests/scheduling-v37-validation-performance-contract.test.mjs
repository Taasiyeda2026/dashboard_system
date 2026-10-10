import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  'supabase/migrations/20261010203000_optimize_v37_workspace_validation_performance.sql'
);
const sql = readFileSync(migrationPath, 'utf8');

test('v37 validation perf migration keeps hard gates and avoids timeout bumps', () => {
  assert.match(sql, /create or replace function public\.scheduling_v37_workspace_validation\(p_workspace_id uuid/);
  assert.match(sql, /planning_server_candidate_constraint_failed/);
  assert.match(sql, /planning_server_calendar_constraint_failed/);
  assert.match(sql, /planning_server_overlap/);
  assert.match(sql, /planning_server_transition_constraint_failed/);
  assert.match(sql, /planning_server_official_dates_changed/);
  assert.match(sql, /planning_server_protected_instructor_changed/);
  assert.match(sql, /planning_server_lock_changed/);
  assert.match(sql, /distance_km > 40/);
  assert.match(sql, /distance_km > 20/);
  assert.doesNotMatch(sql, /set\s+statement_timeout/i);
  assert.doesNotMatch(sql, /statement_timeout\s*=/);
});

test('v37 validation perf migration uses scoped blockers and temp materialization', () => {
  assert.match(sql, /tmp_scheduling_v37_meetings/);
  assert.match(sql, /tmp_scheduling_v37_plan_rows/);
  assert.match(sql, /plan_instructors/);
  assert.match(sql, /scheduling_normalize_location/);
  assert.match(sql, /school_meta/);
  assert.doesNotMatch(sql, /jsonb_to_recordset\(records\)/);
  assert.doesNotMatch(sql, /select coalesce\(jsonb_agg\(to_jsonb\(e\)\),\s*'\[\]'::jsonb\) into records/);
});
