import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const fixUrl = new URL('../frontend/src/screens/operations-2027-custom-tabs-click-fix.js', import.meta.url);
const wrapperUrl = new URL('../frontend/src/screens/operations-authorities-cleanup.js', import.meta.url);
const swUrl = new URL('../frontend/sw.js', import.meta.url);

const [fixSource, wrapperSource, swSource] = await Promise.all([
  readFile(fixUrl, 'utf8'),
  readFile(wrapperUrl, 'utf8'),
  readFile(swUrl, 'utf8')
]);

test('focused click repair is loaded after the 2027 operations fixes', () => {
  assert.match(wrapperSource, /operations-2027-training-kit-history-fix\.js/);
  assert.match(wrapperSource, /operations-2027-custom-tabs-click-fix\.js/);
  assert.ok(
    wrapperSource.indexOf('operations-2027-custom-tabs-click-fix.js')
      > wrapperSource.indexOf('operations-2027-training-kit-history-fix.js')
  );
});

test('all three custom operations tabs are covered by the repair', () => {
  assert.match(fixSource, /summer_training_matrix/);
  assert.match(fixSource, /course_training_matrix/);
  assert.match(fixSource, /course_print_kits/);
});

test('2027 is detected from the permanent operations root marker', () => {
  assert.match(fixSource, /data-ops-year=\\?"2027\\?"/);
  assert.match(fixSource, /ops-year-2027/);
  assert.match(fixSource, /value=\\?"school_2027\\?" selected>2027/);
});

test('existing dynamic buttons are recreated and clicks are repaired in capture phase', () => {
  assert.match(fixSource, /querySelectorAll\('\[data-ops-custom-tab\]'\)/);
  assert.match(fixSource, /button\.remove\(\)/);
  assert.match(fixSource, /document\.addEventListener\('click', ensureMarkerBeforeCustomTabClick, true\)/);
  assert.match(fixSource, /MutationObserver/);
});

test('service worker cache version is at least 1403', () => {
  const match = swSource.match(/const CACHE_VERSION = (\d+);/);
  assert.ok(match);
  assert.ok(Number(match[1]) >= 1403);
});
