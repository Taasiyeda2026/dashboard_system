import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { JSDOM } from 'jsdom';

globalThis.sessionStorage = globalThis.sessionStorage || { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {}, removeItem: () => {} };

globalThis.__PROPOSAL_APPROVAL_RUNTIME_TEST__ = true;
const runtimeUrl = new URL('../frontend/src/proposal-approval-runtime.js', import.meta.url);
const {
  installProposalApprovalRuntime,
  createProposalApprovalSignatureMeta,
  isCompleteSavedApproval,
  forceProposalApprovalOverlayVisible
} = await import(`${runtimeUrl.href}?test=${Date.now()}`);
const { proposalPreviewBodyHtml } = await import('../frontend/src/screens/proposals-agreements.js');

function installDom(html) {
  const dom = new JSDOM(`<main id="root">${html}</main>`, { url: 'https://example.test/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.CustomEvent = dom.window.CustomEvent;
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  return dom;
}

function templateSection(templateKey, marker = templateKey) {
  return {
    template_key: templateKey,
    section_key: 'intro',
    section_title: 'פתיח',
    section_body: `תבנית runtime ${marker}`,
    sort_order: 1
  };
}

test('signature metadata and saved approval validation require a real saved signature', () => {
  const meta = createProposalApprovalSignatureMeta(new Date('2026-07-28T17:00:00.000Z'));
  assert.equal(meta.signature.image, 'proposals/signature-idan-nahum.png');
  assert.equal(meta.signed_at, '2026-07-28T17:00:00.000Z');
  assert.equal(isCompleteSavedApproval({ status: 'approved', approved_at: '2026-07-28T17:00:01.000Z', signature_meta: meta }), true);
  assert.equal(isCompleteSavedApproval({ status: 'approved', approved_at: null, signature_meta: meta }), false);
  assert.equal(isCompleteSavedApproval({ status: 'approved', approved_at: '2026-07-28T17:00:01.000Z', signature_meta: {} }), false);
});

test('approval runtime opens a guaranteed visible overlay and saves one approval', async () => {
  const dom = installDom(`<button type="button" data-pa-status-action="approved" data-pa-action-id="p-1"><svg><polyline points="0 0 1 1"></polyline></svg></button>`);
  const root = dom.window.document.getElementById('root');
  const fakeScreen = { bind() {} };
  const row = {
    id: 'p-1',
    quote_number: '10177',
    status: 'pending_approval',
    client_authority: 'קריית גת',
    school_framework: 'קריית גת',
    activity_type_group: 'summer'
  };
  const data = { rows: [row], proposalTemplateSections: [] };
  const calls = [];
  let rerenders = 0;

  installProposalApprovalRuntime({
    screen: fakeScreen,
    renderPreview: () => '<article class="proposal-document">מסמך בדיקה</article>',
    toast: () => {}
  });
  fakeScreen.bind({
    root,
    data,
    state: { user: { user_id: 8000, role: 'admin', approve_proposals_agreements: true } },
    api: {
      proposalsAgreementsEditorDeps: async () => ({ proposalTemplateSections: [templateSection('summer')] }),
      readProposalAgreementItems: async (id) => [{ proposal_agreement_id: id, item_name: 'פעילות' }],
      updateProposalAgreementStatus: async (...args) => {
        calls.push(args);
        return {
          row: {
            ...row,
            status: 'approved',
            approved_at: '2026-07-28T17:01:00.000Z',
            approved_by: 'e9ca304a-4e66-4774-830e-14f1318c4908',
            signature_meta: args[3]
          }
        };
      }
    },
    rerender: async () => { rerenders += 1; }
  });

  root.querySelector('polyline').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await delay(20);

  const overlay = dom.window.document.getElementById('pa-preview-overlay');
  assert.ok(overlay);
  assert.equal(overlay.style.getPropertyValue('position'), 'fixed');
  assert.equal(overlay.style.getPropertyPriority('position'), 'important');
  assert.equal(overlay.style.getPropertyValue('z-index'), '2147483000');
  const confirm = overlay.querySelector('#pa-signature-confirm');
  assert.ok(confirm);

  confirm.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await delay(30);

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'p-1');
  assert.equal(calls[0][1], 'approved');
  assert.equal(data.rows[0].status, 'approved');
  assert.ok(data.rows[0].signature_meta.signature.image);
  assert.equal(dom.window.document.getElementById('pa-preview-overlay'), null);
  assert.equal(rerenders, 1);
  dom.window.close();
});

test('incomplete server approval keeps the overlay open and re-enables confirmation', async () => {
  const dom = installDom(`<button type="button" data-pa-status-action="approved" data-pa-action-id="p-2"><svg><path d="M0 0"></path></svg></button>`);
  const root = dom.window.document.getElementById('root');
  const fakeScreen = { bind() {} };
  const row = { id: 'p-2', quote_number: '10178', status: 'pending_approval', activity_type_group: 'summer' };
  const errors = [];

  installProposalApprovalRuntime({
    screen: fakeScreen,
    renderPreview: () => '<article class="proposal-document">מסמך בדיקה</article>',
    toast: (message, type) => { if (type === 'error') errors.push(message); }
  });
  fakeScreen.bind({
    root,
    data: { rows: [row], proposalTemplateSections: [] },
    state: { user: { user_id: 8000 } },
    api: {
      proposalsAgreementsEditorDeps: async () => ({ proposalTemplateSections: [templateSection('summer')] }),
      readProposalAgreementItems: async () => [],
      updateProposalAgreementStatus: async () => ({ row: { ...row, status: 'approved', signature_meta: {} } })
    }
  });

  root.querySelector('path').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await delay(20);
  const overlay = dom.window.document.getElementById('pa-preview-overlay');
  const confirm = overlay.querySelector('#pa-signature-confirm');
  confirm.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await delay(30);

  assert.ok(dom.window.document.getElementById('pa-preview-overlay'));
  assert.equal(confirm.disabled, false);
  assert.match(overlay.querySelector('[data-pa-approval-runtime-error]').textContent, /אישור מלא/);
  assert.equal(errors.length, 1);
  dom.window.close();
});

test('first approval action loads and renders the matching real proposal template for every proposal group', async (t) => {
  const groups = ['next_year', 'gefen', 'summer', 'tour'];
  for (const group of groups) {
    await t.test(group, async () => {
      const dom = installDom(`<button data-pa-status-action="approved" data-pa-action-id="p-${group}">אישור</button>`);
      const root = dom.window.document.getElementById('root');
      const row = {
        id: `p-${group}`,
        quote_number: `quote-${group}`,
        status: 'pending_approval',
        activity_type_group: group
      };
      const data = { rows: [row], proposalTemplateSections: [] };
      const callOrder = [];
      let receivedTemplateSections = null;
      const sections = groups.map((key) => templateSection(key));
      const fakeScreen = { bind() {} };

      installProposalApprovalRuntime({
        screen: fakeScreen,
        toast: () => {},
        renderPreview: (previewRow, items, templateSections, options) => {
          receivedTemplateSections = templateSections;
          return proposalPreviewBodyHtml(previewRow, items, templateSections, options);
        }
      });
      fakeScreen.bind({
        root,
        data,
        state: { user: { user_id: 8000 } },
        api: {
          proposalsAgreementsEditorDeps: async () => {
            callOrder.push('editor-deps');
            return { proposalTemplateSections: sections };
          },
          readProposalAgreementItems: async () => {
            callOrder.push('items');
            return [];
          }
        }
      });

      assert.deepEqual(callOrder, [], 'binding the proposal list must not preload editor dependencies');
      root.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await delay(20);

      assert.deepEqual(callOrder, ['editor-deps', 'items']);
      assert.equal(data.proposalTemplateSections, sections);
      const preview = dom.window.document.querySelector('#pa-preview-overlay .proposal-preview-area');
      assert.ok(preview, 'the real proposal preview renderer created the preview area');
      assert.deepEqual(receivedTemplateSections, [templateSection(group)]);
      if (group !== 'tour') assert.match(preview.textContent, new RegExp(`תבנית runtime ${group}`));
      dom.window.close();
    });
  }
});

test('approval runtime blocks a normal proposal when no active template exists', async () => {
  const dom = installDom('<button data-pa-status-action="approved" data-pa-action-id="p-missing">אישור</button>');
  const root = dom.window.document.getElementById('root');
  const errors = [];
  const fakeScreen = { bind() {} };
  installProposalApprovalRuntime({
    screen: fakeScreen,
    toast: (message, type) => { if (type === 'error') errors.push(message); }
  });
  fakeScreen.bind({
    root,
    data: { rows: [{ id: 'p-missing', status: 'pending_approval', activity_type_group: 'tour' }], proposalTemplateSections: [] },
    state: { user: { user_id: 8000 } },
    api: { proposalsAgreementsEditorDeps: async () => ({ proposalTemplateSections: [] }) }
  });

  root.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await delay(20);

  assert.equal(dom.window.document.getElementById('pa-preview-overlay'), null);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /לא נמצאה תבנית פעילה/);
  dom.window.close();
});

test('visibility helper overrides stale or conflicting overlay styles', () => {
  const dom = installDom('<div id="pa-preview-overlay" style="display:none;visibility:hidden;opacity:0"><div class="proposal-preview-toolbar"></div></div>');
  const overlay = dom.window.document.getElementById('pa-preview-overlay');
  assert.equal(forceProposalApprovalOverlayVisible(overlay), true);
  assert.equal(overlay.style.getPropertyValue('display'), 'block');
  assert.equal(overlay.style.getPropertyPriority('display'), 'important');
  assert.equal(overlay.style.getPropertyValue('visibility'), 'visible');
  assert.equal(overlay.style.getPropertyValue('opacity'), '1');
  dom.window.close();
});
