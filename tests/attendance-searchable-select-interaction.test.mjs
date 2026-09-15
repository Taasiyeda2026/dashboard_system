import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createSearchableSelect } from '../attendance/src/components/searchable-select.js';

test('extended search keeps the picker open and focuses the search input before replacing options', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousRaf = globalThis.requestAnimationFrame;
  const rafQueue = [];

  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.requestAnimationFrame = (callback) => {
    rafQueue.push(callback);
    return rafQueue.length;
  };

  let releaseLoad;
  const pendingLoad = new Promise((resolve) => { releaseLoad = resolve; });

  try {
    const select = createSearchableSelect({
      id: 'activity',
      options: [{ value: 'mine', label: 'ביומימיקרי', meta: 'מקיף אבו גוש · אבו גוש' }],
      searchMode: 'extended-only',
      extendedSearch: {
        label: 'חיפוש מורחב',
        loadOptions: async () => {
          await pendingLoad;
          return [{ value: 'other', label: 'טכנולוגיות החלל', meta: 'בית ספר אחר · רשות אחרת' }];
        },
      },
    });

    document.body.append(select.wrap);
    const trigger = select.wrap.querySelector('.av2-ssel__trigger');
    trigger.click();
    rafQueue.shift()?.();

    const firstOption = select.wrap.querySelector('.av2-ssel__option');
    assert.equal(document.activeElement, firstOption);
    assert.equal(firstOption.querySelector('.av2-ssel__option-label')?.textContent, 'ביומימיקרי');
    assert.equal(firstOption.querySelector('.av2-ssel__option-meta')?.textContent, 'מקיף אבו גוש · אבו גוש');

    const extended = select.wrap.querySelector('.av2-ssel__extended');
    extended.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    extended.click();

    const panel = select.wrap.querySelector('.av2-ssel__panel');
    const searchWrap = select.wrap.querySelector('.av2-ssel__search-wrap');
    const searchInput = select.wrap.querySelector('.av2-ssel__search');
    assert.equal(panel.hidden, false);
    assert.equal(searchWrap.hidden, false);
    assert.equal(document.activeElement, searchInput);
    assert.match(select.wrap.textContent, /טוען/);

    releaseLoad();
    await pendingLoad;
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(panel.hidden, false);
    assert.equal(searchWrap.hidden, false);
    assert.match(select.wrap.textContent, /טכנולוגיות החלל/);
  } finally {
    dom.window.close();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousRaf === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = previousRaf;
  }
});
