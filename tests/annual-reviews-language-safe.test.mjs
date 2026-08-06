import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const language = await readFile(new URL('../frontend/src/annual-reviews-language-safe.js', import.meta.url), 'utf8');
const entry = await readFile(new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url), 'utf8');

test('safe annual review language layer is loaded instead of the observer hotfix', () => {
  assert.match(entry, /import '\.\/annual-reviews-language-safe\.js\?v=20260730-final-pdf-upload-v1';/);
  assert.doesNotMatch(entry, /annual-reviews-language-hotfix\.js/);
});

test('language layer performs bounded passes without global DOM observation', () => {
  assert.match(language, /const APPLY_DELAYS = \[0, 60, 180, 450, 900, 1800\]/);
  assert.match(language, /currentGeneration !== generation/);
  assert.doesNotMatch(language, /MutationObserver/);
});

test('language layer does not replace global confirmation behavior', () => {
  assert.doesNotMatch(language, /window\.confirm\s*=/);
  assert.doesNotMatch(language, /EventTarget\.prototype/);
});

test('language passes are scheduled only around review navigation and operations', () => {
  assert.match(language, /\[data-ar2-open\], \[data-ar2-back\], \[data-ar2-operation\], \[data-ar2-dashboard\]/);
  assert.match(language, /document\.addEventListener\('click',[\s\S]*true\);/);
  assert.match(language, /document\.addEventListener\('app:navigate', scheduleLanguagePasses\)/);
});

test('header refinement avoids writing identical HTML repeatedly', () => {
  assert.match(language, /if \(metadata\.innerHTML !== nextHtml\) metadata\.innerHTML = nextHtml/);
});

test('final PDF upload card survives language cleanup passes', () => {
  assert.match(language, /status\.closest\('\[data-final-pdf-card\]'\)/);
  assert.match(language, /node\.closest\('\[data-final-pdf-card\]'\)/);
  assert.match(language, /if \(node\.closest\('\[data-final-pdf-card\]'\)\) return;/);
});
