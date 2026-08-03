import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test/' });
globalThis.document = dom.window.document;
globalThis.Event = dom.window.Event;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.localStorage = dom.window.localStorage;
globalThis.queueMicrotask = globalThis.queueMicrotask || dom.window.queueMicrotask.bind(dom.window);

const { cleanupInstructorsHeader } = await import('../frontend/src/instructors-header-cleanup.js');

test('instructors page removes the search row and course scheduling button', () => {
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

  let inputEvents = 0;
  document.querySelector('[data-instructors-search]').addEventListener('input', () => { inputEvents += 1; });

  assert.equal(cleanupInstructorsHeader(document), true);
  assert.equal(document.querySelector('[data-instructors-search]'), null);
  assert.equal(document.querySelector('[data-route="course-scheduling"]'), null);
  assert.ok(document.querySelector('[data-filters-row]'), 'status and assignment filters must remain');
  assert.equal(inputEvents, 1, 'a persisted search value must be cleared before the control is removed');
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
