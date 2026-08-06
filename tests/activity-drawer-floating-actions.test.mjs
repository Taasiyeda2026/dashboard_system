import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const CSS_FILE = new URL('../frontend/src/styles/activity-drawer-floating-actions.css', import.meta.url);

globalThis.__ACTIVITY_DRAWER_FLOATING_ACTIONS_TEST__ = true;
const moduleUrl = new URL('../frontend/src/activity-drawer-floating-actions.js', import.meta.url);
const { dockActivityDrawerActions } = await import(`${moduleUrl.href}?test=${Date.now()}`);

test('activity drawer action bars are moved outside the scrollable body', () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <form class="activity-drawer-inline-layout">
      <header class="activity-drawer__header"></header>
      <div class="activity-drawer__body activity-drawer-inline__body">
        <section class="activity-content">תוכן ארוך</section>
        <section class="activity-drawer__section activity-drawer__section--actions" data-mode="edit" hidden>שמירה</section>
        <div class="activity-drawer__view-footer" data-mode="view">עריכה</div>
      </div>
    </form>
  </body></html>`);

  const form = dom.window.document.querySelector('form');
  const body = form.querySelector('.activity-drawer-inline__body');

  assert.equal(dockActivityDrawerActions(form), true);
  assert.equal(body.querySelector('.activity-drawer__section--actions'), null);
  assert.equal(body.querySelector('.activity-drawer__view-footer'), null);
  assert.ok(form.querySelector(':scope > .activity-drawer__section--actions'));
  assert.ok(form.querySelector(':scope > .activity-drawer__view-footer'));
  assert.equal(form.lastElementChild.className, 'activity-drawer__view-footer');
  assert.equal(dockActivityDrawerActions(form), false);

  dom.window.close();
});

test('floating action CSS keeps the docked bar visible above the scrolling content', async () => {
  const css = await readFile(CSS_FILE, 'utf8');
  assert.match(css, /> \.activity-drawer__view-footer[\s\S]*position:\s*relative\s*!important/);
  assert.match(css, /flex:\s*0 0 auto/);
  assert.match(css, /box-shadow:\s*0 -10px 22px/);
});
