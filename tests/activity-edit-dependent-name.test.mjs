import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { activityWorkDrawerHtml } from '../frontend/src/screens/shared/activity-detail-html.js';

function installStorageMocks() {
  if (!globalThis.sessionStorage) {
    const sessionStore = new Map();
    globalThis.sessionStorage = {
      getItem: (key) => sessionStore.has(key) ? sessionStore.get(key) : null,
      setItem: (key, value) => sessionStore.set(key, String(value)),
      removeItem: (key) => sessionStore.delete(key),
      clear: () => sessionStore.clear()
    };
  }
  if (!globalThis.localStorage) {
    const localStore = new Map();
    globalThis.localStorage = {
      getItem: (key) => localStore.has(key) ? localStore.get(key) : null,
      setItem: (key, value) => localStore.set(key, String(value)),
      removeItem: (key) => localStore.delete(key),
      clear: () => localStore.clear()
    };
  }
}

test('activity edit loads type before filtered name and resets name when type changes', async () => {
  installStorageMocks();
  const { bindActivityEditForm } = await import('../frontend/src/screens/shared/bind-activity-edit-form.js');
  const settings = {
    one_day_activity_types: ['workshop', 'tour'],
    program_activity_types: ['course'],
    dropdown_options: {
      activity_names: [
        { label: 'סדנת רובוטיקה', activity_no: 'W-1', activity_type: 'workshop' },
        { label: 'סיור מוזיאון', activity_no: 'T-1', activity_type: 'tour' },
        { label: 'קורס תכנות', activity_no: 'C-1', activity_type: 'course' }
      ]
    }
  };
  const html = activityWorkDrawerHtml({
    RowID: 'A-1',
    source_sheet: 'activities',
    activity_type: 'workshop',
    item_type: 'workshop',
    activity_name: 'סדנת רובוטיקה',
    activity_no: 'W-1',
    status: 'פתוח'
  }, { canEdit: true, canDirectEdit: true, settings });
  const dom = new JSDOM(`<main>${html}</main>`);
  const previousAbortController = globalThis.AbortController;
  globalThis.AbortController = dom.window.AbortController;
  try {
    const root = dom.window.document.querySelector('main');
    bindActivityEditForm(root, { api: {}, ui: {} });

    const typeSelect = root.querySelector('select[name="activity_type"]');
    const nameSelect = root.querySelector('[data-role="activity-name-select"]');
    assert.ok(typeSelect.compareDocumentPosition(nameSelect) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.equal(typeSelect.value, 'workshop');
    assert.deepEqual(Array.from(nameSelect.options).map((opt) => opt.value), ['', 'סדנת רובוטיקה']);
    assert.equal(nameSelect.value, 'סדנת רובוטיקה');

    typeSelect.value = 'tour';
    typeSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

    assert.equal(nameSelect.value, '');
    assert.deepEqual(Array.from(nameSelect.options).map((opt) => opt.value), ['', 'סיור מוזיאון']);
    assert.equal(root.querySelector('[data-activity-no]').value, '');
  } finally {
    globalThis.AbortController = previousAbortController;
  }
});
