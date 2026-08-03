import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const approvedFix = await readFile(
  new URL('../frontend/src/proposal-next-year-approved-fix.js', import.meta.url),
  'utf8'
);
const editorStability = await readFile(
  new URL('../frontend/src/proposal-next-year-editor-stability.js', import.meta.url),
  'utf8'
);
const selectionHydration = await readFile(
  new URL('../frontend/src/proposal-next-year-selection-hydration.js', import.meta.url),
  'utf8'
);

const count = (source, pattern) => source.split(pattern).length - 1;

function sliceBetween(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing start marker: ${start}`);
  assert.notEqual(to, -1, `missing end marker: ${end}`);
  return source.slice(from, to);
}

test('mixed next-year editor keeps one hydration and totals owner', () => {
  assert.match(editorStability, /proposalNextYearEditorStability\.v3/);
  assert.doesNotMatch(editorStability, /calculateFormTotals/);
  assert.doesNotMatch(editorStability, /dispatchEvent\s*\(\s*new Event\s*\(\s*['"]input/);
  assert.match(editorStability, /scheduleForm\(addForm, \{ removeBlankRows: false \}\)/);
  assert.match(editorStability, /forms\.forEach\(\(form\) => scheduleForm\(form, \{ removeBlankRows: false \}\)\)/);

  const editorClickHandler = sliceBetween(
    editorStability,
    "documentRef.addEventListener('click'",
    "documentRef.addEventListener('change'"
  );
  assert.doesNotMatch(editorClickHandler, /event\.preventDefault/);
  assert.doesNotMatch(editorClickHandler, /event\.stopImmediatePropagation/);

  assert.match(selectionHydration, /proposalNextYearSelectionHydration\.v3/);
  assert.match(selectionHydration, /function pickedFromOptionValue/);
  assert.match(selectionHydration, /queueMicrotask\(\(\) =>/);
  assert.match(selectionHydration, /scheduleTotals\(form, 80\)/);
  assert.doesNotMatch(selectionHydration, /dispatchEvent\s*\(\s*new Event\s*\(\s*['"]input/);
  assert.equal(count(selectionHydration, 'export function calculateNextYearTotals'), 1);
});

test('mixed next-year document keeps separate course and workshop tables', () => {
  assert.match(approvedFix, /INSTALL_KEY = Symbol\.for\('taasiyeda\.nextYearMixedProposalTables\.v3'\)/);
  assert.match(approvedFix, /if \(!courses\.length \|\| !workshops\.length\)/);
  assert.match(approvedFix, /courseTableHtml\(courses\)/);
  assert.match(approvedFix, /workshopTableHtml\(workshops\)/);
  assert.match(approvedFix, /pa-next-year-combined-total/);
  assert.match(approvedFix, /if \(refreshRunning\) return/);
  assert.equal(count(approvedFix, "document.addEventListener('change'"), 1);
  assert.equal(count(approvedFix, "document.addEventListener('input'"), 1);
  assert.equal(count(approvedFix, "document.addEventListener('click'"), 1);
});
