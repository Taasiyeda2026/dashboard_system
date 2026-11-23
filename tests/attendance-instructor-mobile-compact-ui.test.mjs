import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('new-report mobile hours stay on one row: start | end | total', async () => {
  const typography = await read('attendance/src/styles/report-tabs-responsive-typography.css');
  const layout = await read('attendance/src/styles/new-report-layout-fix.css');
  const screen = await read('attendance/src/styles/new-report-screen.css');
  assert.match(typography, /@media\(max-width:767px\)[\s\S]*grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\) minmax\(0,\.9fr\)/);
  assert.match(screen, /\.av2-report__times-grid\s*\{[\s\S]*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)\s+minmax\(0,\s*0\.9fr\)/);
  assert.match(typography, /hours-followup\{[\s\S]*grid-column:1 \/ -1/);
  assert.match(layout, /#av2-report-date[\s\S]*min-width:\s*0\s*!important/);
  assert.match(layout, /input\[type='date'\][\s\S]*box-sizing:\s*border-box/);
  assert.match(layout, /body--activity[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/);
});

test('attendance cache markers moved with the compact mobile UI', async () => {
  const sw = await read('attendance/sw.js');
  const index = await read('attendance/index.html');
  assert.match(sw, /const CACHE_VERSION = 190/);
  assert.match(index, /\?v=190/);
  assert.doesNotMatch(index, /\?v=186/);
});
