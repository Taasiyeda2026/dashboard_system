import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const runtime = await readFile(new URL('../frontend/src/manager-board-final-fixes-runtime.js', import.meta.url), 'utf8');
const boardRuntime = await readFile(new URL('../frontend/src/manager-board-runtime.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../frontend/src/styles/manager-board-final-fixes.css', import.meta.url), 'utf8');

test('manager board opens school 2027 on September by default', () => {
  assert.match(boardRuntime, /if \(normalized === 'school_2027'\) return SCHOOL_2027_START_DATE\.slice\(0, 7\)/);
  assert.match(runtime, /localStorage\.removeItem\(`manager_board_month:\$\{period\}`\)/);
  assert.match(runtime, /clearPersistedManagerMonthDefaults\(\)/);
});

test('long calendar descriptions wrap instead of ellipsizing', () => {
  assert.match(css, /\.manager-board-screen \.manager-board-calendar-day__school/);
  assert.match(css, /text-overflow: clip !important/);
  assert.match(css, /white-space: normal !important/);
  assert.match(css, /overflow-wrap: anywhere/);
});
