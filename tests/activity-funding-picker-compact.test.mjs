import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const {
  enhanceAddFundingPicker,
  enhanceEditFundingPicker,
  validateCourseFundingSplit
} = await import('../frontend/src/activity-funding-picker-compact.js');

function change(window, element) {
  element.dispatchEvent(new window.Event('change', { bubbles: true }));
}

function input(window, element) {
  element.dispatchEvent(new window.Event('input', { bubbles: true }));
}

test('add activity funding picker stays compact and syncs the existing hidden association inputs', () => {
  const dom = new JSDOM(`<!doctype html><body><form>
    <fieldset data-funding-picker><legend>מימון</legend><div>
      <label><input type="checkbox" data-funding-source-id="a"><span>גפן</span><input type="number" data-funding-amount placeholder="סכום (רשות)"></label>
      <label><input type="checkbox" data-funding-source-id="b"><span>ויצו</span><input type="number" data-funding-amount placeholder="סכום (רשות)"></label>
      <label><input type="checkbox" data-funding-source-id="c"><span>רשויות החוף</span><input type="number" data-funding-amount placeholder="סכום (רשות)"></label>
    </div></fieldset>
  </form></body>`);
  const { document } = dom.window;
  const fieldset = document.querySelector('[data-funding-picker]');

  enhanceAddFundingPicker(fieldset);

  const host = fieldset.querySelector('[data-funding-compact-picker]');
  assert.ok(host);
  assert.equal(host.querySelectorAll('[data-funding-compact-select]').length, 1);
  assert.equal(host.querySelectorAll('input[type="checkbox"]').length, 0, 'checkbox list must not be visible in the compact UI');
  assert.doesNotMatch(host.textContent, /סכום \(רשות\)/);
  assert.match(host.textContent, /גורם מימון 1/);

  let selects = host.querySelectorAll('[data-funding-compact-select]');
  selects[0].value = 'a';
  change(dom.window, selects[0]);
  assert.equal(fieldset.querySelector('[data-funding-source-id="a"]').checked, true);
  assert.match(fieldset.querySelector('[data-funding-compact-picker]').textContent, /\+ הוסף גורם מימון/);

  fieldset.querySelector('[data-funding-compact-add]').click();
  const currentHost = fieldset.querySelector('[data-funding-compact-picker]');
  selects = currentHost.querySelectorAll('[data-funding-compact-select]');
  assert.equal(selects.length, 2);
  selects[1].value = 'b';
  change(dom.window, selects[1]);

  assert.equal(fieldset.querySelector('[data-funding-source-id="a"]').checked, true);
  assert.equal(fieldset.querySelector('[data-funding-source-id="b"]').checked, true);
  assert.equal(fieldset.querySelector('[data-funding-source-id="c"]').checked, false);

  const amounts = fieldset.querySelectorAll('[data-funding-compact-amount]');
  assert.equal(amounts.length, 2, 'amounts appear only when the activity has multiple funders');
  amounts[0].value = '5000';
  input(dom.window, amounts[0]);
  assert.equal(fieldset.querySelector('[data-funding-source-id="a"]').closest('label').querySelector('[data-funding-amount]').value, '5000');
});

test('course funding split must equal price and a single source remains implicit', () => {
  assert.deepEqual(validateCourseFundingSplit([{ amount: '' }], 7500), { valid: true, total: 7500 });
  assert.equal(validateCourseFundingSplit([{ amount: 4500 }, { amount: 3000 }], 7500).valid, true);
  assert.equal(validateCourseFundingSplit([{ amount: 4500 }, { amount: 2500 }], 7500).valid, false);
  assert.equal(validateCourseFundingSplit([{ amount: '' }, { amount: 7500 }], 7500).valid, false);
});

test('single funding selection does not show an amount field by default', () => {
  const dom = new JSDOM(`<!doctype html><body><form>
    <fieldset data-funding-picker><legend>מימון</legend><div>
      <label><input type="checkbox" data-funding-source-id="a" checked><span>גפן</span><input type="number" data-funding-amount></label>
      <label><input type="checkbox" data-funding-source-id="b"><span>ויצו</span><input type="number" data-funding-amount></label>
    </div></fieldset>
  </form></body>`);
  const fieldset = dom.window.document.querySelector('[data-funding-picker]');
  enhanceAddFundingPicker(fieldset);
  assert.equal(fieldset.querySelectorAll('[data-funding-compact-amount]').length, 0);
  assert.equal(fieldset.querySelector('[data-funding-compact-select]').value, 'a');
});

test('edit activity uses the central picker and exposes persisted amounts only for a split', async () => {
  const dom = new JSDOM(`<!doctype html><body><form>
    <select name="funding_sources" multiple size="3" data-scheduling-multi>
      <option value="a" selected data-funding-amount="7500" data-initial-funding-amount="7500">גפן</option>
      <option value="b">ויצו</option>
      <option value="c">רשויות החוף</option>
    </select>
  </form></body>`);
  const { document } = dom.window;
  const form = document.querySelector('form');
  const native = document.querySelector('select[name="funding_sources"]');
  enhanceEditFundingPicker(native);

  assert.equal(native.hasAttribute('hidden'), false, 'native multi-select must remain readable by the existing save binder');
  assert.equal(native.classList.contains('ds-funding-native-hidden'), true);
  const host = form.querySelector('.ds-funding-compact-host--edit');
  assert.ok(host);
  assert.equal(host.querySelector('[data-funding-compact-select]').value, 'a');
  assert.equal(host.querySelectorAll('[data-funding-compact-amount]').length, 0);

  host.querySelector('[data-funding-compact-add]').click();
  const selects = host.querySelectorAll('[data-funding-compact-select]');
  selects[1].value = 'b';
  change(dom.window, selects[1]);
  assert.deepEqual([...native.selectedOptions].map((option) => option.value), ['a', 'b']);
  assert.equal(host.querySelectorAll('[data-funding-compact-amount]').length, 2);
  const amounts = host.querySelectorAll('[data-funding-compact-amount]');
  amounts[0].value = '4500';
  input(dom.window, amounts[0]);
  amounts[1].value = '3000';
  input(dom.window, amounts[1]);
  assert.equal(native.options[0].dataset.fundingAmount, '4500');
  assert.equal(native.options[1].dataset.fundingAmount, '3000');

  form.reset();
  await Promise.resolve();
  assert.deepEqual([...native.selectedOptions].map((option) => option.value), ['a']);
  assert.equal(host.querySelectorAll('[data-funding-compact-select]').length, 1);
  assert.equal(host.querySelector('[data-funding-compact-select]').value, 'a');
  assert.equal(native.options[0].dataset.fundingAmount, '7500');
});
