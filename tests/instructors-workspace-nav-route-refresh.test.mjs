import test from 'node:test';
import assert from 'node:assert/strict';

if (!globalThis.CustomEvent) {
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  };
}

const { bindInstructorsWorkspaceNav, instructorsWorkspaceNavHtml } = await import('../frontend/src/screens/shared/instructors-workspace-nav.js');

function makeButton(tabId) {
  return {
    _handlers: {},
    getAttribute(name) {
      return name === 'data-instructors-workspace-tab' ? tabId : '';
    },
    addEventListener(type, handler) {
      this._handlers[type] = handler;
    },
    click() {
      this._handlers.click?.();
    },
    focus() {}
  };
}

function bindButtons(state, buttons) {
  const events = [];
  const savedDocument = globalThis.document;
  globalThis.document = {
    dispatchEvent(event) {
      events.push(event);
      return true;
    }
  };
  const root = {
    querySelectorAll(selector) {
      return selector === '[data-instructors-workspace-tab]' ? buttons : [];
    }
  };
  bindInstructorsWorkspaceNav(root, { state, rerender() {} });
  return {
    events,
    restore() { globalThis.document = savedDocument; }
  };
}

test('admin scheduling tab stays available and navigates when effectiveRoutes lost course-scheduling after render', () => {
  const state = {
    user: { role: 'admin' },
    route: 'operations-management',
    routes: ['instructors', 'operations-management'],
    effectiveRoutes: ['instructors', 'operations-management'],
    operationsManagement: { context: 'instructors', tab: 'instructors' }
  };
  const html = instructorsWorkspaceNavHtml({ activeTab: 'work-schedule', state });
  assert.match(html, /data-instructors-workspace-tab="scheduling"/);

  const scheduling = makeButton('scheduling');
  const harness = bindButtons(state, [scheduling]);
  try {
    scheduling.click();
    assert.equal(harness.events.at(-1)?.detail?.route, 'course-scheduling');
    assert.equal(state.courseSchedulingTab, '');
    assert.ok(state.routes.includes('course-scheduling'));
    assert.ok(state.effectiveRoutes.includes('course-scheduling'));
  } finally {
    harness.restore();
  }
});

test('admin maintenance tab navigates from work schedule under the same stale-route condition', () => {
  const state = {
    user: { role: 'admin' },
    route: 'operations-management',
    routes: ['instructors', 'operations-management'],
    effectiveRoutes: ['instructors', 'operations-management'],
    operationsManagement: { context: 'instructors', tab: 'instructors' }
  };
  const maintenance = makeButton('maintenance');
  const harness = bindButtons(state, [maintenance]);
  try {
    maintenance.click();
    assert.equal(harness.events.at(-1)?.detail?.route, 'course-scheduling');
    assert.equal(state.courseSchedulingTab, 'maintenance');
    assert.equal(state.courseSchedulingDistanceCoverageLoaded, false);
    assert.ok(state.effectiveRoutes.includes('course-scheduling'));
  } finally {
    harness.restore();
  }
});

test('non scheduling role does not receive course-scheduling when route permission is absent', () => {
  const state = {
    user: { role: 'finance' },
    route: 'operations-management',
    routes: ['instructors', 'operations-management'],
    effectiveRoutes: ['instructors', 'operations-management']
  };
  const html = instructorsWorkspaceNavHtml({ activeTab: 'work-schedule', state });
  assert.doesNotMatch(html, /data-instructors-workspace-tab="scheduling"/);
  assert.doesNotMatch(html, /data-instructors-workspace-tab="maintenance"/);
});
