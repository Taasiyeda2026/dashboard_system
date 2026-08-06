import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const entry = await readFile(new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url), 'utf8');
const printModule = await readFile(new URL('../frontend/src/annual-reviews-print-plain.js', import.meta.url), 'utf8');

test('plain annual review print module is loaded', () => {
  assert.match(entry, /import '\.\/annual-reviews-print-plain\.js';/);
});

test('ratings and comments are converted to ordinary printed text', () => {
  assert.match(printModule, /דירוג:/);
  assert.match(printModule, /הערות/);
  assert.match(printModule, /textarea\.ar2-textarea/);
  assert.match(printModule, /\.ar2-rating\.is-selected/);
  assert.match(printModule, /ar2-print-plain-source/);
});

test('print conversion is limited to print lifecycle events', () => {
  assert.match(printModule, /addEventListener\('beforeprint'/);
  assert.match(printModule, /addEventListener\('afterprint'/);
  assert.doesNotMatch(printModule, /MutationObserver|stopPropagation|stopImmediatePropagation|preventDefault/);
});
