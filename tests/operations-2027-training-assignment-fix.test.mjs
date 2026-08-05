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

test('assignment-aware course training is owned by the single controller', () => {
  assert.match(wrapperSource, /operations-2027-loading-controller\.js/);
  assert.doesNotMatch(wrapperSource, /operations-2027-training-assignment-fix\.js/);
});

test('course assignments use shared exact resolution and school-2027 activities', () => {
  assert.match(controllerSource, /resolveCourseForActivity\(row, courses\)/);
  assert.match(controllerSource, /\.eq\('activity_season', SCHOOL_2027\)/);
  assert.match(controllerSource, /activityType\(row\) !== 'course'/);
  assert.match(controllerSource, /pairs\.add\(pairKey\(course\.id, name\)\)/);
});

test('training state is green when trained, red only when assigned, and blank otherwise', () => {
  assert.match(controllerSource, /trainingCellState\(\{ trained, assigned \}\)/);
  assert.match(controllerSource, /state\.state === 'trained'/);
  assert.match(controllerSource, /state\.state === 'assigned_untrained'/);
  assert.match(controllerSource, /לא משובץ ולא עבר הכשרה/);
  assert.match(controllerSource, /ops2027-cell-button\.is-empty/);
});

test('course training writes patch the local cache without tab invalidation', () => {
  assert.match(controllerSource, /patchCourseTrainingCache/);
  assert.match(controllerSource, /applyTrainingButtonState/);
  assert.doesNotMatch(controllerSource, /invalidateOperations2027Tab/);
});

test('active path has no assignment observer, timeout or TTL', () => {
  assert.doesNotMatch(controllerSource, /MutationObserver/);
  assert.doesNotMatch(controllerSource, /setTimeout/);
  assert.doesNotMatch(controllerSource, /ASSIGNMENT_TTL_MS|assignmentLoadedAt/);
});

test('service worker cache version is at least 1418', () => {
  const match = swSource.match(/const CACHE_VERSION = (\d+);/);
  assert.ok(match);
  assert.ok(Number(match[1]) >= 1418);
});
