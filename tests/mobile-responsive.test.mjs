import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  activeFilterCount,
  bindMobileResponsive,
  cleanupMobileRoot,
  enhanceClientQueues,
  enhanceCompactNavigation,
  enhanceDrawerSections,
  enhanceExpandableTable,
  enhanceFilterToolbar,
  enhanceMobileRoot,
  syncCompactNavigation,
  syncFilterToolbar
} from '../frontend/src/mobile-responsive.js';

function dom(html) {
  return new JSDOM(`<body>${html}</body>`).window.document;
}

function controllableMedia(initialMatches) {
  let matches = initialMatches;
  const listeners = new Set();
  return {
    get matches() { return matches; },
    addEventListener(type, listener) { if (type === 'change') listeners.add(listener); },
    set(next) {
      matches = next;
      listeners.forEach((listener) => listener({ matches }));
    }
  };
}

test('filter sync handles new/programmatic controls once and cleanup restores original toolbar', () => {
  const document = dom(`<div class="ds-activities-main-toolbar"><input type="search" value="school"><select><option value="all">הכול</option></select><div class="actions"><button>ייצוא</button></div></div>`);
  const toolbar = document.querySelector('.ds-activities-main-toolbar');
  const originalSearch = toolbar.querySelector('input');
  enhanceFilterToolbar(toolbar);
  const added = document.createElement('select');
  added.innerHTML = '<option value="north">צפון</option>';
  toolbar.append(added);
  syncFilterToolbar(toolbar);
  assert.equal(activeFilterCount(toolbar), 1);
  assert.equal(toolbar.querySelector('[data-mobile-filter-toggle]').textContent, 'סינון (1)');
  assert.equal(toolbar.querySelectorAll('[data-mobile-filter-toggle]').length, 1);
  assert.equal(added.classList.contains('mobile-filter-detail'), true);
  cleanupMobileRoot(document);
  assert.equal(toolbar.querySelector('[data-mobile-filter-toggle]'), null);
  assert.equal(toolbar.querySelector('.mobile-filter-detail'), null);
  assert.equal(toolbar.querySelector('input'), originalSearch);
});

test('dynamic table rows receive semantic labels and exactly one disclosure', () => {
  const document = dom(`<table><thead><tr><th>תוכנית</th><th>תאריך התחלה</th><th>תאריך סיום</th></tr></thead><tbody><tr><td>רובוטיקה</td><td>1.1</td><td>2.2</td></tr></tbody></table>`);
  const table = document.querySelector('table');
  const originalRow = table.tBodies[0].rows[0];
  enhanceExpandableTable(table, 'activities');
  const newRow = table.tBodies[0].insertRow();
  newRow.innerHTML = '<td>מדעים</td><td>3.3</td><td>4.4</td>';
  enhanceExpandableTable(table, 'activities');
  assert.equal(table.tBodies[0].rows[0], originalRow);
  assert.equal(originalRow.querySelectorAll('[data-mobile-row-toggle]').length, 1);
  assert.equal(newRow.querySelectorAll('[data-mobile-row-toggle]').length, 1);
  assert.equal(newRow.children[1].dataset.mobileField, 'primary');
  assert.equal(newRow.children[2].dataset.mobileField, 'primary');
  assert.equal(newRow.children[2].dataset.mobileLabel, 'תאריך סיום');
});

test('client queue sync supports empty to populated and populated to empty', () => {
  const document = dom(`<main><section class="ds-client-queue"><header><span>טיוטות</span><b>0</b></header><div><button data-existing-action>פתיחה</button></div></section></main>`);
  const queue = document.querySelector('.ds-client-queue');
  const header = queue.querySelector('header');
  enhanceClientQueues(document);
  assert.equal(queue.classList.contains('is-mobile-empty'), true);
  header.querySelector('b').textContent = '3';
  enhanceClientQueues(document);
  assert.equal(queue.classList.contains('is-mobile-empty'), false);
  queue.classList.add('is-mobile-expanded');
  header.querySelector('b').textContent = '0';
  enhanceClientQueues(document);
  assert.equal(queue.classList.contains('is-mobile-empty'), true);
  assert.equal(queue.classList.contains('is-mobile-expanded'), false);
  assert.equal(document.querySelectorAll('[data-mobile-queue-toggle]').length, 1);
  assert.ok(document.querySelector('[data-existing-action]'));
});

test('compact navigation synchronizes active tab without replacing original buttons', () => {
  const document = dom(`<div><nav class="instructors-workspace-tabs"><button class="is-active" aria-selected="true">שיבוצים</button><button aria-selected="false">תחזוקה</button></nav></div>`);
  const nav = document.querySelector('nav');
  const tabs = [...nav.children];
  enhanceCompactNavigation(nav);
  assert.equal(nav.previousElementSibling.textContent, 'שיבוצים ▾');
  tabs[0].classList.remove('is-active');
  tabs[0].setAttribute('aria-selected', 'false');
  tabs[1].classList.add('is-active');
  tabs[1].setAttribute('aria-selected', 'true');
  syncCompactNavigation(nav);
  assert.equal(nav.previousElementSibling.textContent, 'תחזוקה ▾');
  assert.deepEqual([...nav.children], tabs);
  assert.equal(nav.previousElementSibling.hasAttribute('aria-controls'), true);
});

test('matrix enhancement is limited to training tabs', () => {
  const document = dom(`<div data-ops-controller-tab="course_training_matrix"><table class="ops2027-table"><thead><tr><th>שם</th><th>קורס</th></tr></thead><tbody><tr><td>מדריך</td><td>✓</td></tr></tbody></table></div>
    <div data-ops-controller-tab="course_print_kits"><table class="ops2027-table"><thead><tr><th>מלאי</th></tr></thead><tbody><tr><td>10</td></tr></tbody></table></div>`);
  enhanceMobileRoot(document);
  const [matrix, stock] = document.querySelectorAll('.ops2027-table');
  assert.equal(matrix.dataset.mobileTableKind, 'matrix');
  assert.equal(stock.hasAttribute('data-mobile-table-ready'), false);
  assert.equal(stock.querySelector('[data-mobile-row-toggle]'), null);
});

test('drawer sections preserve original fields and ARIA through cleanup', () => {
  const document = dom(`<aside class="ds-pa-drawer"><section class="ds-pa-info-card" data-pa-proposal-info-card><h4 class="ds-pa-card-title">פרטי הצעה</h4><input name="quote"></section><section class="ds-pa-info-card"><h4 class="ds-pa-card-title" role="heading">איש קשר</h4><button data-save>שמירה</button></section></aside>`);
  const save = document.querySelector('[data-save]');
  const title = save.closest('section').querySelector('h4');
  enhanceDrawerSections(document);
  assert.equal(save.closest('section').classList.contains('is-mobile-collapsed'), true);
  cleanupMobileRoot(document);
  assert.equal(document.querySelector('[data-save]'), save);
  assert.equal(title.getAttribute('role'), 'heading');
  assert.equal(title.hasAttribute('tabindex'), false);
  assert.equal(title.hasAttribute('aria-expanded'), false);
});

test('same DOM transitions 390 to 1440 to 390 with full cleanup and no duplicates', () => {
  const page = new JSDOM(`<body><div><nav class="instructors-workspace-tabs"><button class="is-active">שיבוצים</button><button>תחזוקה</button></nav></div><div class="ds-activities-main-toolbar"><input type="search"><select><option value="all">הכול</option></select></div><table class="ds-table--activities-list"><thead><tr><th>תוכנית</th><th>הערות</th></tr></thead><tbody><tr><td>מדעים</td><td>טקסט</td></tr></tbody></table></body>`);
  const media = controllableMedia(true);
  page.window.matchMedia = () => media;
  Object.defineProperty(page.window, 'innerWidth', { value: 390, writable: true });
  const document = page.window.document;
  const row = document.querySelector('tbody tr');
  const tab = document.querySelector('.instructors-workspace-tabs button');
  const search = document.querySelector('input[type="search"]');
  bindMobileResponsive(document, page.window);
  assert.equal(document.querySelectorAll('[data-mobile-row-toggle]').length, 1);
  assert.equal(document.querySelectorAll('[data-mobile-section-nav-toggle]').length, 1);
  assert.equal(document.querySelectorAll('[data-mobile-filter-toggle]').length, 1);

  page.window.innerWidth = 1440;
  media.set(false);
  assert.equal(document.querySelectorAll('[data-mobile-row-toggle], [data-mobile-section-nav-toggle], [data-mobile-filter-toggle]').length, 0);
  assert.equal(document.querySelectorAll('[data-mobile-expandable-row], [data-mobile-label], [data-mobile-field], [data-mobile-queue-ready], [data-mobile-section-ready]').length, 0);
  assert.equal(document.querySelectorAll('[data-mobile-filters-ready], [data-mobile-nav-ready], [data-mobile-table-ready], [data-mobile-queue-toggle], [data-mobile-drawer-section-toggle]').length, 0);
  assert.equal(document.querySelectorAll('.is-mobile-expanded, .is-mobile-collapsed, .is-mobile-empty, .mobile-filter-detail').length, 0);
  assert.equal(row.hasAttribute('aria-expanded'), false);
  assert.equal(document.querySelector('tbody tr'), row);
  assert.equal(document.querySelector('.instructors-workspace-tabs button'), tab);
  assert.equal(document.querySelector('input[type="search"]'), search);

  page.window.innerWidth = 390;
  media.set(true);
  assert.equal(document.querySelectorAll('[data-mobile-row-toggle]').length, 1);
  assert.equal(document.querySelectorAll('[data-mobile-section-nav-toggle]').length, 1);
  assert.equal(document.querySelectorAll('[data-mobile-filter-toggle]').length, 1);
  document.querySelector('[data-mobile-row-toggle]').click();
  assert.equal(row.getAttribute('aria-expanded'), 'true', 'single delegated listener toggles once');
});

test('required initial desktop widths do not receive mobile DOM', () => {
  for (const width of [1280, 1440, 1920]) {
    const page = new JSDOM(`<body><nav class="instructors-workspace-tabs"><button class="is-active">שיבוצים</button></nav><table class="ds-table--activities-list"><tbody><tr><td>מדעים</td></tr></tbody></table></body>`);
    const media = controllableMedia(width <= 820);
    page.window.matchMedia = () => media;
    bindMobileResponsive(page.window.document, page.window);
    assert.equal(page.window.document.querySelector('[data-mobile-row-toggle], [data-mobile-section-nav-toggle]'), null);
  }
});

test('required mobile widths activate one disclosure layer', () => {
  for (const width of [390, 393, 430, 820]) {
    const page = new JSDOM(`<body><table class="ds-table--activities-list"><thead><tr><th>תוכנית</th></tr></thead><tbody><tr><td>מדעים</td></tr></tbody></table></body>`);
    Object.defineProperty(page.window, 'innerWidth', { value: width });
    const media = controllableMedia(true);
    page.window.matchMedia = () => media;
    bindMobileResponsive(page.window.document, page.window);
    assert.equal(page.window.document.querySelectorAll('[data-mobile-row-toggle]').length, 1, `${width}px`);
  }
});

test('week pairs and full-week controls preserve columns and restore desktop visibility', () => {
  const page = new JSDOM(`<body><div class="ds-week-board">${['2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17'].map((date, i) => `<section class="ds-week-col" aria-label="${date}"><span class="ds-week-col__dow">יום ${i}</span><span class="ds-week-col__count">${i}</span><button data-existing>פתיחה</button></section>`).join('')}</div></body>`);
  const media = controllableMedia(true);
  page.window.matchMedia = () => media;
  bindMobileResponsive(page.window.document, page.window);
  const doc = page.window.document;
  const action = doc.querySelector('[data-existing]');
  assert.equal(doc.querySelectorAll('[data-mobile-week-hidden="false"]').length, 4);
  doc.querySelector('[data-mobile-week-day="2026-11-16"]').click();
  assert.equal(doc.querySelector('[aria-label="2026-11-14"]').dataset.mobileWeekHidden, 'true');
  assert.equal(doc.querySelector('[aria-label="2026-11-16"]').dataset.mobileWeekHidden, 'false');
  assert.equal(doc.querySelector('[aria-label="2026-11-17"]').dataset.mobileWeekHidden, 'false');
  doc.querySelector('[data-mobile-week-day="all"]').click();
  assert.equal(doc.querySelectorAll('[data-mobile-week-hidden="true"]').length, 0);
  media.set(false);
  assert.equal(doc.querySelector('[data-mobile-week-controls]'), null);
  assert.equal(doc.querySelector('[data-mobile-week-hidden]'), null);
  assert.equal(doc.querySelector('[data-existing]'), action);
});

test('feedback and manager compact navigation preserve original allowed actions', () => {
  const doc = dom('<nav class="ifb-tabs"><button class="is-active" aria-selected="true">סקירה</button><button>משובים</button></nav><nav data-manager-workspace-tabs><button class="is-active">ניהול</button></nav>');
  const buttons = [...doc.querySelectorAll('nav button')];
  enhanceMobileRoot(doc);
  enhanceMobileRoot(doc);
  assert.equal(doc.querySelectorAll('[data-mobile-section-nav-toggle]').length, 2);
  cleanupMobileRoot(doc);
  assert.deepEqual([...doc.querySelectorAll('nav button')], buttons);
});

test('feedback cards label stages without replacing buttons, zero values, or unavailable labels', () => {
  const doc = dom('<table class="ifb-table ifb-groups-table"><thead><tr><th>קבוצה</th><th>פתיחה</th><th>סיום</th></tr></thead><tbody><tr><td>א׳</td><td><button>0 תשובות</button></td><td>טרם נפתח</td></tr></tbody></table>');
  const button = doc.querySelector('button');
  enhanceMobileRoot(doc);
  assert.equal(doc.querySelector('table').dataset.mobileTableKind, 'feedback');
  assert.equal(button.closest('td').dataset.mobileLabel, 'פתיחה');
  assert.equal(button.textContent, '0 תשובות');
  assert.equal(doc.querySelector('td:last-child').textContent, 'טרם נפתח');
  cleanupMobileRoot(doc);
  assert.equal(doc.querySelector('[data-mobile-label]'), null);
  assert.equal(doc.querySelector('button'), button);
});

test('end-date cards preserve native row expansion and restore desktop table metadata', () => {
  const doc = dom('<table class="ds-end-table"><thead><tr><th>פעילות</th><th>סיום</th></tr></thead><tbody><tr><td><button>פרטים</button></td><td>1/1/2027</td></tr><tr hidden><td colspan="2">כל המפגשים</td></tr></tbody></table>');
  const button = doc.querySelector('button');
  enhanceMobileRoot(doc);
  assert.equal(doc.querySelector('table').dataset.mobileTableKind, 'record');
  assert.equal(doc.querySelector('tbody tr:last-child').hidden, true);
  assert.equal(doc.querySelector('tbody tr:first-child td:last-child').dataset.mobileLabel, 'סיום');
  cleanupMobileRoot(doc);
  assert.equal(doc.querySelector('button'), button);
  assert.equal(doc.querySelector('tbody tr:last-child').hidden, true);
  assert.equal(doc.querySelector('[data-mobile-label]'), null);
});

 test('mobile quick navigation preserves all permitted header tabs and restores desktop', () => {
  const doc = new JSDOM('<header class="shell-top"><nav class="shell-header-nav"><button data-route="activities">פעילויות</button><button data-route="instructors">מדריכים</button><button data-route="edit-requests">אישורים</button></nav></header>').window.document;
  const nav = doc.querySelector('nav');
  const originalButtons = [...nav.querySelectorAll('button')];
  enhanceMobileRoot(doc);
  assert.equal(nav.dataset.mobileNavReady, '1');
  assert.equal(nav.previousElementSibling.textContent, 'ניווט מהיר ▾');
  assert.deepEqual([...nav.querySelectorAll('button')], originalButtons);
  cleanupMobileRoot(doc);
  assert.equal(doc.querySelector('[data-mobile-section-nav-toggle]'), null);
  assert.deepEqual([...nav.querySelectorAll('button')], originalButtons);
});

test('activities reuse the existing filter button and preserve all original controls', () => {
  const doc = dom('<section class="ds-activities-screen"><div class="ds-activities-main-toolbar"><input type="search"><button data-activities-advanced-toggle aria-expanded="false">סינון</button><select><option>רשות</option></select><button data-existing-action>ייצוא</button></div><section data-activities-advanced-panel hidden></section></section>');
  const toolbar = doc.querySelector('.ds-activities-main-toolbar');
  const toggle = doc.querySelector('[data-activities-advanced-toggle]');
  const original = [...toolbar.children];
  enhanceMobileRoot(doc);
  assert.equal(toolbar.querySelector('[data-mobile-filter-toggle]'), null);
  assert.equal(toolbar.classList.contains('is-mobile-expanded'), false);
  assert.equal(toolbar.querySelector('select').classList.contains('mobile-filter-detail'), true);
  toggle.setAttribute('aria-expanded', 'true');
  enhanceMobileRoot(doc);
  assert.equal(toolbar.classList.contains('is-mobile-expanded'), true);
  cleanupMobileRoot(doc);
  assert.deepEqual([...toolbar.children], original);
  assert.equal(toolbar.querySelector('.mobile-filter-detail'), null);
});

test('feedback detail disclosure leaves original stage actions intact', () => {
  const page = new JSDOM('<div class="ifb-group-detail"><article class="ifb-slot"><div class="ifb-slot__head"><h3>פתיחה</h3><span>נשלח</span></div><div><button data-ifb-copy="test">העתקת קישור</button></div></article></div>');
  const doc = page.window.document;
  const media = controllableMedia(true);
  page.window.matchMedia = () => media;
  const action = doc.querySelector('[data-ifb-copy]');
  bindMobileResponsive(doc, page.window);
  const toggle = doc.querySelector('[data-mobile-feedback-slot-toggle]');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  toggle.click();
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(action, doc.querySelector('[data-ifb-copy]'));
  media.set(false);
  assert.equal(doc.querySelector('[data-mobile-feedback-slot-toggle]'), null);
  assert.equal(action, doc.querySelector('[data-ifb-copy]'));
});

test('activities stays outside quick navigation and uses the existing permitted route action', () => {
  const doc = dom('<header class="shell-top"><nav class="shell-header-nav"><button class="is-active" data-route="activities">כל הפעילויות</button><button data-route="instructors">מדריכים</button></nav></header>');
  const original = doc.querySelector('[data-route="activities"]');
  let clicks = 0;
  original.addEventListener('click', () => clicks++);
  enhanceMobileRoot(doc);
  enhanceMobileRoot(doc);
  const shortcut = doc.querySelector('[data-mobile-primary-activities]');
  assert.equal(doc.querySelectorAll('[data-mobile-primary-activities]').length, 1);
  assert.equal(shortcut.textContent, 'פעילויות');
  assert.equal(shortcut.getAttribute('aria-current'), 'page');
  shortcut.click();
  assert.equal(clicks, 1);
  cleanupMobileRoot(doc);
  assert.equal(doc.querySelector('[data-mobile-primary-activities]'), null);
  assert.equal(doc.querySelector('[data-route="activities"]'), original);
  const denied = dom('<header class="shell-top"><nav class="shell-header-nav"><button data-route="instructors">מדריכים</button></nav></header>');
  enhanceMobileRoot(denied);
  assert.equal(denied.querySelector('[data-mobile-primary-activities]'), null);
});

test('2027 cards retain their direct details action without redundant expand controls', () => {
  const doc = dom('<table class="ds-table--activities-list ds-table--activities-2027-active"><tbody><tr><td><div data-mobile-2027-card><div class="activity-mobile-summary__actions"><button data-management-action="activity">פרטי פעילות</button></div></div></td><td>—</td></tr></tbody></table>');
  const action = doc.querySelector('[data-management-action]');
  enhanceMobileRoot(doc);
  assert.equal(doc.querySelector('[data-mobile-row-toggle]'), null);
  assert.equal(doc.querySelector('[data-mobile-activity-view]'), null);
  assert.equal(doc.querySelector('[data-management-action]'), action);
  cleanupMobileRoot(doc);
  assert.equal(doc.querySelector('[data-management-action]'), action);
});
