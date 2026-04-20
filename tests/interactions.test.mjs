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

// ---------------------------------------------------------------------------
// openModal — blank-guard tests
// ---------------------------------------------------------------------------

test('openModal() with no arguments does not open the modal', async () => {
  const ui = await freshLayer();
  ui.openModal();
  assert.equal(ui.isModalOpen, false);
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
