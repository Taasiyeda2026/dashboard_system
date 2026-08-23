import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const operationsSource = await readFile(new URL('../frontend/src/screens/operations-management.js', import.meta.url), 'utf8');
const controllerSource = await readFile(new URL('../frontend/src/screens/operations-2027-loading-controller.js', import.meta.url), 'utf8');
const hotfixSource = await readFile(new URL('../frontend/src/operations-home-navigation-hotfix.js', import.meta.url), 'utf8');
const bootstrapSource = await readFile(new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url), 'utf8');

const expectedTargets = [
  ['מלאי סדנאות', 'ops-tab', 'TAB_WORKSHOPS'],
  ['הזמנות לאירועים', 'route', "'invitations'"],
  ['קטלוג', 'route', "'catalog'"],
  ['תעודות', 'route', "'certificates'"],
  ['הכשרות סדנאות', 'ops-custom-tab', 'OPS_CUSTOM_TAB_WORKSHOP_TRAINING'],
  ['הכשרות קורסים', 'ops-custom-tab', 'OPS_CUSTOM_TAB_COURSE_TRAINING'],
  ['ערכות דפוס', 'ops-custom-tab', 'OPS_CUSTOM_TAB_PRINT_KITS']
];

test('Operations home exposes the seven intended navigation targets', () => {
  for (const [label, type, valueToken] of expectedTargets) {
    assert.match(operationsSource, new RegExp(`label: '${label}', type: '${type}', value: ${valueToken.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}`));
  }
});

test('external Operations cards point at real application screens', async () => {
  for (const file of ['invitations.js', 'catalog.js', 'certificates.js']) {
    const source = await readFile(new URL(`../frontend/src/screens/${file}`, import.meta.url), 'utf8');
    assert.ok(source.length > 0, `${file} must exist and be non-empty`);
  }
});

test('custom Operations cards use the same keys as the 2027 controller', () => {
  assert.match(controllerSource, /summer_training_matrix/);
  assert.match(controllerSource, /course_training_matrix/);
  assert.match(controllerSource, /course_print_kits/);
});

test('same-route reset is suppressed only for internal Operations home cards', () => {
  assert.match(hotfixSource, /new Set\(\['ops-tab', 'ops-custom-tab'\]\)/);
  assert.match(hotfixSource, /route !== INTERNAL_ROUTE/);
  assert.match(hotfixSource, /event\.stopImmediatePropagation\(\)/);
  assert.doesNotMatch(hotfixSource, /INTERNAL_HOME_TARGET_TYPES.*route/s);
});

test('navigation hotfix is loaded by the production bootstrap', () => {
  assert.match(bootstrapSource, /operations-home-navigation-hotfix\.js\?v=20260823-v1/);
});
