import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../frontend/src/screens/exceptions.js', import.meta.url), 'utf8');

test('exception district aliases are consolidated under the three canonical district names', () => {
  for (const pair of [
    "['צפון', 'מחוז צפון']",
    "['הצפון', 'מחוז צפון']",
    "['דרום', 'מחוז דרום']",
    "['הדרום', 'מחוז דרום']",
    "['מרכז', 'מחוז מרכז']",
    "['המרכז', 'מחוז מרכז']"
  ]) {
    assert.ok(source.includes(pair), `missing district alias ${pair}`);
  }
  assert.ok(source.includes("const EXCEPTION_DISTRICT_ORDER = ['מחוז צפון', 'מחוז דרום', 'מחוז מרכז'];"));
  assert.ok(source.includes('exceptionDistrictSortIndex(a[0]) - exceptionDistrictSortIndex(b[0])'));
});
