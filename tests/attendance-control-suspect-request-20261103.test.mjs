import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../frontend/src/screens/attendance-control.js', import.meta.url), 'utf8');

test('manager attendance comparison flags suspect clock-like cancellation', () => {
  assert.match(source, /const suspectCancellation = inlineRequest/);
  assert.match(source, /Number\(value\) >= 360/);
  assert.match(source, /דיווח חריג – נדרש תיקון/);
  assert.match(source, /suspectCancellation \|\| reviewStatus === 'pending_review'/);
  assert.match(source, /data-travel-review="approve" \$\{suspectCancellation \?/);
});
