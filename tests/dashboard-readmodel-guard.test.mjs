import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync(new URL('../frontend/src/screens/dashboard.js', import.meta.url), 'utf8');

test('dashboard screen load uses dashboardSnapshot and not legacy dashboard api', () => {
  assert.match(dashboard, /api\.dashboardSnapshot\(\{ month: ym \}\)/);
  assert.doesNotMatch(dashboard, /api\.dashboardSheet\(/);
  assert.doesNotMatch(dashboard, /api\.dashboard\(/);
});

test('dashboard month navigation uses dashboardSnapshot for next month', () => {
  assert.match(dashboard, /api\.dashboardSnapshot\(\{ month: nextYm \}\)/);
});
