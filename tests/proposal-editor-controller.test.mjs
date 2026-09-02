import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { ProposalEditorController } from '../frontend/src/proposal-editor-controller.js';

globalThis.sessionStorage ||= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.localStorage ||= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { isProposalPricingSelectionChange } = await import('../frontend/src/screens/proposals-agreements.js');

test('proposal editor controller replaces stale preview renders with the latest state', () => {
  const callbacks = new Map();
  let sequence = 0;
  const cancelled = [];
  const rendered = [];
  const calculations = [];
  const form = { isConnected: true, dataset: {}, value: 'first' };
  const controller = new ProposalEditorController(form, {
    readState: (activeForm) => ({ value: activeForm.value }),
    calculate: (activeForm) => calculations.push(activeForm.value),
    renderPreview: (_activeForm, state) => rendered.push(state),
    frame: (callback) => { const id = ++sequence; callbacks.set(id, callback); return id; },
    cancelFrame: (id) => { cancelled.push(id); callbacks.delete(id); }
  });

  controller.change();
  form.value = 'latest';
  controller.change();
  assert.deepEqual(cancelled, [1]);
  assert.deepEqual(calculations, ['first', 'latest']);
  callbacks.get(2)();
  assert.deepEqual(rendered, [{ value: 'latest' }]);
  assert.equal(form.dataset.paPreviewRenderCount, '1');
});

test('proposal editor controller skips an identical settled preview snapshot', () => {
  const callbacks = new Map();
  let sequence = 0;
  let renders = 0;
  const form = { isConnected: true, dataset: {}, value: 'same' };
  const controller = new ProposalEditorController(form, {
    readState: (activeForm) => ({ value: activeForm.value }),
    calculate: () => 100,
    renderPreview: () => { renders += 1; },
    frame: (callback) => { const id = ++sequence; callbacks.set(id, callback); return id; },
    cancelFrame: (id) => callbacks.delete(id)
  });

  controller.change();
  callbacks.get(1)();
  controller.change();
  callbacks.get(2)();

  assert.equal(renders, 1);
  assert.equal(controller.renderCount, 1);
  assert.equal(form.dataset.paPreviewRenderCount, '1');
});

test('proposal editor controller does not commit after its form is detached', () => {
  let callback;
  const form = { isConnected: true, dataset: {} };
  const controller = new ProposalEditorController(form, {
    readState: () => ({ revision: 1 }),
    renderPreview: () => assert.fail('detached editor rendered'),
    frame: (next) => { callback = next; return 1; },
    cancelFrame: () => {}
  });
  controller.change();
  form.isConnected = false;
  callback();
  assert.equal(controller.renderCount, 0);
});

test('pricing selection hydrates the row and reaches one controller transaction owner', () => {
  const dom = new JSDOM(`<form data-pa-form><article data-pa-item-row>
    <select data-pa-pricing-select><option value="course-1" selected>קורס</option></select>
    <input name="item_name"><input name="activity_no"><input name="hours_count">
    <input name="hourly_price"><input name="unit_price"><input name="quantity" value="2">
  </article></form>`);
  const form = dom.window.document.querySelector('form');
  const select = form.querySelector('select');
  let frameCallback;
  let transactions = 0;
  let renders = 0;
  const controller = new ProposalEditorController(form, {
    calculate: () => { transactions += 1; return 19000; },
    readState: () => ({ name: form.elements.item_name.value, total: 19000 }),
    renderPreview: (_form, state) => { renders += 1; assert.deepEqual(state, { name: 'יישומי AI', total: 19000 }); },
    frame: (callback) => { frameCallback = callback; return 1; },
    cancelFrame: () => {}
  });

  form.addEventListener('change', (event) => {
    if (isProposalPricingSelectionChange(event.target)) return;
    controller.change();
  });
  form.addEventListener('change', (event) => {
    if (!isProposalPricingSelectionChange(event.target)) return;
    form.elements.item_name.value = 'יישומי AI';
    form.elements.activity_no.value = '53819';
    form.elements.hours_count.value = '15';
    form.elements.hourly_price.value = '633';
    form.elements.unit_price.value = '9500';
    controller.change();
  }, { capture: true });

  select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  frameCallback();
  assert.equal(form.elements.activity_no.value, '53819');
  assert.equal(form.elements.hours_count.value, '15');
  assert.equal(form.elements.hourly_price.value, '633');
  assert.equal(form.elements.unit_price.value, '9500');
  assert.equal(transactions, 1);
  assert.equal(renders, 1);
});