import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const operationsSource = await readFile(new URL('../frontend/src/screens/operations-management.js', import.meta.url), 'utf8');
const controllerSource = await readFile(new URL('../frontend/src/screens/operations-2027-loading-controller.js', import.meta.url), 'utf8');
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
    const needle = `{ label: '${label}', type: '${type}', value: ${valueToken} }`;
    assert.ok(operationsSource.includes(needle), `missing Operations home target: ${label}`);
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

test('navigation hotfix is loaded by the production bootstrap', () => {
  assert.match(bootstrapSource, /operations-home-navigation-hotfix\.js\?v=20260823-v1/);
});

test('internal cards suppress only the broken same-route reset event', async () => {
  const listeners = new Map();
  class FakeElement {
    constructor(type = '', value = '') { this.type = type; this.value = value; }
    closest(selector) {
      return selector.includes('data-ops-home-target-type') && this.type ? this : null;
    }
    getAttribute(name) {
      if (name === 'data-ops-home-target-type') return this.type;
      if (name === 'data-ops-home-target-value') return this.value;
      return '';
    }
  }
  globalThis.Element = FakeElement;
  globalThis.document = {
    documentElement: { dataset: {} },
    addEventListener(type, handler) { listeners.set(type, handler); }
  };

  const hotfix = await import(`../frontend/src/operations-home-navigation-hotfix.js?test=${Date.now()}`);

  let stopped = 0;
  hotfix.markInternalHomeNavigation({ target: new FakeElement('ops-tab', 'workshops') });
  hotfix.suppressSameRouteReset({
    detail: { route: 'operations-management' },
    stopImmediatePropagation() { stopped += 1; }
  });
  assert.equal(stopped, 1, 'standard internal card must not be reset back to Operations home');

  hotfix.markInternalHomeNavigation({ target: new FakeElement('ops-custom-tab', 'course_training_matrix') });
  hotfix.suppressSameRouteReset({
    detail: { route: 'operations-management' },
    stopImmediatePropagation() { stopped += 1; }
  });
  assert.equal(stopped, 2, 'custom internal card must not be reset back to Operations home');

  hotfix.markInternalHomeNavigation({ target: new FakeElement('route', 'catalog') });
  hotfix.suppressSameRouteReset({
    detail: { route: 'catalog' },
    stopImmediatePropagation() { stopped += 1; }
  });
  assert.equal(stopped, 2, 'external route cards must remain normal application navigation');
});
