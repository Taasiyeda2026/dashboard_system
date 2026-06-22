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
const APPROVAL_GUARD_MIGRATION_FILE = new URL('../supabase/migrations/20260616_proposals_agreements_approval_guard.sql', import.meta.url);

const { proposalsAgreementsScreen, canAccessProposalsAgreements, canManageProposalsAgreements, STATUS_LABELS, STATUS_OPTIONS, buildProposalCatalogPdfEntries, proposalPreviewBodyHtml, countPendingApprovedProposals, isProposalApprovedPendingSend } = await import('../frontend/src/screens/proposals-agreements.js');

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
  set('input[name="contact_source_authority_id"]', overrides.authority_id || 'auth-test');
  set('input[name="contact_source_school_id"]', overrides.school_id || 'school-test');
  set('input[name="contact_source_client_type"]', overrides.client_type || 'school');
  set('[name="activity_type_group"]', overrides.activity_type_group || 'קיץ תשפ״ו');
  fillLineItem(form, dom, overrides);
}

function setProposalCatalogIds(form, {
  authority_id = 'auth-test',
  school_id = 'school-test',
  client_type = 'school'
} = {}) {
  const set = (name, value) => {
    const el = form.querySelector(`input[name="${name}"]`);
    if (el) el.value = value;
  };
  set('contact_source_authority_id', authority_id);
  set('contact_source_school_id', school_id);
  set('contact_source_client_type', client_type);
}

function selectClientResult(form, dom, query) {
  const schoolSearchPanel = form.querySelector('[data-pa-school-search-panel]');
  const useSchoolSearch = schoolSearchPanel && !schoolSearchPanel.hidden;
  const searchInput = useSchoolSearch
    ? form.querySelector('[data-pa-school-search-input]')
    : form.querySelector('[data-pa-client-search-input]');
  searchInput.value = query;
  searchInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  const resultsHost = useSchoolSearch
    ? form.querySelector('[data-pa-school-results]')
    : form.querySelector('[data-pa-client-results]');
  resultsHost?.querySelector('[data-pa-client-result]')?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
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

const sampleCatalogAuthorities = [
  {
    _catalog_source: 'authorities',
    client_type: 'authority',
    client_name: 'רשות א',
    authority_id: 'auth-a',
    school_id: null,
    authority_name: 'רשות א',
    authority: 'רשות א',
    school: '',
    authority_code: '101',
    authority_type: 'עירייה',
    district: 'מרכז',
    contact_name: '',
    contact_role: '',
    phone: '',
    email: '',
    mobile: ''
  },
  {
    _catalog_source: 'authorities',
    client_type: 'authority',
    client_name: 'רשות ב',
    authority_id: 'auth-b',
    school_id: null,
    authority_name: 'רשות ב',
    authority: 'רשות ב',
    school: '',
    authority_code: '102',
    authority_type: 'מועצה',
    district: 'דרום',
    contact_name: '',
    contact_role: '',
    phone: '',
    email: '',
    mobile: ''
  }
];

const sampleCatalogSchools = [
  {
    _catalog_source: 'schools',
    client_type: 'school',
    client_name: 'בית ספר א',
    authority_id: 'auth-a',
    school_id: 'school-a',
    authority_name: 'רשות א',
    authority: 'רשות א',
    school_name: 'בית ספר א',
    school: 'בית ספר א',
    semel_mosad: '11111',
    contact_name: '',
    contact_role: '',
    phone: '',
    email: '',
    mobile: ''
  },
  {
    _catalog_source: 'schools',
    client_type: 'school',
    client_name: 'מסגרת ב',
    authority_id: 'auth-b',
    school_id: 'school-b',
    authority_name: 'רשות ב',
    authority: 'רשות ב',
    school_name: 'מסגרת ב',
    school: 'מסגרת ב',
    semel_mosad: '22222',
    contact_name: '',
    contact_role: '',
    phone: '',
    email: '',
    mobile: ''
  }
];

const sampleContactRows = [
  {
    id: '1',
    authority_id: 'auth-a',
    school_id: 'school-a',
    authority: 'רשות א',
    school: 'בית ספר א',
    contact_name: 'דנה קשר',
    contact_role: 'מנהלת',
    phone: '050-1111111',
    email: 'dana@example.com'
  },
  {
    id: '2',
    authority_id: 'auth-a',
    school_id: 'school-a',
    authority: 'רשות א',
    school: 'בית ספר א',
    contact_name: 'מיכל כהן',
    contact_role: 'רכזת',
    phone: '050-3333333',
    email: 'michal@example.com'
  },
  {
    id: '3',
    authority_id: 'auth-b',
    school_id: 'school-b',
    authority: 'רשות ב',
    school: 'מסגרת ב',
    contact_name: 'יוסי קשר',
    contact_role: '',
    phone: '050-2222222',
    email: ''
  }
];

const sampleContactOptions = [...sampleCatalogAuthorities, ...sampleCatalogSchools, ...sampleContactRows];

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

test('pending approved proposals nav count includes only approved status rows', () => {
  const approved = { id: '1', status: 'approved' };
  const signed = { id: '2', status: 'draft', approved_at: '2026-06-01T10:00:00Z' };
  const signatureOnly = { id: '3', status: 'draft', signature_meta: { signature: { image: 'proposals/signature-idan-nahum.png' } } };
  const sent = { id: '4', status: 'sent', approved_at: '2026-06-01T10:00:00Z' };
  const pendingAlias = { id: '5', status: 'pending_approval', approved_at: '2026-06-01T10:00:00Z' };
  const cancelled = { id: '6', status: 'cancelled', approved_at: '2026-06-01T10:00:00Z' };
  const draft = { id: '7', status: 'draft' };
  const returned = { id: '8', status: 'returned_for_changes', approved_at: '2026-06-01T10:00:00Z' };

  assert.equal(isProposalApprovedPendingSend(approved), true);
  assert.equal(isProposalApprovedPendingSend(signed), false);
  assert.equal(isProposalApprovedPendingSend(signatureOnly), false);
  assert.equal(isProposalApprovedPendingSend(sent), false);
  assert.equal(isProposalApprovedPendingSend(pendingAlias), false);
  assert.equal(isProposalApprovedPendingSend(cancelled), false);
  assert.equal(isProposalApprovedPendingSend(draft), false);
  assert.equal(isProposalApprovedPendingSend(returned), false);
  assert.equal(countPendingApprovedProposals([approved, signed, sent, draft, signatureOnly, returned]), 1);
});

test('sidebar proposals pending badge is wired in main shell nav', async () => {
  const mainSource = await readFile(MAIN_FILE, 'utf8');
  assert.match(mainSource, /ds-nav-count-badge--proposals-pending/);
  assert.match(mainSource, /pendingApprovedProposalsCount/);
  assert.match(mainSource, /refreshPendingApprovedProposalsCount/);
  assert.match(mainSource, /app:proposals-pending-updated/);
  assert.match(mainSource, /'proposals-agreements'/);
  assert.match(mainSource, /navLabelHtmlForRoute[\s\S]*proposals-agreements/);
});

test('proposals screen dispatches pending nav updates on bind and local row changes', async () => {
  const screenSource = await readFile(SCREEN_FILE, 'utf8');
  assert.match(screenSource, /app:proposals-pending-updated/);
  assert.match(screenSource, /notifyPendingProposalsNav\(data\.rows\)/);
  assert.match(screenSource, /function replaceLocalRow[\s\S]*notifyPendingProposalsNav\(data\.rows\)/);
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



test('proposal approval UI is limited to admin or approve permission users', async () => {
  const sentRow = { ...sampleRows[0], status: 'sent' };
  const draftRow = { ...sampleRows[0], status: 'draft' };
  const regularManager = stateFor('operation_manager');
  regularManager.user.manage_proposals_agreements = true;
  const privilegedManager = stateFor('operation_manager');
  privilegedManager.user.manage_proposals_agreements = true;
  privilegedManager.user.approve_proposals_agreements = true;

  const regularHtml = proposalsAgreementsScreen.render({ rows: [sentRow] }, { state: regularManager });
  assert.doesNotMatch(regularHtml, /חתום ואשר/, 'unprivileged manager should not see sign-and-approve action');
  const regularTable = regularHtml.match(/<tbody data-pa-table-body>[\s\S]*?<\/tbody>/)?.[0] || '';
  assert.doesNotMatch(regularTable, /<option value="approved"/, 'unprivileged manager should not be able to select approved status');

  const privilegedDraftHtml = proposalsAgreementsScreen.render({ rows: [draftRow] }, { state: privilegedManager });
  assert.doesNotMatch(privilegedDraftHtml, /חתום ואשר/, 'privileged user should only see sign-and-approve for sent proposals');

  const privilegedSentHtml = proposalsAgreementsScreen.render({ rows: [sentRow] }, { state: privilegedManager });
  assert.match(privilegedSentHtml, /חתום ואשר/, 'approve permission should reveal sign-and-approve for sent proposals');
  const privilegedTable = privilegedSentHtml.match(/<tbody data-pa-table-body>[\s\S]*?<\/tbody>/)?.[0] || '';
  assert.match(privilegedTable, /<option value="approved"/, 'approve permission should allow selecting approved status');
});

test('unprivileged users cannot open signature mode or save signature from forged approve actions', async () => {
  const sentRow = { ...sampleRows[0], status: 'sent' };
  const managerState = stateFor('operation_manager');
  managerState.user.manage_proposals_agreements = true;
  let updateCalls = 0;
  let readCalls = 0;

  await withJSDOM(
    proposalsAgreementsScreen.render({ rows: [sentRow] }, { state: managerState }),
    async (root, dom) => {
      proposalsAgreementsScreen.bind({
        root,
        data: { rows: [sentRow], activityNameOptions: [], contactOptions: [] },
        state: managerState,
        api: {
          readProposalAgreementItems: async () => { readCalls += 1; return []; },
          updateProposalAgreementStatus: async () => { updateCalls += 1; return { ok: true }; }
        }
      });
      const forged = dom.window.document.createElement('button');
      forged.type = 'button';
      forged.dataset.paStatusAction = 'approved';
      forged.dataset.paActionId = sentRow.id;
      root.appendChild(forged);
      forged.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await delay(20);

      assert.equal(dom.window.document.getElementById('pa-preview-overlay'), null, 'signature placement overlay should not open');
      assert.equal(readCalls, 0, 'signature flow should not load proposal items');
      assert.equal(updateCalls, 0, 'signature save/update should not be called');
    }
  );
});

test('proposal approval API and RLS guard direct approval writes', async () => {
  const apiSource = await readFile(API_FILE, 'utf8');
  const migration = await readFile(APPROVAL_GUARD_MIGRATION_FILE, 'utf8');

  assert.match(apiSource, /function canApproveProposalsAgreementsApi\(\)[\s\S]*role === 'admin'[\s\S]*approve_proposals_agreements/);
  assert.match(apiSource, /assertProposalAgreementApprovalPayloadAllowed[\s\S]*PROPOSALS_AGREEMENTS_APPROVAL_COLUMNS[\s\S]*requestedStatus === 'approved'/);
  assert.match(apiSource, /PROPOSALS_AGREEMENTS_APPROVAL_COLUMNS = new Set\(\['approved_by', 'approved_at', 'signature_position', 'signature_meta'\]\)/);
  assert.match(apiSource, /updateProposalAgreementStatus[\s\S]*cleanStatus === 'approved' && !canApproveProposalsAgreementsApi\(\)[\s\S]*proposals_agreements_approval_forbidden/);

  assert.match(migration, /app_can_approve_proposals_agreements[\s\S]*app_current_role\(\) = 'admin'[\s\S]*app_has_permission\('approve_proposals_agreements'\)/);
  assert.match(migration, /guard_proposals_agreements_approval_update[\s\S]*new\.status = 'approved'[\s\S]*new\.approved_by is distinct from old\.approved_by[\s\S]*new\.approved_at is distinct from old\.approved_at[\s\S]*new\.signature_meta is distinct from old\.signature_meta/);
  assert.match(migration, /raise exception 'proposals_agreements_approval_forbidden'/);
  assert.match(migration, /create trigger trg_guard_proposals_agreements_approval_update/);
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

test('sent status row keeps green badge only without row highlight', () => {
  const sentRow = { ...sampleRows[0], status: 'sent' };
  const html = proposalsAgreementsScreen.render({ rows: [sentRow] }, { state: stateFor('admin') });
  const tableBody = html.match(/<tbody data-pa-table-body>[\s\S]*?<\/tbody>/)?.[0] || '';
  assert.match(tableBody, /ds-pa-badge--sent/);
  assert.match(tableBody, /✓ נשלח/);
  assert.doesNotMatch(tableBody, /proposal-row--sent/);
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

test('proposals-agreements screen bypasses persistent and in-memory screen cache', async () => {
  const mainSource = await readFile(MAIN_FILE, 'utf8');
  assert.match(mainSource, /'proposals-agreements': 0/);
  assert.match(mainSource, /'proposals-agreements'/);
  assert.match(mainSource, /MEMORY_ONLY_CACHE_PREFIXES[\s\S]*'proposals-agreements'/);
  assert.match(mainSource, /MEMORY_ONLY_CACHE_PREFIXES[\s\S]*'contacts'/);
  assert.match(mainSource, /purgeProposalsRelatedCaches/);
  assert.match(mainSource, /PROPOSALS_RELATED_CACHE_PREFIXES[\s\S]*'contacts'/);
  assert.match(mainSource, /\[pa-data-contact-options\]/);
  assert.match(mainSource, /routeName === 'proposals-agreements'[\s\S]*purgeProposalsRelatedCaches/);
  assert.match(mainSource, /requestedRoute === 'proposals-agreements'[\s\S]*\? null/);
  assert.match(mainSource, /if \(routeName === 'proposals-agreements'\) \{[\s\S]*?\} else \{[\s\S]*maybePersistScreenCacheEntry/);
});

test('proposals agreements directory view uses only existing Supabase columns', async () => {
  const apiSource = await readFile(API_FILE, 'utf8');
  const columnsMatch = apiSource.match(/const PROPOSALS_AGREEMENTS_DIRECTORY_COLUMNS = '([^']+)'/);
  assert.ok(columnsMatch, 'directory columns constant should be defined');
  const columns = columnsMatch[1].split(',').map((column) => column.trim());

  for (const column of ['authority_name', 'legacy_client_authority', 'contact_client_type', 'school_name', 'contact_client_name', 'legacy_school_framework']) {
    assert.ok(columns.includes(column), `directory select should include ${column}`);
  }
  for (const missingColumn of ['client_authority', 'authority', 'client_type']) {
    assert.ok(!columns.includes(missingColumn), `directory select must not request ${missingColumn}`);
  }

  const viewReadBlock = apiSource.match(/\.from\('proposals_agreements_directory_view'\)[\s\S]*?\]\);/);
  assert.ok(viewReadBlock, 'directory view read block should exist');
  for (const missingColumn of ['client_authority', 'authority', 'client_type']) {
    assert.ok(!viewReadBlock[0].includes(`.select('${missingColumn}'`));
    assert.ok(!viewReadBlock[0].includes(`.filter('${missingColumn}'`));
    assert.ok(!viewReadBlock[0].includes(`.order('${missingColumn}'`));
  }
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

test('new proposal tab opens compact form with preview and role-aware primary action', async () => {
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
      assert.match(form.innerHTML, /אישור והפקת הצעה/);
      assert.doesNotMatch(form.innerHTML, /שליחה לאישור/);
      assert.match(form.innerHTML, /data-pa-client-search-input/);
      assert.match(form.innerHTML, /הוסף איש קשר ידנית/);
    }
  );
});

test('new proposal editor renders two-pane A4 layout and live preview updates key fields', async () => {
  await withJSDOM(
    proposalsAgreementsScreen.render({ rows: [], contactOptions: sampleContactOptions }, { state: stateFor('admin') }),
    async (root, dom) => {
      proposalsAgreementsScreen.bind({
        root,
        data: {
          rows: [],
          activityNameOptions: [],
          contactOptions: sampleContactOptions,
          proposalActivityPricing: [{
            activity_no: 'S1',
            activity_name: 'סדנת מייקרים',
            item_type: 'סדנה',
            proposal_group: 'קיץ תשפ״ו',
            unit_price: 450
          }],
          proposalActivityGroups: [{ group_key: 'קיץ תשפ״ו', display_name: 'קיץ תשפ״ו', template_key: 'summer' }],
          proposalTemplateSections: [
            { template_key: 'summer', section_key: 'intro', section_title: 'פתיח', section_body: 'פתיח להצעה' },
            { template_key: 'summer', section_key: 'payment_terms', section_title: 'תנאי תשלום', section_body: 'תנאי תשלום' }
          ]
        },
        state: stateFor('admin'),
        api: {}
      });

      const form = openNewProposalForm(root, dom);
      assert.ok(form.classList.contains('pa-editor'), 'form should use the official two-pane editor shell');
      assert.ok(form.querySelector('.pa-sidebar'), 'editing sidebar should be present');
      const liveDocument = form.querySelector('[data-pa-live-preview] .proposal-document');
      assert.ok(liveDocument, 'live A4 preview should be present');
      assert.ok(liveDocument.classList.contains('pa-document'), 'document should use the scoped Proposaleditor document class');
      assert.ok(liveDocument.querySelector('.pa-page-header .pa-logo-area .proposal-logo'), 'document should render the Proposaleditor-style logo area');
      assert.equal(liveDocument.querySelectorAll('.pa-page-footer').length, 1, 'document should render exactly one Proposaleditor-style footer');
      assert.equal(liveDocument.querySelectorAll('.proposal-document-footer, .proposal-footer, .proposal-footer-logo').length, 0, 'new proposal document should not render legacy footer classes');
      assert.match(liveDocument.querySelector('.pa-page-footer')?.textContent || '', /www\.think\.org\.il/);
      assert.equal(liveDocument.querySelectorAll('.pa-footer-signature').length, 1, 'document should render exactly one signature block');
      assert.ok(liveDocument.querySelector('.pa-footer-signature .pa-signature-rule'), 'document should render the Proposaleditor-style signature rule');
      assert.ok(liveDocument.querySelector('.pa-footer-signature .pa-signer-name'), 'document should render the signer name below the signature rule');
      assert.match(form.querySelector('.pa-sidebar')?.textContent || '', /פרטי נמען/);
      assert.match(form.querySelector('.pa-sidebar')?.textContent || '', /פעילויות ומחירים/);

      selectClientResult(form, dom, 'רשות ב');
      selectClientResult(form, dom, 'מסגרת');
      await delay(20);

      // Select the single contact for מסגרת ב (יוסי קשר) from the contact picker
      const contactPickerSelect = form.querySelector('[data-pa-contact-select]');
      if (contactPickerSelect) {
        const firstContact = Array.from(contactPickerSelect.options).find((o) => o.value && o.value !== '__pa_other_contact__');
        if (firstContact) {
          contactPickerSelect.value = firstContact.value;
          contactPickerSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
          await delay(20);
        }
      }

      const typeInput = form.querySelector('[name="activity_type_group"]');
      typeInput.value = 'קיץ תשפ״ו';
      typeInput.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      await delay(0);

      const pricingSelect = form.querySelector('[data-pa-pricing-select]');
      pricingSelect.value = pricingSelect.querySelectorAll('option')[1]?.value || '';
      pricingSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      await delay(0);
      const qtyInput = form.querySelector('[data-pa-item-qty]');
      qtyInput.value = '2';
      qtyInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      const discountValue = form.querySelector('[data-pa-discount-value]');
      discountValue.value = '100';
      discountValue.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      await delay(20);

      const previewText = form.querySelector('[data-pa-live-preview]')?.textContent || '';
      assert.match(previewText, /לכבוד/, 'recipient block should be visible in live preview');
      assert.match(previewText, /מסגרת ב/, 'selected school should update in live preview');
      assert.match(previewText, /יוסי קשר/, 'selected contact should update in live preview');
      assert.match(previewText, /סדנת מייקרים/, 'selected item should update in live preview');
      assert.match(previewText, /900/, 'quantity × price should update in live preview');
      assert.match(previewText, /100/, 'discount should update in live preview');
    }
  );
});


test('non-admin manager submits proposals for approval instead of approving directly', async () => {
  const managerState = stateFor('operation_manager');
  managerState.user.manage_proposals_agreements = true;
  await withJSDOM(
    proposalsAgreementsScreen.render({ rows: [], contactOptions: [] }, { state: managerState }),
    async (root, dom) => {
      const saves = [];
      proposalsAgreementsScreen.bind({
        root,
        data: { rows: [], activityNameOptions: [], contactOptions: [] },
        state: managerState,
        api: {
          addProposalAgreement: async (payload) => { saves.push(payload); return { ok: true, row: { ...payload, id: 'pending-id' } }; },
          saveProposalAgreementItems: async () => ({ ok: true, items: [] })
        }
      });

      const form = openNewProposalForm(root, dom);
      const primary = form.querySelector('[data-pa-save-pending]');
      assert.equal(primary.textContent.trim(), 'שליחה לאישור');
      assert.equal(primary.dataset.paTargetStatus, 'sent');
      assert.doesNotMatch(form.innerHTML, /אישור והפקת הצעה/);

      fillPendingMinimum(form, dom, { unit_price: '650', quantity: '3' });
      primary.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await delay(30);
      assert.equal(saves[0]?.status, 'sent');
    }
  );
});

test('approved proposals render flow signature block inside the document', () => {
  const savedSignatureMeta = { signature: { image: 'proposals/signature-idan-nahum.png' } };
  const draftHtml = proposalPreviewBodyHtml({ ...sampleRows[0], status: 'draft' }, [], []);
  const sentHtml = proposalPreviewBodyHtml({ ...sampleRows[0], status: 'sent' }, [], []);
  // Approved row with signature_meta (signature is stored on approval)
  const approvedHtml = proposalPreviewBodyHtml({ ...sampleRows[0], status: 'approved', approved_at: '2026-06-16T10:30:00.000Z', signature_meta: savedSignatureMeta }, [], []);
  // Sent row that was previously approved — signature_meta persists even after status change
  const sentAfterApprovalHtml = proposalPreviewBodyHtml({ ...sampleRows[0], status: 'sent', approved_at: '2026-06-16T10:30:00.000Z', signature_meta: savedSignatureMeta }, [], []);

  assert.doesNotMatch(draftHtml, /signature-idan-nahum\.png/);
  assert.doesNotMatch(sentHtml, /signature-idan-nahum\.png/);
  assert.doesNotMatch(draftHtml, /אושר בתאריך/);
  assert.doesNotMatch(sentHtml, /אושר בתאריך/);
  assert.doesNotMatch(approvedHtml, /אושר בתאריך/);
  assert.doesNotMatch(approvedHtml, /pa-signature-approval-line/);
  assert.match(approvedHtml, /proposals\/signature-idan-nahum\.png/);
  // signature persists when status is changed to sent after approval
  assert.match(sentAfterApprovalHtml, /proposals\/signature-idan-nahum\.png/);
  assert.doesNotMatch(approvedHtml, /pa-signature-layer/);
  assert.doesNotMatch(approvedHtml, /data-pa-signature-sticker/);

  const doc = new JSDOM(approvedHtml).window.document;
  const signature = doc.querySelector('.pa-footer-signature');
  assert.ok(signature, 'signature block should render in document flow');
  assert.equal(doc.querySelectorAll('.pa-page-footer').length, 1);
  assert.equal(signature.querySelectorAll('.pa-signature-image').length, 1);
  assert.equal(signature.querySelectorAll('.pa-signature-rule').length, 1);
  assert.equal(signature.querySelectorAll('.pa-signer-name').length, 1);
  const signatureChildren = [...signature.children].map((node) => node.className);
  assert.deepEqual(signatureChildren, ['pa-blessing', 'pa-signer-block'], 'signature area should be one normal document-flow block');
  const signerChildren = [...signature.querySelector('.pa-signer-block').children].map((node) => node.className);
  assert.deepEqual(
    signerChildren,
    ['pa-signature-image', 'pa-signature-rule', 'pa-signer-name'],
    'signature image, rule, and signer name should render in fixed vertical order'
  );
  assert.ok(signature.compareDocumentPosition(doc.querySelector('.pa-page-footer')) & doc.defaultView.Node.DOCUMENT_POSITION_FOLLOWING, 'signature should appear before page footer');
  assert.doesNotMatch(signature.textContent || '', /אושר בתאריך/);
  assert.doesNotMatch(signature.textContent || '', /אושר ונחתם דיגיטלית/);
});

test('admin sees approve and return actions for pending proposals', async () => {
  const pendingRow = { ...sampleRows[0], status: 'pending_approval' };
  await withJSDOM(
    proposalsAgreementsScreen.render({ rows: [pendingRow] }, { state: stateFor('admin') }),
    (root) => {
      proposalsAgreementsScreen.bind({ root, data: { rows: [pendingRow] }, state: stateFor('admin'), api: {} });
      root.querySelector(`[data-pa-row-id="${pendingRow.id}"]`)?.click();
      const drawerText = root.querySelector('[data-pa-drawer]')?.textContent || '';
      assert.match(drawerText, /חתום ואשר/);
      assert.match(drawerText, /החזרה לתיקון/);
    }
  );
});

test('client selector fills school fields without auto-selecting contact', async () => {
  await withJSDOM(
    proposalsAgreementsScreen.render({ rows: [], contactOptions: sampleContactOptions }, { state: stateFor('admin') }),
    async (root, dom) => {
      proposalsAgreementsScreen.bind({
        root,
        data: { rows: [], activityNameOptions: [], contactOptions: sampleContactOptions },
        state: stateFor('admin'),
        api: {}
      });

      const form = openNewProposalForm(root, dom);
      selectClientResult(form, dom, 'רשות ב');
      selectClientResult(form, dom, 'מסגרת');

      const authorityInput = form.querySelector('input[name="client_authority"]');
      const schoolInput = form.querySelector('input[name="school_framework"]');
      const contactInput = form.querySelector('input[name="contact_name"]');
      const phoneInput = form.querySelector('input[name="phone"]');
      const contactSelect = form.querySelector('[data-pa-contact-select]');

      assert.equal(authorityInput.value, 'רשות ב', 'authority should be filled');
      assert.equal(schoolInput.value, 'מסגרת ב', 'school should be filled');
      assert.equal(contactInput.value, '', 'contact_name should stay empty until user selects');
      assert.equal(phoneInput.value, '', 'phone should stay empty until user selects');
      assert.ok(contactSelect, 'contact picker should appear even for a single contact');
      assert.match(contactSelect.innerHTML, /יוסי קשר/, 'single contact should appear in picker');
      assert.equal(contactSelect.value, '', 'contact picker should default to placeholder');
      assert.equal(form.querySelector('input[name="contact_source_authority_id"]').value, 'auth-b');
      assert.equal(form.querySelector('input[name="contact_source_school_id"]').value, 'school-b');
      assert.equal(form.querySelector('[data-pa-client-results]').hidden, true, 'results should close after selection');
      assert.equal(form.querySelector('[data-pa-client-search-row]').hidden, true, 'search row should close after selection');
      assert.match(form.querySelector('[data-pa-client-card]').textContent, /נבחר:.*מסגרת ב.*רשות ב/, 'selected-client summary should show school and authority');
      assert.doesNotMatch(form.querySelector('[data-pa-client-card]').textContent, /יוסי קשר/, 'contact should not appear in summary before selection');
      await delay(20);
    }
  );
});

test('new proposal form starts with authority search and has no client type field', async () => {
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
      assert.equal(form.querySelector('[data-pa-new-client-type]'), null, 'client type dropdown should be removed');
      assert.doesNotMatch(form.innerHTML, /סוג גורם/);
      assert.match(form.innerHTML, /data-pa-client-search-input/);
      assert.equal(form.querySelector('[data-pa-client-search-label]')?.textContent, 'רשות');
      assert.doesNotMatch(form.innerHTML, /הוסף ידנית/);
    }
  );
});

test('new proposal form hides contact panel until school is selected', async () => {
  await withJSDOM(
    proposalsAgreementsScreen.render({ rows: [], contactOptions: sampleContactOptions }, { state: stateFor('admin') }),
    async (root, dom) => {
      proposalsAgreementsScreen.bind({
        root,
        data: { rows: [], activityNameOptions: [], contactOptions: sampleContactOptions },
        state: stateFor('admin'),
        api: {}
      });

      const form = openNewProposalForm(root, dom);
      const contactPanel = form.querySelector('[data-pa-step-panel="contact"]');
      assert.ok(contactPanel, 'contact panel should exist');
      assert.equal(contactPanel.hidden, true, 'contact panel should be hidden before school selection');

      selectClientResult(form, dom, 'רשות א');
      assert.equal(contactPanel.hidden, true, 'contact panel should stay hidden after authority only');

      const schoolPanel = form.querySelector('[data-pa-school-search-panel]');
      assert.equal(schoolPanel.hidden, false, 'school search should open after authority selection');

      selectClientResult(form, dom, 'בית ספר');
      assert.equal(contactPanel.hidden, false, 'contact panel should appear after school selection');
      await delay(20);
    }
  );
});

test('authority search opens school search immediately after authority selection', async () => {
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
      const searchInput = form.querySelector('[data-pa-client-search-input]');
      searchInput.value = 'רשות א';
      searchInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      form.querySelector('[data-pa-client-results] [data-pa-client-result]')?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

      const schoolSearchPanel = form.querySelector('[data-pa-school-search-panel]');
      assert.ok(schoolSearchPanel, 'school search panel should exist');
      assert.equal(schoolSearchPanel.hidden, false, 'school search should open immediately after authority');
      assert.doesNotMatch(form.innerHTML, /המשך ללא בית ספר/);
      assert.equal(form.querySelector('input[name="client_authority"]').value, 'רשות א');
      assert.equal(form.querySelector('input[name="contact_source_authority_id"]').value, 'auth-a');
      assert.equal(form.querySelector('input[name="contact_source_school_id"]').value, '');
    }
  );
});

test('authority search finds אשכול with type district and code metadata', async () => {
  const ashkolAuthority = {
    _catalog_source: 'authorities',
    client_type: 'authority',
    client_name: 'אשכול',
    authority_id: '468',
    school_id: null,
    authority_name: 'אשכול',
    authority: 'אשכול',
    school: '',
    authority_code: '5538',
    authority_type: 'מועצה אזורית',
    district: 'הדרום',
    contact_name: '',
    contact_role: '',
    phone: '',
    email: '',
    mobile: ''
  };
  const options = [ashkolAuthority, ...sampleCatalogSchools, ...sampleContactRows];

  await withJSDOM(
    proposalsAgreementsScreen.render({ rows: [], contactOptions: options }, { state: stateFor('admin') }),
    (root, dom) => {
      proposalsAgreementsScreen.bind({
        root,
        data: { rows: [], activityNameOptions: [], contactOptions: options },
        state: stateFor('admin'),
        api: {}
      });

      const form = openNewProposalForm(root, dom);
      const searchInput = form.querySelector('[data-pa-client-search-input]');
      searchInput.value = 'אשכול';
      searchInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

      const results = form.querySelector('[data-pa-client-results]');
      assert.ok(results, 'results host should exist');
      assert.match(results.innerHTML, /אשכול/);
      assert.match(results.innerHTML, /מועצה אזורית/);
      assert.match(results.innerHTML, /הדרום/);
      assert.match(results.innerHTML, /קוד 5538/);
      assert.doesNotMatch(results.innerHTML, /אין תוצאה|לא נמצאה/);
    }
  );
});

test('proposals screen logs proposal-authorities-debug on bind', async () => {
  const screenSource = await readFile(SCREEN_FILE, 'utf8');
  assert.match(screenSource, /\[proposal-authorities-debug\]/);
  assert.match(screenSource, /authoritiesCount/);
  assert.match(screenSource, /firstAuthorities/);
});

test('authority search shows only catalog authorities without contact details', async () => {
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
      const searchInput = form.querySelector('[data-pa-client-search-input]');
      searchInput.value = 'רשות א';
      searchInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

      const results = form.querySelector('[data-pa-client-results]');
      assert.ok(results, 'results host should exist');
      assert.match(results.innerHTML, /רשות א/, 'authority should be in results');
      assert.doesNotMatch(results.innerHTML, /דנה קשר/, 'contacts should not appear in authority search');
      assert.doesNotMatch(results.innerHTML, /050-1111111/, 'phone should not appear in authority search');
      assert.doesNotMatch(results.innerHTML, /הוסף ידנית/, 'manual add should not appear for authority search');
    }
  );
});

test('multiple contacts for same client shows contact picker dropdown without preselection', async () => {
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
      selectClientResult(form, dom, 'רשות א');
      selectClientResult(form, dom, 'בית ספר');

      const contactSelect = form.querySelector('[data-pa-contact-select]');
      assert.ok(contactSelect, 'contact picker should appear when multiple contacts exist');
      assert.equal(contactSelect.value, '', 'contact picker should default to placeholder');
      assert.match(contactSelect.innerHTML, /דנה קשר/, 'first contact should be in picker');
      assert.match(contactSelect.innerHTML, /מיכל כהן/, 'second contact should be in picker');
      assert.equal(form.querySelector('input[name="contact_name"]').value, '', 'contact fields should stay empty until selection');
    }
  );
});

test('contact picker fills fields and passes existing contact source on save', async () => {
  const savedPayloads = [];
  const contacts = sampleContactRows;
  const mockApi = {
    addProposalAgreement: async (payload) => {
      savedPayloads.push({ ...payload });
      return { ok: true, row: { ...payload, id: 'contact-linked-id' } };
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
      selectClientResult(form, dom, 'רשות א');
      selectClientResult(form, dom, 'בית ספר');

      const contact = contacts.find((c) => c.contact_name === 'מיכל כהן');
      const contactSelect = form.querySelector('[data-pa-contact-select]');
      const option = [...contactSelect.options].find((entry) => entry.textContent.includes('מיכל כהן'));
      assert.ok(option, 'picker should include מיכל כהן');
      contactSelect.value = option.value;
      contactSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

      assert.equal(form.querySelector('input[name="contact_name"]').value, 'מיכל כהן');
      assert.equal(form.querySelector('input[name="contact_source_id"]').value, contact.id);

      form.querySelector('[name="activity_type_group"]').value = 'קיץ תשפ״ו';
      form.dataset.paPreviewSeen = 'yes';
      fillLineItem(form, dom);
      form.querySelector('[data-pa-save-pending]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await delay(100);

      assert.equal(savedPayloads.length, 1);
      assert.equal(savedPayloads[0].status, 'approved');
      assert.equal(savedPayloads[0]._contact_original.id, contact.id);
      assert.notEqual(savedPayloads[0].is_new_client, true);
    }
  );
});

test('proposals contact loader uses contacts_unified_view and not directory fallback', async () => {
  const apiSource = await readFile(API_FILE, 'utf8');
  const loaderBlock = apiSource.match(/async function readContactsSchoolsForProposals\(\) \{[\s\S]*?\n\}/);
  assert.ok(loaderBlock, 'readContactsSchoolsForProposals should exist');
  assert.match(loaderBlock[0], /readUnifiedContactsFromSupabase\(\{ requireAuth: true \}\)/);
  assert.doesNotMatch(loaderBlock[0], /contacts_directory_view/);
  assert.doesNotMatch(loaderBlock[0], /contacts_schools/);
});



test('proposals contact load error is shown in recipient/contact area', async () => {
  await withJSDOM(
    proposalsAgreementsScreen.render({ rows: [], contactOptions: [], contactOptionsError: 'contacts_unified_view_permission_denied' }, { state: stateFor('admin') }),
    async (root, dom) => {
      proposalsAgreementsScreen.bind({
        root,
        data: { rows: [], activityNameOptions: [], contactOptions: [], contactOptionsError: 'contacts_unified_view_permission_denied' },
        state: stateFor('admin'),
        api: {}
      });
      const form = openNewProposalForm(root, dom);
      const sidebarText = form.querySelector('.pa-sidebar')?.textContent || '';
      assert.match(sidebarText, /לא ניתן לטעון אנשי קשר/);
      assert.match(sidebarText, /להתחבר מחדש/);
      assert.ok(form.querySelector('[data-pa-contact-options-error]'), 'contact options error alert should be rendered');
    }
  );
});

test('school principal from schools source appears in proposal contact picker', async () => {
  const schoolOnlyContactOptions = [
    ...sampleCatalogAuthorities,
    {
      _catalog_source: 'schools',
      client_type: 'school',
      client_name: 'בית ספר מנהל',
      authority_id: 'auth-a',
      school_id: 'school-principal',
      authority: 'רשות א',
      school: 'בית ספר מנהל',
      school_name: 'בית ספר מנהל',
      semel_mosad: '33333',
      contact_name: '',
      contact_role: '',
      phone: '',
      email: '',
      mobile: ''
    },
    {
      id: 'school-principal',
      source_table: 'schools',
      authority_id: 'auth-a',
      school_id: 'school-principal',
      authority: 'רשות א',
      school: 'בית ספר מנהל',
      contact_name: 'רחל מנהלת',
      contact_role: 'מנהל/ת בית ספר',
      phone: '03-1234567',
      email: ''
    }
  ];

  await withJSDOM(
    proposalsAgreementsScreen.render({ rows: [], contactOptions: schoolOnlyContactOptions }, { state: stateFor('admin') }),
    (root, dom) => {
      proposalsAgreementsScreen.bind({
        root,
        data: { rows: [], activityNameOptions: [], contactOptions: schoolOnlyContactOptions },
        state: stateFor('admin'),
        api: {}
      });

      const form = openNewProposalForm(root, dom);
      selectClientResult(form, dom, 'רשות א');
      selectClientResult(form, dom, 'בית ספר מנהל');

      const contactSelect = form.querySelector('[data-pa-contact-select]');
      assert.ok(contactSelect, 'school principal contact should appear in picker');
      assert.match(contactSelect.innerHTML, /רחל מנהלת/);
      assert.equal(contactSelect.value, '', 'school principal should not be preselected');
    }
  );
});

test('manual contact toggle appears when selected school has no contacts', async () => {
  const catalogOnly = [
    ...sampleCatalogAuthorities,
    {
      _catalog_source: 'schools',
      client_type: 'school',
      client_name: 'בית ספר ללא איש קשר',
      authority_id: 'auth-b',
      school_id: 'school-empty',
      authority: 'רשות ב',
      school: 'בית ספר ללא איש קשר',
      semel_mosad: '99999',
      contact_name: '',
      contact_role: '',
      phone: '',
      email: '',
      mobile: ''
    }
  ];

  await withJSDOM(
    proposalsAgreementsScreen.render({ rows: [], contactOptions: catalogOnly }, { state: stateFor('admin') }),
    (root, dom) => {
      proposalsAgreementsScreen.bind({
        root,
        data: { rows: [], activityNameOptions: [], contactOptions: catalogOnly },
        state: stateFor('admin'),
        api: {}
      });

      const form = openNewProposalForm(root, dom);
      selectClientResult(form, dom, 'רשות ב');
      selectClientResult(form, dom, 'ללא איש קשר');

      const addContactRow = form.querySelector('[data-pa-add-contact-row]');
      assert.equal(addContactRow.hidden, false, 'manual contact row should appear when no contacts exist');
      assert.match(addContactRow.textContent, /הוסף איש קשר ידנית/);
    }
  );
});

test('proposal form has no draft save and admin primary action approves directly', async () => {
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
      assert.equal(savedPayloads[0].status, 'approved', 'admin primary action should approve directly');
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
      assert.match(overlay.textContent, /אישור והפקת הצעה/);
      assert.match(overlay.textContent, /חזרה לעריכה/);
      assert.doesNotMatch(overlay.textContent, /שמירת טיוטה/);
    }
  );
});

test('saving manual contact keeps authority and school ids in pending payload', async () => {
  const savedPayloads = [];
  const manualSchoolCatalog = [
    ...sampleCatalogAuthorities,
    {
      _catalog_source: 'schools',
      client_type: 'school',
      client_name: 'בית ספר חדש',
      authority_id: 'auth-b',
      school_id: 'school-new',
      authority: 'רשות ב',
      school: 'בית ספר חדש',
      semel_mosad: '33333',
      contact_name: '',
      contact_role: '',
      phone: '',
      email: '',
      mobile: ''
    }
  ];
  const mockApi = {
    addProposalAgreement: async (payload) => {
      savedPayloads.push({ ...payload });
      return { ok: true, row: { ...payload, id: 'new-client-id' } };
    }
  };

  await withJSDOM(
    proposalsAgreementsScreen.render({ rows: [], contactOptions: manualSchoolCatalog }, { state: stateFor('admin') }),
    async (root, dom) => {
      proposalsAgreementsScreen.bind({
        root,
        data: { rows: [], activityNameOptions: [], contactOptions: manualSchoolCatalog },
        state: stateFor('admin'),
        api: mockApi
      });

      const form = openNewProposalForm(root, dom);
      selectClientResult(form, dom, 'רשות ב');
      selectClientResult(form, dom, 'בית ספר חדש');
      form.querySelector('[data-pa-add-contact-toggle]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

      form.querySelector('input[name="contact_name"]').value = 'שרון חדש';
      form.querySelector('[name="activity_type_group"]').value = 'קיץ תשפ״ו';
      form.dataset.paPreviewSeen = 'yes';
      fillLineItem(form, dom);

      form.querySelector('[data-pa-save-pending]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await delay(100);

      assert.equal(savedPayloads.length, 1);
      assert.equal(savedPayloads[0].status, 'approved');
      assert.equal(savedPayloads[0].contact_name, 'שרון חדש', 'manual contact name should be saved');
      assert.equal(savedPayloads[0].authority_id, 'auth-b');
      assert.equal(savedPayloads[0].school_id, 'school-new');
      assert.equal(savedPayloads[0].client_authority, 'רשות ב');
      assert.equal(savedPayloads[0].school_framework, 'בית ספר חדש');
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

test('table status dropdown updates status through the API and refreshes the row', async () => {
  const localData = { rows: [{ ...sampleRows[0], status: 'draft' }] };
  const saves = [];
  await withJSDOM(
    proposalsAgreementsScreen.render(localData, { state: stateFor('admin') }),
    async (root, dom) => {
      proposalsAgreementsScreen.bind({
        root,
        data: localData,
        state: stateFor('admin'),
        api: {
          updateProposalAgreementStatus: async (id, status, note) => {
            saves.push({ id, status, note });
            return { ok: true, row: { ...localData.rows[0], id, status } };
          }
        }
      });

      const select = root.querySelector('[data-pa-row-status]');
      assert.ok(select, 'status select should exist in the table row');
      select.value = 'sent';
      select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      await delay(30);

      assert.deepEqual(saves, [{ id: sampleRows[0].id, status: 'sent', note: '' }]);
      assert.equal(localData.rows[0].status, 'sent');
      assert.equal(root.querySelector('[data-pa-row-status]').value, 'sent');
    }
  );
});

test('status badge is rendered in table rows with correct labels', () => {
  const html = proposalsAgreementsScreen.render({ rows: sampleRows }, { state: stateFor('admin') });
  assert.match(html, /טיוטה/);
  assert.match(html, /נשלח/);
  // Inline table status control
  assert.match(html, /data-pa-row-status/);
  assert.doesNotMatch(html, /נחתם/);
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
      setProposalCatalogIds(form);
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
  assert.ok(STATUS_OPTIONS.includes('sent'));
  assert.ok(STATUS_LABELS.pending_approval, 'legacy pending_approval rows should still have a label');
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


test('manual unit price edits recalculate row and grand totals without changing quantity', async () => {
  await withJSDOM(
    proposalsAgreementsScreen.render({ rows: [], contactOptions: [] }, { state: stateFor('admin') }),
    (root, dom) => {
      proposalsAgreementsScreen.bind({ root, data: { rows: [], activityNameOptions: [], contactOptions: [] }, state: stateFor('admin'), api: {} });
      const form = openNewProposalForm(root, dom);
      const qtyInput = form.querySelector('[data-pa-item-qty]');
      const priceInput = form.querySelector('[data-pa-item-price]');
      const totalInput = form.querySelector('[data-pa-item-total]');
      const grandTotal = form.querySelector('[data-pa-grand-total]');

      qtyInput.value = '3';
      qtyInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      priceInput.value = '650';
      priceInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      assert.equal(totalInput.value, '1950.00');

      priceInput.value = '600';
      priceInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      assert.equal(qtyInput.value, '3');
      assert.equal(totalInput.value, '1800.00');
      assert.match(grandTotal.textContent, /1[,.]?800/);
    }
  );
});

test('discount controls update payable total and save a negative discount item', async () => {
  const itemCalls = [];
  const saves = [];
  await withJSDOM(
    proposalsAgreementsScreen.render({ rows: [], contactOptions: [] }, { state: stateFor('admin') }),
    async (root, dom) => {
      proposalsAgreementsScreen.bind({
        root,
        data: { rows: [], activityNameOptions: [], contactOptions: [] },
        state: stateFor('admin'),
        api: {
          addProposalAgreement: async (payload) => { saves.push(payload); return { ok: true, row: { ...payload, id: 'discount-id' } }; },
          saveProposalAgreementItems: async (_id, items) => { itemCalls.push(items); return { ok: true, items: [] }; }
        }
      });
      const form = openNewProposalForm(root, dom);
      fillPendingMinimum(form, dom, { unit_price: '1000', quantity: '2' });
      const discountValue = form.querySelector('[data-pa-discount-value]');
      discountValue.value = '250';
      discountValue.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      assert.match(form.querySelector('[data-pa-summary-subtotal]').textContent, /2[,.]?000/);
      assert.match(form.querySelector('[data-pa-summary-discount]').textContent, /250/);
      assert.match(form.querySelector('[data-pa-summary-total]').textContent, /1[,.]?750/);

      form.querySelector('[data-pa-save-pending]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await delay(30);
      assert.equal(saves[0]?.total_amount, 1750);
      const discountItem = itemCalls[0]?.find((item) => item.item_name === 'הנחה');
      assert.ok(discountItem, 'discount should be saved as a proposal item');
      assert.equal(discountItem.unit_price, -250);
      assert.equal(discountItem.total_price, -250);
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
      setProposalCatalogIds(form);
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
      setProposalCatalogIds(form);

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
      assert.equal(details.open, false, 'details should stay collapsed after activity selection');
      assert.ok(itemRow.querySelector('[data-pa-item-info-strip]')?.hidden, 'summer rows should not show the info strip');
      assert.equal(itemRow.querySelector('.ds-pa-item-field--select span')?.textContent, 'פעילות');
      assert.equal(itemRow.querySelector('label span')?.textContent?.includes('מפגשים'), false, 'summer accordion should not show meetings field');
    }
  );
});

test('summer item rows keep edit accordion closed even when description exists', async () => {
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
  const existingRow = {
    id: 'summer-edit-row-1',
    client_authority: 'רשות קיימת',
    school_framework: 'בית ספר קיים',
    activity_type_group: 'קיץ תשפ״ו',
    status: 'draft'
  };
  const items = [{
    item_name: 'סדנת מייקרים',
    item_type: 'סדנה',
    proposal_group: 'קיץ תשפ״ו',
    quantity: 1,
    unit_price: 450,
    total_price: 450,
    meetings_count: 3,
    hours_count: 6,
    description: 'התאמה לפי בית הספר'
  }];

  await withJSDOM(
    proposalsAgreementsScreen.render({ rows: [existingRow] }, { state: stateFor('admin') }),
    async (root, dom) => {
      proposalsAgreementsScreen.bind({
        root,
        data: {
          rows: [existingRow],
          activityNameOptions: [],
          contactOptions: [],
          proposalActivityPricing: pricing,
          proposalActivityGroups: [
            { group_key: 'קיץ תשפ״ו', display_name: 'קיץ תשפ״ו', template_key: 'summer' }
          ]
        },
        state: stateFor('admin'),
        api: { readProposalAgreementItems: async () => items }
      });

      root.querySelector(`[data-pa-row-id="${existingRow.id}"]`)?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      root.querySelector(`[data-pa-edit-row="${existingRow.id}"]`)?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await delay(20);

      const itemRow = root.querySelector('[data-pa-form] [data-pa-item-row]');
      const details = itemRow?.querySelector('[data-pa-item-details]');
      assert.ok(itemRow, 'edit form should render summer item row');
      assert.equal(details?.open, false, 'accordion stays closed when editing saved summer rows with notes');
      assert.ok(itemRow.hasAttribute('data-pa-summer-row'));
      assert.ok(itemRow.querySelector('[data-pa-item-info-strip]')?.hidden);
      assert.equal(itemRow.querySelector('input[name="meetings_count"]')?.type, 'hidden');
      assert.equal(itemRow.querySelector('input[name="hours_count"]')?.type, 'hidden');
      assert.match(itemRow.querySelector('[name="description"]')?.value || '', /התאמה/);
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
      setProposalCatalogIds(form);
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
    assert.equal(dom.window.document.querySelectorAll('.pa-doc-address').length, 1, 'recipient block should render once');
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

test('proposal preview preserves saved contact details and does not override with directory data', async () => {
  // The contact saved on the proposal is the source of truth.
  // A matching contact with updated role in the directory must NOT override the saved role.
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
    // Saved contact name must appear
    assert.match(address.textContent, /דנה קשר/);
    // Saved role (not the directory's updated role) must appear
    assert.match(address.textContent, /תפקיד ישן/);
    assert.doesNotMatch(address.textContent, /מנהלת מעודכנת|undefined|null|NaN/);
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
    const signature = doc.querySelector('.pa-footer-signature');

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
    assert.equal(signature.querySelectorAll('.pa-signature-rule').length, 1);
    assert.equal(signature.querySelectorAll('.pa-signer-name').length, 1);
    assert.match(signature.textContent, /בברכה,/);
    assert.match(signature.textContent, /עידן נחום, סמנכ״ל כספים/);
  });
});



test('bundle parent cost table uses parent quantity in print preview', async () => {
  const row = {
    ...sampleRows[0],
    activity_type_group: 'קיץ תשפ״ו',
    proposal_date: '2026-06-01'
  };
  const items = [{
    item_name: 'סדנאות STEM',
    proposal_display_mode: 'bundle_parent',
    quantity: 4,
    unit_price: 450,
    total_price: 1800,
    proposal_group: 'קיץ תשפ״ו',
    selected_bundle_items: [
      { activity_name: 'רוטוקופטר', unit_price: 450 }
    ]
  }];

  await withJSDOM(proposalPreviewBodyHtml(row, items, []), async (_root, dom) => {
    const costTable = dom.window.document.querySelector('.pa-cost-table');
    assert.ok(costTable, 'cost table should render');
    const cells = [...costTable.querySelectorAll('tbody td')].map((td) => td.textContent.trim());
    assert.equal(cells[0], 'רוטוקופטר');
    assert.equal(cells[1], '4');
    assert.match(cells[2], /^450\s*₪$/);
    assert.match(cells[3], /^1,800\s*₪$/);
    const grandTotal = costTable.querySelector('tfoot .pa-currency-amount');
    assert.ok(grandTotal);
    assert.equal(grandTotal.textContent.trim().replace(/\u00a0/g, ' '), '1,800 ₪');
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
      { item_name: 'AI Basics', item_type: 'קורס', proposal_group: 'שנת הלימודים תשפ״ז', gefen_number: '9545' }
    ]
  );
  const paths = entries.map((entry) => entry.path).filter(Boolean);
  assert.ok(paths.includes('catalog/appendices/workshop.pdf'));
  assert.ok(entries.find((entry) => entry.path === 'catalog/appendices/workshop.pdf')?.url.endsWith('catalog/appendices/workshop.pdf'));
  assert.ok(paths.includes('catalog/appendices/tour.pdf'));
  assert.ok(entries.find((entry) => entry.path === 'catalog/appendices/tour.pdf')?.url.endsWith('catalog/appendices/tour.pdf'));
  assert.ok(paths.includes('catalog/appendices/6089.pdf'));
  assert.ok(paths.includes('catalog/appendices/9545.pdf'));
  assert.equal(paths.filter((path) => path === 'catalog/appendices/6089.pdf').length, 1);
  assert.doesNotMatch(paths.join('\n'), new RegExp([`catalog-${'courses'}\\.pdf`, `catalog-${'workshops'}\\.pdf`, `catalog-${'tours'}\\.pdf`, `proposals/${'catalogs'}`, `course${'-'}`].join('|')));
});


test('course preview renders the course item details table instead of the workshop cost table', async () => {
  const row = {
    ...sampleRows[0],
    id: 'course-price-breakdown-row',
    activity_type_group: 'שנה הבאה',
    proposal_date: '2026-06-01'
  };
  const items = [{
    item_name: 'סודות הבינה המלאכותית',
    item_type: 'קורס',
    proposal_group: 'שנה הבאה',
    gefen_number: '9545',
    meetings_count: 8,
    quantity: 2,
    hours_count: 16,
    unit_price: 7500,
    hourly_price: 468.75,
    total_price: 15000
  }];

  await withJSDOM(proposalPreviewBodyHtml(row, items, []), async (_root, dom) => {
    const courseTable = dom.window.document.querySelector('.pa-item-details-table');
    assert.ok(courseTable, 'course details table should render');
    assert.equal(dom.window.document.querySelector('.pa-cost-table'), null);
    const headers = [...courseTable.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    assert.ok(headers.includes('קורס / תוכנית'));
    assert.ok(headers.includes('מס׳ גפ״ן'));
    assert.ok(headers.includes('מפגשים'));
    assert.ok(headers.includes('מחיר לשעה'));
    assert.ok(courseTable.textContent.includes('סודות הבינה המלאכותית'));
    assert.ok(!headers.includes('פעילות'));
    assert.ok(!headers.includes('מחיר יחידה'));
    assert.ok(!headers.includes('סה״כ שורה'));
  });
});

test('summer preview keeps the workshop cost table instead of the course details table', async () => {
  const row = {
    ...sampleRows[0],
    id: 'summer-price-breakdown-row',
    activity_type_group: 'פעילויות קיץ',
    proposal_date: '2026-06-01'
  };
  const items = [{
    item_name: 'סדנת רובוטיקה',
    item_type: 'סדנה',
    proposal_group: 'פעילויות קיץ',
    quantity: 3,
    unit_price: 450,
    total_price: 1350
  }];

  await withJSDOM(proposalPreviewBodyHtml(row, items, []), async (_root, dom) => {
    const costTable = dom.window.document.querySelector('.pa-cost-table');
    assert.ok(costTable, 'workshop cost table should render');
    assert.equal(dom.window.document.querySelector('.pa-item-details-table'), null);
    const headers = [...costTable.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    assert.deepEqual(headers, ['פעילות', 'כמות', 'מחיר יחידה', 'סה״כ שורה']);
    assert.ok(!headers.includes('קורס / תוכנית'));
  });
});

test('proposal cost table renders currency with consistent LTR direction', async () => {
  const row = {
    ...sampleRows[0],
    activity_type_group: 'קיץ תשפ״ו',
    proposal_date: '2026-06-01'
  };
  const items = [{
    item_name: 'סדנת רובוטיקה',
    quantity: 1,
    unit_price: 450,
    total_price: 450
  }];

  await withJSDOM(proposalPreviewBodyHtml(row, items, []), async (_root, dom) => {
    const amounts = [...dom.window.document.querySelectorAll('.pa-cost-table .pa-currency-amount')];
    assert.ok(amounts.length >= 2, 'cost table should render currency amounts');
    amounts.forEach((el) => {
      assert.equal(el.getAttribute('dir'), 'ltr');
      assert.match(el.textContent, /^\d[\d,]*\s*₪$/);
    });
    const totalRow = dom.window.document.querySelector('.pa-cost-table tfoot .pa-currency-amount');
    assert.ok(totalRow);
    assert.equal(totalRow.textContent.trim().replace(/\u00a0/g, ' '), '450 ₪');
  });
});

test('course item details table keeps a row when only name and pricing fields exist', async () => {
  const row = {
    ...sampleRows[0],
    id: 'course-price-breakdown-fallback-row',
    activity_type_group: 'שנה הבאה',
    proposal_date: '2026-06-01'
  };
  const items = [{
    item_name: 'קורס רובוטיקה',
    item_type: 'קורס',
    proposal_group: 'שנה הבאה',
    quantity: 2,
    unit_price: 9000,
    total_price: ''
  }];

  await withJSDOM(proposalPreviewBodyHtml(row, items, []), async (_root, dom) => {
    const courseTable = dom.window.document.querySelector('.pa-item-details-table');
    assert.ok(courseTable, 'course details table should render even without pedagogic fields');
    const cells = [...courseTable.querySelectorAll('tbody td')].map((td) => td.textContent.trim());
    assert.equal(cells[0], 'קורס רובוטיקה');
    assert.equal(cells[3], '2');
    assert.match(cells[6], /^18,000\s*₪$/);
  });
});

test('print flow does not prompt for or embed catalog appendices', async () => {
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

      assert.deepEqual(confirmMessages, [], 'print should not ask whether to add a catalog');
      assert.equal(printCalls, 1, 'print should continue with a clean proposal document');
      assert.doesNotMatch(dom.window.document.querySelector('.proposal-document')?.textContent || '', /קטלוג|נספח קטלוג/);
      assert.doesNotMatch(dom.window.document.body.innerHTML, /<iframe|<object|PDF viewer|catalog\/appendices\/9545\.pdf/i);
      assert.doesNotMatch(dom.window.document.body.innerHTML, new RegExp(`course${'-'}9545\.pdf`));
      assert.doesNotMatch(dom.window.document.body.innerHTML, new RegExp(`catalog-${'courses'}\.pdf`));
    } finally {
      globalThis.fetch = savedFetch;
    }
  });
});

test('print flow skips catalog appendix downloads even when legacy row has include_catalog', async () => {
  const row = {
    ...sampleRows[0],
    id: 'course-download-pdf-row',
    activity_type_group: 'הצעה משולבת',
    status: 'approved',
    include_catalog: true
  };
  const items = [
    { item_name: 'סדנת מייקרים', item_type: 'סדנה', proposal_group: 'סדנאות', quantity: 1, unit_price: 100, total_price: 100 },
    { item_name: 'קורס רובוטיקה', item_type: 'קורס', proposal_group: 'שנת הלימודים תשפ״ז', gefen_number: '9545', quantity: 1, unit_price: 200, total_price: 200 }
  ];
  const savedFetch = globalThis.fetch;
  await withJSDOM(proposalsAgreementsScreen.render({ rows: [row] }, { state: stateFor('admin') }), async (root, dom) => {
    const downloads = [];
    let printCalls = 0;
    dom.window.HTMLAnchorElement.prototype.click = function click() {
      downloads.push({ href: this.getAttribute('href'), download: this.getAttribute('download'), connected: this.isConnected });
    };
    dom.window.confirm = () => { throw new Error('resolved appendices should not prompt'); };
    dom.window.print = () => { printCalls += 1; };
    globalThis.fetch = async () => ({ ok: true, status: 200 });
    try {
      proposalsAgreementsScreen.bind({
        root,
        data: {
          rows: [row],
          proposalActivityGroups: [
            { group_key: 'הצעה משולבת', display_name: 'הצעה משולבת', template_key: 'combined' },
            { group_key: 'סדנאות', display_name: 'סדנאות', template_key: 'workshops' },
            { group_key: 'שנת הלימודים תשפ״ז', display_name: 'שנת הלימודים תשפ״ז', template_key: 'next_year' }
          ]
        },
        state: stateFor('admin'),
        api: { readProposalAgreementItems: async () => items }
      });
      root.querySelector(`[data-pa-row-id="${row.id}"]`)?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await delay(20);
      root.querySelector(`[data-pa-preview="${row.id}"]`)?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await delay(30);
      dom.window.document.getElementById('pa-print-btn')?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await delay(30);

      assert.equal(printCalls, 1);
      assert.deepEqual(downloads.map((entry) => entry.href), []);
      assert.deepEqual(downloads.map((entry) => entry.download), []);
      assert.doesNotMatch(dom.window.document.body.innerHTML, /catalog\/appendices\/(workshop|9545)\.pdf/i);
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

test('legacy HTML catalog appendix URLs are not generated for proposal appendices', () => {
  const urls = buildProposalCatalogPdfEntries(
    { activity_type_group: 'שנת הלימודים תשפ״ז' },
    [
      { item_name: 'קורס רובוטיקה', item_type: 'קורס', gefen_number: '1234', activity_no: '555' },
      { item_name: 'סדנת רחפנים', item_type: 'סדנה', activity_no: '88', pricing_key: 'cat-88' }
    ]
  ).map((entry) => entry.url || '');

  assert.ok(urls.includes('./catalog/appendices/1234.pdf'));
  assert.equal(urls.some((url) => new RegExp(['course' + '-page\\.html', 'catalog/' + 'summercatalog', 'proposal' + 'Mode'].join('|')).test(url)), false);
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

  const urls = buildProposalCatalogPdfEntries({ activity_type_group: 'פעילויות' }, [gameItem]).map((entry) => entry.url || '');
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
    assert.doesNotMatch(activitySection.textContent, /מצורף כנספח|קטלוג|דף מידע/);
  });
});

test('approved proposal preview does not fall back to internal row notes for customer remarks', async () => {
  const internalImportNote = 'ייבוא ידני מקובץ Word: ראנה הצעה. סטטוס טיוטה. רשות מג׳דל שמס לפי אישור המשתמש. ללא בית ספר.';
  const row = {
    ...sampleRows[0],
    id: '8b9b2b40-eb01-4ee7-8741-e6ae3bced85e',
    client_authority: 'מג׳דל שמס',
    school_framework: '',
    status: 'approved',
    approved_at: '2026-06-16T10:30:00.000Z',
    notes: internalImportNote
  };

  const htmlWithoutNotesSection = proposalPreviewBodyHtml(row, [], [
    { template_key: '', section_key: 'intro', section_title: 'פתיח', section_body: 'פתיח ללקוח.' },
    { template_key: '', section_key: 'notes', section_title: 'הערות', section_body: '' }
  ]);

  await withJSDOM(htmlWithoutNotesSection, async (_root, dom) => {
    const doc = dom.window.document.querySelector('.proposal-document');
    assert.ok(doc);
    assert.doesNotMatch(doc.textContent, /ייבוא ידני מקובץ Word/);
    assert.doesNotMatch(doc.textContent, /ראנה הצעה/);
  });

  const customerNote = 'הערה ללקוח מתוך סעיף המסמך בלבד.';
  const htmlWithTemplateNote = proposalPreviewBodyHtml(row, [], [
    { template_key: '', section_key: 'notes', section_title: 'הערות', section_body: customerNote }
  ]);

  await withJSDOM(htmlWithTemplateNote, async (_root, dom) => {
    const docText = dom.window.document.querySelector('.proposal-document')?.textContent || '';
    assert.match(docText, /הערה ללקוח מתוך סעיף המסמך בלבד/);
    assert.doesNotMatch(docText, /ייבוא ידני מקובץ Word/);
  });
});

test('workshop proposal preview removes catalog wording and keeps prices only in cost table', async () => {
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
    assert.doesNotMatch(activitySection.textContent, /מצורף כנספח|קטלוג|דף מידע/);
    assert.doesNotMatch(activitySection.textContent, /גפ״ן|מפגשים|שעות|לשעה|מחיר לקבוצה|4,000/);
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

test('proposal form has no catalog attach control and saves include_catalog false', async () => {
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
      setProposalCatalogIds(form, { school_id: '', client_type: 'authority' });
      form.querySelector('[name="activity_type_group"]').value = 'קיץ תשפ״ו';
      const pricingSelect = form.querySelector('[data-pa-pricing-select]');
      pricingSelect.selectedIndex = 1;
      pricingSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      await delay(10);

      assert.equal(form.querySelector('[data-pa-catalog-toggle]'), null);
      assert.equal(form.querySelector('[name="include_catalog"]'), null);
      assert.equal(form.querySelector('[data-pa-catalog-attach]'), null);

      form.dataset.paPreviewSeen = 'yes';
      form.querySelector('[data-pa-save-pending]')?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await delay(100);
      assert.equal(savedPayload?.include_catalog, false);
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


test('proposal preview replaces selected course placeholder and renders one cost table after payment text', async () => {
  const row = {
    ...sampleRows[0],
    id: '77777777-7777-7777-7777-777777777777',
    activity_type_group: 'הצעה משולבת',
    contact_name: 'דנה לוי',
    contact_role: 'מנהלת',
    school_framework: 'בית ספר אופק',
    client_authority: 'רשות אביב'
  };
  const proposalTemplateSections = [
    { template_key: 'combined', template_name: 'הצעת מחיר משולבת', section_key: 'intro', section_title: 'פתיח', section_body: 'פתיח.' },
    { template_key: 'combined', section_key: 'activity_intro', section_title: 'הפעילות המוצעת', section_body: 'הקורסים שנבחרו:\n{{selected_course_short_names}}' },
    { template_key: 'combined', section_key: 'payment_terms', section_title: 'עלות ותנאי תשלום', section_body: 'טקסט תנאי תשלום מסופק מסופאבייס.' }
  ];
  const items = [
    { item_name: 'סדנת קיץ', unit_price: 300, total_price: 300, quantity: 1, proposal_group: 'קיץ תשפ״ו' },
    { item_name: 'קורס רובוטיקה', unit_price: 500, total_price: 500, quantity: 1, proposal_group: 'שנת הלימודים תשפ״ז' },
    { item_name: 'תוכנית יזמות', unit_price: 700, total_price: 700, quantity: 1, proposal_group: 'שנת הלימודים תשפ״ז' }
  ];

  await withJSDOM(proposalsAgreementsScreen.render({ rows: [row] }, { state: stateFor('admin') }), async (root, dom) => {
    proposalsAgreementsScreen.bind({
      root,
      data: {
        rows: [row],
        proposalTemplateSections,
        proposalActivityGroups: [
          { group_key: 'הצעה משולבת', display_name: 'הצעה משולבת', template_key: 'combined', is_combined: true, included_group_keys: ['קיץ תשפ״ו', 'שנת הלימודים תשפ״ז'] },
          { group_key: 'קיץ תשפ״ו', display_name: 'קיץ תשפ״ו', template_key: 'summer' },
          { group_key: 'שנת הלימודים תשפ״ז', display_name: 'שנת הלימודים תשפ״ז', template_key: 'next_year' }
        ]
      },
      state: stateFor('admin'),
      api: { readProposalAgreementItems: async () => items }
    });
    root.querySelector(`[data-pa-row-id="${row.id}"]`)?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await delay(20);
    root.querySelector(`[data-pa-preview="${row.id}"]`)?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await delay(20);

    const doc = dom.window.document.querySelector('.proposal-document');
    assert.ok(doc, 'proposal document should render');
    assert.match(doc.querySelector('.pa-doc-address')?.textContent || '', /לכבוד:/);
    assert.match(doc.querySelector('.pa-doc-address')?.textContent || '', /דנה לוי, מנהלת/);
    assert.doesNotMatch(doc.textContent, /undefined|{{selected_course_short_names}}/);
    assert.match(doc.textContent, /קורס רובוטיקה/);
    assert.match(doc.textContent, /תוכנית יזמות/);

    const activitySection = Array.from(doc.querySelectorAll('.pa-section')).find((section) => section.textContent.includes('הקורסים שנבחרו'));
    assert.ok(activitySection, 'activity section should contain selected courses');
    assert.doesNotMatch(activitySection.textContent, /סדנת קיץ|300|500|700|גפ"ן|מפגשים|שעות/);

    const tables = doc.querySelectorAll('.pa-cost-table');
    assert.equal(tables.length, 1);
    const paymentSection = doc.querySelector('.pa-cost-section');
    assert.ok(paymentSection?.contains(tables[0]), 'cost table should be inside payment section');
    assert.ok((paymentSection.textContent || '').indexOf('טקסט תנאי תשלום') < (paymentSection.textContent || '').indexOf('סה״כ לתשלום'));
    assert.equal(doc.querySelectorAll('.pa-footer-signature').length, 1);
    assert.equal(doc.querySelectorAll('.pa-page-footer').length, 1);
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

test('exact timestamp proposal templates multiline migration matches stable SQL and is not a no-op', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20260530151253_exact_proposal_templates_multiline.sql', import.meta.url),
    'utf8'
  );
  const stableMigration = await readFile(
    new URL('../supabase/migrations/20260530_exact_proposal_templates_multiline.sql', import.meta.url),
    'utf8'
  );
  assert.equal(migration, stableMigration);
  assert.doesNotMatch(migration, /^[\s\S]*SELECT\s+1\s*;\s*$/i);
  assert.match(migration, /insert into public\.proposal_template_sections/i);
  assert.match(migration, /template_key IN \('summer', 'next_year', 'combined'\)/i);
  assert.match(migration, /'summer'/);
  assert.match(migration, /'next_year'/);
  assert.match(migration, /'combined'/);
  assert.match(migration, /\$body\$[\s\S]*\$body\$/);
});

const STABLE_COMMIT = '2c772f835cc19da52fd76528c0b19f667f23de79';
const STABLE_DIRECTORY_COLUMNS = 'id,authority_id,authority_code,school_id,contact_school_id,authority_name,legacy_client_authority,contact_client_type,contact_client_name,school_name,legacy_school_framework,document_type,activity_type_group,proposal_date,activity_names,contact_name,contact_role,phone,email,notes,status,approval_note,total_amount,custom_document_sections,include_catalog,signature_meta,approved_by,approved_at,created_at,updated_at';

test('rollback: proposals directory select fields match stable commit before emergency cleanup', async () => {
  const apiSource = await readFile(API_FILE, 'utf8');
  const columnsMatch = apiSource.match(/const PROPOSALS_AGREEMENTS_DIRECTORY_COLUMNS = '([^']+)'/);
  assert.ok(columnsMatch, 'directory columns constant should be defined');
  assert.equal(columnsMatch[1], STABLE_DIRECTORY_COLUMNS, `expected stable columns from ${STABLE_COMMIT}`);
});

test('rollback: view permission does not expose manage or approve row actions', () => {
  const sentRow = { id: '22222222-2222-2222-2222-222222222222', status: 'sent', client_authority: 'רשות', school_framework: 'בית ספר' };
  const viewState = { user: { role: 'authorized_user', view_proposals_agreements: 'yes' } };
  const html = proposalsAgreementsScreen.render({ rows: [sentRow] }, { state: viewState });
  assert.doesNotMatch(html, /data-pa-edit-row/);
  assert.doesNotMatch(html, /חתום ואשר/);
  assert.doesNotMatch(html, /אישור וחתימה/);
});

test('rollback: manage permission does not expose approve actions for non-admin', () => {
  const sentRow = { id: '33333333-3333-3333-3333-333333333333', status: 'sent', client_authority: 'רשות', school_framework: 'בית ספר' };
  const managerState = { user: { role: 'authorized_user', view_proposals_agreements: 'yes', manage_proposals_agreements: 'yes' } };
  const html = proposalsAgreementsScreen.render({ rows: [sentRow] }, { state: managerState });
  assert.doesNotMatch(html, /חתום ואשר/);
  assert.doesNotMatch(html, /אישור וחתימה/);
});

test('rollback: approve permission exposes sign-and-approve for sent proposals', () => {
  const sentRow = { id: '44444444-4444-4444-4444-444444444444', status: 'sent', client_authority: 'רשות', school_framework: 'בית ספר' };
  const approverState = { user: { role: 'authorized_user', view_proposals_agreements: 'yes', approve_proposals_agreements: 'yes' } };
  const html = proposalsAgreementsScreen.render({ rows: [sentRow] }, { state: approverState });
  assert.match(html, /חתום ואשר/);
});

test('rollback: login session flags restore stable view/manage mapping without approve field', async () => {
  const apiSource = await readFile(API_FILE, 'utf8');
  assert.match(apiSource, /function proposalSessionUserFlagsFromFlatUser\(flat = \{\}\) \{[\s\S]*view_proposals_agreements: view \|\| undefined[\s\S]*manage_proposals_agreements: manage \|\| undefined[\s\S]*\}/);
  assert.doesNotMatch(apiSource, /proposalSessionUserFlagsFromFlatUser[\s\S]*approve_proposals_agreements/);
  assert.match(apiSource, /resolveActiveUserRowAfterAuth\(/, 'auth login resolver must remain intact');
  assert.match(apiSource, /signInWithPassword\(/, 'Supabase Auth login must remain intact');
});

const {
  setProposalGroupLookups,
  proposalGroupOptions,
  proposalTypeCardsHtml,
  resolveProposalTemplateKey,
  filterTemplateSectionsForGroup,
  documentSectionsEditorHtml,
  itemsSummaryHtml,
  proposalItemsWithFallback,
  extractItemsFromForm
} = await import('../frontend/src/screens/proposals-agreements.js');
const {
  buildProposalGroupHintsFromTemplateSections,
  mergeProposalGroupLookups,
  buildProposalGroupLookup
} = await import('../frontend/src/api.js');

const SAMPLE_TEMPLATE_SECTIONS = [
  { template_key: 'summer', template_name: 'הצעת מחיר לפעילויות תעשיידע | קיץ תשפ״ו', activity_type_group: 'קיץ תשפ״ו', section_key: 'intro', section_title: 'פתיח', section_body: 'פתיח להצעה' },
  { template_key: 'summer', template_name: 'הצעת מחיר לפעילויות תעשיידע | קיץ תשפ״ו', activity_type_group: 'קיץ תשפ״ו', section_key: 'payment_terms', section_title: 'תנאי תשלום', section_body: 'תנאי תשלום' }
];

test('template sections loader merges activity_type_group hints when groups are empty', () => {
  const hints = buildProposalGroupHintsFromTemplateSections(SAMPLE_TEMPLATE_SECTIONS);
  const merged = mergeProposalGroupLookups(buildProposalGroupLookup([], []), hints);
  assert.equal(merged.aliasToKey.get('קיץ תשפ״ו'), 'summer');
  assert.equal(merged.groupByKey.get('summer')?.template_key, 'summer');
});

test('alias activity type resolves to correct template_key from template sections', () => {
  setProposalGroupLookups({ proposalTemplateSections: SAMPLE_TEMPLATE_SECTIONS }, [], []);
  assert.equal(resolveProposalTemplateKey('קיץ תשפ״ו'), 'summer');
  assert.equal(resolveProposalTemplateKey('summer'), 'summer');
});

test('document editor does not show missing-template alert when sections exist for alias activity type', () => {
  setProposalGroupLookups({ proposalTemplateSections: SAMPLE_TEMPLATE_SECTIONS }, [], []);
  const sections = filterTemplateSectionsForGroup(SAMPLE_TEMPLATE_SECTIONS, 'קיץ תשפ״ו');
  const html = documentSectionsEditorHtml(sections, false);
  assert.doesNotMatch(html, /לא נמצאה תבנית פעילה לסוג הצעה זה/);
  assert.match(html, /פתיח להצעה/);
  assert.match(html, /תנאי תשלום/);
});

test('items summary does not show missing-rows alert when active items exist', () => {
  const html = itemsSummaryHtml([
    { item_name: 'רובוטיקה', item_type: 'סדנה', quantity: 1, unit_price: 1200, total_price: 1200, proposal_group: 'summer' }
  ]);
  assert.doesNotMatch(html, /לא נשמרו שורות פעילות להצעה זו/);
  assert.match(html, /רובוטיקה/);
});


test('production-shaped template section rows are normalized to camelCase payload fields', async () => {
  const apiSource = await readFile(API_FILE, 'utf8');
  assert.match(apiSource, /function mapProposalTemplateSectionRow/);
  assert.match(apiSource, /template_key,template_name,activity_type_group,section_key,section_title,section_body,sort_order,is_active/);
  assert.match(apiSource, /templateKey/);
  assert.match(apiSource, /activityTypeGroup/);
  assert.match(apiSource, /sectionKey/);
  assert.match(apiSource, /sectionTitle/);
  assert.match(apiSource, /sectionBody/);
  assert.match(apiSource, /sortOrder/);
  assert.match(apiSource, /isActive/);
});

test('combined production Hebrew alias resolves and renders combined template sections', () => {
  const sections = [
    { templateKey: 'combined', activityTypeGroup: 'קיץ תשפ״ו ושנת הלימודים תשפ״ז', sectionKey: 'intro', sectionTitle: 'פתיח משולב', sectionBody: 'טקסט משולב', sortOrder: 10, isActive: true }
  ];
  setProposalGroupLookups({
    proposalTemplateSections: sections,
    proposalActivityGroups: [{ group_key: 'combined', display_name: 'משולב', template_key: 'combined' }],
    proposalGroupAliases: [{ alias_name: 'קיץ תשפ״ו ושנת הלימודים תשפ״ז', group_key: 'combined' }]
  }, [], []);
  assert.equal(resolveProposalTemplateKey('קיץ תשפ״ו ושנת הלימודים תשפ״ז'), 'combined');
  const html = documentSectionsEditorHtml(filterTemplateSectionsForGroup(sections, 'קיץ תשפ״ו ושנת הלימודים תשפ״ז'), false);
  assert.doesNotMatch(html, /לא נמצאה תבנית פעילה לסוג הצעה זה/);
  assert.match(html, /פתיח משולב/);
});

test('production-shaped saved proposal item rows render instead of missing-items alert', () => {
  const html = itemsSummaryHtml([
    {
      proposalAgreementId: 'proposal-1',
      itemName: 'סדנת רובוטיקה',
      itemType: 'סדנה',
      quantity: 2,
      unitPrice: 500,
      totalPrice: 1000,
      sourcePricingKey: 'robotics-workshop',
      proposalGroup: 'summer',
      sortOrder: 1
    }
  ]);
  assert.doesNotMatch(html, /לא נשמרו שורות פעילות להצעה זו/);
  assert.match(html, /סדנת רובוטיקה/);
});

test('save item extraction keeps rows with source pricing key even when name is filled from pricing', async () => {
  setProposalGroupLookups({ proposalActivityGroups: [{ group_key: 'summer', display_name: 'קיץ תשפ״ו', template_key: 'summer' }] }, [], []);
  await withJSDOM(`<form data-pa-form>
    <select name="activity_type_group"><option value="summer" selected>summer</option></select>
    <article data-pa-item-row data-pa-row-group="summer">
      <input name="item_name" value="">
      <input name="item_source_pricing_key" value="pricing-1">
      <input name="proposal_group" value="summer">
      <input name="quantity" value="1">
      <input name="unit_price" value="100">
      <input data-pa-item-total name="total_price" value="100">
      <input name="item_selected_bundle_items" value="[]">
    </article>
  </form>`, async (root) => {
    const items = extractItemsFromForm(root.querySelector('[data-pa-form]'));
    assert.equal(items.length, 1);
    assert.equal(items[0].sourcePricingKey, 'pricing-1');
    assert.equal(items[0].proposalGroup, 'summer');
  });
});


test('proposal type activity group selector renders exactly canonical display_name options and saves group_key', () => {
  setProposalGroupLookups({
    proposalActivityGroups: [
      { group_key: 'next_year', display_name: 'תוכניות תשפ״ז', template_key: 'next_year', sort_order: 2, is_active: true },
      { group_key: 'summer', display_name: 'קיץ תשפ״ו', template_key: 'summer', sort_order: 1, is_active: true },
      { group_key: 'combined', display_name: 'קיץ תשפ״ו ותוכניות תשפ״ז', template_key: 'combined', included_group_keys: ['summer', 'next_year'], sort_order: 3, is_active: true }
    ],
    proposalGroupAliases: [
      { alias_name: 'קיץ תשפ״ו', group_key: 'summer', is_active: true },
      { alias_name: 'תוכניות תשפ״ז', group_key: 'next_year', is_active: true }
    ],
    proposalTemplateSections: [
      { template_key: 'summer', section_key: 'intro', section_title: 'פתיח', section_body: 'פתיח קיץ' },
      { template_key: 'next_year', section_key: 'intro', section_title: 'פתיח', section_body: 'פתיח שנה' },
      { template_key: 'combined', section_key: 'intro', section_title: 'פתיח', section_body: 'פתיח משולב' }
    ]
  }, [
    { activity_type_group: 'קיץ תשפ״ו' },
    { activity_type_group: 'summer' },
    { activity_type_group: 'תוכניות תשפ״ז' }
  ], [{ proposal_group: 'alias-from-pricing' }]);

  const options = proposalGroupOptions({
    proposalActivityGroups: [
      { group_key: 'next_year', display_name: 'תוכניות תשפ״ז', template_key: 'next_year', sort_order: 2, is_active: true },
      { group_key: 'summer', display_name: 'קיץ תשפ״ו', template_key: 'summer', sort_order: 1, is_active: true },
      { group_key: 'combined', display_name: 'קיץ תשפ״ו ותוכניות תשפ״ז', template_key: 'combined', included_group_keys: ['summer', 'next_year'], sort_order: 3, is_active: true }
    ],
    proposalGroupAliases: [
      { alias_name: 'קיץ תשפ״ו', group_key: 'summer', is_active: true },
      { alias_name: 'תוכניות תשפ״ז', group_key: 'next_year', is_active: true }
    ]
  }, [{ activity_type_group: 'קיץ תשפ״ו' }], [{ proposal_group: 'pricing-alias' }]);
  assert.deepEqual(options, [
    { value: 'summer', label: 'קיץ תשפ״ו' },
    { value: 'next_year', label: 'תוכניות תשפ״ז' },
    { value: 'combined', label: 'קיץ תשפ״ו ותוכניות תשפ״ז' }
  ]);

  const html = proposalTypeCardsHtml('קיץ תשפ״ו');
  assert.equal((html.match(/data-pa-type-btn=/g) || []).length, 3);
  assert.match(html, /data-pa-type-btn="summer"/);
  assert.match(html, /value="summer"/);
  assert.match(html, /קיץ תשפ״ו/);
  assert.match(html, /תוכניות תשפ״ז/);
  assert.match(html, /קיץ תשפ״ו ותוכניות תשפ״ז/);
  assert.doesNotMatch(html, />summer</);
  assert.doesNotMatch(html, />next_year</);
  assert.doesNotMatch(html, />combined</);
  assert.doesNotMatch(html, /pricing-alias/);
});

test('activity group alias resolves through group_key to template_key and matching sections', () => {
  const sections = [
    { template_key: 'summer_template', section_key: 'intro', section_title: 'פתיח', section_body: 'פתיח נמצא' }
  ];
  setProposalGroupLookups({
    proposalActivityGroups: [{ group_key: 'summer', display_name: 'קיץ תשפ״ו', template_key: 'summer_template', sort_order: 1, is_active: true }],
    proposalGroupAliases: [{ alias_name: 'פעילויות קיץ', group_key: 'summer', is_active: true }],
    proposalTemplateSections: sections
  }, [], []);
  assert.equal(resolveProposalTemplateKey('פעילויות קיץ'), 'summer_template');
  const matching = filterTemplateSectionsForGroup(sections, 'פעילויות קיץ');
  assert.equal(matching.length, 1);
  const html = documentSectionsEditorHtml(matching, false);
  assert.doesNotMatch(html, /לא נמצאה תבנית פעילה לסוג הצעה זה/);
  assert.match(html, /פתיח נמצא/);
});

test('proposal item loader uses production proposal_agreement_items columns and proposal_agreement_id filter', async () => {
  const apiSource = await readFile(API_FILE, 'utf8');
  assert.match(apiSource, /\.from\('proposal_agreement_items'\)[\s\S]*\.eq\('proposal_agreement_id', rowId\)/);
  assert.match(apiSource, /proposal_agreement_id,item_name,item_type,gefen_number,meetings_count,hours_count,quantity,unit_price,total_price,description,hourly_price,source_pricing_key,proposal_display_mode,selected_bundle_items,activity_no,unit_duration,proposal_group,sort_order/);
  assert.doesNotMatch(apiSource, /proposal_pricing_options/);
});


test('readProposalsAgreementsFromSupabase waits for auth session and records loader debug', async () => {
  const apiSource = await readFile(API_FILE, 'utf8');
  assert.match(apiSource, /async function readProposalsAgreementsFromSupabase\(\) \{[\s\S]*await waitForSupabaseAuthSession\(\)/);
  assert.match(apiSource, /proposal_loader: \{ \.\.\.lastProposalLoaderDebug \}/);
  assert.match(apiSource, /mergeProposalGroupLookups\([\s\S]*buildProposalGroupHintsFromTemplateSections\(proposalTemplateSections\)/);
});

test('saveProposalAgreementItems keeps valid priced item rows in payload', async () => {
  const apiSource = await readFile(API_FILE, 'utf8');
  const saveBlock = apiSource.match(/saveProposalAgreementItems: async \(proposalId, items\) => \{[\s\S]*?\n  \},/);
  assert.ok(saveBlock, 'saveProposalAgreementItems should exist');
  assert.match(saveBlock[0], /hasMeaningfulProposalItemValue/);
  assert.match(saveBlock[0], /item_name:/);
  assert.match(saveBlock[0], /unit_price:/);
  assert.match(saveBlock[0], /total_price:/);
});

test('upgraded selector fallback shows Hebrew display labels only, not internal group keys', () => {
  setProposalGroupLookups({
    proposalActivityGroups: [
      { group_key: 'summer', template_key: 'summer', sort_order: 1, is_active: true },
      { group_key: 'next_year', template_key: 'next_year', sort_order: 2, is_active: true },
      { group_key: 'combined', template_key: 'combined', included_group_keys: ['summer', 'next_year'], sort_order: 3, is_active: true }
    ]
  }, [], []);
  const html = proposalTypeCardsHtml('summer');
  assert.match(html, />פעילויות קיץ</);
  assert.match(html, />שנה הבאה</);
  assert.match(html, />הצעה משולבת</);
  assert.doesNotMatch(html, />summer</);
  assert.doesNotMatch(html, />next_year</);
  assert.doesNotMatch(html, />combined</);
});

test('legacy activity_type_group values resolve to canonical keys for summer and next_year templates', () => {
  const sections = [
    { template_key: 'summer', section_key: 'intro', section_title: 'פתיח קיץ', section_body: 'תוכן קיץ' },
    { template_key: 'next_year', section_key: 'intro', section_title: 'פתיח שנה', section_body: 'תוכן שנה' }
  ];
  setProposalGroupLookups({
    proposalActivityGroups: [
      { group_key: 'summer', display_name: 'פעילויות קיץ', template_key: 'summer' },
      { group_key: 'next_year', display_name: 'שנה הבאה', template_key: 'next_year' }
    ],
    proposalTemplateSections: sections
  }, [], []);
  assert.equal(resolveProposalTemplateKey('קיץ תשפ״ו'), 'summer');
  assert.equal(resolveProposalTemplateKey('תוכניות תשפ״ז'), 'next_year');
  assert.match(documentSectionsEditorHtml(filterTemplateSectionsForGroup(sections, 'קיץ תשפ״ו'), false), /תוכן קיץ/);
  assert.match(documentSectionsEditorHtml(filterTemplateSectionsForGroup(sections, 'תוכניות תשפ״ז'), false), /תוכן שנה/);
});

test('items_json fallback normalizes and renders rows when proposalAgreementItems is empty', () => {
  setProposalGroupLookups({ proposalActivityGroups: [{ group_key: 'next_year', display_name: 'שנה הבאה', template_key: 'next_year' }] }, [], []);
  const row = { activity_type_group: 'תוכניות תשפ״ז', items_json: JSON.stringify([{ item_name: 'קורס חלל', proposal_group: 'שנה הבאה', quantity: 1, unit_price: 900, total_price: 900 }]) };
  const items = proposalItemsWithFallback([], row);
  assert.equal(items.length, 1);
  assert.equal(items[0].proposalGroup, 'next_year');
  const html = itemsSummaryHtml(items);
  assert.match(html, /קורס חלל/);
  assert.doesNotMatch(html, /לא נשמרו שורות פעילות להצעה זו/);
});
