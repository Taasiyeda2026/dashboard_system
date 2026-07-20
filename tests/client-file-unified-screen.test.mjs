import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const INDEX_FILE = new URL('../index.html', import.meta.url);
const SCREEN_FILE = new URL('../frontend/src/screens/proposals-agreements.js', import.meta.url);
const SW_FILE = new URL('../frontend/sw.js', import.meta.url);
const CONFIG_FILE = new URL('../frontend/src/config.js', import.meta.url);
const INSTRUCTORS_FILE = new URL('../frontend/src/screens/instructors.js', import.meta.url);
const INSTRUCTOR_CONTACTS_FILE = new URL('../frontend/src/screens/instructor-contacts.js', import.meta.url);

const {
  proposalsAgreementsScreen,
  canManageProposalsAgreements,
  clientFacingProposalTypeLabel,
  collapseSemanticDuplicates,
  semanticDuplicateKey,
  isArchivedClientProposal,
  STATUS_LABELS
} = await import('../frontend/src/screens/proposals-agreements.js');

async function withJSDOM(html, fn) {
  const dom = new JSDOM(`<main id="root">${html}</main>`, { url: 'http://localhost/' });
  const saved = {
    document: globalThis.document,
    window: globalThis.window,
    FormData: globalThis.FormData,
    AbortController: globalThis.AbortController,
    CustomEvent: globalThis.CustomEvent
  };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.FormData = dom.window.FormData;
  globalThis.AbortController = dom.window.AbortController;
  globalThis.CustomEvent = dom.window.CustomEvent;
  try {
    const root = dom.window.document.getElementById('root');
    await fn(root, dom);
  } finally {
    globalThis.document = saved.document;
    globalThis.window = saved.window;
    globalThis.FormData = saved.FormData;
    globalThis.AbortController = saved.AbortController;
    globalThis.CustomEvent = saved.CustomEvent;
  }
}

function stateFor({ manage = false, view = true, role = 'business_development_manager' } = {}) {
  return {
    user: {
      role,
      display_role: role,
      view_proposals_agreements: view,
      manage_proposals_agreements: manage
    },
    effectiveRoutes: ['proposals-agreements']
  };
}

function sampleItems() {
  return [
    { item_name: 'קורס א', gefen_number: '100', quantity: 1, unit_price: 1000, total_price: 1000, sort_order: 1 },
    { item_name: 'קורס ב', gefen_number: '200', quantity: 2, unit_price: 500, total_price: 1000, sort_order: 2 }
  ];
}

test('client file uses a single native implementation without overlay scripts', async () => {
  const index = await readFile(INDEX_FILE, 'utf8');
  const screen = await readFile(SCREEN_FILE, 'utf8');
  assert.match(index, /frontend\/src\/main\.js/);
  assert.doesNotMatch(index, /client-file-overlay\.js/);
  assert.doesNotMatch(index, /client-file-proposal-open\.js/);
  assert.doesNotMatch(index, /client-file-data-adapter\.js/);
  assert.match(screen, /data-pa-client-workspace/);
  assert.match(screen, /טיוטות/);
  assert.match(screen, /ממתינות לאישור/);
  assert.match(screen, /הוחזרו לתיקון/);
  assert.match(screen, /מאושרות וממתינות לשליחה/);
  assert.doesNotMatch(screen, /stopImmediatePropagation/);
});

test('client-file render is data-pure and bind never requests an initial rerender', async () => {
  const state = stateFor({ manage: true, role: 'admin' });
  const data = {
    rows: [{ id: 'pure-1', client_authority: 'חיפה', school_framework: 'אליאנס', school_id: '11', status: 'draft', activity_type_group: 'next_year' }],
    contactOptions: []
  };
  const before = structuredClone(data);
  const html = proposalsAgreementsScreen.render(data, { state });
  assert.deepEqual(data, before, 'render must not mutate the supplied screen data');

  await withJSDOM(html, async (root) => {
    let rerenders = 0;
    assert.doesNotThrow(() => proposalsAgreementsScreen.bind({
      root,
      data: structuredClone(data),
      state,
      api: { readProposalAgreementItems: async () => [] },
      rerender: () => { rerenders += 1; }
    }));
    assert.equal(rerenders, 0, 'bind must not synchronously or implicitly rerender');
  });
});

test('client-file contact editing updates by exact source id and never inserts a duplicate', async () => {
  const state = stateFor({ manage: true, role: 'admin' });
  for (const contact of [
    { id: '81', source_id: '81', source_table: 'contacts_schools' },
    { id: '82' }
  ]) {
    const data = {
      rows: [],
      contactOptions: [{
        ...contact,
        client_type: 'school', authority_id: '5', school_id: '9', authority: 'נתניה', school: 'ריגלר',
        contact_name: 'אורי אהרון כהן', contact_role: 'מנהל', mobile: '050-1111111'
      }]
    };
    await withJSDOM(proposalsAgreementsScreen.render(data, { state }), async (root, dom) => {
      const saved = [];
      const added = [];
      proposalsAgreementsScreen.bind({
        root, data, state,
        api: {
          saveContact: async (payload) => { saved.push(payload); return { ok: true }; },
          addContact: async (payload) => { added.push(payload); return { ok: true, row: { id: 'new' } }; }
        }
      });
      const search = root.querySelector('[data-pa-client-search]');
      search.value = 'ריגלר';
      search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 300));
      root.querySelector('[data-pa-open-client]')?.click();
      root.querySelector('[data-pa-client-edit-contact]')?.click();
      const form = root.querySelector('[data-pa-client-contact-form]');
      form.querySelector('[name="contact_role"]').value = 'רכז';
      form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(saved.length, 1);
      assert.equal(added.length, 0);
      assert.equal(String(saved[0].row.id), String(contact.source_id || contact.id));
      assert.equal(data.contactOptions.length, 1);
      assert.equal(data.contactOptions[0].contact_role, 'רכז');
      assert.equal(data.contactOptions[0].source_table, 'contacts_schools');
    });
  }
});

test('client-file edit without an unambiguous id does not insert and hides database errors', async () => {
  const state = stateFor({ manage: true, role: 'admin' });
  const data = { rows: [], contactOptions: [{ client_type: 'school', authority: 'נתניה', school: 'ריגלר', contact_name: 'אורי אהרון כהן' }] };
  await withJSDOM(proposalsAgreementsScreen.render(data, { state }), async (root, dom) => {
    let addCalls = 0;
    proposalsAgreementsScreen.bind({ root, data, state, api: { addContact: async () => { addCalls += 1; } } });
    const search = root.querySelector('[data-pa-client-search]');
    search.value = 'ריגלר';
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    root.querySelector('[data-pa-open-client]')?.click();
    root.querySelector('[data-pa-client-edit-contact]')?.click();
    const form = root.querySelector('[data-pa-client-contact-form]');
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(addCalls, 0);
    const message = form.querySelector('[data-pa-client-contact-error]').textContent;
    assert.match(message, /לא ניתן לזהות/);
    assert.doesNotMatch(message, /contacts_schools|not-null|PostgreSQL|Supabase/i);
  });
});

test('new client-file contact inserts without identity metadata and uses returned id', async () => {
  const state = stateFor({ manage: true, role: 'admin' });
  const data = { rows: [{ id: 'p1', client_type: 'school', client_authority: 'נתניה', school_framework: 'ריגלר', authority_id: '5', school_id: '9' }], contactOptions: [] };
  await withJSDOM(proposalsAgreementsScreen.render(data, { state }), async (root, dom) => {
    let inserted;
    proposalsAgreementsScreen.bind({ root, data, state, api: { addContact: async (payload) => { inserted = payload; return { ok: true, row: { id: 91 } }; } } });
    const search = root.querySelector('[data-pa-client-search]');
    search.value = 'ריגלר';
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    root.querySelector('[data-pa-open-client]')?.click();
    root.querySelector('[data-pa-client-add-contact]')?.click();
    const form = root.querySelector('[data-pa-client-contact-form]');
    form.querySelector('[name="contact_name"]').value = 'איש חדש';
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(inserted);
    assert.equal(Object.hasOwn(inserted.row, 'id'), false);
    assert.equal(Object.hasOwn(inserted.row, 'source_id'), false);
    assert.equal(Object.hasOwn(inserted.row, 'source_table'), false);
    assert.equal(data.contactOptions[0].id, 91);
    assert.equal(data.contactOptions[0].source_id, 91);
  });
});

test('school contact insert sanitizes null identity before reaching Supabase', async () => {
  const apiSource = await readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
  assert.match(apiSource, /if \(nextRow\.id == null \|\| nextRow\.id === ''\) delete nextRow\.id;/);
  assert.match(apiSource, /delete nextRow\.source_id;/);
  assert.match(apiSource, /delete nextRow\.source_table;/);
  assert.match(apiSource, /from\('contacts_schools'\)\.insert\(nextRow\)\.select\(\)\.single\(\)/);
});

test('combined activity-group metadata cannot recurse while the client-file screen renders', () => {
  const data = {
    rows: [],
    contactOptions: [],
    proposalActivityGroups: [{
      group_key: 'combined',
      display_name: 'הצעה משולבת',
      template_key: 'combined',
      included_group_keys: ['summer', 'next_year'],
      is_combined: true,
      is_active: true
    }],
    proposalActivityPricing: [{ proposal_group: 'combined', activity_name: 'חבילה' }]
  };
  assert.doesNotThrow(() => proposalsAgreementsScreen.render(data, { state: stateFor() }));
});

test('a pending client search cannot update a replaced or detached screen root', async () => {
  const state = stateFor();
  const data = {
    rows: [{ id: 'timer-1', client_authority: 'חיפה', school_framework: 'אליאנס', school_id: '11', status: 'draft', activity_type_group: 'next_year' }],
    contactOptions: []
  };
  await withJSDOM(proposalsAgreementsScreen.render(data, { state }), async (root, dom) => {
    proposalsAgreementsScreen.bind({ root, data: structuredClone(data), state, api: { readProposalAgreementItems: async () => [] } });
    const input = root.querySelector('[data-pa-client-search]');
    input.value = 'אל';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    root.innerHTML = '<p data-replacement>מסך חלופי</p>';
    await new Promise((resolve) => setTimeout(resolve, 320));
    assert.ok(root.querySelector('[data-replacement]'));
    assert.equal(root.querySelector('[data-pa-client-search-results]'), null);
  });
});

test('view-only users do not see management actions; managers do', async () => {
  const viewState = stateFor({ manage: false, role: 'business_development_manager' });
  const manageState = stateFor({ manage: true, role: 'admin' });
  assert.equal(canManageProposalsAgreements(viewState), false);
  assert.equal(canManageProposalsAgreements(manageState), true);

  const row = {
    id: 'p1',
    client_authority: 'נתניה',
    school_framework: 'ריגלר',
    activity_type_group: 'next_year',
    status: 'approved',
    proposal_date: '2026-06-28',
    total_amount: 22600,
    version_number: 1,
    school_id: '1'
  };
  const data = { rows: [row], contactOptions: [] };

  const viewHtml = proposalsAgreementsScreen.render(data, { state: viewState });
  const manageHtml = proposalsAgreementsScreen.render(data, { state: manageState });
  assert.doesNotMatch(viewHtml, /\+ לקוח אחר/);
  assert.match(manageHtml, /\+ לקוח אחר/);

  await withJSDOM(viewHtml, async (root, dom) => {
    const api = { readProposalAgreementItems: async () => [] };
    proposalsAgreementsScreen.bind({ root, data: structuredClone(data), state: viewState, api });
    const search = root.querySelector('[data-pa-client-search]');
    search.value = 'ריגלר';
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    root.querySelector('[data-pa-open-client]')?.click();
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(root.querySelector('[data-pa-client-file]'), 'view-only can open client file');
    assert.equal(root.querySelector('[data-pa-client-add-other]'), null);
    assert.equal(root.querySelector('[data-pa-client-add-proposal]'), null);
    assert.equal(root.querySelector('[data-pa-client-add-contact]'), null);
    assert.equal(root.querySelector('[data-pa-clone-row]'), null);
  });

  await withJSDOM(manageHtml, async (root, dom) => {
    const api = { readProposalAgreementItems: async () => [] };
    proposalsAgreementsScreen.bind({ root, data: structuredClone(data), state: manageState, api });
    const search = root.querySelector('[data-pa-client-search]');
    search.value = 'ריגלר';
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    root.querySelector('[data-pa-open-client]')?.click();
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(root.querySelector('[data-pa-client-file]'), 'manager can open client file');
    assert.ok(root.querySelector('[data-pa-client-add-proposal]'));
    assert.ok(root.querySelector('[data-pa-client-add-contact]'));
    assert.ok(root.querySelector('[data-pa-clone-row]'));
  });
});

test('proposal type labels never expose combined or technical aliases', () => {
  assert.equal(clientFacingProposalTypeLabel({ activity_type_group: 'next_year' }), 'תשפ״ז');
  assert.equal(clientFacingProposalTypeLabel({ activity_type_group: 'summer' }), 'קיץ');
  assert.equal(clientFacingProposalTypeLabel({ activity_type_group: 'tour' }), 'סיור');
  assert.equal(clientFacingProposalTypeLabel({ activity_type_group: 'combined' }), '—');
  assert.equal(clientFacingProposalTypeLabel({ activity_type_group: 'הצעה משולבת' }), '—');
  assert.equal(clientFacingProposalTypeLabel({ activity_type_group: 'combined', template_key: 'summer' }), 'קיץ');
  assert.equal(clientFacingProposalTypeLabel({ activity_type_group: 'weird_unknown_type' }), '—');
  const labels = ['next_year', 'summer', 'tour', 'combined', 'הצעה משולבת']
    .map((v) => clientFacingProposalTypeLabel({ activity_type_group: v }));
  assert.ok(!labels.includes('combined'));
  assert.ok(!labels.includes('הצעה משולבת'));
  assert.ok(!labels.includes('next_year'));
  assert.ok(!labels.includes('summer'));
  assert.ok(!labels.includes('tour'));
});

test('semantic duplicates collapse to the PDF canonical row', () => {
  const items = sampleItems();
  const base = {
    client_authority: 'נתניה',
    school_framework: 'חט״ב תיכון ריגלר',
    activity_type_group: 'next_year',
    proposal_date: '2026-06-28',
    total_amount: 22600,
    status: 'sent',
    created_at: '2026-06-01T10:00:00Z',
    updated_at: '2026-06-02T10:00:00Z'
  };
  const withPdf = {
    ...base,
    id: 'canonical-pdf',
    final_pdf_path: 'proposals/a.pdf',
    final_pdf_file_name: 'a.pdf',
    document_snapshot: { items },
    sent_at: '2026-06-28T12:00:00Z'
  };
  const duplicate = {
    ...base,
    id: 'duplicate-empty',
    created_at: '2026-06-03T10:00:00Z',
    updated_at: '2026-06-04T10:00:00Z'
  };
  const different = {
    ...base,
    id: 'different-items',
    document_snapshot: {
      items: [{ item_name: 'סיור אחר', gefen_number: '9', quantity: 1, unit_price: 500, total_price: 500, sort_order: 1 }]
    }
  };

  assert.equal(
    semanticDuplicateKey(withPdf, items),
    semanticDuplicateKey(duplicate, items)
  );

  const collapsed = collapseSemanticDuplicates([duplicate, withPdf, different], {
    'canonical-pdf': items,
    'duplicate-empty': items,
    'different-items': different.document_snapshot.items
  });
  assert.equal(collapsed.rows.length, 2);
  assert.equal(collapsed.rows.find((row) => row.id === 'canonical-pdf' || row.id === 'duplicate-empty')?.id, 'canonical-pdf');
  assert.ok(collapsed.duplicateIds.includes('duplicate-empty'));
  assert.ok(collapsed.rows.some((row) => row.id === 'different-items'));
});

test('archive rules keep plain sent current and put superseded/cancelled in archive only', () => {
  const currentSent = { id: 's1', status: 'sent', version_number: 1, proposal_series_id: 'series-a' };
  const oldVersion = { id: 's0', status: 'sent', version_number: 1, proposal_series_id: 'series-b' };
  const newVersion = { id: 's2', status: 'draft', version_number: 2, proposal_series_id: 'series-b', supersedes_proposal_id: 's0' };
  const cancelled = { id: 'c1', status: 'cancelled', version_number: 1 };
  const all = [currentSent, oldVersion, newVersion, cancelled];

  assert.equal(isArchivedClientProposal(currentSent, all), false);
  assert.equal(isArchivedClientProposal(oldVersion, all), true);
  assert.equal(isArchivedClientProposal(newVersion, all), false);
  assert.equal(isArchivedClientProposal(cancelled, all), true);

  const current = all.filter((row) => !isArchivedClientProposal(row, all));
  const archive = all.filter((row) => isArchivedClientProposal(row, all));
  assert.equal(current.filter((row) => archive.some((other) => other.id === row.id)).length, 0);
  assert.ok(current.some((row) => row.id === 's1'));
  assert.ok(archive.some((row) => row.id === 's0'));
  assert.ok(archive.some((row) => row.id === 'c1'));
});

test('כל ההצעות opens the legacy proposals table immediately', async () => {
  const viewState = stateFor({ manage: true, role: 'admin' });
  const data = {
    rows: [
      { id: '1', client_authority: 'נתניה', school_framework: 'ריגלר', activity_type_group: 'next_year', status: 'draft', proposal_date: '2026-06-28', total_amount: 22600 },
      { id: '2', client_authority: 'תל אביב', school_framework: 'אלון', activity_type_group: 'summer', status: 'draft', proposal_date: '2026-05-01', total_amount: 1000 }
    ],
    contactOptions: []
  };
  const html = proposalsAgreementsScreen.render(data, { state: viewState });
  await withJSDOM(html, async (root, dom) => {
    const api = { readProposalAgreementItems: async () => [] };
    proposalsAgreementsScreen.bind({ root, data: structuredClone(data), state: viewState, api });
    root.querySelector('[data-pa-client-all-proposals]')?.click();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(root.querySelector('[data-pa-client-all]'), null, 'must not show the card-list intermediate screen');
    assert.equal(root.querySelector('.ds-page-header__title')?.textContent, 'הצעת מחיר');
    const legacy = root.querySelector('[data-pa-all-proposals-table]');
    assert.ok(legacy);
    assert.equal(legacy.getAttribute('aria-hidden'), 'false');
    assert.ok(root.querySelector('[data-pa-back-to-client-home]'));
    assert.match(root.querySelector('[data-pa-back-to-client-home]')?.textContent || '', /חזרה לתיק הלקוח/);
    assert.ok(root.querySelector('[data-pa-search]'));
    assert.ok(root.querySelector('[data-pa-filter="activity_type_group"]'));
    assert.ok(root.querySelector('[data-pa-filter="status"]'));
    assert.ok(root.querySelector('[data-pa-table-body]'));
    assert.match(root.querySelector('[data-pa-table-body]')?.textContent || '', /נתניה/);
    assert.match(root.querySelector('[data-pa-table-body]')?.textContent || '', /תל אביב/);
    const search = root.querySelector('[data-pa-search]');
    search.value = 'נתניה';
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 350));
    assert.match(root.querySelector('[data-pa-table-body]')?.textContent || '', /נתניה/);
    assert.doesNotMatch(root.querySelector('[data-pa-table-body]')?.textContent || '', /תל אביב/);
    root.querySelector('[data-pa-back-to-client-home]')?.click();
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(root.querySelector('[data-pa-client-home]'));
    assert.equal(root.querySelector('.ds-page-header__title')?.textContent, 'תיק לקוח');
    assert.equal(root.querySelector('[data-pa-all-proposals-table]')?.getAttribute('aria-hidden'), 'true');
  });
});

test('opening a board proposal opens details by id and returns to home queues', async () => {
  const viewState = stateFor({ manage: true, role: 'admin' });
  const row = {
    id: 'exact-id-77',
    client_authority: 'מטה יהודה',
    school_framework: 'מטה יהודה',
    activity_type_group: 'next_year',
    status: 'approved',
    proposal_date: '2026-06-28',
    total_amount: 85000,
    final_pdf_path: 'x.pdf',
    version_number: 1,
    school_id: '77'
  };
  const data = { rows: [row], contactOptions: [] };
  const html = proposalsAgreementsScreen.render(data, { state: viewState });
  await withJSDOM(html, async (root) => {
    const api = { readProposalAgreementItems: async () => sampleItems() };
    proposalsAgreementsScreen.bind({ root, data: structuredClone(data), state: viewState, api });
    const queueBtn = root.querySelector('[data-pa-open-proposal-id="exact-id-77"]');
    assert.ok(queueBtn, 'approved proposal should appear on the treatment board');
    assert.equal(queueBtn.getAttribute('data-pa-return-to'), 'home');
    queueBtn.click();
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(root.querySelector('[data-pa-proposal-detail]'), 'proposal detail opens immediately');
    assert.equal(root.querySelector('[data-pa-client-file]'), null, 'must not open client file first');
    assert.equal(root.querySelector('[data-pa-client-home]'), null, 'must leave the home board');
    assert.equal(root.querySelector('[data-pa-client-all]'), null, 'must not open all-proposals card list');
    assert.ok(root.querySelector('[data-pa-drawer][data-pa-drawer-id="exact-id-77"]'));
    assert.match(root.querySelector('[data-pa-proposal-detail-back]')?.textContent || '', /חזרה לתיק הלקוח/);
    assert.match(root.querySelector('.ds-page-header__title')?.textContent || '', /תשפ״ז|פרטי הצעה/);
    // Board open must not activate the all-proposals table as an intermediate step.
    assert.equal(root.querySelector('[data-pa-all-proposals-table]')?.getAttribute('aria-hidden'), 'true');
    root.querySelector('[data-pa-proposal-detail-back]')?.click();
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(root.querySelector('[data-pa-client-home]'), 'back returns to client-file home');
    assert.ok(root.querySelector('[data-pa-client-queues]'), 'treatment board queues are restored');
    assert.equal(root.querySelector('[data-pa-proposal-detail]'), null);
    assert.equal(root.querySelector('.ds-page-header__title')?.textContent, 'תיק לקוח');
  });
});

test('opening a proposal from a client file returns to that client file', async () => {
  const viewState = stateFor({ manage: true, role: 'admin' });
  const row = {
    id: 'client-prop-9',
    client_authority: 'נתניה',
    school_framework: 'ריגלר',
    activity_type_group: 'summer',
    status: 'draft',
    proposal_date: '2026-06-01',
    total_amount: 1200,
    version_number: 1,
    school_id: '9'
  };
  const data = { rows: [row], contactOptions: [] };
  const html = proposalsAgreementsScreen.render(data, { state: viewState });
  await withJSDOM(html, async (root, dom) => {
    const api = { readProposalAgreementItems: async () => [] };
    proposalsAgreementsScreen.bind({ root, data: structuredClone(data), state: viewState, api });
    const search = root.querySelector('[data-pa-client-search]');
    search.value = 'ריגלר';
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    root.querySelector('[data-pa-open-client]')?.click();
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(root.querySelector('[data-pa-client-file]'));
    root.querySelector('[data-pa-open-proposal-id="client-prop-9"]')?.click();
    await new Promise((r) => setTimeout(r, 40));
    assert.ok(root.querySelector('[data-pa-proposal-detail]'));
    assert.equal(root.querySelector('[data-pa-client-file]'), null);
    root.querySelector('[data-pa-proposal-detail-back]')?.click();
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(root.querySelector('[data-pa-client-file]'));
    assert.match(root.querySelector('[data-pa-client-file]')?.textContent || '', /ריגלר|נתניה/);
  });
});

test('opening a proposal from all-proposals table returns to the table with filters', async () => {
  const viewState = stateFor({ manage: true, role: 'admin' });
  const data = {
    rows: [
      { id: 'row-a', client_authority: 'מטה יהודה', school_framework: 'מטה יהודה', activity_type_group: 'next_year', status: 'approved', proposal_date: '2026-06-28', total_amount: 85000 },
      { id: 'row-b', client_authority: 'נתניה', school_framework: 'ריגלר', activity_type_group: 'summer', status: 'draft', proposal_date: '2026-05-01', total_amount: 1000 }
    ],
    contactOptions: []
  };
  const html = proposalsAgreementsScreen.render(data, { state: viewState });
  await withJSDOM(html, async (root, dom) => {
    const api = { readProposalAgreementItems: async () => [] };
    proposalsAgreementsScreen.bind({ root, data: structuredClone(data), state: viewState, api });
    root.querySelector('[data-pa-client-all-proposals]')?.click();
    await new Promise((r) => setTimeout(r, 0));
    const search = root.querySelector('[data-pa-search]');
    search.value = 'מטה';
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 350));
    assert.match(root.querySelector('[data-pa-table-body]')?.textContent || '', /מטה יהודה/);
    assert.doesNotMatch(root.querySelector('[data-pa-table-body]')?.textContent || '', /נתניה/);
    root.querySelector('[data-pa-row-id="row-a"]')?.click();
    await new Promise((r) => setTimeout(r, 40));
    assert.ok(root.querySelector('[data-pa-proposal-detail]'));
    assert.match(root.querySelector('[data-pa-proposal-detail-back]')?.textContent || '', /חזרה לכל ההצעות/);
    root.querySelector('[data-pa-proposal-detail-back]')?.click();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(root.querySelector('[data-pa-proposal-detail]'), null);
    assert.equal(root.querySelector('.ds-page-header__title')?.textContent, 'הצעת מחיר');
    assert.equal(root.querySelector('[data-pa-all-proposals-table]')?.getAttribute('aria-hidden'), 'false');
    assert.equal(root.querySelector('[data-pa-search]')?.value, 'מטה', 'filters must be preserved');
    assert.match(root.querySelector('[data-pa-table-body]')?.textContent || '', /מטה יהודה/);
    assert.doesNotMatch(root.querySelector('[data-pa-table-body]')?.textContent || '', /נתניה/);
  });
});

test('service worker version and activate-only cache cleanup', async () => {
  const sw = await readFile(SW_FILE, 'utf8');
  const config = await readFile(CONFIG_FILE, 'utf8');
  assert.match(sw, /const CACHE_VERSION = 1241;/);
  const installBlock = sw.match(/self\.addEventListener\('install',[\s\S]*?\n\}\);/)?.[0] || '';
  assert.doesNotMatch(installBlock, /deleteOutdatedCaches\(/);
  assert.match(sw, /self\.addEventListener\('activate'[\s\S]*deleteOutdatedCaches\(/);
  assert.match(sw, /clients\.claim/);
  assert.match(sw, /isApiLikeUrl/);
  assert.match(config, /client-contact-update-hotfix-20260720-v1/);
});

test('STATUS_LABELS remain available for filters', () => {
  assert.equal(STATUS_LABELS.sent, 'נשלח');
  assert.equal(STATUS_LABELS.draft, 'טיוטה');
});

test('instructors screens bind explicit navigation handlers', async () => {
  const instructors = await readFile(INSTRUCTORS_FILE, 'utf8');
  const contacts = await readFile(INSTRUCTOR_CONTACTS_FILE, 'utf8');
  assert.match(instructors, /app:navigate[\s\S]*instructor-contacts/);
  assert.match(contacts, /app:navigate[\s\S]*instructors/);
});

test('client file home header has title only and centered search toolbar', async () => {
  const html = proposalsAgreementsScreen.render({ rows: [], contactOptions: [] }, {
    state: {
      user: { role: 'admin', display_role: 'admin', manage_proposals_agreements: true, view_proposals_agreements: true },
      effectiveRoutes: ['proposals-agreements']
    }
  });
  assert.match(html, /ds-page-header__title">תיק לקוח</);
  assert.doesNotMatch(html, /ds-page-header__subtitle/);
  assert.doesNotMatch(html, /ממתינות לטיפול/);
  assert.match(html, /ds-client-toolbar/);
  assert.match(html, /width:min\(100%,480px\)/);
  assert.match(html, /ds-client-actions/);
});

test('home board has no close (X) button before a client is opened, and an opened archive starts closed', async () => {
  const manageState = stateFor({ manage: true, role: 'admin' });
  const current = { id: 'v1', client_authority: 'נתניה', school_framework: 'ריגלר', activity_type_group: 'next_year', status: 'sent', proposal_date: '2026-05-01', total_amount: 1000, version_number: 1, school_id: '1' };
  const archived = { id: 'v0', client_authority: 'נתניה', school_framework: 'ריגלר', activity_type_group: 'next_year', status: 'sent', proposal_date: '2026-04-01', total_amount: 900, version_number: 1, archived_at: '2026-04-02T00:00:00Z', school_id: '1' };
  const data = { rows: [current, archived], contactOptions: [] };
  const html = proposalsAgreementsScreen.render(data, { state: manageState });
  assert.equal(html.match(/data-pa-client-close/g), null, 'no close (X) button before any client file is open');
  await withJSDOM(html, async (root, dom) => {
    const api = { readProposalAgreementItems: async () => [] };
    proposalsAgreementsScreen.bind({ root, data: structuredClone(data), state: manageState, api });
    assert.equal(root.querySelector('[data-pa-client-close]'), null, 'home board still has no close button before opening a client');
    const search = root.querySelector('[data-pa-client-search]');
    search.value = 'ריגלר';
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    root.querySelector('[data-pa-open-client]')?.click();
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(root.querySelector('[data-pa-client-close]'), 'an X exists once a client file is open');
    const archiveDetails = root.querySelector('.ds-client-archive');
    assert.ok(archiveDetails, 'archive section renders');
    assert.equal(archiveDetails.hasAttribute('open'), false, 'archive must be collapsed by default');
  });
});

test('view-only users can see and open the sent-PDF action; users without access get none', async () => {
  const viewState = stateFor({ manage: false, role: 'business_development_manager' });
  const noAccessState = { user: { role: 'instructor', display_role: 'instructor' }, effectiveRoutes: [] };
  const row = {
    id: 'sent-pdf-1',
    client_authority: 'נתניה',
    school_framework: 'ריגלר',
    activity_type_group: 'summer',
    status: 'sent',
    proposal_date: '2026-06-28',
    total_amount: 5000,
    final_pdf_path: 'proposals/x/sent/1.pdf',
    version_number: 1,
    school_id: '1'
  };
  const data = { rows: [row], contactOptions: [] };

  const noAccessHtml = proposalsAgreementsScreen.render(data, { state: noAccessState });
  assert.match(noAccessHtml, /אין לך הרשאה לצפות במסך זה/, 'a user without proposals access must not see the screen');

  const viewHtml = proposalsAgreementsScreen.render(data, { state: viewState });
  await withJSDOM(viewHtml, async (root, dom) => {
    const api = { readProposalAgreementItems: async () => [] };
    proposalsAgreementsScreen.bind({ root, data: structuredClone(data), state: viewState, api });
    const search = root.querySelector('[data-pa-client-search]');
    search.value = 'ריגלר';
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    root.querySelector('[data-pa-open-client]')?.click();
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(root.querySelector('[data-pa-view-final-pdf="sent-pdf-1"]'), 'client card must show the sent-PDF action for a view-only user');
    root.querySelector('[data-pa-open-proposal-id="sent-pdf-1"]')?.click();
    await new Promise((r) => setTimeout(r, 40));
    assert.ok(root.querySelector('[data-pa-view-final-pdf="sent-pdf-1"]'), 'view-only user must see the sent-PDF action in the proposal detail view');
    assert.equal(root.querySelector('[data-pa-print]'), null, 'view-only user must not see the generate/print PDF action');
  });
});

test('all-proposals filters by authority, school and date range combine, and clearing restores every record', async () => {
  const manageState = stateFor({ manage: true, role: 'admin' });
  const data = {
    rows: [
      { id: 'r1', client_authority: 'נתניה', school_framework: 'ריגלר', activity_type_group: 'next_year', status: 'draft', proposal_date: '2026-06-10', total_amount: 1000 },
      { id: 'r2', client_authority: 'נתניה', school_framework: 'אחר', activity_type_group: 'next_year', status: 'draft', proposal_date: '2026-06-20', total_amount: 2000 },
      { id: 'r3', client_authority: 'תל אביב', school_framework: 'ריגלר', activity_type_group: 'summer', status: 'draft', proposal_date: '2026-07-01', total_amount: 3000 }
    ],
    contactOptions: []
  };
  const html = proposalsAgreementsScreen.render(data, { state: manageState });
  await withJSDOM(html, async (root, dom) => {
    const api = { readProposalAgreementItems: async () => [] };
    proposalsAgreementsScreen.bind({ root, data: structuredClone(data), state: manageState, api });
    root.querySelector('[data-pa-client-all-proposals]')?.click();
    await new Promise((r) => setTimeout(r, 0));

    const authorityFilter = root.querySelector('[data-pa-filter="client_authority"]');
    const schoolFilter = root.querySelector('[data-pa-filter="school_framework"]');
    const dateFrom = root.querySelector('[data-pa-filter="date_from"]');
    const dateTo = root.querySelector('[data-pa-filter="date_to"]');
    assert.ok(authorityFilter, 'authority filter must exist');
    assert.ok(schoolFilter, 'school/body filter must exist');
    assert.ok(dateFrom && dateTo, 'date range filters must exist');

    authorityFilter.value = 'נתניה';
    authorityFilter.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    let bodyText = root.querySelector('[data-pa-table-body]')?.textContent || '';
    assert.match(bodyText, /ריגלר/);
    assert.match(bodyText, /אחר/);
    assert.doesNotMatch(bodyText, /תל אביב/, 'authority filter must exclude other authorities');

    schoolFilter.value = 'ריגלר';
    schoolFilter.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    bodyText = root.querySelector('[data-pa-table-body]')?.textContent || '';
    assert.match(bodyText, /ריגלר/);
    assert.doesNotMatch(bodyText, /אחר/, 'authority + school filters must combine (AND), not override each other');

    schoolFilter.value = '';
    schoolFilter.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    dateFrom.value = '2026-06-15';
    dateFrom.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    dateTo.value = '2026-06-25';
    dateTo.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    bodyText = root.querySelector('[data-pa-table-body]')?.textContent || '';
    assert.doesNotMatch(bodyText, /ריגלר/, 'row dated 2026-06-10 is outside the date range');
    assert.match(bodyText, /אחר/, 'row dated 2026-06-20 is inside the date range');

    root.querySelector('[data-pa-clear-filters]')?.click();
    bodyText = root.querySelector('[data-pa-table-body]')?.textContent || '';
    assert.match(bodyText, /ריגלר/);
    assert.match(bodyText, /אחר/);
    assert.match(bodyText, /תל אביב/);
    assert.equal(authorityFilter.value, '', 'clear filters resets the authority filter');
    assert.equal(dateFrom.value, '', 'clear filters resets the date-from filter');
    assert.equal(dateTo.value, '', 'clear filters resets the date-to filter');
  });
});

test('client-file search debounces and keeps focus on the same input while typing', async () => {
  const manageState = stateFor({ manage: true, role: 'admin' });
  const data = {
    rows: [
      { id: 'r1', client_authority: 'נתניה', school_framework: 'ריגלר', activity_type_group: 'next_year', status: 'draft', proposal_date: '2026-06-10', total_amount: 1000, school_id: '1' }
    ],
    contactOptions: []
  };
  const html = proposalsAgreementsScreen.render(data, { state: manageState });
  await withJSDOM(html, async (root, dom) => {
    const api = { readProposalAgreementItems: async () => [] };
    proposalsAgreementsScreen.bind({ root, data: structuredClone(data), state: manageState, api });
    const search = root.querySelector('[data-pa-client-search]');
    const results = root.querySelector('[data-pa-client-search-results]');
    const beforeResultsHtml = results.innerHTML;
    search.focus();
    ['ר', 'רי', 'ריג'].forEach((partial) => {
      search.value = partial;
      search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(root.querySelector('[data-pa-client-search]'), search, 'the same input node stays in the DOM (no full re-render)');
    assert.equal(dom.window.document.activeElement, search, 'focus must stay on the search input while typing');
    assert.equal(results.innerHTML, beforeResultsHtml, 'results must not update before the debounce delay elapses');
    await new Promise((r) => setTimeout(r, 220));
    assert.match(results.textContent, /ריגלר/, 'results update once the debounce delay has elapsed');
    assert.equal(dom.window.document.activeElement, search, 'focus must remain after the debounced update');
  });
});

test('routine debug console dumps are removed while relied-on load diagnostics and error logs remain', async () => {
  const screenSource = await readFile(SCREEN_FILE, 'utf8');
  assert.doesNotMatch(screenSource, /\[proposal-schools-filter\]/, 'ad-hoc schools-filter debug dump must be removed');
  assert.doesNotMatch(screenSource, /\[proposal-save-payload\]/, 'ad-hoc save-payload debug dump must be removed');
  assert.doesNotMatch(screenSource, /PA_SAVE_ITEMS/, 'ad-hoc save-items debug dump must be removed');
  assert.doesNotMatch(screenSource, /semantic duplicates collapsed/, 'ad-hoc dedupe debug dump must be removed');
  // Diagnostics explicitly relied on elsewhere (see proposals-agreements-screen.test.mjs) must stay.
  assert.match(screenSource, /console\.info\('\[proposal-load-debug\]'/);
  assert.match(screenSource, /\[proposal-authorities-debug\]/);
  // Real error handling must remain untouched.
  assert.match(screenSource, /console\.warn\('\[client-file\] unknown proposal type value', raw\)/);
});
