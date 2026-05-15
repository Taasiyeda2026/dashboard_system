import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  MIN_SEARCH_CHARS,
  SEARCH_DEBOUNCE_MS,
  applyLocalFilters,
  bindLocalFilters,
  ensureActivityListFilters,
  prepareRowsForSearch
} from '../frontend/src/screens/shared/activity-list-filters.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('local activity filters search from the first Hebrew character on prepared rows', () => {
  const rows = prepareRowsForSearch([
    { RowID: 11, activity_name: 'כדורגל', authority: 'חיפה', school: 'אלון', instructor_name: 'דנה' },
    { RowID: 12, activity_name: 'מחול', authority: 'נתניה', school: 'ברוש', instructor_name: 'נועה' }
  ], ['RowID', 'activity_name', 'authority', 'school', 'instructor_name']);

  assert.equal(MIN_SEARCH_CHARS, 1);
  assert.deepEqual(
    applyLocalFilters(rows, { appliedQ: 'כ' }).map((row) => row.RowID),
    [11]
  );
  assert.deepEqual(
    applyLocalFilters(rows, { appliedQ: 'ני' }).map((row) => row.RowID),
    [12]
  );
});

test('existing one-character query is preserved as applied search state', () => {
  const state = { listFilters: { activities: { q: 'ד', visibleCount: 200 } } };
  const filters = ensureActivityListFilters(state, 'activities');

  assert.equal(filters.appliedQ, 'ד');
});

test('bindLocalFilters debounces one-character searches locally without calling external loaders', async () => {
  const dom = new JSDOM('<div><input data-filter-search="activities" value=""><button data-filter-clear="activities"></button></div>');
  const root = dom.window.document.querySelector('div');
  const input = root.querySelector('[data-filter-search="activities"]');
  const state = {};
  let renderCount = 0;
  let loaderCount = 0;

  bindLocalFilters(root, state, 'activities', () => {
    renderCount += 1;
  }, { debounceMs: 150, onClear: () => { loaderCount += 1; } });

  input.value = 'א';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

  assert.equal(state.listFilters.activities.q, 'א');
  assert.equal(state.listFilters.activities.appliedQ, '');
  assert.equal(renderCount, 0);
  assert.equal(loaderCount, 0);

  await sleep(SEARCH_DEBOUNCE_MS + 40);

  assert.equal(state.listFilters.activities.appliedQ, 'א');
  assert.equal(renderCount, 1);
  assert.equal(loaderCount, 0);
});
