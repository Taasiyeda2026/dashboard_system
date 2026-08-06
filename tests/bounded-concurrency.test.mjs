import test from 'node:test';
import assert from 'node:assert/strict';
import { mapWithConcurrency } from '../frontend/src/bounded-concurrency.js';

test('bounded mapper preserves input order while limiting active saves', async () => {
  let active = 0;
  let maximum = 0;
  const result = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 3, async (value) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, (7 - value) * 2));
    active -= 1;
    return value * 10;
  });
  assert.equal(maximum, 3);
  assert.deepEqual(result, [10, 20, 30, 40, 50, 60]);
});

test('bounded mapper propagates save failures', async () => {
  await assert.rejects(
    mapWithConcurrency([1, 2, 3], 2, async (value) => {
      if (value === 2) throw new Error('save_failed');
      return value;
    }),
    /save_failed/
  );
});
