import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const INDEX_FILE = new URL('../index.html', import.meta.url);
const CSS_FILE = new URL('../frontend/src/styles/proposal-editor-compact-fixes.css', import.meta.url);
const RUNTIME_FILE = new URL('../frontend/src/proposal-editor-compact-fixes.js', import.meta.url);

test('proposal editor compact assets are loaded after the shared dashboard styles', async () => {
  const html = await readFile(INDEX_FILE, 'utf8');
  const mainStyle = html.indexOf('./frontend/src/styles/main.css');
  const compactStyle = html.indexOf('./frontend/src/styles/proposal-editor-compact-fixes.css');
  assert.ok(mainStyle >= 0, 'main stylesheet should remain loaded');
  assert.ok(compactStyle > mainStyle, 'compact proposal editor overrides should load after main.css');
  assert.match(html, /frontend\/src\/proposal-editor-compact-fixes\.js/);
});

test('compact CSS remains scoped to the proposal editor and keeps requested controls equal-sized', async () => {
  const css = await readFile(CSS_FILE, 'utf8');
  assert.match(css, /#app \.pa-editor-workspace \.pa-editor-heading-actions \.ds-btn/);
  assert.match(css, /--pa-choice-width:\s*92px/);
  assert.match(css, /grid-template-columns:\s*repeat\(3, var\(--pa-choice-width\)\)/);
  assert.match(css, /grid-template-columns:\s*minmax\(320px, 420px\) 80px max-content 36px/);
  assert.match(css, /\.ds-pa-discount-details\s*\{/);
  assert.doesNotMatch(css, /(?:^|\n)\s*(?:button|\.ds-btn)\s*\{/m, 'no unscoped global button rules are allowed');
});

test('runtime compacts selected recipients and relocates notes without changing field names', async () => {
  const runtime = await readFile(RUNTIME_FILE, 'utf8');
  assert.match(runtime, /locked\.classList\.toggle\('is-authority'/);
  assert.match(runtime, /extraBody\.appendChild\(noteDetails\)/);
  assert.match(runtime, /discountDetails\.appendChild\(notesField\)/);
  assert.match(runtime, /MutationObserver/);
  assert.doesNotMatch(runtime, /Supabase|fetch\(|localStorage|sessionStorage/);
});
