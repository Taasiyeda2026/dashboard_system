import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const bootstrapDom = new JSDOM('', { url: 'http://localhost/' });
globalThis.localStorage = bootstrapDom.window.localStorage;
globalThis.sessionStorage = bootstrapDom.window.sessionStorage;

const {
  buildClientFiles,
  clientSearchResultsHtml
} = await import('../frontend/src/screens/proposals-agreements.js');

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
