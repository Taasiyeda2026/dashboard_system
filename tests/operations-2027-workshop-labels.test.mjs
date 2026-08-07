import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const labelsPath = new URL('../frontend/src/screens/operations-2027-workshop-labels.js', import.meta.url);
const cleanupPath = new URL('../frontend/src/screens/operations-authorities-cleanup.js', import.meta.url);

const [labelsSource, cleanupSource] = await Promise.all([
  readFile(labelsPath, 'utf8'),
  readFile(cleanupPath, 'utf8')
]);

test('2027 workshop inventory removes the redundant year from table headers only', () => {
  assert.match(labelsSource, /\['מלאי פתיחה 2027', 'מלאי פתיחה'\]/);
  assert.match(labelsSource, /\['ניצול בפועל 2027', 'ניצול בפועל'\]/);
  assert.match(labelsSource, /\['צפי נדרש 2027', 'צפי נדרש'\]/);
  assert.match(labelsSource, /\['יתרה צפויה 2027', 'יתרה צפויה'\]/);
  assert.match(labelsSource, /\.ds-ops-workshops-table thead th/);
  assert.match(labelsSource, /resolveOperations2027Root/);
});

test('the label patch is loaded after the existing 2027 operations controller', () => {
  const controllerIndex = cleanupSource.indexOf("./operations-2027-loading-controller.js");
  const labelsIndex = cleanupSource.indexOf("./operations-2027-workshop-labels.js");
  assert.ok(controllerIndex >= 0);
  assert.ok(labelsIndex > controllerIndex);
});
