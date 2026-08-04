import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOperationalDistrict } from '../frontend/src/screens/shared/district-normalization.js';

const cases = [
  ['מחוז צפון', 'צפון'],
  ['הצפון', 'צפון'],
  ['מחוז דרום', 'דרום'],
  ['הדרום', 'דרום'],
  ['מחוז מרכז', 'מרכז'],
  ['המרכז', 'מרכז'],
  ['ירושלים', 'מרכז'],
  ['אזור יהודה והשומרון', 'מרכז']
];

for (const [input, expected] of cases) {
  test(`normalizes ${input} to ${expected}`, () => {
    assert.equal(normalizeOperationalDistrict(input), expected);
  });
}

test('unknown district does not get invented', () => {
  assert.equal(normalizeOperationalDistrict('מחוז לא ידוע'), '');
});
