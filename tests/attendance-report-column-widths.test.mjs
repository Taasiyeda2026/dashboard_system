import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../attendance/src/styles/reports-table-polish.css', import.meta.url), 'utf8');

test('desktop report table gives more room to actions and trims school and authority', () => {
  assert.match(css, /minmax\(0,\s*1\.18fr\)\s*\/\* school/);
  assert.match(css, /minmax\(0,\s*\.92fr\)\s*\/\* authority/);
  assert.match(css, /minmax\(118px,\s*1\.12fr\)\s*!important;\s*\/\* actions/);
});
