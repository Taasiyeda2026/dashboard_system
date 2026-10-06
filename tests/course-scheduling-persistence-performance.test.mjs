import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const screenUrl = new URL('../frontend/src/screens/course-scheduling.js', import.meta.url);
const storeUrl = new URL('../frontend/src/screens/course-scheduling-planning-store.js', import.meta.url);
const migrationUrl = new URL('../supabase/migrations/20261004193000_optimize_planning_persistence.sql', import.meta.url);
const checkpointCommitMigrationUrl = new URL('../supabase/migrations/20261006132323_commit_validated_planning_checkpoint.sql', import.meta.url);

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

test('validated full checkpoints commit in-database without re-uploading snapshot JSON', async () => {
  const [screen, store, sql] = await Promise.all([
    readFile(screenUrl, 'utf8'),
    readFile(storeUrl, 'utf8'),
    readFile(checkpointCommitMigrationUrl, 'utf8')
  ]);
  assert.match(store, /export async function commitSharedPlanningCheckpoint/);
  assert.match(store, /commit_scheduling_planning_checkpoint/);
  assert.match(screen, /let validatedCheckpointReady = resumeValidatedCommit === true/);
  assert.match(screen, /fullRun && validatedCheckpointReady[\s\S]*?commitSharedPlanningCheckpoint/);
  assert.match(sql, /from public\.scheduling_planning_checkpoint_rows r/);
  assert.doesNotMatch(sql, /jsonb_array_elements/);
});

test('planning preflight precedes snapshots and bulk travel cache is preloaded only for full runs', async () => {
  const source = await readFile(screenUrl, 'utf8');
  const run = source.slice(source.indexOf('const runCoursePlanning = async'), source.indexOf('const clonePlanningOption'));
  const preflight = run.indexOf('await runPlanningPreflight');
  const noOp = run.indexOf("preflight.decision === 'no-op'");
  const snapshot = run.indexOf('await loadSharedPlanningWorkspace');
  const routePreload = run.indexOf('await loadSchedulingTravelCacheRows()');
  assert.ok(preflight >= 0 && noOp > preflight && snapshot > noOp);
  assert.ok(routePreload > snapshot);
  assert.match(run, /if \(fullRun && !resumeValidatedCommit\) \{[\s\S]*?await loadSchedulingTravelCacheRows\(\)/);
  assert.match(run, /catch \(error\) \{[\s\S]*?routeCacheRows = \[\]/);
});

test('planning persistence SQL is set-based rather than row-loop based', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /save_scheduling_planning_incremental_snapshot/);
  assert.match(sql, /insert into public\.scheduling_planning_rows[\s\S]*?select[\s\S]*?jsonb_array_elements/);
  assert.doesNotMatch(sql, /for item in select value/);
});
