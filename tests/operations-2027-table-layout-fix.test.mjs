import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const wrapperUrl = new URL('../frontend/src/screens/operations-authorities-cleanup.js', import.meta.url);
const controllerUrl = new URL('../frontend/src/screens/operations-2027-loading-controller.js', import.meta.url);

const [wrapperSource, controllerSource] = await Promise.all([
  readFile(wrapperUrl, 'utf8'),
  readFile(controllerUrl, 'utf8')
]);

test('compact Operations 2027 layout is rendered by the single controller', () => {
  assert.match(wrapperSource, /operations-2027-loading-controller\.js/);
  assert.doesNotMatch(wrapperSource, /operations-2027-table-layout-fix\.js/);
});

test('workshop training is rendered directly with workshop rows and instructor columns', () => {
  assert.match(controllerSource, /rows: data\.workshops,[\s\S]*columns: data\.instructors/);
  assert.doesNotMatch(controllerSource, /transposeMatrixTable|orientWorkshopTrainingTable/);
});

test('course and print-kit matrices use instructor rows and course columns directly', () => {
  assert.match(controllerSource, /rows: data\.instructors,[\s\S]*columns: data\.courses/);
  assert.match(controllerSource, /rows: instructors,[\s\S]*columns: view\.courses/);
});

test('status controls use red and green symbols without colored bubbles', () => {
  assert.match(controllerSource, /background: transparent/);
  assert.match(controllerSource, /border-radius: 0/);
  assert.match(controllerSource, /color: #15803d/);
  assert.match(controllerSource, /color: #dc2626/);
  assert.match(controllerSource, /font-size: 18px/);
});

test('names and headers use compact fixed sizing', () => {
  assert.match(controllerSource, /width: 170px/);
  assert.match(controllerSource, /width: 78px/);
  assert.match(controllerSource, /width: 72px/);
  assert.match(controllerSource, /font-size: 10px/);
});

test('layout does not depend on mutation observers or delayed repair passes', () => {
  assert.doesNotMatch(controllerSource, /MutationObserver/);
  assert.doesNotMatch(controllerSource, /setTimeout/);
});
