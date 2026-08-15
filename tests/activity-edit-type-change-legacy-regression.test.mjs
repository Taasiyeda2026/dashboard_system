import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { activityWorkDrawerHtml } from '../frontend/src/screens/shared/activity-detail-html.js';

function installStorageMocks() {
  const createStorage = () => {
    const store = new Map();
    return {
      getItem: (key) => store.has(key) ? store.get(key) : null,
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
      clear: () => store.clear()
    };
  };
  if (!globalThis.sessionStorage) globalThis.sessionStorage = createStorage();
  if (!globalThis.localStorage) globalThis.localStorage = createStorage();
}

test('legacy name and activity_no are cleared when both drawer type-change listeners are active', async () => {
  installStorageMocks();
  globalThis.__ACTIVITY_DRAWER_EDIT_DEDUP_TEST__ = true;
  const { polishActivityDrawerEditOptions } = await import('../frontend/src/activity-drawer-edit-dedup.js');
  const { bindActivityEditForm } = await import('../frontend/src/screens/shared/bind-activity-edit-form.js');

  const settings = {
    dropdown_options: {
      activity_names: [
        { label: 'קורס חדש', activity_no: 'C-1', activity_type: 'course' },
        { label: 'סיור חדש', activity_no: 'T-1', activity_type: 'tour' }
      ]
    }
  };
  const html = activityWorkDrawerHtml({
    RowID: 'LEGACY-TYPE-1',
    source_sheet: 'activities',
    activity_type: 'course',
    item_type: 'course',
    program_name: 'קורס מורשת ישן',
    activity_no: 'LEGACY-77',
    status: 'פתוח'
  }, { canEdit: true, canDirectEdit: true, settings });

  const dom = new JSDOM(`<main>${html}</main>`);
  const previousAbortController = globalThis.AbortController;
  globalThis.AbortController = dom.window.AbortController;
  try {
    const root = dom.window.document.querySelector('main');
    const form = root.querySelector('[data-drawer-form]');
    form.setAttribute('data-activity-drawer-inline-layout', 'true');

    // Register the polish listener first, matching the ordering that previously
    // allowed it to advance the shared marker before the form listener ran.
    assert.equal(polishActivityDrawerEditOptions(form, settings), true);
    bindActivityEditForm(root, { api: {}, ui: {} });

    root.querySelector('[data-action="start-edit"]').click();
    const typeSelect = form.querySelector('[name="activity_type"]');
    const nameSelect = form.querySelector('[data-role="activity-name-select"]');
    const activityNo = form.querySelector('[data-activity-no]');

    assert.equal(nameSelect.value, 'קורס מורשת ישן');
    assert.equal(activityNo.value, 'LEGACY-77');

    typeSelect.value = 'tour';
    typeSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

    assert.equal(nameSelect.value, '');
    assert.equal(activityNo.value, '');
    assert.deepEqual(
      Array.from(nameSelect.options).map((option) => option.value),
      ['', 'סיור חדש']
    );
  } finally {
    globalThis.AbortController = previousAbortController;
    dom.window.close();
  }
});
