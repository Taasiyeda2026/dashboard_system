import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/20261012130500_optimize_planning_incremental_save_payload.sql',import.meta.url),'utf8');

test('all three planning writer routes use only prior fields required by v37 validator', () => {
  for (const name of [
    'save_scheduling_planning_incremental_snapshot(',
    'save_scheduling_planning_snapshot(',
    'commit_scheduling_planning_checkpoint('
  ]) assert.ok(sql.includes('FUNCTION public.'+name));
  assert.equal((sql.match(/'row',jsonb_build_object\('instructorEmpId',r\.row_data->'instructorEmpId','startDate',r\.row_data->'startDate','meetings',r\.row_data->'meetings'\)/g)||[]).length,3);
  assert.doesNotMatch(sql,/'row',r\.row_data,'lockedOption'/);
  assert.ok(sql.includes("'lockedOption',r.locked_option"));
  assert.ok(sql.includes("p_prior_rows") === false, 'do not rewrite the validation function');
});

test('incremental upsert only changes rows with actual differences, not every saved row', () => {
  assert.match(sql,/on conflict on constraint scheduling_planning_rows_pkey/);
  assert.match(sql,/where public\.scheduling_planning_rows\.row_data is distinct from excluded\.row_data/);
  assert.match(sql,/public\.scheduling_planning_rows\.activity_updated_at is distinct from excluded\.activity_updated_at/);
  assert.match(sql,/public\.scheduling_planning_rows\.needs_recalc is distinct from false/);
  assert.match(sql,/do update set[\s\S]*needs_recalc = false/);
});

test('revision, run lease, source fences and whole-plan validator remain in writers', () => {
  assert.equal((sql.match(/assert_scheduling_planning_run_ownership/g)||[]).length>=3,true);
  assert.equal((sql.match(/scheduling_v37_workspace_validation/g)||[]).length>=3,true);
  assert.match(sql,/planning_revision_conflict/);
  assert.match(sql,/planning_activity_changed/);
  assert.match(sql,/planning_engine_downgrade_forbidden/);
  assert.doesNotMatch(sql,/alter\s+role\s+authenticated|set\s+statement_timeout\s*=/i);
});