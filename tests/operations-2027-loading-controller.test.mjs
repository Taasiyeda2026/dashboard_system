import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  TAB_LOAD_STATES,
  buildCourseTrainingAssignedPairs,
  createOperations2027Store,
  disposeOperations2027LoadingCache,
  getOperations2027Store,
  loadOperations2027Source,
  loadOperations2027Tab,
  patchPrintKitDelivery,
  patchPrintKitReturn,
  patchPrintKitStock
} from '../frontend/src/screens/operations-2027-loading-controller.js';

const source = await readFile(new URL('../frontend/src/screens/operations-2027-loading-controller.js', import.meta.url), 'utf8');
const wrapper = await readFile(new URL('../frontend/src/screens/operations-authorities-cleanup.js', import.meta.url), 'utf8');
const matrixEntry = await readFile(new URL('../frontend/src/screens/operations-summer-training-matrix.js', import.meta.url), 'utf8');

test('tab loading reuses one in-flight promise and cached result', async () => {
  disposeOperations2027LoadingCache();
  let calls = 0;
  let release;
  const deferred = new Promise((resolve) => { release = resolve; });
  const first = loadOperations2027Tab('tab-a', async () => {
    calls += 1;
    await deferred;
    return { ok: true };
  });
  const second = loadOperations2027Tab('tab-a', () => ({ ok: false }));
  assert.equal(first, second);
  assert.equal(getOperations2027Store().tabStates.get('tab-a'), TAB_LOAD_STATES.LOADING);
  release();
  assert.deepEqual(await first, { ok: true });
  assert.equal(calls, 1);
  assert.deepEqual(await loadOperations2027Tab('tab-a', () => ({ ok: false })), { ok: true });
  assert.equal(calls, 1);
});

test('shared source loading deduplicates and disposal creates a fresh store', async () => {
  disposeOperations2027LoadingCache();
  const before = getOperations2027Store();
  let calls = 0;
  const first = loadOperations2027Source('shared', async () => { calls += 1; return ['x']; });
  const second = loadOperations2027Source('shared', async () => { calls += 1; return ['y']; });
  assert.equal(first, second);
  assert.deepEqual(await first, ['x']);
  assert.equal(calls, 1);
  disposeOperations2027LoadingCache();
  assert.notEqual(getOperations2027Store(), before);
  assert.deepEqual(getOperations2027Store(), createOperations2027Store());
});

test('print-kit writes patch the local model without refetching', () => {
  const data = {
    inventoryRows: [{ course_id: 'c1', warehouse_quantity: 2, hila_quantity: 0, idan_quantity: 0, gil_quantity: 0 }],
    distributionRows: []
  };
  assert.equal(patchPrintKitStock(data, 'c1', 'warehouse', 3), true);
  assert.equal(data.inventoryRows[0].warehouse_quantity, 3);
  assert.equal(patchPrintKitDelivery(data, 'c1', 'מדריך א', 'warehouse'), true);
  assert.equal(data.inventoryRows[0].warehouse_quantity, 2);
  assert.equal(data.distributionRows.length, 1);
  assert.equal(patchPrintKitReturn(data, 'c1', 'מדריך א'), true);
  assert.equal(data.inventoryRows[0].warehouse_quantity, 3);
  assert.equal(data.distributionRows.length, 0);
});

test('course assignments use exact domain resolution and skip cancelled rows', () => {
  const courses = [{ id: 'c1', gefen_number: '100', short_name: 'רובוטיקה', full_name: 'רובוטיקה' }];
  const pairs = buildCourseTrainingAssignedPairs([
    { activity_type: 'course', activity_no: '100', instructor_name: 'מדריך א' },
    { activity_type: 'course', activity_no: '100', instructor_name: 'מדריך ב', status: 'בוטל' },
    { activity_type: 'course', activity_name: 'רובוט', instructor_name: 'מדריך ג' }
  ], courses);
  assert.deepEqual([...pairs], ['c1::מדריך א']);
});

test('the active Operations 2027 path has one controller and no observer, timeout, TTL or operational storage cache', () => {
  assert.match(wrapper, /operations-2027-loading-controller\.js/);
  assert.doesNotMatch(wrapper, /operations-2027-training-kit-history-fix\.js/);
  assert.doesNotMatch(wrapper, /operations-2027-custom-tabs-click-fix\.js/);
  assert.doesNotMatch(wrapper, /operations-2027-table-layout-fix\.js/);
  assert.doesNotMatch(wrapper, /operations-2027-training-assignment-fix\.js/);
  assert.match(matrixEntry, /operations-2027-loading-controller\.js/);
  assert.doesNotMatch(source, /MutationObserver/);
  assert.doesNotMatch(source, /setTimeout/);
  assert.doesNotMatch(source, /TTL/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
  assert.doesNotMatch(source, /invalidateOperations2027Tab/);
});

test('approved views are rendered directly and do not need DOM transposition or cleanup', () => {
  assert.match(source, /rows: data\.workshops,[\s\S]*columns: data\.instructors/);
  assert.match(source, /rows: data\.instructors,[\s\S]*columns: data\.courses/);
  assert.match(source, /מלאי ערכות/);
  assert.match(source, /מדריכים פעילים/);
  assert.match(source, /מדריכים לא פעילים שמחזיקים ערכה/);
  assert.doesNotMatch(source, /סיכום צורך בערכות/);
  assert.doesNotMatch(source, /<h2[^>]*>ערכות דפוס/);
});
