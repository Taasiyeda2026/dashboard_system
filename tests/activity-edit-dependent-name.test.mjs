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

test('entering edit preserves the existing activity name and only a genuine type change resets it', async () => {
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
    assert.equal(root.querySelector('[data-activity-no]').value, 'W-1');

    root.querySelector('[data-action="start-edit"]').click();
    assert.equal(nameSelect.value, 'סדנת רובוטיקה');
    typeSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.equal(nameSelect.value, 'סדנת רובוטיקה');
    assert.equal(root.querySelector('[data-activity-no]').value, 'W-1');

    typeSelect.value = 'tour';
    typeSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

    assert.equal(nameSelect.value, '');
    assert.deepEqual(Array.from(nameSelect.options).map((opt) => opt.value), ['', 'סיור מוזיאון']);
    assert.equal(root.querySelector('[data-activity-no]').value, '');
  } finally {
    globalThis.AbortController = previousAbortController;
  }
});

test('legacy fallback name is injected and selected without replacing its activity number', async () => {
  installStorageMocks();
  const { bindActivityEditForm } = await import('../frontend/src/screens/shared/bind-activity-edit-form.js');
  const html = activityWorkDrawerHtml({
    RowID: 'LEGACY-1',
    source_sheet: 'activities',
    activity_type: 'course',
    item_type: 'course',
    program_name: 'קורס מורשת שאינו בקטלוג',
    activity_no: 'LEGACY-77',
    status: 'פתוח'
  }, { canEdit: true, canDirectEdit: true, settings: { dropdown_options: { activity_names: [] } } });
  const dom = new JSDOM(`<main>${html}</main>`);
  const previousAbortController = globalThis.AbortController;
  globalThis.AbortController = dom.window.AbortController;
  try {
    const root = dom.window.document.querySelector('main');
    bindActivityEditForm(root, { api: {}, ui: {} });
    const nameSelect = root.querySelector('[data-role="activity-name-select"]');
    assert.equal(nameSelect.value, 'קורס מורשת שאינו בקטלוג');
    assert.equal(root.querySelector('[data-activity-no]').value, 'LEGACY-77');
    root.querySelector('[data-action="start-edit"]').click();
    assert.equal(nameSelect.value, 'קורס מורשת שאינו בקטלוג');
    assert.equal(root.querySelector('[data-activity-no]').value, 'LEGACY-77');
  } finally {
    globalThis.AbortController = previousAbortController;
  }
});

test('saving an unrelated note does not include or erase the selected course name', async () => {
  installStorageMocks();
  const { bindActivityEditForm } = await import('../frontend/src/screens/shared/bind-activity-edit-form.js');
  const settings = { dropdown_options: { activity_names: [{ label: 'קורס קיים', activity_no: 'C-9', activity_type: 'course' }] } };
  const html = activityWorkDrawerHtml({ RowID: 'C-9', source_sheet: 'activities', activity_type: 'course', item_type: 'course', activity_name: 'קורס קיים', activity_no: 'C-9', status: 'פתוח', notes: 'ישן' }, { canEdit: true, canDirectEdit: true, settings });
  const dom = new JSDOM(`<main>${html}</main>`);
  const previousAbortController = globalThis.AbortController;
  globalThis.AbortController = dom.window.AbortController;
  let payload;
  try {
    const root = dom.window.document.querySelector('main');
    bindActivityEditForm(root, { api: { saveActivity: async (next) => { payload = next; return { row: { row_id: 'C-9', activity_name: 'קורס קיים', notes: 'חדש' } }; } }, ui: {} });
    root.querySelector('[data-action="start-edit"]').click();
    root.querySelector('[name="notes"]').value = 'חדש';
    root.querySelector('[data-action="save-edit"]').click();
    for (let i = 0; i < 20 && !payload; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(payload.changes.notes, 'חדש');
    assert.equal(Object.hasOwn(payload.changes, 'activity_name'), false);
    assert.equal(root.querySelector('[name="activity_name"]').value, 'קורס קיים');
    assert.equal(root.querySelector('[data-activity-no]').value, 'C-9');
  } finally {
    globalThis.AbortController = previousAbortController;
  }
});


test('changing a catalog course automatically resizes and extends weekly meeting dates', async () => {
  installStorageMocks();
  const { bindActivityEditForm } = await import('../frontend/src/screens/shared/bind-activity-edit-form.js');
  const settings = {
    dropdown_options: {
      activity_names: [
        { label: 'בינה מלאכותית', activity_no: '9545', gefen_number: '9545', activity_type: 'course', meetings_count: 8 },
        { label: 'ביומימיקרי', activity_no: '6089', gefen_number: '6089', activity_type: 'course', meetings_count: 11 }
      ]
    }
  };
  const row = {
    RowID: 'AUTO-DATES-1',
    source_sheet: 'activities',
    activity_type: 'course',
    item_type: 'course',
    activity_name: 'בינה מלאכותית',
    activity_no: '9545',
    gefen_number: '9545',
    sessions: 8,
    status: 'פתוח',
    date_1: '2026-10-08',
    date_2: '2026-10-15',
    date_3: '2026-10-22',
    date_4: '2026-10-29',
    date_5: '2026-11-05',
    date_6: '2026-11-12',
    date_7: '2026-11-19',
    date_8: '2026-11-26'
  };
  const dom = new JSDOM(`<main>${activityWorkDrawerHtml(row, { canEdit: true, canDirectEdit: true, settings })}</main>`);
  const previousAbortController = globalThis.AbortController;
  globalThis.AbortController = dom.window.AbortController;
  try {
    const root = dom.window.document.querySelector('main');
    bindActivityEditForm(root, { api: {}, ui: {} });
    root.querySelector('[data-action="start-edit"]').click();

    const nameSelect = root.querySelector('[data-role="activity-name-select"]');
    nameSelect.value = 'ביומימיקרי';
    nameSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

    const dates = [...root.querySelectorAll('[data-meeting-dates-edit] input[data-meeting-idx]')].map((input) => input.value);
    assert.equal(dates.length, 11);
    assert.deepEqual(dates.slice(8), ['2026-12-03', '2026-12-10', '2026-12-17']);
    assert.equal(root.querySelector('[data-computed-end-display]').textContent, '17/12/2026');
  } finally {
    globalThis.AbortController = previousAbortController;
  }
});

test('changing to a catalog course with fewer sessions removes trailing meeting dates', async () => {
  installStorageMocks();
  const { bindActivityEditForm } = await import('../frontend/src/screens/shared/bind-activity-edit-form.js');
  const settings = {
    dropdown_options: {
      activity_names: [
        { label: 'קורס 11', activity_no: 'C-11', activity_type: 'course', meetings_count: 11 },
        { label: 'קורס 8', activity_no: 'C-8', activity_type: 'course', meetings_count: 8 }
      ]
    }
  };
  const row = {
    RowID: 'AUTO-DATES-2',
    source_sheet: 'activities',
    activity_type: 'course',
    item_type: 'course',
    activity_name: 'קורס 11',
    activity_no: 'C-11',
    sessions: 11,
    status: 'פתוח',
    date_1: '2026-10-08',
    date_2: '2026-10-15',
    date_3: '2026-10-22',
    date_4: '2026-10-29',
    date_5: '2026-11-05',
    date_6: '2026-11-12',
    date_7: '2026-11-19',
    date_8: '2026-11-26',
    date_9: '2026-12-03',
    date_10: '2026-12-10',
    date_11: '2026-12-17'
  };
  const dom = new JSDOM(`<main>${activityWorkDrawerHtml(row, { canEdit: true, canDirectEdit: true, settings })}</main>`);
  const previousAbortController = globalThis.AbortController;
  globalThis.AbortController = dom.window.AbortController;
  try {
    const root = dom.window.document.querySelector('main');
    bindActivityEditForm(root, { api: {}, ui: {} });
    root.querySelector('[data-action="start-edit"]').click();

    const nameSelect = root.querySelector('[data-role="activity-name-select"]');
    nameSelect.value = 'קורס 8';
    nameSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

    const dates = [...root.querySelectorAll('[data-meeting-dates-edit] input[data-meeting-idx]')].map((input) => input.value);
    assert.equal(dates.length, 8);
    assert.equal(dates.at(-1), '2026-11-26');
    assert.equal(root.querySelector('[data-computed-end-display]').textContent, '26/11/2026');
  } finally {
    globalThis.AbortController = previousAbortController;
  }
});
