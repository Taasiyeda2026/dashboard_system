import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const bootstrapDom = new JSDOM('', { url: 'http://localhost/' });
globalThis.localStorage = bootstrapDom.window.localStorage;
globalThis.sessionStorage = bootstrapDom.window.sessionStorage;

const {
  buildClientFiles,
  clientSearchResultsHtml,
  proposalsAgreementsScreen
} = await import('../frontend/src/screens/proposals-agreements.js');

async function withJSDOM(html, fn) {
  const dom = new JSDOM(`<main id="root">${html}</main>`, { url: 'http://localhost/' });
  const saved = { document: globalThis.document, window: globalThis.window, AbortController: globalThis.AbortController };
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.AbortController = dom.window.AbortController;
  try {
    await fn(dom.window.document.getElementById('root'), dom);
  } finally {
    globalThis.document = saved.document;
    globalThis.window = saved.window;
    globalThis.AbortController = saved.AbortController;
  }
}

const state = {
  user: { role: 'admin', display_role: 'admin', view_proposals_agreements: true, manage_proposals_agreements: true },
  effectiveRoutes: ['proposals-agreements']
};

const contactOptions = [
  {
    client_type: 'authority',
    authority_id: '10',
    authority: 'עיריית נהרייה',
    authority_name: 'עיריית נהרייה'
  },
  {
    client_type: 'school',
    authority_id: '20',
    school_id: '30',
    authority: 'קריית ביאליק',
    school: 'בית–ספר גבעות',
    semel_mosad: 123456,
    contact_name: 'דנה לוי',
    contact_role: 'מנהלת',
    phone: '04-1111111',
    mobile: '050-2222222',
    email: 'dana@example.org'
  }
];

const files = buildClientFiles({ rows: [], contactOptions });

const cases = [
  ['חיפוש רשות ללא הצעת מחיר', 'עיריית נהריה', 'עיריית נהרייה'],
  ['חיפוש בית ספר', 'בית-ספר גבעות', 'בית–ספר גבעות'],
  ['חיפוש סמל מוסד מספרי', '123456', 'בית–ספר גבעות'],
  ['חיפוש איש קשר', 'דנה לוי', 'בית–ספר גבעות'],
  ['חיפוש טלפון ונייד', ['04-1111111', '050-2222222'], 'בית–ספר גבעות'],
  ['חיפוש דוא״ל', 'dana@example.org', 'בית–ספר גבעות'],
  ['נרמול נהריה ונהרייה', 'נהריה', 'עיריית נהרייה'],
  ['נרמול קרית וקריית', 'קרית ביאליק', 'בית–ספר גבעות']
];

for (const [name, query, expected] of cases) {
  test(name, () => {
    for (const term of Array.isArray(query) ? query : [query]) {
      assert.match(clientSearchResultsHtml(files, term), new RegExp(expected));
    }
  });
}

test('חיפוש תיק לקוח טוען את קטלוג אנשי הקשר ומשלב אותו עם חיפוש שרת', async () => {
  const source = await readFile(new URL('../frontend/src/screens/proposals-agreements.js', import.meta.url), 'utf8');
  const handlerStart = source.indexOf("const input = event.target.closest?.('[data-pa-client-search]')");
  const handlerEnd = source.indexOf("root.addEventListener('click'", handlerStart);
  const handler = source.slice(handlerStart, handlerEnd);

  assert.match(handler, /await ensureContacts\('client-file-search'\)/);
  assert.match(handler, /reloadProposalList\(\{ search: query \}/);
  assert.match(handler, /buildClientFiles\(\{ \.\.\.data, contactOptions \}\)/);
  assert.doesNotMatch(handler, /contactOptions:\s*\[\]/);
});

const openCases = [
  ['בית ספר שנמצא לפי סמל מוסד', '123456', 'schoolId', '30'],
  ['בית ספר שנמצא לפי איש קשר', 'דנה לוי', 'schoolId', '30'],
  ['רשות שנמצאה לפי וריאציית כתיב', 'נהריה', 'authorityId', '10']
];

for (const [name, query, expectedFilter, expectedId] of openCases) {
  test(`${name} טוען ומציג את כל הצעות הלקוח`, async () => {
    const data = { rows: [], contactOptions: structuredClone(contactOptions), _contactsLoaded: true };
    const calls = [];
    const proposal = expectedFilter === 'schoolId'
      ? { id: 'school-proposal', authority_id: '20', school_id: '30', client_authority: 'קריית ביאליק', school_framework: 'בית–ספר גבעות', activity_type_group: 'summer', status: 'draft' }
      : { id: 'authority-proposal', authority_id: '10', client_type: 'authority', client_authority: 'עיריית נהרייה', activity_type_group: 'summer', status: 'draft' };
    await withJSDOM(proposalsAgreementsScreen.render(data, { state }), async (root, dom) => {
      proposalsAgreementsScreen.bind({
        root,
        data,
        state,
        api: { proposalsAgreements: async (params) => { calls.push(params); return { rows: [proposal] }; } }
      });
      const search = root.querySelector('[data-pa-client-search]');
      search.value = query;
      search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 320));
      root.querySelector('[data-pa-open-client]')?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 30));
      const clientLoad = calls.at(-1);
      assert.equal(clientLoad?.[expectedFilter], expectedId);
      assert.equal(clientLoad?.paginate, false);
      assert.match(root.querySelector('[data-pa-client-file]')?.textContent || '', /הצעות עדכניות/);
      assert.ok(root.querySelector(`[data-pa-open-proposal-id="${proposal.id}"]`));
    });
  });
}

test('לקוח ללא הצעות נפתח כתיק ריק', async () => {
  const data = { rows: [], contactOptions: structuredClone(contactOptions), _contactsLoaded: true };
  await withJSDOM(proposalsAgreementsScreen.render(data, { state }), async (root, dom) => {
    proposalsAgreementsScreen.bind({ root, data, state, api: { proposalsAgreements: async () => ({ rows: [] }) } });
    const search = root.querySelector('[data-pa-client-search]');
    search.value = '123456';
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 320));
    root.querySelector('[data-pa-open-client]')?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.ok(root.querySelector('[data-pa-client-file]'));
    assert.match(root.querySelector('[data-pa-client-file]')?.textContent || '', /אין הצעות עדכניות/);
  });
});

test('מסנן סטטוס קודם אינו מסנן את הצעות תיק הלקוח', async () => {
  const data = {
    rows: [],
    contactOptions: structuredClone(contactOptions),
    _contactsLoaded: true,
    _query: { status: 'approved', clientType: 'authority' }
  };
  const calls = [];
  await withJSDOM(proposalsAgreementsScreen.render(data, { state }), async (root, dom) => {
    proposalsAgreementsScreen.bind({
      root,
      data,
      state,
      api: {
        proposalsAgreements: async (params) => {
          calls.push(params);
          return { rows: params.schoolId ? [{ id: 'draft-school-proposal', authority_id: '20', school_id: '30', client_authority: 'קריית ביאליק', school_framework: 'בית–ספר גבעות', activity_type_group: 'summer', status: 'draft' }] : [] };
        }
      }
    });
    const search = root.querySelector('[data-pa-client-search]');
    search.value = '123456';
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 320));
    root.querySelector('[data-pa-open-client]')?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(calls.at(-1)?.status, '');
    assert.equal(calls.at(-1)?.clientType, '');
    assert.ok(root.querySelector('[data-pa-open-proposal-id="draft-school-proposal"]'));
  });
});

test('סגירת תיק שנפתח מחיפוש משחזרת את נתוני מסך הבית', async () => {
  const homeProposal = { id: 'home-proposal', authority_id: '90', client_type: 'authority', client_authority: 'לקוח הבית', activity_type_group: 'summer', status: 'draft' };
  const selectedProposal = { id: 'selected-proposal', authority_id: '20', school_id: '30', client_authority: 'קריית ביאליק', school_framework: 'בית–ספר גבעות', activity_type_group: 'summer', status: 'draft' };
  const data = { rows: [homeProposal], contactOptions: structuredClone(contactOptions), _contactsLoaded: true };
  await withJSDOM(proposalsAgreementsScreen.render(data, { state }), async (root, dom) => {
    proposalsAgreementsScreen.bind({
      root,
      data,
      state,
      api: { proposalsAgreements: async (params) => ({ rows: params.schoolId ? [selectedProposal] : [] }) }
    });
    const search = root.querySelector('[data-pa-client-search]');
    search.value = '123456';
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 320));
    root.querySelector('[data-pa-open-client]')?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(data.rows[0]?.id, 'selected-proposal');
    root.querySelector('[data-pa-client-close]')?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.equal(data.rows[0]?.id, 'home-proposal');
    assert.match(root.querySelector('[data-pa-client-home]')?.textContent || '', /לקוח הבית/);
  });
});
