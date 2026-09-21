import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../frontend/src/manager-board-workspace-runtime.js', import.meta.url), 'utf8');

test('manager summary excludes generated travel-time cancellation rows from the displayed report count', () => {
  assert.match(source, /const generationKind = text\(row\?\.generationKind \|\| row\?\.generation_kind\);/);
  assert.match(source, /if \(generationKind === 'travel_time_cancellation'\) continue;/);
  assert.match(source, /קיים · \${count} דיווחים/);
});

test('manager summary still counts ordinary attendance rows', () => {
  assert.match(source, /recordCounts\.set\(empId, \(recordCounts\.get\(empId\) \|\| 0\) \+ 1\);/);
});

test('cache markers are bumped for the manager summary fix', async () => {
  const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const sw = await readFile(new URL('../frontend/sw.js', import.meta.url), 'utf8');
  const config = await readFile(new URL('../frontend/src/config.js', import.meta.url), 'utf8');
  assert.match(index, /manager-board-workspace-runtime\.js\?v=20260916-attendance-summary-count-v2/);
  assert.match(sw, /const CACHE_VERSION = 1726;/);
  assert.match(config, /manager-attendance-summary-count-sw-cache-1723-20260916-v1/);
});
