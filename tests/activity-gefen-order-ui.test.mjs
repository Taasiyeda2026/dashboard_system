import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { activityCreateGefenValue, enhanceAddActivityGefenOrderUi, enhanceGefenOrderUi } from '../frontend/src/activity-drawer-gefen-order-ui.js';

function fixture({ gefenSelected = true, existsInGefen = false, exportedConfirmation } = {}) {
  const selectedGefen = gefenSelected ? ' selected' : '';
  const selectedOther = gefenSelected ? '' : ' selected';
  const checked = existsInGefen ? ' checked' : '';
  const exportData = {
    row_id: 'ACT-GEFEN-1',
    funding_sources: [gefenSelected ? { id: 'gefen', name: 'גפן' } : { id: 'other', name: 'רמי שני' }]
  };
  if (typeof exportedConfirmation === 'boolean') exportData.exists_in_gefen = exportedConfirmation;
  const row = JSON.stringify(exportData).replaceAll('&', '&amp;').replaceAll('"', '&quot;');

  return new JSDOM(`
    <div class="ds-drawer">
      <form data-drawer-form data-editing="no" data-export-row="${row}">
        <section data-activity-inline-core>
          <div class="activity-drawer-inline__field">
            <div class="activity-drawer-inline__label">גורם מימון</div>
            <div class="activity-drawer-inline__value">${gefenSelected ? 'גפן' : 'רמי שני'}</div>
            <div class="activity-drawer-inline__edit" data-mode="edit" hidden>
              <select name="funding_sources" multiple data-scheduling-multi>
                <option value="gefen"${selectedGefen}>גפן</option>
                <option value="other"${selectedOther}>רמי שני</option>
              </select>
            </div>
          </div>
        </section>
        <label class="activity-drawer__gefen-exists">
          <input type="checkbox" name="exists_in_gefen" data-gefen-exists-checkbox value="true"${checked} disabled>
          <span>מופיע בגפ״ן</span>
        </label>
      </form>
    </div>
  `, { url: 'https://example.test/' });
}

test('Gefen funding exposes an edit-only yes/no order choice and marks the funding cell when confirmed', () => {
  const dom = fixture({ gefenSelected: true, existsInGefen: true });
  const form = dom.window.document.querySelector('form');

  assert.equal(enhanceGefenOrderUi(form), true);
  const field = form.querySelector('.activity-drawer-inline__field');
  const control = form.querySelector('[data-gefen-order-control]');
  const choice = form.querySelector('[data-gefen-order-choice]');
  const checkbox = form.querySelector('[data-gefen-exists-checkbox]');

  assert.ok(control);
  assert.ok(field.querySelector('.activity-drawer-inline__edit').contains(control));
  assert.match(control.textContent, /האם קיימת הזמנה במערכת גפ״ן\?/);
  assert.deepEqual([...choice.options].map((option) => option.textContent), ['לא', 'כן']);
  assert.equal(control.dataset.gefenFunded, 'yes');
  assert.equal(choice.value, 'true');
  assert.equal(checkbox.checked, true);
  assert.equal(field.dataset.gefenOrderConfirmed, 'yes');
  assert.equal(form.querySelector('.activity-drawer__gefen-exists'), null);
});

test('an explicit exported confirmation is authoritative even if legacy checkbox markup is stale', () => {
  const dom = fixture({ gefenSelected: true, existsInGefen: false, exportedConfirmation: true });
  const form = dom.window.document.querySelector('form');

  enhanceGefenOrderUi(form);

  assert.equal(form.querySelector('[data-gefen-exists-checkbox]').checked, true);
  assert.equal(form.querySelector('[data-gefen-order-choice]').value, 'true');
  assert.equal(form.querySelector('.activity-drawer-inline__field').dataset.gefenOrderConfirmed, 'yes');
});

test('hydrates confirmation for a Gefen drawer when the list projection omitted exists_in_gefen', async () => {
  const dom = fixture({ gefenSelected: true, existsInGefen: false });
  const form = dom.window.document.querySelector('form');
  const loadedRowIds = [];

  enhanceGefenOrderUi(form, {
    loadConfirmation: async (rowId) => {
      loadedRowIds.push(rowId);
      return true;
    }
  });

  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(loadedRowIds, ['ACT-GEFEN-1']);
  assert.equal(form.querySelector('[data-gefen-exists-checkbox]').checked, true);
  assert.equal(form.querySelector('[data-gefen-order-choice]').value, 'true');
  assert.equal(form.querySelector('.activity-drawer-inline__field').dataset.gefenOrderConfirmed, 'yes');
});

test('non-Gefen funding keeps the order choice unavailable and never marks the funding cell', () => {
  const dom = fixture({ gefenSelected: false, existsInGefen: true });
  const form = dom.window.document.querySelector('form');

  enhanceGefenOrderUi(form);
  const field = form.querySelector('.activity-drawer-inline__field');
  const control = form.querySelector('[data-gefen-order-control]');

  assert.equal(control.dataset.gefenFunded, 'no');
  assert.equal(field.dataset.gefenOrderConfirmed, 'no');
});

test('changing Gefen funding during edit clears stale confirmation and requires a fresh yes choice', async () => {
  const dom = fixture({ gefenSelected: false, existsInGefen: true });
  const form = dom.window.document.querySelector('form');
  enhanceGefenOrderUi(form);

  form.dataset.editing = 'yes';
  const funding = form.querySelector('[name="funding_sources"]');
  const gefenOption = funding.querySelector('option[value="gefen"]');
  const otherOption = funding.querySelector('option[value="other"]');
  const choice = form.querySelector('[data-gefen-order-choice]');
  const checkbox = form.querySelector('[data-gefen-exists-checkbox]');
  const control = form.querySelector('[data-gefen-order-control]');
  const field = form.querySelector('.activity-drawer-inline__field');

  gefenOption.selected = true;
  otherOption.selected = false;
  funding.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await Promise.resolve();

  assert.equal(control.dataset.gefenFunded, 'yes');
  assert.equal(checkbox.checked, false);
  assert.equal(choice.value, 'false');
  assert.equal(field.dataset.gefenOrderConfirmed, 'no');

  choice.value = 'true';
  choice.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(checkbox.checked, true);
  assert.equal(choice.value, 'true');
  assert.equal(field.dataset.gefenOrderConfirmed, 'yes');

  gefenOption.selected = false;
  otherOption.selected = true;
  funding.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await Promise.resolve();

  assert.equal(control.dataset.gefenFunded, 'no');
  assert.equal(checkbox.checked, false);
  assert.equal(choice.value, 'false');
  assert.equal(field.dataset.gefenOrderConfirmed, 'no');
});

test('add activity shows and resets the shared Gefen order choice as funding changes', async () => {
  const dom = new JSDOM(`<form data-add-activity-form>
    <fieldset data-funding-picker>
      <label><input type="checkbox" data-funding-source-id="gefen" data-funding-name="גפ״ן"><span>גפ״ן</span></label>
      <label><input type="checkbox" data-funding-source-id="other" data-funding-name="רמי שני"><span>רמי שני</span></label>
    </fieldset>
    <div data-add-gefen-order-host hidden><input type="checkbox" name="exists_in_gefen" value="true" data-gefen-exists-checkbox hidden></div>
  </form>`, { url: 'https://example.test/' });
  const form = dom.window.document.querySelector('form');
  const gefen = form.querySelector('[data-funding-source-id="gefen"]');
  const other = form.querySelector('[data-funding-source-id="other"]');

  assert.equal(enhanceAddActivityGefenOrderUi(form), true);
  const host = form.querySelector('[data-add-gefen-order-host]');
  const choice = form.querySelector('[data-gefen-order-choice]');
  assert.equal(host.hidden, true);
  assert.equal(activityCreateGefenValue(form), false);

  gefen.checked = true;
  gefen.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await Promise.resolve();
  assert.equal(host.hidden, false);
  assert.equal(choice.value, 'false');

  choice.value = 'true';
  choice.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(activityCreateGefenValue(form), true);

  other.checked = true;
  other.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await Promise.resolve();
  assert.equal(host.hidden, false);
  assert.equal(activityCreateGefenValue(form), true);

  gefen.checked = false;
  gefen.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await Promise.resolve();
  assert.equal(host.hidden, true);
  assert.equal(form.querySelector('[data-gefen-exists-checkbox]').checked, false);
  assert.equal(activityCreateGefenValue(form), false);
});
