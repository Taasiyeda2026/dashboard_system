import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const MODULE_URL = new URL('../frontend/src/interaction-performance.js', import.meta.url).href;

async function withBrowser(html, run) {
  const dom = new JSDOM(html, { url: 'http://localhost' });
  const previous = {
    window: global.window,
    document: global.document,
    Element: global.Element,
    MutationObserver: global.MutationObserver,
    performance: global.performance,
    requestAnimationFrame: global.requestAnimationFrame,
    installed: global.__dsInteractionPerformanceInstalled
  };
  let clock = 0;
  global.window = dom.window;
  global.document = dom.window.document;
  global.Element = dom.window.Element;
  global.MutationObserver = dom.window.MutationObserver;
  global.performance = { now: () => (clock += 4) };
  global.requestAnimationFrame = (callback) => callback(clock += 8);
  delete global.__dsInteractionPerformanceInstalled;
  try {
    await import(`${MODULE_URL}?test=${Date.now()}-${Math.random()}`);
    await run(dom.window);
  } finally {
    dom.window.close();
    Object.assign(global, previous);
    if (previous.installed === undefined) delete global.__dsInteractionPerformanceInstalled;
  }
}

test('records week, month, instructor, operations, proposal and stock controls', async () => {
  await withBrowser(`<!doctype html><body><main id="screenRoot">
    <button data-week-next></button><button data-month-prev></button>
    <button data-instr-month-next></button><button data-instructor-card="1"></button>
    <button data-ops-tab="workshops"></button><button data-ops-stock-edit-save></button>
    <button data-pa-open-proposal-id="p1"></button>
  </main></body>`, async (window) => {
    document.querySelectorAll('button').forEach((button) => button.click());
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(window.__dsPerf.interactions.map((entry) => entry.action), [
      'week-next', 'month-prev', 'instructors-month-next', 'instructor-open',
      'operations-tab', 'operations-stock-save', 'proposal-open'
    ]);
    assert.ok(window.__dsPerf.interactions.every((entry) => Number.isFinite(entry.click_to_next_paint_ms)));
  });
});

test('captures the first DOM change caused by a measured click without changing the handler', async () => {
  await withBrowser('<!doctype html><body><main id="screenRoot"><button data-week-prev>prev</button><output></output></main></body>', async (window) => {
    const button = document.querySelector('button');
    button.addEventListener('click', () => { document.querySelector('output').textContent = 'changed'; });
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const [entry] = window.__dsPerf.interactions;
    assert.equal(document.querySelector('output').textContent, 'changed');
    assert.ok(Number.isFinite(entry.click_to_dom_change_ms));
    assert.ok(Number.isFinite(entry.click_to_next_paint_ms));
  });
});
