import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../frontend/src/main.js', import.meta.url), 'utf8');

test('proposal screen uses a short memory-only cache and remains mutation-invalidated', () => {
  assert.match(source, /'proposals-agreements': 2 \* 60 \* 1000/);
  assert.match(source, /MEMORY_ONLY_CACHE_PREFIXES\s*=\s*\[[\s\S]*'proposals-agreements'/);
  assert.match(source, /clearScreenDataCache[\s\S]*const k = screenDataCacheKey\(\);[\s\S]*delete state\.screenDataCache\[k\]/);
});

test('proposal navigation can paint from the route cache without purging it first', () => {
  const mountSection = source.slice(source.indexOf('async function mountScreen()'), source.indexOf('async function render()'));
  assert.doesNotMatch(mountSection, /requestedRoute === 'proposals-agreements'[\s\S]{0,100}purgeProposalsRelatedCaches/);
  assert.match(mountSection, /const rawEntry = !screen\.load \? null : state\.screenDataCache\[cacheKey\]/);
});
