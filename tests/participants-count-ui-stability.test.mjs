import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../frontend/src/screens/operations-inventory-polish.js', import.meta.url),
  'utf8'
);

test('participant count UI binds global listeners only once', () => {
  assert.match(source, /let participantsUiBound = false;/);
  assert.match(source, /function bindParticipantsCountUi\(\) \{[\s\S]*if \(participantsUiBound\) return;[\s\S]*participantsUiBound = true;/);
});

test('participant count DOM synchronization does not rewrite unchanged text', () => {
  assert.match(source, /function setTextIfChanged\(element, value\)/);
  assert.match(source, /if \(element\.textContent !== next\) element\.textContent = next;/);
  assert.match(source, /setTextIfChanged\(view, participantsDisplay\(input\.value\)\);/);
});

test('mutation observer work is debounced instead of multiplying timers', () => {
  assert.match(source, /let inventoryPolishTimer = null;/);
  assert.match(source, /window\.clearTimeout\(inventoryPolishTimer\)/);
  assert.match(source, /inventoryPolishTimer = window\.setTimeout/);
});

test('successful save messages dismiss and the drawer edit action is restored', () => {
  assert.match(source, /\.ds-exceptions-save-notice/);
  assert.match(source, /notice\.remove\(\)/);
  assert.match(source, /\.ds-activity-edit-status\.is-success/);
  assert.match(source, /status\.textContent = '';/);
  assert.match(source, /function restoreDrawerViewActions\(root = document\)/);
  assert.match(source, /editButton\.hidden = false;/);
});
