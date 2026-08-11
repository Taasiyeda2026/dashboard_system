import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

if (!globalThis.sessionStorage) {
  const store = new Map();
  globalThis.sessionStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: (key) => store.delete(key), clear: () => store.clear() };
}
if (!globalThis.localStorage) globalThis.localStorage = globalThis.sessionStorage;

const { proposalPreviewBodyHtml } = await import('../frontend/src/screens/proposals-agreements.js');

const source = fs.readFileSync(new URL('../frontend/src/screens/proposals-agreements.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../frontend/src/styles/main.css', import.meta.url), 'utf8');
const templateSections = [
  { template_key: 'next_year', activity_type_group: 'next_year', section_key: 'payment_terms', section_title: 'מחירים', section_body: 'תנאי תשלום', sort_order: 1 },
  { template_key: 'next_year', activity_type_group: 'next_year', section_key: 'cancellation_terms', section_title: 'שינויים, ביטולים והתאמות', section_body: 'ניתן לבצע שינויים.', sort_order: 2 }
];
const items = [{ item_name: 'תוכנית', proposal_group: 'next_year_courses', quantity: 1, unit_price: 100, total_price: 100 }];

function row(group, note = '') {
  return {
    activity_type_group: group,
    proposal_date: '2026-08-11',
    custom_document_sections: note ? [{ section_key: 'table_note', section_body: note }] : []
  };
}

test('next_year table note renders once immediately after the activities table block', () => {
  const html = proposalPreviewBodyHtml(row('next_year', '** המחיר מתייחס ל-12 מפגשים.'), items, templateSections);
  assert.match(html, /id="d-activities-table"[\s\S]*?<\/div><p class="pa-table-note" data-pa-table-note>\* המחיר מתייחס ל-12 מפגשים\.<\/p>[\s\S]*שינויים, ביטולים והתאמות/);
  assert.doesNotMatch(html, /\* \*/);
});

test('empty and non-next_year proposals do not render a table note', () => {
  assert.doesNotMatch(proposalPreviewBodyHtml(row('next_year'), items, templateSections), /data-pa-table-note/);
  assert.doesNotMatch(proposalPreviewBodyHtml(row('summer', 'אסור להציג'), items, templateSections), /data-pa-table-note/);
});

test('editor, persistence, live preview, print styling, and clone keep the scoped table_note contract', () => {
  assert.match(source, /data-pa-table-note-field\$\{isNextYearProposalGroup\(normalizedActivityGroup\) \? '' : ' hidden'\}/);
  assert.match(source, /name="table_note"/);
  assert.match(source, /proposalTableNoteSection\(formData\.get\('table_note'\)\)/);
  assert.match(source, /payload\.custom_document_sections = \[\.\.\.retainedSections, \.\.\.\(payload\.custom_document_sections \|\| \[\]\)\]/);
  assert.match(source, /custom_document_sections: Array\.isArray\(sourceRow\.custom_document_sections\) \? sourceRow\.custom_document_sections : \[\]/);
  assert.match(source, /form\.addEventListener\('input',[\s\S]*calcGrandTotal\(form\)/);
  assert.match(css, /\.proposal-document \.pa-table-note[\s\S]*page-break-before: avoid/);
});
