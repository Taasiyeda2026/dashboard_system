import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const entry = await readFile(new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../frontend/src/annual-reviews-ui-compact-feedback.js', import.meta.url), 'utf8');

test('annual review compact UI feedback styles are loaded', () => {
  assert.match(entry, /import '\.\/annual-reviews-ui-compact-feedback\.js';/);
});

test('question textareas use a lower default height', () => {
  assert.match(styles, /textarea\.ar2-textarea:not\(\[data-ar2-metric-comment\]\)/);
  assert.match(styles, /min-height:\s*64px/);
  assert.match(styles, /height:\s*64px/);
});

test('printed reviews reset the compact textarea height', () => {
  assert.match(styles, /@media print/);
  assert.match(styles, /body\.ar2-printing/);
  assert.match(styles, /min-height:\s*0/);
  assert.match(styles, /height:\s*auto/);
  assert.match(styles, /field-sizing:\s*content/);
});

test('buttons and ratings provide visible press feedback without JavaScript listeners', () => {
  assert.match(styles, /\.ar2-btn:not\(:disabled\):active/);
  assert.match(styles, /\.ar2-rating:not\(:disabled\):active/);
  assert.match(styles, /translateY\(2px\) scale\(\.98\)/);
  assert.match(styles, /filter:\s*brightness\(\.92\)/);
  assert.doesNotMatch(styles, /addEventListener|MutationObserver|preventDefault|stopPropagation/);
});
