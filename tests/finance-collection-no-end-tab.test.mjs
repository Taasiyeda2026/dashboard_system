import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  FINANCE_COLLECTION_TAB_NO_END_DATE,
  FINANCE_NO_END_DATE_MONTH_KEY,
  filterFinanceCollectionActivities,
  financeActivityEndMonthKey,
  normalizeFinanceCollectionTab
} from '../frontend/src/screens/finance-collection.js';
import {
  ensureNoEndDateTab,
  financeCollectionMonthSortKey,
  polishFinanceCollection
} from '../frontend/src/finance-collection-no-end-tab-runtime.js';

function monthSection(label) {
  return `<section class="ds-fin-collect-month"><h3 class="ds-fin-collect-month__title">${label}</h3></section>`;
}

function shellHtml({ active = 'open', sections = [] } = {}) {
  return `<div class="ds-fin-collect-shell">
    <div class="ds-fin-tabs" role="tablist">
      <button class="ds-fin-tab${active === 'open' ? ' is-active' : ''}" data-finance-collection-tab="open">פתוח</button>
      <button class="ds-fin-tab${active === 'closed' ? ' is-active' : ''}" data-finance-collection-tab="closed">סגור</button>
      <button class="ds-fin-tab${active === 'all' ? ' is-active' : ''}" data-finance-collection-tab="all">הכול</button>
      ${active === 'no_end_date' ? '<button class="ds-fin-tab is-active" data-finance-collection-tab="no_end_date">ללא</button>' : ''}
    </div>
    <div data-finance-collection-body>${sections.join('')}</div>
  </div>`;
}

test('finance UI orders month sections nearest-to-farthest and removes no-end-date from open', () => {
  const dom = new JSDOM(shellHtml({
    active: 'open',
    sections: [
      monthSection('דצמבר 2026'),
      monthSection('ללא תאריך סיום'),
      monthSection('אוקטובר 2026'),
      monthSection('ינואר 2027'),
      monthSection('נובמבר 2026')
    ]
  }));

  polishFinanceCollection(dom.window.document);
  const titles = [...dom.window.document.querySelectorAll('.ds-fin-collect-month__title')].map((node) => node.textContent.trim());
  assert.deepEqual(titles, ['אוקטובר 2026', 'נובמבר 2026', 'דצמבר 2026', 'ינואר 2027']);
});

test('all tab keeps no-end-date last while dated months stay nearest-to-farthest', () => {
  const dom = new JSDOM(shellHtml({
    active: 'all',
    sections: [
      monthSection('ינואר 2027'),
      monthSection('ללא תאריך סיום'),
      monthSection('נובמבר 2026'),
      monthSection('אוקטובר 2026')
    ]
  }));

  polishFinanceCollection(dom.window.document);
  const titles = [...dom.window.document.querySelectorAll('.ds-fin-collect-month__title')].map((node) => node.textContent.trim());
  assert.deepEqual(titles, ['אוקטובר 2026', 'נובמבר 2026', 'ינואר 2027', 'ללא תאריך סיום']);
});

test('no-end-date tab keeps only the no-end-date section', () => {
  const dom = new JSDOM(shellHtml({
    active: 'no_end_date',
    sections: [monthSection('אוקטובר 2026'), monthSection('ללא תאריך סיום')]
  }));

  polishFinanceCollection(dom.window.document);
  const titles = [...dom.window.document.querySelectorAll('.ds-fin-collect-month__title')].map((node) => node.textContent.trim());
  assert.deepEqual(titles, ['ללא תאריך סיום']);
});

test('finance collection toolbar gets a fourth tab labeled ללא', () => {
  const dom = new JSDOM(shellHtml({ active: 'open' }));
  ensureNoEndDateTab(dom.window.document);
  const button = dom.window.document.querySelector('[data-finance-collection-tab="no_end_date"]');
  assert.ok(button);
  assert.equal(button.textContent.trim(), 'ללא');
});

test('no-end-date tab filters every activity without an end date regardless of collection status', () => {
  const rows = [
    { row_id: 'OPEN-NO-DATE', collection_status: 'open' },
    { row_id: 'CLOSED-NO-DATE', collection_status: 'closed' },
    { row_id: 'DATED', end_date: '2026-10-10', collection_status: 'open' }
  ];
  const filtered = filterFinanceCollectionActivities(rows, { tab: FINANCE_COLLECTION_TAB_NO_END_DATE });
  assert.deepEqual(filtered.map((row) => row.row_id), ['OPEN-NO-DATE', 'CLOSED-NO-DATE']);
  assert.ok(filtered.every((row) => financeActivityEndMonthKey(row) === FINANCE_NO_END_DATE_MONTH_KEY));
});

test('no-end-date tab value normalizes explicitly instead of falling back to open', () => {
  assert.equal(normalizeFinanceCollectionTab('no_end_date'), FINANCE_COLLECTION_TAB_NO_END_DATE);
});

test('month sort key treats ללא תאריך סיום as the farthest group', () => {
  const dom = new JSDOM(`${monthSection('אוקטובר 2026')}${monthSection('ללא תאריך סיום')}`);
  const [october, noEnd] = dom.window.document.querySelectorAll('.ds-fin-collect-month');
  assert.equal(financeCollectionMonthSortKey(october), '2026-10');
  assert.equal(financeCollectionMonthSortKey(noEnd), '9999-99');
});
