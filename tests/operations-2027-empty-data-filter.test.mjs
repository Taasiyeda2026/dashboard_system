import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const filterPath = new URL('../frontend/src/screens/operations-2027-empty-data-filter.js', import.meta.url);
const cleanupPath = new URL('../frontend/src/screens/operations-authorities-cleanup.js', import.meta.url);
const configPath = new URL('../frontend/src/config.js', import.meta.url);
const swPath = new URL('../frontend/sw.js', import.meta.url);

const [filterSource, cleanupSource, configSource, swSource] = await Promise.all([
  readFile(filterPath, 'utf8'),
  readFile(cleanupPath, 'utf8'),
  readFile(configPath, 'utf8'),
  readFile(swPath, 'utf8')
]);

test('2027 operations hides empty training rows and columns while preserving marked cells', () => {
  assert.match(filterSource, /summer_training_matrix/);
  assert.match(filterSource, /course_training_matrix/);
  assert.match(filterSource, /row\.hidden = !Array\.from\(row\.cells\)\.slice\(1\)\.some\(hasData\)/);
  assert.match(filterSource, /rows\.some\(\(row\) => hasData\(row\.cells\[index\]\)\)/);
});

test('print kit location columns are hidden only when every value is zero', () => {
  assert.match(filterSource, /LOCATION_LABELS/);
  assert.match(filterSource, /numericValue\(row\.cells\[index\]\) !== 0/);
  assert.match(filterSource, /course_print_kits/);
});

test('filter is loaded and cache versions are refreshed', () => {
  assert.match(cleanupSource, /operations-2027-empty-data-filter\.js/);
  assert.match(configSource, /ops-2027-empty-data-filter-20260807-v1/);
  assert.match(swSource, /const CACHE_VERSION = 1457;/);
});
