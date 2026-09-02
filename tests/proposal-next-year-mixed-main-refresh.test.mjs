import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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

test('mixed next-year editor preserves new rows and guards hydration notifications', () => {
  assert.match(editorStability, /proposalNextYearEditorStability\.v6/);
  // Totals must have exactly one owner: editor-stability delegates to the
  // canonical calculator instead of keeping its own duplicate re-implementation
  // (that duplication is what let next-year totals drift out of sync with the
  // selected option's price - see proposal-next-year-selection-hydration.js).
  assert.match(editorStability, /import \{ calculateNextYearTotals \} from '\.\/proposal-next-year-selection-hydration\.js';/);
  assert.doesNotMatch(editorStability, /function calculateFormTotals/);
  assert.doesNotMatch(editorStability, /function calculateRow/);
  assert.match(editorStability, /paNextYearHydrating/);
  assert.match(editorStability, /scheduleForm\(addForm, \{ removeBlankRows: false \}\)/);
  assert.match(editorStability, /forms\.forEach\(\(form\) => scheduleForm\(form, \{ removeBlankRows: false \}\)\)/);

  const editorClickHandler = sliceBetween(
    editorStability,
    "documentRef.addEventListener('click'",
    "documentRef.addEventListener('change'"
  );
  assert.doesNotMatch(editorClickHandler, /event\.preventDefault/);
  assert.doesNotMatch(editorClickHandler, /event\.stopImmediatePropagation/);

  assert.match(selectionHydration, /proposalNextYearSelectionHydration\.v6/);
  assert.match(selectionHydration, /paNextYearDirectHydration/);
  assert.match(selectionHydration, /item_source_pricing_key/);
  assert.match(selectionHydration, /scheduleTotals\(form, 100\)/);
  assert.equal(count(selectionHydration, 'export function calculateNextYearTotals'), 1);
});

test('mixed next-year document replaces the complete cost group atomically without touching live editor preview', async () => {
  const source = await readFile(
    new URL('../frontend/src/proposal-next-year-approved-form.js', import.meta.url),
    'utf8'
  );
  assert.match(source, /INSTALL_KEY = Symbol\.for\('taasiyeda\.nextYearMixedProposalTables\.v7'\)/);
  assert.match(source, /if \(!courses\.length && !workshops\.length\) return/);
  assert.match(source, /closest\('\.pa-next-year-cost-group'\)/);
  assert.match(source, /region\.replaceWith\(wrapper\)/);
  assert.doesNotMatch(source, /clearNativeNextYearTables/);
  assert.match(source, /courseTableHtml\(courses\)/);
  assert.match(source, /workshopTableHtml\(workshops\)/);
  assert.match(source, /pa-next-year-combined-total/);
  assert.match(source, /pa-next-year-course-table/);
  assert.match(source, /pa-next-year-workshop-table/);
  assert.doesNotMatch(source, /pa-next-year-activities-table|data-pa-next-year-unified-table/);
  assert.match(source, /approvedNextYearNormalizing/);
  assert.match(source, /if \(refreshRunning\) return/);
  assert.match(source, /isEditorLivePreviewDocument/);
  assert.match(source, /closest\?\.\('\[data-pa-live-preview\]'\)/);
  assert.match(source, /containsNonEditorProposalDocument/);
  assert.match(source, /const editorMutation = event\.target\?\.closest\?\./);
  assert.match(source, /if \(editorMutation\) return/);
  assert.equal(count(source, "document.addEventListener('change'"), 1);
  assert.equal(count(source, "document.addEventListener('input'"), 1);
  assert.equal(count(source, "document.addEventListener('click'"), 1);
});