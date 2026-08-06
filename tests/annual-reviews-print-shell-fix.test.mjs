import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const entry = await readFile(new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url), 'utf8');
const runtime = await readFile(new URL('../frontend/src/annual-reviews-print-shell-fix.js', import.meta.url), 'utf8');

test('annual review print shell fix is loaded with a cache buster', () => {
  assert.match(entry, /annual-reviews-print-shell-fix\.js\?v=20260730-blank-print-v1/);
});

test('print mode removes fixed-height and overflow clipping from shell containers', () => {
  assert.match(runtime, /body\.ar2-printing \.app-shell/);
  assert.match(runtime, /body\.ar2-printing \.shell-main/);
  assert.match(runtime, /body\.ar2-printing \.shell-stage/);
  assert.match(runtime, /height:\s*auto\s*!important/);
  assert.match(runtime, /overflow:\s*visible\s*!important/);
  assert.match(runtime, /zoom:\s*1\s*!important/);
});

test('printing starts from the top and restores the previous scroll position', () => {
  assert.match(runtime, /beforeprint/);
  assert.match(runtime, /afterprint/);
  assert.match(runtime, /stage\.scrollTop\s*=\s*0/);
  assert.match(runtime, /previousScrollTop/);
});

test('large review cards may paginate naturally instead of being pushed off the page', () => {
  assert.match(runtime, /\.ar2-card/);
  assert.match(runtime, /break-inside:\s*auto\s*!important/);
  assert.match(runtime, /\.ar2-question/);
  assert.match(runtime, /break-inside:\s*avoid\s*!important/);
});
