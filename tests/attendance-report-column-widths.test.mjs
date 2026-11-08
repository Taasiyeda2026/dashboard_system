import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../attendance/src/styles/report-table-fit-fix.css', import.meta.url), 'utf8');

test('Nov 2026+ reports use twelve aligned tracks with a full-width actions column', () => {
  assert.match(css, /\.av2-reports \.av2-report-list__head,\s*\.av2-reports \.av2-report-row\s*\{/);
  assert.match(css, /61px 60px 60px 60px 61px 60px\s*100px 95px 90px 55px 55px 161px !important/);
  assert.match(css, /\.av2-report-list:not\(\.av2-report-list--legacy-cancellation\)/);
});

test('legacy reports preserve their separate time-cancellation column', () => {
  assert.match(css, /\.av2-report-list--legacy-cancellation \.av2-report-list__head/);
  assert.match(css, /61px 60px 60px 60px 61px 61px 60px\s*100px 95px 90px 55px 55px 100px !important/);
});

test('actions are not clipped and narrow desktop windows can scroll the report table', () => {
  assert.match(css, /\.av2-reports \.av2-report-list\s*\{\s*overflow-x: auto !important/);
  assert.match(css, /\.av2-reports \.av2-report-row \.av2-rr__actions\s*\{[^}]*overflow: visible !important/);
});
