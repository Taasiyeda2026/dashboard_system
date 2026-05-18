import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { archiveScreen } from '../frontend/src/screens/archive.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const rows = [
  { RowID: '1', activity_name: 'אלפא תוכנית', activity_type: 'course', authority: 'חיפה', school: 'אלון', instructor_name: 'דנה', activity_manager: 'מנהל א', start_date: '2025-01-01', end_date: '2025-02-01' },
  { RowID: '2', activity_name: 'ביתא סדנה', activity_type: 'workshop', authority: 'נתניה', school: 'ברוש', instructor_name: 'נועה', activity_manager: 'מנהל ב', start_date: '2023-01-01', end_date: '2023-02-01' },
  { RowID: '3', activity_name: 'גמא סיור', activity_type: 'tour', authority: 'תל אביב', school: 'גפן', instructor_name: 'רוני', activity_manager: 'מנהל ג', start_date: '2025-03-01', end_date: '2025-04-01' }
];

function mountArchive(state = {}) {
  const html = archiveScreen.render({ rows }, { state });
  const dom = new JSDOM(`<main id="root">${html}</main>`, { url: 'http://localhost/archive' });
  const root = dom.window.document.querySelector('#root');
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  const previousCancelAnimationFrame = globalThis.cancelAnimationFrame;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  return {
    dom,
    root,
    cleanup() {
      dom.window.close();
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
      globalThis.requestAnimationFrame = previousRequestAnimationFrame;
      globalThis.cancelAnimationFrame = previousCancelAnimationFrame;
    }
  };
}

test('archive search keeps input mounted and updates only the table after debounce', async () => {
  const state = { user: { display_role: 'admin' }, clientSettings: {} };
  const { dom, root, cleanup } = mountArchive(state);
  let rerenderCount = 0;

  try {
    archiveScreen.bind({
      root,
      data: { rows },
      state,
      rerender: () => { rerenderCount += 1; },
      ui: {},
      api: {}
    });

    const input = root.querySelector('[data-filter-search="archive"]');
    const title = root.querySelector('.ds-activities-page-title');
    const toolbar = root.querySelector('[data-local-filters="archive"]');
    const tableContainer = root.querySelector('[data-archive-table-section]');

    input.value = 'א';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await sleep(320);

    assert.equal(rerenderCount, 0);
    assert.equal(root.querySelector('[data-filter-search="archive"]'), input);
    assert.equal(root.querySelector('.ds-activities-page-title'), title);
    assert.equal(root.querySelector('[data-local-filters="archive"]'), toolbar);
    assert.match(tableContainer.textContent, /אלפא תוכנית/);
    assert.match(tableContainer.textContent, /ביתא סדנה/);

    input.value = 'אל';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await sleep(320);

    assert.equal(rerenderCount, 0);
    assert.equal(root.querySelector('[data-filter-search="archive"]'), input);
    assert.match(tableContainer.textContent, /אלפא תוכנית/);
    assert.doesNotMatch(tableContainer.textContent, /ביתא סדנה/);
  } finally {
    cleanup();
  }
});

test('archive show more and year filter continue to work', () => {
  const state = { user: { display_role: 'admin' }, clientSettings: {}, listFilters: { archive: { q: '', appliedQ: '', visibleCount: 1 } } };
  const { dom, root, cleanup } = mountArchive(state);
  let rerenderCount = 0;

  try {
    archiveScreen.bind({
      root,
      data: { rows },
      state,
      rerender: () => { rerenderCount += 1; },
      ui: {},
      api: {}
    });

    assert.equal(root.querySelectorAll('[data-row-id]').length, 1);
    root.querySelector('[data-list-show-more="archive"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.equal(rerenderCount, 0);
    assert.equal(root.querySelectorAll('[data-row-id]').length, 3);

    root.querySelector('[data-archive-year="2025"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.equal(state.archiveYear, '2025');
    assert.equal(rerenderCount, 1);
  } finally {
    cleanup();
  }
});
