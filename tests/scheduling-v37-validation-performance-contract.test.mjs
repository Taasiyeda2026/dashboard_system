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


const followupSQL = readFileSync(resolve(
  'supabase/migrations/20261011094000_optimize_v37_history_and_prior_lock_checks.sql'
), 'utf8');

test('v37 history join remains unique and preserves instructor substitution guards', () => {
  assert.match(followupSQL, /left join public\.course_meeting_instructor_history h/);
  assert.match(followupSQL, /h\.activity_id = source\.row_id/);
  assert.match(followupSQL, /h\.meeting_date = \(m->>'date'\)::date/);
  assert.doesNotMatch(followupSQL, /left join lateral \(\s*select h\.emp_id/);
  assert.match(followupSQL, /planning_server_meeting_instructor_changed/);
  assert.match(followupSQL, /planning_server_official_dates_changed/);
});

test('v37 protected lock parity is evaluated once per planned activity', () => {
  assert.match(followupSQL, /as same_prior_locked,/);
  assert.match(followupSQL, /false as same_prior_locked,/);
  assert.match(followupSQL, /a\.same_prior_locked/);
  assert.match(followupSQL, /old->'lockedOption' = pr\.locked_option/);
  assert.match(followupSQL, /old->'row'->'meetings' = pr\.row_data->'meetings'/);
  assert.match(followupSQL, /planning_server_lock_changed/);
  assert.match(followupSQL, /SET search_path TO ''/);
  assert.doesNotMatch(followupSQL, /set\s+statement_timeout/i);
});
