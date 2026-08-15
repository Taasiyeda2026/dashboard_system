import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('operations activity projection includes declared sessions required by work-schedule readiness', () => {
  const source = fs.readFileSync(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
  const match = source.match(/const ACTIVITY_OPERATIONS_COLUMNS = \[([\s\S]*?)\]\.join\(','\);/);
  assert.ok(match, 'ACTIVITY_OPERATIONS_COLUMNS block must exist');
  assert.match(match[1], /'sessions'/, 'work-schedule activity rows must include sessions');
});
