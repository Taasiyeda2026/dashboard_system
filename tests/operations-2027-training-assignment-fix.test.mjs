import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const fixUrl = new URL('../frontend/src/screens/operations-2027-training-assignment-fix.js', import.meta.url);
const wrapperUrl = new URL('../frontend/src/screens/operations-authorities-cleanup.js', import.meta.url);
const swUrl = new URL('../frontend/sw.js', import.meta.url);

const [fixSource, wrapperSource, swSource] = await Promise.all([
  readFile(fixUrl, 'utf8'),
  readFile(wrapperUrl, 'utf8'),
  readFile(swUrl, 'utf8')
]);

test('assignment-aware fix loads after the table layout fix', () => {
  assert.match(wrapperSource, /operations-2027-table-layout-fix\.js/);
  assert.match(wrapperSource, /operations-2027-training-assignment-fix\.js/);
  assert.ok(
    wrapperSource.indexOf('operations-2027-training-assignment-fix.js')
      > wrapperSource.indexOf('operations-2027-table-layout-fix.js')
  );
});

test('course assignments are loaded only from 2027 course activities', () => {
  assert.match(fixSource, /activity_season', SCHOOL_2027/);
  assert.match(fixSource, /activity_type', 'course'/);
  assert.match(fixSource, /assignedPairs\.add\(pairKey\(course\.id, name\)\)/);
});

test('training state is green when trained, red only when assigned, and blank otherwise', () => {
  assert.match(fixSource, /trained \? 'is-yes' : \(assigned \? 'is-no' : 'is-empty'\)/);
  assert.match(fixSource, /trained \? '✓' : \(assigned \? '✕' : ''\)/);
  assert.match(fixSource, /לא משובץ ולא עבר הכשרה/);
  assert.match(fixSource, /ops2027-cell-button\.is-empty/);
});

test('course-training explanatory sentence is removed from the rendered view', () => {
  assert.match(fixSource, /querySelectorAll\('\.ops2027-history-note'\)/);
  assert.match(fixSource, /note\.remove\(\)/);
});

test('duplicate print-kit page title is removed when an attached title exists', () => {
  assert.match(fixSource, /PRINT_KITS_TAB = 'course_print_kits'/);
  assert.match(fixSource, /duplicateAttachedTitle/);
  assert.match(fixSource, /if \(duplicateAttachedTitle\) header\.remove\(\)/);
});

test('service worker cache version is at least 1405', () => {
  const match = swSource.match(/const CACHE_VERSION = (\d+);/);
  assert.ok(match);
  assert.ok(Number(match[1]) >= 1405);
});
