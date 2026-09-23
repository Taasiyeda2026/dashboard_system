import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(
  new URL('../supabase/functions/attendance-base-training-routes/index.ts', import.meta.url),
  'utf8'
);

test('base-training route builder reconciles historical pending attendance rows through protected RPC', () => {
  assert.match(source, /async function reconcilePendingBaseTraining/);
  assert.match(source, /av2_reconcile_pending_base_training_routes/);
  assert.match(source, /p_outbound: route\.outbound_travel_minutes/);
  assert.match(source, /p_return: route\.return_travel_minutes/);
  assert.match(source, /reconciled_pending/);
});

test('preview route also retries pending base-training compensation', () => {
  assert.match(
    source,
    /const reconciliation = await reconcilePendingBaseTraining\(db, empId, route\)/
  );
});
