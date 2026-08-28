import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const polishSource = await readFile(new URL('../attendance/src/professional-polish.js', import.meta.url), 'utf8');

test('Attendance attachment label removes optional wording in the rendered UI', () => {
  assert.match(polishSource, /מסמכים מצורפים \(אופציונלי\)/);
  assert.match(polishSource, /node\.textContent = 'מסמכים מצורפים'/);
});
