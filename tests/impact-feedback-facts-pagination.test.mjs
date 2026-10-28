import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAllFeedbackFactPages } from '../frontend/src/impact-feedback/feedback-facts-pagination.js';

test('loads all 2,853 answer rows rather than silently stopping at 1,000', async () => {
  const source = Array.from({ length: 2853 }, (_, i) => ({ answer_id: i + 1 }));
  const requested = [];
  const result = await loadAllFeedbackFactPages(async (start, end) => {
    requested.push([start, end]);
    return source.slice(start, end + 1);
  });
  assert.equal(result.length, 2853);
  assert.deepEqual(result.map((x) => x.answer_id), source.map((x) => x.answer_id));
  assert.deepEqual(requested, [
    [0, 499], [500, 999], [1000, 1499],
    [1500, 1999], [2000, 2499], [2500, 2999]
  ]);
});

test('reads one short page and returns empty set for no responses', async () => {
  let calls = 0;
  const result = await loadAllFeedbackFactPages(async () => {
    calls += 1;
    return [{ answer_id: 'one' }];
  });
  assert.deepEqual(result, [{ answer_id: 'one' }]);
  assert.equal(calls, 1);
  assert.deepEqual(await loadAllFeedbackFactPages(async () => []), []);
});

test('reads an additional empty page for an exact multiple of page size', async () => {
  const ranges = [];
  const source = Array.from({ length: 1000 }, (_, i) => i);
  const values = await loadAllFeedbackFactPages(async (start, end) => {
    ranges.push(start);
    return source.slice(start, end + 1);
  });
  assert.equal(values.length, 1000);
  assert.deepEqual(ranges, [0, 500, 1000]);
});

test('rejects oversized pages and propagates database errors, never shows partial facts', async () => {
  await assert.rejects(
    loadAllFeedbackFactPages(async () => new Array(501).fill(null)),
    /Invalid feedback facts page/
  );
  let pages = 0;
  await assert.rejects(
    loadAllFeedbackFactPages(async () => {
      if (++pages === 1) return new Array(500).fill(null);
      throw new Error('RPC unavailable');
    }),
    /RPC unavailable/
  );
});
