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

  await withJSDOM(viewHtml, async (root) => {
    const api = { readProposalAgreementItems: async () => [] };
    proposalsAgreementsScreen.bind({ root, data: structuredClone(data), state: viewState, api });
    const openBtn = root.querySelector('[data-pa-open-client]');
    assert.ok(openBtn);
    delete openBtn.dataset.paOpenProposal;
    openBtn.click();
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(root.querySelector('[data-pa-client-file]'), 'view-only can open client file');
    assert.equal(root.querySelector('[data-pa-client-add-other]'), null);
    assert.equal(root.querySelector('[data-pa-client-add-proposal]'), null);
    assert.equal(root.querySelector('[data-pa-client-add-contact]'), null);
    assert.equal(root.querySelector('[data-pa-clone-row]'), null);
  });

  await withJSDOM(manageHtml, async (root) => {
    const api = { readProposalAgreementItems: async () => [] };
    proposalsAgreementsScreen.bind({ root, data: structuredClone(data), state: manageState, api });
    const openBtn = root.querySelector('[data-pa-open-client]');
    assert.ok(openBtn);
    delete openBtn.dataset.paOpenProposal;
    openBtn.click();
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

test('all-proposals search keeps focus while updating only the results list', async () => {
  const viewState = stateFor({ manage: true, role: 'admin' });
  const data = {
    rows: [
      { id: '1', client_authority: 'נתניה', school_framework: 'ריגלר', activity_type_group: 'next_year', status: 'sent', proposal_date: '2026-06-28', total_amount: 22600 },
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
    const form = root.querySelector('[data-pa-client-all-filters]');
    const input = form?.querySelector('input[name="q"]');
    assert.ok(form);
    assert.ok(input);
    input.focus();
    input.value = 'נ';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    input.value = 'נת';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    input.value = 'נתנ';
    input.setSelectionRange(3, 3);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.equal(dom.window.document.activeElement, input);
    assert.equal(input.selectionStart, 3);
    await new Promise((r) => setTimeout(r, 350));
    assert.equal(dom.window.document.activeElement, input);
    const list = root.querySelector('[data-pa-client-all-list]');
    assert.match(list?.textContent || '', /נתניה/);
    assert.doesNotMatch(list?.textContent || '', /תל אביב/);
    root.querySelector('[data-pa-client-clear-all-filters]')?.click();
    await new Promise((r) => setTimeout(r, 0));
    assert.match(root.querySelector('[data-pa-client-all-list]')?.textContent || '', /תל אביב/);
  });
});

test('opening a proposal uses the exact id and returns to the client file', async () => {
  const viewState = stateFor({ manage: true, role: 'admin' });
  const row = {
    id: 'exact-id-77',
    client_authority: 'נתניה',
    school_framework: 'ריגלר',
    activity_type_group: 'next_year',
    status: 'approved',
    proposal_date: '2026-06-28',
    total_amount: 22600,
    final_pdf_path: 'x.pdf',
    version_number: 1,
    school_id: '77'
  };
  const data = { rows: [row], contactOptions: [] };
  const html = proposalsAgreementsScreen.render(data, { state: viewState });
  await withJSDOM(html, async (root) => {
    const api = { readProposalAgreementItems: async () => sampleItems() };
    proposalsAgreementsScreen.bind({ root, data: structuredClone(data), state: viewState, api });
    const queueBtn = root.querySelector('[data-pa-open-proposal="exact-id-77"]');
    assert.ok(queueBtn, 'approved proposal should appear on the treatment board');
    queueBtn.click();
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(root.querySelector('[data-pa-client-file]'));
    // Drawer may still be loading items; wait a tick for openProposalDetails.
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(root.querySelector('[data-pa-drawer]'));
    root.querySelector('[data-pa-close-drawer]')?.click();
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(root.querySelector('[data-pa-client-file]'));
    assert.match(root.querySelector('[data-pa-client-file]')?.textContent || '', /ריגלר|נתניה/);
  });
});

test('service worker version and activate-only cache cleanup', async () => {
  const sw = await readFile(SW_FILE, 'utf8');
  const config = await readFile(CONFIG_FILE, 'utf8');
  assert.match(sw, /const CACHE_VERSION = 1235;/);
  const installBlock = sw.match(/self\.addEventListener\('install',[\s\S]*?\n\}\);/)?.[0] || '';
  assert.doesNotMatch(installBlock, /deleteOutdatedCaches\(/);
  assert.match(sw, /self\.addEventListener\('activate'[\s\S]*deleteOutdatedCaches\(/);
  assert.match(sw, /clients\.claim/);
  assert.match(sw, /isApiLikeUrl/);
  assert.match(config, /client-file-unified-20260720-v3/);
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
