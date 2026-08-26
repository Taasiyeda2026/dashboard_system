import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const proposalSource = await readFile(new URL('../frontend/src/israa-proposal-items.js', import.meta.url), 'utf8');
const configSource = await readFile(new URL('../frontend/src/config.js', import.meta.url), 'utf8');
const swSource = await readFile(new URL('../frontend/sw.js', import.meta.url), 'utf8');

test('Israa tour simulator launcher is placed in the top tab bar', () => {
  assert.match(proposalSource, /const tabbar = management\.querySelector\('\.israa-tabbar'\)/);
  assert.match(proposalSource, /button\.className = 'israa-tab'/);
  assert.match(proposalSource, /button\.textContent = 'סימולטור סיורים'/);
  assert.match(proposalSource, /tabbar\.append\(button\)/);
  assert.doesNotMatch(proposalSource, /management\.querySelector\('\.israa-v2__toolbar'\)/);
});

test('Israa tour simulator tab placement refreshes both cache layers', () => {
  assert.match(configSource, /israa-tour-pricing-tabbar-20260827-v2/);
  assert.match(swSource, /const CACHE_VERSION = 1629;/);
});
