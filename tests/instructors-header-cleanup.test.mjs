import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test/' });
globalThis.document = dom.window.document;
globalThis.Event = dom.window.Event;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.queueMicrotask = globalThis.queueMicrotask || dom.window.queueMicrotask.bind(dom.window);

const { cleanupInstructorsHeader } = await import('../frontend/src/instructors-header-cleanup.js');

test('instructors page keeps the search row and removes a stray legacy course-scheduling button', () => {
  document.body.innerHTML = `<main id="app">
    <header class="ds-page-header">
      <h1 class="ds-page-header__title">מדריכים</h1>
      <button type="button" data-route="course-scheduling">שיבוץ קורסים</button>
    </header>
    <div class="ds-screen-top-row">
      <div data-search-row><input data-instructors-search value="חיפוש ישן"><span>12 מדריכים</span></div>
      <div data-filters-row><button type="button">פעילים</button></div>
    </div>
  </main>`;

  assert.equal(cleanupInstructorsHeader(document), true);
  assert.ok(document.querySelector('[data-instructors-search]'), 'the search box is a permanent part of the guides page and must remain');
  assert.equal(document.querySelector('[data-instructors-search]').value, 'חיפוש ישן', 'an in-progress search value must not be cleared');
  assert.equal(document.querySelector('[data-route="course-scheduling"]'), null);
  assert.ok(document.querySelector('[data-filters-row]'), 'status and assignment filters must remain');
});

test('cleanup does not alter another screen', () => {
  document.body.innerHTML = `<main id="app">
    <header class="ds-page-header">
      <h1 class="ds-page-header__title">פעילויות</h1>
      <button type="button" data-route="course-scheduling">שיבוץ קורסים</button>
    </header>
    <div><input data-instructors-search value="בדיקה"></div>
  </main>`;

  assert.equal(cleanupInstructorsHeader(document), false);
  assert.ok(document.querySelector('[data-instructors-search]'));
  assert.ok(document.querySelector('[data-route="course-scheduling"]'));
});
