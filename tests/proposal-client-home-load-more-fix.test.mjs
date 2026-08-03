import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const {
  installClientHomeLoadMoreFix,
  removeClientHomeLoadMore
} = await import('../frontend/src/proposal-client-home-load-more-fix.js');

test('client-file home removes the misleading load-more control only from the queue view', () => {
  const dom = new JSDOM(`
    <main>
      <section data-pa-client-home>
        <div data-pa-load-more-wrap>
          <button data-pa-load-more-proposals>הצגת תיקים נוספים</button>
        </div>
      </section>
      <section class="ds-pa-table-region">
        <div data-pa-load-more-wrap>
          <button data-pa-load-more-proposals>הצגת תיקים נוספים</button>
        </div>
      </section>
    </main>
  `);

  assert.equal(removeClientHomeLoadMore(dom.window.document), 1);
  assert.equal(dom.window.document.querySelector('[data-pa-client-home] [data-pa-load-more-proposals]'), null);
  assert.notEqual(dom.window.document.querySelector('.ds-pa-table-region [data-pa-load-more-proposals]'), null);
});

test('runtime removes a client-home load-more control added after initial render', async () => {
  const dom = new JSDOM('<main id="app"></main>', { url: 'http://localhost/' });
  assert.equal(installClientHomeLoadMoreFix(dom.window), true);

  dom.window.document.querySelector('#app').insertAdjacentHTML('beforeend', `
    <section data-pa-client-home>
      <div data-pa-load-more-wrap>
        <button data-pa-load-more-proposals>הצגת תיקים נוספים</button>
      </div>
    </section>
  `);

  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  assert.equal(dom.window.document.querySelector('[data-pa-client-home] [data-pa-load-more-proposals]'), null);
});

test('proposal feature loader includes the focused client-home fix', async () => {
  const source = await readFile(new URL('../frontend/src/feature-loaders.js', import.meta.url), 'utf8');
  assert.match(source, /proposal-client-home-load-more-fix\.js\?v=20260803-v1/);
});
