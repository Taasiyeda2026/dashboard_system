import test from 'node:test';
import assert from 'node:assert/strict';

function ensureBrowserGlobals() {
  if (!globalThis.sessionStorage) {
    const store = new Map();
    globalThis.sessionStorage = {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => { store.set(String(key), String(value)); },
      removeItem: (key) => { store.delete(String(key)); }
    };
  }
  if (!globalThis.localStorage) {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => { store.set(String(key), String(value)); },
      removeItem: (key) => { store.delete(String(key)); }
    };
  }
  if (!globalThis.document) {
    globalThis.document = {
      dispatchEvent() { return true; },
      addEventListener() {},
      documentElement: { dataset: {} },
      querySelectorAll() { return []; }
    };
  }
}
ensureBrowserGlobals();

const {
  ACT_SUBNAV_ITEMS,
  actNavGridHtml,
  headerNavGridHtml,
  isInstructorsNavActive
} = await import('../frontend/src/screens/shared/act-nav-grid.js');
const {
  bindInstructorsWorkspaceNav,
  instructorsWorkspaceHeaderHtml,
  instructorsWorkspaceNavHtml,
  resolveInstructorsWorkspaceActiveTab
} = await import('../frontend/src/screens/shared/instructors-workspace-nav.js');
const { instructorsScreen } = await import('../frontend/src/screens/instructors.js');
const { courseSchedulingScreen } = await import('../frontend/src/screens/course-scheduling.js');
const { operationsManagementScreen } = await import('../frontend/src/screens/operations-management.js');

test('שיבוצים is removed from the main activities subnav while course-scheduling route remains available', () => {
  const routes = ACT_SUBNAV_ITEMS.map((item) => item.route);
  assert.equal(routes.includes('course-scheduling'), false);
  assert.ok(routes.includes('instructors'));
  assert.ok(routes.includes('operations-management'));
  assert.doesNotMatch(ACT_SUBNAV_ITEMS.map((item) => item.label).join('|'), /שיבוצים/);

  const authorizedState = {
    routes: ['activities', 'operations-management', 'course-scheduling', 'end-dates', 'instructors'],
    route: 'course-scheduling'
  };
  assert.doesNotMatch(actNavGridHtml(authorizedState), /course-scheduling/);
  assert.doesNotMatch(headerNavGridHtml(authorizedState), /data-route="course-scheduling"/);
  assert.doesNotMatch(headerNavGridHtml(authorizedState), />שיבוצים</);
  assert.match(headerNavGridHtml(authorizedState), /data-route="instructors"/);
  assert.equal(isInstructorsNavActive(authorizedState), true);
});

test('instructors workspace tabs render consistently on list and scheduling screens', () => {
  const state = {
    user: { role: 'admin' },
    routes: ['instructors', 'course-scheduling', 'operations-management'],
    route: 'instructors',
    user: { role: 'admin' },
    instructorsWorkspace: { q: '', active: 'yes', assignment: '' }
  };
  const listHtml = instructorsScreen.render({ rows: [] }, { state });
  assert.match(listHtml, /role="tablist"/);
  assert.match(listHtml, /data-instructors-workspace-tab="list"[^>]*aria-selected="true"/);
  assert.match(listHtml, /data-instructors-workspace-tab="scheduling"/);
  assert.match(listHtml, /data-instructors-workspace-tab="work-schedule"/);
  assert.doesNotMatch(listHtml, /data-route="course-scheduling"/);
  assert.doesNotMatch(listHtml, /ניהול מדריכים, שיבוצים וסידור עבודה במקום אחד/);
  assert.doesNotMatch(listHtml, /<h1[^>]*>מדריכים<\/h1>/);
  assert.doesNotMatch(listHtml, /<h2[^>]*>רשימת מדריכים<\/h2>/);

  const schedulingState = { ...state, route: 'course-scheduling', courseSchedulingTab: 'courses' };
  const schedulingHtml = courseSchedulingScreen.render({
    activities: [],
    instructors: [],
    scheduling: {},
    meetingState: { loaded: true, approvedDates: new Map(), cancelledDates: new Map(), error: '' }
  }, { state: schedulingState });
  assert.match(schedulingHtml, /data-instructors-workspace-tab="scheduling"[^>]*aria-selected="true"/);
  assert.match(schedulingHtml, /data-instructors-workspace-tab="list"/);
  assert.match(schedulingHtml, /data-instructors-workspace-tab="work-schedule"/);
  assert.doesNotMatch(schedulingHtml, /<h1 class="ds-page-header__title">מדריכים<\/h1>/);
  assert.doesNotMatch(schedulingHtml, /<h2[^>]*instructors-workspace-content-title/);
  assert.doesNotMatch(schedulingHtml, /data-switch-tab=/);
});

function makeTabButton(tabId) {
  return {
    getAttribute: () => tabId,
    addEventListener(type, handler) {
      if (type === 'click') this._click = handler;
      if (type === 'keydown') this._keydown = handler;
    },
    click() { this._click?.(); },
    focus() {}
  };
}

function bindNavWithDocument(state, tabButtons, { onNavigate } = {}) {
  const events = [];
  globalThis.document = {
    ...globalThis.document,
    dispatchEvent(event) {
      events.push(event);
      onNavigate?.(event);
      return true;
    },
    querySelectorAll(selector) {
      if (selector !== '[data-instructors-workspace-tab]') return [];
      return tabButtons;
    }
  };
  const root = {
    querySelectorAll: globalThis.document.querySelectorAll.bind(globalThis.document)
  };
  let renderCount = 0;
  bindInstructorsWorkspaceNav(root, {
    state,
    rerender() { renderCount += 1; }
  });
  return { events, getRenderCount: () => renderCount };
}

test('work-schedule tab prepares instructors context and navigates without pre-setting route', () => {
  const tabButton = makeTabButton('work-schedule');
  const state = {
    user: { role: 'admin' },
    routes: ['instructors', 'course-scheduling', 'operations-management'],
    route: 'instructors',
    operationsManagement: { tab: 'completion_approval', context: 'operations' }
  };
  const { events } = bindNavWithDocument(state, [tabButton]);
  tabButton.click();
  // main.js owns state.route after app:navigate; pre-setting it would skip render.
  assert.equal(state.route, 'instructors');
  assert.equal(state.operationsManagement.context, 'instructors');
  assert.equal(state.operationsManagement.tab, 'instructors');
  assert.equal(events.at(-1)?.detail?.route, 'operations-management');
  assert.equal(events.at(-1)?.detail?.opsContext, 'instructors');
});

test('workspace tabs perform a real screen transition via app:navigate for all three tabs', () => {
  const tabs = [
    makeTabButton('list'),
    makeTabButton('scheduling'),
    makeTabButton('work-schedule')
  ];
  const state = {
    user: { role: 'admin' },
    routes: ['instructors', 'course-scheduling', 'operations-management'],
    effectiveRoutes: ['instructors', 'course-scheduling', 'operations-management'],
    route: 'instructors',
    operationsManagement: { tab: 'instructors', context: 'operations' }
  };
  const renders = [];
  const { events } = bindNavWithDocument(state, tabs, {
    onNavigate(event) {
      // Mirror main.js: bail if route was already set (the bug), otherwise transition.
      const route = event?.detail?.route;
      if (!route || route === state.route) return;
      state.route = route;
      renders.push(route);
    }
  });

  tabs[1].click(); // scheduling
  assert.equal(state.route, 'course-scheduling');
  assert.deepEqual(renders, ['course-scheduling']);
  assert.equal(events.at(-1)?.detail?.route, 'course-scheduling');

  tabs[2].click(); // work-schedule
  assert.equal(state.route, 'operations-management');
  assert.equal(state.operationsManagement.context, 'instructors');
  assert.deepEqual(renders, ['course-scheduling', 'operations-management']);
  assert.equal(events.at(-1)?.detail?.opsContext, 'instructors');

  tabs[0].click(); // list
  assert.equal(state.route, 'instructors');
  assert.equal(state.operationsManagement.context, 'operations');
  assert.deepEqual(renders, ['course-scheduling', 'operations-management', 'instructors']);
});

test('without document, workspace tabs update route and call rerender', () => {
  const savedDocument = globalThis.document;
  try {
    // eslint-disable-next-line no-global-assign
    globalThis.document = undefined;
    const state = {
      user: { role: 'admin' },
      routes: ['instructors', 'course-scheduling', 'operations-management'],
      route: 'instructors',
      operationsManagement: { tab: 'completion_approval', context: 'operations' }
    };
    const tabButton = makeTabButton('scheduling');
    const root = {
      querySelectorAll(selector) {
        if (selector !== '[data-instructors-workspace-tab]') return [];
        return [tabButton];
      }
    };
    let renderCount = 0;
    bindInstructorsWorkspaceNav(root, {
      state,
      rerender() { renderCount += 1; }
    });
    tabButton.click();
    assert.equal(state.route, 'course-scheduling');
    assert.equal(renderCount, 1);
  } finally {
    globalThis.document = savedDocument;
  }
});

test('operations management from main nav hides work-schedule and opens the home screen', () => {
  const state = {
    operationsManagement: {
      tab: 'instructors',
      context: 'operations',
      period: 'all',
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
      instructor: '__all__'
    },
    listFilters: { 'operations-management': { q: '', appliedQ: '', status: 'פתוח', visibleCount: 200 } }
  };
  document.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: 'operations-management' } }));
  const html = operationsManagementScreen.render({ rows: [], workshopStockMap: new Map() }, { state });
  assert.match(html, /תפעול/);
  assert.doesNotMatch(html, /data-ops-tab="instructors"/);
  assert.doesNotMatch(html, /data-instructors-workspace-tab/);
  assert.match(html, /operations-management-home/);
  assert.doesNotMatch(html, /ds-exceptions-tabs/);
  assert.equal(state.operationsManagement.tab, 'home');
});

test('instructors context keeps the same operations schedule screen under מדריכים', () => {
  const state = {
    user: { role: 'admin' },
    routes: ['instructors', 'course-scheduling', 'operations-management'],
    route: 'operations-management',
    operationsManagement: {
      tab: 'instructors',
      context: 'instructors',
      period: 'all',
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
      instructor: '__all__'
    },
    listFilters: { 'operations-management': { q: '', appliedQ: '', status: 'פתוח', visibleCount: 200 } }
  };
  const html = operationsManagementScreen.render({ rows: [], workshopStockMap: new Map() }, { state });
  assert.match(html, /data-ops-context="instructors"/);
  assert.doesNotMatch(html, /<h1 class="ds-page-header__title">מדריכים<\/h1>/);
  assert.match(html, /data-instructors-workspace-tab="work-schedule"[^>]*aria-selected="true"/);
  assert.match(html, /סידור עבודה/);
  assert.doesNotMatch(html, /טבלת סידור עבודה/);
  assert.doesNotMatch(html, /data-ops-tab="completion_approval"/);
  assert.doesNotMatch(html, /תפעול/);
});

test('workspace tabs respect route permissions', () => {
  const noScheduling = instructorsWorkspaceNavHtml({
    activeTab: 'list',
    state: { user: { role: 'instructor', view_instructors: 'yes', view_instructor_list: 'yes', view_instructor_work_schedule: 'yes' }, routes: ['instructors', 'operations-management'] }
  });
  assert.doesNotMatch(noScheduling, /data-instructors-workspace-tab="scheduling"/);
  assert.match(noScheduling, /data-instructors-workspace-tab="work-schedule"/);

  const noOps = instructorsWorkspaceNavHtml({
    activeTab: 'list',
    state: { user: { role: 'instructor', view_instructors: 'yes', view_instructor_list: 'yes', view_operations_scheduling: 'yes' }, routes: ['instructors', 'course-scheduling'] }
  });
  assert.match(noOps, /data-instructors-workspace-tab="scheduling"/);
  assert.doesNotMatch(noOps, /data-instructors-workspace-tab="work-schedule"/);
});

test('effectiveRoutes hides scheduling even when routes still includes course-scheduling', () => {
  const html = instructorsWorkspaceNavHtml({
    activeTab: 'list',
    state: {
      user: { role: 'instructor', view_instructors: 'yes', view_instructor_list: 'yes', view_instructor_work_schedule: 'yes', view_operations_scheduling: 'yes' },
      routes: ['instructors', 'course-scheduling', 'operations-management'],
      effectiveRoutes: ['instructors', 'operations-management']
    }
  });
  assert.match(html, /data-instructors-workspace-tab="list"/);
  assert.match(html, /data-instructors-workspace-tab="work-schedule"/);
  assert.doesNotMatch(html, /data-instructors-workspace-tab="scheduling"/);
});

test('deep link helpers keep the active instructors workspace tab', () => {
  assert.equal(resolveInstructorsWorkspaceActiveTab({ route: 'course-scheduling' }), 'scheduling');
  assert.equal(resolveInstructorsWorkspaceActiveTab({ route: 'instructors' }), 'list');
  assert.equal(resolveInstructorsWorkspaceActiveTab({
    route: 'operations-management',
    operationsManagement: { context: 'instructors' }
  }), 'work-schedule');
  assert.equal(resolveInstructorsWorkspaceActiveTab({
    route: 'operations-management',
    operationsManagement: { context: 'operations' }
  }), '');
  const header = instructorsWorkspaceHeaderHtml({
    activeTab: 'scheduling',
    state: { user: { role: 'admin' }, routes: ['instructors', 'course-scheduling', 'operations-management'], route: 'course-scheduling' }
  });
  assert.match(header, /data-instructors-workspace-tab="scheduling"[^>]*aria-selected="true"/);
});
