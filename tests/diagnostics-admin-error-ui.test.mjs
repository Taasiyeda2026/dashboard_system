import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('dashboard diagnostics shows detailed admin error payload fields', async () => {
  const source = readFileSync(new URL('../frontend/src/screens/dashboard.js', import.meta.url), 'utf8');
  assert.match(source, /JSON\.parse\(rawMessage\)/);
  assert.match(source, /errorCode:/);
  assert.match(source, /functionName:/);
  assert.match(source, /month:/);
  assert.doesNotMatch(source, /שגיאת שרת — נסו שוב מאוחר יותר/);
});
