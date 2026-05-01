import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('dashboard diagnostics emergency hotfix removes admin diagnostics error surface', async () => {
  const source = readFileSync(new URL('../frontend/src/screens/dashboard.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /JSON\.parse\(rawMessage\)|errorCode:|functionName:|data-stage2c/);
});
