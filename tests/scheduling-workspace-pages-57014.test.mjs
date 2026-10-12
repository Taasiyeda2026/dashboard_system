import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql=readFileSync(new URL('../supabase/migrations/20261012132500_paged_scheduling_workspace_reads.sql',import.meta.url),'utf8');
const js=readFileSync(new URL('../frontend/src/screens/course-scheduling-planning-store.js',import.meta.url),'utf8');

test('paged full-workspace reader is authorized and revision fenced, with bounded 25-50 row pages',()=>{
  assert.match(sql,/app_has_permission\('view_operations_scheduling'\)/);
  assert.match(sql,/auth\.uid\(\) is null/);
  assert.match(sql,/p_limit > 50/);
  assert.match(sql,/p_offset < 0/);
  assert.match(sql,/p_expected_revision is not null/);
  assert.match(sql,/planning_revision_conflict/);
  assert.match(sql,/order by activity_id/);
  assert.match(sql,/limit p_limit offset p_offset/);
  assert.match(sql,/revoke all on function .* from public,anon/);
  assert.match(sql,/grant execute on function .* to authenticated/);
});
test('paged response preserves the full legacy row and workspace data shape',()=>{
  for(const name of ['activityId','row','activityUpdatedAt','lockedOption','lockedAt','lockedBy','needsRecalc','needsRecalcMarkedAt','updatedByName','contextFingerprint','dataFingerprint','engineVersion','revision','total']) {
    assert.ok(sql.includes("'"+name+"'"), 'missing '+name);
  }
});
test('frontend loads groups of two bounded pages and rejects torn snapshots',()=>{
  assert.match(js,/const pageSize = 25/);
  assert.match(js,/get_scheduling_planning_workspace_page/);
  assert.match(js,/index \+= 2/);
  assert.match(js,/p_expected_revision: revision/);
  assert.match(js,/planning_workspace_page_incomplete/);
  assert.match(js,/assertSharedPlanningWorkspaceRevision\(\{ workspaceId: workspace\.id, expectedRevision: revision \}\)/);
  assert.match(js,/\['PGRST202', '42883'\]/);
});
