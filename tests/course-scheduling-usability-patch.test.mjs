import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const INDEX_FILE = new URL('../index.html', import.meta.url);
const PATCH_FILE = new URL('../frontend/src/course-scheduling-usability-patch.js', import.meta.url);
const SW_FILE = new URL('../frontend/sw.js', import.meta.url);

test('course scheduling usability patch loads before the application without eagerly loading the screen', async () => {
  const [html, patch] = await Promise.all([
    readFile(INDEX_FILE, 'utf8'),
    readFile(PATCH_FILE, 'utf8')
  ]);
  const patchPosition = html.indexOf('course-scheduling-usability-patch.js');
  const appPosition = html.indexOf('main-with-proposal-pdf-hotfix.js');
  assert.ok(patchPosition >= 0 && appPosition > patchPosition);
  assert.match(patch, /import\('\.\/screens\/course-scheduling\.js'\)/);
  assert.doesNotMatch(patch, /^import\s+\{\s*courseSchedulingScreen/m);
  assert.match(patch, /__usabilityPatched/);
});

test('course scheduling usability patch includes the required operational improvements', async () => {
  const patch = await readFile(PATCH_FILE, 'utf8');
  assert.match(patch, /nearestCourse/);
  assert.match(patch, /מוכנות לשיבוץ/);
  assert.match(patch, /קורסים ממתינים לשיבוץ/);
  assert.match(patch, /טרם חושבו/);
  assert.match(patch, /שמור בטיוטה/);
  assert.match(patch, /SNAPSHOT_KEY/);
  assert.match(patch, /course-calendar__selected-empty/);
  assert.match(patch, /חשב הצעות שיבוץ/);
});

test('service worker cache is bumped for the scheduling usability release', async () => {
  const sw = await readFile(SW_FILE, 'utf8');
  assert.match(sw, /const CACHE_VERSION = 1371;/);
});
