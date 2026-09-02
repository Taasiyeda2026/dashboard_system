import assert from 'node:assert/strict';
import test from 'node:test';
import { ProposalEditorController } from '../frontend/src/proposal-editor-controller.js';

test('proposal editor controller replaces stale preview renders with the latest state', () => {
  const callbacks = new Map();
  let sequence = 0;
  const cancelled = [];
  const rendered = [];
  const form = { isConnected: true, dataset: {}, value: 'first' };
  const controller = new ProposalEditorController(form, {
    readState: (activeForm) => ({ value: activeForm.value }),
    renderPreview: (_activeForm, state) => rendered.push(state),
    frame: (callback) => { const id = ++sequence; callbacks.set(id, callback); return id; },
    cancelFrame: (id) => { cancelled.push(id); callbacks.delete(id); }
  });

  controller.change();
  form.value = 'latest';
  controller.change();
  assert.deepEqual(cancelled, [1]);
  callbacks.get(2)();
  assert.deepEqual(rendered, [{ value: 'latest' }]);
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
