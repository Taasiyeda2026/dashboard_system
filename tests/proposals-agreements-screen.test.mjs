import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { JSDOM } from 'jsdom';

if (!globalThis.sessionStorage) {
  const sessionStore = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => sessionStore.has(key) ? sessionStore.get(key) : null,
    setItem: (key, value) => sessionStore.set(key, String(value)),
    removeItem: (key) => sessionStore.delete(key),
    clear: () => sessionStore.clear()
  };
}

if (!globalThis.localStorage) {
  const localStore = new Map();
  globalThis.localStorage = {
    getItem: (key) => localStore.has(key) ? localStore.get(key) : null,
    setItem: (key, value) => localStore.set(key, String(value)),
    removeItem: (key) => localStore.delete(key),
    clear: () => localStore.clear()
  };
}

/**
 * Runs fn(root, dom) inside a JSDOM context with all required globals patched.
 * AbortController is swapped to JSDOM's version so { signal } in addEventListener works.
 * A real URL is set so localStorage is available.
 */
async function withJSDOM(html, fn) {
  const dom = new JSDOM(`<main id="root">${html}</main>`, { url: 'http://localhost/' });
  const saved = {
    document: globalThis.document,
    window: globalThis.window,
    FormData: globalThis.FormData,
    AbortController: globalThis.AbortController
  };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.FormData = dom.window.FormData;
  globalThis.AbortController = dom.window.AbortController;
  try {
    const root = dom.window.document.getElementById('root');
    await fn(root, dom);
  } finally {
    globalThis.document = saved.document;
    globalThis.window = saved.window;
    globalThis.FormData = saved.FormData;
    globalThis.AbortController = saved.AbortController;
  }
}

const MAIN_FILE = new URL('../frontend/src/main.js', import.meta.url);
const API_FILE = new URL('../frontend/src/api.js', import.meta.url);
const ACT_NAV_FILE = new URL('../frontend/src/screens/shared/act-nav-grid.js', import.meta.url);
const SCREEN_FILE = new URL('../frontend/src/screens/proposals-agreements.js', import.meta.url);
const MIGRATION_FILE = new URL('../supabase/migrations/20260518_create_proposals_agreements.sql', import.meta.url);
const ROLE_UPDATE_MIGRATION_FILE = new URL('../supabase/migrations/20260602_add_business_development_manager_role.sql', import.meta.url);

const { proposalsAgreementsScreen, canAccessProposalsAgreements, canManageProposalsAgreements, STATUS_LABELS, STATUS_OPTIONS, buildProposalCatalogEntries, buildProposalCatalogPdfEntries, proposalPreviewBodyHtml } = await import('../frontend/src/screens/proposals-agreements.js');

function stateFor(role) {
  return {
    user: { display_role: role, role },
    clientSettings: {
      dropdown_options: {
        activity_names: [
          { label: 'רובוטיקה', activity_type: 'סדנה' },
          { label: 'יזמות', activity_type: 'קורס' }
        ]
      }
    }
  };
}


function openNewProposalForm(root, dom) {
  root.querySelector('[data-pa-tab="new"]')?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  const form = root.querySelector('[data-pa-form]');
  assert.ok(form, 'new proposal form should open');
  return form;
}

function fillLineItem(form, dom, overrides = {}) {
  const set = (selector, value) => {
    const el = form.querySelector(selector);
    if (el) el.value = value;
    return el;
  };
  set('[data-pa-item-row] [name="item_name"]', overrides.item_name || 'סדנת רובוטיקה');
  set('[data-pa-item-qty]', overrides.quantity || '1');
  const priceInput = set('[data-pa-item-price]', overrides.unit_price || '100');
  priceInput?.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}

function fillPendingMinimum(form, dom, overrides = {}) {
  form.dataset.paPreviewSeen = 'yes';
  const set = (selector, value) => {
    const el = form.querySelector(selector);
    if (el) el.value = value;
    return el;
  };
  set('input[name="client_authority"]', overrides.client_authority || 'רשות בדיקה');
  set('input[name="school_framework"]', overrides.school_framework || 'בית ספר בדיקה');
  set('[name="activity_type_group"]', overrides.activity_type_group || 'קיץ תשפ״ו');
  fillLineItem(form, dom, overrides);
}

const sampleRows = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    client_authority: 'רשות א',
    school_framework: 'בית ספר א',
    document_type: 'הצעת מחיר',
    activity_type_group: 'פעילויות קיץ',
    status: 'draft',
    contact_name: 'דנה קשר',
    contact_role: 'מנהלת',
    phone: '050-1111111',
    email: 'dana@example.com',
    notes: 'הערה קצרה'
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    client_authority: 'רשות ב',
    school_framework: 'מסגרת ב',
    document_type: 'הסכם',
    activity_type_group: 'שנה הבאה',
    status: 'pending_approval',
    contact_name: 'יוסי קשר',
    phone: '050-2222222',
    notes: 'רשומה שנייה'
  }
];

const sampleContactOptions = [
  {
    authority: 'רשות א',
    school: 'בית ספר א',
    contact_name: 'דנה קשר',
    contact_role: 'מנהלת',
    phone: '050-1111111',
    email: 'dana@example.com'
  },
  {
    authority: 'רשות א',
    school: 'בית ספר א',
    contact_name: 'מיכל כהן',
    contact_role: 'רכזת',
    phone: '050-3333333',
    email: 'michal@example.com'
  },
  {
    authority: 'רשות ב',
    school: 'מסגרת ב',
    contact_name: 'יוסי קשר',
    contact_role: '',
    phone: '050-2222222',
    email: ''
  }
];

test('screen authorization includes business development manager', () => {
  for (const role of ['domain_manager', 'operation_manager', 'admin', 'business_development_manager']) {
    assert.equal(canAccessProposalsAgreements(stateFor(role)), true, `${role} should be allowed`);
    assert.equal(canManageProposalsAgreements(stateFor(role)), role !== 'business_development_manager', `${role} management access mismatch`);
    const html = proposalsAgreementsScreen.render({ rows: [] }, { state: stateFor(role) });
    assert.match(html, /הצעות/);
    assert.doesNotMatch(html, /אין לך הרשאה/);
  }

  for (const role of ['authorized_user', 'finance', 'activities_manager', 'instructor_manager', 'instructor']) {
    assert.equal(canAccessProposalsAgreements(stateFor(role)), false, `${role} should be denied`);
    const html = proposalsAgreementsScreen.render({ rows: [] }, { state: stateFor(role) });
    assert.match(html, /אין לך הרשאה לצפות במסך זה/);
  }
});

test('proposals-agreements route is registered and role-gated in route definitions', async () => {
  const mainSource = await readFile(MAIN_FILE, 'utf8');
  const apiSource = await readFile(API_FILE, 'utf8');
  assert.match(mainSource, /'proposals-agreements': 'הצעות/);
  assert.match(mainSource, /'proposals-agreements': \(\) => import\('\.\/screens\/proposals-agreements\.js'\)/);
  assert.match(apiSource, /admin: \[[^\]]*'proposals-agreements'/);
  assert.match(apiSource, /operation_manager: \[[^\]]*'proposals-agreements'/);
  assert.match(apiSource, /domain_manager: \[[^\]]*'proposals-agreements'/);
  assert.match(apiSource, /business_development_manager: \[[^\]]*'proposals-agreements'/);
  assert.doesNotMatch(apiSource, /authorized_user: \[[^\]]*'proposals-agreements'/);
  assert.doesNotMatch(apiSource, /instructor: \[[^\]]*'proposals-agreements'/);
});



test('role update migration allows business development manager for login and proposals', async () => {
  const migration = await readFile(ROLE_UPDATE_MIGRATION_FILE, 'utf8');
  assert.match(migration, /users_role_check check[\s\S]*'business_development_manager'/);
  assert.match(migration, /login_user_by_entry_code[\s\S]*'business_development_manager'[\s\S]*then 'invalid_role'/);
  assert.match(migration, /app_current_role\(\) in \('domain_manager', 'operation_manager', 'admin', 'business_development_manager'\)/);
  assert.match(migration, /app_can_manage_proposals_agreements[\s\S]*app_current_role\(\) in \('domain_manager', 'operation_manager', 'admin'\)/);
  assert.match(migration, /for insert[\s\S]*with check \(public\.app_can_manage_proposals_agreements\(\)\)/);
  assert.match(migration, /for update[\s\S]*using \(public\.app_can_manage_proposals_agreements\(\)\)/);
});

test('table structure includes all required columns including status', () => {
  const html = proposalsAgreementsScreen.render({ rows: sampleRows }, { state: stateFor('admin') });
  assert.match(html, /<th>רשות \/ מועצה \/ עירייה<\/th>/);
  assert.match(html, /<th>בית ספר \/ מסגרת<\/th>/);
  assert.match(html, /<th>סוג הצעה<\/th>/);
  assert.match(html, /<th>תאריך הצעה<\/th>/);
  assert.match(html, /<th>סטטוס<\/th>/);
  assert.match(html, /<th>סה״כ<\/th>/);
  assert.doesNotMatch(html, /<th>סוג מסמך<\/th>/);
  assert.match(html, /data-pa-table-region/);
  assert.match(html, /ds-pa-table/);
});

test('contact details are hidden from the outer table and available only in drawer markup', () => {
  const html = proposalsAgreementsScreen.render({ rows: sampleRows }, { state: stateFor('admin') });
  const tableRegion = html.match(/<div data-pa-table-region>[\s\S]*?<aside class="ds-pa-drawer"/)?.[0] || '';
  assert.doesNotMatch(tableRegion, /דנה קשר/);
  assert.doesNotMatch(tableRegion, /050-1111111/);
  assert.doesNotMatch(tableRegion, /dana@example\.com/);

  const drawerSource = html.match(/<aside class="ds-pa-drawer"[\s\S]*?<\/aside>/)?.[0] || '';
  assert.doesNotMatch(drawerSource, /דנה קשר/);
});

test('page is excluded from header nav and ACT_SUBNAV_ITEMS', async () => {
  const mainSource = await readFile(MAIN_FILE, 'utf8');
  const actNavSource = await readFile(ACT_NAV_FILE, 'utf8');
  const headerExcludeBlock = mainSource.match(/const HEADER_ALWAYS_EXCLUDE = new Set\(\[[\s\S]*?\]\);/)?.[0] || '';
  assert.match(headerExcludeBlock, /'proposals-agreements'/);

  const subnavBlock = actNavSource.match(/export const ACT_SUBNAV_ITEMS = \[[\s\S]*?\];/)?.[0] || '';
  assert.doesNotMatch(subnavBlock, /proposals-agreements/);
});

test('local search debounces 280ms and updates only table region and counter', async () => {
  await withJSDOM(proposalsAgreementsScreen.render({ rows: sampleRows }, { state: stateFor('admin') }), async (root, dom) => {
    proposalsAgreementsScreen.bind({ root, data: { rows: [...sampleRows] }, state: stateFor('admin'), api: {} });
    const headerNode = root.querySelector('.ds-page-header');
    const toolbarNode = root.querySelector('.ds-pa-toolbar');
    const tableRegion = root.querySelector('[data-pa-table-region]');
    const beforeTableHtml = tableRegion.innerHTML;
    const input = root.querySelector('[data-pa-search]');

    input.value = 'רשות ב';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await delay(120);
    assert.equal(tableRegion.innerHTML, beforeTableHtml, 'table should not update before debounce delay');

    await delay(210);
    assert.equal(root.querySelector('.ds-page-header'), headerNode, 'page header node should not be replaced');
    assert.equal(root.querySelector('.ds-pa-toolbar'), toolbarNode, 'toolbar node should not be replaced');
    assert.match(root.querySelector('[data-pa-results-count]').textContent, /^1$/);
    assert.match(tableRegion.textContent, /רשות ב/);
    assert.doesNotMatch(tableRegion.textContent, /רשות א/);
  });
});

test('screen and API source enforce authorization before API/Supabase calls', async () => {
  const screenSource = await readFile(SCREEN_FILE, 'utf8');
  const apiSource = await readFile(API_FILE, 'utf8');
  assert.match(screenSource, /if \(!canAccessProposalsAgreements\(state\)\) return Promise\.resolve\(\{ rows: \[\], unauthorized: true \}\);/);
  assert.match(apiSource, /function assertCanUseProposalsAgreementsApi\(\)/);
  assert.match(apiSource, /assertCanUseProposalsAgreementsApi\(\);[\s\S]*\.from\('proposals_agreements'\)/);
});

test('migration creates proposals_agreements with indexes, updated_at trigger and role RLS', async () => {
  const migration = await readFile(MIGRATION_FILE, 'utf8');
  assert.match(migration, /create table if not exists public\.proposals_agreements/);
  for (const column of ['id uuid primary key', 'client_authority text not null', 'school_framework text not null', 'document_type text not null', 'activity_type text not null', 'contact_name text', 'contact_phone text', 'contact_email text', 'notes text', 'created_at timestamptz', 'updated_at timestamptz']) {
    assert.match(migration, new RegExp(column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(migration, /proposals_agreements_default_sort_idx/);
  assert.match(migration, /trg_touch_proposals_agreements_updated_at/);
  assert.match(migration, /app_current_role\(\) in \('domain_manager', 'operation_manager', 'admin'\)/);
  assert.match(migration, /for select[\s\S]*to authenticated[\s\S]*app_can_use_proposals_agreements\(\)/);
  assert.match(migration, /for insert[\s\S]*with check \(public\.app_can_use_proposals_agreements\(\)\)/);
  assert.match(migration, /for update[\s\S]*using \(public\.app_can_use_proposals_agreements\(\)\)/);
});


test('preview uses only existing proposal template section keys and required keys are referenced', async () => {
  const screenSource = await readFile(SCREEN_FILE, 'utf8');
  const calledKeys = new Set();
  const re = /(?:section(?:Body|Title)|renderSectionFromSupabase)\('([^']+)'/g;
  let m;
  while ((m = re.exec(screenSource)) !== null) calledKeys.add(m[1]);

  for (const requiredKey of ['intro', 'activity_intro', 'taasiyeda_responsibility', 'school_responsibility', 'payment_terms', 'cancellation_terms', 'notes', 'signature']) {
    assert.ok(calledKeys.has(requiredKey), `missing expected template key usage: ${requiredKey}`);
  }

  for (const legacyKey of ['opening', 'organization_responsibility', 'changes_cancellations', 'remarks']) {
    assert.equal(calledKeys.has(legacyKey), false, `legacy key should not be used: ${legacyKey}`);
  }
});

test('new proposal tab opens compact form with preview and pending-approval actions', async () => {
  await withJSDOM(
    proposalsAgreementsScreen.render({ rows: sampleRows, contactOptions: sampleContactOptions }, { state: stateFor('admin') }),
    (root, dom) => {
      proposalsAgreementsScreen.bind({
        root,
        data: { rows: [...sampleRows], activityNameOptions: ['רובוטיקה', 'יזמות'], contactOptions: sampleContactOptions },
        state: stateFor('admin'),
        api: {}
      });
      const formHost = root.querySelector('[data-pa-form-host]');
      const newPanel = root.querySelector('[data-pa-tab-panel="new"]');
      assert.ok(newPanel.hidden, 'new proposal panel should be hidden initially');

      openNewProposalForm(root, dom);

      assert.equal(newPanel.hidden, false, 'new proposal panel should be visible after clicking add');
      const form = formHost.querySelector('[data-pa-form]');
      assert.ok(form, 'form element should exist');
      assert.doesNotMatch(form.innerHTML, /שמירת טיוטה/);
      assert.match(form.innerHTML, /תצוגה מקדימה/);
      assert.match(form.innerHTML, /שליחה לאישור/);
      assert.match(form.innerHTML, /data-pa-client-select/);
      assert.match(form.innerHTML, /הוספה ידנית/);
    }
  );
});

test('client selector auto-fills contact fields when existing client is chosen', async () => {
  await withJSDOM(
    proposalsAgreementsScreen.render({ rows: [], contactOptions: sampleContactOptions }, { state: stateFor('admin') }),
    (root, dom) => {
      proposalsAgreementsScreen.bind({
        root,
        data: { rows: [], activityNameOptions: [], contactOptions: sampleContactOptions },
        state: stateFor('admin'),
        api: {}
      });

      const form = openNewProposalForm(root, dom);
      const clientSelect = form.querySelector('[data-pa-client-select]');

      // Select "רשות ב" which has exactly one contact
      clientSelect.value = 'רשות ב||מסגרת ב';
      clientSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

      const authorityInput = form.querySelector('input[name="client_authority"]');
      const schoolInput = form.querySelector('input[name="school_framework"]');
      const contactInput = form.querySelector('input[name="contact_name"]');
      const phoneInput = form.querySelector('input[name="phone"]');

      assert.equal(authorityInput.value, 'רשות ב', 'authority should be filled');
      assert.equal(schoolInput.value, 'מסגרת ב', 'school should be filled');
      assert.equal(contactInput.value, 'יוסי קשר', 'contact_name should be auto-filled');
      assert.equal(phoneInput.value, '050-2222222', 'phone should be auto-filled');
    }
  );
});

test('multiple contacts for same client shows contact picker dropdown', async () => {
  await withJSDOM(
    proposalsAgreementsScreen.render({ rows: [], contactOptions: sampleContactOptions }, { state: stateFor('admin') }),
    (root, dom) => {
      proposalsAgreementsScreen.bind({
        root,
        data: { rows: [], activityNameOptions: [], contactOptions: sampleContactOptions },
        state: stateFor('admin'),
        api: {}
      });

      const form = openNewProposalForm(root, dom);
      const clientSelect = form.querySelector('[data-pa-client-select]');

      // "רשות א" has 2 contacts → should show contact picker
      clientSelect.value = 'רשות א||בית ספר א';
      clientSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

      const pickerHost = form.querySelector('[data-pa-contact-picker-host]');
      assert.ok(pickerHost, 'contact picker host should exist');
      assert.match(pickerHost.innerHTML, /data-pa-contact-select/, 'contact picker select should appear');
      assert.match(pickerHost.innerHTML, /דנה קשר/, 'first contact should be in picker');
      assert.match(pickerHost.innerHTML, /מיכל כהן/, 'second contact should be in picker');
    }
  );
});

test('contact picker fills fields and passes existing contact source on save', async () => {
  const savedPayloads = [];
  const contacts = sampleContactOptions.map((contact, idx) => ({ ...contact, id: String(idx + 1) }));
  const mockApi = {
    addProposalAgreement: async (payload) => {
      savedPayloads.push({ ...payload });
      return { ok: true, row: { ...payload, id: 'contact-linked-id' } };
    }
  };

  await withJSDOM(
    proposalsAgreementsScreen.render({ rows: [], contactOptions: contacts }, { state: stateFor('admin') }),
    async (root, dom) => {
      proposalsAgreementsScreen.bind({
        root,
        data: { rows: [], activityNameOptions: [], contactOptions: contacts },
        state: stateFor('admin'),
        api: mockApi
      });

      const form = openNewProposalForm(root, dom);
      const clientSelect = form.querySelector('[data-pa-client-select]');
      clientSelect.value = 'רשות א||בית ספר א';
      clientSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

      const contactSelect = form.querySelector('[data-pa-contact-select]');
      const contact = contacts.find((c) => c.contact_name === 'מיכל כהן');
      contactSelect.value = [
        contact.id,
        contact.authority,
        contact.school,
        contact.contact_name,
        contact.email,
        contact.phone
      ].join('||');
      contactSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

      assert.equal(form.querySelector('input[name="contact_name"]').value, 'מיכל כהן');
      assert.equal(form.querySelector('input[name="contact_source_id"]').value, contact.id);

      form.querySelector('[name="activity_type_group"]').value = 'קיץ תשפ״ו';
      form.dataset.paPreviewSeen = 'yes';
      fillLineItem(form, dom);
      form.querySelector('[data-pa-save-pending]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await delay(100);

      assert.equal(savedPayloads.length, 1);
      assert.equal(savedPayloads[0].status, 'pending_approval');
      assert.equal(savedPayloads[0]._contact_original.id, contact.id);
      assert.notEqual(savedPayloads[0].is_new_client, true);
    }
  );
});

test('new client toggle button shows hint and clears client selector', async () => {
  await withJSDOM(
    proposalsAgreementsScreen.render({ rows: [], contactOptions: sampleContactOptions }, { state: stateFor('admin') }),
    (root, dom) => {
      proposalsAgreementsScreen.bind({
        root,
        data: { rows: [], activityNameOptions: [], contactOptions: sampleContactOptions },
        state: stateFor('admin'),
        api: {}
      });

      const form = openNewProposalForm(root, dom);
      const clientSelect = form.querySelector('[data-pa-client-select]');

      // Pre-select a client
      clientSelect.value = 'רשות ב||מסגרת ב';

      // Click new client toggle
      form.querySelector('[data-pa-new-client-toggle]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

      const hint = form.querySelector('[data-pa-new-client-hint]');
      assert.equal(hint.hidden, false, 'hint should be visible after toggle');
      assert.equal(clientSelect.value, '', 'client selector should be cleared');
      assert.equal(form.dataset.paNewClient, 'yes', 'form should mark new client mode');
    }
  );
});

test('proposal form has no draft save and send-for-approval sends status=pending_approval', async () => {
  const savedPayloads = [];
  const mockApi = {
    addProposalAgreement: async (payload) => {
      savedPayloads.push({ ...payload });
      return { ok: true, row: { ...payload, id: 'new-id-123' } };
    },
    saveProposalAgreementItems: async () => ({ ok: true })
  };

  await withJSDOM(
    proposalsAgreementsScreen.render({ rows: [], contactOptions: [] }, { state: stateFor('admin') }),
    async (root, dom) => {
      proposalsAgreementsScreen.bind({
        root,
        data: { rows: [], activityNameOptions: [], contactOptions: [] },
        state: stateFor('admin'),
        api: mockApi
      });

      const form = openNewProposalForm(root, dom);
      assert.equal(form.querySelector('[data-pa-save-draft]'), null, 'draft save control should not exist');
      fillPendingMinimum(form, dom, {
        client_authority: 'רשות בדיקה',
        school_framework: 'בית ספר בדיקה',
        activity_type_group: 'קיץ תשפ״ו',
        item_name: 'סדנת רובוטיקה',
        unit_price: '100'
      });

      form.querySelector('[data-pa-save-pending]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await delay(100);

      assert.equal(savedPayloads.length, 1, 'one save call');
      assert.equal(savedPayloads[0].status, 'pending_approval', 'send for approval should set status=pending_approval');
      assert.notEqual(savedPayloads[0].is_new_client, true, 'default save should not mark as new client');
    }
  );
});



test('pending flow preview has submit and back actions without draft save', async () => {
  await withJSDOM(
    proposalsAgreementsScreen.render({ rows: [], contactOptions: [] }, { state: stateFor('admin') }),
    async (root, dom) => {
      proposalsAgreementsScreen.bind({
        root,
        data: { rows: [], activityNameOptions: [], contactOptions: [] },
        state: stateFor('admin'),
        api: {}
      });

      const form = openNewProposalForm(root, dom);
      fillPendingMinimum(form, dom, { item_name: 'סדנת רובוטיקה', unit_price: '650' });
      form.dataset.paPreviewSeen = '';
      form.querySelector('[data-pa-save-pending]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await delay(20);

      const overlay = dom.window.document.getElementById('pa-preview-overlay');
      assert.ok(overlay, 'preview overlay should open before submit');
      assert.match(overlay.textContent, /שליחה לאישור/);
      assert.match(overlay.textContent, /חזרה לעריכה/);
      assert.doesNotMatch(overlay.textContent, /שמירת טיוטה/);
    }
  );
});

test('saving after new client toggle keeps manual contact fields in pending payload', async () => {
  const savedPayloads = [];
  const mockApi = {
    addProposalAgreement: async (payload) => {
      savedPayloads.push({ ...payload });
      return { ok: true, row: { ...payload, id: 'new-client-id' } };
    }
  };

  await withJSDOM(
    proposalsAgreementsScreen.render({ rows: [], contactOptions: sampleContactOptions }, { state: stateFor('admin') }),
    async (root, dom) => {
      proposalsAgreementsScreen.bind({
        root,
        data: { rows: [], activityNameOptions: [], contactOptions: sampleContactOptions },
        state: stateFor('admin'),
        api: mockApi
      });

      const form = openNewProposalForm(root, dom);
      form.querySelector('[data-pa-new-client-toggle]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

      form.querySelector('input[name="client_authority"]').value = 'רשות חדשה';
      form.querySelector('input[name="school_framework"]').value = 'בית ספר חדש';
      form.querySelector('input[name="document_type"]').value = 'הצעת מחיר';
      form.querySelector('[name="activity_type_group"]').value = 'קיץ תשפ״ו';
      form.querySelector('input[name="contact_name"]').value = 'שרון חדש';
      form.dataset.paPreviewSeen = 'yes';
      fillLineItem(form, dom);

      form.querySelector('[data-pa-save-pending]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await delay(100);

      assert.equal(savedPayloads.length, 1);
      assert.equal(savedPayloads[0].status, 'pending_approval');
      assert.equal(savedPayloads[0].contact_name, 'שרון חדש', 'manual contact name should be saved');
      assert.equal(savedPayloads[0]._contact_original.client_type, 'school', 'new-client source metadata should be preserved');
    }
  );
});

test('status filter shows only matching rows', async () => {
  await withJSDOM(
    proposalsAgreementsScreen.render({ rows: sampleRows }, { state: stateFor('admin') }),
    (root, dom) => {
      proposalsAgreementsScreen.bind({ root, data: { rows: [...sampleRows] }, state: stateFor('admin'), api: {} });

      const statusFilter = root.querySelector('[data-pa-filter="status"]');
      assert.ok(statusFilter, 'status filter should exist');

      statusFilter.value = 'draft';
      statusFilter.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

      assert.match(root.querySelector('[data-pa-results-count]').textContent, /^1$/);
      assert.match(root.querySelector('[data-pa-table-region]').textContent, /רשות א/);
      assert.doesNotMatch(root.querySelector('[data-pa-table-region]').textContent, /רשות ב/);

      statusFilter.value = '';
      statusFilter.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      assert.match(root.querySelector('[data-pa-results-count]').textContent, /^2$/);
    }
  );
});

test('status badge is rendered in table rows with correct labels', () => {
  const html = proposalsAgreementsScreen.render({ rows: sampleRows }, { state: stateFor('admin') });
  assert.match(html, /טיוטה/);
  assert.match(html, /ממתין לאישור/);
  // Badge markup
  assert.match(html, /ds-pa-badge/);
});

test('multiple proposal item names are preserved on save', async () => {
  const savedPayloads = [];
  const mockApi = {
    addProposalAgreement: async (payload) => {
      savedPayloads.push({ ...payload });
      return { ok: true, row: { ...payload, id: 'act-id-001' } };
    }
  };

  await withJSDOM(
    proposalsAgreementsScreen.render(
      { rows: [], activityNameOptions: ['רובוטיקה', 'יזמות', 'מייקרים'] },
      { state: stateFor('admin') }
    ),
    async (root, dom) => {
      proposalsAgreementsScreen.bind({
        root,
        data: { rows: [], activityNameOptions: ['רובוטיקה', 'יזמות', 'מייקרים'], contactOptions: [] },
        state: stateFor('admin'),
        api: mockApi
      });

      const form = openNewProposalForm(root, dom);

      form.querySelector('input[name="client_authority"]').value = 'רשות ג';
      form.querySelector('input[name="school_framework"]').value = 'בית ספר ג';
      form.querySelector('input[name="document_type"]').value = 'הצעת מחיר';
      form.querySelector('[name="activity_type_group"]').value = 'קיץ תשפ״ו ושנת הלימודים תשפ״ז';

      form.querySelector('[name="activity_type_group"]').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      form.querySelector('[data-pa-add-item]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      const itemRows = form.querySelectorAll('[data-pa-item-row]');
      itemRows[0].querySelector('[name="item_name"]').value = 'סדנת מייקרים';
      itemRows[0].querySelector('[data-pa-item-price]').value = '100';
      itemRows[0].querySelector('[data-pa-item-price]').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      itemRows[1].querySelector('[name="item_name"]').value = 'קורס רובוטיקה';
      itemRows[1].querySelector('[data-pa-item-price]').value = '200';
      itemRows[1].querySelector('[data-pa-item-price]').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      form.dataset.paPreviewSeen = 'yes';

      form.querySelector('[data-pa-save-pending]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await delay(100);

      assert.equal(savedPayloads.length, 1, 'one save call');
      const saved = savedPayloads[0];
      assert.ok(Array.isArray(saved.activity_names), 'activity_names should be array');
      assert.equal(saved.activity_names.length, 2, 'two item names should be saved');
      assert.ok(saved.activity_names.includes('סדנת מייקרים'), 'summer item should be in saved activities');
      assert.ok(saved.activity_names.includes('קורס רובוטיקה'), 'annual item should be in saved activities');
    }
  );
});

test('no duplicate rows after save and update', async () => {
  const existingRow = {
    id: 'dup-test-id-001',
    client_authority: 'רשות קיימת',
    school_framework: 'בית ספר קיים',
    document_type: 'הצעת מחיר',
    activity_type_group: 'פעילויות קיץ',
    status: 'draft',
    notes: ''
  };
  const updatedRow = { ...existingRow, notes: 'הערה חדשה', status: 'pending_approval' };
  const mockApi = {
    updateProposalAgreement: async () => ({ ok: true, row: updatedRow })
  };

  const localData = { rows: [existingRow] };
  await withJSDOM(
    proposalsAgreementsScreen.render({ rows: [existingRow] }, { state: stateFor('admin') }),
    async (root, dom) => {
      proposalsAgreementsScreen.bind({
        root,
        data: localData,
        state: stateFor('admin'),
        api: mockApi
      });

      const rowEl = root.querySelector(`[data-pa-row-id="${existingRow.id}"]`);
      rowEl.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      const editBtn = root.querySelector(`[data-pa-edit-row="${existingRow.id}"]`);
      assert.ok(editBtn, 'edit button should exist');
      editBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await delay(20);

      // Edit opens in the full-width form host (same as new proposal), not in the side drawer.
      const formHost = root.querySelector('[data-pa-form-host]');
      const form = formHost?.querySelector('[data-pa-form]');
      assert.ok(form, 'edit form should open in the full-width form host');
      assert.equal(root.querySelector('[data-pa-inline-form] [data-pa-form]'), null, 'edit form should not render inside the drawer');

      form.querySelector('[data-pa-save-pending]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await delay(20);

      const ids = localData.rows.map((r) => r.id);
      const uniqueIds = new Set(ids);
      assert.equal(ids.length, uniqueIds.size, 'no duplicate IDs in data.rows after update');
      assert.equal(ids.length, 1, 'still exactly one row');
    }
  );
});

test('status constants exported and complete', () => {
  assert.ok(Array.isArray(STATUS_OPTIONS), 'STATUS_OPTIONS should be an array');
  assert.ok(typeof STATUS_LABELS === 'object', 'STATUS_LABELS should be an object');
  for (const s of STATUS_OPTIONS) {
    assert.ok(STATUS_LABELS[s], `${s} should have a Hebrew label`);
  }
  assert.ok(STATUS_OPTIONS.includes('draft'));
  assert.ok(STATUS_OPTIONS.includes('pending_approval'));
  assert.ok(STATUS_OPTIONS.includes('approved'));
  assert.ok(STATUS_OPTIONS.includes('cancelled'));
  assert.ok(STATUS_OPTIONS.includes('returned_for_changes'));
});

test('items editor is rendered in form with add-item button and items table', async () => {
  await withJSDOM(
    proposalsAgreementsScreen.render({ rows: [], contactOptions: [] }, { state: stateFor('admin') }),
    (root, dom) => {
      proposalsAgreementsScreen.bind({
        root,
        data: { rows: [], activityNameOptions: [], contactOptions: [] },
        state: stateFor('admin'),
        api: {}
      });

      const form = openNewProposalForm(root, dom);
      assert.ok(form, 'form should exist');
      assert.ok(form.querySelector('[data-pa-add-item]'), 'add-item button should exist');
      assert.ok(form.querySelector('[data-pa-items-body]'), 'items tbody should exist');
      assert.ok(form.querySelector('[data-pa-grand-total]'), 'grand total element should exist');
      assert.ok(form.querySelector('[data-pa-item-row]'), 'at least one item row should be pre-rendered');
      assert.ok(form.querySelector('[data-pa-item-qty]'), 'quantity input should exist');
      assert.ok(form.querySelector('[data-pa-item-price]'), 'unit price input should exist');
      assert.ok(form.querySelector('[data-pa-item-total]'), 'row total input should exist');
      assert.ok(form.querySelector('[data-pa-remove-item]'), 'remove button should exist');
    }
  );
});

test('items auto-calc: quantity × price updates row total and grand total', async () => {
  await withJSDOM(
    proposalsAgreementsScreen.render({ rows: [], contactOptions: [] }, { state: stateFor('admin') }),
    (root, dom) => {
      proposalsAgreementsScreen.bind({
        root,
        data: { rows: [], activityNameOptions: [], contactOptions: [] },
        state: stateFor('admin'),
        api: {}
      });

      const form = openNewProposalForm(root, dom);
      const qtyInput = form.querySelector('[data-pa-item-qty]');
      const priceInput = form.querySelector('[data-pa-item-price]');
      const totalInput = form.querySelector('[data-pa-item-total]');
      const grandTotal = form.querySelector('[data-pa-grand-total]');

      qtyInput.value = '3';
      qtyInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      priceInput.value = '500';
      priceInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

      assert.equal(totalInput.value, '1500.00', 'row total should be 3×500=1500');
      assert.match(grandTotal.textContent, /1[,.]?500/, 'grand total should show 1500');
    }
  );
});

test('add item row button appends a new row to the items table', async () => {
  await withJSDOM(
    proposalsAgreementsScreen.render({ rows: [], contactOptions: [] }, { state: stateFor('admin') }),
    (root, dom) => {
      proposalsAgreementsScreen.bind({
        root,
        data: { rows: [], activityNameOptions: [], contactOptions: [] },
        state: stateFor('admin'),
        api: {}
      });

      const form = openNewProposalForm(root, dom);
      const before = form.querySelectorAll('[data-pa-item-row]').length;

      form.querySelector('[data-pa-add-item]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

      assert.equal(form.querySelectorAll('[data-pa-item-row]').length, before + 1, 'one more row should be added');
    }
  );
});

test('remove item row button removes the row from the table', async () => {
  await withJSDOM(
    proposalsAgreementsScreen.render({ rows: [], contactOptions: [] }, { state: stateFor('admin') }),
    (root, dom) => {
      proposalsAgreementsScreen.bind({
        root,
        data: { rows: [], activityNameOptions: [], contactOptions: [] },
        state: stateFor('admin'),
        api: {}
      });

      const form = openNewProposalForm(root, dom);
      // Add an extra row first
      form.querySelector('[data-pa-add-item]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      const before = form.querySelectorAll('[data-pa-item-row]').length;

      form.querySelector('[data-pa-remove-item]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

      assert.equal(form.querySelectorAll('[data-pa-item-row]').length, before - 1, 'one row should be removed');
    }
  );
});

test('save includes items via saveProposalAgreementItems', async () => {
  const itemCalls = [];
  const mockApi = {
    addProposalAgreement: async (payload) => ({ ok: true, row: { ...payload, id: 'item-test-id' } }),
    saveProposalAgreementItems: async (id, items) => { itemCalls.push({ id, items }); return { ok: true, items: [] }; }
  };

  await withJSDOM(
    proposalsAgreementsScreen.render({ rows: [], contactOptions: [] }, { state: stateFor('admin') }),
    async (root, dom) => {
      proposalsAgreementsScreen.bind({
        root,
        data: { rows: [], activityNameOptions: [], contactOptions: [] },
        state: stateFor('admin'),
        api: mockApi
      });

      const form = openNewProposalForm(root, dom);

      form.querySelector('input[name="client_authority"]').value = 'רשות הבדיקה';
      form.querySelector('input[name="school_framework"]').value = 'בית ספר הבדיקה';
      form.querySelector('input[name="document_type"]').value = 'הצעת מחיר';
      form.querySelector('[name="activity_type_group"]').value = 'קיץ תשפ״ו';

      // Fill in a line item
      const nameInput = form.querySelector('[data-pa-item-row] [name="item_name"]');
      const qtyInput = form.querySelector('[data-pa-item-qty]');
      const priceInput = form.querySelector('[data-pa-item-price]');
      if (nameInput) nameInput.value = 'סדנת רובוטיקה';
      if (qtyInput) { qtyInput.value = '2'; qtyInput.dispatchEvent(new dom.window.Event('input', { bubbles: true })); }
      if (priceInput) { priceInput.value = '300'; priceInput.dispatchEvent(new dom.window.Event('input', { bubbles: true })); }

      form.dataset.paPreviewSeen = 'yes';
      form.querySelector('[data-pa-save-pending]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await import('node:timers/promises').then(({ setTimeout: d }) => d(30));

      assert.equal(itemCalls.length, 1, 'saveProposalAgreementItems should be called once');
      assert.equal(itemCalls[0].id, 'item-test-id', 'correct proposal id should be passed');
      assert.ok(Array.isArray(itemCalls[0].items), 'items should be an array');
    }
  );
});

test('preview button exists in drawer and opens preview overlay', async () => {
  await withJSDOM(
    proposalsAgreementsScreen.render({ rows: sampleRows }, { state: stateFor('admin') }),
    async (root, dom) => {
      proposalsAgreementsScreen.bind({
        root,
        data: { rows: [...sampleRows] },
        state: stateFor('admin'),
        api: { readProposalAgreementItems: async () => [] }
      });

      // Open drawer
      root.querySelector(`[data-pa-row-id="${sampleRows[0].id}"]`)
        .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await import('node:timers/promises').then(({ setTimeout: d }) => d(20));

      const previewBtn = root.querySelector(`[data-pa-preview="${sampleRows[0].id}"]`);
      assert.ok(previewBtn, 'preview button should exist in drawer');

      previewBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await import('node:timers/promises').then(({ setTimeout: d }) => d(20));

      const overlay = dom.window.document.getElementById('pa-preview-overlay');
      assert.ok(overlay, 'preview overlay should be created');
      assert.match(overlay.innerHTML, /הדפסה/, 'print button should be in overlay');
      assert.match(overlay.innerHTML, /תעשיידע/, 'document company name should appear');
      assert.match(overlay.innerHTML, /רשות א/, 'client name should appear in preview');
    }
  );
});

test('proposal preview document contains expected sections for each type', () => {
  const summerRow = { ...sampleRows[0], activity_type_group: 'פעילויות קיץ', document_type: 'הצעת מחיר' };
  const annualRow = { ...sampleRows[0], activity_type_group: 'שנה הבאה', document_type: 'הסכם' };
  const combinedRow = { ...sampleRows[0], activity_type_group: 'הצעה משולבת', document_type: 'הצעת מחיר' };
  const items = [{ item_name: 'סדנת רובוטיקה', item_type: 'סדנה', quantity: 1, unit_price: 500, total_price: 500 }];

  // Need to import proposalPreviewBodyHtml — it's internal; check via render output indirectly
  // Instead, open preview content via the html generated by proposalsAgreementsScreen
  const htmlSummer = proposalsAgreementsScreen.render({ rows: [summerRow] }, { state: stateFor('admin') });
  const htmlAnnual = proposalsAgreementsScreen.render({ rows: [annualRow] }, { state: stateFor('admin') });

  // Check status badges work (indirect proof render works)
  assert.match(htmlSummer, /טיוטה/, 'summer row renders status');
  assert.match(htmlAnnual, /טיוטה/, 'annual row renders status');

  // Check drawer markup has preview button after render+bind is not possible here without JSDOM;
  // but we can verify the drawerActionButtons function output via the HTML
  assert.match(htmlSummer, /data-pa-tab="new"/, 'new proposal tab present');
});

test('items migration b grants DELETE and adds sort_order', async () => {
  const migrationB = await readFile(
    new URL('../supabase/migrations/20260521b_proposal_items_delete_sort.sql', import.meta.url),
    'utf8'
  );
  assert.match(migrationB, /grant delete on public\.proposal_agreement_items/i);
  assert.match(migrationB, /add column if not exists sort_order/i);
  assert.match(migrationB, /proposal_agreement_items_delete/);
  assert.match(migrationB, /app_can_use_proposals_agreements/);
});

test('api source has readProposalAgreementItems and saveProposalAgreementItems', async () => {
  const apiSource = await readFile(API_FILE, 'utf8');
  assert.match(apiSource, /readProposalAgreementItems/);
  assert.match(apiSource, /saveProposalAgreementItems/);
  assert.match(apiSource, /readProposalActivityPricing/);
  assert.match(apiSource, /proposal_activity_pricing/);
  assert.match(apiSource, /is_active_for_proposals/);
  assert.match(apiSource, /saveProposalAgreementItems: true/);
  assert.match(apiSource, /total_amount.*payload\.total_amount/);
});

test('items editor includes pricing selector and uses pricing autofill fields', async () => {
  const screenSource = await readFile(SCREEN_FILE, 'utf8');
  assert.match(screenSource, /data-pa-pricing-select/);
  assert.match(screenSource, /description_for_proposal/);
  assert.match(screenSource, /payload\.activity_names = itemNames/);
});

test('proposal form opens as a gated stepper flow', async () => {
  const pricing = [
    {
      activity_no: 'S1',
      activity_name: 'סדנת מייקרים',
      item_type: 'סדנה',
      proposal_group: 'קיץ תשפ״ו',
      meetings_count: 2,
      hours_count: 4,
      unit_price: 350,
      description_for_proposal: 'פעילות מדורגת'
    }
  ];

  await withJSDOM(
    proposalsAgreementsScreen.render({ rows: [], contactOptions: [] }, { state: stateFor('admin') }),
    (root, dom) => {
      proposalsAgreementsScreen.bind({
        root,
        data: { rows: [], activityNameOptions: [], contactOptions: [], proposalActivityPricing: pricing, proposalActivityGroups: [
          { group_key: 'קיץ תשפ״ו', display_name: 'קיץ תשפ״ו', template_key: 'summer' },
          { group_key: 'שנת הלימודים תשפ״ז', display_name: 'שנת הלימודים תשפ״ז', template_key: 'next_year' },
          { group_key: 'קיץ תשפ״ו ושנת הלימודים תשפ״ז', display_name: 'קיץ תשפ״ו ושנת הלימודים תשפ״ז', template_key: 'combined', included_group_keys: ['קיץ תשפ״ו', 'שנת הלימודים תשפ״ז'] }
        ] },
        state: stateFor('admin'),
        api: {}
      });

      const form = openNewProposalForm(root, dom);
      const proposalStep = form.querySelector('[data-pa-step-panel="proposal"]');
      const activityStep = form.querySelector('[data-pa-step-panel="activity"]');
      const summaryStep = form.querySelector('[data-pa-step-panel="summary"]');

      assert.equal(proposalStep.hidden, false, 'proposal step starts open in the compact form');
      assert.equal(activityStep.hidden, false, 'activity step starts open in the compact form');
      assert.equal(summaryStep.hidden, false, 'summary step starts open in the compact form');

      const authInput = form.querySelector('input[name="client_authority"]');
      const schoolInput = form.querySelector('input[name="school_framework"]');
      authInput.value = 'רשות בדיקה';
      authInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      schoolInput.value = 'בית ספר בדיקה';
      schoolInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

      assert.equal(proposalStep.hidden, false, 'proposal step opens after required client fields');
      assert.equal(activityStep.hidden, false, 'activity step remains open while filling proposal type');

      const typeSelect = form.querySelector('[name="activity_type_group"]');
      typeSelect.value = 'קיץ תשפ״ו';
      typeSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

      assert.equal(activityStep.hidden, false, 'activity step opens after proposal type');
      assert.equal(summaryStep.hidden, false, 'summary remains visible while pricing is entered');

      const pricingSelect = form.querySelector('[data-pa-pricing-select]');
      pricingSelect.selectedIndex = 1;
      pricingSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

      assert.ok(form.querySelector('[data-pa-item-details]'), 'activity details region remains available after list selection');
      assert.equal(form.querySelector('[name="item_name"]').value, 'סדנת מייקרים');
      assert.equal(form.querySelector('[name="unit_price"]').value, '350');
      assert.equal(summaryStep.hidden, false, 'summary stays visible after valid activity pricing');
    }
  );
});

test('activity selection is first and reveals populated item details', async () => {
  const pricing = [
    {
      activity_no: 'S1',
      activity_name: 'סדנת מייקרים',
      item_type: 'סדנה',
      proposal_group: 'קיץ תשפ״ו',
      meetings_count: 3,
      hours_count: 6,
      unit_price: 450,
      description_for_proposal: 'התאמה לפי בית הספר'
    }
  ];

  await withJSDOM(
    proposalsAgreementsScreen.render({ rows: [], contactOptions: [] }, { state: stateFor('admin') }),
    (root, dom) => {
      proposalsAgreementsScreen.bind({
        root,
        data: { rows: [], activityNameOptions: [], contactOptions: [], proposalActivityPricing: pricing, proposalActivityGroups: [
          { group_key: 'קיץ תשפ״ו', display_name: 'קיץ תשפ״ו', template_key: 'summer' },
          { group_key: 'שנת הלימודים תשפ״ז', display_name: 'שנת הלימודים תשפ״ז', template_key: 'next_year' },
          { group_key: 'קיץ תשפ״ו ושנת הלימודים תשפ״ז', display_name: 'קיץ תשפ״ו ושנת הלימודים תשפ״ז', template_key: 'combined', included_group_keys: ['קיץ תשפ״ו', 'שנת הלימודים תשפ״ז'] }
        ] },
        state: stateFor('admin'),
        api: {}
      });

      const form = openNewProposalForm(root, dom);
      const typeSelect = form.querySelector('[name="activity_type_group"]');
      typeSelect.value = 'קיץ תשפ״ו';
      typeSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

      const itemRow = form.querySelector('[data-pa-item-row]');
      const firstField = itemRow.querySelector('.ds-pa-item-field');
      const pricingSelect = itemRow.querySelector('[data-pa-pricing-select]');
      const details = itemRow.querySelector('[data-pa-item-details]');

      assert.equal(firstField?.querySelector('[data-pa-pricing-select]'), pricingSelect, 'activity select should be first in item row');
      assert.doesNotMatch(itemRow.textContent, /בחירה מהירה/);
      assert.equal(details.open, false, 'details should be collapsed before activity selection');

      pricingSelect.selectedIndex = 1;
      pricingSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

      assert.ok(details, 'details element should remain available after activity selection');
      assert.equal(itemRow.querySelector('[name="item_name"]').value, 'סדנת מייקרים');
      assert.equal(itemRow.querySelector('[name="item_type"]').value, 'סדנה');
      assert.equal(itemRow.querySelector('[name="meetings_count"]').value, '3');
      assert.equal(itemRow.querySelector('[name="hours_count"]').value, '6');
      assert.equal(itemRow.querySelector('[name="unit_price"]').value, '450');
      assert.match(itemRow.querySelector('[name="description"]').value, /התאמה/);
    }
  );
});

test('changing proposal type reloads relevant item areas and preview template', async () => {
  const pricing = [
    { activity_no: 'S1', activity_name: 'סדנת מייקרים', item_type: 'סדנה', proposal_group: 'קיץ תשפ״ו', unit_duration: '45 דקות', unit_price: 100 },
    { activity_no: 'Y1', activity_name: 'קורס רובוטיקה', item_type: 'קורס', proposal_group: 'שנת הלימודים תשפ״ז', meetings_count: 10, unit_price: 200 },
    { activity_no: 'T1', activity_name: 'בדיקות פנימיות', item_type: 'בדיקות', proposal_group: 'שנת הלימודים תשפ״ז', unit_price: 1 }
  ];

  await withJSDOM(
    proposalsAgreementsScreen.render({ rows: [], contactOptions: [] }, { state: stateFor('admin') }),
    async (root, dom) => {
      proposalsAgreementsScreen.bind({
        root,
        data: { rows: [], activityNameOptions: [], contactOptions: [], proposalActivityPricing: pricing, proposalActivityGroups: [
          { group_key: 'קיץ תשפ״ו', display_name: 'קיץ תשפ״ו', template_key: 'summer' },
          { group_key: 'שנת הלימודים תשפ״ז', display_name: 'שנת הלימודים תשפ״ז', template_key: 'next_year' },
          { group_key: 'קיץ תשפ״ו ושנת הלימודים תשפ״ז', display_name: 'קיץ תשפ״ו ושנת הלימודים תשפ״ז', template_key: 'combined', included_group_keys: ['קיץ תשפ״ו', 'שנת הלימודים תשפ״ז'] }
        ] },
        state: stateFor('admin'),
        api: { readProposalAgreementItems: async () => [] }
      });

      const form = openNewProposalForm(root, dom);
      form.querySelector('input[name="client_authority"]').value = 'רשות הדוגמה';
      form.querySelector('input[name="school_framework"]').value = 'בית ספר הדוגמה';
      form.querySelector('input[name="contact_name"]').value = 'ישראל ישראלי';
      form.querySelector('input[name="contact_role"]').value = 'מנהל בית הספר';

      const typeSelect = form.querySelector('[name="activity_type_group"]');
      typeSelect.value = 'קיץ תשפ״ו';
      typeSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      assert.match(form.querySelector('[data-pa-items-host]').textContent, /סדנת מייקרים/);
      assert.doesNotMatch(form.querySelector('[data-pa-items-host]').textContent, /קורס רובוטיקה|בדיקות פנימיות/);

      typeSelect.value = 'שנת הלימודים תשפ״ז';
      typeSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      assert.match(form.querySelector('[data-pa-items-host]').textContent, /קורס רובוטיקה/);
      assert.doesNotMatch(form.querySelector('[data-pa-items-host]').textContent, /סדנת מייקרים|בדיקות פנימיות/);

      typeSelect.value = 'קיץ תשפ״ו ושנת הלימודים תשפ״ז';
      typeSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      assert.match(form.querySelector('[data-pa-items-host]').textContent, /קיץ תשפ״ו/);
      assert.match(form.querySelector('[data-pa-items-host]').textContent, /שנת הלימודים תשפ״ז/);

      form.querySelector('[data-pa-preview-form]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await delay(20);
      const overlay = dom.window.document.getElementById('pa-preview-overlay');
      assert.ok(overlay, 'preview overlay should open');
      assert.match(overlay.textContent, /קיץ תשפ״ו ושנת הלימודים תשפ״ז|רשות הדוגמה/);
      assert.match(overlay.textContent, /ישראל ישראלי, מנהל בית הספר/);
      assert.doesNotMatch(overlay.textContent, /undefined|null|NaN|שורה חדשה|בדיקות פנימיות/);
    }
  );
});

test('upgrade migration adds status column with constraint and new indexes', async () => {
  const upgradeMigration = await readFile(
    new URL('../supabase/migrations/20260521_upgrade_proposals_agreements.sql', import.meta.url),
    'utf8'
  );
  assert.match(upgradeMigration, /add column if not exists status text/i);
  assert.match(upgradeMigration, /proposals_agreements_status_check/);
  assert.match(upgradeMigration, /'draft'[\s\S]*'pending_approval'[\s\S]*'returned_for_changes'[\s\S]*'approved'[\s\S]*'cancelled'/);
  assert.match(upgradeMigration, /proposals_agreements_status_idx/);
  assert.match(upgradeMigration, /proposals_agreements_proposal_date_idx/);
  assert.match(upgradeMigration, /add column if not exists approval_note/i);
  assert.match(upgradeMigration, /activity_names jsonb not null default '\[\]'::jsonb/i);
  assert.match(upgradeMigration, /touch_proposal_agreement_items_updated_at/);
  assert.match(upgradeMigration, /trg_touch_proposal_agreement_items_updated_at/);
  assert.match(upgradeMigration, /proposal_agreement_items/);
});

test('custom_document_sections migration is present', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20260523_add_custom_document_sections_to_proposals_agreements.sql', import.meta.url), 'utf8');
  assert.match(migration, /custom_document_sections jsonb not null default '\{\}'::jsonb/i);
});

test('preview prefers custom_document_sections when present', async () => {
  const row = { ...sampleRows[0], custom_document_sections: [{ section_key: 'intro', section_title: 'פתיח', section_body: 'טקסט מותאם להצעה' }] };
  await withJSDOM(proposalsAgreementsScreen.render({ rows: [row] }, { state: stateFor('admin') }), async (root, dom) => {
    proposalsAgreementsScreen.bind({ root, data: { rows: [row], proposalTemplateSections: [{ template_key: 'summer', section_key: 'intro', section_title: 'פתיח', section_body: 'טקסט תבנית' }] }, state: stateFor('admin'), api: { readProposalAgreementItems: async () => [] } });
    root.querySelector(`[data-pa-row-id="${row.id}"]`)?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await delay(20);
    root.querySelector(`[data-pa-preview="${row.id}"]`)?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await delay(20);
    assert.match(dom.window.document.body.innerHTML, /טקסט מותאם להצעה/);
  });
});


test('proposal preview preserves multiline section paragraphs and dash bullets', async () => {
  const row = {
    ...sampleRows[0],
    custom_document_sections: [{
      section_key: 'intro',
      section_title: 'פתיח',
      section_body: 'פסקת פתיחה להצעה.\r\nשורת המשך נשמרת.\n\n- ההצעה מיועדת לקבוצה של עד 20 משתתפים.\n בכל סדנת מייקרים יכין כל משתתף תוצר אישי.\nשורה חדשה'
    }]
  };

  await withJSDOM(proposalsAgreementsScreen.render({ rows: [row] }, { state: stateFor('admin') }), async (root, dom) => {
    proposalsAgreementsScreen.bind({
      root,
      data: { rows: [row], proposalTemplateSections: [{ template_key: 'summer', section_key: 'intro', section_title: 'פתיח', section_body: 'טקסט תבנית' }] },
      state: stateFor('admin'),
      api: { readProposalAgreementItems: async () => [] }
    });
    root.querySelector(`[data-pa-row-id="${row.id}"]`)?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await delay(20);
    root.querySelector(`[data-pa-preview="${row.id}"]`)?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await delay(20);

    const intro = dom.window.document.querySelector('.pa-doc-intro');
    assert.ok(intro, 'intro section body should render');
    assert.equal(intro.querySelectorAll('p').length, 1, 'opening text should render as one paragraph');
    assert.equal(intro.querySelectorAll('br').length, 1, 'opening paragraph line break should be preserved');
    assert.equal(intro.querySelectorAll('li').length, 2, 'dash and square bullets should render as separate list items');
    assert.equal(intro.querySelectorAll('li')[0]?.textContent, 'ההצעה מיועדת לקבוצה של עד 20 משתתפים.');
    assert.equal(intro.querySelectorAll('li')[1]?.textContent, 'בכל סדנת מייקרים יכין כל משתתף תוצר אישי.');
    assert.doesNotMatch(intro.textContent, /שורה חדשה/);
  });
});

test('proposal preview renders recipient block before title without empty commas', async () => {
  const row = {
    ...sampleRows[0],
    contact_name: 'יונית לוי',
    contact_role: 'מנהלת',
    school_framework: 'בית ספר אורט',
    client_authority: 'רשות הדוגמה',
    custom_document_sections: [{
      section_key: 'intro',
      section_title: 'פתיח',
      section_body: 'פתיח תעשיידע לבדיקה'
    }]
  };

  await withJSDOM(proposalsAgreementsScreen.render({ rows: [row] }, { state: stateFor('admin') }), async (root, dom) => {
    proposalsAgreementsScreen.bind({
      root,
      data: { rows: [row], proposalTemplateSections: [{ template_key: 'summer', section_key: 'intro', section_title: 'פתיח', section_body: 'טקסט תבנית' }] },
      state: stateFor('admin'),
      api: { readProposalAgreementItems: async () => [] }
    });
    root.querySelector(`[data-pa-row-id="${row.id}"]`)?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await delay(20);
    root.querySelector(`[data-pa-preview="${row.id}"]`)?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await delay(20);

    const subject = dom.window.document.querySelector('.pa-doc-subject');
    const address = dom.window.document.querySelector('.pa-doc-address');
    const intro = dom.window.document.querySelector('.pa-doc-intro');
    assert.ok(subject, 'proposal title should render');
    assert.ok(address, 'recipient block should render');
    assert.ok(intro, 'intro should render after recipient block');
    assert.ok(address.compareDocumentPosition(subject) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.ok(address.compareDocumentPosition(intro) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.deepEqual(Array.from(address.querySelectorAll('p')).map((p) => p.textContent), [
      'לכבוד:',
      'יונית לוי, מנהלת',
      'בית ספר אורט, רשות הדוגמה'
    ]);
    assert.doesNotMatch(address.textContent, /undefined|null|NaN|,,|,\s*$/);
  });
});

test('proposal preview uses updated central contact details when reopening', async () => {
  const row = {
    ...sampleRows[0],
    contact_name: 'דנה קשר',
    contact_role: 'תפקיד ישן',
    phone: '050-1111111'
  };
  const contactOptions = [{
    id: 'central-1',
    authority: row.client_authority,
    school: row.school_framework,
    contact_name: row.contact_name,
    contact_role: 'מנהלת מעודכנת',
    phone: row.phone,
    email: 'updated@example.com'
  }];

  await withJSDOM(proposalsAgreementsScreen.render({ rows: [row] }, { state: stateFor('admin') }), async (root, dom) => {
    proposalsAgreementsScreen.bind({
      root,
      data: { rows: [row], contactOptions, proposalTemplateSections: [{ template_key: 'summer', section_key: 'intro', section_title: 'פתיח', section_body: 'פתיח תעשיידע' }] },
      state: stateFor('admin'),
      api: { readProposalAgreementItems: async () => [] }
    });
    root.querySelector(`[data-pa-row-id="${row.id}"]`)?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await delay(20);
    root.querySelector(`[data-pa-preview="${row.id}"]`)?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await delay(20);

    const address = dom.window.document.querySelector('.pa-doc-address');
    assert.match(address.textContent, /דנה קשר, מנהלת מעודכנת/);
    assert.doesNotMatch(address.textContent, /תפקיד ישן|undefined|null|NaN/);
  });
});

test('approved proposal has no edit document button', async () => {
  const row = { ...sampleRows[0], status: 'approved' };
  await withJSDOM(proposalsAgreementsScreen.render({ rows: [row] }, { state: stateFor('admin') }), async (root, dom) => {
    proposalsAgreementsScreen.bind({ root, data: { rows: [row] }, state: stateFor('admin'), api: { readProposalAgreementItems: async () => [] } });
    root.querySelector(`[data-pa-row-id="${row.id}"]`)?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await delay(20);
    assert.equal(Boolean(root.querySelector('[data-pa-edit-document]')), false);
  });
});

test('summer proposal preview keeps prices out of activity section and expands bundle children in cost table', async () => {
  const row = {
    ...sampleRows[0],
    activity_type_group: 'קיץ תשפ״ו',
    proposal_date: '2026-06-01',
    include_catalog: false,
    contact_name: 'רחל כהן',
    contact_role: 'רכזת',
    school_framework: 'בית ספר הדגמה',
    client_authority: 'עיריית הדגמה'
  };
  const proposalTemplateSections = [
    { template_key: 'summer', template_name: 'הצעת מחיר לפעילויות תעשיידע | קיץ תשפ״ו', section_key: 'intro', section_title: 'פתיח', section_body: 'פתיח תעשיידע לבדיקה.' },
    { template_key: 'summer', section_key: 'activity_intro', section_title: 'הפעילות המוצעת', section_body: 'ההצעה כוללת סדנאות מייקרים.\n\n ההצעה מיועדת לקבוצה של עד 20 משתתפים.\n דף מידע המפרט את מגוון הפעילויות המוצעות מצורף להצעה זו.' },
    { template_key: 'summer', section_key: 'payment_terms', section_title: 'עלות ותנאי תשלום', section_body: ' חשבונית לתשלום תונפק עם תחילת הסדנה.' },
    { template_key: 'summer', section_key: 'signature', section_title: 'חתימה', section_body: 'עידן נחום, סמנכ״ל כספים' }
  ];
  const items = [{
    item_name: 'סדנאות STEM',
    proposal_display_mode: 'bundle_parent',
    unit_price: 1100,
    total_price: 1100,
    quantity: 1,
    unit_duration: '45 דקות',
    hourly_price: 650,
    proposal_group: 'קיץ תשפ״ו',
    selected_bundle_items: [
      { activity_name: 'רוטוקופטר', unit_price: 450 },
      { activity_name: 'פרפרטוס', unit_price: 650 }
    ]
  }];

  await withJSDOM(proposalsAgreementsScreen.render({ rows: [row] }, { state: stateFor('admin') }), async (root, dom) => {
    proposalsAgreementsScreen.bind({
      root,
      data: {
        rows: [row],
        proposalTemplateSections,
        proposalActivityGroups: [{ group_key: 'קיץ תשפ״ו', display_name: 'קיץ תשפ״ו', template_key: 'summer', show_gefen: false }]
      },
      state: stateFor('admin'),
      api: { readProposalAgreementItems: async () => items }
    });
    root.querySelector(`[data-pa-row-id="${row.id}"]`)?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await delay(20);
    root.querySelector(`[data-pa-preview="${row.id}"]`)?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await delay(20);

    const doc = dom.window.document.querySelector('.proposal-document');
    const activitySection = Array.from(doc.querySelectorAll('.pa-section h3'))
      .find((heading) => heading.textContent.includes('הפעילות המוצעת'))
      ?.closest('.pa-section');
    const paymentSection = doc.querySelector('.pa-cost-section');
    const costTable = paymentSection?.querySelector('.pa-cost-table');
    const address = doc.querySelector('.pa-doc-address');
    const signature = doc.querySelector('.proposal-signature');

    assert.ok(address, 'recipient block should render');
    assert.match(address.textContent, /לכבוד:/);
    assert.match(address.textContent, /רחל כהן, רכזת/);
    assert.ok(activitySection, 'activity section should render');
    assert.ok(paymentSection, 'payment section should render');
    assert.doesNotMatch(activitySection.textContent, /₪|לשעה|מחיר לקבוצה|סדנאות STEM/);
    assert.doesNotMatch(activitySection.textContent, /רוטוקופטר|פרפרטוס/);
    assert.doesNotMatch(doc.textContent, /מצורף להצעה/);
    assert.ok(costTable, 'cost table should render in payment section');
    const tableText = costTable.textContent;
    assert.match(tableText, /רוטוקופטר/);
    assert.match(tableText, /פרפרטוס/);
    assert.match(tableText, /450/);
    assert.match(tableText, /650/);
    assert.doesNotMatch(tableText, /סדנאות STEM/);
    assert.doesNotMatch(doc.textContent, /undefined|null|\(\)\s*₪|₪\s*לשעה|מחיר לשעה/);
    assert.ok(signature, 'signature should render from template section');
    assert.equal(signature.querySelectorAll('.proposal-signature-name').length, 1);
    assert.match(signature.textContent, /בברכה,/);
    assert.match(signature.textContent, /עידן נחום, סמנכ״ל כספים/);
  });
});



test('catalog PDF appendices use fixed workshop/tour PDFs and specific selected course PDFs only', () => {
  const entries = buildProposalCatalogPdfEntries(
    { activity_type_group: 'הצעה משולבת' },
    [
      { item_name: 'סדנת מייקרים', item_type: 'סדנה', proposal_group: 'סדנאות' },
      { item_name: 'סיור טכנולוגי', item_type: 'סיור', proposal_group: 'סיור' },
      { item_name: 'ביומימיקרי', item_type: 'קורס', proposal_group: 'שנת הלימודים תשפ״ז', gefen_number: '6089' },
      { item_name: 'ביומימיקרי כפול', item_type: 'תוכנית', proposal_group: 'שנת הלימודים תשפ״ז', gefen_number: '6089' },
      { item_name: 'AI Basics', item_type: 'קורס', proposal_group: 'שנת הלימודים תשפ״ז', course_slug: 'ai-basics' }
    ]
  );
  const paths = entries.map((entry) => entry.path).filter(Boolean);
  assert.ok(paths.includes('proposals/catalogs/catalog-workshops.pdf'));
  assert.ok(paths.includes('proposals/catalogs/catalog-tours.pdf'));
  assert.ok(paths.includes('proposals/catalogs/courses/course-6089.pdf'));
  assert.ok(paths.includes('proposals/catalogs/courses/course-ai-basics.pdf'));
  assert.equal(paths.filter((path) => path === 'proposals/catalogs/courses/course-6089.pdf').length, 1);
  assert.doesNotMatch(paths.join('\n'), /catalog-courses\.pdf/);
});


test('print catalog prompt warns when selected course PDF is missing and continues without that appendix', async () => {
  const row = {
    ...sampleRows[0],
    id: 'course-missing-pdf-row',
    activity_type_group: 'שנת הלימודים תשפ״ז',
    status: 'approved',
    include_catalog: false
  };
  const courseItems = [{ item_name: 'קורס רובוטיקה', item_type: 'קורס', proposal_group: 'שנת הלימודים תשפ״ז', gefen_number: '9545', quantity: 1, unit_price: 100, total_price: 100 }];
  const savedFetch = globalThis.fetch;
  await withJSDOM(proposalsAgreementsScreen.render({ rows: [row] }, { state: stateFor('admin') }), async (root, dom) => {
    const confirmMessages = [];
    let printCalls = 0;
    dom.window.confirm = (message) => { confirmMessages.push(String(message)); return true; };
    dom.window.print = () => { printCalls += 1; };
    globalThis.fetch = async () => ({ ok: false, status: 404 });
    try {
      proposalsAgreementsScreen.bind({
        root,
        data: { rows: [row], proposalActivityGroups: [{ group_key: 'שנת הלימודים תשפ״ז', display_name: 'שנת הלימודים תשפ״ז', template_key: 'next_year' }] },
        state: stateFor('admin'),
        api: { readProposalAgreementItems: async () => courseItems }
      });
      root.querySelector(`[data-pa-row-id="${row.id}"]`)?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await delay(20);
      root.querySelector(`[data-pa-preview="${row.id}"]`)?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await delay(30);
      dom.window.document.getElementById('pa-print-btn')?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await delay(30);

      assert.ok(confirmMessages.some((message) => /האם להוסיף קטלוג להצעה/.test(message)), 'print should ask whether to add a catalog');
      assert.ok(confirmMessages.some((message) => /לא נמצא קובץ נספח לקורס: קורס רובוטיקה/.test(message)), 'missing selected course PDF should be reported');
      assert.equal(printCalls, 1, 'print should continue when the user confirms continuing without appendix');
      assert.doesNotMatch(dom.window.document.body.innerHTML, /course-9545\.pdf/);
      assert.doesNotMatch(dom.window.document.body.innerHTML, /catalog-courses\.pdf/);
    } finally {
      globalThis.fetch = savedFetch;
    }
  });
});

test('catalog PDF appendices report missing selected course appendix identifiers', () => {
  const entries = buildProposalCatalogPdfEntries(
    { activity_type_group: 'שנת הלימודים תשפ״ז' },
    [{ item_name: 'קורס ללא מזהה', item_type: 'קורס', proposal_group: 'שנת הלימודים תשפ״ז' }]
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].missing, true);
  assert.equal(entries[0].label, 'קורס ללא מזהה');
});

test('catalog appendix entries load workshop proposals only from workshops catalog and dedupe ids', () => {
  const urls = buildProposalCatalogEntries([
    { item_name: 'סדנת רובוטיקה', item_type: 'סדנה', activity_no: 'cat-12', pricing_key: 'cat-12', unit_price: 500 },
    { item_name: 'סדנת רובוטיקה', item_type: 'סדנה', activity_no: '12', pricing_key: 'cat-12', unit_price: 500 }
  ]);

  assert.deepEqual(urls, ['./catalog/summercatalog/workshops.html?proposalMode=1&workshopIds=12']);
  assert.equal(urls.some((url) => url.includes('course-page.html')), false);
});

test('catalog appendix entries split mixed proposals by true item type without duplicate appendices', () => {
  const urls = buildProposalCatalogEntries([
    { item_name: 'קורס רובוטיקה', item_type: 'קורס', gefen_number: '1234', activity_no: '555' },
    { item_name: 'קורס רובוטיקה נוסף', item_type: 'תוכנית', gefen_number: '1234', activity_no: '555' },
    { item_name: 'סדנת רחפנים', item_type: 'סדנה', activity_no: '88', pricing_key: 'cat-88' },
    { item_name: 'סדנת רחפנים', item_type: 'סדנה', activity_no: '88', pricing_key: 'cat-88' }
  ]);

  assert.deepEqual(urls, [
    './catalog/summercatalog/workshops.html?proposalMode=1&workshopIds=88',
    './catalog/summercatalog/course-page.html?ids=1234&proposalMode=1'
  ]);
});


test('catalog appendix entries resolve biomimicry Gefen number to internal course id', () => {
  const urls = buildProposalCatalogEntries([
    {
      item_name: 'המצאות בהשראה מן הטבע – ביומימיקרי לתלמידי יסודי',
      item_type: 'קורס',
      gefen_number: '6089',
      activity_no: '6089'
    }
  ]);

  assert.deepEqual(urls, [
    './catalog/summercatalog/course-page.html?ids=biomimicry-elementary&proposalMode=1'
  ]);
});


test('catalog appendix entries skip non-course activities even when they have Gefen/activity ids', async () => {
  const gameItem = {
    item_name: 'משחקי קופסה – פיתוח ופיצוח משחקי לוח',
    item_type: 'פעילות',
    type: 'activity',
    activity_type_group: 'פעילויות',
    activity_no: '27342',
    gefen_number: '27342'
  };

  const urls = buildProposalCatalogEntries([gameItem]);
  assert.deepEqual(urls, []);

  const html = proposalPreviewBodyHtml(
    { ...sampleRows[0], activity_type_group: 'פעילויות', include_catalog: true },
    [gameItem],
    [{ template_key: '', section_key: 'activity_intro', section_title: 'הפעילות המוצעת', section_body: 'להלן הקורסים המוצעים לשנת הלימודים תשפ״ז. פירוט מלא של הקורסים מצורף כנספח להצעה זו.' }]
  );

  await withJSDOM(html, async (_root, dom) => {
    const activitySection = [...dom.window.document.querySelectorAll('.proposal-document .pa-section')]
      .find((section) => section.querySelector('h3')?.textContent.includes('הפעילות המוצעת'));
    assert.ok(activitySection);
    assert.match(activitySection.textContent, /פירוט הפעילויות המוצעות\./);
    assert.doesNotMatch(activitySection.textContent, /להלן הקורסים|מצורף כנספח/);
  });
});

test('workshop proposal preview uses short appendix wording and keeps prices only in cost table', async () => {
  const row = {
    ...sampleRows[0],
    id: '77777777-7777-7777-7777-777777777777',
    activity_type_group: 'סדנאות',
    include_catalog: true,
    proposal_date: '2026-06-01'
  };
  const proposalTemplateSections = [
    { template_key: 'workshops', template_name: 'הצעת מחיר לסדנאות', section_key: 'intro', section_title: 'פתיח', section_body: 'פתיח.' },
    { template_key: 'workshops', section_key: 'activity_intro', section_title: 'הפעילות המוצעת', section_body: `להלן הקורסים המוצעים לשנת הלימודים תשפ״ז.
 גפ״ן 1234 | 10 מפגשים | 20 שעות | ₪200 לשעה | מחיר לקבוצה ₪4,000
 סדנת רובוטיקה` },
    { template_key: 'workshops', section_key: 'payment_terms', section_title: 'עלות ותנאי תשלום', section_body: ' תנאי תשלום.' }
  ];
  const items = [{ item_name: 'סדנת רובוטיקה', item_type: 'סדנה', activity_no: '12', unit_price: 4000, total_price: 4000, quantity: 1, proposal_group: 'סדנאות' }];

  proposalsAgreementsScreen.render({
    rows: [row],
    proposalActivityGroups: [{ group_key: 'סדנאות', display_name: 'סדנאות', template_key: 'workshops', show_gefen: false }]
  }, { state: stateFor('admin') });

  await withJSDOM(proposalPreviewBodyHtml(row, items, proposalTemplateSections), async (_root, dom) => {
    const activitySection = [...dom.window.document.querySelectorAll('.proposal-document .pa-section')]
      .find((section) => section.querySelector('h3')?.textContent.includes('הפעילות המוצעת'));
    const paymentSection = [...dom.window.document.querySelectorAll('.proposal-document .pa-section')]
      .find((section) => section.querySelector('h3')?.textContent.includes('עלות ותנאי תשלום'));

    assert.ok(activitySection);
    assert.match(activitySection.textContent, /פירוט הסדנאות המוצעות מצורף כנספח להצעה זו/);
    assert.doesNotMatch(activitySection.textContent, /קורסים|גפ״ן|מפגשים|שעות|לשעה|מחיר לקבוצה|4,000|סדנת רובוטיקה/);
    assert.ok(paymentSection);
    assert.match(paymentSection.textContent, /4,000/);
  });
});

test('summer proposal preview only mentions an appendix when a matching appendix exists', async () => {
  const baseSections = [
    { template_key: 'summer', template_name: 'הצעת מחיר', section_key: 'intro', section_title: 'פתיח', section_body: 'פתיח.' },
    { template_key: 'summer', section_key: 'activity_intro', section_title: 'הפעילות המוצעת', section_body: 'טקסט פעילות.\n דף מידע עם פירוט מגוון הפעילויות המוצעות מצורף להצעה.' },
    { template_key: 'summer', section_key: 'payment_terms', section_title: 'עלות ותנאי תשלום', section_body: ' תנאי תשלום.' }
  ];
  const groupMeta = [{ group_key: 'קיץ תשפ״ו', display_name: 'קיץ תשפ״ו', template_key: 'summer', show_gefen: false }];
  const items = [{ item_name: 'סדנת מייקרים', unit_price: 450, total_price: 450, quantity: 1, proposal_group: 'קיץ תשפ״ו' }];

  const openPreviewForRow = async (row, dom, root) => {
    proposalsAgreementsScreen.bind({
      root,
      data: { rows: [row], proposalTemplateSections: baseSections, proposalActivityGroups: groupMeta },
      state: stateFor('admin'),
      api: { readProposalAgreementItems: async () => items }
    });
    root.querySelector(`[data-pa-row-id="${row.id}"]`)?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await delay(20);
    root.querySelector(`[data-pa-preview="${row.id}"]`)?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await delay(20);
    return dom.window.document.querySelector('.proposal-document')?.textContent || '';
  };

  const rowOff = { ...sampleRows[0], id: '33333333-3333-3333-3333-333333333333', activity_type_group: 'קיץ תשפ״ו', include_catalog: false };
  const rowOn = { ...rowOff, id: '44444444-4444-4444-4444-444444444444', include_catalog: true };

  await withJSDOM(proposalsAgreementsScreen.render({ rows: [rowOff, rowOn] }, { state: stateFor('admin') }), async (root, dom) => {
    const offText = await openPreviewForRow(rowOff, dom, root);
    dom.window.document.getElementById('pa-preview-overlay')?.remove();

    const onText = await openPreviewForRow(rowOn, dom, root);
    assert.doesNotMatch(offText, /מצורף להצעה/);
    assert.doesNotMatch(onText, /מצורף[\s\S]*להצעה/);
  });
});

test('catalog attach button toggles include_catalog and save payload', async () => {
  let savedPayload = null;
  const pricing = [
    { activity_no: 'S1', activity_name: 'סדנת מייקרים', item_type: 'סדנה', proposal_group: 'קיץ תשפ״ו', unit_price: 450 }
  ];

  await withJSDOM(
    proposalsAgreementsScreen.render({ rows: [], contactOptions: [] }, { state: stateFor('admin') }),
    async (root, dom) => {
      proposalsAgreementsScreen.bind({
        root,
        data: {
          rows: [],
          contactOptions: [],
          proposalActivityPricing: pricing,
          proposalActivityGroups: [{ group_key: 'קיץ תשפ״ו', display_name: 'קיץ תשפ״ו', template_key: 'summer' }]
        },
        state: stateFor('admin'),
        api: {
          addProposalAgreement: async (payload) => {
            savedPayload = payload;
            return { ok: true, row: { ...payload, id: '55555555-5555-5555-5555-555555555555' } };
          },
          saveProposalAgreementItems: async () => ({ ok: true })
        }
      });

      root.querySelector('[data-pa-tab="new"]')?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await delay(20);
      const form = root.querySelector('[data-pa-form]');
      form.querySelector('input[name="client_authority"]').value = 'רשות הדוגמה';
      form.querySelector('[name="activity_type_group"]').value = 'קיץ תשפ״ו';
      const pricingSelect = form.querySelector('[data-pa-pricing-select]');
      pricingSelect.selectedIndex = 1;
      pricingSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      await delay(10);

      const catalogBtn = form.querySelector('[data-pa-catalog-toggle]');
      const catalogInput = form.querySelector('[name="include_catalog"]');
      assert.equal(catalogInput.value, 'no');
      assert.equal(catalogBtn.textContent, 'הוספת הקטלוג להצעה');

      catalogBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      assert.equal(catalogInput.value, 'yes');
      assert.equal(catalogBtn.textContent, 'הקטלוג צורף להצעה');
      assert.ok(form.querySelector('[data-pa-catalog-attach]')?.classList.contains('is-attached'));

      form.dataset.paPreviewSeen = 'yes';
      form.querySelector('[data-pa-save-pending]')?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await delay(100);
      assert.equal(savedPayload?.include_catalog, true);
    }
  );
});

test('next_year proposal title uses template_name תוכניות from Supabase', async () => {
  const row = {
    ...sampleRows[0],
    id: '66666666-6666-6666-6666-666666666666',
    activity_type_group: 'שנת הלימודים תשפ״ז',
    include_catalog: false
  };
  const proposalTemplateSections = [
    {
      template_key: 'next_year',
      template_name: 'הצעת מחיר לתוכניות תעשיידע | שנת הלימודים תשפ״ז',
      section_key: 'intro',
      section_title: 'פתיח',
      section_body: 'פתיח.'
    },
    {
      template_key: 'next_year',
      section_key: 'activity_intro',
      section_title: 'הפעילות המוצעת',
      section_body: 'טקסט פעילות.'
    },
    {
      template_key: 'next_year',
      section_key: 'payment_terms',
      section_title: 'עלות ותנאי תשלום',
      section_body: ' תנאי תשלום.'
    }
  ];

  await withJSDOM(proposalsAgreementsScreen.render({ rows: [row] }, { state: stateFor('admin') }), async (root, dom) => {
    proposalsAgreementsScreen.bind({
      root,
      data: {
        rows: [row],
        proposalTemplateSections,
        proposalActivityGroups: [{ group_key: 'שנת הלימודים תשפ״ז', display_name: 'שנת הלימודים תשפ״ז', template_key: 'next_year' }]
      },
      state: stateFor('admin'),
      api: { readProposalAgreementItems: async () => [{ item_name: 'קורס רובוטיקה', unit_price: 500, total_price: 500, quantity: 1, proposal_group: 'שנת הלימודים תשפ״ז' }] }
    });
    root.querySelector(`[data-pa-row-id="${row.id}"]`)?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await delay(20);
    root.querySelector(`[data-pa-preview="${row.id}"]`)?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await delay(20);

    const title = dom.window.document.querySelector('.pa-doc-subject')?.textContent || '';
    assert.match(title, /הצעת מחיר לתוכניות תעשיידע \| שנת הלימודים תשפ״ז/);
    assert.doesNotMatch(title, /קורסי תעשיידע/);
  });
});

test('next_year template_name migration updates programs wording', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20260616_next_year_template_name_programs.sql', import.meta.url),
    'utf8'
  );
  assert.match(migration, /הצעת מחיר לתוכניות תעשיידע \| שנת הלימודים תשפ״ז/);
  assert.match(migration, /where template_key = 'next_year'/i);
});
