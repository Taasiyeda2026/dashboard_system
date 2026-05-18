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

const MAIN_FILE = new URL('../frontend/src/main.js', import.meta.url);
const API_FILE = new URL('../frontend/src/api.js', import.meta.url);
const ACT_NAV_FILE = new URL('../frontend/src/screens/shared/act-nav-grid.js', import.meta.url);
const SCREEN_FILE = new URL('../frontend/src/screens/proposals-agreements.js', import.meta.url);
const MIGRATION_FILE = new URL('../supabase/migrations/20260518_create_proposals_agreements.sql', import.meta.url);

const { proposalsAgreementsScreen, canAccessProposalsAgreements } = await import('../frontend/src/screens/proposals-agreements.js');

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

const sampleRows = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    client_authority: 'רשות א',
    school_framework: 'בית ספר א',
    document_type: 'הצעה',
    activity_type: 'רובוטיקה',
    contact_name: 'דנה קשר',
    contact_role: 'מנהלת',
    contact_phone: '050-1111111',
    contact_email: 'dana@example.com',
    notes: 'הערה קצרה'
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    client_authority: 'רשות ב',
    school_framework: 'מסגרת ב',
    document_type: 'הסכם',
    activity_type: 'יזמות',
    contact_name: 'יוסי קשר',
    contact_phone: '050-2222222',
    notes: 'רשומה שנייה'
  }
];

test('screen authorization allows only domain_manager, operation_manager and admin', () => {
  for (const role of ['domain_manager', 'operation_manager', 'admin']) {
    assert.equal(canAccessProposalsAgreements(stateFor(role)), true, `${role} should be allowed`);
    const html = proposalsAgreementsScreen.render({ rows: [] }, { state: stateFor(role) });
    assert.match(html, /הצעות והסכמים/);
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
  assert.match(mainSource, /'proposals-agreements': 'הצעות והסכמים'/);
  assert.match(mainSource, /'proposals-agreements': \(\) => import\('\.\/screens\/proposals-agreements\.js'\)/);
  assert.match(apiSource, /admin: \[[^\]]*'proposals-agreements'/);
  assert.match(apiSource, /operation_manager: \[[^\]]*'proposals-agreements'/);
  assert.match(apiSource, /domain_manager: \[[^\]]*'proposals-agreements'/);
  assert.doesNotMatch(apiSource, /authorized_user: \[[^\]]*'proposals-agreements'/);
  assert.doesNotMatch(apiSource, /instructor: \[[^\]]*'proposals-agreements'/);
});

test('table structure includes required outer columns', () => {
  const html = proposalsAgreementsScreen.render({ rows: sampleRows }, { state: stateFor('admin') });
  assert.match(html, /<th>לקוח \/ רשות<\/th><th>בית ספר \/ מסגרת<\/th><th>סוג מסמך<\/th><th>סוג פעילות<\/th><th>הערות<\/th>/);
  assert.match(html, /data-pa-table-region/);
  assert.match(html, /table-layout: fixed|ds-pa-table/);
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
  const dom = new JSDOM(`<main id="root">${proposalsAgreementsScreen.render({ rows: sampleRows }, { state: stateFor('admin') })}</main>`);
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousFormData = globalThis.FormData;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.FormData = dom.window.FormData;

  try {
    const root = dom.window.document.getElementById('root');
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
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    globalThis.FormData = previousFormData;
  }
});

test('screen and API source enforce authorization before API/Supabase calls', async () => {
  const screenSource = await readFile(SCREEN_FILE, 'utf8');
  const apiSource = await readFile(API_FILE, 'utf8');
  assert.match(screenSource, /if \(!canAccessProposalsAgreements\(state\)\) return \{ rows: \[\], unauthorized: true \};/);
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
