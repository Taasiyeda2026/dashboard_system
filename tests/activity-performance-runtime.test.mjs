import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const entrySource = await readFile(new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url), 'utf8');
const runtimeSource = await readFile(new URL('../frontend/src/activity-performance-runtime.js', import.meta.url), 'utf8');
const dedupeSource = await readFile(new URL('../frontend/src/network-request-dedupe.js', import.meta.url), 'utf8');

test('performance guards load before the application bootstrap', () => {
  const dedupeIndex = entrySource.indexOf("import './network-request-dedupe.js';");
  const runtimeIndex = entrySource.indexOf("import './activity-performance-runtime.js';");
  const mainIndex = entrySource.indexOf("import './main.js';");
  assert.ok(dedupeIndex >= 0, 'network request dedupe must be imported');
  assert.ok(runtimeIndex > dedupeIndex, 'activity performance runtime must load after fetch dedupe');
  assert.ok(mainIndex > runtimeIndex, 'both performance guards must load before main.js');
});

test('dashboard speculative activity screens are blocked from heavy API reads', () => {
  assert.match(runtimeSource, /DASHBOARD_PREFETCH_METHODS\s*=\s*\['week',\s*'month',\s*'endDates',\s*'archiveActivities'\]/);
  assert.match(runtimeSource, /dashboard_background_prefetch_skipped/);
  assert.match(runtimeSource, /isDashboardPrefetchContext\(\)/);
});

test('post-save activity refresh uses the patched in-memory snapshot', () => {
  assert.match(runtimeSource, /suppressFullRefreshUntil\s*=\s*Date\.now\(\)\s*\+\s*12_000/);
  assert.match(runtimeSource, /patchAllActivitySnapshots\(savedRow\)/);
  assert.match(runtimeSource, /Date\.now\(\)\s*<\s*suppressFullRefreshUntil\s*&&\s*snapshot/);
  assert.match(runtimeSource, /wrapMutation\('saveActivity'/);
});

test('identical activities and school-contact reads are deduplicated', () => {
  assert.match(dedupeSource, /path\.endsWith\('\/rest\/v1\/activities'\)/);
  assert.match(dedupeSource, /path\.endsWith\('\/rest\/v1\/contacts_schools'\)/);
  assert.match(dedupeSource, /const inflight = new Map\(\)/);
  assert.match(dedupeSource, /responseCache\.set\(key/);
});
