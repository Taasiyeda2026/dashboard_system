import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const screenUrl = new URL('../frontend/src/screens/course-scheduling.js', import.meta.url);
const storeUrl = new URL('../frontend/src/screens/course-scheduling-planning-store.js', import.meta.url);
const migrationUrl = new URL('../supabase/migrations/20261004193000_optimize_planning_persistence.sql', import.meta.url);

test('local planning repairs do not upload whole-workspace checkpoints at every stage', async () => {
  const source = await readFile(screenUrl, 'utf8');
  assert.match(source, /const persistServerCheckpoints = runPlan\.persistServerCheckpoints === true/);
  assert.match(source, /if \(!persistServerCheckpoints\) return;[\s\S]*?saveSharedPlanningCheckpoint/);
  assert.match(source, /checkpointPayloadBytes/);
  assert.match(source, /PLANNING_RUN_TYPES\.ENGINE_UPGRADE/);
  assert.match(source, /PLANNING_RUN_TYPES\.NO_OP/);
});

test('ordinary incremental completion persists only affected or actually changed rows', async () => {
  const source = await readFile(screenUrl, 'utf8');
  assert.match(source, /saveSharedPlanningIncrementalSnapshot/);
  // Engine-upgrade keeps mandatory writes on base/dirty ids only; upgrade
  // optimization rows are persisted when they actually changed.
  assert.match(source, /const mandatoryIds = new Set\(incrementalBaseIds\.map\(text\)\.filter\(Boolean\)\)/);
  assert.match(source, /canonicalPlanningJson\(previous\) !== canonicalPlanningJson\(row\)/);
  assert.match(source, /removedActivityIds/);
});

test('planning store exposes incremental snapshot RPC', async () => {
  const source = await readFile(storeUrl, 'utf8');
  assert.match(source, /export async function saveSharedPlanningIncrementalSnapshot/);
  assert.match(source, /save_scheduling_planning_incremental_snapshot/);
  assert.match(source, /p_removed_activity_ids/);
});

test('planning preflight does not load the bulk travel cache before deciding work is required', async () => {
  const source = await readFile(screenUrl, 'utf8');
  const noOpBranch = source.indexOf("runPlan.runType === PLANNING_RUN_TYPES.NO_OP");
  const routeCacheLoad = source.indexOf('await loadSchedulingTravelCacheRows()', noOpBranch);
  assert.ok(noOpBranch >= 0);
  assert.ok(routeCacheLoad > noOpBranch);
  assert.doesNotMatch(source.slice(0, noOpBranch), /await loadSchedulingTravelCacheRows\(\)/);
  assert.match(source, /const shouldPreloadRouteCache = runPlan\.preloadRouteCache === true/);
  assert.match(source, /const routeCacheRows = shouldPreloadRouteCache[\s\S]*?\? await loadSchedulingTravelCacheRows\(\)[\s\S]*?: \[\]/);
});

test('planning persistence SQL is set-based rather than row-loop based', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /save_scheduling_planning_incremental_snapshot/);
  assert.match(sql, /insert into public\.scheduling_planning_rows[\s\S]*?select[\s\S]*?jsonb_array_elements/);
  assert.doesNotMatch(sql, /for item in select value/);
});
