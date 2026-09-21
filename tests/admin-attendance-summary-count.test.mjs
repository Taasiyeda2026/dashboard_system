import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const adminSource = await readFile(new URL('../frontend/src/admin-attendance-standalone.js', import.meta.url), 'utf8');

test('admin overview excludes generated travel-time cancellation rows from report counts', () => {
  assert.match(adminSource, /const generationKind = text\(row\?\.generationKind \|\| row\?\.generation_kind\);/);
  assert.match(adminSource, /if \(generationKind === 'travel_time_cancellation'\) continue;/);
  assert.match(adminSource, /קיים · \${reportCount} דיווחים/);
});

test('admin overview still counts ordinary attendance rows', () => {
  assert.match(adminSource, /recordCounts\.set\(id, \(recordCounts\.get\(id\) \|\| 0\) \+ 1\);/);
});

test('admin attendance asset and cache markers are bumped', async () => {
  const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const sw = await readFile(new URL('../frontend/sw.js', import.meta.url), 'utf8');
  const config = await readFile(new URL('../frontend/src/config.js', import.meta.url), 'utf8');
  assert.match(index, /admin-attendance-standalone\.js\?v=20260916-admin-attendance-summary-count-v2/);
  assert.match(sw, /const CACHE_VERSION = 1728;/);
  assert.match(config, /admin-attendance-summary-count-sw-cache-1724-20260916-v1/);
});
