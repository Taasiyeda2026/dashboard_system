import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const {
  enhanceAddFundingPicker,
  enhanceEditFundingPicker
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

  let selects = host.querySelectorAll('[data-funding-compact-select]');
  selects[0].value = 'a';
  change(dom.window, selects[0]);
  assert.equal(fieldset.querySelector('[data-funding-source-id="a"]').checked, true);

  host.querySelector('[data-funding-compact-add]').click();
  selects = host.querySelectorAll('[data-funding-compact-select]');
  assert.equal(selects.length, 2);
  selects[1].value = 'b';
  change(dom.window, selects[1]);

  assert.equal(fieldset.querySelector('[data-funding-source-id="a"]').checked, true);
  assert.equal(fieldset.querySelector('[data-funding-source-id="b"]').checked, true);
  assert.equal(fieldset.querySelector('[data-funding-source-id="c"]').checked, false);

  const amounts = host.querySelectorAll('[data-funding-compact-amount]');
  assert.equal(amounts.length, 2, 'amounts appear only when the activity has multiple funders');
  amounts[0].value = '5000';
  input(dom.window, amounts[0]);
  assert.equal(fieldset.querySelector('[data-funding-source-id="a"]').closest('label').querySelector('[data-funding-amount]').value, '5000');
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

test('edit activity multi-select is represented by the same compact picker without changing the native save contract', async () => {
  const dom = new JSDOM(`<!doctype html><body><form>
    <select name="funding_sources" multiple size="3" data-scheduling-multi>
      <option value="a" selected>גפן</option>
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

  form.reset();
  await Promise.resolve();
  assert.deepEqual([...native.selectedOptions].map((option) => option.value), ['a']);
  assert.equal(host.querySelectorAll('[data-funding-compact-select]').length, 1);
  assert.equal(host.querySelector('[data-funding-compact-select]').value, 'a');
});
