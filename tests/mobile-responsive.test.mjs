import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  activeFilterCount,
  enhanceClientQueues,
  enhanceCompactNavigation,
  enhanceDrawerSections,
  enhanceExpandableTable,
  enhanceFilterToolbar,
  bindMobileResponsive
} from '../frontend/src/mobile-responsive.js';

function dom(html) {
  return new JSDOM(`<body>${html}</body>`).window.document;
}

test('mobile filters keep search visible and count active original controls', () => {
  const document = dom(`<div class="ds-activities-main-toolbar">
    <input type="search" value="school">
    <select><option value="all">הכול</option></select>
    <select><option value="north" selected>צפון</option></select>
    <div class="actions"><button>ייצוא</button></div>
  </div>`);
  const toolbar = document.querySelector('.ds-activities-main-toolbar');
  enhanceFilterToolbar(toolbar);
  assert.equal(toolbar.querySelectorAll('[data-mobile-filter-toggle]').length, 1);
  assert.equal(toolbar.querySelector('[data-mobile-filter-toggle]').textContent, 'סינון (1)');
  assert.equal(activeFilterCount(toolbar), 1);
  assert.equal(toolbar.querySelector('input[type="search"]').classList.contains('mobile-filter-detail'), false);
  enhanceFilterToolbar(toolbar);
  assert.equal(toolbar.querySelectorAll('[data-mobile-filter-toggle]').length, 1, 'enhancement is idempotent');
});

test('activity and proposal tables reuse rows and only add one disclosure control', () => {
  const document = dom(`<table><thead><tr><th>תוכנית</th><th>רשות</th></tr></thead>
    <tbody><tr data-row-id="a1"><td>רובוטיקה</td><td>חיפה</td></tr></tbody></table>`);
  const table = document.querySelector('table');
  const originalRow = table.tBodies[0].rows[0];
  enhanceExpandableTable(table, 'activities');
  assert.equal(table.tBodies[0].rows[0], originalRow, 'source DOM row is retained');
  assert.equal(originalRow.children[1].dataset.mobileLabel, 'רשות');
  assert.equal(originalRow.querySelectorAll('[data-mobile-row-toggle]').length, 1);
  enhanceExpandableTable(table, 'activities');
  assert.equal(originalRow.querySelectorAll('[data-mobile-row-toggle]').length, 1);
});

test('internal navigation and proposal queues preserve existing action elements', () => {
  const document = dom(`<div><nav class="instructors-workspace-tabs"><button class="is-active">שיבוצים</button><button>תחזוקה</button></nav></div>
    <main><section class="ds-client-queue"><header><span>טיוטות</span><b>0</b></header><div><button data-existing-action>פתיחה</button></div></section></main>`);
  const nav = document.querySelector('nav');
  const existingTab = nav.lastElementChild;
  enhanceCompactNavigation(nav);
  enhanceClientQueues(document);
  assert.equal(nav.previousElementSibling.textContent, 'שיבוצים ▾');
  assert.equal(nav.lastElementChild, existingTab);
  assert.equal(document.querySelector('.ds-client-queue').classList.contains('is-mobile-empty'), true);
  assert.ok(document.querySelector('[data-existing-action]'), 'existing proposal action remains in place');
});

test('drawer sections collapse without cloning fields or actions', () => {
  const document = dom(`<aside class="ds-pa-drawer">
    <section class="ds-pa-info-card" data-pa-proposal-info-card><h4 class="ds-pa-card-title">פרטי הצעה</h4><input name="quote"></section>
    <section class="ds-pa-info-card"><h4 class="ds-pa-card-title">איש קשר</h4><button data-save>שמירה</button></section>
  </aside>`);
  const save = document.querySelector('[data-save]');
  enhanceDrawerSections(document);
  assert.equal(document.querySelector('[data-pa-proposal-info-card]').classList.contains('is-mobile-collapsed'), false);
  assert.equal(save.closest('section').classList.contains('is-mobile-collapsed'), true);
  assert.equal(document.querySelector('[data-save]'), save);
});

test('required mobile widths enhance once while required desktop widths remain untouched', () => {
  for (const width of [390, 393, 430, 820, 1280, 1440, 1920]) {
    const page = new JSDOM(`<body><nav class="instructors-workspace-tabs"><button class="is-active">שיבוצים</button></nav>
      <table class="ds-table--activities-list"><thead><tr><th>תוכנית</th><th>הערות</th></tr></thead><tbody><tr><td>מדעים</td><td>טקסט</td></tr></tbody></table></body>`);
    Object.defineProperty(page.window, 'innerWidth', { value: width });
    page.window.matchMedia = () => ({ matches: width <= 820, addEventListener() {} });
    bindMobileResponsive(page.window.document, page.window);
    const row = page.window.document.querySelector('tbody tr');
    const toggle = row.querySelector('[data-mobile-row-toggle]');
    if (width <= 820) {
      assert.ok(toggle, `${width}px gets mobile disclosure`);
      toggle.click();
      assert.equal(row.getAttribute('aria-expanded'), 'true');
      bindMobileResponsive(page.window.document, page.window);
      assert.equal(row.querySelectorAll('[data-mobile-row-toggle]').length, 1, `${width}px binding remains single`);
    } else {
      assert.equal(toggle, null, `${width}px desktop row DOM is untouched`);
      assert.equal(page.window.document.querySelector('[data-mobile-section-nav-toggle]'), null, `${width}px desktop nav DOM is untouched`);
    }
  }
});
