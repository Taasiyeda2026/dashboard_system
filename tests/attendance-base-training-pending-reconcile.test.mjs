import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(
  new URL('../supabase/functions/attendance-base-training-routes/index.ts', import.meta.url),
  'utf8'
);

test('base-training route builder reconciles historical pending attendance rows', () => {
  assert.match(source, /async function reconcilePendingBaseTraining/);
  assert.match(source, /attendance_travel_compensations/);
  assert.match(source, /calculation_status', 'pending'/);
  assert.match(source, /av2_prepare_attendance_travel/);
  assert.match(source, /av2_reconcile_attendance_travel/);
  assert.match(source, /reconciled_pending/);
});

test('preview route also retries pending base-training compensation', () => {
  assert.match(
    source,
    /const reconciliation = await reconcilePendingBaseTraining\(db, empId, route\)/
  );
});
