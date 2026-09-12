import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM(`
  <main id="app">
    <div class="ds-screen-stack">
      <header class="ds-page-header"><h1 class="ds-page-header__title">תיק לקוח</h1></header>
      <section class="ds-pa-screen" data-pa-screen data-pa-view-mode="all-proposals">
        <div class="ds-pa-legacy-list" data-pa-all-proposals-table aria-hidden="false">
          <div class="ds-pa-all-back"><button type="button" class="ds-btn ds-btn--ghost" data-pa-back-to-client-home>← חזרה לתיק הלקוח</button></div>
        </div>
      </section>
    </div>
  </main>
`, { url: 'http://localhost/' });

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Element = dom.window.Element;
globalThis.MutationObserver = dom.window.MutationObserver;

const { syncProposalBackButtonLayout } = await import('../frontend/src/proposal-client-back-button-layout.js');

test('moves the client-file back button into the page header only in all-proposals view', () => {
  const screen = document.querySelector('[data-pa-screen]');
  const header = document.querySelector('.ds-page-header');
  const oldHost = document.querySelector('.ds-pa-all-back');
  const button = document.querySelector('[data-pa-back-to-client-home]');

  assert.equal(syncProposalBackButtonLayout(), true);
  assert.equal(button.parentElement, header);
  assert.equal(button.textContent, '← לתיקי לקוחות');
  assert.equal(button.hidden, false);
  assert.equal(header.classList.contains('ds-pa-page-header--with-back'), true);
  assert.equal(oldHost.hidden, true);

  screen.dataset.paViewMode = 'client-home';
  assert.equal(syncProposalBackButtonLayout(), true);
  assert.equal(button.hidden, true);
  assert.equal(header.classList.contains('ds-pa-page-header--with-back'), false);
});
