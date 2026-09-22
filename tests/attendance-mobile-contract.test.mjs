import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../attendance/src/styles/mobile-final-contract.css', import.meta.url), 'utf8');
const index = await readFile(new URL('../attendance/index.html', import.meta.url), 'utf8');
const sw = await readFile(new URL('../attendance/sw.js', import.meta.url), 'utf8');
const mobileTheme = await readFile(new URL('../attendance/src/styles/mobile-app-theme.css', import.meta.url), 'utf8');

test('Attendance final mobile contract is loaded last and uses cache version 94', () => {
  assert.match(index, /mobile-final-contract\.css\?v=94/);
  assert.ok(index.indexOf('mobile-final-contract.css?v=94') > index.indexOf('new-report-accessibility.css?v=94'));
  assert.doesNotMatch(index, /v=92/);
  assert.match(sw, /const CACHE_VERSION = 94/);
});

test('Attendance mobile contract prevents squeezed desktop layouts', () => {
  assert.match(css, /@media \(max-width: 767px\)/);
  assert.match(css, /#app-frame,[\s\S]*\.app-shell[\s\S]*overflow-x:\s*hidden/);
  assert.match(css, /\.av2-report__form[\s\S]*flex-direction:\s*column\s*!important/);
  assert.match(css, /\.av2-form-section[\s\S]*width:\s*100%\s*!important/);
  assert.match(css, /\.av2-reports__toolbar[\s\S]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.av2-modal[\s\S]*width:\s*100vw\s*!important/);
  assert.match(css, /\.av2-calendar-day[\s\S]*width:\s*100vw\s*!important/);
});

test('Attendance mobile contract is iPhone-safe and touch-first', () => {
  assert.match(css, /font-size:\s*16px\s*!important/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.match(css, /env\(safe-area-inset-top/);
  assert.match(css, /touch-action:\s*manipulation/);
});

test('Attendance decorative operation tone uses teal instead of the retired orange palette', () => {
  assert.match(css, /data-tone="operations"[\s\S]*--av2-row-tone:\s*#0f9f96/);
  assert.doesNotMatch(css, /#e07a2f|#b86428|#9a4f18|#f4a62a|#f3a62f/);
  assert.doesNotMatch(mobileTheme, /#f4a62a|#f3a62f/);
});
