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
  assert.match(listHtml, /ניהול מדריכים, שיבוצים וסידור עבודה במקום אחד/);

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
  assert.match(schedulingHtml, /<h1 class="ds-page-header__title">מדריכים<\/h1>/);
  assert.match(schedulingHtml, /<h2 class="course-scheduling-title instructors-workspace-content-title">שיבוצים<\/h2>/);
});

test('work-schedule tab opens operations-management with instructors context', () => {
  const events = [];
  const tabButton = {
    getAttribute: () => 'work-schedule',
    addEventListener(type, handler) {
      if (type === 'click') this._click = handler;
    },
    click() { this._click?.(); },
    focus() {}
  };
  globalThis.document = {
    ...globalThis.document,
    dispatchEvent(event) {
      events.push(event);
      return true;
    },
    querySelectorAll(selector) {
      if (selector !== '[data-instructors-workspace-tab]') return [];
      return [tabButton];
    }
  };
  const state = {
    routes: ['instructors', 'course-scheduling', 'operations-management'],
    route: 'instructors',
    operationsManagement: { tab: 'completion_approval', context: 'operations' }
  };
  const root = {
    querySelectorAll: globalThis.document.querySelectorAll.bind(globalThis.document)
  };
  bindInstructorsWorkspaceNav(root, { state, rerender() {} });
  tabButton.click();
  assert.equal(state.route, 'operations-management');
  assert.equal(state.operationsManagement.context, 'instructors');
  assert.equal(state.operationsManagement.tab, 'instructors');
  assert.equal(events.at(-1)?.detail?.route, 'operations-management');
  assert.equal(events.at(-1)?.detail?.opsContext, 'instructors');
});

test('operations management from main nav hides work-schedule and opens first remaining tab', () => {
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
  const html = operationsManagementScreen.render({ rows: [], workshopStockMap: new Map() }, { state });
  assert.match(html, /ניהול תפעול/);
  assert.doesNotMatch(html, /data-ops-tab="instructors"/);
  assert.doesNotMatch(html, /data-instructors-workspace-tab/);
  assert.match(html, /data-ops-tab="completion_approval"[^>]*aria-pressed="true"/);
  assert.match(html, /data-ops-tab="authorities"/);
  assert.match(html, /data-ops-tab="workshops"/);
  assert.equal(state.operationsManagement.tab, 'completion_approval');
});

test('instructors context keeps the same operations schedule screen under מדריכים', () => {
  const state = {
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
  assert.match(html, /<h1 class="ds-page-header__title">מדריכים<\/h1>/);
  assert.match(html, /data-instructors-workspace-tab="work-schedule"[^>]*aria-selected="true"/);
  assert.match(html, /סידור עבודה/);
  assert.match(html, /טבלת סידור עבודה/);
  assert.doesNotMatch(html, /data-ops-tab="completion_approval"/);
  assert.doesNotMatch(html, /ניהול תפעול/);
});

test('workspace tabs respect route permissions', () => {
  const noScheduling = instructorsWorkspaceNavHtml({
    activeTab: 'list',
    state: { routes: ['instructors', 'operations-management'] }
  });
  assert.doesNotMatch(noScheduling, /data-instructors-workspace-tab="scheduling"/);
  assert.match(noScheduling, /data-instructors-workspace-tab="work-schedule"/);

  const noOps = instructorsWorkspaceNavHtml({
    activeTab: 'list',
    state: { routes: ['instructors', 'course-scheduling'] }
  });
  assert.match(noOps, /data-instructors-workspace-tab="scheduling"/);
  assert.doesNotMatch(noOps, /data-instructors-workspace-tab="work-schedule"/);
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
    state: { routes: ['instructors', 'course-scheduling', 'operations-management'], route: 'course-scheduling' }
  });
  assert.match(header, /data-instructors-workspace-tab="scheduling"[^>]*aria-selected="true"/);
});
