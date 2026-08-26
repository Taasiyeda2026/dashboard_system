import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const proposalSource = await readFile(new URL('../frontend/src/israa-proposal-items.js', import.meta.url), 'utf8');
const configSource = await readFile(new URL('../frontend/src/config.js', import.meta.url), 'utf8');
const swSource = await readFile(new URL('../frontend/sw.js', import.meta.url), 'utf8');

test('Israa tour simulator launcher targets the visible v2 toolbar before legacy toolbar', () => {
  assert.match(proposalSource, /management\.querySelector\('\.israa-v2__toolbar'\)\s*\|\|\s*management\.querySelector\('\.israa-toolbar'\)/);
  assert.match(proposalSource, /toolbar\.classList\.contains\('israa-v2__toolbar'\) \? 'israa-v2__btn' : 'israa-btn'/);
  assert.match(proposalSource, /button\.textContent = 'סימולטור סיורים'/);
});

test('Israa tour simulator frontend release refreshes both cache layers', () => {
  assert.match(configSource, /israa-tour-pricing-launcher-20260827-v1/);
  assert.match(swSource, /const CACHE_VERSION = 1628;/);
});
