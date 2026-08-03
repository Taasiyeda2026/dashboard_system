import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const APPROVED_FIX = new URL('../frontend/src/proposal-next-year-approved-fix.js', import.meta.url);
const SELECTION = new URL('../frontend/src/proposal-next-year-selection-hydration.js', import.meta.url);
const STABILITY = new URL('../frontend/src/proposal-next-year-editor-stability.js', import.meta.url);

test('mixed next-year preview classifies item metadata before generic group and renders two tables', async () => {
  const source = await readFile(APPROVED_FIX, 'utf8');
  const itemTypeCheck = source.indexOf("if (/סדנ|workshop/.test(itemType)");
  const groupCheck = source.indexOf('if (group === WORKSHOP_GROUP');
  assert.ok(itemTypeCheck >= 0 && groupCheck > itemTypeCheck);
  assert.match(source, /pa-next-year-course-table/);
  assert.match(source, /pa-next-year-workshop-table/);
  assert.match(source, /if \(!courses\.length \|\| !workshops\.length\)/);
  assert.match(source, /approvedNextYearSignature/);
});

test('runtime uses one next-year selection and totals owner without synthetic event loops', async () => {
  const [selection, stability] = await Promise.all([
    readFile(SELECTION, 'utf8'),
    readFile(STABILITY, 'utf8')
  ]);
  assert.match(selection, /addEventListener\('change',[\s\S]*true\);/);
  assert.match(selection, /hydrateNextYearPricingSelection\(row, cachedPricingRows, \{ notify: false \}\)/);
  assert.match(selection, /calculateNextYearTotals/);
  assert.match(selection, /dispatchEvent\(new Event\('input'/);
  assert.match(stability, /stabilizeNextYearForm\(form, cachedPricingRows, \{ \.\.\.options, notify: false \}\)/);
  assert.doesNotMatch(stability, /event\.target\?\.matches\?\.\('\[data-pa-pricing-select\]'\)/);
  assert.match(stability, /ensurePricingOptions/);
  assert.match(stability, /removeBlankNextYearRows/);
});
