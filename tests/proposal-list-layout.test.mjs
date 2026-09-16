import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../frontend/src/styles/proposal-list-layout.css', import.meta.url), 'utf8');
const loader = await readFile(new URL('../frontend/src/feature-loaders.js', import.meta.url), 'utf8');

test('proposal list keeps visible tabs separated from list controls', () => {
  assert.match(css, /data-pa-view-mode="all-proposals"/);
  assert.match(css, /data-pa-screen-tabs/);
  assert.match(css, /margin-block-end:\s*14px/);
});

test('proposal list layout stylesheet is loaded with proposal features', () => {
  assert.match(loader, /import\('\.\/styles\/proposal-list-layout\.css'\)/);
});
