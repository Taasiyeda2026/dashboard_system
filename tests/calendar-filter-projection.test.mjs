import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const apiSource = fs.readFileSync(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
const mainSource = fs.readFileSync(new URL('../frontend/src/main.js', import.meta.url), 'utf8');

function calendarProjectionSource() {
  const match = apiSource.match(/const ACTIVITY_CALENDAR_COLUMNS = \[([\s\S]*?)\]\.join\(','\);/);
  assert.ok(match, 'ACTIVITY_CALENDAR_COLUMNS projection must exist');
  return match[1];
}

test('calendar projection includes every field required by manager and funding filters', () => {
  const projection = calendarProjectionSource();
  assert.match(projection, /['"]activity_manager['"]/);
  assert.match(projection, /['"]funding['"]/);
});

test('calendar cache projection version is bumped so old cached rows are not reused', () => {
  assert.match(mainSource, /const projection = ['"]p4['"]/);
});
