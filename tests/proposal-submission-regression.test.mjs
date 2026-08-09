import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const {
  createProposalApprovalSubmissionRunner,
  runProposalApprovalSubmission
} = await import('../frontend/src/screens/proposals-agreements.js');

function submissionMock({ items, failAt = '', deferredSave = null } = {}) {
  const calls = [];
  const api = {
    saveProposal: async () => {
      calls.push(['proposal', 'draft']);
      if (failAt === 'proposal') throw new Error('שמירת ההצעה נכשלה');
      if (deferredSave) return deferredSave.promise;
      return { ok: true, row: { id: 'proposal-id', status: 'draft' } };
    },
    saveItems: async (id, savedItems) => {
      calls.push(['items', id, savedItems.length]);
      if (failAt === 'items') throw new Error('שמירת פריטי ההצעה נכשלה');
      return { ok: true, items: savedItems };
    },
    updateStatus: async (id, status) => {
      calls.push(['status', id, status]);
      if (failAt === 'status') throw new Error('שינוי הסטטוס נכשל');
      return { ok: true, row: { id, status } };
    }
  };
  return { calls, api, items };
}

for (const itemCount of [1, 2]) {
  test(`GEFEN submission with ${itemCount} item(s) runs draft, items, pending exactly once`, async () => {
    const mock = submissionMock({ items: Array.from({ length: itemCount }, (_, i) => ({ item_name: `GEFEN ${i + 1}` })) });
    const result = await runProposalApprovalSubmission({ ...mock.api, items: mock.items });
    assert.equal(result.statusResult.row.status, 'pending_approval');
    assert.deepEqual(mock.calls, [
      ['proposal', 'draft'],
      ['items', 'proposal-id', itemCount],
      ['status', 'proposal-id', 'pending_approval']
    ]);
  });
}

test('proposal failure stops items and status and releases the caller UI', async () => {
  const ui = { disabled: true, error: '' };
  const mock = submissionMock({ items: [{ item_name: 'GEFEN' }], failAt: 'proposal' });
  await assert.rejects(runProposalApprovalSubmission({ ...mock.api, items: mock.items }), /שמירת ההצעה נכשלה/)
    .finally(() => { ui.disabled = false; ui.error = 'שמירת ההצעה נכשלה'; });
  assert.deepEqual(mock.calls, [['proposal', 'draft']]);
  assert.equal(ui.disabled, false);
  assert.match(ui.error, /נכשלה/);
});

test('items failure stops status and releases the caller UI', async () => {
  const ui = { disabled: true };
  const mock = submissionMock({ items: [{ item_name: 'GEFEN' }], failAt: 'items' });
  await assert.rejects(runProposalApprovalSubmission({ ...mock.api, items: mock.items }), /שמירת פריטי ההצעה נכשלה/)
    .finally(() => { ui.disabled = false; });
  assert.deepEqual(mock.calls, [['proposal', 'draft'], ['items', 'proposal-id', 1]]);
  assert.equal(ui.disabled, false);
});

test('status failure surfaces an error without starting another submit', async () => {
  const runner = createProposalApprovalSubmissionRunner();
  const mock = submissionMock({ items: [{ item_name: 'GEFEN' }], failAt: 'status' });
  await assert.rejects(runner.run({ ...mock.api, items: mock.items }), /שינוי הסטטוס נכשל/);
  assert.deepEqual(mock.calls, [
    ['proposal', 'draft'], ['items', 'proposal-id', 1], ['status', 'proposal-id', 'pending_approval']
  ]);
});

test('visual timeout releases UI but retains the original flight and prevents a late duplicate insert', async () => {
  let resolveSave;
  const deferredSave = { promise: new Promise((resolve) => { resolveSave = resolve; }) };
  const mock = submissionMock({ items: [{ item_name: 'GEFEN' }], deferredSave });
  const runner = createProposalApprovalSubmissionRunner();
  const ui = { disabled: true, error: '' };
  const options = {
    ...mock.api,
    items: mock.items,
    timeoutOptions: { timeoutMs: 5, onTimeout: (message) => { ui.disabled = false; ui.error = message; } }
  };
  const first = runner.run(options);
  await delay(15);
  assert.equal(ui.disabled, false);
  assert.match(ui.error, /עדיין מתבצעת/);
  const second = runner.run(options);
  assert.strictEqual(second, first, 'retry joins the active flight instead of inserting again');
  assert.deepEqual(mock.calls, [['proposal', 'draft']]);
  resolveSave({ ok: true, row: { id: 'proposal-id', status: 'draft' } });
  await first;
  assert.deepEqual(mock.calls, [
    ['proposal', 'draft'], ['items', 'proposal-id', 1], ['status', 'proposal-id', 'pending_approval']
  ]);
});

test('double click shares one flight: one proposal save, one item save, one status update', async () => {
  const runner = createProposalApprovalSubmissionRunner();
  const mock = submissionMock({ items: [{ item_name: 'A' }, { item_name: 'B' }] });
  const options = { ...mock.api, items: mock.items };
  const [first, second] = [runner.run(options), runner.run(options)];
  assert.strictEqual(first, second);
  await Promise.all([first, second]);
  assert.deepEqual(mock.calls, [
    ['proposal', 'draft'], ['items', 'proposal-id', 2], ['status', 'proposal-id', 'pending_approval']
  ]);
});
