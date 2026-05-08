import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isEmptyValue, nonEmptyString } from '../frontend/src/utils/empty-value.js';

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');

test('frontend isEmptyValue covers null-like spreadsheet values', () => {
  for (const value of [null, undefined, '', '   ', '\t', 'NULL', 'null', ' undefined ', '\u00A0']) {
    assert.equal(isEmptyValue(value), true, `${String(value)} should be empty`);
    assert.equal(nonEmptyString(value), '');
  }
  assert.equal(isEmptyValue('0'), false);
  assert.equal(nonEmptyString(' value '), 'value');
});

test('backend exposes a single isEmptyValue_ helper and keeps backward-compatible alias', async () => {
  const src = await read('OLD-GAS/helpers.gs');
  assert.match(src, /function isEmptyValue_\(value\)/);
  assert.match(src, /function isNormalizedEmptyValue_\(value\) \{\n  return isEmptyValue_\(value\);\n\}/);
  assert.match(src, /compact === 'null'/);
  assert.match(src, /compact === 'undefined'/);
});

test('exception calculations use isEmptyValue_ for instructors and start dates', async () => {
  const actions = await read('OLD-GAS/actions.gs');
  const api = await read('frontend/src/api.js');
  assert.match(actions, /!isEmptyValue_\(row && row\.instructor_name\)/);
  assert.match(actions, /var rowHasStart = !isEmptyValue_\(row && row\.start_date\)/);
  assert.match(api, /function nullStr\(val\) \{\n  if \(isEmptyValue\(val\)\) return '';/);
  assert.match(api, /start_date\.eq\.NULL/);
});
