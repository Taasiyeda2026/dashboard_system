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

test('a never-settling operation times out and releases the single-flight runner', async () => {
  const runner = createProposalApprovalSubmissionRunner();
  const mock = submissionMock({ items: [{ item_name: 'GEFEN' }], deferredSave: { promise: new Promise(() => {}) } });
  await assert.rejects(
    runner.run({ ...mock.api, items: mock.items, timeoutOptions: { timeoutMs: 5 } }),
    /לא הושלם בזמן/
  );
  assert.equal(runner.isActive(), false);
  assert.deepEqual(mock.calls, [['proposal', 'draft']]);
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

import { JSDOM } from 'jsdom';

test('screen timeout clears saving state and a responsive retry reuses the same insert identity', async () => {
  const manager = { user: { role: 'operation_manager', manage_proposals_agreements: true } };
  const data = {
    rows: [], contactOptions: [], activityNameOptions: [],
    proposalActivityGroups: [{ group_key: 'gefen', display_name: 'גפן', is_active: true }],
    proposalActivityPricing: []
  };
  const { proposalsAgreementsScreen } = await import('../frontend/src/screens/proposals-agreements.js');
  const dom = new JSDOM(`<main id="root">${proposalsAgreementsScreen.render(data, { state: manager })}</main>`, { url: 'https://example.test/' });
  const savedGlobals = { window: globalThis.window, document: globalThis.document, FormData: globalThis.FormData, AbortController: globalThis.AbortController, requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame, Event: globalThis.Event, CustomEvent: globalThis.CustomEvent };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.FormData = dom.window.FormData;
  globalThis.AbortController = dom.window.AbortController;
  globalThis.requestAnimationFrame = (callback) => dom.window.setTimeout(callback, 0);
  globalThis.cancelAnimationFrame = (handle) => dom.window.clearTimeout(handle);
  globalThis.Event = dom.window.Event;
  globalThis.CustomEvent = dom.window.CustomEvent;
  globalThis.__PROPOSAL_SUBMISSION_TIMEOUT_MS__ = 5;
  const root = dom.window.document.getElementById('root');
  const submissionIds = [];
  try {
    proposalsAgreementsScreen.bind({
      root, data, state: manager,
      api: {
        addProposalAgreement: (payload) => {
          submissionIds.push(payload._submission_id);
          if (submissionIds.length === 1) return new Promise(() => {});
          return Promise.resolve({ ok: true, row: { ...payload, id: payload._submission_id, status: 'draft' } });
        },
        saveProposalAgreementItems: async () => ({ ok: true }),
        updateProposalAgreementStatus: async (id, status) => ({ ok: true, row: { id, status } })
      }
    });
    root.querySelector('[data-pa-tab="new"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await delay(25);
    const form = root.querySelector('[data-pa-form]');
    form.querySelector('[data-pa-type-btn="gefen"]')?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await delay(10);
    form.querySelector('[data-pa-add-item]')?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await delay(5);
    const set = (selector, value) => { const element = form.querySelector(selector); assert.ok(element, selector); element.value = value; };
    set('[name="client_authority"]', 'רשות בדיקה');
    set('[name="school_framework"]', 'בית ספר בדיקה');
    set('[name="contact_source_authority_id"]', '100');
    set('[name="contact_source_school_id"]', '200');
    set('[name="activity_type_group"]', 'gefen');
    set('[data-pa-item-row] [name="item_name"]', 'פעילות גפן');
    set('[data-pa-item-qty]', '1');
    set('[data-pa-item-price]', '100');
    form.querySelector('[data-pa-item-price]').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    const button = form.querySelector('[data-pa-save-pending]');
    button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await delay(20);
    assert.equal(form.dataset.saving, '');
    assert.equal(button.disabled, false);
    assert.match(form.querySelector('[data-pa-form-error]').textContent, /לא הושלם בזמן/);
    button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await delay(30);
    assert.equal(submissionIds.length, 2, 'the second click is handled rather than silently ignored');
    assert.equal(new Set(submissionIds).size, 1, 'both attempts use one idempotent insert identity');
    assert.equal(root.querySelector('[data-pa-form]'), null, 'successful retry completes and closes the form');
  } finally {
    delete globalThis.__PROPOSAL_SUBMISSION_TIMEOUT_MS__;
    Object.assign(globalThis, savedGlobals);
    dom.window.close();
  }
});

test('addProposalAgreement 23505 recovery rereads and returns the same idempotent proposal', async () => {
  const { recoverIdempotentProposalInsert } = await import('../frontend/src/api.js');
  const submissionId = '11111111-1111-4111-8111-111111111111';
  const created = { id: submissionId, status: 'draft', client_authority: 'רשות בדיקה' };
  let rereads = 0;
  const result = await recoverIdempotentProposalInsert(
    { code: '23505', message: 'duplicate key value violates unique constraint' },
    submissionId,
    async (id) => {
      rereads += 1;
      assert.equal(id, submissionId);
      return { data: created, error: null };
    }
  );
  assert.equal(rereads, 1);
  assert.equal(result.ok, true);
  assert.equal(result.row.id, submissionId);
  assert.equal(result.row.client_authority, created.client_authority);
});

test('GEFEN Biomimicry item keeps item_name through submission', async () => {
  const mock = submissionMock({ items: [{ item_name: 'ביומימיקרי', gefen_number: '6089' }] });
  let savedItems;
  mock.api.saveItems = async (id, items) => {
    savedItems = items;
    mock.calls.push(['items', id, items.length]);
    return { ok: true, items };
  };
  await runProposalApprovalSubmission({ ...mock.api, items: mock.items });
  assert.equal(savedItems[0].item_name, 'ביומימיקרי');
});

test('missing item_name is rejected before proposal or item persistence', async () => {
  const mock = submissionMock({ items: [{ item_name: '', unit_price: 9900 }] });
  await assert.rejects(
    runProposalApprovalSubmission({ ...mock.api, items: mock.items }),
    /חסר שם פעילות בשורה 1/
  );
  assert.deepEqual(mock.calls, []);
});

test('atomic item RPC rejects blank item_name before deleting or inserting rows', async () => {
  const { readFile } = await import('node:fs/promises');
  const sql = await readFile(new URL('../supabase/migrations/20260810100000_current_app_user_rpc.sql', import.meta.url), 'utf8');
  const guard = sql.indexOf("raise exception 'proposal_item_name_required'");
  const deletion = sql.indexOf('delete from public.proposal_agreement_items');
  const insertion = sql.indexOf('insert into public.proposal_agreement_items');
  assert.ok(guard >= 0 && guard < deletion && deletion < insertion);
  assert.match(sql, /nullif\(btrim\(item->>'item_name'\), ''\) is null/);
});
