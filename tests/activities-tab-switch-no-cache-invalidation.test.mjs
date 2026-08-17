/**
 * Regression test: switching the activities inner tab must NOT call
 * clearScreenDataCache / invalidateActivityDataCaches.
 *
 * Switching tabs is a pure UI action (same data rows, different view slice).
 * Invalidating the cache there causes a full network re-fetch on every tab
 * switch, defeating stale-while-revalidate and producing cache_hit:false on
 * every navigation after the first.
 *
 * True cache invalidation must only happen after data mutations
 * (add / save / delete / submit-request).
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const SRC = readFileSync('frontend/src/screens/activities.js', 'utf8');
const LINES = SRC.split('\n');

/** Extract the source lines of the [data-activity-period-tab] forEach block. */
function extractTabHandlerBlock() {
  const startIdx = LINES.findIndex(
    (l) => l.includes('[data-activity-period-tab]') && l.includes('.forEach')
  );
  if (startIdx === -1) return null;

  let depth = 0;
  let entered = false;
  const collected = [];

  for (let i = startIdx; i < Math.min(startIdx + 40, LINES.length); i++) {
    const line = LINES[i];
    for (const ch of line) {
      if (ch === '{') { depth++; entered = true; }
      else if (ch === '}') depth--;
    }
    collected.push(line);
    if (entered && depth === 0) break;
  }
  return collected.join('\n');
}

test('data-activity-period-tab click handler is found in activities.js', () => {
  const block = extractTabHandlerBlock();
  assert.ok(block !== null, '[data-activity-period-tab] forEach handler not found in activities.js');
  assert.ok(block.length > 0, 'handler block is empty');
});

/** Strip // single-line comments so the check only sees executable code. */
function stripLineComments(src) {
  return src
    .split('\n')
    .map((line) => {
      const commentStart = line.indexOf('//');
      return commentStart === -1 ? line : line.slice(0, commentStart);
    })
    .join('\n');
}

test('switching inner activities tab does NOT call clearScreenDataCache', () => {
  const block = extractTabHandlerBlock();
  assert.ok(block !== null, '[data-activity-period-tab] forEach handler not found');

  const code = stripLineComments(block);
  assert.ok(
    !code.includes('clearScreenDataCache'),
    'data-activity-period-tab click handler must NOT call clearScreenDataCache.\n' +
    'Tab switching is a UI-only action — use rerenderLocal() on the existing rows.\n' +
    'Cache invalidation belongs only in true data mutations (add/save/delete).'
  );
});

test('switching inner activities tab does NOT call invalidateActivityDataCaches', () => {
  const block = extractTabHandlerBlock();
  assert.ok(block !== null, '[data-activity-period-tab] forEach handler not found');

  const code = stripLineComments(block);
  assert.ok(
    !code.includes('invalidateActivityDataCaches'),
    'data-activity-period-tab click handler must NOT call invalidateActivityDataCaches.\n' +
    'Tab switching is a UI-only action — rerender from cached rows, no invalidation.'
  );
});

test('tab handler calls rerenderLocal to apply the tab change', () => {
  const block = extractTabHandlerBlock();
  assert.ok(block !== null, '[data-activity-period-tab] forEach handler not found');

  assert.ok(
    block.includes('rerenderLocal'),
    'data-activity-period-tab handler must call rerenderLocal() to update the view.'
  );
});

test('add-activity submit still invalidates cache after mutation', () => {
  // Verify that the post-mutation invalidation calls are still present in the
  // addActivity / submitCreateActivityRequest success paths.
  const addActivitySection = SRC.slice(SRC.indexOf('api.addActivity(payload)'));
  const submitRequestSection = SRC.slice(SRC.indexOf('api.submitCreateActivityRequest(payload)'));

  assert.ok(
    addActivitySection.slice(0, 500).includes('clearScreenDataCache'),
    'api.addActivity() success path must still call clearScreenDataCache (data mutation).'
  );
  assert.ok(
    submitRequestSection.slice(0, 500).includes('clearScreenDataCache'),
    'api.submitCreateActivityRequest() success path must still call clearScreenDataCache (data mutation).'
  );
});
