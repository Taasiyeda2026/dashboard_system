import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

if (!globalThis.sessionStorage) {
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear()
  };
}
if (!globalThis.localStorage) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear()
  };
}

const SCREEN_FILE = new URL('../frontend/src/screens/proposals-agreements.js', import.meta.url);
const MAIN_CSS_FILE = new URL('../frontend/src/styles/main.css', import.meta.url);
const EDITOR_CSS_FILE = new URL('../frontend/src/styles/proposal-editor-compact-fixes.css', import.meta.url);
const API_FILE = new URL('../frontend/src/api.js', import.meta.url);

const {
  proposalsAgreementsTableRowsHtml,
  nextYearInternalSectionTitle,
  gefenEligibleItems,
  drawerHtml,
  proposalCompactCardHtml,
  gefenApprovalDocumentHtml
} = await import('../frontend/src/screens/proposals-agreements.js');
const { normalizeNextYearWorkshopHtml } = await import('../frontend/src/proposal-next-year-workshops.js');

const FORBIDDEN_LIST_LABELS = ['תשפ״ז (קורסים)', 'תשפ״ז (סדנאות)', 'תשפ״ז (קורסים וסדנאות)'];

test('תשפ״ז GEFEN eligibility includes numbered courses and always excludes workshops', async () => {
  const course = { proposal_group: 'next_year_courses', item_type: 'קורס', gefen_number: '6089' };
  const workshop = { proposal_group: 'next_year_workshops', item_type: 'סדנה', gefen_number: '9999' };
  assert.deepEqual(gefenEligibleItems([workshop]), []);
  assert.deepEqual(gefenEligibleItems([course, workshop]).map((item) => item.gefen_number), ['6089']);

  const apiSource = await readFile(API_FILE, 'utf8');
  assert.match(apiSource, /\.select\('proposal_agreement_id,proposal_group,item_type,gefen_number,proposal_display_mode'\)/);
  assert.match(apiSource, /\.in\('proposal_agreement_id', pageIds\)/);
  assert.match(apiSource, /gefen_approval_applicable: gefenEligibilityByProposalId\.get\(row\.id\) === true/);
});

test('GEFEN approval action is available for every next-year and GEFEN proposal', () => {
  const base = { id: 'proposal-1', quote_number: '20001', activity_type_group: 'next_year', school_framework: 'בית ספר', status: 'approved' };
  const eligible = { ...base, gefen_approval_applicable: true };
  const workshopOnly = { ...base, id: 'proposal-2', gefen_approval_applicable: false };
  const action = /data-pa-generate-gefen-approval/;

  assert.match(proposalsAgreementsTableRowsHtml([eligible], adminState()), action);
  assert.match(proposalsAgreementsTableRowsHtml([workshopOnly], adminState()), action);
  assert.match(proposalCompactCardHtml(eligible, { canManage: true }), action);
  assert.match(proposalCompactCardHtml(workshopOnly, { canManage: true }), action);
  assert.match(drawerHtml(eligible, [], adminState()), action);
  assert.match(drawerHtml(workshopOnly, [], adminState()), action);

  const gefen = { ...base, id: 'proposal-3', activity_type_group: 'gefen' };
  assert.match(proposalsAgreementsTableRowsHtml([gefen], adminState()), action);
  assert.match(proposalCompactCardHtml(gefen, { canManage: true }), action);
  assert.match(drawerHtml(gefen, [], adminState()), action);

  const course = { item_name: 'קורס גפן', proposal_group: 'next_year_courses', gefen_number: '6089', quantity: 1, unit_price: 8000, total_price: 8000 };
  const workshop = { item_name: 'סדנת חלל', proposal_group: 'next_year_workshops', gefen_number: '9999', quantity: 1, unit_price: 650, total_price: 650 };
  const approval = gefenApprovalDocumentHtml({ ...eligible, semel_mosad: '123456', proposal_date: '2026-08-02' }, [course, workshop]);
  assert.match(approval, />6089</);
  assert.doesNotMatch(approval, /סדנת חלל/);
});

function adminState() {
  return {
    user: {
      user_id: 8000,
      username: 'idann',
      role: 'admin',
      display_role: 'מנהל מערכת',
      can_edit_direct: true,
      can_review_requests: true,
      manage_proposals_agreements: true
    },
    clientSettings: { dropdown_options: {} },
    screenDataCache: {}
  };
}

function typeCellsFrom(html) {
  const dom = new JSDOM(`<table><tbody>${html}</tbody></table>`);
  return [...dom.window.document.querySelectorAll('tr[data-pa-row-id]')].map((row) => ({
    id: row.getAttribute('data-pa-row-id'),
    school: row.cells[3],
    type: row.cells[4]?.textContent.trim()
  }));
}

function moneyValues(text) {
  return [...String(text).matchAll(/₪\s*([\d,]+)/g)].map((match) => Number(match[1].replace(/,/g, '')));
}

test('a תשפ״ז proposal with courses only is listed as תשפ״ז', () => {
  const html = proposalsAgreementsTableRowsHtml([{
    id: 'ny-courses',
    quote_number: '20001',
    activity_type_group: 'next_year_courses',
    school_framework: 'בית ספר אלון',
    status: 'draft'
  }], adminState());

  assert.equal(typeCellsFrom(html)[0].type, 'תשפ״ז');
});

test('a תשפ״ז proposal with workshops only is listed as תשפ״ז', () => {
  const html = proposalsAgreementsTableRowsHtml([{
    id: 'ny-workshops',
    quote_number: '20002',
    activity_type_group: 'next_year_workshops',
    school_framework: 'בית ספר אלון',
    status: 'draft'
  }], adminState());

  assert.equal(typeCellsFrom(html)[0].type, 'תשפ״ז');
});

test('a תשפ״ז proposal with both areas is listed as תשפ״ז and gefen stays גפן', () => {
  const html = proposalsAgreementsTableRowsHtml([
    { id: 'ny-both', quote_number: '20003', activity_type_group: 'next_year', school_framework: 'בית ספר אלון', status: 'draft' },
    { id: 'ny-legacy-label', quote_number: '20004', activity_type_group: 'תשפ״ז (קורסים וסדנאות)', school_framework: 'בית ספר אלון', status: 'draft' },
    { id: 'gefen-row', quote_number: '20005', activity_type_group: 'gefen', school_framework: 'בית ספר אלון', status: 'draft' },
    { id: 'summer-row', quote_number: '20006', activity_type_group: 'summer', school_framework: 'בית ספר אלון', status: 'draft' },
    { id: 'tour-row', quote_number: '20007', activity_type_group: 'tour', school_framework: 'בית ספר אלון', status: 'draft' }
  ], adminState());

  const byId = new Map(typeCellsFrom(html).map((row) => [row.id, row.type]));
  assert.equal(byId.get('ny-both'), 'תשפ״ז');
  assert.equal(byId.get('ny-legacy-label'), 'תשפ״ז');
  assert.equal(byId.get('gefen-row'), 'גפן');
  assert.equal(byId.get('summer-row'), 'קיץ');
  assert.equal(byId.get('tour-row'), 'סיור');
});

test('the internal subgroup labels never reach the proposals list', () => {
  const html = proposalsAgreementsTableRowsHtml([
    { id: 'ny-courses', quote_number: '20001', activity_type_group: 'next_year_courses', school_framework: 'בית ספר אלון', status: 'draft' },
    { id: 'ny-workshops', quote_number: '20002', activity_type_group: 'next_year_workshops', school_framework: 'בית ספר אלון', status: 'draft' }
  ], adminState());

  FORBIDDEN_LIST_LABELS.forEach((label) => {
    assert.ok(!html.includes(label), `${label} must not appear in the proposals list`);
  });
});

test('the internal keys map to the unified activities title inside the proposal', () => {
  assert.equal(nextYearInternalSectionTitle('next_year_courses'), 'פעילויות ומחירים');
  assert.equal(nextYearInternalSectionTitle('next_year_workshops'), 'פעילויות ומחירים');
  assert.equal(nextYearInternalSectionTitle('next_year'), '');
  assert.equal(nextYearInternalSectionTitle('gefen'), '');
});

test('the school column header and values are right aligned', async () => {
  const [screenSource, css] = await Promise.all([
    readFile(SCREEN_FILE, 'utf8'),
    readFile(MAIN_CSS_FILE, 'utf8')
  ]);

  assert.match(screenSource, /<th class="ds-pa-school-col">בית הספר<\/th>/);
  assert.match(
    css,
    /\.ds-pa-table th\.ds-pa-school-col,\s*\n\.ds-pa-table td\.ds-pa-school-col \{\s*\n\s*text-align: right;/,
    'the school column must be right aligned for header and values'
  );
  assert.doesNotMatch(
    css,
    /\.ds-pa-table td:nth-child\(4\),/,
    'the school column must no longer be centered by column position'
  );

  const html = proposalsAgreementsTableRowsHtml([{
    id: 'school-align',
    quote_number: '20008',
    activity_type_group: 'next_year',
    client_type: 'school',
    school_framework: 'בית ספר אלון',
    status: 'draft'
  }], adminState());
  const [row] = typeCellsFrom(html);
  assert.ok(row.school.classList.contains('ds-pa-school-col'));
  assert.equal(row.school.textContent.trim(), 'בית ספר אלון');
});

test('mixed תשפ״ז rows stay in one activities table with one payable total', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const html = `<section class="proposal-document"><table class="pa-next-year-course-table">
    <tbody>
      <tr><td>ביומימיקרי</td><td>6089</td><td>10</td><td>1</td><td>20</td><td>₪ 200</td><td>₪ 4,000</td></tr>
      <tr><td>סדנאות STEM</td><td></td><td></td><td>2</td><td></td><td>₪ 1,500</td><td>₪ 3,000</td></tr>
    </tbody>
    <tfoot><tr><td colspan="6">סה״כ לתשלום</td><td>₪ 7,000</td></tr></tfoot>
  </table></section>`;

  const normalized = normalizeNextYearWorkshopHtml(html, dom.window.document);
  const parsed = new JSDOM(normalized).window.document;

  const table = parsed.querySelector('.pa-next-year-activities-table, .pa-next-year-course-table');
  assert.ok(table, 'one activities table must be present');
  assert.equal(parsed.querySelectorAll('.pa-next-year-workshop-table').length, 0);
  assert.equal(table.querySelectorAll('tbody > tr').length, 2);
  assert.match(parsed.body.textContent, /פעילויות ומחירים|סה״כ לתשלום/);
  assert.doesNotMatch(parsed.body.textContent, /סה״כ קורסים|סה״כ סדנאות/);
  assert.equal(moneyValues(table.querySelector('tfoot').textContent).pop(), 7000);
});

test('a single-area תשפ״ז document shows one unified activities table', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const html = `<section class="proposal-document"><table class="pa-next-year-course-table">
    <tbody><tr><td>סדנאות STEM</td><td></td><td></td><td>2</td><td></td><td>₪ 1,500</td><td>₪ 3,000</td></tr></tbody>
    <tfoot><tr><td colspan="6">סה״כ לתשלום</td><td>₪ 3,000</td></tr></tfoot>
  </table></section>`;

  const parsed = new JSDOM(normalizeNextYearWorkshopHtml(html, dom.window.document)).window.document;
  const table = parsed.querySelector('.pa-next-year-activities-table, .pa-next-year-course-table');
  assert.ok(table);
  assert.equal(parsed.querySelectorAll('.pa-next-year-workshop-table').length, 0);
  assert.equal(table.querySelectorAll('tbody > tr').length, 1);
  assert.match(table.querySelector('tfoot').textContent, /סה״כ לתשלום/);
  assert.equal(moneyValues(table.querySelector('tfoot').textContent).pop(), 3000);
  assert.equal(parsed.querySelectorAll('.pa-next-year-combined-total').length, 0);
});

test('תשפ״ז uses one activities list and a shared grand-total calculation', async () => {
  const screenSource = await readFile(SCREEN_FILE, 'utf8');

  assert.match(screenSource, /data-pa-next-year-unified="yes"/, 'תשפ״ז editor must render a unified activities host');
  assert.match(screenSource, /\+ הוסף פעילות/, 'תשפ״ז must expose a single add-activity action');

  const grandTotal = screenSource.match(/const calcGrandTotal = \(container\) => \{[\s\S]*?\n    \};/)?.[0] || '';
  assert.ok(grandTotal, 'calcGrandTotal must be present');
  assert.match(grandTotal, /\[data-pa-grand-total\]/);
  assert.match(grandTotal, /updateLivePreview\(form\);/, 'the preview must refresh with the totals');

  ['addItemBtn', 'removeItemBtn'].forEach((handler) => {
    assert.ok(screenSource.includes(handler), `${handler} must exist`);
  });
  assert.match(screenSource, /form\.addEventListener\('input', \(\) => \{[\s\S]*?calcGrandTotal\(form\);/);
  assert.match(screenSource, /form\.addEventListener\('change', \(\) => setTimeout\(\(\) => \{[\s\S]*?calcGrandTotal\(form\);/);
});

test('contact mobile and email fields use container-responsive tracks without overflow', async () => {
  const [editorCss, mainCss] = await Promise.all([
    readFile(EDITOR_CSS_FILE, 'utf8'),
    readFile(MAIN_CSS_FILE, 'utf8')
  ]);

  assert.match(editorCss, /\.ds-pa-contact-channels-fields \{ display: grid; grid-template-columns: repeat\(auto-fit, minmax\(140px, 1fr\)\)/);
  assert.match(editorCss, /\.ds-pa-contact-channels-fields input \{ min-inline-size: 0; inline-size: 100%; \}/);

  const phoneWrapper = Number(mainCss.match(/:has\(\[name="phone"\]\) \{\s*\n\s*width: min\(100%, (\d+)px\);/)?.[1] || 0);
  const emailWrapper = Number(mainCss.match(/:has\(\[name="email"\]\) \{\s*\n\s*width: min\(100%, (\d+)px\);/)?.[1] || 0);
  assert.ok(phoneWrapper >= 220, `phone wrapper must not clip the value, got ${phoneWrapper}px`);
  assert.ok(emailWrapper >= 360, `email wrapper must not clip the value, got ${emailWrapper}px`);

  assert.match(editorCss, /\.ds-pa-contact-channels-status \{[^}]*grid-column: 2;[^}]*flex-wrap: wrap;/);
  assert.match(editorCss, /@container pa-editor \(max-width: 760px\)[\s\S]*?\[data-pa-contact-channels-status\] \{ grid-column: 1 \/ -1; \}/);
});

test('saved proposal rows keep their stored price and hydrate totals once', async () => {
  const screenSource = await readFile(SCREEN_FILE, 'utf8');
  assert.match(screenSource, /savedPrice = numberValue\(savedItem\.unit_price\)/);
  assert.match(screenSource, /data-pa-saved-item="true"/);
  assert.match(screenSource, /formHost\.querySelectorAll\('\[data-pa-item-row\]'\)\.forEach\(\(itemRow\) => calcItemRow\(itemRow\)\);\s*\n\s*calcGrandTotal\(formHost\);/);
});
