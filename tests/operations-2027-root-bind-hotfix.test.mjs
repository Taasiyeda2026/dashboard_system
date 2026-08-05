import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

function storageStub() {
  const values = new Map();
  return {
    get length() { return values.size; },
    getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
    clear() { values.clear(); },
    key(index) { return Array.from(values.keys())[index] ?? null; }
  };
}

globalThis.localStorage = storageStub();
globalThis.sessionStorage = storageStub();

const {
  resolveOperations2027ScreenRoot,
  applyOperations2027VisibleLabels
} = await import('../frontend/src/screens/operations-2027-root-bind-hotfix.js');

const source = await readFile(
  new URL('../frontend/src/screens/operations-2027-root-bind-hotfix.js', import.meta.url),
  'utf8'
);
const loaderSource = await readFile(
  new URL('../frontend/src/screens/operations-authorities-cleanup.js', import.meta.url),
  'utf8'
);

test('resolves the nested Operations 2027 screen from the outer screenRoot container', () => {
  const dom = new JSDOM(`<!doctype html><div id="screenRoot"><div class="ds-screen-stack ds-ops-mgmt-screen ops-year-2027" data-ops-year="2027"><div class="ds-ops-mgmt-tabs"></div></div></div>`);
  const outerRoot = dom.window.document.getElementById('screenRoot');
  const resolved = resolveOperations2027ScreenRoot(outerRoot);
  assert.ok(resolved);
  assert.equal(resolved.matches('.ds-ops-mgmt-screen[data-ops-year="2027"]'), true);
  dom.window.close();
});

test('accepts the Operations 2027 screen itself as the binding root', () => {
  const dom = new JSDOM(`<!doctype html><div class="ds-ops-mgmt-screen ops-year-2027" data-ops-year="2027"></div>`);
  const screen = dom.window.document.querySelector('.ds-ops-mgmt-screen');
  assert.equal(resolveOperations2027ScreenRoot(screen), screen);
  dom.window.close();
});

test('renames the native workshop tab to workshop inventory', () => {
  const dom = new JSDOM(`<!doctype html><div class="ds-ops-mgmt-screen" data-ops-year="2027"><button data-ops-tab="workshops">ציוד ומלאי</button></div>`);
  const screen = dom.window.document.querySelector('.ds-ops-mgmt-screen');
  applyOperations2027VisibleLabels(screen);
  assert.equal(screen.querySelector('[data-ops-tab="workshops"]').textContent, 'מלאי סדנאות');
  dom.window.close();
});

test('wrapper forwards the nested screen root to the already installed controller', () => {
  assert.match(source, /const screenRoot = resolveOperations2027ScreenRoot\(context\.root\)/);
  assert.match(source, /originalBind\.call\(this, \{ \.\.\.context, root: screenRoot \}\)/);
  assert.match(loaderSource, /operations-2027-loading-controller\.js/);
  assert.match(loaderSource, /operations-2027-root-bind-hotfix\.js/);
});
