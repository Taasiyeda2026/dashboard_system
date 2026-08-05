import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const controllerUrl = new URL('../frontend/src/screens/operations-2027-loading-controller.js', import.meta.url);
const wrapperUrl = new URL('../frontend/src/screens/operations-authorities-cleanup.js', import.meta.url);
const swUrl = new URL('../frontend/sw.js', import.meta.url);

const [controllerSource, wrapperSource, swSource] = await Promise.all([
  readFile(controllerUrl, 'utf8'),
  readFile(wrapperUrl, 'utf8'),
  readFile(swUrl, 'utf8')
]);

test('all three custom Operations 2027 tabs are owned by one controller', () => {
  assert.match(wrapperSource, /operations-2027-loading-controller\.js/);
  assert.match(controllerSource, /summer_training_matrix/);
  assert.match(controllerSource, /course_training_matrix/);
  assert.match(controllerSource, /course_print_kits/);
});

test('custom tab buttons are created during screen binding without DOM observers', () => {
  assert.match(controllerSource, /function bindCustomTabs\(root\)/);
  assert.match(controllerSource, /tabs\.appendChild\(button\)/);
  assert.match(controllerSource, /button\.addEventListener\('click'/);
  assert.doesNotMatch(controllerSource, /MutationObserver/);
  assert.doesNotMatch(controllerSource, /setTimeout/);
});

test('2027 is detected from the permanent operations root marker', () => {
  assert.match(controllerSource, /data-ops-year=\\?"2027\\?"/);
  assert.match(controllerSource, /ops-year-2027/);
});

test('route exit disposes the in-memory cache without storage persistence', () => {
  assert.match(controllerSource, /app:navigate/);
  assert.match(controllerSource, /disposeOperations2027LoadingCache/);
  assert.doesNotMatch(controllerSource, /localStorage|sessionStorage/);
});

test('service worker cache version is at least 1418', () => {
  const match = swSource.match(/const CACHE_VERSION = (\d+);/);
  assert.ok(match);
  assert.ok(Number(match[1]) >= 1418);
});
