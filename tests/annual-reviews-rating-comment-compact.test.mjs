import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const entry = await readFile(new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url), 'utf8');
const compact = await readFile(new URL('../frontend/src/annual-reviews-rating-comment-compact.js', import.meta.url), 'utf8');

test('compact rating comment styles are loaded', () => {
  assert.match(entry, /import '\.\/annual-reviews-rating-comment-compact\.js';/);
});

test('rating comment textarea defaults to a one-line height', () => {
  assert.match(compact, /textarea\[data-ar2-metric-comment\]/);
  assert.match(compact, /height:\s*36px/);
  assert.match(compact, /min-height:\s*36px/);
  assert.doesNotMatch(compact, /MutationObserver/);
});
