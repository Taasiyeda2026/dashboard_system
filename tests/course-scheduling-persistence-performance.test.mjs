import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const screenUrl = new URL('../frontend/src/screens/course-scheduling.js', import.meta.url);
const storeUrl = new URL('../frontend/src/screens/course-scheduling-planning-store.js', import.meta.url);
const migrationUrl = new URL('../supabase/migrations/20261004193000_optimize_planning_persistence.sql', import.meta.url);

test('local planning repairs do not upload whole-workspace checkpoints at every stage', async () => {
  const source = await readFile(screenUrl, 'utf8');
  assert.match(source, /const persistServerCheckpoints = forceFull === true/);
  assert.match(source, /if \(!persistServerCheckpoints\) return;[\s\S]*?saveSharedPlanningCheckpoint/);
  assert.match(source, /checkpointPayloadBytes/);
});

test('ordinary incremental completion persists only affected or actually changed rows', async () => {
  const source = await readFile(screenUrl, 'utf8');
  assert.match(source, /saveSharedPlanningIncrementalSnapshot/);
  assert.match(source, /const mandatoryIds = new Set\(affectedIds/);
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
  const noOpBranch = source.indexOf('if (!fullRun && affectedIds.length === 0)');
  const routeCacheLoad = source.indexOf('await loadSchedulingTravelCacheRows()', noOpBranch);
  assert.ok(noOpBranch >= 0);
  assert.ok(routeCacheLoad > noOpBranch);
  assert.doesNotMatch(source.slice(0, noOpBranch), /await loadSchedulingTravelCacheRows\(\)/);
  assert.match(source, /const shouldPreloadRouteCache = forceFull === true/);
  assert.match(source, /const routeCacheRows = shouldPreloadRouteCache[\s\S]*?\? await loadSchedulingTravelCacheRows\(\)[\s\S]*?: \[\]/);
});

test('planning persistence SQL is set-based rather than row-loop based', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /save_scheduling_planning_incremental_snapshot/);
  assert.match(sql, /insert into public\.scheduling_planning_rows[\s\S]*?select[\s\S]*?jsonb_array_elements/);
  assert.doesNotMatch(sql, /for item in select value/);
});
