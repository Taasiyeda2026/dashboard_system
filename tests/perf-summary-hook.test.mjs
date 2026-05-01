import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const MAIN_MODULE = new URL('../frontend/src/main.js', import.meta.url).href;

test('perf summary helper is defined behind window guard in main.js source', async () => {
  const fs = await import('node:fs/promises');
  const source = await fs.readFile(new URL('../frontend/src/main.js', import.meta.url), 'utf8');
  assert.match(source, /if \(typeof window === 'undefined'\) return null;/);
  assert.match(source, /window\.__printDsPerfSummary\s*=\s*\(\)\s*=>\s*\{/);
});

test('browser-like environment can execute perf summary helper safely', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  global.sessionStorage = dom.window.sessionStorage;
  global.performance = { now: () => 0 };
  global.requestAnimationFrame = (cb) => cb();

  const stamp = Date.now() + Math.random();
  await import(`${MAIN_MODULE}?bust=${stamp}`);

  assert.equal(typeof window.__printDsPerfSummary, 'function');
  const summary = window.__printDsPerfSummary();
  assert.ok(summary);
  assert.ok(Object.prototype.hasOwnProperty.call(summary, 'slowest_requests'));
});
