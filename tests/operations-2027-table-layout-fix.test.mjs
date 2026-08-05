import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const wrapperUrl = new URL('../frontend/src/screens/operations-authorities-cleanup.js', import.meta.url);
const layoutUrl = new URL('../frontend/src/screens/operations-2027-table-layout-fix.js', import.meta.url);
const clickFixUrl = new URL('../frontend/src/screens/operations-2027-custom-tabs-click-fix.js', import.meta.url);

const [wrapperSource, layoutSource, clickFixSource] = await Promise.all([
  readFile(wrapperUrl, 'utf8'),
  readFile(layoutUrl, 'utf8'),
  readFile(clickFixUrl, 'utf8')
]);

test('the compact layout fix is loaded after the custom tab click repair', () => {
  assert.match(wrapperSource, /operations-2027-table-layout-fix\.js/);
  assert.ok(
    wrapperSource.indexOf('operations-2027-table-layout-fix.js')
      > wrapperSource.indexOf('operations-2027-custom-tabs-click-fix.js')
  );
});

test('training and kit matrices are transposed to instructor rows and course columns', () => {
  assert.match(layoutSource, /function transposeMatrixTable/);
  assert.match(layoutSource, /corner\.textContent = 'שם מדריך'/);
  assert.match(layoutSource, /ops2027-table--transposed/);
  assert.match(layoutSource, /row\.appendChild\(sourceCell\)/);
  assert.match(layoutSource, /data-ops-custom-tab="summer_training_matrix"/);
  assert.match(layoutSource, /data-ops-custom-tab="course_training_matrix"/);
  assert.match(layoutSource, /data-ops-custom-tab="course_print_kits"/);
});

test('table titles are attached to their table shells', () => {
  assert.match(layoutSource, /ops2027-attached-title/);
  assert.match(layoutSource, /shell\.insertBefore\(caption, shell\.firstChild\)/);
  assert.match(layoutSource, /titleNode\.remove\(\)/);
});

test('status controls use only red and green symbols without colored bubbles', () => {
  assert.match(layoutSource, /background: transparent !important/);
  assert.match(layoutSource, /border-radius: 0 !important/);
  assert.match(layoutSource, /color: #15803d !important/);
  assert.match(layoutSource, /color: #dc2626 !important/);
  assert.match(layoutSource, /font-size: 18px !important/);
});

test('names and headers use compact fixed sizing', () => {
  assert.match(layoutSource, /font-size: 11px !important/);
  assert.match(layoutSource, /width: 136px !important/);
  assert.match(layoutSource, /width: 82px !important/);
  assert.match(layoutSource, /font-size: 10px !important/);
});

test('the technical 2027 marker cannot become visible', () => {
  assert.match(clickFixSource, /style\.setProperty\('display', 'none', 'important'\)/);
  assert.doesNotMatch(clickFixSource, /field\.className = 'ds-filter-field'/);
  assert.match(layoutSource, /data-ops-2027-runtime-marker/);
  assert.match(layoutSource, /display: none !important/);
});
