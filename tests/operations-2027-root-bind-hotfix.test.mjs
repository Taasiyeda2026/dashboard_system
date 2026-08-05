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
const { operationsManagementScreen } = await import('../frontend/src/screens/operations-management.js');

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

test('real screen bind creates all custom 2027 tabs inside a nested screen root', () => {
  const dom = new JSDOM(`<!doctype html><html><head></head><body><div id="screenRoot"><div class="ds-screen-stack ds-ops-mgmt-screen ops-year-2027" data-ops-year="2027"><div class="ds-ops-mgmt-tabs"><button data-ops-tab="instructors">סידור עבודה</button><button data-ops-tab="workshops">ציוד ומלאי</button></div><div class="ds-ops-mgmt-content"></div></div></div></body></html>`, { url: 'http://localhost/' });
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousElement = globalThis.Element;
  const previousHTMLElement = globalThis.HTMLElement;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Element = dom.window.Element;
  globalThis.HTMLElement = dom.window.HTMLElement;
  try {
    const outerRoot = dom.window.document.getElementById('screenRoot');
    operationsManagementScreen.bind({
      root: outerRoot,
      data: { _loadedOperationsTabs: ['schedule'], _operationsTabLoadPromises: new Map() },
      state: {
        activityPeriodTab: 'school_2027',
        operationsManagement: { period: 'school_2027', tab: 'instructors' },
        activityListFilters: {}
      },
      api: {},
      ui: {},
      rerender() {},
      clearScreenDataCache() {}
    });
    const screen = outerRoot.querySelector('.ds-ops-mgmt-screen[data-ops-year="2027"]');
    const customLabels = Array.from(screen.querySelectorAll('[data-ops-custom-tab]')).map((button) => button.textContent);
    assert.deepEqual(customLabels, ['הכשרות סדנאות', 'הכשרות קורסים', 'ערכות דפוס']);
    assert.equal(screen.querySelector('[data-ops-tab="workshops"]').textContent, 'מלאי סדנאות');
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
    globalThis.Element = previousElement;
    globalThis.HTMLElement = previousHTMLElement;
    dom.window.close();
  }
});

test('wrapper forwards the nested screen root to the already installed controller', () => {
  assert.match(source, /const screenRoot = resolveOperations2027ScreenRoot\(context\.root\)/);
  assert.match(source, /originalBind\.call\(this, \{ \.\.\.context, root: screenRoot \}\)/);
  assert.match(loaderSource, /operations-2027-loading-controller\.js/);
  assert.match(loaderSource, /operations-2027-root-bind-hotfix\.js/);
});
