import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeActivityTime } from '../frontend/src/screens/shared/activity-time-options.js';

const timeControlsSrc = fs.readFileSync(new URL('../frontend/src/screens/shared/activity-time-options.js', import.meta.url), 'utf8');

test('activity time normalization accepts any valid minute instead of fixed quarter-hour slots', () => {
  assert.equal(normalizeActivityTime('08:07'), '08:07');
  assert.equal(normalizeActivityTime('9:42'), '09:42');
  assert.equal(normalizeActivityTime('13:58'), '13:58');
  assert.equal(normalizeActivityTime('23:59'), '23:59');
});

test('activity create and edit time selects are upgraded to minute-precision time inputs', () => {
  assert.match(timeControlsSrc, /select\[name="start_time"\]/);
  assert.match(timeControlsSrc, /select\[name="end_time"\]/);
  assert.match(timeControlsSrc, /setAttribute\('type', 'time'\)/);
  assert.match(timeControlsSrc, /setAttribute\('step', '60'\)/);
  assert.match(timeControlsSrc, /MutationObserver/);
});

test('end time keeps the start time as its minimum and preserves logical ordering', () => {
  assert.match(timeControlsSrc, /endInput\.min = start/);
  assert.match(timeControlsSrc, /previousEnd >= start/);
});
