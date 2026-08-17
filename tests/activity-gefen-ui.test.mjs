import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const bootstrapDom = new JSDOM('', { url: 'https://example.test/' });
globalThis.window = bootstrapDom.window;
globalThis.document = bootstrapDom.window.document;
globalThis.sessionStorage = bootstrapDom.window.sessionStorage;
globalThis.localStorage = bootstrapDom.window.localStorage;

const { activityWorkDrawerHtml } = await import('../frontend/src/screens/shared/activity-detail-html.js');
const { bindActivityEditForm } = await import('../frontend/src/screens/shared/bind-activity-edit-form.js');

const settings = {
  dropdown_options: {
    activity_names: [{ label: 'קורס בדיקה', activity_no: 'GF-1', activity_type: 'course' }],
    funding_source_records: [{ id: 'source-1', name: 'גורם מרכזי' }]
  },
  program_activity_types: ['course']
};

function drawer(row, permissions = { canEdit: true, canDirectEdit: true }) {
  return new JSDOM(`<main id="root">${activityWorkDrawerHtml({
    RowID: 'activity-1',
    activity_type: 'course',
    activity_name: 'קורס בדיקה',
    activity_no: 'GF-1',
    status: 'פתוח',
    activity_season: 'school_2027',
    funding: 'ערך היסטורי',
    is_gefen_funded: true,
    gefen_order_number: 'ORDER-OLD',
    funding_sources: [{ id: 'source-1', name: 'גורם מרכזי' }],
    ...row
  }, { settings, ...permissions })}</main>`, { url: 'https://example.test/' });
}

test('activity drawer shows one compact exists-in-GEFEN checkbox beside central funding and no operational GEFEN fields', () => {
  const dom = drawer({ exists_in_gefen: true });
  const root = dom.window.document.querySelector('#root');
  const checkbox = root.querySelector('[data-gefen-exists-checkbox]');

  assert.ok(checkbox);
  assert.equal(root.querySelectorAll('[data-gefen-exists-checkbox]').length, 1);
  assert.equal(checkbox.name, 'exists_in_gefen');
  assert.equal(checkbox.checked, true);
  assert.equal(checkbox.disabled, true);
  assert.match(checkbox.closest('section').textContent, /גורם מימון[\s\S]*מופיע בגפ״ן/);
  assert.doesNotMatch(root.textContent, /מימון גפ״ן|קיים בגפ״ן|מספר הזמנת גפ״ן/);
  assert.equal(root.querySelector('[name="is_gefen_funded"]'), null);
  assert.equal(root.querySelector('[name="gefen_order_number"]'), null);
  assert.ok(root.querySelector('[name="funding_sources"]'));
});

test('editing the GEFEN appearance checkbox saves only exists_in_gefen and respects read-only mode', async () => {
  const dom = drawer({ exists_in_gefen: false });
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    AbortController: globalThis.AbortController
  };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.AbortController = dom.window.AbortController;
  const saved = [];

  try {
    const root = dom.window.document.querySelector('#root');
    bindActivityEditForm(root, {
      api: { saveActivity: async (payload) => {
        saved.push(payload);
        return { row: { row_id: 'activity-1', ...payload.changes } };
      } }
    });
    root.querySelector('[data-action="start-edit"]').click();
    const checkbox = root.querySelector('[data-gefen-exists-checkbox]');
    assert.equal(checkbox.disabled, false);
    checkbox.checked = true;
    root.querySelector('[data-action="save-edit"]').click();
    await new Promise((resolve) => dom.window.setTimeout(resolve, 20));

    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0].changes, { exists_in_gefen: true });
    assert.equal(Object.hasOwn(saved[0].changes, 'funding'), false);
    assert.equal(Object.hasOwn(saved[0].changes, 'is_gefen_funded'), false);
    assert.equal(Object.hasOwn(saved[0].changes, 'gefen_order_number'), false);
  } finally {
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.AbortController = previous.AbortController;
  }

  const readOnly = drawer({ exists_in_gefen: true }, { canEdit: false, canDirectEdit: false });
  const readOnlyCheckbox = readOnly.window.document.querySelector('[data-gefen-exists-checkbox]');
  assert.ok(readOnlyCheckbox.checked);
  assert.ok(readOnlyCheckbox.disabled);
  assert.equal(readOnly.window.document.querySelector('[data-action="start-edit"]'), null);
});
