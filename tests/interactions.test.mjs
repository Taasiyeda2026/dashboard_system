import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const MODULE_PATH = new URL('../frontend/src/screens/shared/interactions.js', import.meta.url).href;

const _originalWarn = console.warn;
console.warn = () => {};

function setupDOM() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost/'
  });
  global.window = dom.window;
  global.document = dom.window.document;
  global.Element = dom.window.Element;
  global.HTMLElement = dom.window.HTMLElement;
  global.requestAnimationFrame = (callback) => callback();
  return dom;
}

async function freshLayer() {
  setupDOM();
  const mod = await import(`${MODULE_PATH}?bust=${Date.now()}`);
  return mod.createSharedInteractionLayer();
}

// ---------------------------------------------------------------------------
// openDrawer — blank-guard tests
// ---------------------------------------------------------------------------

test('openDrawer() with no arguments does not open the drawer', async () => {
  const ui = await freshLayer();
  ui.openDrawer();
  assert.equal(ui.isDrawerOpen, false);
});

test('openDrawer({}) with an empty object does not open the drawer', async () => {
  const ui = await freshLayer();
  ui.openDrawer({});
  assert.equal(ui.isDrawerOpen, false);
});

test('openDrawer with whitespace-only content and no title does not open the drawer', async () => {
  const ui = await freshLayer();
  ui.openDrawer({ content: '   ' });
  assert.equal(ui.isDrawerOpen, false);
});

test('openDrawer with real content opens the drawer', async () => {
  const ui = await freshLayer();
  ui.openDrawer({ content: '<p>Hello</p>' });
  assert.equal(ui.isDrawerOpen, true);
});

test('openDrawer with only a title (no content) opens the drawer', async () => {
  const ui = await freshLayer();
  ui.openDrawer({ title: 'Details' });
  assert.equal(ui.isDrawerOpen, true);
});

test('openDrawer with both title and content opens the drawer', async () => {
  const ui = await freshLayer();
  ui.openDrawer({ title: 'Test', content: '<p>body</p>' });
  assert.equal(ui.isDrawerOpen, true);
});

test('secondary drawer opens and closes independently while main drawer remains open', async () => {
  const ui = await freshLayer();
  ui.openDrawer({ content: '<p>Main activity</p>' });
  ui.openSecondaryDrawer({ title: 'אישור תיאום', content: '<p>Coordination</p>' });
  assert.equal(ui.isDrawerOpen, true);
  assert.equal(ui.isSecondaryDrawerOpen, true);
  assert.equal(document.querySelector('.ds-secondary-drawer').getAttribute('aria-hidden'), 'false');
  document.querySelector('[data-ui-close-secondary-drawer]').click();
  assert.equal(ui.isSecondaryDrawerOpen, false);
  assert.equal(ui.isDrawerOpen, true);
  assert.equal(document.querySelector('.ds-drawer').getAttribute('aria-hidden'), 'false');
});

// ---------------------------------------------------------------------------
// openModal — blank-guard tests
// ---------------------------------------------------------------------------

test('openModal() with no arguments does not open the modal', async () => {
  const ui = await freshLayer();
  ui.openModal();
  assert.equal(ui.isModalOpen, false);
});

test('modal can open above an activity drawer and closing it preserves the drawer', async () => {
  const ui = await freshLayer();
  ui.openDrawer({ title: 'פעילות', content: '<p data-current-activity>Current activity</p>' });
  ui.openModal({ title: 'אישור תיאום', content: '<p>Coordination</p>', keepDrawerOpen: true });
  assert.equal(ui.isDrawerOpen, true);
  assert.equal(ui.isModalOpen, true);
  assert.equal(document.querySelector('.ds-secondary-drawer').getAttribute('aria-hidden'), 'true');
  ui.closeModal();
  assert.equal(ui.isDrawerOpen, true);
  assert.ok(document.querySelector('[data-current-activity]'));
});

test('openModal({}) with an empty object does not open the modal', async () => {
  const ui = await freshLayer();
  ui.openModal({});
  assert.equal(ui.isModalOpen, false);
});

test('openModal with whitespace-only content, no actions and no title does not open the modal', async () => {
  const ui = await freshLayer();
  ui.openModal({ content: '  ', actions: '' });
  assert.equal(ui.isModalOpen, false);
});

test('openModal with real content opens the modal', async () => {
  const ui = await freshLayer();
  ui.openModal({ content: '<p>Are you sure?</p>' });
  assert.equal(ui.isModalOpen, true);
});

test('openModal with only a title opens the modal', async () => {
  const ui = await freshLayer();
  ui.openModal({ title: 'Confirm' });
  assert.equal(ui.isModalOpen, true);
});

test('openModal with only actions opens the modal', async () => {
  const ui = await freshLayer();
  ui.openModal({ actions: '<button>OK</button>' });
  assert.equal(ui.isModalOpen, true);
});

test('openModal with title and content opens the modal', async () => {
  const ui = await freshLayer();
  ui.openModal({ title: 'Confirm', content: '<p>body</p>' });
  assert.equal(ui.isModalOpen, true);
});

// ---------------------------------------------------------------------------
// closeAll — state reset tests
// ---------------------------------------------------------------------------

test('closeAll() after opening a drawer resets isDrawerOpen to false', async () => {
  const ui = await freshLayer();
  ui.openDrawer({ content: '<p>hello</p>' });
  assert.equal(ui.isDrawerOpen, true);
  ui.closeAll();
  assert.equal(ui.isDrawerOpen, false);
});

test('closeAll() after opening a modal resets isModalOpen to false', async () => {
  const ui = await freshLayer();
  ui.openModal({ content: '<p>modal body</p>' });
  assert.equal(ui.isModalOpen, true);
  ui.closeAll();
  assert.equal(ui.isModalOpen, false);
});

test('closeAll() resets both drawer and modal when both have been opened', async () => {
  const ui = await freshLayer();
  ui.openDrawer({ content: '<p>drawer</p>' });
  assert.equal(ui.isDrawerOpen, true);
  ui.openModal({ content: '<p>modal</p>' });
  assert.equal(ui.isModalOpen, true);
  ui.closeAll();
  assert.equal(ui.isDrawerOpen, false);
  assert.equal(ui.isModalOpen, false);
});

test('closeAll() on an already-closed layer leaves both flags false', async () => {
  const ui = await freshLayer();
  ui.closeAll();
  assert.equal(ui.isDrawerOpen, false);
  assert.equal(ui.isModalOpen, false);
});

test('closeAll() invokes the drawer onClose callback', async () => {
  const ui = await freshLayer();
  let called = false;
  ui.openDrawer({ content: '<p>x</p>', onClose: () => { called = true; } });
  ui.closeAll();
  assert.equal(called, true);
});

test('closeAll() invokes the modal onClose callback', async () => {
  const ui = await freshLayer();
  let called = false;
  ui.openModal({ content: '<p>x</p>', onClose: () => { called = true; } });
  ui.closeAll();
  assert.equal(called, true);
});

test('all consumers receive the same shared interaction layer instance', async () => {
  setupDOM();
  const mod = await import(`${MODULE_PATH}?singleton=${Date.now()}`);
  assert.equal(mod.createSharedInteractionLayer(), mod.createSharedInteractionLayer());
});

test('drawer close control closes active drawer exactly once and hides its backdrop', async () => {
  const ui = await freshLayer();
  let closeCount = 0;
  ui.openDrawer({ content: '<p>active</p>', onClose: () => { closeCount += 1; } });
  document.querySelector('[data-ui-close-drawer]').click();
  const host = document.getElementById('ds-shared-ui-layer');
  assert.equal(host.querySelector('.ds-drawer').getAttribute('aria-hidden'), 'true');
  assert.equal(host.classList.contains('is-drawer-open'), false);
  assert.equal(host.querySelector('.ds-ui-backdrop').hidden, true);
  assert.equal(closeCount, 1);
  document.querySelector('[data-ui-close-drawer]').click();
  assert.equal(closeCount, 1);
});

test('Escape and backdrop close the active drawer', async () => {
  const ui = await freshLayer();
  ui.openDrawer({ content: '<p>escape</p>' });
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(ui.isDrawerOpen, false);
  ui.openDrawer({ content: '<p>backdrop</p>' });
  document.querySelector('[data-ui-close-all]').click();
  assert.equal(ui.isDrawerOpen, false);
});
